// Shared types for governance-core (ring 1).
export type Face = 'ingress' | 'egress';
export type RiskTier = 'low' | 'medium' | 'high' | 'critical' | 'injection';
// 'network' was already used by the seeded `net` tool but was missing from this union, so the
// declared type did not describe the shipped registry (SeedTool types `category` as a bare string,
// which hid it). Added for honesty. Deliberately NOT given an entry in risk.ts CATEGORY_TIER, so a
// network tool that declares no explicit riskTier still falls to 'critical' — the fail-safe default.
export type ToolCategory = 'read' | 'write' | 'exec' | 'meta' | 'network';

// `askOrigin` records WHY a decision became an ask, so a downstream friction profile can tell a
// routine risk-tier escalation ('risk') from an operator who explicitly demanded review ('policy')
// or a hard floor that must never be auto-satisfied ('floor'). Without it every ask looks identical
// and a relaxation profile silently overrides operator intent (adversarial review F-3).
export type AskOrigin = 'risk' | 'policy' | 'floor';
export interface Decision { allow: boolean; ask?: boolean; reason: string; riskTier?: RiskTier; score?: number; askOrigin?: AskOrigin; }

export interface ToolDef {
  id: string;
  category: ToolCategory;
  pathParams: string[];            // input keys that carry filesystem paths
  allowedAgents: string[] | '*';
  riskTier?: RiskTier;
}
export interface AgentDef { id: string; domain?: string; allowedTools?: string[]; riskTier?: RiskTier; }

export interface BoundarySet { visibility: string[]; write: string[]; deny?: string[]; }   // deny = subtrees forbidden even when inside a write/visibility root (e.g. .starfish governance)
export interface ToolCall {
  agentId: string;
  tool: string;
  input: Record<string, unknown>;
  /**
   * @deprecated v0.28 — becoming REQUIRED. GOVERNANCE.md principle 2 is "all work is a task", and an
   * untasked call cannot be correlated to anything, so this field is on a migration path:
   *
   *   v0.28  `taskBindingMode: 'observe'` available. Default stays 'off' — no behaviour change.
   *          Untasked calls are audited as `task-binding:untasked-call`, attributed to agent+tool.
   *   v0.29  default becomes 'observe'. Still admits untasked calls; now everyone sees who they are.
   *   v0.30  default becomes 'required', and this field becomes non-optional. `TaskBoundToolCall`
   *          becomes an alias of `ToolCall`.
   *
   * Promotion is gated on `pdp.taskBindingMigration().ready` holding across a release — see
   * taskmigration.ts. New code should use {@link TaskBoundToolCall} and pass a taskId today.
   */
  taskId?: string;
  capabilityId?: string;
  /** Provenance lineage: this call's parameters derive from content read out of governed memory.
   *  Sanctity invariant 4 — "memory content is data, not instructions, and can never authorize a
   *  tool call" — is enforced on this flag in the PDP. Stored prompt injection (T2) is the reason it
   *  exists: text written into a page before a screening rule existed is still there, and when an
   *  agent reads it back that text becomes context. Without lineage the PDP cannot tell a call the
   *  operator asked for from one a stored page talked the agent into. */
  memoryDerived?: boolean;
}

/**
 * A ToolCall that carries its task, which is what every call will be required to be from v0.30.
 *
 * This exists so new code can be strict TODAY without a breaking change to `ToolCall`. Accept this
 * type in new APIs; at v0.30 `ToolCall` gains the requirement and this becomes a plain alias, so
 * every call site written against it needs no edit. `InquiryRequest.taskId` (inquiry.ts) is already
 * required on the same reasoning.
 */
export type TaskBoundToolCall = ToolCall & { taskId: string };

/** Narrow an untrusted ToolCall to a TaskBoundToolCall. Returns undefined rather than throwing, so
 *  a caller decides whether a missing task is a deny or a legacy admission. */
export function asTaskBound(call: ToolCall): TaskBoundToolCall | undefined {
  return typeof call.taskId === 'string' && call.taskId.length > 0 ? (call as TaskBoundToolCall) : undefined;
}

// 'threat' (TIF-4, docs/design/THREAT_IMMUNITY_FABRIC_PLAN.md) — the Threat Evidence lifecycle's own
// domain (evidence.ts's EvidenceLifecycle: evidence:observe/reproduce/corroborate/approve/publish/
// deploy/retire/revoke/expire). Additive: existing domains and every existing consumer are unchanged.
// 'completion' (docs/adr/0003-completion-receipt.md) — the completion-receipt lifecycle
// (completion.ts: completion-opened / completion-advanced / completion-transition-refused). Its own
// domain rather than a reuse of 'task' because the subject is one EFFECT's observed outcome, not the
// task's state: a task can be open while an effect is verified, and vice versa. Additive.
export const AUDIT_DOMAINS = ['task','agent','tool','governance','memory','message','system','failure','threat','completion'] as const;
export type AuditDomain = typeof AUDIT_DOMAINS[number];

export interface AuditEvent {
  ts: string; seq: number; prevHash: string;
  actor: string; domain: AuditDomain; action: string;
  target?: string; decision?: 'allow' | 'deny'; reason?: string; riskTier?: RiskTier;
  detail?: Record<string, unknown>;
  hash: string;
}

export class GovernanceError extends Error {}
