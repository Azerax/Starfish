// Capability intake & vetting (Toby) — the ONLY door into the capability registry (R&C S-4).
// Static review + provenance + per-file hash manifest (hash-on-vet) + prompt-injection screen.
// Disposition: Low auto-registers; Medium+ quarantined; PROMPT-INJECTION is the highest tier and is
// REJECTED outright (never registered) — it overrides trusted-publisher. Trusted publishers are
// adjudicated low otherwise; runtime governance + integrity checks still apply.
import { sha256 } from './hash';
import type { RiskTier } from './types';
import type { AuditLog } from './audit';
import { verifyAgainstPinned, type PinnedPublisher } from './signature';

export interface CapabilityFile { path: string; content: string; }
export interface VettingInput {
  id: string;
  kind: 'skill' | 'tool' | 'agent';
  files: CapabilityFile[];
  provenance?: { repo?: string; author?: string; stars?: number; license?: string };
  dependencies?: { name: string; version: string }[];
  signature?: string;
  hasSymlinks?: boolean;   // set by the reader when the tree contains symlinks (never allowed)
}
export interface VettingReport {
  id: string; kind: string; contentHash: string;
  manifest: Record<string, string>;
  findings: string[]; riskTier: RiskTier;
  disposition: 'auto-register' | 'quarantine' | 'reject';
  injection: boolean; forceHuman: boolean; mitigations: string[]; at: string;
}

const RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3, injection: 4 };
const maxT = (a: RiskTier, b: RiskTier): RiskTier => (RANK[a] >= RANK[b] ? a : b);
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|Unlicense)$/i;

