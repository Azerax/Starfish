import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, Dispatcher, HostRunner, parseUsage,
  OPENAI, OPENROUTER, type Provider,
} from './index';

const auditFile = () => join(mkdtempSync(join(tmpdir(), 'sf-run-')), 'a.jsonl');
const ANTH: Provider[] = [{ id: 'anthropic', name: 'A', kind: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'https://api.anthropic.com', requiresKey: true }];

function harness(providers: Provider[], usageBody: unknown, opts: { status?: number; ok?: boolean } = {}) {
  const path = auditFile();
  const audit = new AuditLog(path);
  const tokens = new TokenGovernor(audit);
  const d = new Dispatcher({ providers: new ProviderRegistry(providers, providers[0].id), router: new ModelRouter(undefined, audit), tokens, audit });
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetcher = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return { status: opts.status ?? 200, ok: opts.ok ?? true, text: async () => JSON.stringify(usageBody) };
  };
  return { path, audit, tokens, d, calls, fetcher };
}
const plan = (d: Dispatcher, riskTier: 'low' | 'high' = 'high') =>
  d.plan({ agentId: 'worker', task: { id: 't', riskTier }, messages: [{ role: 'user', content: 'hi' }] });

describe('host send-runner — closes the dispatch loop (key + network isolated)', () => {
  const KEY = 'sk-super-secret-DO-NOT-LOG-123';

  it('injects the key into the wire request but never onto the plan or the audit', async () => {
    const { d, tokens, fetcher, calls, path } = harness(ANTH, { usage: { input_tokens: 10, output_tokens: 5 } });
    const p = plan(d);
    const runner = new HostRunner({ tokens, keyResolver: () => KEY, fetcher });
    const r = await runner.run(p);
    expect(calls[0].headers['x-api-key']).toBe(KEY);                 // key on the wire
    expect(JSON.stringify(p.request)).not.toContain(KEY);            // ...not on the plan
    expect(readFileSync(path, 'utf8')).not.toContain(KEY);          // ...not in the audit
    expect(r.tokens).toBe(15);
  });

  it('records usage back into the Token Governor (feeds the next route budget)', async () => {
    const { d, tokens, fetcher } = harness(ANTH, { usage: { input_tokens: 40, output_tokens: 20 } });
    tokens.setBudget('worker', { softTokens: 50, hardTokens: 1000 });
    const r = await new HostRunner({ tokens, keyResolver: () => KEY, fetcher }).run(plan(d));
    expect(r.tokens).toBe(60);
    expect(r.budget).toBe('soft');                                   // 60 >= soft 50
    expect(tokens.status('worker')).toBe('soft');
  });

  it('computes USD from an operator price table', async () => {
    const { d, tokens, fetcher } = harness(ANTH, { usage: { input_tokens: 500_000, output_tokens: 500_000 } });
    const r = await new HostRunner({ tokens, keyResolver: () => KEY, fetcher, prices: { 'claude-opus-4-8': { perMTokUsd: 30 } } }).run(plan(d));
    expect(r.tokens).toBe(1_000_000);
    expect(r.usd).toBeCloseTo(30, 5);
  });

  it('fails closed when no key is configured (and does not hit the network)', async () => {
    const { d, tokens, fetcher, calls, path, audit } = harness(ANTH, {});
    await expect(new HostRunner({ tokens, keyResolver: () => undefined, fetcher, audit }).run(plan(d))).rejects.toThrow(/no API key|send blocked/i);
    expect(calls.length).toBe(0);
    expect(readFileSync(path, 'utf8')).toContain('send-blocked');
  });

  it('blocks hosted-router data-egress unless the operator opts in', async () => {
    const blocked = harness([OPENROUTER], { usage: { total_tokens: 5 } });
    await expect(new HostRunner({ tokens: blocked.tokens, keyResolver: () => KEY, fetcher: blocked.fetcher, audit: blocked.audit }).run(plan(blocked.d, 'low'))).rejects.toThrow(/egress/i);
    expect(blocked.calls.length).toBe(0);
    expect(readFileSync(blocked.path, 'utf8')).toContain('egress-blocked');

    const allowed = harness([OPENROUTER], { usage: { total_tokens: 5 } });
    const r = await new HostRunner({ tokens: allowed.tokens, keyResolver: () => KEY, fetcher: allowed.fetcher, allowEgress: true, audit: allowed.audit }).run(plan(allowed.d, 'low'));
    expect(r.ok).toBe(true);
    expect(allowed.calls[0].headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('audits the model-call (status/tokens/budget) without the key', async () => {
    const { d, tokens, fetcher, path, audit } = harness([OPENAI], { usage: { total_tokens: 12 } });
    await new HostRunner({ tokens, keyResolver: () => KEY, fetcher, audit }).run(plan(d, 'low'));
    const ev = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; reason?: string });
    const call = ev.find((e) => e.action === 'model-call');
    expect(call).toBeTruthy();
    expect(call?.reason).toContain('tokens=12');
    expect(JSON.stringify(ev)).not.toContain(KEY);
  });
});

describe('parseUsage — per-provider token extraction', () => {
  it('anthropic input+output', () => { expect(parseUsage('anthropic', { usage: { input_tokens: 3, output_tokens: 4 } }).tokens).toBe(7); });
  it('openai total_tokens', () => { expect(parseUsage('openai', { usage: { total_tokens: 9 } }).tokens).toBe(9); });
  it('openai prompt+completion fallback', () => { expect(parseUsage('openai', { usage: { prompt_tokens: 2, completion_tokens: 5 } }).tokens).toBe(7); });
  it('google totalTokenCount', () => { expect(parseUsage('google', { usageMetadata: { totalTokenCount: 11 } }).tokens).toBe(11); });
  it('garbage => 0', () => { expect(parseUsage('local', null).tokens).toBe(0); });
});
