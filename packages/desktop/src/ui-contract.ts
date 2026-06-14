// UI <-> governance contract (ring 3).
// The renderer is PRESENTATION ONLY. It READS governed state through read-only views and
// REQUESTS actions that the PDP adjudicates. It never mutates governance state directly and
// imports no write paths. proposer != approver and all gating are enforced in the core, not here.
import type {
  AuditEvent, Decision, RiskTier, Task, TaskStatus,
  ServiceInfo, BudgetStatus, Finding, VettingReport,
} from '@starfish/governance-core';

export interface CrewMemberView {
  id: string; role: string;
  status: 'active' | 'idle' | 'paused' | 'sweeping';
  currentTaskId?: string; riskTier?: RiskTier;
}
export type Verdict = 'allow' | 'deny' | 'ask';
export interface DecisionLogEntry {
  id: string; ts: string; actor: string; tool: string;
  target?: string; verdict: Verdict; reason: string; riskTier?: RiskTier;
}
export interface BudgetView { scope: string; status: BudgetStatus; usdUsed: number; usdLimit: number; tokensUsed: number; tokensLimit: number; }
export interface MonitorView {
  lastSweepTs: string;
  counters: { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number };
  findings: Finding[]; reconciled: boolean;
}
export interface CapabilityView { id: string; kind: 'skill' | 'tool' | 'mcp' | 'hook'; state: 'requested' | 'vetting' | 'quarantined' | 'registered' | 'rejected'; report?: VettingReport; }
export interface TaskView { task: Task; needsApproval: boolean; proposer?: string; }

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

export type UiIntent =
  | { kind: 'task.approve'; taskId: string }
  | { kind: 'task.reject'; taskId: string; reason?: string }
  | { kind: 'task.advance'; taskId: string; to: TaskStatus }
  | { kind: 'budget.resume'; scope: string }
  | { kind: 'capability.approve'; capabilityId: string }
  | { kind: 'capability.quarantine'; capabilityId: string }
  | { kind: 'capability.reject'; capabilityId: string; reason?: string }
  | { kind: 'idea.promote'; nodeIds: string[] };
export interface ActionRequest { actor: string; intent: UiIntent; }
export interface ActionResult { decision: Decision; applied: boolean; }
export interface GovernanceActionApi { requestAction(req: ActionRequest): Promise<ActionResult>; }

// ---- Onboarding (first-run). The intake step routes through the governed default-skills flow. ----
export interface OnboardingState { done: boolean; operator?: string; theme?: string; }
export interface DefaultSkillView { id: string; kind: string; category: string; summary: string; expectedRisk: RiskTier | string; plugin: string; recommended?: boolean; }
export interface CompleteOnboardingInput { operator: string; theme: string; enabledIds: string[]; }
export interface OnboardingResult { registered: string[]; quarantined: string[]; approved: string[]; missing: string[] }
export interface OnboardingApi {
  getOnboarding(): Promise<OnboardingState>;
  getDefaultSkills(): Promise<DefaultSkillView[]>;
  // Persists operator/theme, marks onboarded, and runs governDefaults (vet -> CapabilityLedger,
  // consenting to enabledIds). Nothing is registered except via that governed path.
  completeOnboarding(input: CompleteOnboardingInput): Promise<OnboardingResult>;
}

export interface GovernanceBridge extends GovernanceReadApi, GovernanceActionApi, OnboardingApi {
  readonly governed: true;
}
