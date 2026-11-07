import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { loadGovernor, SessionRegistry, DecisionBroker, sessionViewsFromSnapshot, type Governor } from '@starfish/governance-core';
import { PdpDaemon, gitBranch, describeTarget, sessionEventKind } from './index';
import { HookSession } from './handler';

// fs.read is allowed outright; fs.write is medium risk with no allow policy, so the PDP answers "ask".
function seed() {
  const root = mkdtempSync(join(tmpdir(), 'sf-sess-'));
  const gov = join(root, 'governance'); mkdirSync(gov, { recursive: true }); mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*', riskTier: 'medium' },
  ]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.read', 'fs.write'] }]));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify([{ id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' }]));
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/feature/sessions\n');
  return { root, gov, audit: join(root, 'audit.jsonl'), snap: join(root, 'state', 'sessions.json') };
}

// one hook call = one connection: hello -> reply -> payload -> reply (mirrors the CLI shim)
function call(sock: string, hello: object, payload: object): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    const c = createConnection(sock); let buf = '', stage = 'hello';
    const to = setTimeout(() => { c.destroy(); rej(new Error('timeout')); }, 3000);
    c.on('connect', () => c.write(JSON.stringify(hello) + '\n'));
    c.on('data', (d) => { buf += d.toString(); let nl;
      while ((nl = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (stage === 'hello') { stage = 'p'; c.write(JSON.stringify(payload) + '\n'); }
        else { clearTimeout(to); c.destroy(); res(m); } } });
    c.on('error', (e) => { clearTimeout(to); rej(e); });
  });
}
const auditLines = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);

describe('PdpDaemon — session tracking (observe-only)', () => {
  let h: ReturnType<typeof seed>; let g: Governor; let daemon: PdpDaemon; let reg: SessionRegistry; let broker: DecisionBroker;
  const sock = process.platform === 'win32' ? `\\\\.\\pipe\\sf-sess-${process.pid}` : join(tmpdir(), `sf-sess-${process.pid}.sock`);
  const hello = { type: 'hello', agentId: 'worker', session_id: 'CC1' };
  const ev = (name: string, extra: object = {}) => call(sock, hello, { hook_event_name: name, session_id: 'CC1', cwd: h.root, ...extra });

  beforeAll(async () => {
    h = seed();
    g = loadGovernor(h.gov, h.audit, { stateDir: join(h.root, 'state') });
    reg = new SessionRegistry({ persistPath: h.snap });
    broker = new DecisionBroker(g.audit);
    daemon = new PdpDaemon(g, () => ({ visibility: [h.root], write: [h.root] }), undefined, { projectRoot: h.root }, { sessions: reg, broker, host: 'test-host' });
    await daemon.listen(sock);
  });
  afterAll(() => daemon.close());

  it('a session walks idle -> working -> blocked -> working -> done, and the snapshot shows it', async () => {
    await ev('SessionStart', { source: 'startup', model: { id: 'claude-test' } });
    expect(reg.get('CC1')).toMatchObject({ state: 'idle', host: 'test-host', branch: 'feature/sessions', model: 'claude-test', projectRoot: h.root });

    await ev('UserPromptSubmit');
    expect(reg.get('CC1')?.state).toBe('working');

    const read = await ev('PreToolUse', { tool_name: 'Read', tool_use_id: 'tu-read', tool_input: { file_path: join(h.root, 'a.txt') } });
    expect(read.permissionDecision).toBe('allow');
    await ev('PostToolUse', { tool_name: 'Read', tool_use_id: 'tu-read', tool_input: { file_path: join(h.root, 'a.txt') } });

    const edit = await ev('PreToolUse', { tool_name: 'Edit', tool_use_id: 'tu-edit', tool_input: { file_path: join(h.root, 'b.txt'), new_string: 'x' } });
    expect(edit.permissionDecision).toBe('ask');
    const blocked = reg.get('CC1')!;
    expect(blocked.state).toBe('blocked');
    expect(blocked.pendingAsk).toMatchObject({ tool: 'Edit', target: join(h.root, 'b.txt'), toolUseId: 'tu-edit' });
    // mirrored into the broker on the claude-code channel, tagged with the session
    const pending = broker.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ channel: 'claude-code', sessionId: 'CC1', tool: 'Edit', id: blocked.pendingAsk!.decisionId });
    // and another process reading the snapshot sees the same thing
    expect(sessionViewsFromSnapshot(h.snap)[0]).toMatchObject({ sessionId: 'CC1', state: 'blocked' });

    // the person approves in Claude Code: the tool runs and its PostToolUse arrives
    const post = await ev('PostToolUse', { tool_name: 'Edit', tool_use_id: 'tu-edit', tool_input: { file_path: join(h.root, 'b.txt') } });
    expect(post.permissionDecision).toBeUndefined();          // NOT flagged as an orphan execution
    expect(reg.get('CC1')?.state).toBe('working');
    expect(broker.list()).toHaveLength(0);

    await ev('Stop');
    expect(reg.get('CC1')?.state).toBe('done');
    expect(reg.get('CC1')?.counts).toEqual({ allowed: 1, asked: 1, denied: 0 });

    const lines = auditLines(h.audit);
    expect(lines.some((l) => String(l.action).startsWith('orphan-post'))).toBe(false);
    expect(lines.find((l) => l.action === 'decision:settled')).toMatchObject({ decision: 'allow', sessionId: 'CC1' });
    // every PDP decision line for this session carries its id
    expect(lines.filter((l) => String(l.action).startsWith('ingress:')).every((l) => l.sessionId === 'CC1')).toBe(true);
  });

  it('an ask refused in Claude Code is settled as not-run when the turn ends', async () => {
    const hello2 = { type: 'hello', agentId: 'worker', session_id: 'CC2' };
    const e2 = (name: string, extra: object = {}) => call(sock, hello2, { hook_event_name: name, session_id: 'CC2', ...extra });
    await e2('UserPromptSubmit');
    expect((await e2('PreToolUse', { tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: join(h.root, 'c.txt'), content: 'x' } })).permissionDecision).toBe('ask');
    await e2('Stop');
    expect(reg.get('CC2')?.state).toBe('done');
    const settled = auditLines(h.audit).filter((l) => l.action === 'decision:settled' && l.sessionId === 'CC2');
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ decision: 'deny', detail: { outcome: 'not-run' } });
  });

  it('the decision returned is identical with or without session tracking', async () => {
    const sock2 = process.platform === 'win32' ? `\\\\.\\pipe\\sf-sess-plain-${process.pid}` : join(tmpdir(), `sf-sess-plain-${process.pid}.sock`);
    const plain = new PdpDaemon(g, () => ({ visibility: [h.root], write: [h.root] }));
    await plain.listen(sock2);
    try {
      const p = { hook_event_name: 'PreToolUse', session_id: 'CC3', tool_name: 'Edit', tool_use_id: 'z', tool_input: { file_path: join(h.root, 'd.txt') } };
      const a = await call(sock2, { type: 'hello', agentId: 'worker', session_id: 'CC3' }, p);
      const b = await call(sock, { type: 'hello', agentId: 'worker', session_id: 'CC4' }, { ...p, session_id: 'CC4' });
      expect(a.permissionDecision).toBe(b.permissionDecision);
      expect(a.reason).toBe(b.reason);
    } finally { plain.close(); }
  });
});

