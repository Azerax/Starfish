import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampFile, verifyStamp, stampFiles, verifyStamps } from './index';

function tmpFile(content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'sf-attest-'));
  const p = join(d, 'input.txt');
  writeFileSync(p, content);
  return p;
}

describe('H5 — input re-provenance (TOCTOU / cloud-sync)', () => {
  it('an unchanged file verifies ok', () => {
    const p = tmpFile('hello');
    const stamp = stampFile(p)!;
    expect(verifyStamp(stamp).ok).toBe(true);
  });

  it('a file swapped after picking is caught as changed', () => {
    const p = tmpFile('original');
    const stamp = stampFile(p)!;
    writeFileSync(p, 'attacker-swapped-content');   // TOCTOU swap
    const r = verifyStamp(stamp);
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(true);
    expect(r.reason).toContain('changed');
  });

  it('a deleted file fails closed', () => {
    const stamp = { path: join(tmpdir(), 'sf-does-not-exist-xyz'), hash: 'x', size: 1, mtimeMs: 1 };
    const r = verifyStamp(stamp);
    expect(r.ok).toBe(false);
    expect(r.changed).toBe(true);
  });

  it('verifyStamps returns the first deviation across a set', () => {
    const a = tmpFile('a'); const b = tmpFile('b');
    const stamps = stampFiles([a, b]);
    expect(verifyStamps(stamps).ok).toBe(true);
    writeFileSync(b, 'b-changed');
    const r = verifyStamps(stamps);
    expect(r.ok).toBe(false);
  });
});
