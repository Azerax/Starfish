import type { GovernanceBridge, DecisionLogEntry, DefaultSkillView, AgentDetailView } from './types';

const POOL: Omit<DecisionLogEntry, 'id' | 'ts'>[] = [
  { actor: 'dwight', tool: 'fs.read', target: '/proj/src/app.ts', verdict: 'allow', reason: 'registered; in boundary; risk low', riskTier: 'low' },
  { actor: 'worker', tool: 'git_commit', verdict: 'ask', reason: 'risk high -> human approval (proposer != approver)', riskTier: 'high' },
  { actor: 'worker', tool: 'shell.raw', verdict: 'deny', reason: 'default-deny; raw shell unregistered', riskTier: 'critical' },
  { actor: 'pam', tool: 'memory.promote', target: 'claim #88', verdict: 'allow', reason: 'high-confidence low-stakes auto-approved', riskTier: 'low' },
  { actor: 'toby', tool: 'capability.vet', target: 'web-search-mcp', verdict: 'ask', reason: 'medium risk -> quarantine pending human', riskTier: 'medium' },
  { actor: 'hank', tool: 'audit.sweep', verdict: 'allow', reason: 'read-only monitor sweep', riskTier: 'low' },
];
let seq = 100;
function clock(o = 0): string { return new Date(Date.now() + o * 1000).toTimeString().slice(0, 8); }
const feed: DecisionLogEntry[] = POOL.slice(0, 4).map((d, i) => ({ ...d, id: 'd' + (seq - i), ts: clock(-i * 6) }));

const CATALOG: DefaultSkillView[] = [
  { id: 'claude-api', kind: 'skill', category: 'reference', summary: 'Claude API & SDK docs', expectedRisk: 'low', plugin: 'claude-api' },
  { id: 'brand-guidelines', kind: 'skill', category: 'enterprise', summary: 'Apply brand guidelines', expectedRisk: 'low', plugin: 'example-skills', recommended: true },
  { id: 'xlsx', kind: 'skill', category: 'document', summary: 'Create/edit spreadsheets', expectedRisk: 'medium', plugin: 'document-skills', recommended: true },
  { id: 'skill-creator', kind: 'skill', category: 'development', summary: 'Author new skills', expectedRisk: 'medium', plugin: 'example-skills', recommended: true },
  { id: 'slack-gif-creator', kind: 'skill', category: 'enterprise', summary: 'Create Slack GIFs (network)', expectedRisk: 'medium', plugin: 'example-skills' },
  { id: 'webapp-testing', kind: 'skill', category: 'development', summary: 'Browser automation + exec', expectedRisk: 'high', plugin: 'example-skills' },
];


// Per-agent governed posture (boundary + allowlist) — mirrors the seedGovernance agent defs.
const DETAIL: Record<string, Omit<AgentDetailView, 'id' | 'status' | 'currentTaskId'>> = {
  michael:   { role: 'Orchestrator', domain: 'orchestration', riskTier: 'medium', allowedTools: ['delegate', 'plan'], boundary: { visibility: ['/proj'], write: ['/proj/agents/michael'] }, notes: ['Delegates only — cannot execute tools directly.'] },
  dwight:    { role: 'Planner', domain: 'planning', riskTier: 'low', allowedTools: ['fs.read'], boundary: { visibility: ['/proj'], write: ['/proj/.plans'] } },
  toby:      { role: 'Intake & vetting', domain: 'intake', riskTier: 'medium', allowedTools: ['fs.read', 'capability.vet'], boundary: { visibility: ['/proj/intake'], write: ['/proj/governance'] }, notes: ['Sole gatekeeper for the capability registry.', 'Sole gatekeeper to add/remove .env & secrets.'] },
  hank:      { role: 'Security monitor', domain: 'monitor', riskTier: 'low', allowedTools: ['fs.read', 'audit.sweep'], boundary: { visibility: ['/proj (read-only)'], write: [] }, notes: ['Read-only — reconciles the watcher against deterministic counters.'] },
  pam:       { role: 'Memory', domain: 'memory', riskTier: 'low', allowedTools: ['fs.read', 'fs.write'], boundary: { visibility: ['/proj/memory'], write: ['/proj/memory'] } },
  custodian: { role: 'Custodian (safe cleanup)', domain: 'custodial', riskTier: 'medium', allowedTools: ['fs.read', 'fs.list', 'fs.delete'], boundary: { visibility: ['/proj'], write: ['/proj/.trash'] }, notes: ['Soft-deletes only; hard rules block system files, skills & folders.'] },
  worker:    { role: 'Execution', domain: 'execution', riskTier: 'high', allowedTools: ['fs.read', 'fs.write', 'git_commit'], boundary: { visibility: ['/proj'], write: ['/proj/.worktrees/worker'] }, notes: ['git_commit requires human approval (proposer != approver).'] },
};

