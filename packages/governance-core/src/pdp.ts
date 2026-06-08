// The Policy Decision Point (PDP) — single choke point, bracketing transports on both faces.
// ingress = authorization (gate basics → risk → policy → combine); egress = result containment.
// Audit-before-act on every decision. Deterministic: pure function of (input, policy, context).
import type { Decision, Face, ToolCall, BoundarySet, ToolDef, AgentDef, RiskTier } from './types';
import type { Registry } from './registry';
import type { AuditLog } from './audit';
import { containCheck } from './boundary';
import { RiskEngine } from './risk';
import { PolicyEngine, type Effect } from './policy';

const SECRET = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

export class PDP {
  private risk: RiskEngine;
  private policy: PolicyEngine;
  private taskBinding?: { enforce: boolean; provider: { hasActiveTask(agentId: string, taskId?: string): boolean } };
  constructor(
    private tools: Registry<ToolDef>,
    private agents: Registry<AgentDef>,
    private audit: AuditLog,
    risk?: RiskEngine,
    policy?: PolicyEngine,
    taskBinding?: { enforce: boolean; provider: { hasActiveTask(agentId: string, taskId?: string): boolean } },
  ) {
    this.risk = risk ?? new RiskEngine();
    this.policy = policy ?? new PolicyEngine();
    this.taskBinding = taskBinding;
  }

  decide(face: Face, call: ToolCall, bs: BoundarySet): Decision {
    const d = face === 'egress' ? this.egress(call) : this.ingress(call, bs);
    try {
      this.audit.append({
        actor: call.agentId,
        domain: d.allow ? 'tool' : 'governance',
        action: `${face}:${call.tool}`,
        target: this.firstPath(call),
        decision: d.allow ? 'allow' : 'deny',
        reason: d.reason,
        riskTier: d.riskTier,
      });
    } catch {
      return { allow: false, reason: 'audit-write-failed (fail-closed)' };
    }
    return d;
  }

  private ingress(call: ToolCall, bs: BoundarySet): Decision {
    // task-bound purpose ("no task, no tool") — enforced when enabled (T-07 / framework §3.2)
    if (this.taskBinding?.enforce && !this.taskBinding.provider.hasActiveTask(call.agentId, call.taskId)) {
      return { allow: false, reason: 'no active task (no task, no tool)' };
    }
    let tool: ToolDef | undefined;
    try {
      tool = this.tools.get(call.tool);
      if (!tool) return { allow: false, reason: 'tool-not-registered (default-deny)' };
      if (tool.allowedAgents !== '*' && !tool.allowedAgents.includes(call.agentId)) {
        return { allow: false, reason: 'agent-not-authorized' };
      }
      const mode = tool.category === 'read' ? 'read' : tool.category === 'meta' ? null : 'write';
      if (mode) {
        for (const key of tool.pathParams) {
          const v = call.input[key];
          if (typeof v === 'string') {
            const r = containCheck(v, mode, bs);
            if (!r.allowed) return { allow: false, reason: `boundary: ${r.reason}` };
          }
        }
      }
    } catch {
      return { allow: false, reason: 'evaluator-error (fail-closed)' };
    }
    const tier = this.risk.classify(call, tool);
    const pol = this.policy.evaluate(`agent:${call.agentId}`, `tool:${call.tool}`, this.firstPath(call) ?? '*');
    return this.combine(tier, pol);
  }

  private combine(tier: RiskTier, pol: Effect | 'nomatch'): Decision {
    if (pol === 'deny') return { allow: false, reason: 'policy-deny', riskTier: tier };
    if (tier === 'critical') return { allow: false, ask: true, reason: 'critical — human approval required (no auto-allow)', riskTier: tier };
    if (tier === 'low') return { allow: true, reason: 'low-risk auto-allow', riskTier: tier };
    if (pol === 'allow') return { allow: true, reason: `${tier}-risk allowed by policy`, riskTier: tier };
    return { allow: false, ask: true, reason: `${tier}-risk escalated (no allow policy)`, riskTier: tier };
  }

  private egress(call: ToolCall): Decision {
    const result = typeof call.input.result === 'string' ? call.input.result : '';
    if (SECRET.test(result)) return { allow: false, reason: 'egress-blocked: secret material in output' };
    return { allow: true, reason: 'egress-clear' };
  }

  private firstPath(call: ToolCall): string | undefined {
    for (const v of Object.values(call.input)) if (typeof v === 'string') return v;
    return undefined;
  }
}
