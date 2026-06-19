// External-Source governance (P1) — MCP servers, network destinations, and websites are all
// "external sources": untrusted capabilities, DENIED BY DEFAULT. A source becomes *reachable* only by
// admission — an agent verifies its safety (low-risk auto-admits) OR the operator overrides (Layer-7).
// ADMISSION IS NOT TRUST: an admitted source's returned signals are still treated as risky (tainted) —
// that taint layer is P2 (taint.ts). This module is the registry + admission state machine.
// See docs/EXTERNAL_SOURCE_GOVERNANCE.md.
import { GovernanceError, type RiskTier } from './types';
import type { AuditLog } from './audit';
import { sha256 } from './hash';
import { verifyPublisherSignature } from './signature';

export type SourceKind = 'mcp' | 'http' | 'site';
export interface SourceRef { kind: SourceKind; id: string; }   // mcp:<server> | http(s)://host | site origin
export type SourceStatus = 'unknown' | 'pending' | 'admitted-verified' | 'admitted-override' | 'quarantined' | 'revoked';

export interface SourceRecord {
  ref: SourceRef; key: string; status: SourceStatus; tier: RiskTier;
  reason: string; admittedBy?: 'agent' | 'operator'; at: string;
}
export interface SourceVerification { ok: boolean; tier: RiskTier; reasons: string[] }

/** Normalize any source into a stable registry key. http/site collapse to scheme+host(+port); mcp to server id. */
export function normalizeSource(ref: SourceRef): string {
  if (ref.kind === 'mcp') return `mcp:${ref.id.replace(/^mcp__/, '').trim().toLowerCase()}`;
  try {
    const u = new URL(ref.id.includes('://') ? ref.id : `https://${ref.id}`);
    return `${ref.kind}:${u.protocol}//${u.host}`.toLowerCase();   // origin only — path/query are per-call, not identity
  } catch { return `${ref.kind}:${ref.id.trim().toLowerCase()}`; }
}

/** Default deterministic safety check. Conservative: only clearly-safe sources auto-verify low. The
 *  host can inject a richer verifier (cert inspection, malicious-list lookup, MCP manifest vetting). */
