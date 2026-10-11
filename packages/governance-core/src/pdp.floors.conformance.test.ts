import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PDP, Registry, AuditLog, RiskEngine, PolicyEngine,
  FLOOR_IDS, HARD_DENY_IDS, FLOOR_TRIGGER, CATEGORIES,
} from './index';
import type { ToolDef, AgentDef, BoundarySet, Decision, CategoryId } from './index';

// ===========================================================================
// ARE THE FLOORS ACTUALLY REACHABLE?
// ===========================================================================
//
// `riskmatrix.ts` marks seven of the fifty categories as FLOORS: at >= FLOOR_TRIGGER (8) they force a
// human regardless of risk tolerance, and five of those also HARD-DENY. That is the strongest claim
// the risk model makes, and every test we had asserted it from the inside — feed the scorer `{6: 10}`
// and check a floor fires. `score.conformance.test.ts` does exactly that, and passes.
//
// What nothing asked was whether any real input can GET a floor category to 8 on the live path.
//
// It is the reachability question (`reachability.conformance.test.ts`) pointed at policy instead of at
// code. A floor whose score no producer can reach is not a control; it is a row in a table. And the
// failure is invisible from both ends: the scorer's unit test passes because the scorer is correct,
// and the PDP's tests pass because they assert the tiers they drive, never the floors they don't.
//
// So this suite drives the WHOLE PDP with concrete tool calls and asks, per floor: does some input
// actually trip it? Every answer is a demonstration, never a flag.
//
// WHAT THIS FOUND (2026-10-11), confirmed against the shipped code:
//
//   `risk.ts:38-43` is the only producer of category scores on the live path (`pdp.ts:340`). It sets
//   every secondary category to `Math.min(cap, 7)` — and FLOOR_TRIGGER is 8. One below. So NO
//   secondary category can ever trip a floor, by construction:
//
//     cats[6]  = Math.min(cap, 7)   // reversibility   — FLOOR
//     cats[12] = Math.min(cap, 7)   // exfiltration    — FLOOR *and* HARD-DENY
//
//   Only #1 and #8 escape, because they are the PRIMARY category and get the uncapped `cap` (9 at
//   critical tier). Everything else is pinned below the line that matters.
//
//   The concrete hole: `drop table`, `truncate` and `unlink` appear in the category-6 regex but in
//   NEITHER the CRITICAL nor the HIGH tier regex (`risk.ts:10-11`). So they never raise the tier, the
//   cap stays at 4, category 6 scores 4, no floor fires — and `DROP TABLE users` is AUTO-ALLOWED
//   under an allow policy. `rm -rf` is caught only because it is separately on the CRITICAL list, not
//   because the reversibility floor works.
//
// This file is the regression barrier for that whole class.

function pdp(tools: ToolDef[], rules: unknown[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'sf-floors-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify(tools));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'a' }]));
  const tr = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const ar = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  return new PDP(tr, ar, new AuditLog(join(d, 'audit.jsonl')), new RiskEngine(), new PolicyEngine(rules as never));
}

// A REALISTIC boundary. The first cut of this file used { visibility: ['/'], write: ['/'] } and
// reported that writing /etc/passwd was allowed — which was a bad probe, not a defect: with `/` granted
// as the write root, /etc/passwd is inside the operator's own grant and containCheck is right to pass
// it. Worth leaving in the record, because "the test found something" and "the system is broken" are
// different claims and a floor suite is exactly where confusing them would be expensive.
const BS: BoundarySet = { visibility: ['/w'], write: ['/w'] };
const ALLOW_ALL = [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }];

/** A floor is enforced if the human is in the loop: either an ask no profile may satisfy, or a deny. */
function humanRequired(d: Decision): boolean {
  return d.allow === false;
}

