// Token/resource Governor — soft+escalate (R&C O-1 / framework §5).
import type { AuditLog } from './audit';

export interface Budget { softUsd?: number; hardUsd?: number; softTokens?: number; hardTokens?: number; }
export type BudgetStatus = 'ok' | 'soft' | 'hard';

export class TokenGovernor {
  private usage = new Map<string, { usd: number; tokens: number }>();
  private paused = new Set<string>();
  constructor(private audit: AuditLog, private budgets: Map<string, Budget> = new Map()) {}

  setBudget(agentId: string, b: Budget): void { this.budgets.set(agentId, b); }

  record(agentId: string, addUsd: number, addTokens: number): BudgetStatus {
    const u = this.usage.get(agentId) ?? { usd: 0, tokens: 0 };
    u.usd += addUsd; u.tokens += addTokens; this.usage.set(agentId, u);
    const b = this.budgets.get(agentId);
    if (!b) return 'ok';
    const hard = (b.hardUsd !== undefined && u.usd >= b.hardUsd) || (b.hardTokens !== undefined && u.tokens >= b.hardTokens);
    if (hard) {
      this.paused.add(agentId);
      this.audit.append({ actor: agentId, domain: 'governance', action: 'budget-hard', decision: 'deny', reason: 'hard limit reached — agent paused + escalated' });
      return 'hard';
    }
    const soft = (b.softUsd !== undefined && u.usd >= b.softUsd) || (b.softTokens !== undefined && u.tokens >= b.softTokens);
    if (soft) {
      this.audit.append({ actor: agentId, domain: 'governance', action: 'budget-soft', reason: 'soft threshold reached — warning' });
      return 'soft';
    }
    return 'ok';
  }

  /** Current budget pressure WITHOUT recording usage — used by the router to pick a cheaper model. */
  status(agentId: string): BudgetStatus {
    if (this.paused.has(agentId)) return 'hard';
    const u = this.usage.get(agentId); const b = this.budgets.get(agentId);
    if (!u || !b) return 'ok';
    if ((b.hardUsd !== undefined && u.usd >= b.hardUsd) || (b.hardTokens !== undefined && u.tokens >= b.hardTokens)) return 'hard';
    if ((b.softUsd !== undefined && u.usd >= b.softUsd) || (b.softTokens !== undefined && u.tokens >= b.softTokens)) return 'soft';
    return 'ok';
  }

  /** Read-only per-scope view for the Bridge: every scope that has a budget OR recorded usage. */
  snapshot(): { scope: string; status: BudgetStatus; usd: number; tokens: number; usdLimit: number; tokensLimit: number }[] {
    const scopes = new Set<string>([...this.budgets.keys(), ...this.usage.keys()]);
    return [...scopes].map((scope) => {
      const u = this.usage.get(scope) ?? { usd: 0, tokens: 0 };
      const b = this.budgets.get(scope) ?? {};
      return { scope, status: this.status(scope), usd: u.usd, tokens: u.tokens, usdLimit: b.hardUsd ?? 0, tokensLimit: b.hardTokens ?? 0 };
    });
  }
  isPaused(agentId: string): boolean { return this.paused.has(agentId); }
  resume(agentId: string, by: string): void {
    this.paused.delete(agentId);
    this.audit.append({ actor: by, domain: 'governance', action: 'resume', target: agentId, reason: 'budget raised / human resume' });
  }
}
