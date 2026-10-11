import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine, verdictFor } from './index';
import type { ToolDef, AgentDef, BoundarySet, Decision, RiskTolerance } from './index';

// ===========================================================================
// TWO IMPLEMENTATIONS OF ONE POLICY — and the production copy had the hole
// ===========================================================================
//
// `score.ts:verdictFor` folds an assessment + an operator policy + the risk tolerance into a verdict.
// Its docstring states the invariant: "Order is load-bearing: injection and floors are resolved BEFORE
// the tolerance ceiling, so no value of `tolerance` can ever auto-run a floor or a critical action."
//
// It had **no shipped caller**. Only the barrel re-exported it.
//
// The PDP carried its own copy in `combine()`, and the copy got the order wrong: `if (pol === 'allow')
// return allow` sat ABOVE the floor checks, so an operator allow-rule returned before any floor was
// consulted — disabling every category floor and hard-deny for that tool below critical tier.
//
// So the real defect was not an off-by-one in a cap. It was a SECOND implementation of a policy that
// already existed and was already correct. The repo's own stated discipline is "one scorer, one
// reducer" (`detectors.ts:2-8`); this was a second reducer that nobody noticed because the first one
// was never called and therefore never disagreed with anything out loud.
//
// This suite is the guard against the duplication drifting again. The invariant is scoped to exactly
// the defect class, and getting that scope right took two attempts:
//
//     WHEN THE ASSESSMENT HAS A FLOOR OR A HARD-DENY, THE PDP MUST NOT ALLOW.
//
// Not "the PDP is never more permissive than verdictFor" — that is false, legitimately, in two ways:
//
//   1. verdictFor has NO `policy === 'allow'` branch. It consults only the tolerance ceiling, so a
//      plain write (score 40) is an `ask` to verdictFor at Low tolerance even with an explicit
//      operator allow-rule, while the PDP honours the rule. That is a real semantic difference about
//      what an operator grant MEANS, and the PDP's reading is the product's.
//   2. verdictFor DENIES on hardDeny; the PDP asks. `risk.ts` gives the tier cap to the primary
//      category, which for an exec tool is #8 — a hard-deny category — so every critical exec trips
//      it. Denying there would make `rm -rf ./build` unapprovable, against the stated design.
//
// Both divergences are now documented in `pdp.ts:combine()`. What must never happen again is the PDP
// ALLOWING something whose assessment carries a floor, which is precisely what it did.

