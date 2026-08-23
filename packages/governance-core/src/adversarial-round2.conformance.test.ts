// Second regression suite for the 2026-08-20 adversarial review — the gaps the twelve questions
// exposed that no F-number covered. Each test reproduces the ORIGINAL weakness.
//
//   Q12  self-authored execution — the two-hop chain from model output to code execution
//   Q4   authority granted by ABSENCE of configuration
//   Q2   shared upstream assumption: one wrong resource is wrong in policy, risk AND audit at once
//   Q9   failure indistinguishable from not-applicable
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor } from './boot';
import { AuditLog } from './audit';
import { DecisionBroker } from './broker';
import { isRunnerExecutable, isRunnerTool } from './execprovenance';
import type { BoundarySet, ToolCall } from './types';

function env(agents?: unknown[]) {
  const d = mkdtempSync(join(tmpdir(), 'sf-r2-'));
  const g = join(d, 'governance'); mkdirSync(g, { recursive: true });
  const proj = join(d, 'proj'); mkdirSync(proj, { recursive: true });
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
    { id: 'run_tests', category: 'exec', pathParams: [], allowedAgents: '*' },
    { id: 'git_commit', category: 'exec', pathParams: [], allowedAgents: '*' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify(agents ?? [{ id: 'worker' }]));
  writeFileSync(join(g, 'policies.json'), JSON.stringify([]));
  return { d, g, proj, audit: join(d, 'audit.jsonl'), bs: { visibility: [proj], write: [proj] } as BoundarySet };
}
const c = (o: Partial<ToolCall>): ToolCall => ({ agentId: 'worker', tool: 'fs.read', input: {}, ...o } as ToolCall);

describe('Q12 — self-authored execution closes the two-hop chain', () => {
  it('the exact reviewed chain no longer completes without a human at Medium tolerance', () => {
    const e = env();
    const g = loadGovernor(e.g, e.audit, { scopeMode: 'off' });   // isolate THIS control
    g.pdp.setRiskTolerance('medium');

    // hop 1 — unchanged: writing a test file is legitimate work and still auto-allows
    const write = g.pdp.decide('ingress', c({ taskId: 't1', tool: 'fs.write', input: { path: join(e.proj, 'evil.test.js'), content: 'require("child_process")' } }), e.bs);
    expect(write.allow).toBe(true);

    // hop 2 — was auto-allowed (score 60 <= the Medium ceiling of 70); now a human must see it
    const run = g.pdp.decide('ingress', c({ taskId: 't1', tool: 'run_tests', input: {} }), e.bs);
    expect(run.allow).toBe(false);
    expect(run.ask).toBe(true);
    expect(run.askOrigin).toBe('floor');            // tolerance may never satisfy it
    expect(run.reason).toMatch(/self-authored/i);
    expect(run.reason).toMatch(/evil\.test\.js/);
  });

  it('is targeted: ordinary source writes do not gate the runner', () => {
    const e = env();
    const g = loadGovernor(e.g, e.audit, { scopeMode: 'off' });
    g.pdp.setRiskTolerance('medium');
    g.pdp.decide('ingress', c({ taskId: 't', tool: 'fs.write', input: { path: join(e.proj, 'index.ts'), content: 'x' } }), e.bs);
    expect(g.pdp.decide('ingress', c({ taskId: 't', tool: 'run_tests', input: {} }), e.bs).allow).toBe(true);
  });

  it('is targeted: a test write does not gate a NON-runner exec tool', () => {
    const e = env();
    const g = loadGovernor(e.g, e.audit, { scopeMode: 'off' });
    g.pdp.setRiskTolerance('medium');
    g.pdp.decide('ingress', c({ taskId: 't', tool: 'fs.write', input: { path: join(e.proj, 'a.test.ts'), content: 'x' } }), e.bs);
    expect(g.pdp.decide('ingress', c({ taskId: 't', tool: 'git_commit', input: { message: 'm' } }), e.bs).allow).toBe(true);
  });

  it('is per-task: another task\'s write does not taint this one, and a DENIED write never taints', () => {
    const e = env();
    const g = loadGovernor(e.g, e.audit, { scopeMode: 'off' });
    g.pdp.setRiskTolerance('medium');
    g.pdp.decide('ingress', c({ taskId: 'other', tool: 'fs.write', input: { path: join(e.proj, 'b.test.ts'), content: 'x' } }), e.bs);
    expect(g.pdp.decide('ingress', c({ taskId: 'mine', tool: 'run_tests', input: {} }), e.bs).allow).toBe(true);

    const denied = g.pdp.decide('ingress', c({ taskId: 'mine', tool: 'fs.write', input: { path: '/etc/x.test.js', content: 'x' } }), e.bs);
    expect(denied.allow).toBe(false);                                        // out of boundary
    expect(g.pdp.decide('ingress', c({ taskId: 'mine', tool: 'run_tests', input: {} }), e.bs).allow).toBe(true);
  });

  it('the predicates are over-inclusive by design (a false positive costs one approval)', () => {
    for (const p of ['a.test.ts', 'a.spec.mjs', 'test_x.py', 'conftest.py', 'tests/helper.ts', '__tests__/h.js']) {
      expect(isRunnerExecutable(p), p).toBe(true);
    }
    for (const p of ['src/index.ts', 'README.md', 'package.json']) {
      expect(isRunnerExecutable(p), p).toBe(false);
    }
    expect(isRunnerTool('run_tests')).toBe(true);
    expect(isRunnerTool('git_commit')).toBe(false);
  });
});

