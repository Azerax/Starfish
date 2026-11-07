import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRegistry, sessionViewsFromSnapshot, readSessionSnapshot, AuditLog, DecisionBroker, loadGovernor, type SessionChange } from './index';

const tmp = () => mkdtempSync(join(tmpdir(), 'sf-sessions-'));
// A controllable clock: every observation is one second after the last unless moved on explicitly.
function clock(start = Date.parse('2026-11-07T12:00:00Z')) {
  let t = start;
  return { now: () => t, tick: (ms = 1000) => { t += ms; }, iso: () => new Date(t).toISOString() };
}

describe('SessionRegistry — state is derived from what was observed', () => {
  it('start -> idle, prompt -> working, ask -> blocked, ran -> working, stop -> done, seen -> idle, end -> ended', () => {
    const c = clock(); const reg = new SessionRegistry({ now: c.now });
    const base = { sessionId: 'S1', agentId: 'worker' };
    expect(reg.observe({ ...base, kind: 'start' }).session.state).toBe('idle');
    c.tick(); expect(reg.observe({ ...base, kind: 'prompt' }).session.state).toBe('working');
    c.tick(); const asked = reg.observe({ ...base, kind: 'tool-pre', tool: 'Bash', toolUseId: 'tu1', verdict: 'ask', target: 'npm publish', riskTier: 'high', reason: 'high-risk calls ask a person', decisionId: 'dec_1' });
    expect(asked.session.state).toBe('blocked');
    expect(asked.session.pendingAsk).toMatchObject({ tool: 'Bash', target: 'npm publish', riskTier: 'high', decisionId: 'dec_1' });
    c.tick(); const ran = reg.observe({ ...base, kind: 'tool-post', tool: 'Bash', toolUseId: 'tu1' });
    expect(ran.settled).toMatchObject({ outcome: 'ran', ask: { decisionId: 'dec_1' } });
    expect(ran.session.state).toBe('working');
    c.tick(); expect(reg.observe({ ...base, kind: 'stop' }).session.state).toBe('done');
    c.tick(); expect(reg.markSeen('S1')?.state).toBe('idle');
    c.tick(); expect(reg.observe({ ...base, kind: 'end' }).session.state).toBe('ended');
    expect(reg.list()).toHaveLength(0);                       // ended sessions are left out by default
    expect(reg.list({ includeEnded: true })).toHaveLength(1);
  });

  it('closes an ask as not-run when the turn stops, a new prompt arrives, or the session ends first', () => {
    for (const kind of ['stop', 'prompt', 'end'] as const) {
      const reg = new SessionRegistry();
      reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Edit', verdict: 'ask', reason: 'r' });
      expect(reg.observe({ sessionId: 'S', agentId: 'worker', kind }).settled?.outcome).toBe('not-run');
    }
  });

  it('closes an ask as superseded when another call arrives with no result for it', () => {
    const reg = new SessionRegistry();
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Edit', toolUseId: 'a', verdict: 'ask', reason: 'r' });
    const next = reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Read', toolUseId: 'b', verdict: 'allow' });
    expect(next.settled?.outcome).toBe('superseded');
    expect(next.session.state).toBe('working');
  });

  it('a PostToolUse for a DIFFERENT call does not count as the ask being approved', () => {
    const reg = new SessionRegistry();
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Bash', toolUseId: 'asked', verdict: 'ask', reason: 'r' });
    expect(reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-post', tool: 'Bash', toolUseId: 'other' }).settled?.outcome).toBe('superseded');
  });

  it('a working session with no events for idleAfterMs reads as idle (a missed Stop degrades, never lies)', () => {
    const c = clock(); const reg = new SessionRegistry({ now: c.now, idleAfterMs: 60_000 });
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'prompt' });
    expect(reg.get('S')?.state).toBe('working');
    c.tick(61_000);
    expect(reg.get('S')?.state).toBe('idle');
  });

  it('counts allowed / asked / denied calls and tracks the call in flight', () => {
    const reg = new SessionRegistry();
    const o = { sessionId: 'S', agentId: 'worker' };
    reg.observe({ ...o, kind: 'tool-pre', tool: 'Read', verdict: 'allow' });
    expect(reg.get('S')?.currentTool).toBe('Read');
    reg.observe({ ...o, kind: 'tool-post', tool: 'Read' });
    expect(reg.get('S')?.currentTool).toBeUndefined();
    reg.observe({ ...o, kind: 'tool-pre', tool: 'Bash', verdict: 'deny' });
    reg.observe({ ...o, kind: 'tool-pre', tool: 'Edit', verdict: 'ask', reason: 'r' });
    expect(reg.get('S')?.counts).toEqual({ allowed: 1, asked: 1, denied: 1 });
  });
});

