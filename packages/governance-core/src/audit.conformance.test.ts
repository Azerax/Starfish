import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'sf-aud-')), 'audit.jsonl');

describe('audit — hash-chained, tamper-evident (S-12 / §4)', () => {
  it('chains and verifies a clean log', () => {
    const a = new AuditLog(tmp());
    a.append({ actor: 'a', domain: 'tool', action: 'x', decision: 'allow' });
    a.append({ actor: 'a', domain: 'governance', action: 'y', decision: 'deny' });
    expect(a.verify()).toBe(true);
  });
  it('detects a tampered line', () => {
    const f = tmp();
    const a = new AuditLog(f);
    a.append({ actor: 'a', domain: 'tool', action: 'x', decision: 'allow' });
    a.append({ actor: 'a', domain: 'tool', action: 'z', decision: 'allow' });
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const ev = JSON.parse(lines[0]); ev.decision = 'deny'; lines[0] = JSON.stringify(ev);
    writeFileSync(f, lines.join('\n') + '\n');
    expect(new AuditLog(f).verify()).toBe(false);
  });
});
