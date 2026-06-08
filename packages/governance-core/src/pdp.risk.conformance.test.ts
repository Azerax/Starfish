import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine } from './index';
import type { ToolDef, AgentDef, BoundarySet } from './index';

function pdp(tools: ToolDef[], rules = []) {
  const d = mkdtempSync(join(tmpdir(), 'sf-risk-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify(tools));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'a' }]));
  const tr = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const ar = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  return new PDP(tr, ar, new AuditLog(join(d, 'audit.jsonl')), new RiskEngine(), new PolicyEngine(rules));
}
const BS: BoundarySet = { visibility: ['/'], write: ['/'] };

describe('TC-2.2 — 4-tier risk routing', () => {
  it('low (read-only) auto-allows', () => {
    const p = pdp([{ id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' }]);
    const d = p.decide('ingress', { agentId: 'a', tool: 'r', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(true); expect(d.riskTier).toBe('low');
  });
  it('medium (workspace write) without a policy → ask', () => {
    const p = pdp([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }]);
    const d = p.decide('ingress', { agentId: 'a', tool: 'w', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true); expect(d.riskTier).toBe('medium');
  });
  it('medium with an explicit allow policy → allow', () => {
    const p = pdp([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }],
      [{ id: 'p1', subject: 'agent:a', action: 'tool:w', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'w', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(true);
  });
  it('high (network) without policy → ask', () => {
    const p = pdp([{ id: 'net', category: 'exec', pathParams: [], allowedAgents: '*' }]);
    const d = p.decide('ingress', { agentId: 'a', tool: 'net', input: { url: 'https://x.com' } }, BS);
    expect(d.ask).toBe(true); expect(d.riskTier).toBe('high');
  });
  it('critical (destructive) → human, no auto-allow even with allow policy', () => {
    const p = pdp([{ id: 'sh', category: 'exec', pathParams: [], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'sh', input: { cmd: 'rm -rf /' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true); expect(d.riskTier).toBe('critical');
  });
  it('policy deny overrides everything', () => {
    const p = pdp([{ id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: 'tool:r', resource: '*', effect: 'deny' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'r', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBeFalsy();
  });
});

describe('TC-2.5 — raw Bash unreachable; escorted exception is Critical/ask', () => {
  it('an unregistered Bash tool is denied (default-deny)', () => {
    const p = pdp([{ id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' }]);
    expect(p.decide('ingress', { agentId: 'a', tool: 'Bash', input: { cmd: 'ls' } }, BS).allow).toBe(false);
  });
  it('escorted shell is Critical → ask (human each time, never auto-allow)', () => {
    const p = pdp([{ id: 'bash_escorted', category: 'exec', riskTier: 'critical', pathParams: [], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'bash_escorted', input: { cmd: 'echo hi' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true);
  });
});

describe('TC-2.6 — egress containment', () => {
  it('blocks a tool result carrying private-key material', () => {
    const p = pdp([{ id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' }]);
    const d = p.decide('egress', { agentId: 'a', tool: 'r', input: { result: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...' } }, BS);
    expect(d.allow).toBe(false); expect(d.reason).toContain('egress-blocked');
  });
});
