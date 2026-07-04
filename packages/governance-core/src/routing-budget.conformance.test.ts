import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLog, TokenGovernor, ModelRouter, ProviderRegistry, Dispatcher,
  AVAILABLE_PROVIDERS, ANTHROPIC, AdapterRegistry,
  anthropicAdapter, openaiAdapter, googleAdapter, localAdapter, routerAdapter,
  type RoutingPolicy,
} from './index';
import { wireToolName, type ToolSchema } from './provider';

const auditFile = () => join(mkdtempSync(join(tmpdir(), 'sf-rb-')), 'a.jsonl');

// route every tier at a provider that we will NOT register, so substitution decisions are exercised
const MISSING: RoutingPolicy = {
  rules: [
    { id: 'crit', when: { riskTier: 'critical' }, use: { providerId: 'ghost', model: 'm-crit' } },
    { id: 'high', when: { riskTier: 'high' }, use: { providerId: 'ghost', model: 'm-high' } },
    { id: 'low', when: { riskTier: 'low' }, use: { providerId: 'ghost', model: 'm-low' } },
  ],
  fallback: { providerId: 'ghost', model: 'm-fallback' },
};

describe('capability-aware routing fails closed for high/critical (audit A14)', () => {
  const mk = () => {
    const audit = new AuditLog(auditFile());
    const tokens = new TokenGovernor(audit);
    const d = new Dispatcher({ providers: new ProviderRegistry([ANTHROPIC], ANTHROPIC.id), router: new ModelRouter(MISSING, audit), tokens, audit });
    return { d, audit };
  };
  it('a high-risk task throws rather than substituting the active provider', () => {
    const { d } = mk();
    expect(() => d.plan({ agentId: 'w', task: { id: 't', riskTier: 'high' }, messages: [{ role: 'user', content: 'x' }] })).toThrow(/fail closed|unavailable/i);
  });
  it('a critical task also fails closed', () => {
    const { d } = mk();
    expect(() => d.plan({ agentId: 'w', task: { id: 't', riskTier: 'critical' }, messages: [{ role: 'user', content: 'x' }] })).toThrow(/fail closed|unavailable/i);
  });
  it('a low-risk task may substitute the active provider (still audited)', () => {
    const { d } = mk();
    const plan = d.plan({ agentId: 'w', task: { id: 't', riskTier: 'low' }, messages: [{ role: 'user', content: 'x' }] });
    expect(plan.provider.id).toBe('anthropic');   // substituted, not thrown
  });
});

describe('adapter conformance — guards the tool-name-400 class (audit context)', () => {
  const adapters = [
    ['anthropic', anthropicAdapter], ['openai', openaiAdapter], ['google', googleAdapter],
    ['local', localAdapter], ['router', routerAdapter],
  ] as const;
  const provFor = (kind: string) => AVAILABLE_PROVIDERS.find((p) => p.kind === kind) ?? ANTHROPIC;
  const tools: ToolSchema[] = [{ name: 'fs.read', description: 'read', parameters: { type: 'object', properties: {} } }];
  for (const [kind, ad] of adapters) {
    it(`${kind}: builds a POST request and emits ONLY wire-safe tool names (no dots)`, () => {
      const req = ad.buildRequest({ provider: provFor(kind), model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], tools });
      expect(req.method).toBe('POST');
      expect(typeof req.url).toBe('string');
      const body = JSON.stringify(req.body);
      expect(body).toContain(wireToolName('fs.read'));   // fs__read present
      expect(body).not.toMatch(/"name"\s*:\s*"fs\.read"/);   // raw dotted name never on the wire
    });
  }
});

describe('per-agent budgets are isolated (v0.21.0)', () => {
  it('one agent hitting its hard budget does not pause another agent', () => {
    const audit = new AuditLog(auditFile());
    const tokens = new TokenGovernor(audit);
    tokens.setBudget('a', { hardUsd: 1 });
    tokens.setBudget('b', { hardUsd: 1 });
    tokens.record('a', 5, 100);   // blow a's budget
    expect(tokens.status('a')).toBe('hard');
    expect(tokens.status('b')).toBe('ok');   // b untouched
  });
});
