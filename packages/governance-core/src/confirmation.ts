// H6 — distinct confirmation for critical asks (HARDENING_BACKLOG.md). Approval fatigue lets a
// reflexive click approve an irreversible action, so a decision is classed 'routine' or 'deliberate',
// and approving a deliberate one needs an explicit confirmation that a routine approve does not carry.
//
// The enforceable half lives here and in `DecisionBroker.resolve`: the class is DERIVED from the
// decision's tier and ask origin (a caller cannot supply or demote it), and the broker refuses to
// approve a deliberate decision without the confirmation. How a UI collects it (type-to-confirm, a
// native dialog, a held button) is the UI half and is not provable here.
import type { AskOrigin, RiskTier } from './types';

export type ConfirmationClass = 'routine' | 'deliberate';

export interface ConfirmationInput { riskTier?: RiskTier; askOrigin?: AskOrigin }

/** Deliberate when the PDP said a human is REQUIRED (a floor ask), when the tier is critical or
 *  injection, or when the tier is unknown (fail closed). Everything else is routine. Monotone: no
 *  combination with askOrigin 'floor' or tier critical/injection can come out routine. */
export function confirmationClass(i: ConfirmationInput): ConfirmationClass {
  if (i.askOrigin === 'floor') return 'deliberate';
  if (i.riskTier === undefined || i.riskTier === 'critical' || i.riskTier === 'injection') return 'deliberate';
  return 'routine';
}

/** What an approver must send back as `confirm` to approve a deliberate decision: the decision's tool
 *  label, so a type-to-confirm UI asks the person to type what they are approving. Deny never needs it. */
export function confirmationPhrase(d: { tool: string }): string {
  return d.tool;
}
