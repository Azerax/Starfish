import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isSecretPath, classifyPath, containsSecret, redactSecrets, secretReadGate, scanEgress,
  PDP, Registry, AuditLog, RiskEngine, PolicyEngine, type ToolDef, type AgentDef, type BoundarySet, type SecretPolicy,
} from './index';

describe('secret path classification', () => {
  it('flags .env and credential files (any location)', () => {
    for (const p of ['.env', '.env.local', '/proj/.env', 'proj\\.env.production', 'id_rsa', 'k.pem', '/h/.aws/credentials', '.npmrc', 'secrets.json'])
      expect(isSecretPath(p), p).toBe(true);
  });
  it('does not flag ordinary files', () => {
    for (const p of ['src/app.ts', 'README.md', 'env.example.md', 'environment.ts'])
      expect(isSecretPath(p), p).toBe(false);
    expect(classifyPath('/proj/.env').why).toMatch(/env/);
  });
});

describe('secret value detection + redaction', () => {
  it('detects common secret shapes', () => {
    expect(containsSecret('AKIA1234567890ABCDEF')).toBe(true);
    expect(containsSecret('token=sk-abcdefabcdefabcdef12')).toBe(true);
    expect(containsSecret('API_KEY=hunter2supersecret')).toBe(true);
    expect(containsSecret('just some normal text')).toBe(false);
  });
  it('redacts the value but keeps the key name', () => {
    const { redacted, hits } = redactSecrets('DB_PASSWORD=hunter2\nname=ok');
    expect(redacted).toContain('DB_PASSWORD=[redacted:secret]');
    expect(redacted).toContain('name=ok');
    expect(hits.length).toBeGreaterThan(0);
  });
  it('egress now blocks secret material', () => {
    expect(scanEgress('here is AKIA1234567890ABCDEF').clean).toBe(false);
    expect(scanEgress('nothing secret here').clean).toBe(true);
  });
});

describe('secretReadGate — deny by default', () => {
  it('denies reading a secret file without a grant', () => {
    expect(secretReadGate('worker', ['/proj/.env']).allow).toBe(false);
  });
  it('allows with an explicit operator grant', () => {
    const policy: SecretPolicy = { allowReadByAgent: (a, p) => a === 'deployer' && p.endsWith('.env') };
    expect(secretReadGate('deployer', ['/proj/.env'], policy).allow).toBe(true);
    expect(secretReadGate('worker', ['/proj/.env'], policy).allow).toBe(false);
  });
});

describe('PDP — reading .env is denied by default, allowed only by grant', () => {
  const BS: BoundarySet = { visibility: ['/'], write: ['/'] };
  function pdp(secretPolicy?: SecretPolicy) {
    const dir = mkdtempSync(join(tmpdir(), 'sf-sec-'));
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' }] as ToolDef[]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }, { id: 'deployer' }] as AgentDef[]));
    return new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id),
      new AuditLog(join(dir, 'audit.jsonl')), new RiskEngine(), new PolicyEngine([{ id: 'p', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' }] as never), undefined, undefined, secretPolicy);
  }
  it('a normal file read is allowed; a .env read is denied (critical)', () => {
    const p = pdp();
    expect(p.decide('ingress', { agentId: 'worker', tool: 'fs.read', input: { path: '/proj/src/a.ts' } }, BS).allow).toBe(true);
    const d = p.decide('ingress', { agentId: 'worker', tool: 'fs.read', input: { path: '/proj/.env' } }, BS);
    expect(d.allow).toBe(false); expect(d.riskTier).toBe('critical'); expect(d.reason).toMatch(/secret-file/);
  });
  it('an explicit grant lets the deployer read .env', () => {
    const p = pdp({ allowReadByAgent: (a) => a === 'deployer' });
    expect(p.decide('ingress', { agentId: 'deployer', tool: 'fs.read', input: { path: '/proj/.env' } }, BS).allow).toBe(true);
    expect(p.decide('ingress', { agentId: 'worker', tool: 'fs.read', input: { path: '/proj/.env' } }, BS).allow).toBe(false);
  });
});

import { screenEnv, secretWriteGate } from './index';

describe('.env poisoning defense — screenEnv', () => {
  it('blocks code-execution / hijack env keys', () => {
    expect(screenEnv('NODE_OPTIONS=--require /tmp/evil.js').ok).toBe(false);
    expect(screenEnv('LD_PRELOAD=/tmp/evil.so').ok).toBe(false);
    expect(screenEnv('GIT_SSH_COMMAND=sh -c curl|sh').ok).toBe(false);
    expect(screenEnv('PATH=/tmp/evil:$PATH').ok).toBe(false);
    expect(screenEnv('ANTHROPIC_BASE_URL=https://evil.test').ok).toBe(false);
    expect(screenEnv('STARFISH_ALLOW_EGRESS=1').ok).toBe(false);
  });
  it('passes an ordinary .env', () => {
    expect(screenEnv('DATABASE_URL=postgres://localhost/app\nLOG_LEVEL=info\nFEATURE_X=true').ok).toBe(true);
  });
});

describe('Toby is the gatekeeper for secret files — secretWriteGate', () => {
  it('denies a non-gatekeeper agent from writing .env', () => {
    expect(secretWriteGate('worker', ['/proj/.env'], 'A=1', { gatekeeper: 'toby' }).allow).toBe(false);
  });
  it('lets the gatekeeper write clean content', () => {
    expect(secretWriteGate('toby', ['/proj/.env'], 'A=1', { gatekeeper: 'toby' }).allow).toBe(true);
  });
  it('rejects poisoned content even from the gatekeeper', () => {
    expect(secretWriteGate('toby', ['/proj/.env'], 'NODE_OPTIONS=--require /tmp/x.js', { gatekeeper: 'toby' }).allow).toBe(false);
  });
});

describe('PDP — only the gatekeeper may add/modify .env', () => {
  const BS2: BoundarySet = { visibility: ['/'], write: ['/'] };
  function pdpW() {
    const dir = mkdtempSync(join(tmpdir(), 'sf-secw-'));
    writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' }] as ToolDef[]));
    writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }, { id: 'toby' }] as AgentDef[]));
    return new PDP(new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id), new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id),
      new AuditLog(join(dir, 'audit.jsonl')), new RiskEngine(), new PolicyEngine([{ id: 'p', subject: '*', action: 'tool:fs.write', resource: '*', effect: 'allow' }] as never), undefined, undefined, undefined, 'toby');
  }
  it('non-gatekeeper write to .env is denied', () => {
    expect(pdpW().decide('ingress', { agentId: 'worker', tool: 'fs.write', input: { path: '/proj/.env', content: 'A=1' } }, BS2).allow).toBe(false);
  });
  it('gatekeeper write of clean .env is allowed; poisoned is denied', () => {
    const p = pdpW();
    expect(p.decide('ingress', { agentId: 'toby', tool: 'fs.write', input: { path: '/proj/.env', content: 'A=1' } }, BS2).allow).toBe(true);
    expect(p.decide('ingress', { agentId: 'toby', tool: 'fs.write', input: { path: '/proj/.env', content: 'LD_PRELOAD=/x.so' } }, BS2).allow).toBe(false);
  });
});
