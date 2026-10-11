import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine, ScopeIssuer } from './index';
import type { ToolDef, AgentDef, BoundarySet } from './index';

// H5 input re-provenance, wired (v0.28).
//
// `attest.ts` shipped correct, tested in isolation, audited when called — and called by NOTHING. A
// second instance of the F-7/F-8/F-10 correct-but-unwired shape, one layer below the suite that was
// written to catch it. reachability.conformance now asserts both halves have production callers;
// this file asserts the wiring actually WORKS, because a reachability assertion only proves a symbol
// is referenced, not that referencing it does anything.
//
// The seam: an allowed READ is when a task picked a file (stamp it). An EXEC is when the task acts on
// what it picked (verify it). Between those two moments a cloud sync, a shared drive, or an attacker
// can swap the bytes — the TOCTOU window attest.ts was built for.

function build(opts: { budgetCalls?: number } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'sf-h5-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: ['worker'] },
    { id: 'run_tests', category: 'exec', pathParams: [], allowedAgents: ['worker'] },
  ]));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.read', 'run_tests'] }]));
  const audit = new AuditLog(join(d, 'audit.jsonl'));
  const tools = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  const scope = new ScopeIssuer(audit, tools, agents, { mode: 'contracted' });
  const bs: BoundarySet = { visibility: [d], write: [d] };
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), new PolicyEngine(), undefined, undefined, undefined, 'toby', scope.binding());
  // `run_tests` is exec → tier high → composite 60. At the default Low tolerance (ceiling 30) a clean
  // exec is an ASK, which would mask what this file is testing. Medium (ceiling 70) auto-allows it, so
  // an `allow: false` below is attributable to H5 and nothing else. Floors are unaffected either way.
  pdp.setRiskTolerance('medium');
  const taskId = 'task-h5';
  scope.issue({
    taskId, proposer: 'operator', agentId: 'worker', boundary: bs,
    allowedCommands: ['npm test'], budgetCalls: opts.budgetCalls,
  });
  const input = join(d, 'input.txt');
  writeFileSync(input, 'original contents');
  return { d, pdp, scope, audit, bs, taskId, input };
}

const read = (path: string, taskId?: string) => ({ agentId: 'worker', tool: 'fs.read', input: { path }, taskId });
const exec = (taskId?: string) => ({ agentId: 'worker', tool: 'run_tests', input: { command: 'npm test' }, taskId });

// ---------------------------------------------------------------------------

describe('H5 — an input swapped between pick and use is a deviation', () => {
  it('the happy path: read then exec, nothing changed, both allowed', () => {
    const { pdp, bs, taskId, input } = build();
    expect(pdp.decide('ingress', read(input, taskId), bs).allow).toBe(true);
    expect(pdp.decide('ingress', exec(taskId), bs).allow).toBe(true);
  });

  it('a file rewritten after the read DENIES the exec', () => {
    const { pdp, bs, taskId, input } = build();
    expect(pdp.decide('ingress', read(input, taskId), bs).allow).toBe(true);

    writeFileSync(input, 'swapped by someone else');   // the TOCTOU window

    const d = pdp.decide('ingress', exec(taskId), bs);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/input-changed/);
    expect(d.reason).toMatch(/changed since it was picked/);
    expect(d.riskTier).toBe('high');
  });

  it('it denies rather than asking — there is no legitimate reading of "not the bytes I approved"', () => {
    const { pdp, bs, taskId, input } = build();
    pdp.decide('ingress', read(input, taskId), bs);
    writeFileSync(input, 'different');
    const d = pdp.decide('ingress', exec(taskId), bs);
    expect(d.allow).toBe(false);
    expect(d.ask).toBeFalsy();
  });

  it('a rewrite with IDENTICAL bytes is not a deviation — content is what matters, not mtime', () => {
    const { pdp, bs, taskId, input } = build();
    pdp.decide('ingress', read(input, taskId), bs);
    const same = readFileSync(input);
    writeFileSync(input, same);                        // touches mtime, same content
    expect(pdp.decide('ingress', exec(taskId), bs).allow).toBe(true);
  });

  it('the deviation is audited under the scope domain, not silently returned', () => {
    const { pdp, audit, bs, taskId, input } = build();
    pdp.decide('ingress', read(input, taskId), bs);
    writeFileSync(input, 'swapped');
    pdp.decide('ingress', exec(taskId), bs);
    const dev = audit.recent().filter((e) => e.action === 'scope:input-deviation');
    expect(dev.length).toBeGreaterThan(0);
    expect(dev[0].decision).toBe('deny');
    expect(dev[0].riskTier).toBe('high');
  });
});

