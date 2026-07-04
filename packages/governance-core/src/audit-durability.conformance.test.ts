import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';

let dir: string;
const p = () => join(dir, 'audit.log');
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sf-audit-')); });

describe('audit durability (A16/A17)', () => {
  it('heals a torn final line on recover without throwing, and flags integrity', () => {
    const a = new AuditLog(p());
    a.append({ actor: 'x', domain: 'system', action: 'one' });
    a.append({ actor: 'x', domain: 'system', action: 'two' });
    appendFileSync(p(), '{"partial":true, "seq":');   // torn partial line, no newline
    const b = new AuditLog(p());                        // must NOT throw
    expect(b.integrity.ok).toBe(false);
    expect(b.integrity.reason).toContain('torn-tail');
    // healed: the torn bytes are gone and the log verifies + accepts a clean append
    expect(readFileSync(p(), 'utf8')).not.toContain('partial');
    b.append({ actor: 'x', domain: 'system', action: 'three' });
    const p2 = new AuditLog(p());
    expect(p2.verify()).toBe(true);
  });

  it('detects tail truncation via the head anchor (on by default)', () => {
    const a = new AuditLog(p());
    for (let i = 0; i < 5; i++) a.append({ actor: 'x', domain: 'system', action: 'e' + i });
    // truncate the log to its first 2 lines (attacker drops the recent tail) but leave the anchor
    const lines = readFileSync(p(), 'utf8').split('\n').filter(Boolean);
    writeFileSync(p(), lines.slice(0, 2).join('\n') + '\n');
    const b = new AuditLog(p());
    expect(b.integrity.ok).toBe(false);
    expect(b.integrity.reason).toContain('truncated');
    expect(b.verify()).toBe(false);
  });

  it('flags mid-file corruption (not a torn tail) as safe mode', () => {
    const a = new AuditLog(p());
    a.append({ actor: 'x', domain: 'system', action: 'one' });
    a.append({ actor: 'x', domain: 'system', action: 'two' });
    const lines = readFileSync(p(), 'utf8').split('\n').filter(Boolean);
    writeFileSync(p(), 'NOT JSON\n' + lines.join('\n') + '\n');   // bad line in the middle
    const b = new AuditLog(p());
    expect(b.integrity.ok).toBe(false);
    expect(b.integrity.reason).toContain('corrupt');
  });

  it('rotation seals segments and the chain still verifies end to end', () => {
    const a = new AuditLog(p(), { rotateBytes: 300 });
    for (let i = 0; i < 12; i++) a.append({ actor: 'x', domain: 'system', action: 'evt-with-some-length-' + i });
    expect(existsSync(p() + '.segments')).toBe(true);
    expect(a.verify()).toBe(true);
    // a fresh instance recovers head from the last segment + live tail and still verifies
    const b = new AuditLog(p(), { rotateBytes: 300 });
    expect(b.verify()).toBe(true);
    b.append({ actor: 'x', domain: 'system', action: 'after-reboot' });
    expect(new AuditLog(p(), { rotateBytes: 300 }).verify()).toBe(true);
  });
});
