import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, RiskToleranceStore } from './index';

function store() {
  const d = mkdtempSync(join(tmpdir(), 'sf-tol-'));
  return new RiskToleranceStore(new AuditLog(join(d, 'audit.jsonl')));
}

describe('RM-4 — governed Risk Tolerance store', () => {
  it('defaults to Low and fails safe to Low on corrupt/unknown config', () => {
    const s = store();
    expect(s.get()).toBe('low');
    expect(s.load({ riskTolerance: 'medium' })).toBe('medium');
    expect(s.load({ riskTolerance: 'bogus' })).toBe('low');   // unknown → Low
    expect(s.load(null)).toBe('low');                          // corrupt → Low
    expect(s.load('garbage')).toBe('low');
  });

  it('only an operator may change the setting (proposer≠approver on the setting itself)', () => {
    const s = store();
    const r = s.set('medium', 'agent.worker', { confirmed: true });
    expect(r.ok).toBe(false);
    expect(s.get()).toBe('low');
  });

  it('switching to Medium requires an explicit double-confirmation', () => {
    const s = store();
    expect(s.set('medium', 'operator').ok).toBe(false);            // no confirm → refused
    expect(s.get()).toBe('low');
    expect(s.set('medium', 'operator', { confirmed: true }).ok).toBe(true);
    expect(s.get()).toBe('medium');
  });

  it('switching back to Low needs no confirmation (safe direction)', () => {
    const s = store();
    s.set('medium', 'operator', { confirmed: true });
    const r = s.set('low', 'operator');
    expect(r.ok).toBe(true);
    expect(s.get()).toBe('low');
  });

  it('auto-revert only ever lowers to Low', () => {
    const s = store();
    s.set('medium', 'operator', { confirmed: true });
    expect(s.revertToLow()).toBe('low');
    expect(s.get()).toBe('low');
  });

  it('serialize round-trips the value', () => {
    const s = store();
    s.set('medium', 'operator', { confirmed: true });
    expect(s.serialize()).toEqual({ riskTolerance: 'medium' });
  });
});