export type SourceVerifier = (ref: SourceRef) => SourceVerification;
export const defaultVerifier: SourceVerifier = (ref) => {
  const reasons: string[] = [];
  const id = ref.id.toLowerCase();
  if (ref.kind !== 'mcp') {
    if (id.startsWith('http://')) { reasons.push('plaintext http (no TLS)'); return { ok: false, tier: 'high', reasons }; }
    if (/^(https:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(id)) reasons.push('loopback');
  }
  // No allowlist/manifest knowledge here -> cannot verify safety -> hold for operator (medium).
  reasons.push('no positive safety signal (needs allowlist/manifest or operator override)');
  return { ok: false, tier: 'medium', reasons };
};

/** The Source Registry — default-deny admission state machine, audited. Mirrors the CapabilityLedger. */
export class SourceRegistry {
  private map = new Map<string, SourceRecord>();
  constructor(private audit?: AuditLog, private verifier: SourceVerifier = defaultVerifier) {}

  status(ref: SourceRef): SourceStatus { return this.map.get(normalizeSource(ref))?.status ?? 'unknown'; }
  get(ref: SourceRef): SourceRecord | undefined { return this.map.get(normalizeSource(ref)); }
  list(): SourceRecord[] { return [...this.map.values()]; }

  private put(ref: SourceRef, status: SourceStatus, tier: RiskTier, reason: string, admittedBy?: 'agent' | 'operator'): SourceRecord {
    const key = normalizeSource(ref);
    const rec: SourceRecord = { ref, key, status, tier, reason, admittedBy, at: new Date().toISOString() };
    this.map.set(key, rec);
    this.audit?.append({ actor: admittedBy === 'operator' ? 'operator' : 'system', domain: 'governance', action: `source-${status}`, target: key, decision: status.startsWith('admitted') ? 'allow' : 'deny', riskTier: tier, reason });
    return rec;
  }

  /** Agent-verified admission: run the verifier. Low + ok -> auto-admit; otherwise HOLD for operator. */
  verify(ref: SourceRef): SourceRecord {
    const cur = this.map.get(normalizeSource(ref));
    if (cur && (cur.status === 'revoked' || cur.status === 'quarantined')) return cur;   // can't auto-revive
    const v = this.verifier(ref);
    if (v.ok && v.tier === 'low') return this.put(ref, 'admitted-verified', 'low', `agent-verified: ${v.reasons.join('; ') || 'safe'}`, 'agent');
    return this.put(ref, 'pending', v.tier, `held for operator: ${v.reasons.join('; ')}`);
  }

  /** Operator override (Layer-7 human authority): admit a source the agent couldn't auto-verify. */
  override(ref: SourceRef, reason = 'operator override'): SourceRecord {
    const cur = this.map.get(normalizeSource(ref));
    if (cur?.status === 'revoked') throw new GovernanceError('source is revoked (remote kill) — cannot override');
    return this.put(ref, 'admitted-override', cur?.tier ?? 'medium', reason, 'operator');
  }

  quarantine(ref: SourceRef, reason: string): SourceRecord { return this.put(ref, 'quarantined', this.get(ref)?.tier ?? 'high', reason); }
  revoke(ref: SourceRef, reason: string): SourceRecord { return this.put(ref, 'revoked', 'critical', reason); }

  /** Admission gate: is this source reachable right now? (Admission != trust — signals stay tainted.) */
  isAdmitted(ref: SourceRef): boolean { const s = this.status(ref); return s === 'admitted-verified' || s === 'admitted-override'; }

  /** Single decision used by the PDP/host before any call to a source. Default-deny. */
  admit(ref: SourceRef): { allow: boolean; status: SourceStatus; reason: string } {
    const s = this.status(ref);
    if (s === 'revoked') return { allow: false, status: s, reason: 'source revoked (remote kill / blocklist)' };
    if (s === 'quarantined') return { allow: false, status: s, reason: 'source quarantined pending review' };
    if (s === 'admitted-verified' || s === 'admitted-override') return { allow: true, status: s, reason: 'admitted (signals tainted)' };
    return { allow: false, status: s, reason: 'source not admitted (deny-by-default) — verify or override first' };
  }

  /** Apply an operator/marketplace-SIGNED blocklist: verify the signature, then revoke every listed
   *  source fleet-wide. Tamper/forgery -> rejected, nothing revoked (fail-safe). */
  applyBlocklist(bl: SignedBlocklist, publicKeyPem: string, reason = 'on signed blocklist'): { ok: boolean; applied: number; reason: string } {
    const v = verifyPublisherSignature(blocklistPayloadHash(bl.keys, bl.issuedAt), bl.signature, publicKeyPem);
    if (!v.verified) { this.audit?.append({ actor: 'system', domain: 'governance', action: 'blocklist-rejected', decision: 'deny', reason: `signature invalid (${v.reason})` }); return { ok: false, applied: 0, reason: `blocklist signature invalid (${v.reason})` }; }
    let applied = 0;
    for (const key of bl.keys) {
      const kind = (key.split(':')[0] as SourceKind) || 'http';
      this.map.set(key, { ref: { kind, id: key }, key, status: 'revoked', tier: 'critical', reason, at: new Date().toISOString() });
      this.audit?.append({ actor: 'system', domain: 'governance', action: 'source-revoked', target: key, decision: 'deny', riskTier: 'critical', reason });
      applied++;
    }
    return { ok: true, applied, reason: `revoked ${applied} source(s) from signed blocklist` };
  }

  /** Restore from a persisted snapshot (e.g. operator-approved sources / a synced revocation list). */
  snapshot(): SourceRecord[] { return this.list(); }
  restore(records: SourceRecord[]): void { for (const r of records) this.map.set(r.key, r); }
}


// ---- P4: signed source blocklist = REMOTE KILL ----
export interface SignedBlocklist { keys: string[]; issuedAt: string; signature: string }
/** Canonical payload an issuer signs (sorted keys + timestamp). */
export function blocklistPayloadHash(keys: string[], issuedAt: string): string {
  return sha256(JSON.stringify({ keys: [...keys].sort(), issuedAt }));
}
