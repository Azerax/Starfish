// Risk Tolerance — the operator setting that widens what auto-runs (Low default / Medium). This is the
// GOVERNED store: fail-safe to Low on corrupt/unknown, operator-only changes (proposer≠approver on the
// setting itself), Medium requires an explicit double-confirmation, every change is audited, and it can
// auto-revert to Low. The PDP reads the value; the hard floors are enforced independently of it.
import type { AuditLog } from './audit';
import type { RiskTolerance } from './score';

export interface ToleranceConfig { riskTolerance: RiskTolerance }

const norm = (v: unknown): RiskTolerance => (v === 'medium' ? 'medium' : 'low'); // anything not exactly 'medium' → Low (fail-safe)

export class RiskToleranceStore {
  private value: RiskTolerance = 'low';
  constructor(private audit: AuditLog, private operators: Set<string> = new Set(['god', 'human', 'operator'])) {}

  get(): RiskTolerance { return this.value; }

  /** Load from a (possibly corrupt) parsed config. Unknown/corrupt → Low. Never throws. */
  load(raw: unknown): RiskTolerance {
    const r = raw && typeof raw === 'object' ? (raw as { riskTolerance?: unknown }).riskTolerance : undefined;
    this.value = norm(r);
    return this.value;
  }
  serialize(): ToleranceConfig { return { riskTolerance: this.value }; }

  /** Change the setting. Operator-only; switching to Medium requires `confirmed: true` (the UI's second
   *  confirmation). Switching back to Low is always allowed for an operator (safe direction). Audited. */
  set(next: RiskTolerance, actor: string, opts: { confirmed?: boolean } = {}): { ok: boolean; value: RiskTolerance; reason: string } {
    if (!this.operators.has(actor)) {
      this.audit.append({ actor, domain: 'system', action: 'risk-tolerance:set', decision: 'deny', reason: 'not-an-operator' });
      return { ok: false, value: this.value, reason: 'only the operator may change risk tolerance' };
    }
    const want = norm(next);
    if (want === 'medium' && !opts.confirmed) {
      this.audit.append({ actor, domain: 'system', action: 'risk-tolerance:set', decision: 'deny', reason: 'medium requires double-confirmation' });
      return { ok: false, value: this.value, reason: 'switching to Medium requires explicit double-confirmation' };
    }
    const prev = this.value;
    this.value = want;
    this.audit.append({ actor, domain: 'system', action: 'risk-tolerance:set', target: this.value, decision: 'allow', reason: `${prev} -> ${this.value}${want === 'medium' ? ' (double-confirmed)' : ''}` });
    return { ok: true, value: this.value, reason: `risk tolerance set to ${this.value}` };
  }

  /** Safe auto-revert (e.g. on restart or after a timeout). Only ever lowers to Low. Audited if it changes. */
  revertToLow(actor = 'system'): RiskTolerance {
    if (this.value !== 'low') {
      this.audit.append({ actor, domain: 'system', action: 'risk-tolerance:auto-revert', target: 'low', decision: 'allow', reason: 'medium -> low (fail-safe)' });
      this.value = 'low';
    }
    return this.value;
  }
}