describe('Q4 — authority granted by the ABSENCE of configuration is now visible, and optionally denied', () => {
  it('an agent with no allowedTools is still permitted (compat) but the grant is AUDITED', () => {
    const e = env([{ id: 'ghost' }]);                       // declares no allowedTools
    const g = loadGovernor(e.g, e.audit);
    writeFileSync(join(e.proj, 'f.txt'), 'x');
    const d = g.pdp.decide('ingress', c({ agentId: 'ghost', input: { path: join(e.proj, 'f.txt') } }), e.bs);
    expect(d.allow).toBe(true);
    expect(g.audit.recent(50).some((ev) => ev.action === 'agent-unrestricted' && ev.target === 'ghost')).toBe(true);
  });

  it('the notice is emitted once per agent, not on every call', () => {
    const e = env([{ id: 'ghost' }]);
    const g = loadGovernor(e.g, e.audit);
    writeFileSync(join(e.proj, 'f.txt'), 'x');
    for (let i = 0; i < 4; i++) g.pdp.decide('ingress', c({ agentId: 'ghost', input: { path: join(e.proj, 'f.txt') } }), e.bs);
    expect(g.audit.recent(80).filter((ev) => ev.action === 'agent-unrestricted').length).toBe(1);
  });

  it('strictAgentAllowlist turns the absence into a denial, and the posture says which', () => {
    const e = env([{ id: 'ghost' }]);
    const g = loadGovernor(e.g, e.audit, { strictAgentAllowlist: true });
    expect(g.posture.strictAgentAllowlist).toBe(true);
    writeFileSync(join(e.proj, 'f.txt'), 'x');
    const d = g.pdp.decide('ingress', c({ agentId: 'ghost', input: { path: join(e.proj, 'f.txt') } }), e.bs);
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/no capability allowlist/i);
  });

  it('a DECLARED allowlist is unaffected either way', () => {
    const e = env([{ id: 'worker', allowedTools: ['fs.read'] }]);
    const g = loadGovernor(e.g, e.audit, { strictAgentAllowlist: true });
    writeFileSync(join(e.proj, 'f.txt'), 'x');
    expect(g.pdp.decide('ingress', c({ input: { path: join(e.proj, 'f.txt') } }), e.bs).allow).toBe(true);
    expect(g.pdp.decide('ingress', c({ tool: 'fs.write', input: { path: join(e.proj, 'f.txt') } }), e.bs).allow).toBe(false);
  });
});

describe('Q2 — the resource a decision is adjudicated against is not steerable by key order', () => {
  it('a decoy first key cannot displace a conventionally-named resource for a pathless tool', () => {
    const e = env();
    const g = loadGovernor(e.g, e.audit, { scopeMode: 'off' });
    // `git_commit` declares no pathParams, so resourceOf falls back. A decoy placed first in JSON
    // order used to become the audited target AND the policy resource.
    g.pdp.decide('ingress', c({ tool: 'git_commit', input: { note: '/looks/harmless', command: 'rm -rf /tmp/x' } }), e.bs);
    const ev = g.audit.recent(20).reverse().find((x) => (x.action ?? '').includes('git_commit'));
    expect(ev?.target).toBe('rm -rf /tmp/x');       // the command, not the decoy
  });
});

describe('Q9 — a failure is distinguishable from "not applicable"', () => {
  it('an unwritable anchor is reported, not swallowed as best-effort', () => {
    const d = mkdtempSync(join(tmpdir(), 'sf-anchor-'));
    const p = join(d, 'audit.jsonl');
    const a = new AuditLog(p);
    a.append({ actor: 'x', domain: 'system', action: 'boot' });
    expect(a.anchorDegraded).toBe('');              // healthy: no false alarm

    // Make the anchor path un-writable by putting a DIRECTORY where the file belongs. The healthy
    // run above already wrote it as a file, so remove that first. (Cross-platform: opening a
    // directory for write fails on POSIX and Windows alike, unlike a chmod, which Windows ignores.)
    rmSync(p + '.anchor', { force: true });
    mkdirSync(p + '.anchor', { recursive: true });
    const b = new AuditLog(join(d, 'audit.jsonl'));
    b.append({ actor: 'x', domain: 'system', action: 'again' });
    expect(b.anchorDegraded).toMatch(/anchor unwritable/i);
    expect(b.anchorDegraded).toMatch(/no longer detectable/i);
  });

  it('a broker that cannot persist AUDITS the loss instead of pretending it saved', () => {
    const d = mkdtempSync(join(tmpdir(), 'sf-broker-'));
    const audit = new AuditLog(join(d, 'audit.jsonl'));
    // persist path points INSIDE a file, so mkdir/write throws
    writeFileSync(join(d, 'blocker'), 'not a directory');
    const broker = new DecisionBroker(audit, join(d, 'blocker', 'decisions.json'));
    broker.file({ actor: 'worker', kind: 'tool', tool: 'fs.write', reason: 'needs approval' });
    expect(audit.recent(20).some((e) => e.action === 'broker-persist-failed')).toBe(true);
  });
});
