import { describe, it, expect } from 'vitest';
import type { GovernanceBridge, ActionResult } from './index';

// A fake bridge implementing the full contract — proves the seam is coherent and that the
// action path returns a PDP decision (here: ask, because proposer != approver).
const bridge: GovernanceBridge = {
  governed: true,
  getCrew: async () => [{ id: 'michael', role: 'Orchestrator', status: 'active', currentTaskId: '#412', riskTier: 'medium' }],
  getDecisions: async () => [],
  getAudit: async () => [],
  getTasks: async () => [],
  getServices: async () => [],
  getBudgets: async () => [],
  getMonitor: async () => ({ lastSweepTs: '', counters: { denials: 0, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 0, orphanPosts: 0, casualties: 0 }, findings: [], reconciled: true }),
  getBuffer: async () => [],
  subscribe: () => () => {},
  requestAction: async (): Promise<ActionResult> => ({ decision: { allow: false, ask: true, reason: 'human approval required (proposer != approver)' }, applied: false }),
};

describe('UI <-> governance contract (ring 3)', () => {
  it('the renderer bridge is always governed', () => {
    expect(bridge.governed).toBe(true);
  });
  it('actions are requests adjudicated by the PDP; nothing applies without allow', async () => {
    const res = await bridge.requestAction({ actor: 'operator', intent: { kind: 'task.approve', taskId: '#412' } });
    expect(res.decision.ask).toBe(true);
    expect(res.applied).toBe(false);
  });
  it('exposes read-only crew view themed by internal id', async () => {
    const crew = await bridge.getCrew();
    expect(crew[0].id).toBe('michael');
  });
});
