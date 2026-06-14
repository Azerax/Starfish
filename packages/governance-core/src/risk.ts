// Risk Engine — deterministic 4-tier classification (R&C Risk Registry; framework §5).
import type { RiskTier, ToolCall, ToolDef } from './types';

const RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3, injection: 4 };
const max = (a: RiskTier, b: RiskTier): RiskTier => (RANK[a] >= RANK[b] ? a : b);

const CRITICAL = /(rm\s+-rf|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777|sudo\s|\bpolicies\.json\b|\btools\.json\b|hive\/governance)/i;
const HIGH = /(curl|wget|https?:\/\/|fetch\(|payment|invoice|\bspend\b|transfer|git\s+push|npm\s+publish)/i;

export class RiskEngine {
  classify(call: ToolCall, tool: ToolDef): RiskTier {
    const base: RiskTier = tool.riskTier
      ?? ({ read: 'low', meta: 'low', write: 'medium', exec: 'high' } as const)[tool.category];
    const text = JSON.stringify(call.input ?? {});
    if (CRITICAL.test(text)) return 'critical';
    if (HIGH.test(text)) return max(base, 'high');
    return base;
  }
}
