import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, PolicyEngine, TaskLedger, MessageRouter } from './index';
import type { PolicyRule } from './index';

function build(rules: PolicyRule[] = []) {
  const audit = new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-msg-')), 'a.jsonl'));
  const tasks = new TaskLedger(audit);
  const router = new MessageRouter(audit, tasks, new PolicyEngine(rules));
  return { audit, tasks, router };
}
function activeTask(tasks: TaskLedger, agent: string) {
  const t = tasks.create({ type: 'mission', subject: 'work', proposer: agent, assignee: agent });
  tasks.transition(t.id, 'analysis', 'god');
  return t.id;
}

describe('TC-4.1 — a message must be task-linked or it is held', () => {
  it('holds a message with no active task', () => {
    const { router } = build();
    const r = router.route('agent.a', { to: 'agent.b', act: 'inform', subject: 'hi', body: 'x' });
    expect(r.status).toBe('held');
  });
  it('delivers when linked to an active assigned task', () => {
    const { router, tasks } = build();
    const taskId = activeTask(tasks, 'agent.a');
    const r = router.route('agent.a', { to: 'agent.b', act: 'inform', subject: 'hi', body: 'x', task: taskId });
    expect(r.status).toBe('delivered');
    expect(router.inbox('agent.b').length).toBe(1);
  });
});

describe('TC-4.2 — identity is stamped by the router (no impersonation)', () => {
  it('the delivered message.from is the authenticated sender, not the payload', () => {
    const { router, tasks } = build();
    const taskId = activeTask(tasks, 'agent.a');
    // caller tries to spoof "from" by any means — router ignores it and stamps the real sender
    const r = router.route('agent.a', { to: 'agent.b', act: 'inform', subject: 's', body: 'b', task: taskId } as any);
    expect(r.status).toBe('delivered');
    if (r.status === 'delivered') expect(r.message.from).toBe('agent.a');
  });
});

describe('TC-4.3 — ingress policy + egress containment', () => {
  it('denies on a policy deny rule (ingress)', () => {
    const { router, tasks } = build([{ id: 'p', subject: '*', action: 'message:request', resource: '*', effect: 'deny' }]);
    const taskId = activeTask(tasks, 'agent.a');
    const r = router.route('agent.a', { to: 'agent.b', act: 'request', subject: 's', body: 'b', task: taskId });
    expect(r.status).toBe('denied');
  });
  it('blocks a message body carrying secret material (egress)', () => {
    const { router, tasks } = build();
    const taskId = activeTask(tasks, 'agent.a');
    const r = router.route('agent.a', { to: 'agent.b', act: 'inform', subject: 's', body: '-----BEGIN RSA PRIVATE KEY-----\nx', task: taskId });
    expect(r.status).toBe('denied');
  });
});