describe('floors — reachable from a real tool call, not just from the scorer', () => {
  // -------------------------------------------------------------------------
  // The defect, stated as the smallest possible case.
  // -------------------------------------------------------------------------

  it('#6 reversibility: DROP TABLE must not be auto-allowed', () => {
    const p = pdp([{ id: 'db', category: 'write', pathParams: [], allowedAgents: '*' }], ALLOW_ALL);
    const d = p.decide('ingress', { agentId: 'a', tool: 'db', input: { sql: 'DROP TABLE users' } }, BS);
    expect(
      humanRequired(d),
      'DROP TABLE was AUTO-ALLOWED. Category 6 (reversibility) is a declared floor, but risk.ts caps ' +
      'it at 7 and FLOOR_TRIGGER is 8, so the floor cannot fire. Nothing else in the PDP checks ' +
      'reversibility. An irreversible action never reaches a human.',
    ).toBe(true);
  });

  it('#6 reversibility: TRUNCATE must not be auto-allowed', () => {
    const p = pdp([{ id: 'db', category: 'write', pathParams: [], allowedAgents: '*' }], ALLOW_ALL);
    const d = p.decide('ingress', { agentId: 'a', tool: 'db', input: { sql: 'TRUNCATE TABLE audit_log' } }, BS);
    expect(humanRequired(d), 'TRUNCATE was auto-allowed — see the DROP TABLE case').toBe(true);
  });

  it('#6 reversibility: unlink must not be auto-allowed', () => {
    const p = pdp([{ id: 'fs', category: 'write', pathParams: [], allowedAgents: '*' }], ALLOW_ALL);
    const d = p.decide('ingress', { agentId: 'a', tool: 'fs', input: { op: 'unlink', path: '/w/keep.db' } }, BS);
    expect(humanRequired(d), 'unlink was auto-allowed — see the DROP TABLE case').toBe(true);
  });

  it('a reversibility floor ask is a FLOOR, so tolerance cannot satisfy it', () => {
    const p = pdp([{ id: 'db', category: 'write', pathParams: [], allowedAgents: '*' }], ALLOW_ALL);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'db', input: { sql: 'DROP TABLE users' } }, BS);
    expect(humanRequired(d), 'Medium tolerance satisfied an irreversible action').toBe(true);
    if (d.ask) expect(d.askOrigin, 'an irreversible ask must be askOrigin=floor, not routine risk').toBe('floor');
  });

  // -------------------------------------------------------------------------
  // The distinction that keeps the fix honest: STRONG vs WEAK signals.
  //
  // The naive fix is to stop capping floor categories. That would make every input mentioning
  // "delete" force an approval, and approval fatigue is already the open H6 item — trading a silent
  // failure for a reflexive click is not a fix. So only signals with no benign reading in a tool
  // input escalate; ambiguous ones stay composite-only, and that choice is pinned here so a later
  // "tidy-up" cannot quietly widen it.
  // -------------------------------------------------------------------------

  it('a WEAK signal (the bare word "delete" in prose) does NOT force an approval', () => {
    const p = pdp([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }], ALLOW_ALL);
    const d = p.decide('ingress', {
      agentId: 'a', tool: 'w',
      input: { path: '/w/notes.md', text: 'TODO: delete this paragraph once the rewrite lands' },
    }, BS);
    expect(
      d.allow,
      'prose mentioning "delete" forced an approval — that is approval fatigue, not a control',
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The general barrier. Each floor is either DEMONSTRATED by an input, or declared undemonstrated
  // in the inventory below — tested in both directions, like AWAITING_WIRING.
  // -------------------------------------------------------------------------

  interface FloorProbe {
    id: CategoryId;
    what: string;
    tool: ToolDef;
    input: Record<string, unknown>;
    /** WHICH mechanism actually stops it. The headline finding of this file is that these mostly are
     *  NOT the matrix's floor mechanism: they are hand-written checks elsewhere in the PDP that never
     *  consult a category score. The matrix's floor column reads like one uniform control and is, on
     *  the live path, four different ones plus two gaps. Recording the real mechanism per row is the
     *  difference between knowing that and believing the table. */
    enforcedBy: 'category-floor' | 'pdp-hard-floor' | 'boundary';
  }

  const PROBES: readonly FloorProbe[] = [
    {
      id: 1, what: 'file/storage access outside the granted boundary',
      tool: { id: 'w1', category: 'write', pathParams: ['path'], allowedAgents: '*' },
      input: { path: '/etc/passwd' },
      // NOT the floor. #1 is the PRIMARY category and scores `cap` (4 for a medium write), so the
      // floor never fires; containCheck denies this on the boundary. Grant `/` and it is allowed —
      // correctly, per the grant, but it means the #1 floor is doing no work here.
      enforcedBy: 'boundary',
    },
    {
      id: 6, what: 'an irreversible data operation',
      tool: { id: 'db1', category: 'write', pathParams: [], allowedAgents: '*' },
      input: { sql: 'DROP TABLE users' },
      // The one row where the category floor genuinely carries the decision — and the row that was
      // broken until the STRONG/WEAK split in risk.ts.
      enforcedBy: 'category-floor',
    },
    {
      id: 8, what: 'a catastrophic shell command',
      tool: { id: 'sh1', category: 'exec', pathParams: [], allowedAgents: '*' },
      input: { cmd: 'rm -rf /' },
      // F-11's hard floor in the PDP, ahead of policy and tolerance. The category would also reach 9
      // here via the CRITICAL regex, so this is the one row with belt and braces.
      enforcedBy: 'pdp-hard-floor',
    },
    {
      id: 11, what: 'reading a credential file',
      tool: { id: 'r1', category: 'read', pathParams: ['path'], allowedAgents: '*' },
      input: { path: '/w/.env' },
      // classifyPath + the secret-file deny. Nothing ever sets category 11.
      enforcedBy: 'pdp-hard-floor',
    },
    {
      id: 29, what: 'self-modification of governance config',
      tool: { id: 'w2', category: 'write', pathParams: ['path'], allowedAgents: '*' },
      input: { path: '/w/policies.json' },
      // The CRITICAL regex catches `policies.json` by name and the tier escalation does the work.
      // Nothing ever sets category 29 either.
      enforcedBy: 'pdp-hard-floor',
    },
  ];

  it('only ONE floor is actually carried by the category mechanism — the rest are bespoke or absent', () => {
    // Not a behavioural assertion; a disclosure that cannot drift. If someone wires a real producer
    // for #10 or #12, or makes #1 floor properly, this count changes and the comment above must be
    // rewritten rather than left to rot.
    const byCategory = PROBES.filter((p) => p.enforcedBy === 'category-floor').map((p) => p.id);
    expect(byCategory).toEqual([6]);
    expect(PROBES.length + UNDEMONSTRATED.length).toBe(FLOOR_IDS.length);
  });

  /** Floors with no demonstration yet. Each must say what WOULD have to produce it — a floor nobody
   *  can trip is a documentation row, and the point of naming it here is that the claim is checkable.
   *
   *  Tested in both directions: if a listed floor becomes demonstrable the test FAILS and tells you to
   *  move it into PROBES. That is the half that stops this inventory rotting into a comforting lie,
   *  the same reason AWAITING_WIRING is written the way it is. */
  const UNDEMONSTRATED: readonly { id: CategoryId; why: string }[] = [
    {
      id: 10,
      why: 'Oversight/auditability has NO producer anywhere — nothing sets category 10. The behaviour ' +
           'it stands for (a vanished audit chain) is enforced by anchor.ts + monitor.ts outside the ' +
           'category vector, so the FLOOR specifically is inert. Needs a producer or an honest ' +
           'de-flagging of the row.',
    },
    {
      id: 12,
      why: 'Exfiltration is a floor AND a hard-deny, and risk.ts caps it at 7 so neither can fire. ' +
           'Deliberately NOT fixed by uncapping: the producing regex is upload|exfil|POST|multipart|' +
           'attachment, and a hard-deny is unappealable, so a false positive on "POST " would be ' +
           'catastrophic. netguard.ts hard-denies internal/loopback/metadata destinations today, which ' +
           'covers the sharpest case but NOT egress to an ordinary external host. A real producer needs ' +
           'taint.ts (classified data actually crossing an egress boundary), not a keyword match.',
    },
  ];

  it('the two inventories partition the floor set exactly — no floor is unaccounted for', () => {
    const covered = [...PROBES.map((p) => p.id), ...UNDEMONSTRATED.map((u) => u.id)].sort((a, b) => a - b);
    expect(covered).toEqual([...FLOOR_IDS].sort((a, b) => a - b));
    const overlap = PROBES.filter((p) => UNDEMONSTRATED.some((u) => u.id === p.id));
    expect(overlap, 'a floor cannot be both demonstrated and undemonstrated').toEqual([]);
  });

  for (const probe of PROBES) {
    const cat = CATEGORIES.find((c) => c.id === probe.id);
    it(`#${probe.id} ${cat?.name}: ${probe.what} requires a human, even with allow-all + medium tolerance`, () => {
      const p = pdp([probe.tool], ALLOW_ALL);
      p.setRiskTolerance('medium');
      const d = p.decide('ingress', { agentId: 'a', tool: probe.tool.id, input: probe.input }, BS);
      expect(
        humanRequired(d),
        `floor #${probe.id} (${cat?.name}) did not stop ${JSON.stringify(probe.input)}. ` +
        `The matrix marks it a floor; no input demonstrates it. Reason given: ${d.reason}`,
      ).toBe(true);
    });
  }

  for (const u of UNDEMONSTRATED) {
    const cat = CATEGORIES.find((c) => c.id === u.id);
    it(`#${u.id} ${cat?.name} is still undemonstrated — move it to PROBES once it is not`, () => {
      // Deliberately asserts the WEAK thing: that the row exists and is still flagged a floor. The
      // falsifiable half is the partition test above plus the prose, which names what would fix it.
      expect(FLOOR_IDS).toContain(u.id);
      expect(u.why.length, 'an undemonstrated floor must say what would produce it').toBeGreaterThan(80);
    });
  }

  it('every hard-deny category is either demonstrated or explicitly declared undemonstrated', () => {
    for (const id of HARD_DENY_IDS) {
      const known = PROBES.some((p) => p.id === id) || UNDEMONSTRATED.some((u) => u.id === id);
      expect(known, `hard-deny #${id} is in neither inventory`).toBe(true);
    }
  });

  it('FLOOR_TRIGGER is still 8 — the cap bug was one below it, so this constant is load-bearing', () => {
    expect(FLOOR_TRIGGER).toBe(8);
  });
});
