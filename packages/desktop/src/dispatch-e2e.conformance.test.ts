// E2 — the honest "does a brief produce an artifact?" gate. The Calm Home UI is a one-input box over a
// governed agent run; before building the box we prove the run actually WRITES A REAL FILE. Each piece
// was tested in isolation (AgentLoop with a stub executor in governance-core; the executor with direct
// calls in peps.conformance) — this is the first test that drives the WHOLE seam: a model's tool call →
// AgentLoop → the real desktop executor → a real file on disk, under governance, no egress or API key.
//
// The model is stubbed (a scripted fetcher), so this verifies the PLUMBING deterministically. It does
// NOT verify a real model behaves well — that needs a live run (egress + key), tracked as E2-live.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, Dispatcher, HostRunner, PDP, Registry,
  RiskEngine, PolicyEngine, AgentLoop, type ToolDef, type AgentDef, type BoundarySet, type Provider, type ToolCall,
} from '@starfish/governance-core';
import { makeExecutor } from './peps';

const ANTH: Provider[] = [{ id: 'anthropic', name: 'A', kind: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'https://api.anthropic.com', requiresKey: true }];
const toolMsg = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ content: [{ type: 'tool_use', id: 'tu1', name, input }], usage: { input_tokens: 5, output_tokens: 3 } });
const finalMsg = (text: string) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 3 } });

describe('E2 — governed dispatch writes a real file end to end', () => {
  it('model tool_use(fs.write) → AgentLoop → real executor → file on disk', async () => {
    // First construct the root, THEN script the model with the real path.
    const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
    const target = join(dir, 'notes.md');
    const content = 'Written by a governed run.\n';
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' }]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.write'] }]));
    const audit = new AuditLog(join(dir, 'audit.jsonl'));
    const policy = new PolicyEngine([{ id: 'w', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'allow' }]);
    const pdp = new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id), audit, new RiskEngine(), policy);
    const tokens = new TokenGovernor(audit);
    const dispatcher = new Dispatcher({ providers: new ProviderRegistry(ANTH, 'anthropic'), router: new ModelRouter(undefined, audit), tokens, audit });
    const script = [toolMsg('fs.write', { path: target, content }), finalMsg('Done.')];
    let i = 0;
    const runner = new HostRunner({ tokens, keyResolver: () => 'sk-test', fetcher: async () => ({ status: 200, ok: true, text: async () => script[Math.min(i++, script.length - 1)] }), audit });
    const boundary: BoundarySet = { visibility: [dir], write: [dir] };
    const execute = makeExecutor({ projectRoot: dir, boundary, audit });
    const loop = new AgentLoop({ dispatcher, runner, pdp, boundaryFor: () => boundary, execute, audit, maxSteps: 6, enforceClaims: false });

    expect(existsSync(target)).toBe(false);
    const r = await loop.run({ agentId: 'worker', task: { id: 'm1', riskTier: 'medium' }, system: 'test', messages: [{ role: 'user', content: 'write notes.md' }], tools: [] });

    // The artifact is real.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(content);
    // The run is on the audit trail as a governed tool execution.
    expect(audit.recent(50).some((e) => e.action.includes('fs.write') && e.decision === 'allow')).toBe(true);
    expect(r.stopReason).toBeTruthy();
  });

  it('a write OUTSIDE the boundary is denied — the run cannot produce an artifact it should not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
    const outside = join(mkdtempSync(join(tmpdir(), 'sf-outside-')), 'stolen.txt');
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' }]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker', allowedTools: ['fs.write'] }]));
    const audit = new AuditLog(join(dir, 'audit.jsonl'));
    const policy = new PolicyEngine([{ id: 'w', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'allow' }]);
    const pdp = new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id), audit, new RiskEngine(), policy);
    const tokens = new TokenGovernor(audit);
    const dispatcher = new Dispatcher({ providers: new ProviderRegistry(ANTH, 'anthropic'), router: new ModelRouter(undefined, audit), tokens, audit });
    const script = [toolMsg('fs.write', { path: outside, content: 'exfil' }), finalMsg('tried.')];
    let i = 0;
    const runner = new HostRunner({ tokens, keyResolver: () => 'sk-test', fetcher: async () => ({ status: 200, ok: true, text: async () => script[Math.min(i++, script.length - 1)] }), audit });
    const boundary: BoundarySet = { visibility: [dir], write: [dir] };
    const execute = makeExecutor({ projectRoot: dir, boundary, audit });
    const loop = new AgentLoop({ dispatcher, runner, pdp, boundaryFor: () => boundary, execute, audit, maxSteps: 6, enforceClaims: false });

    await loop.run({ agentId: 'worker', task: { id: 'm1', riskTier: 'medium' }, system: 'test', messages: [{ role: 'user', content: 'write outside' }], tools: [] });
    expect(existsSync(outside)).toBe(false);   // governance held — no artifact outside the boundary
  });
});
