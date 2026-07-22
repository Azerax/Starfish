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

describe('self-audit fixes — F8 / F9 / F10', () => {
  it('F8: an explicit ask policy on a LOW tool is honoured (not silently auto-allowed)', () => {
    const p = pdp([{ id: 'r', category: 'read', pathParams: ['path'], allowedAgents: '*' }],
      [{ id: 'p', subject: 'agent:a', action: 'tool:r', resource: '*', effect: 'ask' }] as never);
    const d = p.decide('ingress', { agentId: 'a', tool: 'r', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.ask).toBe(true);
  });

  it('F10: a tool with an UNKNOWN category and no riskTier fails safe to critical (human), not low', () => {
    const p = pdp([{ id: 'weird', category: 'teleport' as never, pathParams: [], allowedAgents: '*' }]);
    const d = p.decide('ingress', { agentId: 'a', tool: 'weird', input: {} }, BS);
    expect(d.allow).toBe(false);          // was: auto-allowed as low
    expect(d.riskTier).toBe('critical');
  });

  it('F9: a meta tool that declares a path gets a boundary check (no null-mode skip)', () => {
    const p = pdp([{ id: 'm', category: 'meta', pathParams: ['path'], allowedAgents: '*' }],
      [{ id: 'p', subject: 'agent:a', action: 'tool:m', resource: '*', effect: 'allow' }] as never);
    // a path OUTSIDE the boundary must be denied even for a meta tool
    const d = p.decide('ingress', { agentId: 'a', tool: 'm', input: { path: '/etc/shadow' } },
      { visibility: ['/tmp'], write: ['/tmp'] });
    expect(d.allow).toBe(false);
    expect(d.reason).toContain('boundary');
  });
});

describe('F1 — a shell command reading a secret path can never silently auto-allow', () => {
  const shellTool = [{ id: 'shell', category: 'exec' as const, pathParams: [], allowedAgents: '*' as const }];

  it('cat of an SSH private key escalates to ASK, not allow (even with an allow policy)', () => {
    const p = pdp(shellTool, [{ id: 'a', subject: 'agent:a', action: 'tool:shell', resource: '*', effect: 'allow' }] as never);
    const d = p.decide('ingress', { agentId: 'a', tool: 'shell', input: { command: 'cat ~/.ssh/id_rsa' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.ask).toBe(true);
    expect(d.reason).toContain('secret');
  });

  it('the same holds under MEDIUM tolerance (the tier ceiling cannot lift it)', () => {
    const p = pdp(shellTool, [{ id: 'a', subject: 'agent:a', action: 'tool:shell', resource: '*', effect: 'allow' }] as never);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'shell', input: { command: 'cp /home/u/.aws/credentials /tmp/x' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.ask).toBe(true);
  });

  it('a plain .env read and an input redirect are caught', () => {
    const p = pdp(shellTool);
    expect(p.decide('ingress', { agentId: 'a', tool: 'shell', input: { command: 'base64 .env' } }, BS).ask).toBe(true);
    expect(p.decide('ingress', { agentId: 'a', tool: 'shell', input: { command: 'openssl rsa < server.pem' } }, BS).ask).toBe(true);
  });

  it('legitimate shell commands are NOT tripped (no false positives on the golden path)', () => {
    const p = pdp(shellTool, [{ id: 'a', subject: 'agent:a', action: 'tool:shell', resource: '*', effect: 'allow' }] as never);
    for (const command of [
      'npm run build',
      'git commit -m "note about the .env docs"',   // mentions .env but no read verb applied to a path
      'node --test',
      'ls -la src',
      'echo hello > notes.txt',
      'cat src/index.ts',                            // reads a normal file, not a secret
    ]) {
      const d = p.decide('ingress', { agentId: 'a', tool: 'shell', input: { command } }, BS);
      expect(d.reason, command).not.toContain('secret');
    }
  });
});
