import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, ModelRouter } from './index';

describe('governed model router', () => {
  it('routes by risk: low→cheap, high/critical→strong, else fallback', () => {
    const r = new ModelRouter();
    expect(r.select({ riskTier: 'low' }).model).toBe('claude-haiku-4-5');
    expect(r.select({ riskTier: 'high' }).model).toBe('claude-opus-4-8');
    expect(r.select({ riskTier: 'critical' }).model).toBe('claude-opus-4-8');
    expect(r.select({}).model).toBe('claude-sonnet-4-6');
  });
  it('downshifts under hard budget — but NOT high/critical (correctness wins)', () => {
    const r = new ModelRouter();
    expect(r.select({ riskTier: 'medium', budget: 'hard' }).model).toBe('claude-haiku-4-5');
    expect(r.select({ riskTier: 'critical', budget: 'hard' }).model).toBe('claude-opus-4-8');
  });
  it('is deterministic — same inputs, same model', () => {
    const r = new ModelRouter();
    expect(r.select({ riskTier: 'high', budget: 'soft' })).toEqual(r.select({ riskTier: 'high', budget: 'soft' }));
  });
  it('audits every selection (model-selected)', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'sf-rt-')), 'a.jsonl');
    new ModelRouter(undefined, new AuditLog(p)).select({ riskTier: 'low' });
    const ev = readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { action: string; target?: string });
    expect(ev.some((e) => e.action === 'model-selected' && e.target === 'claude-haiku-4-5')).toBe(true);
  });
});
