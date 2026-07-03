import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGovernance, startSidecar } from '@starfish/sdk';
import { httpBridge } from './httpBridge';

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-ui-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'audit.jsonl'), '');
  writeFileSync(join(root, 'governance', 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' }]));
  writeFileSync(join(root, 'governance', 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(root, 'governance', 'policies.json'), JSON.stringify([]));
  return root;
}

describe('httpBridge <-> sidecar', () => {
  it('reads health/pending/monitor and drives approve (proposer != approver over HTTP)', async () => {
    const gov = createGovernance({ root: makeRoot(), keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    const b = httpBridge({ url: sc.url, tokens: { worker: 'w', operator: 'o' } });
    try {
      expect((await b.health()).wire).toBe(1);
      const rec = gov.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'u1' });
      expect((await b.pending()).some((p) => p.id === rec.id)).toBe(true);
      expect((await b.resolve(rec.id, 'approve', 'worker')).ok).toBe(false);   // proposer != approver
      expect((await b.resolve(rec.id, 'approve', 'operator')).ok).toBe(true);   // operator approves
      const mon = await b.monitor();
      expect(typeof mon.counters.denials).toBe('number');
    } finally { await sc.close(); }
  });
});
