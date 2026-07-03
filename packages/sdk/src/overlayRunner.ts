// Overlay mode: gate a host's OWN tool calls (mapped via a taxonomy) deny-by-default, for skill runners
// that are not Claude Code. Exposes a ModeRunner (3rd mode for the shared conformance pack) and a
// withGovernance() middleware that wraps a host executor.
import type { Governance } from './index';
import type { BoundarySet, ToolCall } from '@starfish/governance-core';
import type { ModeRunner } from './conformance/runner';
import { DEFAULT_TAXONOMY, type ToolTaxonomy } from './taxonomy';

export function makeOverlayRunner(gov: Governance, opts?: { taxonomy?: ToolTaxonomy }): ModeRunner {
  const tax = opts?.taxonomy ?? DEFAULT_TAXONOMY;
  let down = false;
  return {
    name: 'overlay',
    async decide(call, boundary) {
      if (down) return { allow: false, ask: false, reason: 'fail-closed: overlay down' };
      const c = call as { agentId?: string; tool: string; input?: Record<string, unknown> };
      const m = tax.map(c.tool, c.input ?? {});
      const governed: ToolCall = { agentId: c.agentId ?? 'worker', tool: m.tool, input: m.input };
      return gov.governCall(governed, boundary as BoundarySet);
    },
    async file(dec) { const rec = gov.broker.file(dec as Parameters<typeof gov.broker.file>[0]); return { id: rec.id }; },
    async pending() { return gov.broker.list().map((p) => ({ id: p.id, tool: p.tool, actor: p.actor })); },
    async resolve(id, verdict, by) { const r = gov.broker.resolve(id, verdict, by); return { ok: r.ok, reason: r.reason }; },
    async down() { down = true; },
  };
}

export interface HostCall { tool: string; input: Record<string, unknown> }
export interface HostExecResult { ok: boolean; content: string }

// Wrap a host tool executor so every call is mapped + gated deny-by-default before it runs.
export function withGovernance(
  execute: (call: HostCall) => Promise<HostExecResult>,
  opts: { governance: Governance; boundary: BoundarySet; taxonomy?: ToolTaxonomy; agentId?: string; resolveAsk?: (governedTool: string) => Promise<boolean> },
): (call: HostCall) => Promise<HostExecResult> {
  const tax = opts.taxonomy ?? DEFAULT_TAXONOMY;
  return async (call: HostCall): Promise<HostExecResult> => {
    const m = tax.map(call.tool, call.input ?? {});
    const governed: ToolCall = { agentId: opts.agentId ?? 'worker', tool: m.tool, input: m.input };
    const d = opts.governance.governCall(governed, opts.boundary);
    if (d.allow) return execute({ tool: m.tool, input: m.input });
    if (d.ask && opts.resolveAsk) {
      const ok = await opts.resolveAsk(m.tool);
      return ok ? execute({ tool: m.tool, input: m.input }) : { ok: false, content: `[withheld: ${d.reason}]` };
    }
    return { ok: false, content: `[denied: ${d.reason}]` };
  };
}
