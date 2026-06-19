// The Policy Decision Point (PDP) — single choke point, bracketing transports on both faces.
// ingress = authorization (integrity → gate basics → risk → policy → combine); egress = containment.
// Audit-before-act on every decision. Deterministic: pure function of (input, policy, context).
import type { Decision, Face, ToolCall, BoundarySet, ToolDef, AgentDef, RiskTier } from './types';
import { isSecretPath, classifyPath, screenEnv, type SecretPolicy } from './secrets';
import type { Registry } from './registry';
import type { AuditLog } from './audit';
import { containCheck } from './boundary';
import { RiskEngine } from './risk';
import { PolicyEngine, type Effect } from './policy';
import { scanEgress } from './containment';

export interface TaskBinding { enforce: boolean; provider: { hasActiveTask(agentId: string, taskId?: string): boolean }; }
// verify-before-invoke: re-checks a skill's integrity at call time (tamper → not ok).
export interface IntegrityGate { verify(capabilityId: string): { ok: boolean; changed?: string[]; reason?: string }; }

export class PDP {
  private risk: RiskEngine;
  private policy: PolicyEngine;
  private taskBinding?: TaskBinding;
  private integrity?: IntegrityGate;
  private secretPolicy?: SecretPolicy;
  private secretGatekeeper?: string;
  private safeMode = false;
  private safeModeReason = '';
  constructor(
    private tools: Registry<ToolDef>,
    private agents: Registry<AgentDef>,
    private audit: AuditLog,
    risk?: RiskEngine,
    policy?: PolicyEngine,
    taskBinding?: TaskBinding,
    integrity?: IntegrityGate,
    secretPolicy?: SecretPolicy,
    secretGatekeeper?: string,
  ) {
    this.risk = risk ?? new RiskEngine();
    this.policy = policy ?? new PolicyEngine();
    this.taskBinding = taskBinding;
    this.integrity = integrity;
    this.secretPolicy = secretPolicy;
    this.secretGatekeeper = secretGatekeeper;
  }

  /** Lockdown: while in safe mode the PDP denies EVERYTHING (fail-closed) until the operator
   *  re-attests integrity and clears it. Used when boot self-integrity verification fails. */
  setSafeMode(on: boolean, reason = ''): void { this.safeMode = on; this.safeModeReason = on ? reason : ''; }
  isSafeMode(): boolean { return this.safeMode; }

  decide(face: Face, call: ToolCall, bs: BoundarySet): Decision {
    if (this.safeMode) {
      const sd: Decision = { allow: false, reason: `safe-mode: ${this.safeModeReason || 'governance integrity failure'}` };
      try { this.audit.append({ actor: call.agentId, domain: 'governance', action: `${face}:${call.tool}`, target: this.firstPath(call), decision: 'deny', reason: sd.reason }); } catch { /* already failing closed */ }
      return sd;
    }
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
    // verify-before-invoke: a tampered skill is denied + auto-quarantined (integrity gate audits Critical)
    if (this.integrity && call.capabilityId) {
      const iv = this.integrity.verify(call.capabilityId);
      if (!iv.ok) {
        const which = iv.changed && iv.changed.length ? ` (${iv.changed.join(', ')})` : '';
        return { allow: false, reason: `integrity: ${call.capabilityId} tampered${which} — quarantined`, riskTier: 'critical' };
      }
    }
    // task-bound purpose ("no task, no tool")
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
            // secret-scoped: reading .env / credentials is denied by default (explicit grant only)
            if (mode === 'read' && isSecretPath(v) && !this.secretPolicy?.allowReadByAgent(call.agentId, v)) {
              return { allow: false, riskTier: 'critical', reason: `secret-file access denied (${classifyPath(v).why}) — explicit operator grant required` };
            }
            // secret-scoped: ADD/MODIFY .env / credentials goes through the gatekeeper (Toby), content-screened.
            if (mode === 'write' && isSecretPath(v)) {
              if (call.agentId !== this.secretGatekeeper) return { allow: false, riskTier: 'critical', reason: `secret-file changes go through the gatekeeper (${this.secretGatekeeper ?? 'unset'}) — ${call.agentId} denied` };
              const content = typeof call.input.content === 'string' ? call.input.content : '';
              if (content) { const sc = screenEnv(content); if (!sc.ok) return { allow: false, riskTier: 'critical', reason: `poisoned .env rejected: ${sc.findings.join('; ')}` }; }
            }
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
    if (tier === 'injection') return { allow: false, reason: 'prompt-injection content — rejected (highest tier)', riskTier: tier };
    if (pol === 'deny') return { allow: false, reason: 'policy-deny', riskTier: tier };
    if (tier === 'critical') return { allow: false, ask: true, reason: 'critical — human approval required (no auto-allow)', riskTier: tier };
    if (tier === 'low') return { allow: true, reason: 'low-risk auto-allow', riskTier: tier };
    if (pol === 'allow') return { allow: true, reason: `${tier}-risk allowed by policy`, riskTier: tier };
    return { allow: false, ask: true, reason: `${tier}-risk escalated (no allow policy)`, riskTier: tier };
  }

  private egress(call: ToolCall): Decision {
    const result = typeof call.input.result === 'string' ? call.input.result : '';
    const scan = scanEgress(result);
    return scan.clean ? { allow: true, reason: 'egress-clear' } : { allow: false, reason: scan.reason! };
  }

  private firstPath(call: ToolCall): string | undefined {
    for (const v of Object.values(call.input)) if (typeof v === 'string') return v;
    return undefined;
  }
}