describe('SessionRegistry — attention order (blocked > done > working > idle)', () => {
  it('orders by state, oldest ask first among blocked, most recent first otherwise', () => {
    const c = clock(); const reg = new SessionRegistry({ now: c.now });
    reg.observe({ sessionId: 'idle', agentId: 'worker', kind: 'start' }); c.tick();
    reg.observe({ sessionId: 'askOld', agentId: 'worker', kind: 'tool-pre', tool: 'Edit', verdict: 'ask', reason: 'r' }); c.tick();
    reg.observe({ sessionId: 'working', agentId: 'worker', kind: 'prompt' }); c.tick();
    reg.observe({ sessionId: 'done', agentId: 'worker', kind: 'prompt' }); c.tick();
    reg.observe({ sessionId: 'done', agentId: 'worker', kind: 'stop' }); c.tick();
    reg.observe({ sessionId: 'askNew', agentId: 'worker', kind: 'tool-pre', tool: 'Bash', verdict: 'ask', reason: 'r' }); c.tick();
    expect(reg.list().map((v) => v.sessionId)).toEqual(['askOld', 'askNew', 'done', 'working', 'idle']);
    expect(reg.nextBlocked()?.sessionId).toBe('askOld');
  });
});

describe('SessionRegistry — change feed, bounds and snapshot', () => {
  it('emits a session change for every observation and an ask-settled change when an ask closes', () => {
    const reg = new SessionRegistry(); const seen: SessionChange[] = [];
    const off = reg.subscribe((ch) => seen.push(ch));
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Edit', verdict: 'ask', reason: 'r' });
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'stop' });
    off();
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'prompt' });
    expect(seen.map((s) => s.type)).toEqual(['session', 'ask-settled', 'session']);
  });

  it('keeps at most maxSessions (oldest evicted) and drops sessions quiet for retainMs, open ask or not', () => {
    const c = clock(); const reg = new SessionRegistry({ now: c.now, maxSessions: 2, retainMs: 60_000 });
    for (const id of ['a', 'b', 'c']) { reg.observe({ sessionId: id, agentId: 'worker', kind: 'start' }); c.tick(); }
    expect(reg.list().map((v) => v.sessionId).sort()).toEqual(['b', 'c']);
    reg.observe({ sessionId: 'b', agentId: 'worker', kind: 'tool-pre', tool: 'Edit', verdict: 'ask', reason: 'r' });
    c.tick(120_000);
    expect(reg.list()).toHaveLength(0);
  });

  it('persists a snapshot another process can read, and restores it on restart', () => {
    const dir = tmp(); const path = join(dir, 'state', 'sessions.json');
    const reg = new SessionRegistry({ persistPath: path });
    reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Bash', verdict: 'ask', target: 'git push', reason: 'r', projectRoot: '/proj', branch: 'main' });
    expect(readSessionSnapshot(path)?.sessions[0]).toMatchObject({ sessionId: 'S', branch: 'main' });
    const views = sessionViewsFromSnapshot(path);
    expect(views[0]).toMatchObject({ sessionId: 'S', state: 'blocked', pendingAsk: { target: 'git push' } });
    const again = new SessionRegistry({ persistPath: path });     // daemon restart
    expect(again.get('S')?.state).toBe('blocked');                 // Claude Code's prompt outlives the daemon
  });

  it('a missing or corrupt snapshot reads as no sessions, never a throw', () => {
    const dir = tmp(); const path = join(dir, 'sessions.json');
    expect(sessionViewsFromSnapshot(path)).toEqual([]);
    writeFileSync(path, '{not json');
    expect(sessionViewsFromSnapshot(path)).toEqual([]);
    expect(() => new SessionRegistry({ persistPath: path })).not.toThrow();
  });

  it('clips oversized fields and refuses an observation without a session or agent id', () => {
    const reg = new SessionRegistry();
    const v = reg.observe({ sessionId: 'S', agentId: 'worker', kind: 'tool-pre', tool: 'Bash', verdict: 'ask', target: 'x'.repeat(5000), reason: 'r' }).session;
    expect(v.pendingAsk!.target!.length).toBeLessThanOrEqual(300);
    expect(() => reg.observe({ sessionId: '', agentId: 'worker', kind: 'start' })).toThrow();
  });
});

