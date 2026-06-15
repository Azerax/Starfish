// Agent-run loop — the governed orchestration TURN. It is the consumer of the whole runtime spine:
//   dispatcher.plan(task)  ->  runner.run(plan)  ->  parse the model's reply  ->  for each tool the
//   model wants, adjudicate through the PDP (ingress)  ->  execute only if allowed  ->  contain the
//   result (egress)  ->  feed results back  ->  loop. It STOPS on: a final answer, max steps, a hard
//   budget (the next plan() fails closed), or when every requested tool was withheld.
// Governance is never bypassed: the model only *proposes* tool calls; the PDP authorizes, the
// executor (PEP) acts, and proposer != approver holds (an 'ask' tier is withheld, not auto-run).
import type { ToolCall, BoundarySet } from './types';
import type { AuditLog } from './audit';
import type { ProviderKind, ChatTurn } from './provider';
import type { PDP } from './pdp';
import type { Dispatcher, DispatchTask } from './dispatch';
import type { HostRunner } from './runner';

export interface ToolRequest { id: string; name: string; input: Record<string, unknown>; }
export interface AgentTurn { text: string; toolCalls: ToolRequest[]; stop: 'end' | 'tool'; }
export type ResponseParser = (kind: ProviderKind, body: unknown) => AgentTurn;
export interface ToolExecResult { ok: boolean; content: string; }
export type ToolExecutor = (call: ToolCall) => Promise<ToolExecResult> | ToolExecResult;

export interface AgentLoopDeps {
  dispatcher: Dispatcher;
  runner: HostRunner;
  pdp: PDP;
  boundaryFor: (call: ToolCall) => BoundarySet;
  execute: ToolExecutor;
  parse?: ResponseParser;
  audit?: AuditLog;
  maxSteps?: number;
}
export interface AgentRunInput { agentId: string; task: DispatchTask; system?: string; messages: ChatTurn[]; }
export interface ToolRun { tool: string; allowed: boolean; contained?: boolean; }
export type StopReason = 'completed' | 'max-steps' | 'budget-hard' | 'no-progress';
export interface AgentRunResult { output: string; steps: number; stopReason: StopReason; toolRuns: ToolRun[]; transcript: ChatTurn[]; }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const safeJson = (t: string): unknown => { try { return JSON.parse(t); } catch { return undefined; } };

/** Normalize each provider's response shape into a provider-agnostic AgentTurn. */
export const parseResponse: ResponseParser = (kind, body) => {
  if (!isObj(body)) return { text: '', toolCalls: [], stop: 'end' };
  if (kind === 'anthropic') {
    const content = Array.isArray(body.content) ? body.content : [];
    let text = ''; const tc: ToolRequest[] = [];
    for (const part of content) if (isObj(part)) {
      if (part.type === 'text' && typeof part.text === 'string') text += part.text;
      else if (part.type === 'tool_use') tc.push({ id: String(part.id ?? ''), name: String(part.name ?? ''), input: isObj(part.input) ? part.input : {} });
    }
    return { text, toolCalls: tc, stop: tc.length ? 'tool' : 'end' };
  }
  if (kind === 'google') {
    const cand = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    const parts = isObj(cand) && isObj(cand.content) && Array.isArray(cand.content.parts) ? cand.content.parts : [];
    let text = ''; const tc: ToolRequest[] = [];
    for (const p of parts) if (isObj(p)) {
      if (typeof p.text === 'string') text += p.text;
      else if (isObj(p.functionCall)) tc.push({ id: '', name: String(p.functionCall.name ?? ''), input: isObj(p.functionCall.args) ? p.functionCall.args : {} });
    }
    return { text, toolCalls: tc, stop: tc.length ? 'tool' : 'end' };
  }
  // openai / local / router are OpenAI-shaped
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const msg = isObj(choice) ? choice.message : undefined;
  const text = isObj(msg) && typeof msg.content === 'string' ? msg.content : '';
  const raw = isObj(msg) && Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const tc: ToolRequest[] = [];
  for (const t of raw) if (isObj(t) && isObj(t.function)) {
    const parsed = safeJson(String(t.function.arguments ?? '{}'));
    tc.push({ id: String(t.id ?? ''), name: String(t.function.name ?? ''), input: isObj(parsed) ? parsed : {} });
  }
  return { text, toolCalls: tc, stop: tc.length ? 'tool' : 'end' };
};

export class AgentLoop {
  private parse: ResponseParser;
  private maxSteps: number;
  constructor(private deps: AgentLoopDeps) {
    this.parse = deps.parse ?? parseResponse;
    this.maxSteps = deps.maxSteps ?? 8;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { dispatcher, runner, pdp, boundaryFor, execute, audit } = this.deps;
    const messages: ChatTurn[] = input.messages.map((m) => ({ ...m }));
    const toolRuns: ToolRun[] = [];
    let lastText = '';

    for (let step = 1; step <= this.maxSteps; step++) {
      let plan;
      try {
        plan = dispatcher.plan({ agentId: input.agentId, task: input.task, system: input.system, messages });
      } catch (e) {
        audit?.append({ actor: input.agentId, domain: 'system', action: 'agent-stop', target: input.task.id, decision: 'deny', reason: `budget-hard: ${(e as Error).message}` });
        return { output: lastText, steps: step - 1, stopReason: 'budget-hard', toolRuns, transcript: messages };
      }

      const res = await runner.run(plan);
      const turn = this.parse(plan.provider.kind, safeJson(res.text));
      lastText = turn.text || lastText;

      if (turn.toolCalls.length === 0) {
        audit?.append({ actor: input.agentId, domain: 'system', action: 'agent-complete', target: input.task.id, reason: `steps=${step}` });
        return { output: turn.text, steps: step, stopReason: 'completed', toolRuns, transcript: messages };
      }

      messages.push({ role: 'assistant', content: turn.text || '[tool_use]' });
      let progressed = false;
      for (const tc of turn.toolCalls) {
        const call: ToolCall = { agentId: input.agentId, tool: tc.name, input: tc.input, taskId: input.task.id };
        const bs = boundaryFor(call);
        const d = pdp.decide('ingress', call, bs);
        if (!d.allow) {
          const why = d.ask ? `awaiting human approval — ${d.reason}` : `denied — ${d.reason}`;
          messages.push({ role: 'tool', content: `[tool ${tc.name}: ${why}]` });
          toolRuns.push({ tool: tc.name, allowed: false });
          continue;
        }
        progressed = true;
        const exec = await execute(call);
        const eg = pdp.decide('egress', { agentId: input.agentId, tool: tc.name, input: { result: exec.content }, taskId: input.task.id }, bs);
        const contained = !eg.allow;
        messages.push({ role: 'tool', content: contained ? `[contained: ${eg.reason}]` : exec.content });
        toolRuns.push({ tool: tc.name, allowed: true, contained });
      }

      // proposer != approver: if every requested tool was withheld, the model can't make progress
      // autonomously — stop and surface for human approval rather than spin to max-steps.
      if (!progressed) {
        audit?.append({ actor: input.agentId, domain: 'system', action: 'agent-stop', target: input.task.id, decision: 'deny', reason: 'no-progress: all tools withheld pending human approval' });
        return { output: lastText, steps: step, stopReason: 'no-progress', toolRuns, transcript: messages };
      }
    }

    audit?.append({ actor: input.agentId, domain: 'system', action: 'agent-stop', target: input.task.id, reason: 'max-steps' });
    return { output: lastText, steps: this.maxSteps, stopReason: 'max-steps', toolRuns, transcript: messages };
  }
}
