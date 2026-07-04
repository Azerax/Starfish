import { describe, it, expect } from 'vitest';
import { request } from 'node:http';
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
      for (const r of results) expect(r.pass, r.name + ': ' + r.detail).toBe(true);
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

describe('sidecar decision status (host skill can learn the outcome)', () => {
  it('pending -> approved is observable via GET /v1/decisions/{id}', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    try {
      const rec = gov.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'st1' });
      const h = (t: string): Record<string, string> => ({ 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer ' + t });
      const s1 = await (await fetch(sc.url + '/v1/decisions/' + rec.id, { headers: h('w') })).json();
      expect(s1.status).toBe('pending');
      await fetch(sc.url + '/v1/decisions/' + rec.id, { method: 'POST', headers: { ...h('o'), 'content-type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }) });
      const s2 = await (await fetch(sc.url + '/v1/decisions/' + rec.id, { headers: h('w') })).json();
      expect(s2.status).toBe('approved');
    } finally { await sc.close(); }
  });
});

describe('sidecar read endpoints (dashboard surface)', () => {
  it('serves audit, budgets, monitor, and audit/verify', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'good', actor: 'worker' }] });
    const h = { 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer good' } as Record<string, string>;
    try {
      expect((await fetch(sc.url + '/v1/audit', { headers: h })).status).toBe(200);
      expect((await fetch(sc.url + '/v1/budgets', { headers: h })).status).toBe(200);
      expect(await (await fetch(sc.url + '/v1/audit/verify', { headers: h })).json()).toHaveProperty('ok', true);
      const mon = await (await fetch(sc.url + '/v1/monitor', { headers: h })).json();
      expect(mon).toHaveProperty('counters');
      expect(mon).toHaveProperty('safeMode');
    } finally { await sc.close(); }
  });
});


function rawStatus(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const r = request({ host: '127.0.0.1', port, path: '/v1/pending', method: 'GET', headers }, (resp) => { resp.resume(); resolve(resp.statusCode ?? 0); });
    r.on('error', () => resolve(0));
    r.end();
  });
}

describe('sidecar input hardening (audit A6, A11, A12)', () => {
  it('rejects an oversized body (413) and a foreign Host header (421)', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'good', actor: 'worker' }] });
    try {
      const big = await fetch(sc.url + '/v1/decide', { method: 'POST', headers: { 'content-type': 'application/json', 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer good' }, body: 'x'.repeat(300000) });
      expect(big.status).toBe(413);
      const badHost = await rawStatus(sc.port, { 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer good', host: 'evil.example' });
      expect(badHost).toBe(421);
    } finally { await sc.close(); }
  });

  it('/v1/decisions allowlists fields, clamps riskTier, and namespaces refId per actor', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    const post = (t: string, decision: Record<string, unknown>) => fetch(sc.url + '/v1/decisions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer ' + t }, body: JSON.stringify({ decision }) });
    try {
      await post('w', { tool: 'fs.write', riskTier: 'bogus', refId: 'r', evilField: 'ignored' });
      let pend = (await (await fetch(sc.url + '/v1/pending', { headers: { 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer w' } })).json()) as Array<{ riskTier: string }>;
      expect(pend.length).toBe(1);
      expect(pend[0].riskTier).toBe('high');   // bogus tier clamped
      await post('o', { tool: 'fs.write', refId: 'r' });   // same client refId, different actor -> no collision
      pend = await (await fetch(sc.url + '/v1/pending', { headers: { 'x-starfish-wire': String(WIRE_VERSION), authorization: 'Bearer w' } })).json();
      expect(pend.length).toBe(2);
    } finally { await sc.close(); }
  });
});
