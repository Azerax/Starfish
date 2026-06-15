// Model router — deterministic, governed, AUDITED selection of the WORKER model. It picks which
// provider/model executes a task by risk tier + task type + budget pressure. It NEVER affects
// governance decisions: the PDP, vetting, and boundary stay model-independent (determinism G-3).
// Same inputs => same model. High/critical tasks are NOT downshifted under budget pressure
// (correctness wins); everything else gets the cheap model when the budget is tight.
import type { RiskTier } from './types';
import type { AuditLog } from './audit';

export type BudgetState = 'ok' | 'soft' | 'hard';
export interface RouteContext { taskType?: string; riskTier?: RiskTier; tags?: string[]; budget?: BudgetState; }
export interface RouteRule { id: string; when: { taskType?: string; riskTier?: RiskTier; tag?: string; budget?: BudgetState }; use: { providerId: string; model: string }; }
export interface RoutingPolicy { rules: RouteRule[]; fallback: { providerId: string; model: string }; }
export interface ModelRouteResult { providerId: string; model: string; ruleId: string; }

export const DEFAULT_ROUTING: RoutingPolicy = {
  rules: [
    { id: 'critical-strong',   when: { riskTier: 'critical' }, use: { providerId: 'anthropic', model: 'claude-opus-4-8' } },
    { id: 'high-strong',       when: { riskTier: 'high' },     use: { providerId: 'anthropic', model: 'claude-opus-4-8' } },
    { id: 'budget-hard-cheap', when: { budget: 'hard' },       use: { providerId: 'anthropic', model: 'claude-haiku-4-5' } },
    { id: 'budget-soft-cheap', when: { budget: 'soft' },       use: { providerId: 'anthropic', model: 'claude-haiku-4-5' } },
    { id: 'low-cheap',         when: { riskTier: 'low' },      use: { providerId: 'anthropic', model: 'claude-haiku-4-5' } },
  ],
  fallback: { providerId: 'anthropic', model: 'claude-sonnet-4-6' },
};

export class ModelRouter {
  constructor(private policy: RoutingPolicy = DEFAULT_ROUTING, private audit?: AuditLog) {}
  select(ctx: RouteContext): ModelRouteResult {
    let chosen: ModelRouteResult | undefined;
    for (const r of this.policy.rules) if (this.matches(r.when, ctx)) { chosen = { providerId: r.use.providerId, model: r.use.model, ruleId: r.id }; break; }
    const res = chosen ?? { providerId: this.policy.fallback.providerId, model: this.policy.fallback.model, ruleId: 'fallback' };
    this.audit?.append({ actor: 'router', domain: 'system', action: 'model-selected', target: res.model, reason: `rule=${res.ruleId} provider=${res.providerId} tier=${ctx.riskTier ?? '-'} budget=${ctx.budget ?? 'ok'}` });
    return res;
  }
  private matches(w: RouteRule['when'], ctx: RouteContext): boolean {
    if (w.budget && w.budget !== (ctx.budget ?? 'ok')) return false;
    if (w.riskTier && w.riskTier !== ctx.riskTier) return false;
    if (w.taskType && w.taskType !== ctx.taskType) return false;
    if (w.tag && !(ctx.tags ?? []).includes(w.tag)) return false;
    return true;
  }
}
