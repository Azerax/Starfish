import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, PolicyEngine, GovernedMemory } from './index';
import type { PolicyRule } from './index';

const mem = (rules: PolicyRule[] = []) =>
  new GovernedMemory(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-mem-')), 'a.jsonl')), new PolicyEngine(rules));

describe('TC-4.4 — governed memory: nothing becomes knowledge without evidence + governance', () => {
  it('a high-confidence low-stakes claim auto-approves and promotes with provenance', () => {
    const m = mem();
    const e = m.addEvidence({ source: 'user', author: 'scott', statement: 'Scott prefers PowerShell', confidence: 0.96 });
    const c = m.proposeClaim('Scott prefers PowerShell', [e.id], 'agent.a');
    expect(m.evaluateClaim(c.id, 'low')).toBe('approved');
    const ent = m.promote(c.id, { type: 'preference', name: 'shell', properties: { value: 'PowerShell' } });
    expect(ent.provenance.claimId).toBe(c.id);
    expect(ent.provenance.evidence).toContain(e.id);
  });
  it('a low-confidence claim does NOT auto-approve (queued for an approver)', () => {
    const m = mem();
    const e = m.addEvidence({ source: 'observation', author: 'agent.a', statement: 'maybe', confidence: 0.4 });
    const c = m.proposeClaim('uncertain thing', [e.id], 'agent.a');
    expect(m.evaluateClaim(c.id, 'low')).toBe('queued');
    expect(() => m.promote(c.id, { type: 't', name: 'n', properties: {} })).toThrow(); // can't promote unapproved
  });
  it('high-stakes always needs an approver even at high confidence', () => {
    const m = mem();
    const e = m.addEvidence({ source: 'user', author: 'scott', statement: 'x', confidence: 0.99 });
    const c = m.proposeClaim('x', [e.id], 'agent.a');
    expect(m.evaluateClaim(c.id, 'high')).toBe('queued');
    expect(m.evaluateClaim(c.id, 'high', 'human')).toBe('approved');
  });
  it('conflicting evidence weakens a claim below the auto-approve bar', () => {
    const m = mem();
    const e1 = m.addEvidence({ source: 'doc', author: 'a', statement: 'yes', confidence: 0.95 });
    const c = m.proposeClaim('yes', [e1.id], 'a');
    const e2 = m.addEvidence({ source: 'doc', author: 'b', statement: 'no', confidence: 0.8 });
    m.addConflictingEvidence(c.id, e2.id);
    expect(m.evaluateClaim(c.id, 'low')).toBe('queued');   // no longer auto-approves
  });
  it('policy can deny promotion outright', () => {
    const m = mem([{ id: 'p', subject: 'memory', action: 'memory:promote', resource: '*', effect: 'deny' }]);
    const e = m.addEvidence({ source: 'user', author: 'scott', statement: 'x', confidence: 0.99 });
    const c = m.proposeClaim('x', [e.id], 'a');
    expect(m.evaluateClaim(c.id, 'low')).toBe('rejected');
  });
  it('Decision Registry records rationale + provenance', () => {
    const m = mem();
    const e = m.addEvidence({ source: 'meeting', author: 'scott', statement: 'need ACID', confidence: 0.9 });
    const d = m.recordDecision({ decision: 'Use PostgreSQL', reason: 'Need ACID guarantees', alternatives: ['SQLite', 'MongoDB'], status: 'accepted', provenance: { evidence: [e.id] } });
    expect(m.getDecision(d.id)?.reason).toContain('ACID');
  });
});
