// Pam (planner) — Phase 8. Turns idea-board clusters into GOVERNED DRAFTS, never dispatches.
// Each node is classified; everything Pam produces lands in `backlog` linked to its source node,
// and (because proposer≠approver) Pam cannot move it out of backlog herself — a human/orchestrator must.
import type { TaskLedger, Task, TaskType } from './tasks';

export interface CanvasNode { id: string; text: string; type?: 'capability' | 'workflow' | 'work' | 'note'; }
export type NodeRoute = 'intake' | 'workflow' | 'work' | 'question';

const CAP = /\b(tool|skill|agent|connector|mcp|plugin|integration)\b/i;
const FLOW = /\b(workflow|pipeline|process|recurring|every day|each|automation)\b/i;
const VAGUE = /\?|\b(maybe|somehow|idea|tbd|not sure|explore)\b/i;

export function classifyNode(n: CanvasNode): { route: NodeRoute; taskType: TaskType } {
  if (n.type === 'capability' || CAP.test(n.text)) return { route: 'intake', taskType: 'evaluation' };
  if (n.type === 'workflow' || FLOW.test(n.text)) return { route: 'workflow', taskType: 'documentation' };
  if (n.text.trim().length < 12 || VAGUE.test(n.text)) return { route: 'question', taskType: 'analysis' };
  return { route: 'work', taskType: 'mission' };
}

export interface PromoteResult { drafts: Task[]; intake: Task[]; workflows: Task[]; questions: { node: string; text: string }[]; }

/** Promote a cluster of canvas nodes into governed backlog drafts. Generative, never executive:
 *  nothing here dispatches — drafts await human approval to leave backlog. */
export function promoteCluster(nodes: CanvasNode[], ledger: TaskLedger, proposer = 'pam'): PromoteResult {
  const out: PromoteResult = { drafts: [], intake: [], workflows: [], questions: [] };
  // multi-node clusters get a parent task; children depend on it (a DAG)
  let parentId: string | undefined;
  const workNodes = nodes.filter((n) => classifyNode(n).route === 'work');
  if (workNodes.length > 1) {
    const parent = ledger.create({ type: 'mission', subject: `[cluster] ${workNodes.length} related items`, proposer });
    parentId = parent.id; out.drafts.push(parent);
  }
  for (const n of nodes) {
    const { route, taskType } = classifyNode(n);
    if (route === 'question') { out.questions.push({ node: n.id, text: n.text }); continue; }
    const t = ledger.create({ type: taskType, subject: `[node:${n.id}] ${n.text.slice(0, 80)}`, proposer, parentId: route === 'work' ? parentId : undefined });
    out.drafts.push(t);
    if (route === 'intake') out.intake.push(t);
    if (route === 'workflow') out.workflows.push(t);
  }
  return out;
}
