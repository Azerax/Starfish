import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor } from '@starfish/governance-core';
import { HookSession } from './handler';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-wp-')); const g = join(root, 'governance');
  mkdirSync(g, { recursive: true }); mkdirSync(join(root, 'state'), { recursive: true }); mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'original');
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker'], riskTier: 'medium' },
    { id: 'shell', category: 'exec', pathParams: [], allowedAgents: ['worker'], riskTier: 'high' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker', domain: 'execution', allowedTools: ['fs.read', 'fs.write', 'shell'], riskTier: 'high' }]));
  writeFileSync(join(g, 'policies.json'), JSON.stringify([
    { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' },
    { id: 'p-shell', subject: 'agent:worker', action: 'tool:shell', resource: '*', effect: 'ask' },
  ]));
  const gov = loadGovernor(g, join(root, 'audit.jsonl'), { stateDir: join(root, 'state') });
  const boundary = { visibility: [root], write: [root], deny: [join(root, '.starfish')] };
  return { root, gov, boundary, backupDir: join(root, '.starfish', 'backups') };
}
const pre = (sess: HookSession, tool: string, input: Record<string, unknown>) => sess.handle({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });

describe('write profile: user owns in-boundary risk; system-risk floor is fixed', () => {
  it('writes=ask (default): in-boundary Write -> ask', () => {
    const e = setup();
    const s = new HookSession(e.gov, { expectedAgentId: 'worker', boundary: e.boundary, writeProfile: 'ask', projectRoot: e.root, backupDir: e.backupDir });
    expect(pre(s, 'Write', { file_path: join(e.root, 'src', 'a.ts') }).permissionDecision).toBe('ask');
  });
  it('writes=auto: in-boundary Write -> allow AND a pre-image backup is made', () => {
    const e = setup();
    const s = new HookSession(e.gov, { expectedAgentId: 'worker', boundary: e.boundary, writeProfile: 'auto', projectRoot: e.root, backupDir: e.backupDir, backups: 3 });
    expect(pre(s, 'Write', { file_path: join(e.root, 'src', 'a.ts') }).permissionDecision).toBe('allow');
    expect(existsSync(e.backupDir)).toBe(true);
    const dir = join(e.backupDir, readdirSync(e.backupDir)[0]);
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(1);   // a version was snapshotted
  });
  it('writes=auto NEVER relaxes the system-risk floor', () => {
    const e = setup();
    const s = new HookSession(e.gov, { expectedAgentId: 'worker', boundary: e.boundary, writeProfile: 'auto', projectRoot: e.root, backupDir: e.backupDir });
    expect(pre(s, 'Write', { file_path: '/etc/evil' }).permissionDecision).toBe('deny');                               // out of boundary
    expect(pre(s, 'Write', { file_path: join(e.root, '.starfish', 'governance', 'policies.json') }).permissionDecision).toBe('deny'); // governance subtree
    expect(pre(s, 'Bash', { command: 'echo hi' }).permissionDecision).toBe('ask');                                     // shell still gated
  });
});
