// REACHABILITY — "is this control actually invoked by shipped code?"
//
// Why this file exists. The 2026-08-20 adversarial review found three separate defects with one shape:
// a correct, fully-tested module that NOTHING CALLS. `scope.ts` had 7 green tests and no production
// caller; `monitor.sweep()` was exercised only by its own conformance suite; `Registry.verifyIntegrity()`
// was called exactly once, from a test. Every one of them passed CI while being inert in the product.
//
// Conformance tests instantiate subsystems directly, so they prove a module WORKS. They cannot prove a
// module RUNS. This suite closes that gap by asserting, against source, that each enforcement control
// is referenced from a non-test file. A green suite is not evidence of an enforced control; this is.
//
// It is deliberately a source-level check rather than a runtime one: the failure mode is an absent call
// site, and only the source can testify to that.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGES = resolve(__dirname, '..', '..');   // <repo>/packages

/** Every shipped (non-test) .ts file under packages/, as {path, text}. */
function shippedSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e === 'dist' || e === 'out' || e.startsWith('.')) continue;
      const full = join(dir, e);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!e.endsWith('.ts') || e.endsWith('.d.ts')) continue;
      if (e.includes('.test.') || e.includes('.conformance.') || e.includes('.determinism.')) continue;
      out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(PACKAGES);
  return out;
}

const SOURCES = shippedSources();

/** Strip // and block comments so a source assertion tests CODE, not prose about the code. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Does any shipped file (other than the one that DEFINES it) reference this symbol? */
function calledFromProduction(symbol: string, definedIn: string): { ok: boolean; callers: string[] } {
  const callers = SOURCES
    .filter((s) => !s.path.replace(/\\/g, '/').endsWith(definedIn))
    .filter((s) => new RegExp(`\\b${symbol.replace('.', '\\.')}\\b`).test(s.text))
    .map((s) => s.path.replace(/\\/g, '/').split('/packages/')[1]);
  return { ok: callers.length > 0, callers };
}

