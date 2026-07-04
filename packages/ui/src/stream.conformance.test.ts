import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGovernance, startSidecar } from '@starfish/sdk';
import { httpBridge, type StreamEvent } from './httpBridge';

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-stream-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'audit.jsonl'), '');
  writeFileSync(join(root, 'governance', 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' }]));
  writeFileSync(join(root, 'governance', 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(root, 'governance', 'policies.json'), JSON.stringify([]));
  return root;
}
const waitFor = (fn: () => boolean, ms = 4000) => new Promise<void>((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => { if (fn()) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); } }, 50);
});

describe('SSE live stream (v0.18.0)', () => {
  it('pushes pending + budgets + monitor without polling; unsubscribe stops it', async () => {
    const gov = createGovernance({ root: makeRoot(), keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    const b = httpBridge({ url: sc.url, tokens: { worker: 'w', operator: 'o' } });
    const seen: StreamEvent[] = [];
    const unsub = b.subscribe((ev) => seen.push(ev), 'operator');
    try {
      await waitFor(() => seen.some((e) => e.type === 'hello'));
      const rec = gov.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 's1' });
      await waitFor(() => seen.some((e) => e.type === 'pending' && Array.isArray(e.data) && (e.data as Array<{ id: string }>).some((p) => p.id === rec.id)));
      expect(seen.some((e) => e.type === 'budgets')).toBe(true);
      expect(seen.some((e) => e.type === 'monitor')).toBe(true);
      unsub();
      await new Promise((r) => setTimeout(r, 1300));   // let any in-flight chunk settle
      const n = seen.length;
      await new Promise((r) => setTimeout(r, 1300));
      expect(seen.length).toBe(n);   // stream is fully stopped: no new events across a full tick window
    } finally { unsub(); await sc.close(); }
  });

  it('scopes pending: a worker stream never sees another actor\'s pending decisions', async () => {
    const gov = createGovernance({ root: makeRoot(), keyResolver: () => 'sk-test' });
    const sc = await startSidecar({ governance: gov, identities: [{ token: 'w', actor: 'worker' }, { token: 'o', actor: 'operator' }] });
    const b = httpBridge({ url: sc.url, tokens: { worker: 'w', operator: 'o' } });
    const seen: StreamEvent[] = [];
    const unsub = b.subscribe((ev) => seen.push(ev), 'worker');   // subscribe AS worker
    try {
      gov.broker.file({ actor: 'operator', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'op-only' });
      await waitFor(() => seen.filter((e) => e.type === 'pending').length >= 2);   // a couple of ticks
      const allPending = seen.filter((e) => e.type === 'pending').flatMap((e) => e.data as Array<{ actor: string }>);
      expect(allPending.every((p) => p.actor === 'worker')).toBe(true);   // operator's item never leaked
    } finally { unsub(); await sc.close(); }
  });
});
