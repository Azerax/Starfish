// Renderer-side mirror of packages/desktop/src/ui-contract.ts (kept local so the renderer builds standalone).
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export type Verdict = 'allow' | 'deny' | 'ask';

export interface CrewMemberView { id: string; role: string; status: 'active' | 'idle' | 'paused' | 'sweeping'; currentTaskId?: string; riskTier?: RiskTier; }
export interface DecisionLogEntry { id: string; ts: string; actor: string; tool: string; target?: string; verdict: Verdict; reason: string; riskTier?: RiskTier; }
export interface BudgetView { scope: string; status: string; usdUsed: number; usdLimit: number; tokensUsed: number; tokensLimit: number; }
export interface MonitorView { lastSweepTs: string; counters: { denials: number; boundaryEscapes: number; hashMismatches: number; budgetHard: number; orphanPosts: number; casualties: number }; findings: unknown[]; reconciled: boolean; }
export interface CapabilityView { id: string; kind: string; state: string; }
export interface ActionRequest { actor: string; intent: { kind: string; [k: string]: unknown }; }
export interface ActionResult { decision: { allow: boolean; ask?: boolean; reason: string }; applied: boolean; }

export interface OnboardingState { done: boolean; operator?: string; theme?: string; }
export interface DefaultSkillView { id: string; kind: string; category: string; summary: string; expectedRisk: string; plugin: string; recommended?: boolean; }
export interface CompleteOnboardingInput { operator: string; theme: string; enabledIds: string[]; }
export interface OnboardingResult { registered: string[]; quarantined: string[]; approved: string[]; missing: string[]; }

export interface ProviderView { id: string; name: string; kind: string; model: string; baseUrl?: string; requiresKey: boolean; hasKey: boolean; dataEgress: boolean; }

export interface DeletionImpactView { tier: 'low' | 'medium' | 'high' | 'critical'; decision: 'allow' | 'ask' | 'deny'; hard: boolean; reversible: boolean; files: number; bytes: number; reasons: string[]; }
export interface TrashEntryView { id: string; originalPath: string; trashedAt: string; name: string; }
export interface DeleteResultView { ok: boolean; reason: string; impact: DeletionImpactView; trashedTo?: string; }

export interface GovernanceBridge {
  governed: true;
  getCrew(): Promise<CrewMemberView[]>;
  getDecisions(limit?: number): Promise<DecisionLogEntry[]>;
  getAudit(sinceSeq?: number): Promise<unknown[]>;
  getTasks(status?: string): Promise<unknown[]>;
  getServices(): Promise<unknown[]>;
  getBudgets(): Promise<BudgetView[]>;
  getMonitor(): Promise<MonitorView>;
  getBuffer(): Promise<CapabilityView[]>;
  subscribe(channel: string, cb: (p: unknown) => void): () => void;
  requestAction(req: ActionRequest): Promise<ActionResult>;
  getOnboarding(): Promise<OnboardingState>;
  getDefaultSkills(): Promise<DefaultSkillView[]>;
  completeOnboarding(input: CompleteOnboardingInput): Promise<OnboardingResult>;
  getProviders(): Promise<ProviderView[]>;
  getActiveProvider(): Promise<{ id: string; model: string }>;
  setActiveProvider(id: string, model?: string): Promise<{ ok: boolean }>;
  setProviderKey(id: string, key: string): Promise<{ ok: boolean; stored: 'keychain' | 'fallback' }>;
  assessDelete(path: string, recursive?: boolean): Promise<DeletionImpactView>;
  deleteFile(path: string, opts?: { recursive?: boolean; approved?: boolean }): Promise<DeleteResultView>;
  listTrash(): Promise<TrashEntryView[]>;
  restoreTrash(id: string): Promise<{ ok: boolean; restoredTo?: string; reason: string }>;
  purgeTrash(id: string, confirm: true): Promise<{ ok: boolean }>;
}

declare global { interface Window { starfish?: GovernanceBridge } }