describe('DecisionBroker — the claude-code channel is observe-only', () => {
  const setup = () => { const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl')); return { dir, audit, b: new DecisionBroker(audit, join(dir, 'decisions.json')) }; };
  const mirrored = { actor: 'worker', kind: 'tool' as const, tool: 'Bash', target: 'npm publish', riskTier: 'high' as const, reason: 'high-risk', refId: 'S:tu1', channel: 'claude-code' as const, sessionId: 'S' };

  it('a mirrored ask is listed, and its filed audit line names the session and where it is answered', () => {
    const { b, dir } = setup();
    const rec = b.file(mirrored);
    expect(b.list().map((p) => p.id)).toContain(rec.id);
    const line = readFileSync(join(dir, 'a.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.action === 'decision:filed');
    expect(line).toMatchObject({ sessionId: 'S' });
    expect(line.reason).toMatch(/Claude Code's prompt/);
  });

  it('an operator cannot resolve a mirrored ask (it would be audited as an approval that changed nothing)', () => {
    const { b } = setup();
    const rec = b.file(mirrored);
    const r = b.resolve(rec.id, 'approve', 'operator', ['operator']);
    expect(r.ok).toBe(false);
    expect(b.has(rec.id)).toBe(true);
  });

  it('a mirrored ask cannot be awaited', async () => {
    const { b } = setup();
    await expect(b.await(mirrored)).rejects.toThrow(/cannot be awaited/);
  });

  it('settle() closes a mirrored ask with the observed outcome and audits it', () => {
    const { b, dir } = setup();
    const rec = b.file(mirrored);
    expect(b.settle(rec.id, 'ran').ok).toBe(true);
    expect(b.has(rec.id)).toBe(false);
    const settled = readFileSync(join(dir, 'a.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.action === 'decision:settled');
    expect(settled).toMatchObject({ decision: 'allow', sessionId: 'S', detail: { outcome: 'ran', channel: 'claude-code' } });
  });

  it('settle() is refused for an ordinary Starfish decision, so it can never stand in for an operator', () => {
    const { b } = setup();
    const rec = b.file({ actor: 'worker', kind: 'tool', tool: 'git_commit', reason: 'r', refId: 'x' });
    expect(b.settle(rec.id, 'ran').ok).toBe(false);
    expect(b.has(rec.id)).toBe(true);
  });
});

describe('audit — sessionId attribution', () => {
  it('records sessionId when given, omits it when not, and the chain still verifies', () => {
    const dir = tmp(); const audit = new AuditLog(join(dir, 'a.jsonl'));
    audit.append({ actor: 'worker', domain: 'tool', action: 'x', sessionId: 'S1' });
    audit.append({ actor: 'worker', domain: 'tool', action: 'y' });
    audit.append({ actor: 'worker', domain: 'tool', action: 'z', sessionId: 'S'.repeat(500) });
    const lines = readFileSync(join(dir, 'a.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].sessionId).toBe('S1');
    expect('sessionId' in lines[1]).toBe(false);
    expect(lines[2].sessionId.length).toBe(128);
    expect(audit.verify()).toBe(true);
  });

  it('the PDP writes the call\'s sessionId on its decision line', () => {
    const root = tmp(); const gov = join(root, 'governance'); mkdirSync(gov, { recursive: true });
    writeFileSync(join(gov, 'tools.json'), JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' }]));
    writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.read'] }]));
    writeFileSync(join(gov, 'policies.json'), JSON.stringify([{ id: 'p', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' }]));
    const g = loadGovernor(gov, join(root, 'audit.jsonl'));
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.read', input: { path: join(root, 'a.txt') }, sessionId: 'CC-42' }, { visibility: [root], write: [root] });
    expect(d.allow).toBe(true);
    const last = g.audit.recent(1)[0];
    expect(last).toMatchObject({ action: 'ingress:fs.read', sessionId: 'CC-42' });
    expect(g.audit.verify()).toBe(true);
  });
});
