// Task lifecycle (framework §6 "all work is a task"; §3.2). 10-state machine, proposer≠approver,
// completed reachable only via validation.
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import { GovernanceError } from './types';

export type TaskStatus =
  | 'backlog' | 'analysis' | 'planning' | 'decomposition' | 'execution'
  | 'validation' | 'completed' | 'rework' | 'retry' | 'failed';
export type TaskType = 'research' | 'analysis' | 'design' | 'implementation' | 'documentation' | 'evaluation' | 'mission';
export type Origin = 'internal' | 'external/untrusted';

export interface Task {
  id: string; type: TaskType; subject: string;
  proposer: string; assignee?: string;
  status: TaskStatus; dependsOn: string[]; parentId?: string;
  origin: Origin; createdAt: string;
}

const NEXT: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['analysis', 'failed'],
  analysis: ['planning', 'rework', 'failed'],
  planning: ['decomposition', 'rework', 'failed'],
  decomposition: ['execution', 'rework', 'failed'],
  execution: ['validation', 'rework', 'failed'],
  validation: ['completed', 'rework', 'failed'],   // only edge into 'completed'
  rework: ['retry', 'failed'],
  retry: ['execution', 'failed'],
  completed: [],
  failed: [],
};
const EXECUTABLE = new Set<TaskStatus>(['analysis', 'planning', 'decomposition', 'execution', 'validation', 'rework', 'retry']);

export class TaskLedger {
  private tasks = new Map<string, Task>();
  constructor(private audit: AuditLog, private approvers: Set<string> = new Set(['god', 'human'])) {}

  create(input: { type: TaskType; subject: string; proposer: string; assignee?: string; dependsOn?: string[]; parentId?: string; origin?: Origin; id?: string }): Task {
    const t: Task = {
      id: input.id ?? randomUUID(), type: input.type, subject: input.subject,
      proposer: input.proposer, assignee: input.assignee, status: 'backlog',
      dependsOn: input.dependsOn ?? [], parentId: input.parentId,
      origin: input.origin ?? 'internal', createdAt: new Date().toISOString(),
    };
    this.tasks.set(t.id, t);
    this.audit.append({ actor: input.proposer, domain: 'task', action: 'create', target: t.id, reason: `type=${t.type} origin=${t.origin}` });
    return t;
  }

  transition(id: string, to: TaskStatus, actor: string): Task {
    const t = this.tasks.get(id);
    if (!t) throw new GovernanceError(`no such task: ${id}`);
    if (!(NEXT[t.status] ?? []).includes(to)) {
      this.audit.append({ actor, domain: 'task', action: `transition:${t.status}->${to}`, target: id, decision: 'deny', reason: 'illegal-transition' });
      throw new GovernanceError(`illegal transition ${t.status} -> ${to}`);
    }
    if (t.status === 'backlog') {                       // proposer≠approver gate (T-07)
      if (!this.approvers.has(actor)) {
        this.audit.append({ actor, domain: 'task', action: `transition:backlog->${to}`, target: id, decision: 'deny', reason: 'not-an-approver' });
        throw new GovernanceError('only an approver may move a task out of backlog');
      }
      if (actor === t.proposer) {
        this.audit.append({ actor, domain: 'task', action: `transition:backlog->${to}`, target: id, decision: 'deny', reason: 'proposer-cannot-approve-own-task' });
        throw new GovernanceError('proposer cannot approve their own task');
      }
    }
    t.status = to;
    this.audit.append({ actor, domain: 'task', action: `transition:->${to}`, target: id, decision: 'allow' });
    return t;
  }

  get(id: string): Task | undefined { return this.tasks.get(id); }
  all(): Task[] { return [...this.tasks.values()]; }
  hasActiveTask(agentId: string, taskId?: string): boolean {
    if (!taskId) return false;
    const t = this.tasks.get(taskId);
    return !!t && t.assignee === agentId && EXECUTABLE.has(t.status);
  }
}
