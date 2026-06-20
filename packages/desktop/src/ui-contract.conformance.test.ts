import { describe, it, expect } from 'vitest';
import type { GovernanceBridge, ActionResult } from './index';

// A fake bridge implementing the full contract — proves the seam is coherent and that the
// action path returns a PDP decision (here: ask, because proposer != approver).
const bridge: GovernanceBridge = {
  governed: true,
  getCrew: async () => [{ id: 'michael', role: 'Orchestrator', status: 'active', currentTaskId: '#412', riskTier: 'medium' }],
  getAgentDetail: async (id) => ({ id, role: 'Orchestrator', domain: 'orchestration', status: 'active', riskTier: 'medium', currentTaskId: '#412', allowedTools: ['delegate'], boundary: { visibility: ['/proj'], write: ['/proj/agents/michael'] } }),
  getDecisions: async () => [],
  getAudit: async () => [],
  getTasks: async () => [],
  getServices: async () => [],
  getBudgets: async () => [],
  getMonitor: async () => ({ lastSweepTs: '', counters: { denials: 0, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, findings: [], reconciled: true }),
  getBuffer: async () => [],
  subscribe: () => () => {},
  requestAction: async (): Promise<ActionResult> => ({ decision: { allow: false, ask: true, reason: 'human approval required (proposer != approver)' }, applied: false }),
  getOnboarding: async () => ({ done: false, operator: 'op', theme: 'fleet' }),
  getBaseRoot: async () => ({ root: '/root', locked: false, suggested: '/root' }),
  pickBaseDir: async () => ({ path: null }),
  setBaseRoot: async (dir: string) => ({ ok: true, root: dir, reason: 'seeded' }),

  getDefaultSkills: async () => [{ id: 'xlsx', kind: 'skill', category: 'document', summary: 's', expectedRisk: 'medium', plugin: 'document-skills' }],
  completeOnboarding: async () => ({ registered: [], quarantined: ['xlsx'], approved: [], missing: [] }),
  getProviders: async () => [{ id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-opus-4-8', requiresKey: true, hasKey: false, dataEgress: false }],
  getActiveProvider: async () => ({ id: 'anthropic', model: 'claude-opus-4-8' }),
  setActiveProvider: async () => ({ ok: true }),
  setProviderKey: async () => ({ ok: true, stored: 'keychain' as const }),
  assessDelete: async () => ({ tier: 'low' as const, decision: 'allow' as const, hard: false, reversible: true, files: 1, bytes: 10, reasons: [] }),
  deleteFile: async () => ({ ok: true, reason: 'soft-deleted', impact: { tier: 'low' as const, decision: 'allow' as const, hard: false, reversible: true, files: 1, bytes: 10, reasons: [] }, trashedTo: '/trash/x' }),
  listTrash: async () => [],
  restoreTrash: async () => ({ ok: true, restoredTo: '/x', reason: 'restored' }),
  purgeTrash: async () => ({ ok: true }),
};

describe('UI <-> governance contract (ring 3)', () => {
  it('the renderer bridge is always governed', () => { expect(bridge.governed).toBe(true); });
  it('actions are requests adjudicated by the PDP; nothing applies without allow', async () => {
    const res = await bridge.requestAction({ actor: 'operator', intent: { kind: 'task.approve', taskId: '#412' } });
    expect(res.decision.ask).toBe(true);
    expect(res.applied).toBe(false);
  });
  it('exposes read-only crew view themed by internal id', async () => {
    const crew = await bridge.getCrew();
    expect(crew[0].id).toBe('michael');
  });
  it('onboarding routes through the governed default-skills flow', async () => {
    const cat = await bridge.getDefaultSkills();
    expect(cat[0].id).toBe('xlsx');
    const r = await bridge.completeOnboarding({ operator: 'op', theme: 'fleet', enabledIds: [] });
    expect(r.quarantined).toContain('xlsx');   // Medium+ not auto-trusted
  });
});
