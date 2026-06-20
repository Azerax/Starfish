import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedInstall, isInitialized, GOVERNANCE_SEED } from './seed';
import { loadGovernor } from '@starfish/governance-core';

const tmp = () => mkdtempSync(join(tmpdir(), 'sf-seed-'));

describe('seedInstall — single source of truth for governance + base-root scaffold', () => {
  it('writes governance, the scaffold tree, config and the init lock', () => {
    const dir = tmp();
    const r = seedInstall(dir, { operator: 'Scott', theme: 'fleet', by: 'cli' });
    expect(r.ok).toBe(true);
    for (const p of ['governance/tools.json', 'governance/agents.json', 'governance/policies.json',
                     'audit.jsonl', 'starfish.config.json', '.starfish-init.lock',
                     'skills', 'shared/PROTOCOL.md', 'shared/tasks.json',
                     'tools/git_commit/tool.json', 'agents/worker/workspace', 'agents/worker/agent.json'])
      expect(existsSync(join(dir, p)), p).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'starfish.config.json'), 'utf8')).baseRoot).toBe(dir);
    expect(JSON.parse(readFileSync(join(dir, '.starfish-init.lock'), 'utf8')).by).toBe('cli');
  });

  it('refuses a second init (one per install) unless forced', () => {
    const dir = tmp();
    expect(seedInstall(dir).ok).toBe(true);
    expect(isInitialized(dir)).toBe(true);
    const again = seedInstall(dir, { by: 'ui' });
    expect(again.ok).toBe(false);
    expect(again.alreadyInitialized).toBe(true);
    expect(seedInstall(dir, { force: true }).ok).toBe(true);   // --force re-seeds
  });

  it('EVERY policy uses the PDP format (subject agent:/* , action tool:) — guards the format regression', () => {
    for (const p of GOVERNANCE_SEED.policies) {
      expect(p.subject === '*' || p.subject.startsWith('agent:'), `subject ${p.subject}`).toBe(true);
      expect(p.action.startsWith('tool:'), `action ${p.action}`).toBe(true);
    }
  });

  it('the seeded install boots cleanly through loadGovernor (round-trip)', () => {
    const dir = tmp();
    seedInstall(dir);
    const g = loadGovernor(join(dir, 'governance'), join(dir, 'audit.jsonl'), { stateDir: join(dir, 'state') });
    expect(g.agents.all().length).toBe(GOVERNANCE_SEED.agents.length);
    expect(g.tools.all().length).toBe(GOVERNANCE_SEED.tools.length);
    expect(g.safeMode).toBe(false);
  });
});
