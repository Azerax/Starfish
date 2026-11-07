import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SessionRegistry } from '@starfish/governance-core';
import { createGovernance, startSidecar, WIRE_VERSION } from './index';
import { makeGovernedRoot, P_READ } from './conformance/testroot';

// The overlay daemon writes state/sessions.json; the sidecar for the same root reads it.
function rootWithSessions() {
  const root = makeGovernedRoot([P_READ]);
  const reg = new SessionRegistry({ persistPath: join(root, 'state', 'sessions.json') });
  reg.observe({ sessionId: 'W1', agentId: 'worker', kind: 'tool-pre', tool: 'Bash', verdict: 'ask', target: 'npm publish', riskTier: 'high', reason: 'high-risk calls ask a person' });
  reg.observe({ sessionId: 'O1', agentId: 'other', kind: 'prompt' });
  return { root, reg };
}
const h = (t: string): Record<string, string> => ({ 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer ' + t });

async function firstEvent(url: string, token: string, name: string): Promise<unknown> {
  const ac = new AbortController();
  const resp = await fetch(url + '/v1/stream', { headers: h(token), signal: ac.signal });
  const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder(); let buf = '';
  const deadline = Date.now() + 4000;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const m = new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`).exec(buf);
      if (m) return JSON.parse(m[1]);
    }
    throw new Error(`no '${name}' event`);
  } finally { ac.abort(); }
}

describe('sidecar sessions (read from the daemon snapshot, scoped per identity)', () => {
  it('GET /v1/sessions: the operator sees every session, most urgent first; a worker sees only its own', async () => {
    const { root } = rootWithSessions();
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    try {
      const op = await (await fetch(sc.url + '/v1/sessions', { headers: h('o') })).json() as Array<{ sessionId: string; state: string }>;
      expect(op.map((s) => [s.sessionId, s.state])).toEqual([['W1', 'blocked'], ['O1', 'working']]);
      const wk = await (await fetch(sc.url + '/v1/sessions', { headers: h('w') })).json() as Array<{ sessionId: string }>;
      expect(wk.map((s) => s.sessionId)).toEqual(['W1']);
    } finally { await sc.close(); }
  });

  it('the live stream pushes a sessions event', async () => {
    const { root } = rootWithSessions();
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'o', actor: 'operator' }] });
    try {
      const list = await firstEvent(sc.url, 'o', 'sessions') as Array<{ sessionId: string; pendingAsk?: { target?: string } }>;
      expect(list[0]).toMatchObject({ sessionId: 'W1', pendingAsk: { target: 'npm publish' } });
    } finally { await sc.close(); }
  });

  it('a root with no daemon snapshot reports no sessions', async () => {
    const gov = createGovernance({ root: makeGovernedRoot([P_READ]), keyResolver: () => 'sk-test' });
    expect(gov.sessions()).toEqual([]);
  });
});
