import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRegistry, normalizeSource, AuditLog, type SourceRef, type SourceVerifier } from './index';

const reg = (verifier?: SourceVerifier, path?: string) => {
  const p = path ?? join(mkdtempSync(join(tmpdir(), 'sf-src-')), 'a.jsonl');
  const audit = new AuditLog(p);
  return { audit, path: p, r: new SourceRegistry(audit, verifier) };
};
const http = (id: string): SourceRef => ({ kind: 'http', id });
const mcp = (id: string): SourceRef => ({ kind: 'mcp', id });

describe('normalizeSource', () => {
  it('collapses URLs to origin and strips mcp__ prefix', () => {
    expect(normalizeSource(http('https://api.example.com/v1/x?q=1'))).toBe('http:https://api.example.com');
    expect(normalizeSource(http('EXAMPLE.com'))).toBe('http:https://example.com');
    expect(normalizeSource(mcp('mcp__Slack'))).toBe('mcp:slack');
  });
});

describe('SourceRegistry — deny by default', () => {
  it('an unknown source is denied', () => {
    const { r } = reg();
    const d = r.admit(http('https://evil.test'));
    expect(d.allow).toBe(false); expect(d.status).toBe('unknown'); expect(d.reason).toMatch(/deny-by-default/);
  });

  it('plaintext http never auto-verifies (held), and is not admitted until override', () => {
    const { r } = reg();
    const rec = r.verify(http('http://insecure.test'));
    expect(rec.status).toBe('pending');
    expect(r.admit(http('http://insecure.test')).allow).toBe(false);
  });

  it('a custom verifier can auto-admit a known-safe source as low', () => {
    const verifier: SourceVerifier = (ref) => ref.id.includes('safe.test') ? { ok: true, tier: 'low', reasons: ['allowlisted'] } : { ok: false, tier: 'medium', reasons: ['unknown'] };
    const { r } = reg(verifier);
    const rec = r.verify(http('https://safe.test'));
    expect(rec.status).toBe('admitted-verified'); expect(rec.admittedBy).toBe('agent');
    expect(r.admit(http('https://safe.test')).allow).toBe(true);
  });

  it('operator override admits a held source (admission != trust)', () => {
    const { r } = reg();
    r.verify(mcp('mcp__weather'));                 // held
    const rec = r.override(mcp('mcp__weather'), 'operator trusts weather MCP');
    expect(rec.status).toBe('admitted-override'); expect(rec.admittedBy).toBe('operator');
    expect(r.isAdmitted(mcp('mcp__weather'))).toBe(true);
  });

  it('a revoked source is denied and cannot be re-admitted (remote kill)', () => {
    const { r } = reg();
    r.override(http('https://bad.test'));
    r.revoke(http('https://bad.test'), 'on signed blocklist');
    expect(r.admit(http('https://bad.test')).allow).toBe(false);
    expect(() => r.override(http('https://bad.test'))).toThrow(/revoked/);
    expect(r.verify(http('https://bad.test')).status).toBe('revoked');   // verify can't revive it
  });

  it('quarantine blocks until reviewed', () => {
    const { r } = reg();
    r.override(mcp('mcp__x'));
    r.quarantine(mcp('mcp__x'), 'suspicious responses');
    expect(r.admit(mcp('mcp__x')).allow).toBe(false);
  });

  it('admissions and denials are audited', () => {
    const { r, path } = reg();
    r.override(http('https://ok.test'));
    r.revoke(http('https://ko.test'), 'blocklist');
    const actions = readFileSync(path, 'utf8').trim().split('\n').map((l) => (JSON.parse(l) as { action: string }).action);
    expect(actions).toContain('source-admitted-override');
    expect(actions).toContain('source-revoked');
  });

  it('snapshot/restore round-trips admitted sources', () => {
    const { r } = reg();
    r.override(http('https://keep.test'));
    const snap = r.snapshot();
    const { r: r2 } = reg();
    r2.restore(snap);
    expect(r2.isAdmitted(http('https://keep.test'))).toBe(true);
  });
});
