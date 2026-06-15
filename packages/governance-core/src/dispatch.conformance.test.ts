import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, AdapterRegistry, Dispatcher,
  AVAILABLE_PROVIDERS, anthropicAdapter, openaiAdapter, googleAdapter, localAdapter, routerAdapter,
  ANTHROPIC, OPENAI, GOOGLE, OPENROUTER, LOCAL,
} from './index';

const auditFile = () => join(mkdtempSync(join(tmpdir(), 'sf-dx-')), 'a.jsonl');
const mkDispatcher = (path: string, providers = AVAILABLE_PROVIDERS) => {
  const audit = new AuditLog(path);
  const tokens = new TokenGovernor(audit);
  return { audit, tokens, d: new Dispatcher({ providers: new ProviderRegistry(providers, providers[0].id), router: new ModelRouter(undefined, audit), tokens, audit }) };
};
const noKey = (req: unknown) => {
  const s = JSON.stringify(req).toLowerCase();
  return !s.includes('apikey') && !s.includes('"key"') && !s.includes('secret') && !s.includes('bearer ') && !s.includes('sk-');
};

describe('governed dispatch — router × token governor × provider adapter', () => {
  it('high-risk task routes to the strong model on the active provider', () => {
    const { d } = mkDispatcher(auditFile());
    const plan = d.plan({ agentId: 'worker', task: { id: 't1', riskTier: 'high' }, messages: [{ role: 'user', content: 'hi' }] });
    expect(plan.route.model).toBe('claude-opus-4-8');
    expect(plan.provider.id).toBe('anthropic');
    expect(plan.request.url).toContain('/v1/messages');
    expect(plan.request.model).toBe('claude-opus-4-8');
  });

  it('NEVER places the API key in the request (host injects it from the keychain at send time)', () => {
    const { d } = mkDispatcher(auditFile());
    const plan = d.plan({ agentId: 'worker', task: { id: 't2', riskTier: 'high' }, messages: [{ role: 'user', content: 'x' }] });
    expect(plan.request.authScheme).toBe('x-api-key');     // host attaches the key to this header
    expect(plan.request.authHeader).toBe('x-api-key');
    expect(noKey(plan.request)).toBe(true);                 // ...but the request object carries no secret
  });

  it('downshifts to the cheap model under SOFT budget — but not high/critical', () => {
    const { tokens, d } = mkDispatcher(auditFile());
    tokens.setBudget('worker', { softUsd: 1, hardUsd: 100 });
    tokens.record('worker', 2, 0);                          // cross soft
    expect(tokens.status('worker')).toBe('soft');
    expect(d.plan({ agentId: 'worker', task: { id: 't3', riskTier: 'medium' }, messages: [{ role: 'user', content: 'x' }] }).route.model).toBe('claude-haiku-4-5');
    expect(d.plan({ agentId: 'worker', task: { id: 't4', riskTier: 'critical' }, messages: [{ role: 'user', content: 'x' }] }).route.model).toBe('claude-opus-4-8');
  });

  it('fails closed at HARD budget — paused agent cannot dispatch (human resume required)', () => {
    const path = auditFile();
    const { tokens, d } = mkDispatcher(path);
    tokens.setBudget('worker', { hardUsd: 1 });
    tokens.record('worker', 2, 0);                          // cross hard → paused
    expect(() => d.plan({ agentId: 'worker', task: { id: 't5' }, messages: [{ role: 'user', content: 'x' }] })).toThrow(/hard budget|paused/i);
    const ev = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
    expect(ev.some((e) => e.action === 'dispatch-blocked')).toBe(true);
  });

  it('substitutes the active provider (audited) when the routed provider is not registered', () => {
    const path = auditFile();
    const { d } = mkDispatcher(path, [LOCAL]);              // only a local provider configured
    const plan = d.plan({ agentId: 'worker', task: { id: 't6', riskTier: 'high' }, messages: [{ role: 'user', content: 'x' }] });
    expect(plan.provider.id).toBe('local');                // routed 'anthropic' absent → active 'local'
    expect(plan.request.authScheme).toBe('none');
    const ev = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
    expect(ev.some((e) => e.action === 'route-provider-substituted')).toBe(true);
  });

  it('every dispatch is audited (dispatch-planned + model-selected)', () => {
    const path = auditFile();
    const { d } = mkDispatcher(path);
    d.plan({ agentId: 'worker', task: { id: 't7', riskTier: 'low' }, messages: [{ role: 'user', content: 'x' }] });
    const ev = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string });
    expect(ev.some((e) => e.action === 'model-selected')).toBe(true);
    expect(ev.some((e) => e.action === 'dispatch-planned')).toBe(true);
  });
});

describe('runtime adapters — one shape per provider kind, never carrying the key', () => {
  const turns = [{ role: 'user' as const, content: 'hello' }];
  it('anthropic → Messages API, x-api-key', () => {
    const r = anthropicAdapter.buildRequest({ provider: ANTHROPIC, model: 'claude-opus-4-8', system: 'sys', messages: turns });
    expect(r.url).toContain('api.anthropic.com'); expect(r.url).toContain('/v1/messages'); expect(r.authHeader).toBe('x-api-key'); expect(noKey(r)).toBe(true);
  });
  it('openai → chat/completions, bearer', () => {
    const r = openaiAdapter.buildRequest({ provider: OPENAI, model: 'gpt-4o', system: 'sys', messages: turns });
    expect(r.url).toContain('/chat/completions'); expect(r.authScheme).toBe('bearer'); expect(noKey(r)).toBe(true);
  });
  it('google → generateContent, x-goog-api-key', () => {
    const r = googleAdapter.buildRequest({ provider: GOOGLE, model: 'gemini-1.5-pro', messages: turns });
    expect(r.url).toContain(':generateContent'); expect(r.authHeader).toBe('x-goog-api-key'); expect(noKey(r)).toBe(true);
  });
  it('local → OpenAI-compatible, no auth', () => {
    const r = localAdapter.buildRequest({ provider: LOCAL, model: 'llama-3.1', messages: turns });
    expect(r.url).toContain('/chat/completions'); expect(r.authScheme).toBe('none'); expect(noKey(r)).toBe(true);
  });
  it('router (OpenRouter) → OpenAI-compatible, bearer, data-egress provider', () => {
    const r = routerAdapter.buildRequest({ provider: OPENROUTER, model: 'openrouter/auto', messages: turns });
    expect(r.url).toContain('openrouter.ai'); expect(r.authScheme).toBe('bearer'); expect(noKey(r)).toBe(true);
  });
  it('AdapterRegistry resolves every available provider kind and rejects unknown', () => {
    const reg = new AdapterRegistry();
    for (const p of AVAILABLE_PROVIDERS) expect(reg.has(p.kind)).toBe(true);
    expect(() => reg.for('custom')).toThrow();
  });
});
