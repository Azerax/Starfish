import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, Dispatcher, HostRunner,
  PDP, Registry, RiskEngine, PolicyEngine, AgentLoop, parseResponse,
  type ToolDef, type AgentDef, type BoundarySet, type Provider, type ToolCall,
} from './index';

const BS: BoundarySet = { visibility: ['/'], write: ['/'] };
const ANTH: Provider[] = [{ id: 'anthropic', name: 'A', kind: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'https://api.anthropic.com', requiresKey: true }];

// An Anthropic-shaped response that asks for one tool call, or a final text answer.
const toolMsg = (name: string, input: Record<string, unknown>, tokens = 5) =>
  JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name, input }], usage: { input_tokens: tokens, output_tokens: 0 } });
const finalMsg = (text: string, tokens = 5) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: tokens, output_tokens: 0 } });

function harness(opts: {
  tools: ToolDef[]; rules?: unknown[]; script: string[]; execContent?: string;
  budget?: { hardTokens?: number }; maxSteps?: number; enforceClaims?: boolean; observe?: (c: ToolCall, r: { ok: boolean; content: string }, ev: { testsPassed: string[] }) => void;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-loop-'));
  writeFileSync(join(dir, 'tools.json'), JSON.stringify(opts.tools));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  const pdp = new PDP(
    new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id),
    new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id),
    audit, new RiskEngine(), new PolicyEngine((opts.rules ?? []) as never),
  );
  const tokens = new TokenGovernor(audit);
  if (opts.budget) tokens.setBudget('worker', opts.budget);
  const dispatcher = new Dispatcher({ providers: new ProviderRegistry(ANTH, 'anthropic'), router: new ModelRouter(undefined, audit), tokens, audit });
  let i = 0;
  const fetcher = async () => { const body = opts.script[Math.min(i, opts.script.length - 1)]; i++; return { status: 200, ok: true, text: async () => body }; };
  const runner = new HostRunner({ tokens, keyResolver: () => 'sk-test', fetcher, audit });
  const executed: ToolCall[] = [];
  const execute = (call: ToolCall) => { executed.push(call); return { ok: true, content: opts.execContent ?? `result of ${call.tool}` }; };
  const loop = new AgentLoop({ dispatcher, runner, pdp, boundaryFor: () => BS, execute, audit, maxSteps: opts.maxSteps ?? 6, enforceClaims: opts.enforceClaims, observe: opts.observe as never });
  return { loop, executed, auditPath: join(dir, 'audit.jsonl') };
}
const RUN = { agentId: 'worker', task: { id: 'm1', riskTier: 'low' as const }, messages: [{ role: 'user' as const, content: 'do it' }] };

describe('agent-run loop — governed orchestration turn', () => {
  it('runs an allowed (low) tool then finishes on the final answer', async () => {
    const { loop, executed } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('read_file', { path: '/tmp/x' }), finalMsg('all done')],
    });
    const r = await loop.run(RUN);
    expect(r.stopReason).toBe('completed');
    expect(r.output).toBe('all done');
    expect(executed.map((c) => c.tool)).toEqual(['read_file']);
    expect(r.toolRuns).toEqual([{ tool: 'read_file', allowed: true, contained: false }]);
  });

  it('stamps the task id on every tool call (no task, no tool)', async () => {
    const { loop, executed } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('read_file', { path: '/tmp/x' }), finalMsg('ok')],
    });
    await loop.run(RUN);
    expect(executed[0].taskId).toBe('m1');
  });

  it('withholds a medium tool (proposer != approver) and stops as no-progress — never auto-runs it', async () => {
    const { loop, executed } = harness({
      tools: [{ id: 'write_file', category: 'write', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('write_file', { path: '/tmp/x' }), finalMsg('should not reach')],
    });
    const r = await loop.run(RUN);
    expect(r.stopReason).toBe('no-progress');
    expect(executed.length).toBe(0);                                   // never executed
    expect(r.toolRuns).toEqual([{ tool: 'write_file', allowed: false }]);
  });

  it('default-denies an unregistered tool the model hallucinates', async () => {
    const { loop, executed } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('rm_rf', { path: '/' }), finalMsg('x')],
    });
    const r = await loop.run(RUN);
    expect(executed.length).toBe(0);
    expect(r.toolRuns[0]).toMatchObject({ tool: 'rm_rf', allowed: false });
  });

  it('contains a tool result that leaks secret material (egress)', async () => {
    const { loop } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('read_file', { path: '/tmp/notes.txt' }), finalMsg('done')],
      execContent: '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc...',
    });
    const r = await loop.run(RUN);
    expect(r.toolRuns[0]).toMatchObject({ tool: 'read_file', allowed: true, contained: true });
    expect(r.transcript.some((m) => m.role === 'tool' && m.content.includes('[contained'))).toBe(true);
  });

  it('caps runaway loops at maxSteps', async () => {
    const { loop } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('read_file', { path: '/tmp/x' })],   // never returns a final answer
      maxSteps: 3,
    });
    const r = await loop.run(RUN);
    expect(r.stopReason).toBe('max-steps');
    expect(r.steps).toBe(3);
  });

  it('fails closed mid-run when the agent crosses a hard budget', async () => {
    const { loop, auditPath } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [toolMsg('read_file', { path: '/tmp/x' }, 999), toolMsg('read_file', { path: '/tmp/y' }, 999)],
      budget: { hardTokens: 100 },     // first run records 999 -> hard -> paused -> next plan() throws
      maxSteps: 5,
    });
    const { readFileSync } = await import('node:fs');
    const r = await loop.run(RUN);
    expect(r.stopReason).toBe('budget-hard');
    expect(readFileSync(auditPath, 'utf8')).toContain('agent-stop');
  });
});


