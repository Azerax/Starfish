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
});
