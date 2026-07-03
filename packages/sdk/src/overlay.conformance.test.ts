import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import type { BoundarySet } from '@starfish/governance-core';
import { createGovernance, makeOverlayRunner, withGovernance, runScenarioPack } from './index';
import { makeGovernedRoot, P_READ } from './conformance/testroot';

describe('cross-mode conformance pack: overlay (risk 72)', () => {
  it('upholds every invariant identically via host-named tools + taxonomy', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const runner = makeOverlayRunner(gov);
    const boundary: BoundarySet = { visibility: [root], write: [root] };
    const results = await runScenarioPack(runner, {
      boundary,
      unknownCall: { agentId: 'worker', tool: 'Frobnicate', input: {} },
      inWriteCall: { agentId: 'worker', tool: 'WriteFile', input: { path: join(root, 'x.txt') } },
      outWriteCall: { agentId: 'worker', tool: 'WriteFile', input: { path: resolve(root, '..', 'evil.txt') } },
      readCall: { agentId: 'worker', tool: 'ReadFile', input: { path: join(root, 'x.txt') } },
      sampleDecision: { actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'ov1' },
    });
    for (const r of results) expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
  });
});

describe('withGovernance middleware', () => {
  it('denies unknown, allows allowed, and executes an ask after resolveAsk', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const boundary: BoundarySet = { visibility: [root], write: [root] };
    const ran: string[] = [];
    const gexec = withGovernance(async (c) => { ran.push(c.tool); return { ok: true, content: 'did ' + c.tool }; }, { governance: gov, boundary, resolveAsk: async () => true });
    expect((await gexec({ tool: 'Frobnicate', input: {} })).ok).toBe(false);            // unknown -> deny
    expect((await gexec({ tool: 'ReadFile', input: { path: join(root, 'x.txt') } })).ok).toBe(true);   // allowed
    expect((await gexec({ tool: 'WriteFile', input: { path: join(root, 'y.txt') } })).ok).toBe(true);  // ask -> approved
    expect(ran).toEqual(['fs.read', 'fs.write']);
  });
});
