import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './audit';
import { TokenGovernor } from './tokens';

const gov = () => new TokenGovernor(new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-tok-')), 'a.jsonl')));

describe('TC-3.5 — Token Governor soft+escalate', () => {
  it('warns at soft, pauses at hard, resumes on demand', () => {
    const g = gov();
    g.setBudget('agent.a', { softUsd: 1, hardUsd: 2 });
    expect(g.record('agent.a', 0.5, 0)).toBe('ok');
    expect(g.record('agent.a', 0.6, 0)).toBe('soft');     // crosses 1.0
    expect(g.isPaused('agent.a')).toBe(false);
    expect(g.record('agent.a', 1.0, 0)).toBe('hard');     // crosses 2.0
    expect(g.isPaused('agent.a')).toBe(true);
    g.resume('agent.a', 'human');
    expect(g.isPaused('agent.a')).toBe(false);
  });
  it('token budgets work the same way', () => {
    const g = gov();
    g.setBudget('agent.b', { softTokens: 100, hardTokens: 200 });
    expect(g.record('agent.b', 0, 150)).toBe('soft');
    expect(g.record('agent.b', 0, 100)).toBe('hard');
  });
});