export const mockBridge: GovernanceBridge = {
  governed: true,
  getBaseRoot: async () => ({ root: '~/Starfish', locked: false, suggested: '~/Starfish' }),
  pickBaseDir: async () => ({ path: '~/Starfish' }),
  setBaseRoot: async (dir: string) => ({ ok: true, root: dir || '~/Starfish', reason: 'mock: seeded + booted' }),
  getCrew: async () => [
    { id: 'michael', role: 'Orchestrator', status: 'active', currentTaskId: '#412', riskTier: 'medium' },
    { id: 'dwight', role: 'Planner', status: 'active', currentTaskId: '#418', riskTier: 'low' },
    { id: 'toby', role: 'Intake & vetting', status: 'idle', riskTier: 'medium' },
    { id: 'hank', role: 'Security monitor', status: 'sweeping', riskTier: 'low' },
    { id: 'pam', role: 'Memory', status: 'active', riskTier: 'low' },
    { id: 'custodian', role: 'Custodian (safe cleanup)', status: 'idle', riskTier: 'medium' },
    { id: 'worker', role: 'Execution', status: 'paused', currentTaskId: '#412', riskTier: 'high' },
  ],
  getAgentDetail: async (id: string): Promise<AgentDetailView> => {
    const crew = await mockBridge.getCrew();
    const c = crew.find((m) => m.id === id);
    const d = DETAIL[id] ?? { role: c?.role ?? id, domain: 'unknown', riskTier: c?.riskTier ?? 'low', allowedTools: [], boundary: { visibility: [], write: [] } };
    return { id, status: c?.status ?? 'idle', currentTaskId: c?.currentTaskId, ...d };
  },
  getDecisions: async (limit = 8) => { seq += 1; feed.unshift({ ...POOL[seq % POOL.length], id: 'd' + seq, ts: clock() }); feed.length = Math.min(feed.length, 40); return feed.slice(0, limit); },
  getAudit: async () => [],
  getTasks: async () => [],
  getServices: async () => [],
  getBudgets: async () => [
    { scope: 'global', status: 'ok', usdUsed: 6.4, usdLimit: 10, tokensUsed: 812000, tokensLimit: 1500000 },
    { scope: 'worker', status: 'hard', usdUsed: 4.1, usdLimit: 4, tokensUsed: 410000, tokensLimit: 400000 },
  ],
  getMonitor: async () => ({ lastSweepTs: clock(-2), counters: { denials: 3, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 1, orphanPosts: 0, casualties: 1 }, findings: [], reconciled: true }),
  getBuffer: async () => [{ id: 'web-search-mcp', kind: 'mcp', state: 'quarantined' }],
  subscribe: () => () => {},
  requestAction: async () => ({ decision: { allow: false, ask: true, reason: 'human approval required (proposer != approver)' }, applied: false }),
  getOnboarding: async () => ({ done: false, operator: 'Grand Admiral Scotticus', theme: 'fleet' }),
  getDefaultSkills: async () => CATALOG,
  completeOnboarding: async (i) => {
    const low = CATALOG.filter((s) => s.expectedRisk === 'low').map((s) => s.id);
    const medplus = CATALOG.filter((s) => s.expectedRisk !== 'low').map((s) => s.id);
    const approved = i.enabledIds.filter((id) => medplus.includes(id));
    return { registered: low, quarantined: medplus.filter((id) => !approved.includes(id)), approved, missing: [] };
  },
  getProviders: async () => [
    { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', model: 'claude-opus-4-8', requiresKey: true, hasKey: false, dataEgress: false },
    { id: 'openai', name: 'OpenAI', kind: 'openai', model: 'gpt-4o', requiresKey: true, hasKey: false, dataEgress: false },
    { id: 'google', name: 'Google (Gemini)', kind: 'google', model: 'gemini-1.5-pro', requiresKey: true, hasKey: false, dataEgress: false },
    { id: 'openrouter', name: 'OpenRouter (router)', kind: 'router', model: 'auto', baseUrl: 'https://openrouter.ai/api/v1', requiresKey: true, hasKey: false, dataEgress: true },
    { id: 'local', name: 'Local (Ollama/llama.cpp)', kind: 'local', model: 'llama-3.1', requiresKey: false, hasKey: true, dataEgress: false },
  ],
  getActiveProvider: async () => ({ id: 'anthropic', model: 'claude-opus-4-8' }),
  setActiveProvider: async () => ({ ok: true }),
  setProviderKey: async () => ({ ok: true, stored: 'fallback' as const }),
  assessDelete: async (path: string) => ({ tier: path.includes('.git') || path.endsWith('/') ? 'critical' as const : 'low' as const, decision: path.includes('.git') ? 'deny' as const : 'allow' as const, hard: path.includes('.git'), reversible: true, files: 1, bytes: 2048, reasons: path.includes('.git') ? ['protected subtree (.git)'] : [] }),
  deleteFile: async (path: string) => ({ ok: !path.includes('.git'), reason: path.includes('.git') ? 'HARD-DENY: protected subtree (.git)' : 'soft-deleted (recoverable from trash)', impact: { tier: 'low' as const, decision: 'allow' as const, hard: false, reversible: true, files: 1, bytes: 2048, reasons: [] }, trashedTo: '/trash/' + path.split('/').pop() }),
  listTrash: async () => [{ id: 't1', originalPath: '/proj/old.log', trashedAt: new Date().toISOString(), name: 'old.log' }],
  restoreTrash: async () => ({ ok: true, restoredTo: '/proj/old.log', reason: 'restored' }),
  purgeTrash: async () => ({ ok: true }),
  getReadiness: async () => ({ ok: false, blockers: [{ id: 'provider-key', severity: 'stop' as const, title: 'No API key for Anthropic (Claude)', detail: 'Anthropic needs an API key before any order can run. It is sealed in your OS keychain and never leaves your machine.', action: { label: 'Enter API key', view: 'settings' } }] }),
  getCost: async () => ({ mode: 'platform' as const, budgetUsd: 0 }),
  setCost: async () => ({ ok: true }),
};
