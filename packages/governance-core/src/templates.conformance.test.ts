import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTemplate, validateParams } from './templates';

describe('TC-2.3 — command templates cannot execute repo hooks / package scripts', () => {
  it('git_commit does NOT run a malicious .git/hooks/pre-commit', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sf-git-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'a'], { cwd: repo });
    writeFileSync(join(repo, 'f.txt'), 'x');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${join(repo, 'PWNED')}"\n`, { mode: 0o755 });
    runTemplate('git_commit', { message: 'safe commit' }, repo);
    expect(existsSync(join(repo, 'PWNED'))).toBe(false);   // hook bypassed via --no-verify + hooksPath=/dev/null
  });
  it('node_test does NOT run a malicious package.json "test" script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-npm-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: `touch ${join(dir, 'PWNED')}` } }));
    runTemplate('node_test', {}, dir);                     // runs `node --test`, never `npm test`
    expect(existsSync(join(dir, 'PWNED'))).toBe(false);
  });
});

describe('TC-2.4 — argv injection rejected', () => {
  it('rejects an option-injection parameter', () => {
    expect(validateParams({ message: '--upload-pack=evil' }).ok).toBe(false);
    expect(() => runTemplate('git_commit', { message: '--upload-pack=evil' }, tmpdir())).toThrow(/argv-rejected/);
  });
  it('rejects shell metacharacters and leading-dash params', () => {
    expect(validateParams({ x: 'safe; rm -rf /' }).ok).toBe(false);
    expect(validateParams({ x: '-rf' }).ok).toBe(false);
    expect(validateParams({ x: 'a normal commit message' }).ok).toBe(true);
  });
});
