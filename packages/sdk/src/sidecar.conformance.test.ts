import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import type { BoundarySet } from '@starfish/governance-core';
import { createGovernance, makeSidecarRunner, startSidecar, WIRE_VERSION, runScenarioPack } from './index';
import { makeGovernedRoot, tcall, P_READ } from './conformance/testroot';

describe('cross-mode conformance pack: sidecar over HTTP (risks 72, 1, 3, 7, 14)', () => {
  it('upholds every invariant identically over HTTP', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'tk-worker', actor: 'worker' }, { token: 'tk-operator', actor: 'operator' }] });
    const runner = makeSidecarRunner({ url: sc.url, tokens: { worker: 'tk-worker', operator: 'tk-operator' }, close: sc.close });
    const boundary: BoundarySet = { visibility: [root], write: [root] };
    try {
      const results = await runScenarioPack(runner, {
        boundary,
        unknownCall: tcall('mystery', {}),
        inWriteCall: tcall('fs.write', { path: join(root, 'x.txt') }),
        outWriteCall: tcall('fs.write', { path: resolve(root, '..', 'evil.txt') }),
        readCall: tcall('fs.read', { path: join(root, 'x.txt') }),
        sampleDecision: { actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'sc1' },
      });
      for (const r of results) expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
    } finally { await sc.close(); }
  });
});

describe('sidecar security (risks 1, 2, 14)', () => {
  it('open health probe; rejects bad token (401) and wire mismatch (426)', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'good', actor: 'worker' }] });
    try {
      expect((await fetch(sc.url + '/v1/health')).status).toBe(200);
      const badTok = await fetch(sc.url + '/v1/pending', { headers: { 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer nope' } });
      expect(badTok.status).toBe(401);
      const badWire = await fetch(sc.url + '/v1/pending', { headers: { 'x-starfish-wire': '999', authorization: 'Bearer good' } });
      expect(badWire.status).toBe(426);
    } finally { await sc.close(); }
  });
});