describe('H5 — the stamp half only fires where it should', () => {
  it('a DENIED read does not seed a stamp (it never happened)', () => {
    const { pdp, scope, bs, taskId, d } = build();
    const outside = join(d, '..', 'outside.txt');
    writeFileSync(outside, 'x');
    expect(pdp.decide('ingress', read(outside, taskId), bs).allow).toBe(false);
    // Nothing stamped, so the exec has nothing to verify and proceeds.
    expect(scope.verifyInputs(taskId).ok).toBe(true);
    expect(pdp.decide('ingress', exec(taskId), bs).allow).toBe(true);
  });

  it('a read with no taskId stamps nothing — there is no task to bind it to', () => {
    const { pdp, scope, bs, taskId, input } = build();
    expect(pdp.decide('ingress', read(input), bs).allow).toBe(true);   // untasked, allowed under 'contracted'
    writeFileSync(input, 'swapped');
    expect(scope.verifyInputs(taskId).ok).toBe(true);                  // the other task stamped nothing
  });

  it('verifying a task with no contract fails closed', () => {
    const { scope } = build();
    expect(scope.verifyInputs('no-such-task').ok).toBe(false);
  });

  it('costs nothing when nothing was stamped', () => {
    const { pdp, bs, taskId } = build();
    expect(pdp.decide('ingress', exec(taskId), bs).allow).toBe(true);
  });

  // Regression: the first version of this wiring gated only on the METHOD existing, not on
  // `scopeGate.enforce`. Because verifyInputs fails closed for a task with no contract — correct for
  // the ledger, wrong as a PDP precondition — every exec carrying a taskId was denied with the gate
  // OFF. Three Q12 targeting tests caught it. H5 is part of non-deviation and follows its mode.
  it('scope mode "off" disables H5 too, rather than denying every tasked exec', () => {
    const { d, bs, input } = build();
    const audit = new AuditLog(join(d, 'audit2.jsonl'));
    const tools = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
    const agents = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
    const off = new ScopeIssuer(audit, tools, agents, { mode: 'off' });
    const pdp = new PDP(tools, agents, audit, new RiskEngine(), new PolicyEngine(), undefined, undefined, undefined, 'toby', off.binding());
    pdp.setRiskTolerance('medium');

    // No contract issued at all, and the file changes underneath — with the gate off, neither matters.
    expect(pdp.decide('ingress', read(input, 'unknown-task'), bs).allow).toBe(true);
    writeFileSync(input, 'swapped');
    expect(pdp.decide('ingress', exec('unknown-task'), bs).allow).toBe(true);
  });
});

describe('the D3 tightening cannot be switched off', () => {
  it('allowCommandsByDefault is a no-op — deprecated, pinned so nobody "fixes" it into working', () => {
    const d = mkdtempSync(join(tmpdir(), 'sf-h5-d3-'));
    writeFileSync(join(d, 'tools.json'), JSON.stringify([{ id: 'shell', category: 'exec', pathParams: [], allowedAgents: ['worker'] }]));
    writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['shell'] }]));
    const audit = new AuditLog(join(d, 'audit.jsonl'));
    const tools = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
    const agents = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);

    const off = new ScopeIssuer(audit, tools, agents, { allowCommandsByDefault: false });
    const on = new ScopeIssuer(audit, tools, agents, { allowCommandsByDefault: true });
    const args = { proposer: 'operator', agentId: 'worker', boundary: { visibility: [d], write: [d] } };

    // Both derive an EMPTY command list. D3 has no wildcard, and there is no per-agent command grant
    // to mirror, so "permit any command" is not expressible — which is why the option is deprecated
    // rather than implemented: making it work would undo the one deliberate tightening.
    expect(off.issue({ taskId: 't-off', ...args }).allowedCommands).toEqual([]);
    expect(on.issue({ taskId: 't-on', ...args }).allowedCommands).toEqual([]);
  });
});

describe('a divergent re-issue is recorded, not swallowed', () => {
  it('returns the existing contract unchanged and audits the divergence', () => {
    const { scope, audit, bs } = build();
    const first = scope.issue({ taskId: 't-div', proposer: 'operator', agentId: 'worker', boundary: bs, allowedCommands: ['npm test'] });
    const again = scope.issue({ taskId: 't-div', proposer: 'operator', agentId: 'worker', boundary: bs, allowedCommands: ['rm -rf /'] });

    expect(again.hash).toBe(first.hash);                 // never widened
    expect(again.allowedCommands).toEqual(['npm test']);
    const div = audit.recent().filter((e) => e.action === 'scope:issue-divergent');
    expect(div.length).toBe(1);
    expect(div[0].reason).toMatch(/use amend\(\)/);
  });

  it('an identical replay is silent — that is what idempotency is for', () => {
    const { scope, audit, bs } = build();
    const args = { taskId: 't-same', proposer: 'operator', agentId: 'worker', boundary: bs, allowedCommands: ['npm test'] };
    const a = scope.issue(args);
    const b = scope.issue(args);
    expect(b.hash).toBe(a.hash);
    expect(audit.recent().filter((e) => e.action === 'scope:issue-divergent')).toHaveLength(0);
  });
});
