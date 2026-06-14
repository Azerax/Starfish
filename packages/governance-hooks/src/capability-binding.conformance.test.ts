import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, vet, readSkillFiles, boundaryForSkill, skillWorkspaceLayout } from '@starfish/governance-core';
import { HookSession } from './index';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-cap-'));
  const govDir = join(root, 'governance'); mkdirSync(govDir, { recursive: true });
  writeFileSync(join(govDir, 'tools.json'), JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' }]));
  writeFileSync(join(govDir, 'agents.json'), JSON.stringify([{ id: 'agent.a' }]));
  const { source } = skillWorkspaceLayout(root, 'demo'); mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'SKILL.md'), 'safe');
  const gov = loadGovernor(govDir, join(root, 'audit.jsonl'), { skillsRoot: root });
  gov.capabilities.intake(vet({ id: 'demo', kind: 'skill', files: readSkillFiles(source), provenance: { repo: 'anthropics/skills' } }));
  const session = new HookSession(gov, { expectedAgentId: 'agent.a', boundary: boundaryForSkill({ skillsRoot: root, skillId: 'demo' }), capabilityId: 'demo' });
  return { root, source, session };
}

describe('capabilityId binding (confused-deputy + verify-before-invoke)', () => {
  it('allows a clean invocation of the bound skill', () => {
    const { source, session } = setup();
    expect(session.handle({ hook_event_name: 'PreToolUse', tool_name: 'fs.read', tool_input: { path: join(source, 'SKILL.md') } }).permissionDecision).toBe('allow');
  });
  it('rejects a payload claiming a different capability_id (cannot spoof the bound identity)', () => {
    const { source, session } = setup();
    const r = session.handle({ hook_event_name: 'PreToolUse', tool_name: 'fs.read', tool_input: { path: join(source, 'SKILL.md') }, capability_id: 'other' });
    expect(r.permissionDecision).toBe('deny');
    expect(r.reason).toContain('capability-id mismatch');
  });
  it('denies after the bound skill is tampered (integrity via stamped capabilityId)', () => {
    const { source, session } = setup();
    writeFileSync(join(source, 'SKILL.md'), 'tampered!');
    const r = session.handle({ hook_event_name: 'PreToolUse', tool_name: 'fs.read', tool_input: { path: join(source, 'SKILL.md') } });
    expect(r.permissionDecision).toBe('deny');
    expect(r.reason).toContain('integrity');
  });
});