describe('reachability — every enforcement control is invoked by shipped code, not only by tests', () => {
  it('sanity: the source scan actually found the packages', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    expect(SOURCES.some((s) => s.path.endsWith('pdp.ts'))).toBe(true);
  });

  // F-8 — the monitor's rules (probing, enumeration, boundary-escape, audit-vanished) and its
  // watcher-discrepancy reconciliation were dead code in the product. Now driven by the sidecar.
  it('F-8: monitor.sweep() is called from production', () => {
    const r = calledFromProduction('sweep', 'governance-core/src/monitor.ts');
    expect(r.ok, 'monitor.sweep() has no production caller — the monitor is dormant').toBe(true);
  });

  // F-7 — nothing re-checked tools.json/agents.json after boot, so an out-of-band edit went unnoticed.
  it('F-7: Registry.verifyIntegrity() is called from production', () => {
    const r = calledFromProduction('verifyIntegrity', 'governance-core/src/registry.ts');
    expect(r.ok, 'verifyIntegrity() has no production caller — registries are never re-attested').toBe(true);
  });

  // F-11 — the catastrophic-shell and egress-host floors lived only in the hooks overlay, so SDK and
  // sidecar consumers inherited neither. They must be referenced by the PDP itself.
  it('F-11: the catastrophic-shell floor is enforced in the PDP', () => {
    const pdp = SOURCES.find((s) => s.path.endsWith('pdp.ts'))!;
    expect(pdp.text).toMatch(/isCatastrophicShell/);
  });
  it('F-11: the egress host guard is enforced in the PDP', () => {
    const pdp = SOURCES.find((s) => s.path.endsWith('pdp.ts'))!;
    expect(pdp.text).toMatch(/isBlockedHost/);
  });

  // F-10 — CLOSED. scope.ts was the last known-inert module; `scopeissuer.ts` supplies the contract
  // issuer it needed and boot.ts now passes a real gate. This test previously asserted the GAP
  // (expected false); it now asserts the wiring, so the module can never silently fall inert again.
  it('F-10: scope non-deviation is wired into boot', () => {
    const boot = SOURCES.find((s) => s.path.endsWith('boot.ts'))!;
    expect(boot.text, 'boot.ts must construct a ScopeIssuer').toMatch(/new ScopeIssuer\(/);
    expect(boot.text, 'the PDP must receive a scope binding').toMatch(/scope\.binding\(\)/);
    // The posture must be DERIVED from the live gate. A hardcoded literal was the original defect:
    // it read as an honest disclosure while being unfalsifiable.
    //
    // NB: strip comments before asserting the literal is absent. The first version of this test
    // scanned raw source, so the comment in boot.ts that EXPLAINS the old `scopeNonDeviation: false`
    // defect tripped the check that the defect is gone — a test failing on its own documentation.
    // Worth keeping as a comment: an over-broad source assertion is its own kind of false signal.
    expect(stripComments(boot.text)).not.toMatch(/scopeNonDeviation:\s*(false|true)\b/);
    expect(boot.text).toMatch(/scopeNonDeviation:\s*scope\.enforce/);
  });
  it('F-10: the issuer is called from production, not only from tests', () => {
    const r = calledFromProduction('issue', 'governance-core/src/scopeissuer.ts');
    expect(r.ok, 'nothing issues scope contracts — the gate would deny every task-bound call').toBe(true);
  });

  // ---- v0.28: H5 input re-provenance ----
  //
  // Found by applying this suite's OWN question to a module it did not cover. `attest.ts` was
  // implemented, correct, audited when called, and called by nothing — a second instance of the
  // F-7/F-8/F-10 shape, one layer down, which this file existed to catch and did not because it
  // enumerated controls by hand. Both halves are asserted, because either alone is useless: a verify
  // with nothing stamping it always passes, and a stamp nothing verifies is dead weight.
  it('H5: input stamps are taken from production (the PICK half)', () => {
    const r = calledFromProduction('stampInputs', 'governance-core/src/scope.ts');
    expect(r.ok, 'nothing stamps task inputs — verifyInputs would always see an empty set and pass').toBe(true);
  });
  it('H5: input stamps are re-verified from production (the USE half)', () => {
    const r = calledFromProduction('verifyInputs', 'governance-core/src/scope.ts');
    expect(r.ok, 'nothing re-verifies task inputs — the TOCTOU guard is dormant').toBe(true);
  });
  it('H5: the PDP is the enforcement point for both halves', () => {
    const pdp = SOURCES.find((s) => s.path.replace(/\\/g, '/').endsWith('governance-core/src/pdp.ts'));
    expect(pdp).toBeDefined();
    expect(pdp!.text).toMatch(/verifyInputs/);
    expect(pdp!.text).toMatch(/stampInputs/);
  });
});

// ===========================================================================
// THE INVENTORY OF WHAT IS BUILT AND NOT YET WIRED
// ===========================================================================
//
// Every assertion above asks "is this control reached?" and fails if it is not. That is the right
// question for a control that is SUPPOSED to be live, and the wrong one for a module deliberately
// landed ahead of its call site — which `inquiry.ts`, `controlplane.ts` and now `completion.ts` all
// are, each for a stated reason in its ADR.
//
// Saying nothing is not an option: an unwired module that nobody has written down is precisely the
// F-7/F-8/F-10 defect class, and it is found by an auditor rather than by CI. But a prose disclosure
// is the F-10 shape — v0.27.0 shipped a hardcoded flag that "read as an honest disclosure while being
// unfalsifiable", and a comment saying "not wired yet" rots into a lie the moment it IS wired, with
// nothing to notice.
//
// So the disclosure is a list, and the list is TESTED IN BOTH DIRECTIONS:
//
//   * every entry must still be unreached — once a module acquires a production caller the test FAILS
//     and tells you to delete the entry. The claim cannot go stale in the safe-looking direction.
//   * every entry must name a milestone that appears in the plan — a module cannot be parked here
//     indefinitely without a committed plan to wire it.
//   * every entry's file must exist — a deleted module leaves no ghost claim behind.
//
// WHY THE BARREL IS EXCLUDED. `index.ts` re-exports all three of these modules, so the naive
// `calledFromProduction` check finds a "caller" in shipped source and passes. A re-export is not a
// call site; it is what made these modules look reachable in the first place. Counting it would have
// made this entire file agree that `inquiry.ts` was wired.

