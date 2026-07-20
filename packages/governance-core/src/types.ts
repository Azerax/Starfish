// Shared types for governance-core (ring 1).
export type Face = 'ingress' | 'egress';
export type RiskTier = 'low' | 'medium' | 'high' | 'critical' | 'injection';
export type ToolCategory = 'read' | 'write' | 'exec' | 'meta';

export interface Decision { allow: boolean; ask?: boolean; reason: string; riskTier?: RiskTier; score?: number; }

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

export const AUDIT_DOMAINS = ['task','agent','tool','governance','memory','message','system','failure'] as const;
export type AuditDomain = typeof AUDIT_DOMAINS[number];

export interface AuditEvent {
  ts: string; seq: number; prevHash: string;
  actor: string; domain: AuditDomain; action: string;
  target?: string; decision?: 'allow' | 'deny'; reason?: string; riskTier?: RiskTier;
  detail?: Record<string, unknown>;
  hash: string;
}

export class GovernanceError extends Error {}
