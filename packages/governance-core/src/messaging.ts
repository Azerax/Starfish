// Message router as a bracketed transport PEP — framework §7 resolution (Option B).
// Agents only ever write their own outbox; the ONLY path between two agents is this router,
// which checks ingress (task-linked, policy) and egress (containment), stamps identity, and audits.
import { randomUUID } from 'node:crypto';
import type { AuditLog } from './audit';
import type { PolicyEngine } from './policy';
import type { TaskLedger } from './tasks';
import { scanEgress } from './containment';

export type MessageAct = 'request' | 'inform' | 'propose' | 'query' | 'agree' | 'refuse' | 'done';
export interface OutgoingMessage { to: string; act: MessageAct; subject: string; body: string; task?: string; conversation?: string; inReplyTo?: string; }
export interface DeliveredMessage extends OutgoingMessage { id: string; from: string; hops: number; createdAt: string; }
export type RouteResult =
  | { status: 'delivered'; message: DeliveredMessage }
  | { status: 'held'; reason: string }
  | { status: 'denied'; reason: string };

const HOP_CAP = 12;

export class MessageRouter {
  private inboxes = new Map<string, DeliveredMessage[]>();
  constructor(private audit: AuditLog, private tasks: TaskLedger, private policy: PolicyEngine) {}

  /** senderId is the AUTHENTICATED sender (from the connection) — never trusted from the payload (T-08). */
  route(senderId: string, msg: OutgoingMessage, hops = 0): RouteResult {
    // ---- INGRESS ----
    if (!this.tasks.hasActiveTask(senderId, msg.task)) {
      this.audit.append({ actor: senderId, domain: 'message', action: 'ingress', target: msg.to, decision: 'deny', reason: 'not linked to an active task — held' });
      return { status: 'held', reason: 'message not linked to an active task' };
    }
    if (hops > HOP_CAP) {
      this.audit.append({ actor: senderId, domain: 'message', action: 'ingress', target: msg.to, decision: 'deny', reason: 'hop cap exceeded' });
      return { status: 'denied', reason: 'hop cap exceeded' };
    }
    if (this.policy.evaluate(`agent:${senderId}`, `message:${msg.act}`, msg.to) === 'deny') {
      this.audit.append({ actor: senderId, domain: 'message', action: 'ingress', target: msg.to, decision: 'deny', reason: 'policy-deny' });
      return { status: 'denied', reason: 'policy-deny' };
    }
    // identity stamped by the router, not the caller's claim
    const delivered: DeliveredMessage = { ...msg, id: randomUUID(), from: senderId, hops: hops + 1, createdAt: new Date().toISOString() };
    // ---- EGRESS ----
    const scan = scanEgress(delivered.body);
    if (!scan.clean) {
      this.audit.append({ actor: senderId, domain: 'message', action: 'egress', target: msg.to, decision: 'deny', reason: scan.reason });
      return { status: 'denied', reason: scan.reason! };
    }
    const box = this.inboxes.get(msg.to) ?? [];
    box.push(delivered); this.inboxes.set(msg.to, box);
    this.audit.append({ actor: senderId, domain: 'message', action: 'deliver', target: msg.to, decision: 'allow', reason: `act=${msg.act} task=${msg.task}` });
    return { status: 'delivered', message: delivered };
  }

  inbox(agentId: string): DeliveredMessage[] { return this.inboxes.get(agentId) ?? []; }
}
