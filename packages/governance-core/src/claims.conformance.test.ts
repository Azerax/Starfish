import { describe, it, expect } from 'vitest';
import { extractClaims, assessClaims, evidenceGate, evidenceFromAudit, EMPTY_EVIDENCE, AuditLog, type TurnEvidence } from './index';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ev = (p: Partial<TurnEvidence>): TurnEvidence => ({ ...EMPTY_EVIDENCE, ...p });

describe('Evidence Gate — extraction', () => {
  it('pulls completion/green/named-test/ran/commit/citation claims', () => {
    const kinds = extractClaims(
      'I created src/auth.ts and committed a1b2c3d4. All tests pass, and test_login passes. I ran pytest. See (Smith, 2021).'
    ).map((c) => c.kind);
    expect(kinds).toContain('completion');
    expect(kinds).toContain('tests-green');
    expect(kinds).toContain('named-test');
    expect(kinds).toContain('ran-action');
    expect(kinds).toContain('commit');
    expect(kinds).toContain('citation');
  });
  it('does not over-fire on vague prose', () => {
    expect(extractClaims('I will look into the tests and maybe refactor things later.')).toEqual([]);
  });
});

describe('Evidence Gate — backed vs unbacked', () => {
  it('completion: backed only if the artifact was actually written', () => {
    expect(evidenceGate('I created src/auth.ts', ev({ artifacts: ['/proj/src/auth.ts'] })).ok).toBe(true);
    const v = evidenceGate('I created src/auth.ts', ev({ artifacts: [] }));
    expect(v.ok).toBe(false); expect(v.findings[0].retryHint).toMatch(/create/i);
  });
  it('tests-green: CONTRADICTED by a recorded failure (blocks)', () => {
    expect(evidenceGate('all tests pass', ev({ suiteGreen: true })).ok).toBe(true);
    expect(evidenceGate('all tests pass', ev({ suiteGreen: true, testsFailed: ['test_x'] })).ok).toBe(false);
    expect(evidenceGate('all tests pass', ev({ suiteGreen: false })).ok).toBe(false);  // no recorded pass
  });
  it('named-test: blocks when that exact test is recorded FAILED', () => {
    expect(evidenceGate('test_login passes', ev({ testsPassed: ['test_login'] })).ok).toBe(true);
    expect(evidenceGate('test_login passes', ev({ testsFailed: ['test_login'] })).ok).toBe(false);
  });
  it('ran-action: fabrication when NO tool call happened this turn', () => {
    expect(evidenceGate('I ran pytest', ev({ anyToolCall: true })).ok).toBe(true);
    expect(evidenceGate('I ran pytest', ev({ anyToolCall: false })).ok).toBe(false);
  });
  it('commit: SHA must match a recorded commit', () => {
    expect(evidenceGate('committed a1b2c3d', ev({ commits: ['a1b2c3d4e5'] })).ok).toBe(true);
    expect(evidenceGate('committed deadbeef', ev({ commits: ['a1b2c3d4e5'] })).ok).toBe(false);
  });
  it('citation: must exist in the citation record', () => {
    expect(evidenceGate('see (Smith, 2021)', ev({ citations: ['Smith, 2021'] })).ok).toBe(true);
    expect(evidenceGate('see (Jones, 1999)', ev({ citations: ['Smith, 2021'] })).ok).toBe(false);
  });
  it('a clean turn with no claims passes', () => {
    expect(evidenceGate('Here is a summary of what I think we should do next.', EMPTY_EVIDENCE).ok).toBe(true);
  });
});

describe('evidenceFromAudit', () => {
  it('derives anyToolCall + written artifacts + commit SHAs from the ledger', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'sf-claims-')), 'a.jsonl');
    const a = new AuditLog(p);
    a.append({ actor: 'worker', domain: 'tool', action: 'ingress:fs.write', target: '/proj/x.ts', decision: 'allow' });
    a.append({ actor: 'worker', domain: 'tool', action: 'ingress:fs.read', target: '/proj/y.ts', decision: 'allow' });
    a.append({ actor: 'worker', domain: 'tool', action: 'ingress:git_commit', decision: 'allow', reason: 'sha a1b2c3d4e5f6' });
    const { readFileSync } = require('node:fs');
    const events = readFileSync(p, 'utf8').trim().split('\n').map((l: string) => JSON.parse(l));
    const e = evidenceFromAudit(events);
    expect(e.anyToolCall).toBe(true);
    expect(e.artifacts).toContain('/proj/x.ts');
    expect(e.artifacts).not.toContain('/proj/y.ts');   // a read is not an artifact
    expect(e.commits).toContain('a1b2c3d4e5f6');
  });
});
