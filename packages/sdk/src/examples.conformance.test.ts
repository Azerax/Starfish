import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundarySet } from '@starfish/governance-core';
import { createGovernance } from './index';
import { makeGovernedRoot, tcall, scripted, toolUseWrite, finalText, P_READ, P_WRITE_ALLOW } from './conformance/testroot';

// This is the exact flow documented in README.md - kept as a test so the docs cannot drift.
describe('reference: embedding Starfish in a Node host', () => {
  it('manual gate (governCall) + autonomous run (runGovernedSkill)', async () => {
    const root = makeGovernedRoot([P_READ, P_WRITE_ALLOW]);
    const boundary: BoundarySet = { visibility: [root], write: [root] };
    const starfish = createGovernance({
      root,
      keyResolver: () => process.env.ANTHROPIC_API_KEY ?? 'sk-test',
      fetcher: scripted([toolUseWrite(join(root, 'out.md'), 'governed'), finalText('done')]),
    });

    // (a) a host manually gating its own action
    const gate = starfish.governCall(tcall('fs.read', { path: join(root, 'out.md') }), boundary);
    expect(gate.allow).toBe(true);

    // (b) an autonomous governed run
    const result = await starfish.runGovernedSkill({ agentId: 'worker', brief: 'write out.md', boundary });
    expect(result.stopReason).toBe('completed');
    expect(existsSync(join(root, 'out.md'))).toBe(true);
    expect(readFileSync(join(root, 'out.md'), 'utf8')).toBe('governed');
  });
});
