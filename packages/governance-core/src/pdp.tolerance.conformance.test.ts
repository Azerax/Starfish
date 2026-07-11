import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDP, Registry, AuditLog, RiskEngine, PolicyEngine } from './index';
import type { ToolDef, AgentDef, BoundarySet } from './index';

// RM-2: Risk Tolerance widens auto-run for mid-risk work under Medium, and NEVER lifts a floor,
// critical, injection, or policy-deny. Default Low reproduces today's behaviour exactly.
function build(tools: ToolDef[], rules: unknown[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'sf-tol-'));
  writeFileSync(join(d, 'tools.json'), JSON.stringify(tools));
  writeFileSync(join(d, 'agents.json'), JSON.stringify([{ id: 'a' }]));
  const tr = new Registry<ToolDef>(join(d, 'tools.json'), (t) => t.id);
  const ar = new Registry<AgentDef>(join(d, 'agents.json'), (a) => a.id);
  return new PDP(tr, ar, new AuditLog(join(d, 'audit.jsonl')), new RiskEngine(), new PolicyEngine(rules as never));
}
const BS: BoundarySet = { visibility: ['/'], write: ['/'] };

describe('RM-2 — Risk Tolerance widening', () => {
  it('default is Low and a medium write still asks (unchanged)', () => {
    const p = build([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }]);
    expect(p.getRiskTolerance()).toBe('low');
    const d = p.decide('ingress', { agentId: 'a', tool: 'w', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true);
    expect(typeof d.score).toBe('number'); // score is surfaced
  });
  it('under Medium, a medium write auto-allows', () => {
    const p = build([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }]);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'w', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(true);
    expect(d.reason).toContain('medium risk tolerance');
  });
  it('under Medium, a high (network) action auto-allows', () => {
    const p = build([{ id: 'net', category: 'exec', pathParams: [], allowedAgents: '*' }]);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'net', input: { url: 'https://x.com' } }, BS);
    expect(d.allow).toBe(true);
  });
  it('Medium never lifts critical — a destructive command still asks', () => {
    const p = build([{ id: 'sh', category: 'exec', pathParams: [], allowedAgents: '*' }]);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'sh', input: { cmd: 'rm -rf /' } }, BS);
    expect(d.allow).toBe(false); expect(d.ask).toBe(true); expect(d.riskTier).toBe('critical');
  });
  it('Medium never lifts a policy deny', () => {
    const p = build([{ id: 'w', category: 'write', pathParams: ['path'], allowedAgents: '*' }],
      [{ id: 'p', subject: '*', action: 'tool:w', resource: '*', effect: 'deny' }]);
    p.setRiskTolerance('medium');
    const d = p.decide('ingress', { agentId: 'a', tool: 'w', input: { path: '/tmp/x' } }, BS);
    expect(d.allow).toBe(false);
  });
});
