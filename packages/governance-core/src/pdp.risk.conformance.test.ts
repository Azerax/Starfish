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
    // A critical-tier command that is NOT on the catastrophic denylist: `rm -rf ./build` is a real
    // destructive action but a legitimate one, so it escalates to a human rather than hard-denying.
    const p = pdp([{ id: 'sh', category: 'exec', pathParams: [], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'sh', input: { cmd: 'rm -rf ./build' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true); expect(d.riskTier).toBe('critical');
    expect(d.askOrigin).toBe('floor');   // F-3: a critical ask is a floor no friction profile may satisfy
  });
  // F-11: the catastrophic denylist is now a HARD FLOOR inside the PDP, not only in the hooks overlay.
  // `rm -rf /` is not approvable — it is denied outright, ahead of policy and tolerance, so an SDK or
  // sidecar consumer inherits the same protection the Claude Code overlay always had.
  it('F-11: a catastrophic command is DENIED outright in the PDP, not offered for approval', () => {
    const p = pdp([{ id: 'sh', category: 'exec', pathParams: [], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'sh', input: { cmd: 'rm -rf /' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.ask).toBeFalsy();                       // NOT approvable
    expect(d.reason).toMatch(/catastrophic/i);
  });
  it('F-11: the egress host guard is a PDP floor too (internal/loopback destinations)', () => {
    const p = pdp([{ id: 'net', category: 'network', pathParams: [], allowedAgents: '*', riskTier: 'medium' }],
      [{ id: 'p', subject: '*', action: '*', resource: '*', effect: 'allow' }] as any);
    const d = p.decide('ingress', { agentId: 'a', tool: 'net', input: { url: 'http://169.254.169.254/latest/meta-data/' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/blocked internal|loopback|metadata/i);
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

describe('F6 — policy resource is the DECLARED path, not the first string input', () => {
  it('a benign decoy input cannot steer adjudication to a rule scoped to the decoy', () => {
    // deny writes to /etc/*; a rule that would allow /project/* must NOT be reached via a decoy.
    const rules = [
      { id: 'd', subject: 'agent:a', action: 'tool:w', resource: '/etc/*', effect: 'deny' },
      { id: 'a', subject: 'agent:a', action: 'tool:w', resource: '/project/*', effect: 'allow' },
    ];
    const p = pdp([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }], rules as never);
    // `note` is first in JSON order (the decoy), but `path` is the declared pathParam.
    const d = p.decide('ingress',
      { agentId: 'a', tool: 'w', input: { note: '/project/ok', path: '/etc/passwd' } },
      { visibility: ['/'], write: ['/'] });
    expect(d.reason).not.toContain('allowed by policy');   // must not match the /project allow via the decoy
  });
});

describe('F7 — an agent’s own capability allowlist is enforced (not only tool.allowedAgents)', () => {
  function pdpWithAgents(tools: unknown[], agents: unknown[]) {
    const d = mkdtempSync(join(tmpdir(), 'sf-f7-'));
    writeFileSync(join(d, 'tools.json'), JSON.stringify(tools));
    writeFileSync(join(d, 'agents.json'), JSON.stringify(agents));
    const tr = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
    const ar = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
    return new PDP(tr, ar, new AuditLog(join(d, 'audit.jsonl')), new RiskEngine(), new PolicyEngine([]));
  }
  const fsRead = { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' };

  it('a read-only agent cannot call a *-granted tool outside its allowlist (Thucydides invariant)', () => {
    const p = pdpWithAgents([fsRead], [{ id: 'thucydides', allowedTools: ['memory.read'] }]);
    const d = p.decide('ingress', { agentId: 'thucydides', tool: 'fs.read', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false);
    expect(d.reason).toContain('allowlist');
  });

  it('an agent that declares NO allowlist is unrestricted (backward-compatible)', () => {
    const p = pdpWithAgents([fsRead], [{ id: 'michael' }]);   // no allowedTools
    expect(p.decide('ingress', { agentId: 'michael', tool: 'fs.read', input: { path: '/tmp/x' } }, BS).allow).toBe(true);
  });

  it('an agent may call a tool that IS in its allowlist', () => {
    const p = pdpWithAgents([fsRead], [{ id: 'thucydides', allowedTools: ['memory.read', 'fs.read'] }]);
    expect(p.decide('ingress', { agentId: 'thucydides', tool: 'fs.read', input: { path: '/tmp/x' } }, BS).allow).toBe(true);
  });
});
