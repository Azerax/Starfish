import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine, TaskLedger, ScopeContractLedger } from './index';
import type { ToolDef, AgentDef, BoundarySet } from './index';

// A PDP wired with an ACTIVE task (so task-binding passes) and an enforced Scope Contract, so these
// tests isolate the non-deviation gate (D1–D4) from the rest of the pipeline.
function build(scope: {
  allowedTools: string[]; pathScope: string[]; allowedCommands?: string[]; budget?: { calls?: number };
}) {
  const d = mkdtempSync(join(tmpdir(), 'sf-scope-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify([
    { id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: ['agent.crew'] },
    { id: 'write_file', category: 'write', pathParams: ['path'], allowedAgents: ['agent.crew'] },
    { id: 'run_cmd', category: 'exec', pathParams: [], allowedAgents: ['agent.crew'] },
  ]));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'agent.crew' }]));
  const audit = new AuditLog(join(d, 'audit.jsonl'));
  const tools = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  const tasks = new TaskLedger(audit);
  const scopes = new ScopeContractLedger(audit);

  const t = tasks.create({ type: 'implementation', subject: 'scoped work', proposer: 'agent.crew', assignee: 'agent.crew' });
  tasks.transition(t.id, 'analysis', 'god'); // active/executable
  scopes.derive({ taskId: t.id, proposer: 'agent.crew', ...scope });

  const pdp = new PDP(
    tools, agents, audit, new RiskEngine(), new PolicyEngine(),
    { enforce: true, provider: tasks }, undefined, undefined, undefined,
    { enforce: true, provider: scopes },
  );
  const bs: BoundarySet = { visibility: ['/'], write: ['/'] };
  return { pdp, tasks, scopes, taskId: t.id, bs };
}

describe('Non-deviation — Scope Contract gate (D1–D4)', () => {
  it('D1: allows an in-scope tool; denies a tool outside the task scope', () => {
    const { pdp, taskId, bs } = build({ allowedTools: ['read_file'], pathScope: ['/tmp'] });
    const ok = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/tmp/x' }, taskId }, bs);
    expect(ok.allow).toBe(true);
    const bad = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'write_file', input: { path: '/tmp/x' }, taskId }, bs);
    expect(bad.allow).toBe(false);
    expect(bad.reason).toContain('D1-tool');
  });

  it('D2: denies a path outside the task pathScope even when the tool is allowed', () => {
    const { pdp, taskId, bs } = build({ allowedTools: ['read_file'], pathScope: ['/tmp/project'] });
    const bad = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/etc/passwd' }, taskId }, bs);
    expect(bad.allow).toBe(false);
    expect(bad.reason).toContain('D2-path');
  });

  it('D3: denies a command the task is not explicitly allowed to run', () => {
    const { pdp, taskId, bs } = build({ allowedTools: ['run_cmd'], pathScope: ['/tmp'], allowedCommands: ['npm run build'] });
    // a listed command clears the scope gate (no D3 deviation); downstream risk/policy may still gate exec — scope is necessary, not sufficient
    const ok = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'run_cmd', input: { command: 'npm run build' }, taskId }, bs);
    expect(ok.reason).not.toContain('D3-command');
    const bad = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'run_cmd', input: { command: 'npm publish' }, taskId }, bs);
    expect(bad.allow).toBe(false);
    expect(bad.reason).toContain('D3-command');
  });

  it('D4: enforces the call budget, denying once exhausted', () => {
    const { pdp, taskId, bs } = build({ allowedTools: ['read_file'], pathScope: ['/tmp'], budget: { calls: 2 } });
    expect(pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/tmp/a' }, taskId }, bs).allow).toBe(true);
    expect(pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/tmp/b' }, taskId }, bs).allow).toBe(true);
    const third = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/tmp/c' }, taskId }, bs);
    expect(third.allow).toBe(false);
    expect(third.reason).toContain('D4-budget');
  });

  it('fail-closed: an enforced scope with no contract for the task denies', () => {
    const { pdp, tasks, bs } = build({ allowedTools: ['read_file'], pathScope: ['/tmp'] });
    const t2 = tasks.create({ type: 'implementation', subject: 'no-contract', proposer: 'agent.crew', assignee: 'agent.crew' });
    tasks.transition(t2.id, 'analysis', 'god');
    const d = pdp.decide('ingress', { agentId: 'agent.crew', tool: 'read_file', input: { path: '/tmp/x' }, taskId: t2.id }, bs);
    expect(d.allow).toBe(false);
    expect(d.reason).toContain('no-scope-contract');
  });
});

describe('Non-deviation — immutability & governed amendment', () => {
  it('attest detects an out-of-band tamper of the sealed contract', () => {
    const { scopes, taskId } = build({ allowedTools: ['read_file'], pathScope: ['/tmp'] });
    expect(scopes.attest(taskId).ok).toBe(true);
    const c = scopes.get(taskId)!;
    c.allowedTools.push('write_file'); // tamper without re-sealing
    expect(scopes.attest(taskId).ok).toBe(false);
  });

  it('amend requires an approver who is not the proposer', () => {
    const { scopes, taskId } = build({ allowedTools: ['read_file'], pathScope: ['/tmp'] });
    // proposer is 'agent.crew' → cannot self-amend
    expect(() => scopes.amend(taskId, { allowedTools: ['read_file', 'write_file'] }, 'agent.crew')).toThrow();
    // a real approver may
    const c = scopes.amend(taskId, { allowedTools: ['read_file', 'write_file'] }, 'god');
    expect(c.allowedTools).toContain('write_file');
    expect(scopes.attest(taskId).ok).toBe(true); // re-sealed
  });
});