const TRUSTED_PUBLISHERS = [/(^|[\/@\s])anthropics\/skills(\b|$)/i, /github\.com\/anthropics\//i];
function isTrustedPublisher(p?: VettingInput['provenance']): boolean {
  if (!p) return false;
  return TRUSTED_PUBLISHERS.some((re) => re.test(`${p.repo ?? ''} ${p.author ?? ''}`));
}

// Prompt-injection / instruction-override screen — highest tier, hard reject.
const INJECTION = [
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|preceding|system)\s+(instructions?|prompts?|messages?|context|rules?|directions?)/i,
  /disregard\s+(all\s+|the\s+|any\s+)?(previous|prior|above|system|earlier)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all\s+(previous|prior)|your\s+(instructions?|rules?|guidelines?))/i,
  /ignore\s+your\s+(instructions?|system\s+prompt|guidelines?|training|rules?)/i,
  /override\s+(the\s+)?(system|governance|safety|security|previous\s+instructions?)/i,
  /\bnew\s+instructions?\s*:/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /do\s+not\s+(follow|obey)\s+(the\s+)?(previous|prior|system)/i,
];
function detectInjection(blob: string): boolean { return INJECTION.some((re) => re.test(blob)); }

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
export function fileManifest(files: CapabilityFile[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of files) m[f.path] = sha256(f.content);
  return m;
}
export function diffManifest(recorded: Record<string, string>, currentFiles: CapabilityFile[]): string[] {
  const cur = fileManifest(currentFiles);
  const changed = new Set<string>();
  for (const [p, h] of Object.entries(recorded)) if (cur[p] !== h) changed.add(p);
  for (const p of Object.keys(cur)) if (!(p in recorded)) changed.add(p);
  return [...changed].sort();
}
export function vet(input: VettingInput, opts?: { pinned?: PinnedPublisher[] }): VettingReport {
  const blob = input.files.map((f) => f.content).join('\n');
  const contentHash = hashFiles(input.files);
  const findings: string[] = [];
  const mitigations: string[] = [];
  let tier: RiskTier = 'low';
  let forceHuman = false;
  let destructive = false;

  for (const s of SIGNALS) {
    if (s.re.test(blob)) { findings.push(s.finding); tier = maxT(tier, s.tier); if (s.forceHuman) forceHuman = true; if (s.finding === 'destructive command') destructive = true; }
  }
  if (/\bfetch\s*\(|https?:\/\//i.test(blob) && /child_process|\bexecSync?\b|\bspawn\b|\beval\s*\(|new\s+Function/.test(blob)) {
    tier = 'critical'; forceHuman = true; findings.push('fetch-and-execute at runtime'); mitigations.push('remove runtime fetch+exec; pre-bundle and pin instead');
  }

  // Symlinks are never allowed in a skill tree.
  if (input.hasSymlinks) { findings.push('symlink present in skill tree — not allowed'); tier = maxT(tier, 'critical'); }

  // Prompt-injection / instruction-override → highest tier, hard reject (overrides trust).
  const injection = detectInjection(blob);
  if (injection) { findings.push('prompt-injection: contains instructions to ignore/override prior or system instructions'); tier = 'injection'; }

  const sig = verifyAgainstPinned(contentHash, input.signature, opts?.pinned ?? []);
  const trusted = sig.verified || isTrustedPublisher(input.provenance);
  const p = input.provenance;
  if (!p?.author && !trusted) { findings.push('unknown author'); tier = maxT(tier, 'medium'); mitigations.push('establish provenance / author'); }
  if (p?.license && !PERMISSIVE.test(p.license) && !trusted) { findings.push(`non-permissive license: ${p.license}`); tier = maxT(tier, 'medium'); }
  if (input.dependencies && input.dependencies.length > 0) findings.push(`${input.dependencies.length} dependency(ies) — each inherits the sweep`);

  if (forceHuman && tier === 'low') tier = 'medium';

  // Trusted-publisher adjudication — but NEVER for injection or destructive content.
  if (trusted && !destructive && !injection && !input.hasSymlinks) {
    const who = sig.verified ? `signed:${sig.publisherId}` : `${p?.repo ?? p?.author}`;
    if (tier !== 'low') findings.push(`trusted publisher (${who}) — raw risk ${tier}; adjudicated low (runtime governance still applies)`);
    else findings.push(`trusted publisher (${who})`);
    tier = 'low'; forceHuman = false; mitigations.length = 0;
  }

  const disposition: VettingReport['disposition'] =
    injection ? 'reject' : tier === 'low' && !forceHuman ? 'auto-register' : 'quarantine';
  if (disposition === 'quarantine' && mitigations.length === 0) mitigations.push('restrict allowedAgents; scope paths; pin versions; then re-vet to lower the tier');
  if (disposition === 'reject') mitigations.push('REJECTED — remove instruction-override content; this cannot be approved');

  return {
    id: input.id, kind: input.kind, contentHash, manifest: fileManifest(input.files),
    findings: findings.length ? findings : ['no risk signals detected'],
    riskTier: tier, disposition, injection, forceHuman, mitigations, at: new Date().toISOString(),
  };
}

export function renderReport(r: VettingReport): string {
  return [`# Vetting report — ${r.id} (${r.kind})`, `risk: ${r.riskTier} · disposition: ${r.disposition}` + (r.forceHuman ? ' · human review forced' : ''),
    `hash: ${r.contentHash}`, '', '## findings', ...r.findings.map((f) => `- ${f}`),
    ...(r.mitigations.length ? ['', '## recommended mitigations', ...r.mitigations.map((m) => `- ${m}`)] : [])].join('\n');
}

interface CapabilityEntry { id: string; kind: string; riskTier: RiskTier; status: 'enabled' | 'quarantined' | 'rejected'; contentHash: string; manifest?: Record<string, string>; }

export class CapabilityLedger {
  private caps = new Map<string, CapabilityEntry>();
  constructor(private audit: AuditLog) {}

  intake(report: VettingReport): 'registered' | 'quarantined' | 'rejected' {
    if (report.disposition === 'reject' || report.injection) {
      this.caps.set(report.id, { id: report.id, kind: report.kind, riskTier: 'injection', status: 'rejected', contentHash: report.contentHash, manifest: report.manifest });
      this.audit.append({ actor: 'toby', domain: 'governance', action: 'capability:reject', target: report.id, decision: 'deny', riskTier: 'injection', reason: 'prompt-injection / instruction-override content — rejected (highest tier)' });
      return 'rejected';
    }
    const status: CapabilityEntry['status'] = report.disposition === 'auto-register' ? 'enabled' : 'quarantined';
    this.caps.set(report.id, { id: report.id, kind: report.kind, riskTier: report.riskTier, status, contentHash: report.contentHash, manifest: report.manifest });
    this.audit.append({ actor: 'toby', domain: 'governance', action: status === 'enabled' ? 'capability:register' : 'capability:quarantine', target: report.id, decision: status === 'enabled' ? 'allow' : 'deny', reason: `tier=${report.riskTier}` });
    return status === 'enabled' ? 'registered' : 'quarantined';
  }

  approve(id: string, by: string): void {
    const c = this.caps.get(id);
    if (!c || c.status === 'rejected') return;   // a rejected (injection) capability can NEVER be enabled
    c.status = 'enabled';
    this.audit.append({ actor: by, domain: 'governance', action: 'capability:approve', target: id, decision: 'allow', reason: 'human consent' });
  }

  /** Force a capability to quarantined (e.g. symlink detected, runtime tamper). */
  quarantine(id: string, reason: string): void {
    const c = this.caps.get(id);
    if (!c || c.status === 'rejected') return;
    c.status = 'quarantined';
    this.audit.append({ actor: 'system', domain: 'governance', action: 'capability:quarantine', target: id, decision: 'deny', riskTier: 'critical', reason });
  }

  snapshot(): CapabilityEntry[] { return [...this.caps.values()]; }
  restore(arr: CapabilityEntry[]): void { this.caps = new Map(arr.map((c) => [c.id, c])); }
  isEnabled(id: string): boolean { return this.caps.get(id)?.status === 'enabled'; }
  get(id: string): CapabilityEntry | undefined { return this.caps.get(id); }

  verify(id: string, currentFiles: CapabilityFile[]): { ok: boolean; reason?: string } {
    const c = this.caps.get(id);
    if (!c) return { ok: false, reason: 'capability not registered' };
    if (hashFiles(currentFiles) !== c.contentHash) {
      this.audit.append({ actor: 'system', domain: 'governance', action: 'capability:hash-mismatch', target: id, decision: 'deny', reason: 'content drifted since vetting — re-vet required' });
      return { ok: false, reason: 'hash mismatch — re-vet required' };
    }
    return { ok: true };
  }

  enforceIntegrity(id: string, currentFiles: CapabilityFile[]): { ok: boolean; changed?: string[]; reason?: string } {
    const c = this.caps.get(id);
    if (!c) return { ok: false, reason: 'capability not registered' };
    if (c.status === 'rejected') return { ok: false, reason: 'capability rejected' };
    if (!c.manifest) return { ok: true };
    const changed = diffManifest(c.manifest, currentFiles);
    if (changed.length === 0) return { ok: true };
    c.status = 'quarantined';
    this.audit.append({ actor: 'system', domain: 'governance', action: 'capability:tamper', target: id, decision: 'deny', riskTier: 'critical', reason: `integrity violation — ${changed.length} file(s) modified since vetting; auto-quarantined`, detail: { changed } });
    return { ok: false, changed, reason: 'integrity violation — auto-quarantined' };
  }
}
