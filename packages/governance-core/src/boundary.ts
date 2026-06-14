// Filesystem boundary engine (R&C S-7; threat model T-04). The single containPath()
// used by every transport. Canonicalizes (abs, .., realpath/symlink, then prefix-check)
// against a per-agent boundary set. Denial reasons never echo paths above the root (no leak).
import { existsSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { GovernanceError, type BoundarySet } from './types';

/** Resolve to absolute, collapse '..', and realpath the existing prefix (follows symlinks),
 *  re-appending any not-yet-existing tail (so writes to new files are still checked). */
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

/** Any symlink component AT OR BELOW the matched root is rejected (defense-in-depth, T-04). */
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

export function containCheck(path: string, mode: 'read' | 'write', bs: BoundarySet): { allowed: boolean; reason: string } {
  const roots = (mode === 'write' ? bs.write : bs.visibility).map((r) => (existsSync(r) ? realpathSync(r) : resolve(r)));
  let canon: string;
  try { canon = canonical(path); } catch { return { allowed: false, reason: 'canonicalization-failed' }; }
  const root = roots.find((rr) => { const withSep = rr.endsWith(sep) ? rr : rr + sep; return canon === rr || canon.startsWith(withSep); });
  if (!root) return { allowed: false, reason: `outside ${mode} boundary` };       // no path leak
  if (symlinkBelowRoot(path, root)) return { allowed: false, reason: 'symlink-component-rejected' };
  return { allowed: true, reason: 'within boundary' };
}

/** Build a safe per-agent boundary set. Any root that falls inside a `forbid` path
 *  (e.g. the governance dir or audit log) is dropped — governance state is never in an
 *  agent's visibility/write set by construction. */
export interface AgentBoundarySpec { projectRoot: string; workspace: string; agentDir: string; sharedReads?: string[]; forbid?: string[]; }
export function boundaryForAgent(spec: AgentBoundarySpec): BoundarySet {
  const forbid = (spec.forbid ?? []).map((f) => resolve(f));
  const inForbid = (p: string) => { const pp = resolve(p); return forbid.some((f) => pp === f || pp.startsWith(f + sep)); };
  const visibility = [spec.projectRoot, spec.agentDir, ...(spec.sharedReads ?? [])].filter((r) => !inForbid(r));
  const write = [spec.workspace, spec.agentDir].filter((r) => !inForbid(r));
  if (write.length === 0) throw new GovernanceError('boundaryForAgent: no writable root after applying forbid list');
  return { visibility, write };
}

// ---- Per-skill confinement (each skill gets a UNIQUE workspace) ----
// Layout per skill: <skillsRoot>/<id>/source (vetted, READ-ONLY) and <skillsRoot>/<id>/workspace
// (writable scratch). visibility = [source, workspace]; write = [workspace] only. Every other
// skill's dir, the governance dir, audit, and state are absent from the set, so they are invisible.
export function skillWorkspaceLayout(skillsRoot: string, skillId: string): { source: string; workspace: string } {
  return { source: join(skillsRoot, skillId, 'source'), workspace: join(skillsRoot, skillId, 'workspace') };
}
export interface SkillBoundarySpec { skillsRoot: string; skillId: string; sharedReads?: string[]; forbid?: string[]; }
export function boundaryForSkill(spec: SkillBoundarySpec): BoundarySet {
  const { source, workspace } = skillWorkspaceLayout(spec.skillsRoot, spec.skillId);
  const forbid = (spec.forbid ?? []).map((f) => resolve(f));
  const inForbid = (p: string) => { const pp = resolve(p); return forbid.some((f) => pp === f || pp.startsWith(f + sep)); };
  const visibility = [source, workspace, ...(spec.sharedReads ?? [])].filter((r) => !inForbid(r));
  const write = [workspace].filter((r) => !inForbid(r));     // source stays read-only; can't self-modify
  if (write.length === 0) throw new GovernanceError('boundaryForSkill: workspace is forbidden — cannot derive a writable root');
  return { visibility, write };
}
