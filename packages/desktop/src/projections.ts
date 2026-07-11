// Live read projections (ring 3): turn a booted Governor into the renderer's read-only views.
// PRESENTATION ONLY — pure functions, no mutation, no PDP. The Bridge polls these via IPC.
import type {
  Governor, AuditEvent, AgentDef, ToolDef, RiskTier, ServiceInfo, BoundarySet, PendingDecision,
} from '@starfish/governance-core';
import { boundaryForAgent, assessmentFromTier } from '@starfish/governance-core';
import { join } from 'node:path';
import type {
  CrewMemberView, DecisionLogEntry, BudgetView, MonitorView, AgentDetailView, CapabilityView, Verdict,
} from './ui-contract';

const ROLE: Record<string, string> = {
  orchestration: 'Orchestrator', planning: 'Planner', intake: 'Intake & vetting',
  monitor: 'Security monitor', memory: 'Memory', custodial: 'Custodian (safe cleanup)', execution: 'Execution',
};
const NOTES: Record<string, string[]> = {
  toby: ['Sole gatekeeper for the capability registry.', 'Sole gatekeeper to add/remove .env & secrets.'],
  hank: ['Read-only — reconciles the watcher against deterministic counters.'],
  custodian: ['Soft-deletes only; hard rules block system files, skills & folders.'],
  worker: ['git_commit requires human approval (proposer != approver).'],
  michael: ['Delegates only — cannot execute tools directly.'],
};
const roleOf = (a: AgentDef) => ROLE[a.domain ?? ''] ?? (a.domain ? a.domain[0].toUpperCase() + a.domain.slice(1) : a.id);
const hhmmss = (iso: string) => { try { return new Date(iso).toTimeString().slice(0, 8); } catch { return iso; } };
// RM-5: derive the 0–100 composite + human band (Clear→Forbidden) from the recorded tier, for the approval card.
const band = (tier?: RiskTier): { score?: number; descriptor?: string } => {
  if (!tier) return {};
  const a = assessmentFromTier(tier);
  return { score: a.score, descriptor: a.descriptor };
};

function currentTaskId(g: Governor, agentId: string): string | undefined {
  const active = new Set(['analysis', 'planning', 'decomposition', 'execution', 'validation', 'rework', 'retry']);
  const t = g.tasks.all().find((x) => x.assignee === agentId && active.has(x.status));
  return t?.id;
}
function statusOf(g: Governor, a: AgentDef): CrewMemberView['status'] {
  if (g.tokens.isPaused(a.id)) return 'paused';
  if (a.domain === 'monitor') return 'sweeping';
  return currentTaskId(g, a.id) ? 'active' : 'idle';
}
function allowedToolsFor(g: Governor, a: AgentDef): string[] {
  if (a.allowedTools && a.allowedTools.length) return a.allowedTools;
  return g.tools.all()
    .filter((t: ToolDef) => { const aa = (t as { allowedAgents?: unknown }).allowedAgents; return aa === '*' || (Array.isArray(aa) && aa.includes(a.id)); })
    .map((t) => t.id);
}

export function crewView(g: Governor): CrewMemberView[] {
  return g.agents.all().map((a) => ({ id: a.id, role: roleOf(a), status: statusOf(g, a), currentTaskId: currentTaskId(g, a.id), riskTier: a.riskTier }));
}

export function agentDetail(g: Governor, id: string, projectRoot: string, forbid: string[]): AgentDetailView {
  const a = g.agents.get(id) ?? { id, domain: 'unknown' } as AgentDef;
  let boundary: BoundarySet = { visibility: [], write: [] };
  try { boundary = boundaryForAgent({ projectRoot, workspace: join(projectRoot, 'agents', id, 'workspace'), agentDir: join(projectRoot, 'agents', id), forbid }); } catch { /* no writable root => leave empty (read-only) */ }
  return {
    id, role: roleOf(a), domain: a.domain ?? 'unknown', status: statusOf(g, a), riskTier: a.riskTier ?? 'low',
    currentTaskId: currentTaskId(g, id), allowedTools: allowedToolsFor(g, a), boundary, notes: NOTES[id],
  };
}

export function decisionLog(g: Governor, limit = 12): DecisionLogEntry[] {
  const evs = g.audit.recent(limit * 3).filter((e: AuditEvent) => e.decision !== undefined || e.domain === 'tool');
  const mapped = evs.map((e): DecisionLogEntry => ({
    id: `a${e.seq}`, ts: hhmmss(e.ts), actor: e.actor, tool: e.action, target: e.target,
    verdict: (e.decision === 'deny' ? 'deny' : 'allow') as Verdict, reason: e.reason ?? '', riskTier: e.riskTier,
    ...band(e.riskTier),
  }));
  return mapped.reverse().slice(0, limit);   // newest first
}

/** Pending operator decisions (from the broker) rendered as ASK rows the Bridge can act on. */
export function pendingAsView(pending: PendingDecision[]): DecisionLogEntry[] {
  return pending.map((d) => ({ id: d.id, ts: hhmmss(d.ts), actor: d.actor, tool: d.tool, target: d.target, verdict: 'ask' as Verdict, reason: d.reason, riskTier: d.riskTier, ...band(d.riskTier) }));
}

export function budgetView(g: Governor): BudgetView[] {
  return g.tokens.snapshot().map((b) => ({ scope: b.scope, status: b.status, usdUsed: b.usd, usdLimit: b.usdLimit, tokensUsed: b.tokens, tokensLimit: b.tokensLimit }));
}

export function monitorView(g: Governor): MonitorView {
  const c = g.monitor.counters();
  return { lastSweepTs: hhmmss(new Date().toISOString()), counters: { denials: c.denials, boundaryEscapes: c.boundaryEscapes, hashMismatches: c.hashMismatches, budgetHard: c.budgetHard, orphanPosts: c.orphanPosts, casualties: c.casualties }, findings: [], reconciled: (c.boundaryEscapes + c.hashMismatches + c.budgetHard + c.orphanPosts) === 0 };   // routine denials are healthy (deny-by-default); only real anomalies un-reconcile
}

export function bufferView(g: Governor): CapabilityView[] {
  return g.capabilities.snapshot().map((c) => ({ id: c.id, kind: c.kind as CapabilityView['kind'], state: (c.status === 'enabled' ? 'registered' : c.status) as CapabilityView['state'] }));
}

export function serviceView(g: Governor): ServiceInfo[] { return g.services.status(); }
