// Risk Engine — deterministic classification (R&C Risk Registry; framework §5). `classify()` returns the
// 4-tier label (unchanged, backward-compatible); `assess()` returns the full 0–100 RiskAssessment from the
// single scorer (score.ts). The tier and composite are kept consistent by construction.
import type { RiskTier, ToolCall, ToolDef } from './types';
import { assessRisk, type RiskAssessment, type CategoryScores } from './score';
import { FLOOR_TRIGGER } from './riskmatrix';
import { classifyTarget } from './target';

const RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3, injection: 4 };
const max = (a: RiskTier, b: RiskTier): RiskTier => (RANK[a] >= RANK[b] ? a : b);

const CRITICAL = /(rm\s+-rf|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777|sudo\s|\bpolicies\.json\b|\btools\.json\b|hive\/governance)/i;
const HIGH = /(curl|wget|https?:\/\/|fetch\(|payment|invoice|\bspend\b|transfer|git\s+push|npm\s+publish)/i;

// ---------------------------------------------------------------------------
// Reversibility (#6) — split by signal STRENGTH. See pdp.floors.conformance.test.ts.
//
// The bug this fixes: every secondary category below was set to `Math.min(cap, 7)`, and FLOOR_TRIGGER
// is 8. One below. Category 6 is a declared FLOOR, so capping it at 7 meant the reversibility floor
// could never fire from the live path — and nothing else in the PDP checks reversibility at all.
// `DROP TABLE users` was auto-allowed under an allow policy. `rm -rf` was only ever caught because it
// sits on the CRITICAL list separately, not because the floor worked.
//
// Why a SPLIT rather than simply removing the cap. Uncapping would make every input containing the
// word "delete" force an approval, and approval fatigue is the open H6 item — a reflexive click on a
// noisy queue is not better than a silent allow, it just moves the failure. So:
//
//   STRONG = no benign reading in a tool input. Escalates to FLOOR_TRIGGER, forcing a human.
//   WEAK   = common in prose and in reversible operations. Composite signal only, capped as before.
//
// The split is deliberate and is pinned by a test, so a later tidy-up cannot quietly widen it.
const IRREVERSIBLE_STRONG = /(drop\s+(table|database|schema)\b|\btruncate\b|\bunlink\b|rm\s+-rf|\bshred\b|mkfs|dd\s+if=|\bformat\s+[a-z]:)/i;
const IRREVERSIBLE_WEAK = /(\brm\b|\bdelete\b|overwrite)/i;

// Composite target per tier (decade bands): low→20, medium→40, high→60, critical→90.
const TIER_BASE: Record<Exclude<RiskTier, 'injection'>, number> = { low: 2, medium: 4, high: 6, critical: 9 };

export class RiskEngine {
  classify(call: ToolCall, tool: ToolDef): RiskTier {
    // F10: an unknown tool category is the LEAST understood case and must fail-safe to the strictest
    // outcome, not the most permissive. Previously an unrecognised category with no explicit riskTier
    // produced `undefined` → composite 10 → low → auto-allow. Now it defaults to 'critical' (always
    // requires a human), and any category not in the map is treated the same way.
    const CATEGORY_TIER: Record<string, RiskTier> = { read: 'low', meta: 'low', write: 'medium', exec: 'high' };
    const base: RiskTier = tool.riskTier ?? CATEGORY_TIER[tool.category] ?? 'critical';
    const text = JSON.stringify(call.input ?? {});
    if (CRITICAL.test(text)) return 'critical';
    if (HIGH.test(text)) return max(base, 'high');
    return base;
  }

  /** The full assessment from the single scorer. The tier drives the composite band so the 0–100 score
   *  and the 4-tier label never disagree; category detail is added for transparency (capped so it stays
   *  in-band). Unification (all producers → assessRisk) continues in RM-3. */
  assess(call: ToolCall, tool: ToolDef): RiskAssessment {
    const tier = this.classify(call, tool);
    if (tier === 'injection') return assessRisk({}, { injection: true });
    const cap = TIER_BASE[tier];
    const primary = tool.category === 'exec' ? 8 : 1; // #8 execution capability, else #1 file/storage
    const cats: CategoryScores = { [primary]: cap };
    const text = JSON.stringify(call.input ?? {});
    if (/https?:\/\/|curl|wget|fetch\(|\.internal|\.local/i.test(text)) cats[2] = Math.min(cap, 7); // network
    if (/payment|invoice|\bspend\b|transfer|purchase/i.test(text)) cats[39] = Math.min(cap, 7);      // financial
    // #6 is a FLOOR, so a strong signal must be allowed to reach FLOOR_TRIGGER — capping a floor
    // category below its own trigger makes the floor decorative. Weak signals stay in-band.
    if (IRREVERSIBLE_STRONG.test(text)) cats[6] = Math.max(FLOOR_TRIGGER, Math.min(cap, 7));
    else if (IRREVERSIBLE_WEAK.test(text)) cats[6] = Math.min(cap, 7);
    if (/upload|exfil|POST\s|multipart|attachment/i.test(text)) cats[12] = Math.min(cap, 7);          // exfiltration
    // H3: #26 production vs non-production target. Only exec calls are classified, and only when the
    // command names a deployment target (target.ts). A consequential call against production reaches
    // FLOOR_TRIGGER, and #26 is a floor, so no allow policy or tolerance can auto-run it. A read-only
    // or dry-run call against production, and anything on staging, stays in-band as a signal.
    if (tool.category === 'exec') {
      // `command` when present; otherwise every string field, one per line (a line is a separate
      // command to the classifier), so an exec tool whose input is `cmd` or `script` is still read.
      const command = typeof call.input?.command === 'string'
        ? call.input.command
        : Object.values(call.input ?? {}).filter((v): v is string => typeof v === 'string').join('\n');
      const target = classifyTarget(command);
      if (target?.env === 'prod') cats[26] = target.consequential ? FLOOR_TRIGGER : Math.min(cap, 6);
      else if (target?.env === 'staging') cats[26] = Math.min(cap, 4);
    }
    return assessRisk(cats);
  }
}
