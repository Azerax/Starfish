// Self-integrity — the system verifies ITSELF the same way it verifies skills. The governance config
// (tools/agents/policies) and runtime STATE (capabilities ledger, services, tasks) are otherwise
// trusted unconditionally: anyone who can edit `.starfish/` could flip a quarantined skill to
// 'enabled', allow-all the policy, or add a malicious tool — bypassing the PDP entirely.
//
// Defence: an OPERATOR-SIGNED manifest (Ed25519) that hashes every governance artifact + a monotonic
// epoch + an audit anchor. Written when the operator persists a trusted state; verified at boot. Any
// mismatch -> fail closed (safe mode). Reuses sha256 + signature.ts (skill signing) pointed inward.
//
// Root of trust: the verifier is handed the EXPECTED operator PUBLIC key out-of-band (OS keychain /
// a key pinned at init) — NOT read from the signed blob — so an attacker can't re-sign with their own
// key. The private key signs; it never lives in the repo, the manifest, or the audit.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sha256 } from './hash';
import { signManifest, verifyPublisherSignature } from './signature';
import type { AuditLog, } from './audit';
import type { AuditEvent } from './types';

export interface AuditAnchor { seq: number; headHash: string; }
export interface SelfManifest {
  version: 1;
  epoch: number;                       // monotonic; older epoch at boot = rollback
  files: Record<string, string>;       // relative artifact path -> sha256(content)
  audit: AuditAnchor;                  // anti-truncation / anti-rollback anchor
  createdAt: string;
}
export interface SignedSelfManifest { manifest: SelfManifest; signature: string; }

/** The standard governance artifacts covered by the manifest (only those that exist). */
export function governanceArtifacts(governanceDir: string, stateDir?: string): { rel: string; abs: string }[] {
  const set: { rel: string; abs: string }[] = [
    { rel: 'governance/tools.json', abs: join(governanceDir, 'tools.json') },
    { rel: 'governance/agents.json', abs: join(governanceDir, 'agents.json') },
    { rel: 'governance/policies.json', abs: join(governanceDir, 'policies.json') },
  ];
  if (stateDir) set.push(
    { rel: 'state/capabilities.json', abs: join(stateDir, 'capabilities.json') },
    { rel: 'state/services.json', abs: join(stateDir, 'services.json') },
    { rel: 'state/tasks.snapshot.json', abs: join(stateDir, 'tasks.snapshot.json') },
  );
  return set.filter((a) => existsSync(a.abs));
}

function hashArtifacts(arts: { rel: string; abs: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of arts) out[a.rel] = sha256(readFileSync(a.abs, 'utf8'));
  return out;
}
/** Canonical (stable-key) hash of the manifest body — what the operator signs. */
export function hashManifest(m: SelfManifest): string {
  const ordered = { version: m.version, epoch: m.epoch, files: Object.fromEntries(Object.keys(m.files).sort().map((k) => [k, m.files[k]])), audit: m.audit, createdAt: m.createdAt };
  return sha256(JSON.stringify(ordered));
}

/** Build + operator-sign a manifest over the current governance config/state/audit head. */
export function buildSelfManifest(opts: { governanceDir: string; stateDir?: string; audit: AuditLog; epoch: number; operatorPrivateKeyPem: string }): SignedSelfManifest {
  const manifest: SelfManifest = {
    version: 1, epoch: opts.epoch,
    files: hashArtifacts(governanceArtifacts(opts.governanceDir, opts.stateDir)),
    audit: opts.audit.head(),
    createdAt: new Date().toISOString(),
  };
  return { manifest, signature: signManifest(hashManifest(manifest), opts.operatorPrivateKeyPem) };
}
export function writeSelfManifest(path: string, signed: SignedSelfManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(signed, null, 2));
}

export interface SelfIntegrityResult { ok: boolean; reason: string; failures: string[]; epoch?: number; }

/** Verify the operator-signed manifest against the live governance dir/state/audit. Fail-closed. */
export function verifySelfIntegrity(opts: {
  governanceDir: string; stateDir?: string; manifestPath: string;
  expectedPublicKeyPem: string; audit: AuditLog; minEpoch?: number;
}): SelfIntegrityResult {
  const failures: string[] = [];
  if (!existsSync(opts.manifestPath)) return { ok: false, reason: 'no self-integrity manifest (unattested)', failures: ['manifest-missing'] };

  let signed: SignedSelfManifest;
  try { signed = JSON.parse(readFileSync(opts.manifestPath, 'utf8')) as SignedSelfManifest; }
  catch (e) { return { ok: false, reason: `manifest unreadable: ${(e as Error).message}`, failures: ['manifest-parse'] }; }
  const m = signed.manifest;

  // 1. operator signature over the manifest (forgery / wrong-key)
  const sig = verifyPublisherSignature(hashManifest(m), signed.signature, opts.expectedPublicKeyPem);
  if (!sig.verified) return { ok: false, reason: `manifest signature invalid (${sig.reason}) — not signed by the operator`, failures: ['signature'] };

  // 2. rollback to an older signed manifest
  if (opts.minEpoch !== undefined && m.epoch < opts.minEpoch) failures.push(`epoch-rollback (manifest ${m.epoch} < expected ${opts.minEpoch})`);

  // 3. config/state file tampering (added, removed, or modified artifact)
  const current = hashArtifacts(governanceArtifacts(opts.governanceDir, opts.stateDir));
  for (const [rel, h] of Object.entries(m.files)) {
    if (current[rel] === undefined) failures.push(`removed:${rel}`);
    else if (current[rel] !== h) failures.push(`modified:${rel}`);
  }
  for (const rel of Object.keys(current)) if (m.files[rel] === undefined) failures.push(`unexpected:${rel}`);

  // 4. audit truncation / rollback (the anchored head must still be present at its seq)
  if (!opts.audit.verify()) failures.push('audit-chain-broken');
  else if (!auditContainsAnchor(opts.manifestPath, m.audit, opts)) failures.push('audit-truncated-or-rolled-back');

  return failures.length === 0
    ? { ok: true, reason: 'self-integrity verified (operator-signed)', failures: [], epoch: m.epoch }
    : { ok: false, reason: `self-integrity FAILED: ${failures.join(', ')}`, failures, epoch: m.epoch };
}

/** The anchored event (by seq) must still exist with the recorded hash; shorter/rewritten log fails. */
function auditContainsAnchor(_manifestPath: string, anchor: AuditAnchor, opts: { audit: AuditLog }): boolean {
  if (anchor.seq < 0) return true;                       // anchored at empty log
  const path = (opts.audit as unknown as { path: string }).path;
  if (!path || !existsSync(path)) return false;
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  for (const ln of lines) {
    const ev = JSON.parse(ln) as AuditEvent;
    if (ev.seq === anchor.seq) return ev.hash === anchor.headHash;
  }
  return false;                                          // anchored event gone => truncated/rolled back
}
