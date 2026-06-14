import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundaryForAgent, ServiceRegistry, AuditLog, TaskLedger, loadGovernor, persistGovernor, restoreGovernor, containCheck } from './index';

describe('per-agent boundary derivation', () => {
  it('builds visibility/write sets and excludes forbidden (governance) paths', () => {
    const root = '/proj'; const gov = '/proj/.starfish';
    const bs = boundaryForAgent({ projectRoot: root, workspace: '/proj/agents/a/ws', agentDir: '/proj/agents/a', forbid: [gov] });
    expect(bs.write.some((w) => w.includes('/agents/a'))).toBe(true);
    expect([...bs.visibility, ...bs.write].some((r) => r.startsWith(gov))).toBe(false);   // governance never in an agent's set
  });
  it('throws if forbid removes the only writable root (misconfig fails closed)', () => {
    expect(() => boundaryForAgent({ projectRoot: '/p', workspace: '/p/x', agentDir: '/p/x/a', forbid: ['/p/x'] })).toThrow();
  });
});

describe('ServiceRegistry — what is running', () => {
  it('registers, heartbeats, and marks stale services down', () => {
    const s = new ServiceRegistry();
    s.register('router', '0.8.0');
    expect(s.status().find((x) => x.id === 'router')?.status).toBe('up');
    expect(s.status(-1).find((x) => x.id === 'router')?.status).toBe('down');  // any age is "stale" => down
  });
});

describe('persistence — runtime stores survive a restart', () => {
  it('snapshots tasks + capabilities + services and restores them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-st-'));
    const gdir = mkdtempSync(join(tmpdir(), 'sf-g-'));
    writeFileSync(join(gdir, 'tools.json'), '[]'); writeFileSync(join(gdir, 'agents.json'), '[]');
    const g1 = loadGovernor(gdir, join(dir, 'audit.jsonl'));
    const t = g1.tasks.create({ type: 'mission', subject: 'survive me', proposer: 'a', assignee: 'a' });
    persistGovernor(g1, dir);
    const g2 = loadGovernor(gdir, join(dir, 'audit2.jsonl'), { stateDir: dir });   // fresh boot, restore
    expect(g2.tasks.get(t.id)?.subject).toBe('survive me');
  });
});
