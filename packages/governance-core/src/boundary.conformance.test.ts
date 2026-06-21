import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containCheck } from './boundary';
const CAN_SYMLINK = (() => { try { const d = mkdtempSync(join(tmpdir(), 'sf-symcap-')); symlinkSync(d, join(d, 'l')); return true; } catch { return false; } })();
import type { BoundarySet } from './types';

let base: string, projectRoot: string, workspace: string, bs: BoundarySet;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'sf-bnd-'));
  projectRoot = join(base, 'project'); workspace = join(projectRoot, 'ws');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(projectRoot, 'inside.txt'), 'ok');
  writeFileSync(join(base, 'secret.txt'), 'TOPSECRET');     // ABOVE the project root
  bs = { visibility: [projectRoot], write: [workspace] };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('TC-1.3 — write-escape suite (nothing created above the workspace)', () => {
  it('denies ".." traversal above the workspace', () => {
    expect(containCheck(join(workspace, '..', '..', 'escape.txt'), 'write', bs).allowed).toBe(false);
    expect(existsSync(join(base, 'escape.txt'))).toBe(false);
  });
  it('denies an absolute path above the workspace', () => {
    expect(containCheck(join(base, 'escape.txt'), 'write', bs).allowed).toBe(false);
  });
  it.skipIf(!CAN_SYMLINK)('denies a write through an in-workspace symlink pointing outside', () => {
    symlinkSync(base, join(workspace, 'link'));
    expect(containCheck(join(workspace, 'link', 'escape.txt'), 'write', bs).allowed).toBe(false);
    expect(existsSync(join(base, 'escape.txt'))).toBe(false);
  });
  it('denies writing into the read-only project root (outside the write set)', () => {
    expect(containCheck(join(projectRoot, 'x.txt'), 'write', bs).allowed).toBe(false);
  });
});

describe('TC-1.4 — read-escape suite (denial leaks nothing)', () => {
  it('denies reading above the project root and does not echo the name/contents', () => {
    const r = containCheck(join(projectRoot, '..', 'secret.txt'), 'read', bs);
    expect(r.allowed).toBe(false);
    expect(r.reason).not.toContain('secret');
    expect(r.reason).not.toContain('TOPSECRET');
  });
  it.skipIf(!CAN_SYMLINK)('denies a read via a symlink that escapes the root', () => {
    symlinkSync(base, join(projectRoot, 'up'));
    const r = containCheck(join(projectRoot, 'up', 'secret.txt'), 'read', bs);
    expect(r.allowed).toBe(false);
    expect(r.reason).not.toContain('secret');
  });
});

describe('TC-1.5 — negative control (in-boundary ops succeed)', () => {
  it('allows writing inside the workspace', () => {
    expect(containCheck(join(workspace, 'ok.txt'), 'write', bs).allowed).toBe(true);
  });
  it('allows reading inside the project root', () => {
    expect(containCheck(join(projectRoot, 'inside.txt'), 'read', bs).allowed).toBe(true);
  });
});
