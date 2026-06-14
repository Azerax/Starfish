import { describe, it, expect } from 'vitest';
import { FLEET, OPS, ThemeRegistry, displayName, label, type Theme } from './index';

const TREK = ['LCARS', 'Starfleet', 'U.S.S.', 'NCC-', 'Vulcan', 'Spock', 'Spokk', 'Odo', "O'Brien"];

describe('Theme system — user-swappable themes (ring 3)', () => {
  it('defaults to Fleet and lists registered themes', () => {
    const reg = new ThemeRegistry();
    expect(reg.active().id).toBe('fleet');
    expect(reg.list().map(t => t.id).sort()).toEqual(['fleet', 'ops']);
  });
  it('switches the active theme at runtime', () => {
    const reg = new ThemeRegistry();
    expect(reg.setActive('ops').name).toBe('Ops (neutral)');
    expect(reg.active().id).toBe('ops');
  });
  it('accepts a user-authored theme and selects it', () => {
    const mine: Theme = { id: 'noir', name: 'Noir', shipName: 'Starfish', org: 'Ops', admiral: 'Boss',
      agents: { michael: 'Chief' }, labels: { task: 'Job' }, palette: { bg: '#000' } };
    const reg = new ThemeRegistry();
    reg.register(mine);
    const active = reg.setActive('noir');
    expect(displayName(active, 'michael')).toBe('Chief');
    expect(label(active, 'task')).toBe('Job');
  });
  it('rejects unknown theme ids (fail-closed)', () => {
    const reg = new ThemeRegistry();
    expect(() => reg.get('nope')).toThrow();
    expect(() => reg.setActive('nope')).toThrow();
  });
  it('every shipped theme is free of trademarked tokens', () => {
    for (const t of [FLEET, OPS]) {
      const blob = JSON.stringify(t);
      for (const tok of TREK) expect(blob.includes(tok)).toBe(false);
    }
  });
});
