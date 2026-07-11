// Filesystem boundary engine (R&C S-7; threat model T-04). The single containCheck()
// used by every transport. Canonicalizes (abs, .., realpath/symlink, then prefix-check)
// against a per-agent boundary set. Denial reasons never echo paths above the root (no leak).
import { existsSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { GovernanceError, type BoundarySet } from './types';

// Resolve to absolute, collapse '..', and realpath the existing prefix (follows symlinks),
// re-appending any not-yet-existing tail (so writes to new files are still checked).
function canonical(p: string): string {
  const abs = resolve(p);
  let cur = abs;
  const tail: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    tail.unshift(basename(cur));
    cur = parent;
  }
  const real = realpathSync(cur);
  return tail.length ? join(real, ...tail) : real;
}

// Any symlink component AT OR BELOW the matched root is rejected (defense-in-depth, T-04).
function symlinkBelowRoot(path: string, root: string): boolean {
  const abs = resolve(path);
  const start = abs.startsWith(root + sep) || abs === root ? abs : null;
  if (!start) return false;
  const rel = start.slice(root.length).split(sep).filter(Boolean);
  let cur = root;
  for (const part of rel) {
    cur = join(cur, part);
    if (existsSync(cur)) {
      try { if (lstatSync(cur).isSymbolicLink()) return true; } catch { /* ignore */ }
    }
  }
  return false;
}

// Case/Unicode normalization for containment compares. Windows + macOS filesystems are case-INSENSITIVE,
// so a case-varied path (or a denied subtree like .STARFISH) must still match. NFC-normalize too. (audit A1)
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const WINDOWS = process.platform === 'win32';
// On Windows '\' and '/' are equivalent separators, so a mixed-separator path must NOT evade a boundary
// or deny-subtree check. '\' is a legal *filename* character on POSIX, so we only fold it on Windows.
export function caseFold(p: string, insensitive: boolean = CASE_INSENSITIVE): string {
  let n = p.normalize('NFC');
  if (WINDOWS) n = n.replace(/\\/g, '/');
  return insensitive ? n.toLowerCase() : n;
}
// Prefix containment on the normalized form. The separator here is ALWAYS '/': caseFold has mapped
// Windows '\' to '/', and POSIX uses '/'. Using the OS `sep` (a '\' on Windows) was the bug that let
// 'C:\root' fail to contain 'C:/root/x' — a separator-based boundary escape.
export function sameOrUnder(child: string, parent: string, insensitive: boolean = CASE_INSENSITIVE): boolean {
  const c = caseFold(child, insensitive);
  const pa = caseFold(parent, insensitive);
  const withSep = pa.endsWith('/') ? pa : pa + '/';
  return c === pa || c.startsWith(withSep);
}

export function containCheck(path: string, mode: 'read' | 'write', bs: BoundarySet): { allowed: boolean; reason: string } {
  const roots = (mode === 'write' ? bs.write : bs.visibility).map((r) => (existsSync(r) ? realpathSync(r) : resolve(r)));
  let canon: string;
  try { canon = canonical(path); } catch { return { allowed: false, reason: 'canonicalization-failed' }; }
  const root = roots.find((rr) => sameOrUnder(canon, rr));
  if (!root) return { allowed: false, reason: `outside ${mode} boundary` };
  const denied = (bs.deny ?? []).map((r) => (existsSync(r) ? realpathSync(r) : resolve(r)));
  if (denied.some((dd) => sameOrUnder(canon, dd))) {
    return { allowed: false, reason: 'within denied subtree' };
  }
  if (symlinkBelowRoot(path, root)) return { allowed: false, reason: 'symlink-component-rejected' };
  return { allowed: true, reason: 'within boundary' };
}

// Build a safe per-agent boundary set. Any root that falls inside a `forbid` path is dropped -
// governance state is never in an agent's visibility/write set by construction.
export interface AgentBoundarySpec { projectRoot: string; workspace: string; agentDir: string; sharedReads?: string[]; forbid?: string[]; }
export function boundaryForAgent(spec: AgentBoundarySpec): BoundarySet {
  const forbid = (spec.forbid ?? []).map((f) => resolve(f));
  const inForbid = (p: string) => { const pp = resolve(p); return forbid.some((f) => sameOrUnder(pp, f)); };
  const visibility = [spec.projectRoot, spec.agentDir, ...(spec.sharedReads ?? [])].filter((r) => !inForbid(r));
  const write = [spec.workspace, spec.agentDir].filter((r) => !inForbid(r));
  if (write.length === 0) throw new GovernanceError('boundaryForAgent: no writable root after applying forbid list');
  return { visibility, write };
}

// Per-skill confinement: each skill gets a UNIQUE workspace. visibility = [source, workspace];
// write = [workspace] only. Other skills' dirs, governance, audit, and state are absent (invisible).
export function skillWorkspaceLayout(skillsRoot: string, skillId: string): { source: string; workspace: string } {
  return { source: join(skillsRoot, skillId, 'source'), workspace: join(skillsRoot, skillId, 'workspace') };
}
export interface SkillBoundarySpec { skillsRoot: string; skillId: string; sharedReads?: string[]; forbid?: string[]; }
export function boundaryForSkill(spec: SkillBoundarySpec): BoundarySet {
  const { source, workspace } = skillWorkspaceLayout(spec.skillsRoot, spec.skillId);
  const forbid = (spec.forbid ?? []).map((f) => resolve(f));
  const inForbid = (p: string) => { const pp = resolve(p); return forbid.some((f) => sameOrUnder(pp, f)); };
  const visibility = [source, workspace, ...(spec.sharedReads ?? [])].filter((r) => !inForbid(r));
  const write = [workspace].filter((r) => !inForbid(r));
  if (write.length === 0) throw new GovernanceError('boundaryForSkill: workspace is forbidden - cannot derive a writable root');
  return { visibility, write };
}