describe('agent-run loop — Evidence Gate (no unbacked word)', () => {
  it('blocks a fabricated completion and retries, then accepts once the deed is real', () => {
    // turn 1: claims "created /proj/out.txt" with NO tool call -> unbacked -> retry; turn 2: plain done.
    const { loop } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [finalMsg('Done — I created /proj/out.txt'), finalMsg('Acknowledged.')],
      maxSteps: 4, enforceClaims: true,
    });
    return loop.run(RUN).then((r) => {
      expect(r.stopReason).toBe('completed');
      expect(r.steps).toBeGreaterThanOrEqual(2);                 // it had to retry
      expect(r.transcript.some((m) => m.content.includes('Evidence Gate'))).toBe(true);
    });
  });

  it('stops as claim-unbacked if the agent keeps fabricating to the step cap', () => {
    const { loop } = harness({
      tools: [{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      script: [finalMsg('I ran the full pipeline and everything passes.')],   // repeated; never any tool call
      maxSteps: 2, enforceClaims: true,
    });
    return loop.run(RUN).then((r) => {
      expect(r.stopReason).toBe('claim-unbacked');
      expect((r.unbackedClaims ?? []).length).toBeGreaterThan(0);
    });
  });

  it('accepts a green claim backed by an observed passing test', () => {
    // observe teaches evidence from the tool output; the executed tool reports a pass.
    const { loop } = harness({
      tools: [{ id: 'run_tests', category: 'read', pathParams: [], allowedAgents: '*' }],
      script: [toolMsg('run_tests', {}), finalMsg('test_login passes.')],
      maxSteps: 4, enforceClaims: true, execContent: 'PASSED test_login',
      observe: (_c, res, ev) => { const m = res.content.match(/PASSED (test_[A-Za-z0-9]+)/); if (m) ev.testsPassed.push(m[1]); },
    });
    return loop.run(RUN).then((r) => { expect(r.stopReason).toBe('completed'); expect(r.output).toMatch(/passes/); });
  });
});

describe('parseResponse — provider-agnostic tool extraction', () => {
  it('openai tool_calls with JSON-string arguments', () => {
    const t = parseResponse('openai', { choices: [{ message: { content: 'hi', tool_calls: [{ id: 'c1', function: { name: 'search', arguments: '{"q":"x"}' } }] } }] });
    expect(t.toolCalls).toEqual([{ id: 'c1', name: 'search', input: { q: 'x' } }]); expect(t.stop).toBe('tool');
  });
  it('google functionCall parts', () => {
    const t = parseResponse('google', { candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { id: 7 } } }] } }] });
    expect(t.toolCalls[0]).toEqual({ id: '', name: 'lookup', input: { id: 7 } });
  });
  it('a plain text reply is a final answer (stop=end)', () => {
    expect(parseResponse('anthropic', { content: [{ type: 'text', text: 'final' }] })).toEqual({ text: 'final', toolCalls: [], stop: 'end' });
  });
});
