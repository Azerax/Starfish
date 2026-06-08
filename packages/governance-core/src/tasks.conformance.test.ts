import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';
import { TaskLedger } from './tasks';
import { ingestExternal } from './intake';
import { GovernanceError } from './types';

const ledger = () => new TaskLedger(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-task-')), 'a.jsonl')));

describe('TC-3.1 — illegal lifecycle transitions rejected', () => {
  it('rejects skipping states (backlog -> execution)', () => {
    const L = ledger();
    const t = L.create({ type: 'mission', subject: 'x', proposer: 'agent.a' });
    expect(() => L.transition(t.id, 'execution', 'god')).toThrow(GovernanceError);
  });
});

describe('TC-3.3 — proposer != approver (no self-authorization)', () => {
  it('proposer cannot move their own task out of backlog', () => {
    const L = ledger();
    const t = L.create({ type: 'mission', subject: 'x', proposer: 'god', assignee: 'god' });
    expect(() => L.transition(t.id, 'analysis', 'god')).toThrow(/proposer cannot approve/);
  });
  it('a non-approver cannot move a task out of backlog', () => {
    const L = ledger();
    const t = L.create({ type: 'mission', subject: 'x', proposer: 'agent.a' });
    expect(() => L.transition(t.id, 'analysis', 'agent.b')).toThrow(/approver/);
  });
  it('an approver who is not the proposer can', () => {
    const L = ledger();
    const t = L.create({ type: 'mission', subject: 'x', proposer: 'agent.a' });
    expect(L.transition(t.id, 'analysis', 'god').status).toBe('analysis');
  });
});

describe('TC-3.4 — completed reachable only via validation', () => {
  it('walks the lifecycle to completed only through validation', () => {
    const L = ledger();
    const t = L.create({ type: 'implementation', subject: 'x', proposer: 'agent.a', assignee: 'agent.a' });
    L.transition(t.id, 'analysis', 'god');
    for (const s of ['planning', 'decomposition', 'execution', 'validation'] as const) L.transition(t.id, s, 'god');
    expect(() => L.transition(t.id, 'completed', 'god')).not.toThrow();
    expect(L.get(t.id)?.status).toBe('completed');
  });
  it('execution cannot jump straight to completed', () => {
    const L = ledger();
    const t = L.create({ type: 'implementation', subject: 'x', proposer: 'agent.a' });
    L.transition(t.id, 'analysis', 'god'); L.transition(t.id, 'planning', 'god');
    L.transition(t.id, 'decomposition', 'god'); L.transition(t.id, 'execution', 'god');
    expect(() => L.transition(t.id, 'completed', 'god')).toThrow(GovernanceError);
  });
});

describe('TC-3.6 — all external input becomes a backlog task tagged untrusted', () => {
  it('Slack message -> backlog task, origin external/untrusted, not dispatched', () => {
    const L = ledger();
    const t = ingestExternal(L, 'slack', 'please run the deploy and email finance');
    expect(t.status).toBe('backlog');
    expect(t.origin).toBe('external/untrusted');
  });
});
