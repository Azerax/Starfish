// UI <-> governance contract (ring 3).
// The renderer is PRESENTATION ONLY. It READS governed state through read-only views and
// REQUESTS actions that the PDP adjudicates. It never mutates governance state directly and
// imports no write paths. proposer != approver and all gating are enforced in the core, not here.
import type {
  AuditEvent, Decision, RiskTier, Task, TaskStatus,
  ServiceInfo, BudgetStatus, Finding, VettingReport,
} from '@starfish/governance-core';

// ---- Read views (DTOs the renderer renders) ----
export interface CrewMemberView {
  id: string;                 // internal agent id (themed via Theme.agents)
  role: string;
  status: 'active' | 'idle' | 'paused' | 'sweeping';
  currentTaskId?: string;
  riskTier?: RiskTier;
}

export type Verdict = 'allow' | 'deny' | 'ask';
export interface DecisionLogEntry {
  id: string; ts: string; actor: string; tool: string;
  target?: string; verdict: Verdict; reason: string; riskTier?: RiskTier;
}

export interface BudgetView {
  scope: string;              // 'global' | agentId
  status: BudgetStatus;
  usdUsed: number; usdLimit: number;
  tokensUsed: number; tokensLimit: number;
}

export interface MonitorView {
  lastSweepTs: string;
  counters: { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number; };
  findings: Finding[];
  reconciled: boolean;        // watcher report agrees with deterministic counters
}

export interface CapabilityView {
  id: string;
  kind: 'skill' | 'tool' | 'mcp' | 'hook';
  state: 'requested' | 'vetting' | 'quarantined' | 'registered' | 'rejected';
  report?: VettingReport;
}

export interface TaskView {
  task: Task;
  needsApproval: boolean;     // gate: risk high+ / proposer != approver
  proposer?: string;
}

// ---- Read surface (all read-only; subscribe for push updates) ----
export type Channel = 'decisions' | 'audit' | 'tasks' | 'services' | 'budgets' | 'monitor' | 'buffer';
export type Unsubscribe = () => void;

export interface GovernanceReadApi {
  getCrew(): Promise<CrewMemberView[]>;
  getDecisions(limit?: number): Promise<DecisionLogEntry[]>;
  getAudit(sinceSeq?: number): Promise<AuditEvent[]>;
  getTasks(status?: TaskStatus): Promise<TaskView[]>;
  getServices(): Promise<ServiceInfo[]>;
  getBudgets(): Promise<BudgetView[]>;
  getMonitor(): Promise<MonitorView>;
  getBuffer(): Promise<CapabilityView[]>;
  subscribe(channel: Channel, cb: (payload: unknown) => void): Unsubscribe;
}

// ---- Action path: the renderer REQUESTS; the PDP decides. ----
export type UiIntent =
  | { kind: 'task.approve'; taskId: string }
  | { kind: 'task.reject'; taskId: string; reason?: string }
  | { kind: 'task.advance'; taskId: string; to: TaskStatus }
  | { kind: 'budget.resume'; scope: string }
  | { kind: 'capability.approve'; capabilityId: string }
  | { kind: 'capability.quarantine'; capabilityId: string }
  | { kind: 'capability.reject'; capabilityId: string; reason?: string }
  | { kind: 'idea.promote'; nodeIds: string[] };

export interface ActionRequest { actor: string; intent: UiIntent; }   // actor = the human operator id
export interface ActionResult { decision: Decision; applied: boolean; }

export interface GovernanceActionApi {
  // Adjudicated by the PDP server-side. UI reflects decision.allow / ask / deny; nothing is
  // applied unless decision.allow is true (applied === true).
  requestAction(req: ActionRequest): Promise<ActionResult>;
}

// The full IPC bridge the Electron preload exposes to the renderer.
export interface GovernanceBridge extends GovernanceReadApi, GovernanceActionApi {
  readonly governed: true;   // marker: a renderer holding this bridge is always governed
}
