// Capability intake & vetting (Toby) — the ONLY door into the capability registry (R&C S-4).
// Deterministic static review + provenance + dependency review + hash-on-vet, a risk score, and a
// disposition: Low auto-registers; Medium+ is quarantined (registered-but-disabled) pending consent.
// Toby (an agent) RECOMMENDS by producing a report; the core (CapabilityLedger) REGISTERS.
import { sha256 } from './hash';
import type { RiskTier } from './types';
import type { AuditLog } from './audit';

export interface CapabilityFile { path: string; content: string; }
export interface VettingInput {
  id: string;
  kind: 'skill' | 'tool' | 'agent';
  files: CapabilityFile[];
  provenance?: { repo?: string; author?: string; stars?: number; license?: string };
  dependencies?: { name: string; version: string }[];
}
export interface VettingReport {
  id: string; kind: string; contentHash: string;
  findings: string[]; riskTier: RiskTier;
  disposition: 'auto-register' | 'quarantine';
  forceHuman: boolean; mitigations: string[]; at: string;
}

const RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const max = (a: RiskTier, b: RiskTier): RiskTier => (RANK[a] >= RANK[b] ? a : b);
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|Unlicense)$/i;

const SIGNALS: { re: RegExp; tier: RiskTier; finding: string; forceHuman?: boolean }[] = [
  { re: /\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=|format\s+[a-z]:/i, tier: 'critical', finding: 'destructive command' },
  { re: /child_process|\bexecSync?\b|\bspawn\b|\beval\s*\(|new\s+Function\s*\(/, tier: 'high', finding: 'arbitrary code execution' },
  { re: /\bfetch\s*\(|https?:\/\/|require\(['"]https?['"]\)|axios|\bcurl\b|\bwget\b/i, tier: 'high', finding: 'outbound network', forceHuman: true },
  { re: /atob\s*\(|Buffer\.from\([^)]*,\s*['"]base64['"]\)|(\\x[0-9a-f]{2}){6,}/i, tier: 'high', finding: 'obfuscation / encoded payload', forceHuman: true },
  { re: /\bprocess\.env\b|\bAWS_[A-Z]|\bAPI_KEY\b|\bSECRET_|\bACCESS_TOKEN\b|\bcredentials\b/i, tier: 'medium', finding: 'reads env / credential material' },
  { re: /writeFile|unlink|rmdir|appendFile/i, tier: 'medium', finding: 'filesystem writes' },
];

export function hashFiles(files: CapabilityFile[]): string {
  const norm = [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\n${f.content}`).join('\0');
  return sha256(norm);
}

export function vet(input: VettingInput): VettingReport {
  const blob = input.files.map((f) => f.content).join('\n');
  const findings: string[] = [];
  const mitigations: string[] = [];
  let tier: RiskTier = 'low';
  let forceHuman = false;

  for (const s of SIGNALS) {
    if (s.re.test(blob)) {
      findings.push(s.finding);
      tier = max(tier, s.tier);
      if (s.forceHuman) forceHuman = true;
    }
  }
  // fetch-and-execute is worse than either alone
  if (/\bfetch\s*\(|https?:\/\//i.test(blob) && /child_process|\bexec|\beval\s*\(|new\s+Function/.test(blob)) {
    tier = 'critical'; forceHuman = true; findings.push('fetch-and-execute at runtime');
    mitigations.push('remove runtime fetch+exec; pre-bundle and pin instead');
  }
  // provenance
  const p = input.provenance;
  if (!p?.author) { findings.push('unknown author'); tier = max(tier, 'medium'); mitigations.push('establish provenance / author'); }
  if (p?.license && !PERMISSIVE.test(p.license)) { findings.push(`non-permissive license: ${p.license}`); tier = max(tier, 'medium'); }
  // dependencies inherit scrutiny
  if (input.dependencies && input.dependencies.length > 0) findings.push(`${input.dependencies.length} dependency(ies) — each inherits the sweep`);

  if (forceHuman && tier === 'low') tier = 'medium';
  const disposition: VettingReport['disposition'] = tier === 'low' && !forceHuman ? 'auto-register' : 'quarantine';
  if (disposition === 'quarantine' && mitigations.length === 0) mitigations.push('restrict allowedAgents; scope paths; pin versions; then re-vet to lower the tier');

  return {
    id: input.id, kind: input.kind, contentHash: hashFiles(input.files),
    findings: findings.length ? findings : ['no risk signals detected'],
    riskTier: tier, disposition, forceHuman, mitigations, at: new Date().toISOString(),
  };
}

export function renderReport(r: VettingReport): string {
  return [`# Vetting report — ${r.id} (${r.kind})`, `risk: ${r.riskTier} · disposition: ${r.disposition}` + (r.forceHuman ? ' · human review forced' : ''),
    `hash: ${r.contentHash}`, '', '## findings', ...r.findings.map((f) => `- ${f}`),
    ...(r.mitigations.length ? ['', '## recommended mitigations', ...r.mitigations.map((m) => `- ${m}`)] : [])].join('\n');
}

interface CapabilityEntry { id: string; kind: string; riskTier: RiskTier; status: 'enabled' | 'quarantined'; contentHash: string; }

export class CapabilityLedger {
  private caps = new Map<string, CapabilityEntry>();
  constructor(private audit: AuditLog) {}

  /** The ONLY registration path: intake a vetting report. Low auto-enables; else quarantined. */
  intake(report: VettingReport): 'registered' | 'quarantined' {
    const status: CapabilityEntry['status'] = report.disposition === 'auto-register' ? 'enabled' : 'quarantined';
    this.caps.set(report.id, { id: report.id, kind: report.kind, riskTier: report.riskTier, status, contentHash: report.contentHash });
    this.audit.append({
      actor: 'toby', domain: 'governance',
      action: status === 'enabled' ? 'capability:register' : 'capability:quarantine',
      target: report.id, decision: status === 'enabled' ? 'allow' : 'deny',
      reason: `tier=${report.riskTier}`,
    });
    return status === 'enabled' ? 'registered' : 'quarantined';
  }

  /** Human consent promotes a quarantined capability to enabled. */
  approve(id: string, by: string): void {
    const c = this.caps.get(id);
    if (!c) return;
    c.status = 'enabled';
    this.audit.append({ actor: by, domain: 'governance', action: 'capability:approve', target: id, decision: 'allow', reason: 'human consent' });
  }

  snapshot(): CapabilityEntry[] { return [...this.caps.values()]; }
  restore(arr: CapabilityEntry[]): void { this.caps = new Map(arr.map((c) => [c.id, c])); }
  isEnabled(id: string): boolean { return this.caps.get(id)?.status === 'enabled'; }
  get(id: string): CapabilityEntry | undefined { return this.caps.get(id); }

  /** Hash-on-vet enforcement: the on-disk bytes must match what was vetted, else deny + re-vet. */
  verify(id: string, currentFiles: CapabilityFile[]): { ok: boolean; reason?: string } {
    const c = this.caps.get(id);
    if (!c) return { ok: false, reason: 'capability not registered' };
    if (hashFiles(currentFiles) !== c.contentHash) {
      this.audit.append({ actor: 'system', domain: 'governance', action: 'capability:hash-mismatch', target: id, decision: 'deny', reason: 'content drifted since vetting — re-vet required' });
      return { ok: false, reason: 'hash mismatch — re-vet required' };
    }
    return { ok: true };
  }
}
