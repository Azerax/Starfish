// The Policy Decision Point (PDP) — single choke point, bracketing transports on both faces.
// ingress = authorization (integrity → gate basics → risk → policy → combine); egress = containment.
// Audit-before-act on every decision. Deterministic: pure function of (input, policy, context).
import type { Decision, Face, ToolCall, BoundarySet, ToolDef, AgentDef, RiskTier } from './types';
import type { ScopeVerdict } from './scope';
import { assessmentFromTier, type RiskAssessment } from './score';
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
// non-deviation: the task's Scope Contract narrows the agent's general grants (D1–D4). The provider is
// stateful (it meters budget), so decide() stays a function of (input, contract-state).
export interface ScopeBinding { enforce: boolean; provider: { check(call: ToolCall, paths: string[]): ScopeVerdict }; }

export class PDP {
  private risk: RiskEngine;
  private policy: PolicyEngine;
  private taskBinding?: TaskBinding;
  private integrity?: IntegrityGate;
  private secretPolicy?: SecretPolicy;
  private secretGatekeeper?: string;
  private scopeGate?: ScopeBinding;
  private riskTolerance: 'low' | 'medium' = 'low';   // operator setting; default Low (deny-by-default posture)
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
    scopeGate?: ScopeBinding,
  ) {
    this.risk = risk ?? new RiskEngine();
    this.policy = policy ?? new PolicyEngine();
    this.taskBinding = taskBinding;
    this.integrity = integrity;
    this.secretPolicy = secretPolicy;
    this.secretGatekeeper = secretGatekeeper;
    this.scopeGate = scopeGate;
  }

  /** Lockdown: while in safe mode the PDP denies EVERYTHING (fail-closed) until the operator
   *  re-attests integrity and clears it. Used when boot self-integrity verification fails. */
  setSafeMode(on: boolean, reason = ''): void { this.safeMode = on; this.safeModeReason = on ? reason : ''; }
  isSafeMode(): boolean { return this.safeMode; }

  /** Operator Risk Tolerance. Low (default): only low-tier auto-runs. Medium: composite ≤70 auto-runs.
   *  Hard floors, injection, and critical are unaffected (checked before the tolerance widening). */
  setRiskTolerance(t: 'low' | 'medium'): void { this.riskTolerance = t === 'medium' ? 'medium' : 'low'; }
  getRiskTolerance(): 'low' | 'medium' { return this.riskTolerance; }

  decide(face: Face, call: ToolCall, bs: BoundarySet): Decision {
    if (this.safeMode) {
      const sd: Decision = { allow: false, reason: `safe-mode: ${this.safeModeReason || 'governance integrity failure'}` };
      try { this.audit.append({ actor: call.agentId, domain: 'governance', action: `${face}:${call.tool}`, target: this.firstPath(call), decision: 'deny', reason: sd.reason }); } catch { /* already failing closed */ }
      return sd;
    }
    const d = face === 'egress' ? this.egress(call) : this.ingress(call, bs);
    // one risk model: backfill the 0–100 composite from the tier so EVERY decision (incl. hard-floor
    // denials that short-circuit before scoring) carries a score from the single scorer (RM-3).
    if (d.score === undefined && d.riskTier) d.score = assessmentFromTier(d.riskTier).score;
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
      // non-deviation: the task's Scope Contract narrows the agent's general grants (D1 tool, D2 path,
      // D3 command, D4 budget). A deviation is denied; the monitor treats it as a trust-revoking event.
      if (this.scopeGate?.enforce) {
        const paths: string[] = [];
        for (const key of tool.pathParams) { const v = call.input[key]; if (typeof v === 'string') paths.push(v); }
        const sv = this.scopeGate.provider.check(call, paths);
        if (!sv.ok) return { allow: false, riskTier: 'high', reason: `scope-deviation${sv.deviation ? ` (${sv.deviation})` : ''}: ${sv.reason}` };
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
    const assessment = this.risk.assess(call, tool);
    const pol = this.policy.evaluate(`agent:${call.agentId}`, `tool:${call.tool}`, this.firstPath(call) ?? '*');
    return this.combine(tier, pol, assessment);
  }

  // Risk Tolerance widening only ever turns an ASK into an ALLOW for mid-risk work, and only when no hard
  // floor is tripped. Low ceiling 30 == the low tier (already auto-allowed), so at Low there is ZERO
  // behaviour change; Medium (ceiling 70) additionally auto-runs the medium/high band. injection + critical
  // + policy-deny are resolved BEFORE the widening, so tolerance can never lift them.
  private combine(tier: RiskTier, pol: Effect | 'nomatch', assessment?: RiskAssessment): Decision {
    const score = assessment?.score;
    if (tier === 'injection') return { allow: false, reason: 'prompt-injection content — rejected (highest tier)', riskTier: tier, score };
    if (pol === 'deny') return { allow: false, reason: 'policy-deny', riskTier: tier, score };
    if (tier === 'critical') return { allow: false, ask: true, reason: 'critical — human approval required (no auto-allow)', riskTier: tier, score };
    if (tier === 'low') return { allow: true, reason: 'low-risk auto-allow', riskTier: tier, score };
    if (pol === 'allow') return { allow: true, reason: `${tier}-risk allowed by policy`, riskTier: tier, score };
    const ceiling = this.riskTolerance === 'medium' ? 70 : 30;
    if (assessment && !assessment.hardDeny && assessment.floors.length === 0 && assessment.score <= ceiling) {
      return { allow: true, reason: `${tier}-risk auto-allowed under ${this.riskTolerance} risk tolerance (score ${assessment.score})`, riskTier: tier, score };
    }
    return { allow: false, ask: true, reason: `${tier}-risk escalated (no allow policy)`, riskTier: tier, score };
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
