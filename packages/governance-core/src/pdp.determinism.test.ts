import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, type BoundarySet } from './index';

function gov() {
  const d = mkdtempSync(join(tmpdir(), 'sf-det-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify([{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }]));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'agent.x' }]));
  return loadGovernor(d, join(d, 'audit.jsonl'));
}

describe('TC-2.1 — determinism (G-3): same input+policy ⇒ same decision', () => {
  it('1000 identical calls yield an identical decision', () => {
    const g = gov();
    const bs: BoundarySet = { visibility: ['/'], write: ['/'] };
    const call = { agentId: 'agent.x', tool: 'read_file', input: { path: '/tmp' } };
    const first = JSON.stringify(g.pdp.decide('ingress', call, bs));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(g.pdp.decide('ingress', call, bs))).toBe(first);
    }
  });
});
