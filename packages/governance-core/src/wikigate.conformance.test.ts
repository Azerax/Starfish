// Conformance for the Memory Wiki governance gate. Each block names the attack it refuses, from
// docs/design/MEMORY_WIKI_THREATS.md.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';
import { PolicyEngine, type PolicyRule } from './policy';
import { GovernanceError } from './types';
import { aggregateConfidence, type EvidenceItem } from './confidence';
import { WikiGate, classifyStakes, requiredApprovers, sealApproval, verifyBinding } from './wikigate';

const ALLOW_ALL: PolicyRule[] = [
  { id: 'a1', subject: 'agent:herodotus', action: 'tool:memory.promote', resource: '*', effect: 'allow' },
  { id: 'a2', subject: 'agent:herodotus', action: 'tool:memory.link', resource: '*', effect: 'allow' },
  { id: 'a3', subject: 'agent:herodotus', action: 'tool:memory.restructure', resource: '*', effect: 'allow' },
];

const gate = (rules: PolicyRule[] = ALLOW_ALL) =>
  new WikiGate(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-gate-')), 'a.jsonl')), new PolicyEngine(rules));

const ev = (i: number): EvidenceItem =>
  ({ id: `e${i}`, sourceId: `src${i}`, trust: 'trusted', confidence: 0.96, contentHash: `h${i}` });

const STRONG = aggregateConfidence([ev(1), ev(2), ev(3)]);          // auto-eligible
const WEAK = aggregateConfidence([ev(1)]);                          // one source — never enough

describe('T4 — stakes are deterministic and NOT proposer-settable', () => {
  it('ordinary page creation with a known benign type is low-stakes', () => {
    expect(classifyStakes('page:create', { entityType: 'preference' })).toBe('low');
  });
  it('identity, credential, security-config and decision pages are ALWAYS high-stakes', () => {
    for (const t of ['identity', 'credential', 'secret', 'security-config', 'policy', 'capability', 'decision', 'agent']) {
      expect(classifyStakes('page:create', { entityType: t })).toBe('high');
    }
  });
  it('classification is case- and whitespace-insensitive, so casing cannot dodge review', () => {
    expect(classifyStakes('page:create', { entityType: '  CREDENTIAL ' })).toBe('high');
    expect(classifyStakes('page:create', { entityType: 'Identity' })).toBe('high');
  });
  it('a missing or blank entity type fails CLOSED to high', () => {
    expect(classifyStakes('page:create', {})).toBe('high');
    expect(classifyStakes('page:create', { entityType: '   ' })).toBe('high');
  });
  it('supersede, retire, merge and split are always high-stakes', () => {
    for (const op of ['page:supersede', 'page:retire', 'entity:merge', 'entity:split', 'link:retire'] as const) {
      expect(classifyStakes(op)).toBe('high');
    }
  });
});

describe('T11 — link kinds that steer retrieval are high-stakes', () => {
  it('supports and supersedes edges always require a human', () => {
    expect(classifyStakes('link:create', { linkKind: 'supports' })).toBe('high');
    expect(classifyStakes('link:create', { linkKind: 'supersedes' })).toBe('high');
  });
  it('descriptive edges may auto-approve on strong evidence', () => {
    expect(classifyStakes('link:create', { linkKind: 'part-of' })).toBe('low');
    expect(classifyStakes('link:create', { linkKind: 'depends-on' })).toBe('low');
    expect(classifyStakes('link:create', { linkKind: 'contradicts' })).toBe('low');
  });
  it('a supports edge cannot be auto-approved however good the evidence', () => {
    const v = gate().evaluate({ op: 'link:create', linkKind: 'supports', proposer: 'herodotus', contentHash: 'c', confidence: STRONG });
    expect(v.stakes).toBe('high');
    expect(v.outcome).toBe('queued');
  });
});

describe('the gate fails CLOSED — absence of a policy rule is not consent', () => {
  it('a strong low-stakes write queues when no rule matches', () => {
    const v = gate([]).evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'c', confidence: STRONG });
    expect(v.outcome).toBe('queued');
    expect(v.reason).toContain('absence of a rule is not consent');
  });
  it('an explicit allow plus auto-eligible evidence does auto-approve', () => {
    const v = gate().evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'c', confidence: STRONG });
    expect(v.outcome).toBe('approved');
    expect(v.binding?.approvers).toEqual(['policy']);
  });
  it('weak evidence queues even with an explicit allow', () => {
    const v = gate().evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'c', confidence: WEAK });
    expect(v.outcome).toBe('queued');
  });
  it('policy deny beats everything', () => {
    const deny: PolicyRule[] = [{ id: 'd', subject: '*', action: 'tool:memory.promote', resource: '*', effect: 'deny' }];
    const v = gate(deny).evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'c', confidence: STRONG });
    expect(v.outcome).toBe('rejected');
  });
});

