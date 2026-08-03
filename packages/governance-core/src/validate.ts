// Input-validation governor — a single, small, dependency-free place to validate a value against a
// fixed set of literal strings, instead of the hand-rolled ternary every call site used to write for
// itself. Built after two real, independently-found bugs turned out to be the SAME root cause wearing
// different clothes:
//   - packages/sdk/src/serve.ts's `/v1/decisions/:id` handler used to do
//     `body.verdict === 'deny' ? 'deny' : 'approve'` — checking for the RESTRICTIVE literal and
//     defaulting anything unrecognized (including the perfectly natural "denied") to the PERMISSIVE
//     outcome. A typo silently approved instead of denying.
//   - packages/desktop/src/projections.ts's decision-log view used to do
//     `e.decision === 'deny' ? 'deny' : 'allow'` on audit events, so an event with NO decision field at
//     all (reachable through the public `audit.append()` API, not just this package's own call sites)
//     rendered to the human operator as "allow" for something that was never actually adjudicated.
//
// Both bugs have the identical shape: the ternary checked for the wrong literal (the safe/restrictive
// one) and let anything else fall through to the dangerous default, instead of checking for the KNOWN-GOOD
// set and treating everything else as the exception. A written-out `includes()` check some call sites
// already use correctly (serve.ts's own RISK_TIERS, governance-core's tolerance.ts) doesn't have this
// failure mode — but nothing forced every call site to use that shape, so some didn't.
//
// Two entry points, matched to the two legitimate needs found across this codebase:
//   - assertEnum: for fields with NO safe default (a governance verdict — there is no value you'd be
//     comfortable silently substituting for "the caller sent something we don't recognize"). Throws.
//   - clampEnum: for fields that always need SOME value and have one demonstrably-safe fallback (a risk
//     tier defaulting to the strictest tier, a risk tolerance defaulting to Low). Never throws.
// Neither one is new behavior — they codify the two patterns already used correctly elsewhere in this
// codebase (RiskToleranceStore's `norm()`, serve.ts's RISK_TIERS clamp) so a future call site can reach
// for a tested helper instead of writing a fifth slightly-different ternary, some fraction of which will
// eventually get the direction backwards again.

export class InvalidEnumValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEnumValueError';
  }
}

/** Returns `value` narrowed to `T[number]` iff it is EXACTLY one of `allowed`; throws
 *  InvalidEnumValueError otherwise. Use for fields where no default is safe to guess — the caller must
 *  fix their input, not have it silently reinterpreted. */
export function assertEnum<T extends readonly string[]>(value: unknown, allowed: T, fieldName: string): T[number] {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T[number];
  throw new InvalidEnumValueError(
    `${fieldName} must be exactly one of ${allowed.map((v) => JSON.stringify(v)).join('|')}, got ${JSON.stringify(value)}`,
  );
}

/** Returns `value` narrowed to `T[number]` iff it is EXACTLY one of `allowed`; otherwise returns
 *  `safeFallback` — never throws. Use only when `safeFallback` is genuinely the strictest/safest member
 *  of `allowed` (e.g. the highest risk tier, the lowest risk tolerance) so an unrecognized value degrades
 *  toward MORE scrutiny, never less. */
export function clampEnum<T extends readonly string[]>(value: unknown, allowed: T, safeFallback: T[number]): T[number] {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T[number];
  return safeFallback;
}
