import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine, TaskLedger } from './index';
import type { ToolDef, AgentDef, BoundarySet } from './index';

function build() {
  const d = mkdtempSync(join(tmpdir(), 'sf-tb-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify([{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: ['agent.deckcrew'] }]));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'agent.deckcrew' }]));
  const audit = new AuditLog(join(d, 'audit.jsonl'));
  const tools = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  const tasks = new TaskLedger(audit);
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), new PolicyEngine(), { enforce: true, provider: tasks });
  const bs: BoundarySet = { visibility: ['/'], write: ['/'] };
  return { pdp, tasks, bs };
}

describe('TC-3.2 — no task, no tool (task-bound purpose enforced)', () => {
  it('denies a tool call with no task id', () => {
    const { pdp, bs } = build();
    const d = pdp.decide('ingress', { agentId: 'agent.deckcrew', tool: 'read_file', input: { path: '/tmp/x' } }, bs);
    expect(d.allow).toBe(false); expect(d.reason).toContain('no task, no tool');
  });
  it('denies when the task is not active/assigned to this agent', () => {
    const { pdp, bs } = build();
    const d = pdp.decide('ingress', { agentId: 'agent.deckcrew', tool: 'read_file', input: { path: '/tmp/x' }, taskId: 'ghost' }, bs);
    expect(d.allow).toBe(false);
  });
});

describe('TC-3.8 — PADD still gated: a valid task is necessary AND the gate still runs', () => {
  it('allows a low-risk read when an active assigned task exists', () => {
    const { pdp, tasks, bs } = build();
    const t = tasks.create({ type: 'implementation', subject: 'read a doc', proposer: 'agent.deckcrew', assignee: 'agent.deckcrew' });
    tasks.transition(t.id, 'analysis', 'god');   // now active/executable
    const d = pdp.decide('ingress', { agentId: 'agent.deckcrew', tool: 'read_file', input: { path: '/tmp/x' }, taskId: t.id }, bs);
    expect(d.allow).toBe(true);
  });
  it('a valid task does NOT bypass the gate — unauthorized agent still denied', () => {
    const { pdp, tasks, bs } = build();
    const t = tasks.create({ type: 'implementation', subject: 'x', proposer: 'agent.intruder', assignee: 'agent.intruder' });
    tasks.transition(t.id, 'analysis', 'god');
    const d = pdp.decide('ingress', { agentId: 'agent.intruder', tool: 'read_file', input: { path: '/tmp/x' }, taskId: t.id }, bs);
    expect(d.allow).toBe(false); expect(d.reason).toContain('agent-not-authorized');
  });
});
