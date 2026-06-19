// Deletion impact gate — "no agent deleted my whole drive." EVERY delete (user OR agent) is assessed
// for blast radius + protected targets, deterministically, BEFORE anything is removed; the sanctioned
// path is SOFT (move-to-trash, recoverable), never a permanent unlink.
//
// HARD RULES (operator-set, NOT overridable by approval):
//   1. No system files — anything under an OS/drive/home tree can never be deleted.
//   2. No skills      — skill artifacts are RETIRED by Toby via the registry, not file-deleted.
//   3. No folders     — directories are never deletable; cleanup is file-level only.
//   + protected trees (.git, .starfish) and the project root / above are hard-denied.
// Everything else: a single file. Low (small) -> allow; large (> caps) -> ask (human). All soft +
// audited. Bulk/file cleanup is the job of the Custodian agent (policy-gated), still bound by all of
// the above — the Custodian is accountable cleanup, never an exception to the hard rules.
import { containCheck } from './boundary';
import { isSecretPath, classifyPath } from './secrets';
import type { RiskTier, ToolCall, BoundarySet } from './types';
import type { PDP } from './pdp';
import type { AuditLog } from './audit';

export interface DeletionTarget { path: string; recursive?: boolean; }
export interface FsProbe {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  measure(path: string, cap: number): { files: number; bytes: number; truncated: boolean };
}
export interface DeletionConfig {
  projectRoot: string;
  homeDir?: string;
  skillsRoot?: string;         // skills tree (default: <root>/.starfish/skills + <root>/skills)
  protectedTrees?: string[];   // extra no-delete subtrees
  protectedRoots?: string[];   // extra no-delete-at-or-above roots
  systemTrees?: string[];      // extra OS trees to forbid
  secretGatekeeper?: string;   // only this agent may remove a secret file (.env/credentials) — like Toby for skills
  maxFiles?: number;           // above => high (default 1000)
  maxBytes?: number;           // above => high (default 500 MB)
  fileCap?: number;            // measure cap (default 5000)
}
export interface DeletionImpact {
  tier: RiskTier; decision: 'allow' | 'ask' | 'deny'; hard: boolean; reversible: boolean;
  files: number; bytes: number; truncated: boolean;
  isDirectory: boolean; exists: boolean;
  protectedHits: string[]; reasons: string[];
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
const atOrAbove = (target: string, p: string): boolean => target === p || p.startsWith(target + '/');
const overlaps = (target: string, p: string): boolean => target === p || target.startsWith(p + '/') || p.startsWith(target + '/');
const SYSTEM_ROOT = /^(\/|[A-Za-z]:|[A-Za-z]:\/)$/;
const DEFAULT_SYSTEM_TREES = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev', '/proc', '/sys', '/var', '/opt', '/srv', '/root', 'C:/Windows', 'C:/Program Files', 'C:/Program Files (x86)', 'C:/ProgramData'];

export function defaultProtected(cfg: DeletionConfig): { systemTrees: string[]; skillTrees: string[]; protectedTrees: string[]; protectedRoots: string[] } {
  const root = norm(cfg.projectRoot);
  return {
    systemTrees: [...DEFAULT_SYSTEM_TREES.map(norm), ...(cfg.systemTrees ?? []).map(norm)],
    skillTrees: cfg.skillsRoot ? [norm(cfg.skillsRoot)] : [`${root}/.starfish/skills`, `${root}/skills`],
    protectedTrees: [`${root}/.git`, `${root}/.starfish`, ...(cfg.protectedTrees ?? []).map(norm)],
    protectedRoots: [root, ...(cfg.homeDir ? [norm(cfg.homeDir)] : []), ...(cfg.protectedRoots ?? []).map(norm)],
  };
}

/** Deterministically assess what a deletion would cost — and apply the hard rules — before touching anything. */
export function assessDeletion(target: DeletionTarget, cfg: DeletionConfig, probe: FsProbe, bs?: BoundarySet): DeletionImpact {
  const path = norm(target.path);
  const reasons: string[] = []; const protectedHits: string[] = [];
  const P = defaultProtected(cfg);
  const maxFiles = cfg.maxFiles ?? 1000, maxBytes = cfg.maxBytes ?? 500 * 1024 * 1024, cap = cfg.fileCap ?? 5000;

  const exists = probe.exists(path);
  const isDirectory = exists && probe.isDirectory(path);

  // ---- HARD RULES (un-overridable) ----
  let hard = false;
  const hardDeny = (why: string, hit?: string) => { hard = true; reasons.push(why); if (hit) protectedHits.push(hit); };
  if (isDirectory) hardDeny('folders cannot be deleted — file-level cleanup only (use the Custodian)');
  if (SYSTEM_ROOT.test(path)) hardDeny('OS/drive root — never deletable', path);
  for (const t of P.systemTrees) if (overlaps(path, t)) hardDeny(`system file/path — never deletable (${t})`, t);
  for (const t of P.skillTrees) if (overlaps(path, t)) hardDeny('skill artifact — skills are RETIRED by Toby (registry), not deleted', t);
  for (const t of P.protectedTrees) if (overlaps(path, t)) hardDeny(`protected subtree (${t})`, t);
  for (const r of P.protectedRoots) if (atOrAbove(path, r)) hardDeny(`at or above a protected root (${r})`, r);

  // Boundary: a delete outside the write boundary is denied (not "hard", but denied).
  let outside = false;
  if (bs) { const c = containCheck(target.path, 'write', bs); if (!c.allowed) { outside = true; reasons.push(`outside write boundary (${c.reason})`); } }

  if (!exists) reasons.push('target does not exist (no-op)');
  const m = exists && !isDirectory ? probe.measure(target.path, cap) : { files: isDirectory ? 0 : exists ? 1 : 0, bytes: 0, truncated: false };

  // ---- Tier + decision ----
  let tier: RiskTier = 'low';
  if (m.files > maxFiles || m.bytes > maxBytes || m.truncated) { tier = 'high'; reasons.push(`large file (> ${maxFiles} files or > ${maxBytes} bytes)`); }
  if (hard) tier = 'critical';

  let decision: 'allow' | 'ask' | 'deny';
  if (hard || outside) decision = 'deny';
  else if (tier === 'high') decision = 'ask';
  else decision = 'allow';

  return { tier, decision, hard, reversible: true, files: m.files, bytes: m.bytes, truncated: m.truncated, isDirectory, exists, protectedHits, reasons };
}

export interface DeleteOps { moveToTrash(path: string, trashDir: string): string; }
export interface GovernedDeleteDeps { probe: FsProbe; cfg: DeletionConfig; ops: DeleteOps; trashDir: string; audit: AuditLog; approved?: boolean; }
export interface GovernedDeleteResult { ok: boolean; impact: DeletionImpact; trashedTo?: string; reason: string; }

/** The ONE sanctioned delete path: hard-rule + blast-radius gate + PDP gate, then SOFT delete. */
export function governedDelete(pdp: PDP, call: ToolCall, bs: BoundarySet, deps: GovernedDeleteDeps): GovernedDeleteResult {
  const target: DeletionTarget = { path: typeof call.input.path === 'string' ? call.input.path : '', recursive: call.input.recursive === true };
  // secret files (.env / credentials) are removed only by the gatekeeper (Toby), like skills.
  if (isSecretPath(target.path) && call.agentId !== deps.cfg.secretGatekeeper) {
    const impact0 = assessDeletion(target, deps.cfg, deps.probe, bs);
    deps.audit.append({ actor: call.agentId, domain: 'governance', action: 'delete-blocked', target: target.path, decision: 'deny', riskTier: 'critical', reason: `secret-file removal goes through the gatekeeper (${deps.cfg.secretGatekeeper ?? 'unset'}) — ${classifyPath(target.path).why}` });
    return { ok: false, impact: impact0, reason: `secret-file removal goes through the gatekeeper (${deps.cfg.secretGatekeeper ?? 'unset'})` };
  }
  const impact = assessDeletion(target, deps.cfg, deps.probe, bs);
  deps.audit.append({ actor: call.agentId, domain: 'governance', action: 'delete-assessed', target: target.path, riskTier: impact.tier,
    reason: `tier=${impact.tier} hard=${impact.hard} files=${impact.files}${impact.truncated ? '+' : ''} decision=${impact.decision}`, detail: { reasons: impact.reasons, protectedHits: impact.protectedHits } });

  const gate = pdp.decide('ingress', call, bs);   // policy / task-binding / boundary / audit

  if (impact.decision === 'deny' || !gate.allow) {
    const reason = impact.decision === 'deny' ? `${impact.hard ? 'HARD-DENY' : 'blocked'}: ${impact.reasons.join('; ')}` : `blocked by policy: ${gate.reason}`;
    deps.audit.append({ actor: call.agentId, domain: 'governance', action: 'delete-blocked', target: target.path, decision: 'deny', riskTier: impact.tier, reason });
    return { ok: false, impact, reason };
  }
  if (impact.decision === 'ask' && !deps.approved) {
    deps.audit.append({ actor: call.agentId, domain: 'governance', action: 'delete-withheld', target: target.path, decision: 'deny', riskTier: impact.tier, reason: 'requires human approval (proposer != approver)' });
    return { ok: false, impact, reason: `requires human approval — ${impact.tier} impact` };
  }
  if (!impact.exists) return { ok: true, impact, reason: 'no-op (target does not exist)' };

  try {
    const trashedTo = deps.ops.moveToTrash(target.path, deps.trashDir);
    deps.audit.append({ actor: call.agentId, domain: 'tool', action: 'delete-soft', target: target.path, decision: 'allow', riskTier: impact.tier, reason: `moved to trash (recoverable): ${trashedTo}` });
    return { ok: true, impact, trashedTo, reason: 'soft-deleted (recoverable from trash)' };
  } catch (e) {
    deps.audit.append({ actor: call.agentId, domain: 'failure', action: 'delete-error', target: target.path, decision: 'deny', reason: (e as Error).message });
    return { ok: false, impact, reason: `delete-failed: ${(e as Error).message}` };
  }
}
