import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessDeletion, governedDelete, PDP, Registry, AuditLog, RiskEngine, PolicyEngine,
  type FsProbe, type DeletionConfig, type ToolDef, type AgentDef, type BoundarySet, type DeleteOps, type ToolCall,
} from './index';

const CFG: DeletionConfig = { projectRoot: '/proj', homeDir: '/home/scott' };
function probeOf(map: Record<string, { dir?: boolean; files?: number; bytes?: number }>): FsProbe {
  const n = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return {
    exists: (p) => n(p) in map,
    isDirectory: (p) => !!map[n(p)]?.dir,
    measure: (p, cap) => { const e = map[n(p)] ?? {}; const files = e.files ?? 1; return { files: Math.min(files, cap), bytes: e.bytes ?? 0, truncated: files > cap }; },
  };
}

describe('assessDeletion — deterministic blast-radius + HARD RULES', () => {
  it('a single workspace file is low and allowed (still reversible)', () => {
    const r = assessDeletion({ path: '/proj/src/a.txt' }, CFG, probeOf({ '/proj/src/a.txt': { files: 1, bytes: 12 } }));
    expect(r.tier).toBe('low'); expect(r.decision).toBe('allow'); expect(r.hard).toBe(false); expect(r.reversible).toBe(true);
  });
  it('HARD RULE: no folders — any directory is hard-denied', () => {
    const r = assessDeletion({ path: '/proj/build' }, CFG, probeOf({ '/proj/build': { dir: true, files: 6 } }));
    expect(r.hard).toBe(true); expect(r.decision).toBe('deny'); expect(r.reasons.join(' ')).toMatch(/folders cannot be deleted/);
  });
  it('HARD RULE: no system files — paths under OS trees are hard-denied', () => {
    for (const p of ['/', '/etc', '/etc/passwd', '/usr/bin/node', 'C:\\Windows\\System32\\x.dll']) {
      const r = assessDeletion({ path: p }, CFG, probeOf({ [p.replace(/\\/g, '/').replace(/\/+$/, '') || '/']: { files: 1 } }));
      expect(r.decision, p).toBe('deny'); expect(r.hard, p).toBe(true);
    }
  });
  it('HARD RULE: no skills — Toby retires them, never file-deleted', () => {
    const r = assessDeletion({ path: '/proj/.starfish/skills/docx/SKILL.md' }, CFG, probeOf({ '/proj/.starfish/skills/docx/SKILL.md': { files: 1 } }));
    expect(r.hard).toBe(true); expect(r.decision).toBe('deny'); expect(r.reasons.join(' ')).toMatch(/RETIRED by Toby/);
  });
  it('project root, .git, .starfish, and home are hard-denied', () => {
    for (const p of ['/proj', '/proj/.git/config', '/proj/.starfish/audit.jsonl', '/home/scott']) {
      const r = assessDeletion({ path: p }, CFG, probeOf({ [p]: { files: 1 } }));
      expect(r.decision, p).toBe('deny'); expect(r.hard, p).toBe(true);
    }
  });
  it('a large file is high and ASKS (recoverable, but needs approval)', () => {
    const r = assessDeletion({ path: '/proj/big.bin' }, CFG, probeOf({ '/proj/big.bin': { files: 1, bytes: 9e9 } }));
    expect(r.tier).toBe('high'); expect(r.decision).toBe('ask'); expect(r.hard).toBe(false);
  });
  it('a non-existent target is a low no-op', () => {
    const r = assessDeletion({ path: '/proj/ghost.txt' }, CFG, probeOf({}));
    expect(r.exists).toBe(false); expect(r.decision).toBe('allow'); expect(r.reasons.join(' ')).toMatch(/no-op/);
  });
  it('a delete outside the write boundary is denied', () => {
    const ws = mkdtempSync(join(tmpdir(), 'sf-del-ws-'));
    const bs: BoundarySet = { visibility: [ws], write: [ws] };
    const r = assessDeletion({ path: join(tmpdir(), 'elsewhere.txt') }, { ...CFG, projectRoot: ws }, probeOf({ [join(tmpdir(), 'elsewhere.txt').replace(/\\/g, '/')]: { files: 1 } }), bs);
    expect(r.decision).toBe('deny');
  });
});

describe('governedDelete — soft-delete (recoverable), gated by hard rules', () => {
  const BS: BoundarySet = { visibility: ['/'], write: ['/'] };
  function harness() {
    const dir = mkdtempSync(join(tmpdir(), 'sf-gdel-'));
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.delete', category: 'write', pathParams: ['path'], allowedAgents: '*' }] as ToolDef[]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'custodian' }, { id: 'worker' }] as AgentDef[]));
    const audit = new AuditLog(join(dir, 'audit.jsonl'));
    const pdp = new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id),
      audit, new RiskEngine(), new PolicyEngine([{ id: 'p', subject: '*', action: 'tool:fs.delete', resource: '*', effect: 'allow' }] as never));
    const moved: string[] = [];
    const ops: DeleteOps = { moveToTrash: (p) => { moved.push(p); return `${dir}/trash/${p.split('/').pop()}`; } };
    const probe = probeOf({ '/proj/src/a.txt': { files: 1 }, '/proj/build': { dir: true, files: 8 }, '/proj/big.bin': { files: 1, bytes: 9e9 }, '/proj/.starfish/skills/x/SKILL.md': { files: 1 } });
    const cfg: DeletionConfig = { projectRoot: '/proj', homeDir: '/home/scott' };
    const auditPath = join(dir, 'audit.jsonl');
    const del = (call: ToolCall, approved = false) => governedDelete(pdp, call, BS, { probe, cfg, ops, trashDir: `${dir}/trash`, audit, approved });
    return { del, moved, auditPath };
  }
  const acts = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { action: string }).action);

  it('soft-deletes a low-risk file (moved to trash, not unlinked) + audits', () => {
    const h = harness();
    const r = h.del({ agentId: 'custodian', tool: 'fs.delete', input: { path: '/proj/src/a.txt' } });
    expect(r.ok).toBe(true); expect(r.trashedTo).toBeTruthy(); expect(h.moved).toEqual(['/proj/src/a.txt']);
    expect(acts(h.auditPath)).toEqual(expect.arrayContaining(['delete-assessed', 'delete-soft']));
  });
  it('HARD-DENIES a folder delete and never touches the filesystem', () => {
    const h = harness();
    const r = h.del({ agentId: 'custodian', tool: 'fs.delete', input: { path: '/proj/build' } });
    expect(r.ok).toBe(false); expect(r.impact.hard).toBe(true); expect(h.moved).toEqual([]);
    expect(acts(h.auditPath)).toContain('delete-blocked');
  });
  it('HARD-DENIES a skill delete (even when approved — un-overridable)', () => {
    const h = harness();
    const r = h.del({ agentId: 'worker', tool: 'fs.delete', input: { path: '/proj/.starfish/skills/x/SKILL.md' } }, true);
    expect(r.ok).toBe(false); expect(r.impact.hard).toBe(true); expect(h.moved).toEqual([]);
  });
  it('WITHHOLDS a large file until approved, then proceeds', () => {
    const h = harness();
    const a = h.del({ agentId: 'custodian', tool: 'fs.delete', input: { path: '/proj/big.bin' } });
    expect(a.ok).toBe(false); expect(a.reason).toMatch(/human approval/); expect(h.moved).toEqual([]);
    const b = h.del({ agentId: 'custodian', tool: 'fs.delete', input: { path: '/proj/big.bin' } }, true);
    expect(b.ok).toBe(true); expect(h.moved).toEqual(['/proj/big.bin']);
  });
});
