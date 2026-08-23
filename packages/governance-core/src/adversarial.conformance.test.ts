// Regression suite for the 2026-08-20 external adversarial review (ADVERSARIAL-QA.md).
// Each test reproduces the ORIGINAL defect, so a regression fails loudly rather than quietly.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';
import { SecurityMonitor } from './monitor';
import { loadGovernor } from './boot';
import type { BoundarySet } from './types';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'sf-adv-'));

function governedRoot(): { dir: string; auditPath: string } {
  const d = tmp();
  const g = join(d, 'governance'); mkdirSync(g, { recursive: true });
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
    { id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' },
    { id: 'net', category: 'network', pathParams: [], allowedAgents: '*', riskTier: 'medium' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(g, 'policies.json'), JSON.stringify([]));
  return { dir: g, auditPath: join(d, 'audit.jsonl') };
}

describe('F-1 — a DELETED audit log is detected, not read as a fresh install', () => {
  it('an anchor with no log present trips integrity (was: ok:true, verify() true, seq 0)', () => {
    const d = tmp(); const p = join(d, 'audit.jsonl');
    const a1 = new AuditLog(p);
    a1.append({ actor: 'x', domain: 'system', action: 'boot' });
    a1.append({ actor: 'x', domain: 'tool', action: 'fs.write', decision: 'allow' });
    expect(existsSync(p + '.anchor')).toBe(true);

    rmSync(p);                                   // attacker deletes ONLY the log; anchor survives

    const a2 = new AuditLog(p);
    expect(a2.integrity.ok).toBe(false);
    expect(a2.integrity.reason).toMatch(/deleted/i);
    expect(a2.verify()).toBe(false);
  });

  it('a genuinely fresh install is still clean (no false positive)', () => {
    const a = new AuditLog(join(tmp(), 'audit.jsonl'));
    expect(a.integrity.ok).toBe(true);
    expect(a.verify()).toBe(true);
  });

  it('the governor enters SAFE MODE when it boots onto a deleted audit', () => {
    const { dir, auditPath } = governedRoot();
    const g1 = loadGovernor(dir, auditPath);
    expect(g1.safeMode).toBe(false);
    rmSync(auditPath);
    const g2 = loadGovernor(dir, auditPath);
    expect(g2.safeMode).toBe(true);
    const bs: BoundarySet = { visibility: [dir], write: [dir] };
    expect(g2.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.read', input: { path: join(dir, 'x') } }, bs).allow).toBe(false);
  });
});

describe('F-2 — the monitor cannot report "all clear" once the audit has vanished', () => {
  it('a vanished audit is a CRITICAL finding, not an empty window', () => {
    const d = tmp(); const p = join(d, 'audit.jsonl');
    const log = new AuditLog(p);
    log.append({ actor: 'x', domain: 'system', action: 'boot' });
    const m = new SecurityMonitor(p, new AuditLog(join(d, 'sink.jsonl')));
    expect(m.sweep().findings.length).toBe(0);          // healthy: nothing to report
    rmSync(p);
    const after = m.sweep();
    expect(after.findings.some((f) => f.kind === 'audit-vanished' && f.severity === 'critical')).toBe(true);
  });

  it('reconcile() REFUSES an all-clear it cannot corroborate (was: ok:true)', () => {
    const d = tmp(); const p = join(d, 'audit.jsonl');
    const log = new AuditLog(p);
    log.append({ actor: 'x', domain: 'system', action: 'boot' });
    const m = new SecurityMonitor(p, new AuditLog(join(d, 'sink.jsonl')));
    rmSync(p);
    const r = m.reconcile({ allClear: true });
    expect(r.ok).toBe(false);
    expect(r.alarm?.kind).toBe('audit-vanished');
  });
});

describe('F-11 — the shell and network floors are enforced in the PDP, on every surface', () => {
  const bs = (root: string): BoundarySet => ({ visibility: [root], write: [root] });

  it('a catastrophic shell command is denied through the CORE PDP (no hooks layer involved)', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath);
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'rm -rf /' } }, bs(dir));
    expect(d.allow).toBe(false);
    expect(d.ask).toBeFalsy();
    expect(d.reason).toMatch(/catastrophic/i);
  });

  it('a cloud-metadata destination is denied through the CORE PDP', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath);
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'net', input: { url: 'http://169.254.169.254/' } }, bs(dir));
    expect(d.allow).toBe(false);
  });

  it('legitimate work is unaffected (no false positives on the golden path)', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath);
    const ok = g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'npm run build' } }, bs(dir));
    expect(ok.reason).not.toMatch(/catastrophic/i);
    const net = g.pdp.decide('ingress', { agentId: 'worker', tool: 'net', input: { url: 'https://api.anthropic.com/v1' } }, bs(dir));
    expect(net.reason).not.toMatch(/blocked internal/i);
  });
});

describe('F-3 — an ask carries its origin, so a relaxation profile cannot outrank the operator', () => {
  const bs = (root: string): BoundarySet => ({ visibility: [root], write: [root] });

  it('a routine risk escalation is tagged "risk"', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath);
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.write', input: { path: join(dir, 'f.txt'), content: 'x' } }, bs(dir));
    expect(d.ask).toBe(true);
    expect(d.askOrigin).toBe('risk');
  });

  it('an explicit operator ask policy is tagged "policy" — distinguishable from routine risk', () => {
    const d0 = tmp(); const g0 = join(d0, 'governance'); mkdirSync(g0, { recursive: true });
    writeFileSync(join(g0, 'tools.json'), JSON.stringify([{ id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' }]));
    writeFileSync(join(g0, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
    writeFileSync(join(g0, 'policies.json'), JSON.stringify([
      { id: 'review', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'ask' },
    ]));
    const g = loadGovernor(g0, join(d0, 'audit.jsonl'));
    const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.write', input: { path: join(d0, 'f.txt'), content: 'x' } }, { visibility: [d0], write: [d0] });
    expect(d.ask).toBe(true);
    expect(d.askOrigin).toBe('policy');
  });
});
