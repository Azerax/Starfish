import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundaryForSkill, skillWorkspaceLayout, containCheck } from './index';

let root: string, gov: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-skills-'));
  gov = join(root, '_governance'); mkdirSync(gov, { recursive: true }); writeFileSync(join(gov, 'tools.json'), '[]');
  for (const id of ['a', 'b']) {
    const { source, workspace } = skillWorkspaceLayout(root, id);
    mkdirSync(source, { recursive: true }); mkdirSync(workspace, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'x');
  }
});

describe('per-skill workspace confinement', () => {
  it('reads its own source and writes its own workspace', () => {
    const b = boundaryForSkill({ skillsRoot: root, skillId: 'a', forbid: [gov] });
    const { source, workspace } = skillWorkspaceLayout(root, 'a');
    expect(containCheck(join(source, 'SKILL.md'), 'read', b).allowed).toBe(true);
    expect(containCheck(join(workspace, 'out.txt'), 'write', b).allowed).toBe(true);
  });
  it('cannot write its own source (read-only)', () => {
    const b = boundaryForSkill({ skillsRoot: root, skillId: 'a' });
    expect(containCheck(join(skillWorkspaceLayout(root, 'a').source, 'SKILL.md'), 'write', b).allowed).toBe(false);
  });
  it('skill A cannot read or write skill B workspace', () => {
    const b = boundaryForSkill({ skillsRoot: root, skillId: 'a' });
    const bws = skillWorkspaceLayout(root, 'b').workspace;
    expect(containCheck(join(bws, 'x'), 'read', b).allowed).toBe(false);
    expect(containCheck(join(bws, 'x'), 'write', b).allowed).toBe(false);
  });
  it('cannot touch the governance dir', () => {
    const b = boundaryForSkill({ skillsRoot: root, skillId: 'a', forbid: [gov] });
    expect(containCheck(join(gov, 'tools.json'), 'read', b).allowed).toBe(false);
    expect(containCheck(join(gov, 'tools.json'), 'write', b).allowed).toBe(false);
  });
});
