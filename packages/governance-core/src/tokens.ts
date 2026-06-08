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

  isPaused(agentId: string): boolean { return this.paused.has(agentId); }
  resume(agentId: string, by: string): void {
    this.paused.delete(agentId);
    this.audit.append({ actor: by, domain: 'governance', action: 'resume', target: agentId, reason: 'budget raised / human resume' });
  }
}