describe('HookSession — a PostToolUse is still an orphan unless it matches an allowed call or the exact asked id', () => {
  it('flags a PostToolUse whose tool_use_id was never asked', () => {
    const h = seed();
    const g = loadGovernor(h.gov, h.audit);
    const s = new HookSession(g, { expectedAgentId: 'worker', boundary: { visibility: [h.root], write: [h.root] } });
    expect(s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'asked', tool_input: { file_path: join(h.root, 'x') } }).permissionDecision).toBe('ask');
    expect(s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'different' }).permissionDecision).toBe('deny');
    expect(s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'asked' }).permissionDecision).toBeUndefined();
    expect(s.handle({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'asked' }).permissionDecision).toBe('deny');   // once only
  });
});

describe('daemon helpers', () => {
  it('maps Claude Code hook events to session events', () => {
    expect(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd', 'Notification'].map(sessionEventKind))
      .toEqual(['start', 'prompt', 'tool-pre', 'tool-post', 'stop', 'end', 'notice']);
  });
  it('reads the branch from .git/HEAD, a linked worktree .git file, and a detached HEAD', () => {
    const h = seed();
    expect(gitBranch(join(h.root, 'deep', 'er'))).toBe('feature/sessions');   // walks up from a subfolder
    const wt = mkdtempSync(join(tmpdir(), 'sf-wt-'));
    const real = join(h.root, '.git', 'worktrees', 'wt'); mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    writeFileSync(join(wt, '.git'), `gitdir: ${real}\n`);
    expect(gitBranch(wt)).toBe('0123456 (detached)');
  });
  it('describes a call by its path, command or url, with secrets redacted', () => {
    expect(describeTarget('Read', { file_path: '/p/a.ts' })).toBe('/p/a.ts');
    expect(describeTarget('WebFetch', { url: 'https://example.com/x' })).toBe('https://example.com/x');
    expect(describeTarget('Bash', { command: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" x' })).not.toMatch(/abcdefghijklmnop/);
  });
});
