import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import type { BoundarySet } from '@starfish/governance-core';
import { createGovernance, makeInProcessRunner, runScenarioPack } from '../index';
import { makeGovernedRoot, tcall, P_READ } from './testroot';

describe('cross-mode conformance pack: in-process (risk 72)', () => {
  it('upholds every invariant identically', async () => {
    const root = makeGovernedRoot([P_READ]);
    const gov = createGovernance({ root, keyResolver: () => 'sk-test' });
    const runner = makeInProcessRunner(gov);
    const boundary: BoundarySet = { visibility: [root], write: [root] };
    const results = await runScenarioPack(runner, {
      boundary,
      unknownCall: tcall('mystery', {}),
      inWriteCall: tcall('fs.write', { path: join(root, 'x.txt') }),
      outWriteCall: tcall('fs.write', { path: resolve(root, '..', 'evil.txt') }),
      readCall: tcall('fs.read', { path: join(root, 'x.txt') }),
      sampleDecision: { actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'pack1' },
    });
    for (const r of results) expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
    expect(results.map((r) => r.name)).toContain('fail-closed-when-down');
  });
});
