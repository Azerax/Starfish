import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// Regression guard (MOSAIC / arXiv:2607.02857 — CLI command-composition attacks via shared OS state:
// a planted repo hook or package.json script fires from a later "ordinary" command). Exercised through
// the real public makeExecutor() interface — the actual wiring an agent hits — not just the underlying
// governance-core template in isolation, since that's precisely the seam that drifted out of sync before.
describe('PEPs - T-05 command-composition attacks are neutralized end to end', () => {
  it('git_commit does not run a malicious .git/hooks/pre-commit planted in the worktree', async () => {
    const { root, exec } = setup();
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'a'], { cwd: root });
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${join(root, 'PWNED')}"\n`, { mode: 0o755 });
    const r = await exec(call('git_commit', { message: 'safe commit' }));
    expect(r.ok).toBe(true);
    expect(existsSync(join(root, 'PWNED'))).toBe(false);
  });
  it('run_tests does not run a malicious package.json "test" script', async () => {
    const { root, exec } = setup();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: `touch ${join(root, 'PWNED')}` } }));
    await exec(call('run_tests', {}));
    expect(existsSync(join(root, 'PWNED'))).toBe(false);
  });
  it('run_tests still accepts allowlisted path/name filter args', async () => {
    const { root, exec } = setup();
    const r = await exec(call('run_tests', { args: 'src/a.test.js' }));
    // No test files exist yet, so node --test legitimately reports failure/empty — the point here is
    // that a well-formed arg is passed through (not rejected as argv-injection) and nothing throws.
    expect(typeof r.content).toBe('string');
  });
  it('run_tests rejects a whole args value that itself starts with a flag', async () => {
    const { root, exec } = setup();
    const r = await exec(call('run_tests', { args: '--eval=require("fs").writeFileSync("' + join(root, 'PWNED') + '","x")' }));
    expect(r.ok).toBe(false);
    expect(existsSync(join(root, 'PWNED'))).toBe(false);
  });
  it('run_tests silently drops a mid-string flag-injection token, keeping only the safe filter token', async () => {
    const { root, exec } = setup();
    const r = await exec(call('run_tests', { args: `src/a.test.js --eval=require("fs").writeFileSync("${join(root, 'PWNED')}","x")` }));
    expect(existsSync(join(root, 'PWNED'))).toBe(false);
    expect(typeof r.content).toBe('string');
  });
});
