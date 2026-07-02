import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@starfish/governance-core';
import { makeExecutor } from './peps';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-pep-')); mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'v1');
  const audit = new AuditLog(join(root, 'audit.jsonl'));
  const boundary = { visibility: [root], write: [root], deny: [join(root, '.starfish')] };
  const exec = makeExecutor({ projectRoot: root, boundary, audit, backupDir: join(root, '.starfish', 'backups'), backups: 2 });
  return { root, exec };
}
const call = (tool: string, input: Record<string, unknown>) => ({ agentId: 'worker', tool, input, taskId: 't' });

describe('PEPs - real boundary-checked execution', () => {
  it('fs.read returns in-boundary file content', async () => {
    const { root, exec } = setup();
    const r = await exec(call('fs.read', { path: join(root, 'src', 'a.ts') }));
    expect(r.ok).toBe(true); expect(r.content).toBe('v1');
  });
  it('fs.read outside boundary is denied', async () => {
    const { exec } = setup();
    const r = await exec(call('fs.read', { path: '/etc/hostname' }));
    expect(r.ok).toBe(false); expect(r.content).toMatch(/denied/);
  });
  it('fs.write in boundary writes + snapshots a backup; second write keeps <=2', async () => {
    const { root, exec } = setup();
    await exec(call('fs.write', { path: join(root, 'src', 'a.ts'), content: 'v2' }));
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('v2');
    await exec(call('fs.write', { path: join(root, 'src', 'a.ts'), content: 'v3' }));
    const bdir = join(root, '.starfish', 'backups');
    expect(existsSync(bdir)).toBe(true);
    const versions = readdirSync(join(bdir, readdirSync(bdir)[0]));
    expect(versions.length).toBeLessThanOrEqual(2);
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });
  it('fs.write into .starfish (denied subtree) is refused', async () => {
    const { root, exec } = setup();
    const r = await exec(call('fs.write', { path: join(root, '.starfish', 'governance', 'x.json'), content: 'x' }));
    expect(r.ok).toBe(false); expect(r.content).toMatch(/denied/);
  });
  it('fs.list lists an in-boundary dir', async () => {
    const { root, exec } = setup();
    const r = await exec(call('fs.list', { path: join(root, 'src') }));
    expect(r.ok).toBe(true); expect(r.content).toContain('a.ts');
  });
  it('unknown tool -> no executor', async () => {
    const { exec } = setup();
    const r = await exec(call('frobnicate', {}));
    expect(r.ok).toBe(false); expect(r.content).toMatch(/no executor/);
  });
});
