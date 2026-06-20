import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, type Governor } from '@starfish/governance-core';
import { crewView, agentDetail, decisionLog, budgetView, monitorView, bufferView } from './projections';

function seed(): { g: Governor; root: string; gov: string; audit: string } {
  const root = mkdtempSync(join(tmpdir(), 'sf-proj-'));
  const gov = join(root, 'governance'); mkdirSync(gov, { recursive: true }); mkdirSync(join(root, 'state'), { recursive: true });
  const audit = join(root, 'audit.jsonl');
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' },
    { id: 'git_commit', category: 'exec', pathParams: [], allowedAgents: ['worker'], riskTier: 'high' },
  ]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([
    { id: 'michael', domain: 'orchestration', riskTier: 'medium' },
    { id: 'toby', domain: 'intake', allowedTools: ['fs.read'], riskTier: 'medium' },
    { id: 'hank', domain: 'monitor', allowedTools: ['fs.read'], riskTier: 'low' },
    { id: 'worker', domain: 'execution', allowedTools: ['fs.read', 'fs.write', 'git_commit'], riskTier: 'high' },
  ]));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify([
    { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' },
  ]));
  const g = loadGovernor(gov, audit, { stateDir: join(root, 'state') });
  return { g, root, gov, audit };
}

describe('projections — live Governor -> Bridge views', () => {
  let h: ReturnType<typeof seed>;
  beforeAll(() => { h = seed(); });

  it('crewView maps every registered agent with a derived role + status', () => {
    const crew = crewView(h.g);
    expect(crew.map((c) => c.id).sort()).toEqual(['hank', 'michael', 'toby', 'worker']);
    expect(crew.find((c) => c.id === 'hank')!.status).toBe('sweeping');     // monitor sweeps
    expect(crew.find((c) => c.id === 'worker')!.status).toBe('idle');       // no task assigned
    expect(crew.find((c) => c.id === 'michael')!.role).toBe('Orchestrator');
  });

  it('agentDetail exposes the real allowlist + a boundary (write scoped, governance forbidden)', () => {
    const d = agentDetail(h.g, 'worker', h.root, [h.gov, h.audit, join(h.root, 'state')]);
    expect(d.allowedTools).toContain('git_commit');
    expect(d.boundary.write.length).toBeGreaterThan(0);
    expect(d.boundary.write.some((w) => w.includes(h.gov))).toBe(false);   // governance never writable
    expect(d.notes).toBeTruthy();
  });

  it('pausing an agent (token governor) surfaces as paused in the crew view', () => {
    h.g.tokens.setBudget('worker', { hardUsd: 1 });
    h.g.tokens.record('worker', 2, 0);                                      // cross hard -> paused
    expect(crewView(h.g).find((c) => c.id === 'worker')!.status).toBe('paused');
    expect(budgetView(h.g).find((b) => b.scope === 'worker')!.status).toBe('hard');
  });

  it('decisionLog projects real audit decisions newest-first; monitor counts denials', () => {
    h.g.audit.append({ actor: 'worker', domain: 'tool', action: 'shell.raw', decision: 'deny', reason: 'default-deny' });
    const log = decisionLog(h.g, 12);
    expect(log[0].verdict).toBe('deny');
    expect(log[0].tool).toBe('shell.raw');
    expect(monitorView(h.g).counters.denials).toBeGreaterThanOrEqual(1);
  });

  it('bufferView reflects the capability ledger', () => {
    expect(Array.isArray(bufferView(h.g))).toBe(true);
  });
});
