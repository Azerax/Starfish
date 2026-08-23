// The Policy Decision Point (PDP) — single choke point, bracketing transports on both faces.
// ingress = authorization (integrity → gate basics → risk → policy → combine); egress = containment.
// Audit-before-act on every decision. Deterministic: pure function of (input, policy, context).
import type { Decision, Face, ToolCall, BoundarySet, ToolDef, AgentDef, RiskTier } from './types';
import type { ScopeVerdict } from './scope';
import { assessmentFromTier, type RiskAssessment } from './score';
import { isSecretPath, classifyPath, screenEnv, commandReadsSecret, type SecretPolicy } from './secrets';
import type { Registry } from './registry';
import type { AuditLog } from './audit';
import { containCheck } from './boundary';
import { RiskEngine } from './risk';
import { PolicyEngine, type Effect } from './policy';
import { scanEgress } from './containment';
import { isCatastrophicShell, commandStrings } from './shellguard';
import { isBlockedHost } from './netguard';
import { ExecProvenance } from './execprovenance';

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
  /** Q12: per-task record of writes a test runner would later execute. See execprovenance.ts. */
  readonly execProvenance = new ExecProvenance();
  /** Q4: deny agents that declare no capability allowlist, instead of granting them everything. */
  private strictAgentAllowlist = false;
  private unrestrictedNoted = new Set<string>();
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

  /** Q4: when on, an agent that declares no `allowedTools` is denied rather than granted everything.
   *  Off by default for backward compatibility; the permissive case is audited either way. */
  setStrictAgentAllowlist(on: boolean): void { this.strictAgentAllowlist = on; }
  isStrictAgentAllowlist(): boolean { return this.strictAgentAllowlist; }

  /** Operator Risk Tolerance. Low (default): only low-tier auto-runs. Medium: composite ≤70 auto-runs.
   *  Hard floors, injection, and critical are unaffected (checked before the tolerance widening). */
  setRiskTolerance(t: 'low' | 'medium'): void { this.riskTolerance = t === 'medium' ? 'medium' : 'low'; }
  getRiskTolerance(): 'low' | 'medium' { return this.riskTolerance; }

  decide(face: Face, call: ToolCall, bs: BoundarySet): Decision {
    if (this.safeMode) {
      const sd: Decision = { allow: false, reason: `safe-mode: ${this.safeModeReason || 'governance integrity failure'}` };
      try { this.audit.append({ actor: call.agentId, domain: 'governance', action: `${face}:${call.tool}`, target: this.resourceOf(call), decision: 'deny', reason: sd.reason }); } catch { /* already failing closed */ }
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
        target: this.resourceOf(call),
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
      // Sanctity invariant 4 — memory content can NEVER authorize a tool call. A call whose
      // parameters came out of a governed-memory read may only read; anything that writes, executes,
      // or reconfigures is denied outright, no matter how convincing the stored text was. This is
      // the terminal mitigation for stored prompt injection (T2): even if a poisoned page survives
      // write screening AND read screening, the action it is arguing for cannot happen.
      if (call.memoryDerived && tool.category !== 'read') {
        return {
          allow: false, riskTier: 'injection',
          reason: `memory-derived input cannot authorize a ${tool.category} tool (memory is data, not instructions)`,
        };
      }
      if (tool.allowedAgents !== '*' && !tool.allowedAgents.includes(call.agentId)) {
        return { allow: false, reason: 'agent-not-authorized' };
      }
      // F7: enforce the agent's OWN capability allowlist, not only the tool's allowedAgents. This was
      // declared on AgentDef, shown in the UI as "deny-by-default otherwise", and never checked — so a
      // read-only agent (e.g. thucydides, allowedTools:['memory.read']) could call fs.read (a `*` tool)
      // and the "Thucydides reads memory only" invariant was cosmetic. Backward-compatible: an agent
      // that declares NO allowedTools is unrestricted (unchanged); only a declared, non-empty allowlist
      // is enforced. The seed's own agents were reconciled so their lists cover what they legitimately call.
      const agentDef = this.agents.get(call.agentId);
      const hasAllowlist = !!agentDef?.allowedTools && agentDef.allowedTools.length > 0;
      if (hasAllowlist && !agentDef!.allowedTools!.includes(call.tool)) {
        return { allow: false, reason: `tool not in ${call.agentId}'s capability allowlist (deny-by-default)` };
      }
      // Q4 — "what authority increases when configuration is absent?" An agent that declares NO
      // allowedTools is UNRESTRICTED here: adding an allowlist restricts, omitting one grants. That
      // asymmetry is deliberate backward compatibility (declared on AgentDef long before it was
      // enforced), but it was also invisible — exactly the "absence reads as configured" shape that
      // F-1, F-4 and F-10 all turned out to be.
      // Two changes, no breakage: `strictAgentAllowlist` makes an undeclared allowlist deny-by-
      // default for operators who want it, and otherwise the grant is AUDITED ONCE per agent so it
      // is a visible fact an operator can read rather than an unexamined default.
      if (!hasAllowlist) {
        if (this.strictAgentAllowlist) {
          return { allow: false, reason: `${call.agentId} declares no capability allowlist and strict mode is on (deny-by-default)` };
        }
        if (!this.unrestrictedNoted.has(call.agentId)) {
          this.unrestrictedNoted.add(call.agentId);
          try {
            this.audit.append({
              actor: call.agentId, domain: 'governance', action: 'agent-unrestricted', target: call.agentId, riskTier: 'medium',
              reason: `${call.agentId} declares no allowedTools, so every registered tool is permitted to it — declare an allowlist, or set strictAgentAllowlist`,
            });
          } catch { /* the decision's own audit below fails closed independently */ }
        }
      }
      // F-11 — HARD FLOORS, enforced here so EVERY surface inherits them, not just the Claude Code
      // overlay. These ran only in @starfish/governance-hooks, so an SDK or `starfish serve` consumer
      // got neither. They sit ahead of risk scoring, policy and tolerance: nothing downstream can lift
      // them. The hooks package still pre-filters, so overlay behaviour is unchanged.
      if (tool.category === 'exec') {
        for (const s of commandStrings(call.input)) {
          if (isCatastrophicShell(s)) {
            return { allow: false, riskTier: 'critical', reason: 'catastrophic shell command blocked (hard floor)' };
          }
        }
      }
      if (tool.category === 'network') {
        for (const s of commandStrings(call.input)) {
          if (isBlockedHost(s)) {
            return { allow: false, riskTier: 'critical', reason: 'blocked internal/loopback/metadata destination (hard floor)' };
          }
        }
      }
      // non-deviation: the task's Scope Contract narrows the agent's general grants (D1 tool, D2 path,
      // D3 command, D4 budget). A deviation is denied; the monitor treats it as a trust-revoking event.
      if (this.scopeGate?.enforce) {
        const paths: string[] = [];
        for (const key of tool.pathParams) { const v = call.input[key]; if (typeof v === 'string') paths.push(v); }
        const sv = this.scopeGate.provider.check(call, paths);
        if (!sv.ok) return { allow: false, riskTier: 'high', reason: `scope-deviation${sv.deviation ? ` (${sv.deviation})` : ''}: ${sv.reason}` };
      }
      // F9: 'meta' previously skipped containment + secret checks entirely (mode=null). Harmless while
      // every meta tool declares pathParams:[], but a future meta tool that takes a path would get zero
      // boundary/secret checking. Treat any path a meta tool DOES declare as a write (the strict, fail-
      // safe direction); tools with no pathParams are unaffected because the loop never runs.
      const mode = tool.category === 'read' ? 'read' : 'write';
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
      // F1: exec/shell tools declare pathParams:[], so the containment + secret loop above never ran —
      // a raw `cat ~/.ssh/id_rsa` reached the risk scorer with no secret screening and, at Medium
      // tolerance, auto-allowed silently. Screen exec-tool string inputs for a secret-file READ and
      // force ASK (a human) — tolerance-independent, so it can never be a silent auto-allow. This is a
      // floor: it does not hard-deny (which would break legitimate `.env` workflows on a false match),
      // it removes the ability to auto-run without a human seeing it.
      if (tool.category === 'exec') {
        for (const v of Object.values(call.input)) {
          if (typeof v === 'string' && commandReadsSecret(v)) {
            return { allow: false, ask: true, askOrigin: 'floor', riskTier: 'critical', reason: 'shell command reads a secret path — human approval required (no auto-allow)' };
          }
        }
        // Q12 — SELF-AUTHORED EXECUTION. The shortest verified chain from model output to an
        // irreversible host effect was two hops with no human: write `evil.test.js` (medium, auto-
        // allowed at Medium tolerance), then `run_tests` (high, also auto-allowed) — and `node --test`
        // executes whatever it discovers, including the file just written. Neither hop subverts
        // anything; only the SEQUENCE is the attack, which is why per-call scoring never caught it.
        // If this task authored code the runner would execute, a human must see it. Same floor
        // pattern as the secret-read check above: not a denial (writing a test then running it is
        // legitimate work), but tolerance can no longer close the loop unattended.
        const selfAuthored = this.execProvenance.selfAuthored(call.taskId, call.tool);
        if (selfAuthored.length) {
          const shown = selfAuthored.slice(0, 3).join(', ');
          return {
            allow: false, ask: true, askOrigin: 'floor', riskTier: 'critical',
            reason: `self-authored execution: this task wrote ${selfAuthored.length} file(s) the runner would execute (${shown}${selfAuthored.length > 3 ? ', …' : ''}) — human approval required (no auto-allow)`,
          };
        }
      }
    } catch {
      return { allow: false, reason: 'evaluator-error (fail-closed)' };
    }
    const tier = this.risk.classify(call, tool);
    const assessment = this.risk.assess(call, tool);
    const pol = this.policy.evaluate(`agent:${call.agentId}`, `tool:${call.tool}`, this.resourceOf(call, tool) ?? '*');
    const decision = this.combine(tier, pol, assessment);
    // Q12: record an ALLOWED write of a runner-executable file against this task, so a later exec by
    // the same task is recognised as self-authored. Recorded only on allow — a denied write never
    // reached disk and must not taint the task. See execprovenance.ts.
    if (decision.allow && tool.category !== 'read') {
      for (const key of tool.pathParams) {
        const v = call.input[key];
        if (typeof v === 'string') this.execProvenance.note(call.taskId, v);
      }
    }
    return decision;
  }

  // Risk Tolerance widening only ever turns an ASK into an ALLOW for mid-risk work, and only when no hard
  // floor is tripped. Low ceiling 30 == the low tier (already auto-allowed), so at Low there is ZERO
  // behaviour change; Medium (ceiling 70) additionally auto-runs the medium/high band. injection + critical
  // + policy-deny are resolved BEFORE the widening, so tolerance can never lift them.
  private combine(tier: RiskTier, pol: Effect | 'nomatch', assessment?: RiskAssessment): Decision {
    const score = assessment?.score;
    if (tier === 'injection') return { allow: false, reason: 'prompt-injection content — rejected (highest tier)', riskTier: tier, score };
    if (pol === 'deny') return { allow: false, reason: 'policy-deny', riskTier: tier, score };
    // F-3: a critical ask is a FLOOR — no downstream friction profile may satisfy it automatically.
    if (tier === 'critical') return { allow: false, ask: true, askOrigin: 'floor', reason: 'critical — human approval required (no auto-allow)', riskTier: tier, score };
    // F8: an explicit operator 'ask' rule must be honoured even for a low-tier tool. Previously the
    // low-tier auto-allow below returned first, silently discarding an operator's request for review.
    // F-3: tagged 'policy' — this is the operator asking BY NAME and must outrank any relaxation.
    if (pol === 'ask') return { allow: false, ask: true, askOrigin: 'policy', reason: 'policy requires human review (ask)', riskTier: tier, score };
    if (tier === 'low') return { allow: true, reason: 'low-risk auto-allow', riskTier: tier, score };
    if (pol === 'allow') return { allow: true, reason: `${tier}-risk allowed by policy`, riskTier: tier, score };
    const ceiling = this.riskTolerance === 'medium' ? 70 : 30;
    if (assessment && !assessment.hardDeny && assessment.floors.length === 0 && assessment.score <= ceiling) {
      return { allow: true, reason: `${tier}-risk auto-allowed under ${this.riskTolerance} risk tolerance (score ${assessment.score})`, riskTier: tier, score };
    }
    // F-3: a plain tier escalation with a floor tripped is still a floor; otherwise it is routine risk.
    const origin: 'risk' | 'floor' = assessment && (assessment.hardDeny || assessment.floors.length > 0) ? 'floor' : 'risk';
    return { allow: false, ask: true, askOrigin: origin, reason: `${tier}-risk escalated (no allow policy)`, riskTier: tier, score };
  }

  private egress(call: ToolCall): Decision {
    const result = typeof call.input.result === 'string' ? call.input.result : '';
    const scan = scanEgress(result);
    return scan.clean ? { allow: true, reason: 'egress-clear' } : { allow: false, reason: scan.reason! };
  }

  // F6: the policy resource must be the tool's DECLARED path, not merely the first string-valued input
  // in JSON order. Previously an attacker could put a benign decoy first — `{note:'/project/ok',
  // path:'/etc/passwd'}` — so the call was adjudicated against a rule scoped to the decoy. When the tool
  // is known, resolve the resource from `tool.pathParams`; fall back to the first string only when the
  // tool declares no path params (or is unknown, as in the pre-resolution audit path).
  private resourceOf(call: ToolCall, tool?: ToolDef): string | undefined {
    if (tool && tool.pathParams.length) {
      for (const key of tool.pathParams) { const v = call.input[key]; if (typeof v === 'string') return v; }
      return undefined;   // tool declares paths but none supplied → no resource (matches '*' rules only)
    }
    // Q2 (adversarial review): the fallback below is "first string-valued input in JSON order", which
    // is the decoy weakness F6 fixed for tools that DECLARE pathParams — but it survived here for
    // tools that declare none. Policy, risk scoring and the audit `target` all consume this one
    // value, so a wrong pick is wrong in three places at once AND they agree with each other, which
    // is worse than disagreeing. When the tool is known and declares no paths, prefer a
    // conventionally-named field over positional order so an attacker cannot steer adjudication by
    // reordering keys; fall back to first-string only when nothing recognisable is present.
    const PREFERRED = ['url', 'target', 'resource', 'command', 'cmd', 'path'];
    for (const key of PREFERRED) { const v = call.input[key]; if (typeof v === 'string' && v) return v; }
    for (const v of Object.values(call.input)) if (typeof v === 'string') return v;
    return undefined;
  }
}
