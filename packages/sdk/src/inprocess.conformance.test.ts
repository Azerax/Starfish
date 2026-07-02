import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BoundarySet, ToolCall } from '@starfish/governance-core';
import { createGovernance } from './index';

// --- helpers ---------------------------------------------------------------
type Pol = { id: string; subject: string; action: string; resource: string; effect: 'allow' | 'ask' | 'deny' };
const P_READ: Pol = { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' };
const P_WRITE_ALLOW: Pol = { id: 'p-write', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'allow' };

function makeRoot(policies: Pol[]): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-ip-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'audit.jsonl'), '');
  writeFileSync(join(root, 'governance', 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' },
  ]));
  writeFileSync(join(root, 'governance', 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(root, 'governance', 'policies.json'), JSON.stringify(policies));
  return root;
}
const boundaryOf = (root: string): BoundarySet => ({ visibility: [root], write: [root] });
const call = (tool: string, input: Record<string, unknown>): ToolCall => ({ agentId: 'worker', tool, input });

function scripted(responses: string[]) {
  let i = 0;
  return async () => ({ status: 200, ok: true, text: async () => responses[Math.min(i++, responses.length - 1)] });
}
const toolUseWrite = (path: string, content: string) => JSON.stringify({ content: [{ type: 'tool_use', id: 't1', name: 'fs__write', input: { path, content } }], usage: { input_tokens: 1, output_tokens: 1 } });
const finalText = (t: string) => JSON.stringify({ content: [{ type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 0 } });

async function waitFor<T>(fn: () => T | Promise<T>, ms = 2000, step = 20): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('waitFor timeout'); await new Promise((r) => setTimeout(r, step)); }
}

// --- governCall (deny-by-default) ------------------------------------------
describe('governCall: deny-by-default gate', () => {
  const root = makeRoot([P_READ]);
  const g = createGovernance({ root, keyResolver: () => 'sk-test' });
  const bs = boundaryOf(root);

  it('unknown tool -> deny (not registered)', () => {
    const d = g.governCall(call('mystery', {}), bs);
    expect(d.allow).toBe(false);
  });
  it('in-boundary write with no allow policy -> ask', () => {
    const d = g.governCall(call('fs.write', { path: join(root, 'x.txt') }), bs);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true);
  });
  it('out-of-boundary write -> deny (boundary)', () => {
    const d = g.governCall(call('fs.write', { path: resolve(root, '..', 'evil.txt') }), bs);
    expect(d.allow).toBe(false); expect(d.reason).toMatch(/boundary/i);
  });
  it('allowed read -> allow', () => {
    const d = g.governCall(call('fs.read', { path: join(root, 'x.txt') }), bs);
    expect(d.allow).toBe(true);
  });
});

// --- broker (proposer != approver, one-shot) -------------------------------
describe('broker: approval invariants', () => {
  const root = makeRoot([P_READ]);
  const g = createGovernance({ root, keyResolver: () => 'sk-test' });

  it('proposer cannot self-approve; operator can; resolution is one-shot', () => {
    const rec = g.broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', target: 't', riskTier: 'high', reason: 'r', refId: 'rb1' });
    expect(g.broker.resolve(rec.id, 'approve', 'worker').ok).toBe(false);   // proposer != approver
    expect(g.broker.resolve(rec.id, 'approve', 'operator').ok).toBe(true);  // operator approves
    expect(g.broker.resolve(rec.id, 'approve', 'operator').ok).toBe(false); // already resolved (one-shot)
  });
});

// --- full run loop ---------------------------------------------------------
describe('runGovernedSkill: end to end', () => {
  it('allowed write runs to completion and writes the file', async () => {
    const root = makeRoot([P_READ, P_WRITE_ALLOW]);
    const g = createGovernance({ root, keyResolver: () => 'sk-test', fetcher: scripted([toolUseWrite(join(root, 'notes.md'), 'hello fish'), finalText('done')]) });
    const r = await g.runGovernedSkill({ agentId: 'worker', brief: 'create notes.md', boundary: boundaryOf(root) });
    expect(r.stopReason).toBe('completed');
    expect(existsSync(join(root, 'notes.md'))).toBe(true);
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('hello fish');
  });

  it('write that requires approval parks, then resumes on operator approve', async () => {
    const root = makeRoot([P_READ]);   // fs.write -> ask
    const g = createGovernance({ root, keyResolver: () => 'sk-test', fetcher: scripted([toolUseWrite(join(root, 'notes.md'), 'approved'), finalText('done')]) });
    const p = g.runGovernedSkill({ agentId: 'worker', brief: 'create notes.md', boundary: boundaryOf(root) });
    const pend = await waitFor(() => { const l = g.broker.list(); return l.length ? l : null; });
    expect(pend).not.toBeNull();
    expect(g.broker.resolve(pend![0].id, 'approve', 'operator').ok).toBe(true);
    const r = await p;
    expect(r.stopReason).toBe('completed');
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('approved');
  });
});
