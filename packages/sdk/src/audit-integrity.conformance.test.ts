import { describe, it, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundarySet } from '@starfish/governance-core';
import { createGovernance } from './index';
import { makeGovernedRoot, tcall, P_READ } from './conformance/testroot';

describe('audit tamper -> safe mode (risk 8)', () => {
  it('clean chain: verifyAudit true, not in safe mode, reads allowed', () => {
    const root = makeGovernedRoot([P_READ]);
    const g = createGovernance({ root, keyResolver: () => 'sk-test' });
    expect(g.verifyAudit()).toBe(true);
    expect(g.safeMode()).toBe(false);
    const bs: BoundarySet = { visibility: [root], write: [root] };
    expect(g.governCall(tcall('fs.read', { path: join(root, 'x.txt') }), bs).allow).toBe(true);
  });
  it('tampered chain: verifyAudit false, safe mode on, everything denied', () => {
    const root = makeGovernedRoot([P_READ]);
    // inject a chain-breaking line before boot
    appendFileSync(join(root, 'audit.jsonl'), JSON.stringify({ ts: '2020-01-01T00:00:00.000Z', seq: 0, prevHash: 'GENESIS', actor: 'x', domain: 'system', action: 'boot', hash: 'tampered' }) + '\n');
    const g = createGovernance({ root, keyResolver: () => 'sk-test' });
    expect(g.verifyAudit()).toBe(false);
    expect(g.safeMode()).toBe(true);
    const bs: BoundarySet = { visibility: [root], write: [root] };
    const d = g.governCall(tcall('fs.read', { path: join(root, 'x.txt') }), bs);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/safe-mode/i);
  });
});