describe('T7 — proposer != approver', () => {
  it('a proposer approving their own write throws', () => {
    expect(() => gate().evaluate({
      op: 'page:supersede', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['herodotus'],
    })).toThrow(GovernanceError);
  });
  it('an identity outside the approver set cannot approve', () => {
    expect(() => gate().evaluate({
      op: 'page:supersede', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['agent.rogue'],
    })).toThrow(GovernanceError);
  });
  it("'system' cannot approve", () => {
    expect(() => gate().evaluate({
      op: 'page:supersede', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['system'],
    })).toThrow(GovernanceError);
  });
  it('a genuine approver approves', () => {
    const v = gate().evaluate({ op: 'page:supersede', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['human'] });
    expect(v.outcome).toBe('approved');
  });
});

describe('T20 — dual control on the highest-stakes restructuring', () => {
  it('merge and split need two DISTINCT approvers', () => {
    expect(requiredApprovers('entity:merge')).toBe(2);
    expect(requiredApprovers('entity:split')).toBe(2);
    expect(requiredApprovers('page:create')).toBe(1);
  });
  it('one approver is not enough to merge two entities', () => {
    const v = gate().evaluate({ op: 'entity:merge', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['human'] });
    expect(v.outcome).toBe('queued');
    expect(v.reason).toContain('1/2');
  });
  it('the same approver listed twice is still one approver', () => {
    const v = gate().evaluate({ op: 'entity:merge', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['human', 'human'] });
    expect(v.outcome).toBe('queued');
  });
  it('two distinct approvers carry the merge', () => {
    const v = gate().evaluate({ op: 'entity:merge', proposer: 'herodotus', contentHash: 'c', confidence: STRONG, approvers: ['human', 'god'] });
    expect(v.outcome).toBe('approved');
    expect(v.binding?.approvers).toHaveLength(2);
  });
});

describe('T9 — approval binds a content hash', () => {
  it('a binding verifies against the content it approved', () => {
    const v = gate().evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'hash-A', confidence: STRONG });
    expect(verifyBinding(v.binding, 'hash-A').ok).toBe(true);
  });
  it('content swapped after approval fails verification', () => {
    const v = gate().evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'hash-A', confidence: STRONG });
    const r = verifyBinding(v.binding, 'hash-B');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('content changed since approval');
  });
  it('a forged binding whose seal does not match is refused', () => {
    const v = gate().evaluate({ op: 'page:create', entityType: 'preference', proposer: 'herodotus', contentHash: 'hash-A', confidence: STRONG });
    const forged = { ...v.binding!, contentHash: 'hash-B' };   // attacker rewrites the bound hash
    const r = verifyBinding(forged, 'hash-B');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('binding tampered');
  });
  it('a missing binding is refused rather than assumed valid', () => {
    expect(verifyBinding(undefined, 'x').ok).toBe(false);
  });
  it('the seal is order-independent over approvers but content-sensitive', () => {
    expect(sealApproval('c', ['a', 'b'], 't')).toBe(sealApproval('c', ['b', 'a'], 't'));
    expect(sealApproval('c', ['a', 'b'], 't')).not.toBe(sealApproval('c2', ['a', 'b'], 't'));
  });
});
