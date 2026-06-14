import { describe, it, expect } from 'vitest';
import { FLEET, displayName, label } from './index';
import { WorktreeRunner } from './index';

const TREK = ['LCARS', 'Starfleet', 'U.S.S.', 'NCC-', 'Vulcan', 'Spock', 'Spokk', 'Odo', "O'Brien"];

describe('Phase 9 — Fleet theme-pack (IP-safe, ring-3)', () => {
  it('maps internal agent ids to Fleet display personas', () => {
    expect(displayName(FLEET, 'michael')).toBe('Captain Mykel');
    expect(displayName(FLEET, 'hank')).toBe('Constable Gooey');
    expect(label(FLEET, 'task')).toBe('Mission');
  });
  it('contains no trademarked Trek tokens', () => {
    const blob = JSON.stringify(FLEET);
    for (const t of TREK) expect(blob.includes(t)).toBe(false);
  });
});

describe('Phase 9 — agent runner confinement seam', () => {
  it('scrubs the environment (no secret inheritance) and confines cwd to the worktree', () => {
    process.env.FAKE_SECRET_XYZ = 'leak-me';
    const plan = new WorktreeRunner().plan({ agentId: 'agent.a', command: 'claude', args: [], worktree: '/proj/agents/a/ws' });
    expect(plan.cwd).toBe('/proj/agents/a/ws');
    expect(plan.env.FAKE_SECRET_XYZ).toBeUndefined();   // secret not inherited
    expect(plan.env.STARFISH_AGENT).toBe('agent.a');
    delete process.env.FAKE_SECRET_XYZ;
  });
});
