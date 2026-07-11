// Risk Engine — deterministic classification (R&C Risk Registry; framework §5). `classify()` returns the
// 4-tier label (unchanged, backward-compatible); `assess()` returns the full 0–100 RiskAssessment from the
// single scorer (score.ts). The tier and composite are kept consistent by construction.
import type { RiskTier, ToolCall, ToolDef } from './types';
import { assessRisk, type RiskAssessment, type CategoryScores } from './score';

const RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3, injection: 4 };
const max = (a: RiskTier, b: RiskTier): RiskTier => (RANK[a] >= RANK[b] ? a : b);

const CRITICAL = /(rm\s+-rf|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777|sudo\s|\bpolicies\.json\b|\btools\.json\b|hive\/governance)/i;
const HIGH = /(curl|wget|https?:\/\/|fetch\(|payment|invoice|\bspend\b|transfer|git\s+push|npm\s+publish)/i;

// Composite target per tier (decade bands): low→20, medium→40, high→60, critical→90.
const TIER_BASE: Record<Exclude<RiskTier, 'injection'>, number> = { low: 2, medium: 4, high: 6, critical: 9 };

export class RiskEngine {
  classify(call: ToolCall, tool: ToolDef): RiskTier {
    const base: RiskTier = tool.riskTier
      ?? ({ read: 'low', meta: 'low', write: 'medium', exec: 'high' } as const)[tool.category];
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
    if (/\brm\b|\bdelete\b|drop\s+table|truncate|overwrite|unlink/i.test(text)) cats[6] = Math.min(cap, 7); // reversibility
    if (/upload|exfil|POST\s|multipart|attachment/i.test(text)) cats[12] = Math.min(cap, 7);          // exfiltration
    return assessRisk(cats);
  }
}
