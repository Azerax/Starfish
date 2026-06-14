// Shared types for governance-core (ring 1).
export type Face = 'ingress' | 'egress';
export type RiskTier = 'low' | 'medium' | 'high' | 'critical' | 'injection';
export type ToolCategory = 'read' | 'write' | 'exec' | 'meta';

export interface Decision { allow: boolean; ask?: boolean; reason: string; riskTier?: RiskTier; }

export interface ToolDef {
  id: string;
  category: ToolCategory;
  pathParams: string[];            // input keys that carry filesystem paths
  allowedAgents: string[] | '*';
  riskTier?: RiskTier;
}
export interface AgentDef { id: string; domain?: string; allowedTools?: string[]; riskTier?: RiskTier; }

export interface BoundarySet { visibility: string[]; write: string[]; }
export interface ToolCall { agentId: string; tool: string; input: Record<string, unknown>; taskId?: string; capabilityId?: string; }

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
