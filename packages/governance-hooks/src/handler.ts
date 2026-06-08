// @starfish/governance-hooks — the PreToolUse/PostToolUse/Stop seam (ring 2).
// Forwards Claude Code hook payloads to the PDP and returns a permission decision.
import type { Governor, ToolCall, BoundarySet } from '@starfish/governance-core';

export interface HookPayload {
  hook_event_name: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}
export interface HookResponse { permissionDecision?: 'allow' | 'deny' | 'ask'; reason?: string; }
export interface HookContext { expectedAgentId: string; boundary: BoundarySet; }

export function handleHook(payload: HookPayload, gov: Governor, ctx: HookContext): HookResponse {
  // socket↔agent binding (S-6): a payload claiming another agent over this connection is rejected.
  if (payload.agent_id && payload.agent_id !== ctx.expectedAgentId) {
    return { permissionDecision: 'deny', reason: 'agent-id mismatch (impersonation blocked)' };
  }
  if (payload.hook_event_name === 'PreToolUse') {
    const call: ToolCall = { agentId: ctx.expectedAgentId, tool: payload.tool_name ?? '', input: payload.tool_input ?? {} };
    const d = gov.pdp.decide('ingress', call, ctx.boundary);
    return { permissionDecision: d.allow ? 'allow' : d.ask ? 'ask' : 'deny', reason: d.reason };
  }
  return {};   // PostToolUse correlation + Stop-loop arrive in later phases
}

/** A per-agent hook session that correlates PreToolUse→PostToolUse so a tool result with
 *  no preceding allowed PreToolUse is flagged as a no-silent-execution violation (T-10/TC-1.7). */
export class HookSession {
  private pending: string[] = [];
  constructor(private gov: Governor, private ctx: HookContext) {}

  handle(payload: HookPayload): HookResponse {
    if (payload.agent_id && payload.agent_id !== this.ctx.expectedAgentId) {
      return { permissionDecision: 'deny', reason: 'agent-id mismatch (impersonation blocked)' };
    }
    if (payload.hook_event_name === 'PreToolUse') {
      const call: ToolCall = { agentId: this.ctx.expectedAgentId, tool: payload.tool_name ?? '', input: payload.tool_input ?? {} };
      const d = this.gov.pdp.decide('ingress', call, this.ctx.boundary);   // audit-before-act happens inside decide()
      if (d.allow) this.pending.push(call.tool);
      return { permissionDecision: d.allow ? 'allow' : d.ask ? 'ask' : 'deny', reason: d.reason };
    }
    if (payload.hook_event_name === 'PostToolUse') {
      const tool = payload.tool_name ?? '';
      const i = this.pending.indexOf(tool);
      if (i === -1) {
        try {
          this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'failure', action: `orphan-post:${tool}`,
            decision: 'deny', reason: 'PostToolUse without a matching allowed PreToolUse (no-silent-execution violation)' });
        } catch { /* fail closed below */ }
        return { permissionDecision: 'deny', reason: 'orphan PostToolUse flagged' };
      }
      this.pending.splice(i, 1);
      return {};
    }
    return {};
  }
}
