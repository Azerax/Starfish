import { describe, it, expect } from 'vitest';
import { explainPolicy, simulatePolicyChange, PolicyEngine, savePolicies, loadPolicies, type PolicyRule } from './index';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RULES: PolicyRule[] = [
  { id: 'read-all', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' },
  { id: 'write-worker', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'ask' },
  { id: 'deny-net', subject: '*', action: 'tool:net', resource: '*', effect: 'deny' },
];

describe('policy explain (v0.20.0)', () => {
  it('names the matched rule and effect', () => {
    const e = explainPolicy(RULES, 'agent:worker', 'tool:fs.read', '/x');
    expect(e.decision).toBe('allow');
    expect(e.matched?.id).toBe('read-all');
    expect(e.reason).toContain("'read-all'");
  });
  it('first match wins (ask before a later allow would-be)', () => {
    expect(explainPolicy(RULES, 'agent:worker', 'tool:fs.write', '/x').decision).toBe('ask');
  });
  it('no match -> default-deny, and always states the floor is not overridable', () => {
    const e = explainPolicy(RULES, 'agent:worker', 'tool:shell', '/x');
    expect(e.decision).toBe('default-deny');
    expect(e.reason.toLowerCase()).toContain('deny-by-default');
    expect(e.reason.toLowerCase()).toContain('floor');
  });
  it('PolicyEngine.explain matches the standalone function', () => {
    const pe = new PolicyEngine(RULES);
    expect(pe.explain('x', 'tool:net', 'y').decision).toBe('deny');
  });
});

describe('policy simulate dry-run (v0.20.0)', () => {
  it('flags a widening (deny/default -> allow) as LOOSENED', () => {
    const proposed: PolicyRule[] = [...RULES, { id: 'allow-shell', subject: '*', action: 'tool:shell', resource: '*', effect: 'allow' }];
    const sim = simulatePolicyChange(RULES, proposed, [{ subject: 'agent:worker', action: 'tool:shell', resource: '/x' }]);
    expect(sim.deltas[0].before).toBe('default-deny');
    expect(sim.deltas[0].after).toBe('allow');
    expect(sim.deltas[0].loosened).toBe(true);
    expect(sim.loosened).toBe(1);
  });
  it('a no-op change reports unchanged; note asserts the floor is preserved', () => {
    const sim = simulatePolicyChange(RULES, RULES, [{ subject: 'x', action: 'tool:fs.read', resource: '/a' }]);
    expect(sim.unchanged).toBe(1);
    expect(sim.loosened).toBe(0);
    expect(sim.note.toLowerCase()).toContain('floor');
  });
  it('edit round-trip: save then load returns the same rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-pol-'));
    const file = join(dir, 'governance', 'policies.json');
    savePolicies(file, RULES);
    expect(loadPolicies(file)).toEqual(RULES);
  });
});
