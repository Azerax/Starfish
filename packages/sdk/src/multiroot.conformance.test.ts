import { describe, it, expect } from 'vitest';
import { WIRE_VERSION, createGovernance, startMultiSidecar } from './index';
import { makeGovernedRoot, P_READ } from './conformance/testroot';

const h = (t: string): Record<string, string> => ({ 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer ' + t, 'content-type': 'application/json' });

describe('multi-root sidecar isolation (v0.19.0; embed risks #22/#39, A20)', () => {
  it('routes by token->root; one root never sees another root\'s pending/audit', async () => {
    const govA = createGovernance({ root: makeGovernedRoot([P_READ]), keyResolver: () => 'sk-a' });
    const govB = createGovernance({ root: makeGovernedRoot([P_READ]), keyResolver: () => 'sk-b' });
    const sc = await startMultiSidecar({ roots: [
      { id: 'tenantA', governance: govA, identities: [{ token: 'a-w', actor: 'worker' }, { token: 'a-o', actor: 'operator' }], operators: ['operator'] },
      { id: 'tenantB', governance: govB, identities: [{ token: 'b-w', actor: 'worker' }, { token: 'b-o', actor: 'operator' }], operators: ['operator'] },
    ] });
    try {
      const recA = govA.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 'a', riskTier: 'high', reason: 'rA', refId: 'A1' });
      const recB = govB.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 'b', riskTier: 'high', reason: 'rB', refId: 'B1' });

      // Tenant A's operator token sees ONLY tenant A's pending.
      const pendA = await (await fetch(sc.url + '/v1/pending', { headers: h('a-o') })).json();
      expect(pendA.some((p: { id: string }) => p.id === recA.id)).toBe(true);
      expect(pendA.some((p: { id: string }) => p.id === recB.id)).toBe(false);

      // Tenant B cannot resolve tenant A's decision (its broker doesn't know that id).
      const cross = await fetch(sc.url + '/v1/decisions/' + recA.id, { method: 'POST', headers: h('b-o'), body: JSON.stringify({ verdict: 'approve' }) });
      const crossJson = await cross.json();
      expect(crossJson.ok).toBe(false);
      expect(govA.broker.list().some((p) => p.id === recA.id)).toBe(true);   // still pending in A

      // Tenant A's operator resolves A's decision normally.
      const okr = await (await fetch(sc.url + '/v1/decisions/' + recA.id, { method: 'POST', headers: h('a-o'), body: JSON.stringify({ verdict: 'approve' }) })).json();
      expect(okr.ok).toBe(true);
    } finally { await sc.close(); }
  });

  it('operator principal set blocks agent-vs-agent approval (A20)', async () => {
    const gov = createGovernance({ root: makeGovernedRoot([P_READ]), keyResolver: () => 'sk' });
    const sc = await startMultiSidecar({ roots: [
      { id: 't', governance: gov, identities: [{ token: 'w1', actor: 'worker' }, { token: 'w2', actor: 'worker2' }, { token: 'op', actor: 'operator' }], operators: ['operator'] },
    ] });
    try {
      const rec = gov.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'X1' });
      // worker2 is NOT the proposer but is also NOT a designated operator -> must be rejected.
      const byAgent = await (await fetch(sc.url + '/v1/decisions/' + rec.id, { method: 'POST', headers: h('w2'), body: JSON.stringify({ verdict: 'approve' }) })).json();
      expect(byAgent.ok).toBe(false);
      expect(gov.broker.list().some((p) => p.id === rec.id)).toBe(true);
      // the designated operator can.
      const byOp = await (await fetch(sc.url + '/v1/decisions/' + rec.id, { method: 'POST', headers: h('op'), body: JSON.stringify({ verdict: 'approve' }) })).json();
      expect(byOp.ok).toBe(true);
    } finally { await sc.close(); }
  });

  it('rejects a token that belongs to no root (401)', async () => {
    const gov = createGovernance({ root: makeGovernedRoot([P_READ]), keyResolver: () => 'sk' });
    const sc = await startMultiSidecar({ roots: [{ id: 't', governance: gov, identities: [{ token: 'good', actor: 'worker' }] }] });
    try {
      expect((await fetch(sc.url + '/v1/pending', { headers: h('nope') })).status).toBe(401);
    } finally { await sc.close(); }
  });
});