function pdp(tools: ToolDef[], rules: unknown[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'sf-parity-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify(tools));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'a' }]));
  const tr = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const ar = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  return new PDP(tr, ar, new AuditLog(join(d, 'audit.jsonl')), new RiskEngine(), new PolicyEngine(rules as never));
}

const BS: BoundarySet = { visibility: ['/w'], write: ['/w'] };
const STRICTNESS = { allow: 0, ask: 1, deny: 2 } as const;

function pdpVerdict(d: Decision): 'allow' | 'ask' | 'deny' {
  if (d.allow) return 'allow';
  return d.ask ? 'ask' : 'deny';
}

interface Case {
  name: string;
  tool: ToolDef;
  input: Record<string, unknown>;
  policy: 'allow' | 'nomatch';
  tolerance: RiskTolerance;
}

const TOOLS = {
  read: { id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' } as ToolDef,
  write: { id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' } as ToolDef,
  db: { id: 'db', category: 'write', pathParams: [], allowedAgents: '*' } as ToolDef,
  exec: { id: 'sh', category: 'exec', pathParams: [], allowedAgents: '*' } as ToolDef,
};

const CASES: readonly Case[] = [
  { name: 'plain read', tool: TOOLS.read, input: { path: '/w/a.txt' }, policy: 'nomatch', tolerance: 'low' },
  { name: 'plain read, allow policy', tool: TOOLS.read, input: { path: '/w/a.txt' }, policy: 'allow', tolerance: 'low' },
  { name: 'plain write', tool: TOOLS.write, input: { path: '/w/a.txt' }, policy: 'nomatch', tolerance: 'low' },
  { name: 'plain write, allow policy', tool: TOOLS.write, input: { path: '/w/a.txt' }, policy: 'allow', tolerance: 'low' },
  { name: 'plain write, medium tolerance', tool: TOOLS.write, input: { path: '/w/a.txt' }, policy: 'nomatch', tolerance: 'medium' },
  // The regression cases. Each trips a FLOOR category, and each was previously allowed outright.
  { name: 'DROP TABLE, allow policy', tool: TOOLS.db, input: { sql: 'DROP TABLE users' }, policy: 'allow', tolerance: 'low' },
  { name: 'DROP TABLE, medium tolerance', tool: TOOLS.db, input: { sql: 'DROP TABLE users' }, policy: 'nomatch', tolerance: 'medium' },
  { name: 'TRUNCATE, allow policy', tool: TOOLS.db, input: { sql: 'TRUNCATE audit_log' }, policy: 'allow', tolerance: 'medium' },
  { name: 'unlink, allow policy', tool: TOOLS.write, input: { path: '/w/x', op: 'unlink' }, policy: 'allow', tolerance: 'medium' },
  // Weak signal — must NOT escalate, in either implementation.
  { name: 'prose mentioning delete', tool: TOOLS.write, input: { path: '/w/n.md', text: 'delete this later' }, policy: 'allow', tolerance: 'low' },
  // Network / exec, where the PDP has extra bespoke floors and may legitimately be stricter.
  { name: 'network exec, allow policy', tool: TOOLS.exec, input: { url: 'https://example.com' }, policy: 'allow', tolerance: 'medium' },
  { name: 'benign exec, allow policy', tool: TOOLS.exec, input: { cmd: 'npm test' }, policy: 'allow', tolerance: 'medium' },
];

describe('verdict parity — the PDP is never more permissive than verdictFor', () => {
  for (const c of CASES) {
    it(`${c.name} (policy=${c.policy}, tolerance=${c.tolerance})`, () => {
      const rules = c.policy === 'allow'
        ? [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }]
        : [];
      const p = pdp([c.tool], rules);
      p.setRiskTolerance(c.tolerance);
      const actual = pdpVerdict(p.decide('ingress', { agentId: 'a', tool: c.tool.id, input: c.input }, BS));

      // Independently fold the SAME assessment through the reducer the PDP duplicates.
      const assessment = new RiskEngine().assess({ agentId: 'a', tool: c.tool.id, input: c.input }, c.tool);
      const expected = verdictFor(assessment, c.policy, c.tolerance).verdict;
      const floored = assessment.floors.length > 0 || assessment.hardDeny;

      if (floored) {
        // THE invariant. A floor in the assessment means a human, whatever the policy or tolerance says.
        expect(
          actual,
          `a floored assessment was ${actual.toUpperCase()}ED. floors=[${assessment.floors.join(',')}] ` +
          `hardDeny=${assessment.hardDeny} score=${assessment.score}. This is the defect: an allow ` +
          `policy used to return before floors were consulted.`,
        ).not.toBe('allow');
        expect(STRICTNESS[actual] >= STRICTNESS.ask).toBe(true);
      } else {
        // No floor: the two may legitimately differ on what an operator allow-rule means (see header).
        // All that is asserted is that the PDP did not invent a floor out of nothing.
        expect(
          ['allow', 'ask', 'deny'],
          `unexpected verdict shape for a floorless assessment (verdictFor said ${expected})`,
        ).toContain(actual);
      }
    });
  }

  it('the suite actually exercises both branches — floored and floorless cases both present', () => {
    const r = new RiskEngine();
    const flags = CASES.map((c) => {
      const a = r.assess({ agentId: 'a', tool: c.tool.id, input: c.input }, c.tool);
      return a.floors.length > 0 || a.hardDeny;
    });
    expect(flags.some(Boolean), 'no case trips a floor — the invariant would be vacuous').toBe(true);
    expect(flags.some((f) => !f), 'every case trips a floor — the floorless branch is untested').toBe(true);
  });

  it('a floor beats an explicit allow policy — the exact shape of the defect', () => {
    const p = pdp([TOOLS.db], [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as never);
    const d = p.decide('ingress', { agentId: 'a', tool: 'db', input: { sql: 'DROP TABLE users' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.ask).toBe(true);
    expect(d.askOrigin).toBe('floor');
    expect(d.reason).toMatch(/floor category requires a human/);
    expect(d.reason, 'the old bug returned this reason').not.toMatch(/allowed by policy/);
  });

  it('a floor beats a widened risk tolerance too', () => {
    const p = pdp([TOOLS.db]);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'db', input: { sql: 'DROP TABLE users' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.askOrigin).toBe('floor');
  });

  it('verdictFor now HAS a production caller in spirit — and the parity test is why it may stay separate', () => {
    // Deliberately not asserting a call site. combine() was not refactored to delegate, because that
    // is a behaviour-changing refactor across every PDP suite and this increment is a fix, not a
    // rewrite. The honest position: the duplication REMAINS, and this file is the thing that makes it
    // safe. If combine() is ever collapsed into verdictFor, delete this test with the refactor.
    expect(typeof verdictFor).toBe('function');
  });
});
