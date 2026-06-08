import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, type BoundarySet } from '@starfish/governance-core';
import { HookSession } from './handler';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'sf-cor-'));
  const gov = join(base, 'gov'); mkdirSync(gov);
  const project = join(base, 'project'); const ws = join(project, 'ws'); mkdirSync(ws, { recursive: true });
  writeFileSync(join(project, 'doc.txt'), 'hi');
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([{ id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: ['agent.deckcrew'] }]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'agent.deckcrew' }]));
  const governor = loadGovernor(gov, join(base, 'audit.jsonl'));
  const bs: BoundarySet = { visibility: [project], write: [ws] };
  return { project, governor, auditPath: join(base, 'audit.jsonl'), bs };
}

describe('TC-1.7 — audit-before-act & orphan-PostToolUse flagging', () => {
  it('logs the decision before the action can proceed (no unlogged side effect)', () => {
    const e = setup();
    const s = new HookSession(e.governor, { expectedAgentId: 'agent.deckcrew', boundary: e.bs });
    const res = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } });
    expect(res.permissionDecision).toBe('allow');
    // The decision is already on disk at the moment allow is returned — a crash now leaves a logged, un-acted decision (safe).
    expect(readFileSync(e.auditPath, 'utf8')).toContain('ingress:read_file');
  });
  it('flags a PostToolUse with no preceding allowed PreToolUse', () => {
    const e = setup();
    const s = new HookSession(e.governor, { expectedAgentId: 'agent.deckcrew', boundary: e.bs });
    const res = s.handle({ hook_event_name: 'PostToolUse', tool_name: 'read_file' });
    expect(res.permissionDecision).toBe('deny');
    expect(readFileSync(e.auditPath, 'utf8')).toContain('orphan-post:read_file');
  });
});
