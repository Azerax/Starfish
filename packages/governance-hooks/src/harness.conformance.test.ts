import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, type BoundarySet } from '@starfish/governance-core';
import { handleHook, type HookContext } from './handler';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'sf-h-'));
  const gov = join(base, 'gov'); mkdirSync(gov);
  const project = join(base, 'project'); const ws = join(project, 'ws'); mkdirSync(ws, { recursive: true });
  writeFileSync(join(project, 'doc.txt'), 'hello');
  writeFileSync(join(gov, 'tools.json'), JSON.stringify([
    { id: 'read_file', category: 'read', pathParams: ['path'], allowedAgents: ['agent.deckcrew'] },
    { id: 'write_file', category: 'write', pathParams: ['path'], allowedAgents: ['agent.deckcrew'] },
  ]));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify([{ id: 'agent.deckcrew', domain: 'execution' }]));
  const governor = loadGovernor(gov, join(base, 'audit.jsonl'));
  const bs: BoundarySet = { visibility: [project], write: [ws] };
  return { base, project, ws, governor, bs, auditPath: join(base, 'audit.jsonl') };
}
const ctx = (id: string, bs: BoundarySet): HookContext => ({ expectedAgentId: id, boundary: bs });

describe('Phase 1 — one governed Deck Crew officer, end-to-end through the hook seam', () => {
  it('SC: a permitted Read inside the project is ALLOWED and audited', () => {
    const e = setup();
    const res = handleHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } }, e.governor, ctx('agent.deckcrew', e.bs));
    expect(res.permissionDecision).toBe('allow');
    const audit = readFileSync(e.auditPath, 'utf8');
    expect(audit).toContain('read_file'); expect(audit).toContain('allow');
  });
  it('TC-1.1: an unregistered tool is DENIED', () => {
    const e = setup();
    expect(handleHook({ hook_event_name: 'PreToolUse', tool_name: 'rm_rf', tool_input: {} }, e.governor, ctx('agent.deckcrew', e.bs)).permissionDecision).toBe('deny');
  });
  it('TC-1.2: an agent not in allowedAgents is DENIED', () => {
    const e = setup();
    expect(handleHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } }, e.governor, ctx('agent.intruder', e.bs)).permissionDecision).toBe('deny');
  });
  it('TC-1.3 (via hook): a Write escaping the workspace is DENIED and creates nothing', () => {
    const e = setup();
    const res = handleHook({ hook_event_name: 'PreToolUse', tool_name: 'write_file', tool_input: { path: join(e.ws, '..', '..', 'escape.txt') } }, e.governor, ctx('agent.deckcrew', e.bs));
    expect(res.permissionDecision).toBe('deny');
    expect(existsSync(join(e.base, 'escape.txt'))).toBe(false);
  });
  it('TC-1.8: a payload claiming another agent_id is DENIED (impersonation blocked)', () => {
    const e = setup();
    expect(handleHook({ hook_event_name: 'PreToolUse', agent_id: 'agent.someoneelse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } }, e.governor, ctx('agent.deckcrew', e.bs)).permissionDecision).toBe('deny');
  });
  it('NFR-1: 1000 gate decisions, p95 < 50ms', () => {
    const e = setup(); const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t = performance.now();
      handleHook({ hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { path: join(e.project, 'doc.txt') } }, e.governor, ctx('agent.deckcrew', e.bs));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);
  });
});
