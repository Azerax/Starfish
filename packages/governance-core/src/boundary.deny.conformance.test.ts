import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containCheck } from './index';

describe('containCheck — deny subtree (write project EXCEPT governance)', () => {
  const proj = mkdtempSync(join(tmpdir(), 'sf-deny-'));
  const dot = join(proj, '.starfish');
  mkdirSync(join(dot, 'governance'), { recursive: true });
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src', 'app.ts'), 'x');
  writeFileSync(join(dot, 'governance', 'policies.json'), '[]');
  const bs = { visibility: [proj], write: [proj], deny: [dot] };

  it('allows writing project code', () => { expect(containCheck(join(proj,'src','app.ts'),'write',bs).allowed).toBe(true); });
  it('DENIES writing into governance subtree under the project', () => { const r=containCheck(join(dot,'governance','policies.json'),'write',bs); expect(r.allowed).toBe(false); expect(r.reason).toMatch(/denied subtree/); });
  it('DENIES reading the governance subtree', () => { expect(containCheck(join(dot,'governance','policies.json'),'read',bs).allowed).toBe(false); });
  it('still denies outside the project', () => { expect(containCheck(join(proj,'..','evil.txt'),'write',bs).allowed).toBe(false); });
  it('no deny = backward compatible', () => { expect(containCheck(join(proj,'src','app.ts'),'write',{visibility:[proj],write:[proj]}).allowed).toBe(true); });
});

describe('F4 — boundaryForAgent / boundaryForSkill carry forbid through as a deny subtree', () => {
  it('governance/audit/state under an allowed root are denied by construction', async () => {
    const { boundaryForAgent, boundaryForSkill, containCheck } = await import('./index');
    const proj = mkdtempSync(join(tmpdir(), 'sf-f4-'));
    mkdirSync(join(proj, '.starfish', 'governance'), { recursive: true });
    writeFileSync(join(proj, '.starfish', 'governance', 'policies.json'), '[]');
    writeFileSync(join(proj, 'audit.jsonl'), '');
    const forbid = [join(proj, '.starfish'), join(proj, 'audit.jsonl')];

    const bs = boundaryForAgent({ projectRoot: proj, workspace: proj, agentDir: join(proj, 'agent'), forbid });
    expect(bs.deny).toBeDefined();
    // projectRoot is readable, but governance + audit under it are NOT.
    expect(containCheck(join(proj, 'notes.md'), 'read', bs).allowed).toBe(true);
    expect(containCheck(join(proj, '.starfish', 'governance', 'policies.json'), 'read', bs).allowed).toBe(false);
    expect(containCheck(join(proj, 'audit.jsonl'), 'read', bs).allowed).toBe(false);

    const sk = boundaryForSkill({ skillsRoot: join(proj, 'skills'), skillId: 's1', sharedReads: [proj], forbid });
    expect(sk.deny).toBeDefined();
    expect(containCheck(join(proj, '.starfish', 'governance', 'policies.json'), 'read', sk).allowed).toBe(false);
  });
});
