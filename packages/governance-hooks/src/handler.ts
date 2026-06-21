// @starfish/governance-hooks — the PreToolUse/PostToolUse/Stop seam (ring 2).
// Forwards Claude Code hook payloads to the PDP and returns a permission decision.
import type { Governor, ToolCall, BoundarySet } from '@starfish/governance-core';

export interface HookPayload {
  hook_event_name: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  capability_id?: string;
  session_id?: string;
}
export interface HookResponse { permissionDecision?: 'allow' | 'deny' | 'ask'; reason?: string; }
export interface HookContext { expectedAgentId: string; boundary: BoundarySet; capabilityId?: string; }

// ---- Claude Code tool taxonomy -> governed tool vocabulary (ring-2 seam) ----
// CC fires native tools (Read/Edit/Bash/...). The PDP reasons over governed tools (fs.read/fs.write/
// shell/net). Map name + extract the path so the boundary engine can contain it. Unknown CC tools pass
// their name through and hit default-deny (not registered) — deny-by-default for anything we don't model.
const CC_READ = new Set(['Read', 'Glob', 'Grep', 'NotebookRead']);
const CC_LIST = new Set(['LS']);
const CC_WRITE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookWrite']);
const CC_NET = new Set(['WebFetch', 'WebSearch']);
// Commands so destructive they are denied outright before reaching the (asking) shell policy.
const CATASTROPHIC: RegExp[] = [
  String.raw`\brm\s+-rf?\s+[~/]`,
  String.raw`\brm\s+-[a-z]*f[a-z]*\s+--no-preserve-root`,
  String.raw`\bmkfs\b`,
  String.raw`\bdd\b[^\n]*\bof=/dev/`,
  String.raw`:\s*\(\s*\)\s*\{[^}]*\}\s*;`,
  String.raw`\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)\b`,
  String.raw`\bchmod\s+-R\s+0?777\s+/`,
  String.raw`>\s*/dev/sd[a-z]`,
].map((p) => new RegExp(p));
export function isCatastrophicShell(cmd: string): boolean { return CATASTROPHIC.some((re) => re.test(cmd)); }

export interface GovernedCall { tool: string; input: Record<string, unknown> }
export function ccToGoverned(name: string, input: Record<string, unknown> = {}): GovernedCall {
  const inp = input ?? {};
  const path = (inp.file_path ?? inp.notebook_path ?? inp.path) as string | undefined;
  if (CC_READ.has(name)) return { tool: 'fs.read', input: { path: path ?? (inp.pattern ? '.' : '.') } };
  if (CC_LIST.has(name)) return { tool: 'fs.list', input: { path: path ?? '.' } };
  if (CC_WRITE.has(name)) return { tool: 'fs.write', input: { path: path ?? '' } };
  if (name === 'Bash') return { tool: 'shell', input: { command: String(inp.command ?? '') } };
  if (CC_NET.has(name)) return { tool: 'net', input: { url: String(inp.url ?? inp.query ?? '') } };
  return { tool: name, input: inp };   // unknown -> passthrough -> default-deny
}

export function handleHook(payload: HookPayload, gov: Governor, ctx: HookContext): HookResponse {
  // socket↔agent binding (S-6): a payload claiming another agent over this connection is rejected.
  if (payload.agent_id && payload.agent_id !== ctx.expectedAgentId) {
    return { permissionDecision: 'deny', reason: 'agent-id mismatch (impersonation blocked)' };
  }
  if (payload.capability_id && payload.capability_id !== ctx.capabilityId) {
    return { permissionDecision: 'deny', reason: 'capability-id mismatch (confused-deputy blocked)' };
  }
  if (payload.hook_event_name === 'PreToolUse') {
    const g = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {});
    if (g.tool === 'shell' && isCatastrophicShell(String(g.input.command ?? ''))) {
      try { gov.audit.append({ actor: ctx.expectedAgentId, domain: 'governance', action: 'ingress:shell', decision: 'deny', reason: 'catastrophic shell command blocked' }); } catch { /* fail closed below */ }
      return { permissionDecision: 'deny', reason: 'catastrophic shell command blocked' };
    }
    const call: ToolCall = { agentId: ctx.expectedAgentId, tool: g.tool, input: g.input, capabilityId: ctx.capabilityId };
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
    if (payload.capability_id && payload.capability_id !== this.ctx.capabilityId) {
      return { permissionDecision: 'deny', reason: 'capability-id mismatch (confused-deputy blocked)' };
    }
    if (payload.hook_event_name === 'PreToolUse') {
      const g = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {});
      if (g.tool === 'shell' && isCatastrophicShell(String(g.input.command ?? ''))) {
        try { this.gov.audit.append({ actor: this.ctx.expectedAgentId, domain: 'governance', action: 'ingress:shell', decision: 'deny', reason: 'catastrophic shell command blocked' }); } catch { /* noop */ }
        return { permissionDecision: 'deny', reason: 'catastrophic shell command blocked' };
      }
      const call: ToolCall = { agentId: this.ctx.expectedAgentId, tool: g.tool, input: g.input, capabilityId: this.ctx.capabilityId };
      const d = this.gov.pdp.decide('ingress', call, this.ctx.boundary);   // audit-before-act happens inside decide()
      if (d.allow) this.pending.push(g.tool);
      return { permissionDecision: d.allow ? 'allow' : d.ask ? 'ask' : 'deny', reason: d.reason };
    }
    if (payload.hook_event_name === 'PostToolUse') {
      const tool = ccToGoverned(payload.tool_name ?? '', payload.tool_input ?? {}).tool;
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
