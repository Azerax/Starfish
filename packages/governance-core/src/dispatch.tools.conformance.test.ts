import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, Dispatcher, HostRunner,
  PDP, Registry, RiskEngine, PolicyEngine, AgentLoop, anthropicAdapter, ANTHROPIC,
  STARFISH_TOOL_SCHEMAS, type ToolDef, type AgentDef, type BoundarySet, type ToolCall,
} from './index';

describe('tool schemas reach the model', () => {
  it('anthropic buildRequest includes tools as input_schema when provided', () => {
    const r = anthropicAdapter.buildRequest({ provider: ANTHROPIC, model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], tools: STARFISH_TOOL_SCHEMAS });
    const body = r.body as { tools?: { name: string; input_schema: unknown }[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools!.map((t) => t.name)).toContain('fs.write');
    expect(body.tools!.find((t) => t.name === 'fs.read')!.input_schema).toBeTruthy();
  });
  it('omits tools when none given (backward compatible)', () => {
    const r = anthropicAdapter.buildRequest({ provider: ANTHROPIC, model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect((r.body as { tools?: unknown }).tools).toBeUndefined();
  });
});

const BS: BoundarySet = { visibility: ['/'], write: ['/'] };
const toolMsg = (name: string, input: Record<string, unknown>) => JSON.stringify({ content: [{ type: 'tool_use', id: 't', name, input }], usage: { input_tokens: 1, output_tokens: 0 } });
const finalMsg = (t: string) => JSON.stringify({ content: [{ type: 'text', text: t }], usage: { input_tokens: 1, output_tokens: 0 } });

function harness(resolveAsk?: (c: ToolCall, r: string) => Promise<boolean>) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-ask-'));
  writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' }] as ToolDef[]));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }] as AgentDef[]));
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  const pdp = new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id), audit, new RiskEngine(), new PolicyEngine([]));
  const tokens = new TokenGovernor(audit);
  const dispatcher = new Dispatcher({ providers: new ProviderRegistry([ANTHROPIC], 'anthropic'), router: new ModelRouter(undefined, audit), tokens, audit });
  let i = 0; const script = [toolMsg('fs.write', { path: '/tmp/x' }), finalMsg('done')];
  const runner = new HostRunner({ tokens, keyResolver: () => 'sk', fetcher: async () => ({ status: 200, ok: true, text: async () => script[Math.min(i++, 1)] }), audit });
  const executed: ToolCall[] = [];
  const loop = new AgentLoop({ dispatcher, runner, pdp, boundaryFor: () => BS, execute: (c) => { executed.push(c); return { ok: true, content: 'ok' }; }, audit, maxSteps: 4, resolveAsk });
  return { loop, executed };
}
const RUN = { agentId: 'worker', task: { id: 'm', riskTier: 'low' as const }, messages: [{ role: 'user' as const, content: 'write it' }] };

describe('resolveAsk: a PDP ask is parked for the operator', () => {
  it('approved -> the tool executes', async () => {
    const { loop, executed } = harness(async () => true);
    const r = await loop.run(RUN);
    expect(executed.map((c) => c.tool)).toContain('fs.write');
    expect(r.stopReason).toBe('completed');
  });
  it('denied -> the tool is withheld (no execution)', async () => {
    const { loop, executed } = harness(async () => false);
    const r = await loop.run(RUN);
    expect(executed.length).toBe(0);
    expect(r.stopReason).toBe('no-progress');
  });
  it('no resolveAsk -> ask is withheld (original behaviour)', async () => {
    const { loop, executed } = harness(undefined);
    const r = await loop.run(RUN);
    expect(executed.length).toBe(0);
    expect(r.stopReason).toBe('no-progress');
  });
});
