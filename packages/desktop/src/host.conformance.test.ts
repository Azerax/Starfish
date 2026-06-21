import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { createHost, type Host } from './index';

let host: Host | null = null;
afterEach(() => { host?.stop(); host = null; });

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'sf-host-'));
  const gov = join(base, 'gov'); mkdirSync(gov);
  const project = join(base, 'project'); mkdirSync(project);
  writeFileSync(join(project, 'doc.txt'), 'hello');
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: ['agent.deckcrew'] }]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'agent.deckcrew', domain: 'execution' }]));
  return { base, gov, project, audit: join(base, 'audit.jsonl'), state: join(base, 'state'), sock: process.platform === 'win32' ? `\\\\.\\pipe\\sf-host-${process.pid}-${Math.random().toString(36).slice(2)}` : join(base, 's.sock') };
}

/** Send newline-delimited JSON messages to the daemon and collect one response line per message. */
function roundtrip(sock: string, messages: object[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const out: any[] = []; let buf = '';
    const c = connect(sock, () => { for (const m of messages) c.write(JSON.stringify(m) + '\n'); });
    c.on('data', (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) out.push(JSON.parse(line)); if (out.length === messages.length) { c.end(); resolve(out); } }
    });
    c.on('error', reject);
  });
}

describe('Integration — live PDP daemon through the host shell', () => {
  it('fail-closed boot: a missing registry prevents the host from starting', async () => {
    const e = makeEnv();
    await expect(createHost({ governanceDir: join(e.base, 'nope'), auditPath: e.audit, stateDir: e.state, projectRoot: e.project, listenPath: e.sock })).rejects.toThrow();
  });

  it('gates a real socket client: permitted read allowed, unregistered tool denied, out-of-boundary denied', async () => {
    const e = makeEnv();
    host = await createHost({ governanceDir: e.gov, auditPath: e.audit, stateDir: e.state, projectRoot: e.project, listenPath: e.sock });
    const res = await roundtrip(e.sock, [
      { type: 'hello', agentId: 'agent.deckcrew' },
      { hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } },   // in-boundary, allowed
      { hook_event_name: 'PreToolUse', tool_name: 'rm_rf', tool_input: {} },                                          // unregistered
      { hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: '/etc/passwd' } },                 // out of boundary
    ]);
    expect(res[0].ok).toBe(true);
    expect(res[1].permissionDecision).toBe('allow');
    expect(res[2].permissionDecision).toBe('deny');
    expect(res[3].permissionDecision).toBe('deny');
  });

  it('an unidentified connection (no hello) is denied', async () => {
    const e = makeEnv();
    host = await createHost({ governanceDir: e.gov, auditPath: e.audit, stateDir: e.state, projectRoot: e.project, listenPath: e.sock });
    const res = await roundtrip(e.sock, [{ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: {} }]);
    expect(res[0].permissionDecision).toBe('deny');
  });

  it('persists runtime state across a restart', async () => {
    const e = makeEnv();
    host = await createHost({ governanceDir: e.gov, auditPath: e.audit, stateDir: e.state, projectRoot: e.project, listenPath: e.sock });
    const t = host.governor.tasks.create({ type: 'mission', subject: 'persist me', proposer: 'a', assignee: 'a' });
    host.persist(); host.stop();
    const host2 = await createHost({ governanceDir: e.gov, auditPath: join(e.base, 'audit2.jsonl'), stateDir: e.state, projectRoot: e.project, listenPath: join(e.base, 's2.sock') });
    expect(host2.governor.tasks.get(t.id)?.subject).toBe('persist me');
    host2.stop();
  });
});