interface AwaitingWiring {
  /** Path suffix of the module, as `calledFromProduction` expects. */
  module: string;
  /** The symbol a production caller would have to reference for this module to be live. */
  entryPoint: string;
  /** The ADR that states the module ships ahead of its caller, and why. */
  adr: string;
  /** The milestone that commits to wiring it. Must appear in docs/design/CONTROL_PLANE_PLAN.md. */
  milestone: string;
}

const AWAITING_WIRING: readonly AwaitingWiring[] = Object.freeze([
  {
    module: 'governance-core/src/inquiry.ts', entryPoint: 'askGoverned',
    adr: '0002-semantic-signal-boundary.md', milestone: 'M1.2',
  },
  {
    module: 'governance-core/src/controlplane.ts', entryPoint: 'forwardGoverned',
    adr: '0002-semantic-signal-boundary.md', milestone: 'M1.2',
  },
  {
    module: 'governance-core/src/completion.ts', entryPoint: 'CompletionLedger',
    adr: '0003-completion-receipt.md', milestone: 'M1.2',
  },
]);

/** As `calledFromProduction`, but a barrel re-export does not count as a caller. */
function reachedExcludingBarrel(symbol: string, definedIn: string): { ok: boolean; callers: string[] } {
  const callers = SOURCES
    .map((s) => ({ ...s, rel: s.path.replace(/\\/g, '/') }))
    .filter((s) => !s.rel.endsWith(definedIn))
    .filter((s) => !/\/index\.ts$/.test(s.rel))
    .filter((s) => new RegExp(`\\b${symbol.replace('.', '\\.')}\\b`).test(stripComments(s.text)))
    .map((s) => s.rel.split('/packages/')[1]);
  return { ok: callers.length > 0, callers };
}

describe('reachability — the inventory of built-but-unwired modules is accurate', () => {
  it('the inventory is not empty for the wrong reason (the list itself is loaded)', () => {
    expect(AWAITING_WIRING.length).toBeGreaterThan(0);
  });

  for (const e of AWAITING_WIRING) {
    it(`${e.module} exists (no ghost claim about a deleted module)`, () => {
      const found = SOURCES.some((s) => s.path.replace(/\\/g, '/').endsWith(e.module));
      expect(found, `${e.module} is listed as awaiting wiring but does not exist — delete the entry`).toBe(true);
    });

    // The falsifiable half. This test is DESIGNED to fail the moment the module is wired.
    it(`${e.module} is still unwired — delete its entry the moment it is not`, () => {
      const r = reachedExcludingBarrel(e.entryPoint, e.module);
      expect(
        r.ok,
        `${e.entryPoint} NOW HAS a production caller (${r.callers.join(', ')}). That is good news: ` +
        `remove ${e.module} from AWAITING_WIRING and add a positive reachability assertion for it above.`,
      ).toBe(false);
    });

    it(`${e.module} names a milestone that the plan actually commits to`, () => {
      const plan = readFileSync(resolve(PACKAGES, '..', 'docs', 'design', 'CONTROL_PLANE_PLAN.md'), 'utf8');
      expect(
        plan.includes(e.milestone),
        `${e.module} is parked under ${e.milestone}, which the plan does not mention`,
      ).toBe(true);
    });

    it(`${e.module} points at an ADR that exists`, () => {
      const adr = resolve(PACKAGES, '..', 'docs', 'adr', e.adr);
      expect(() => readFileSync(adr, 'utf8'), `${e.adr} is referenced but missing`).not.toThrow();
    });
  }
});
