// F-3 / F-4 / F-5 / F-6 — hardening of the Claude Code hook seam after the adversarial review.
// Each test reproduces the original defect so a regression is loud.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGovernor, type BoundarySet } from '@starfish/governance-core';
import { HookSession, ccToGoverned } from './handler';

function env(policies: unknown[] = []): { gov: ReturnType<typeof loadGovernor>; proj: string; backupDir: string; auditPath: string } {
  const d = mkdtempSync(join(tmpdir(), 'sf-wp-'));
  const g = join(d, 'governance'); mkdirSync(g, { recursive: true });
  const proj = join(d, 'proj'); mkdirSync(proj, { recursive: true });
  const backupDir = join(d, '.starfish', 'backups'); mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(g, 'policies.json'), JSON.stringify(policies));
  const auditPath = join(d, 'audit.jsonl');
  return { gov: loadGovernor(g, auditPath), proj, backupDir, auditPath };
}
const BS = (proj: string): BoundarySet => ({ visibility: [proj], write: [proj] });

describe('F-3 — writes=auto must not override an explicit operator ask policy', () => {
  it('an operator ask rule survives writes=auto (was: silently auto-allowed)', () => {
    const { gov, proj, backupDir } = env([
      { id: 'review', subject: 'agent:worker', action: 'tool:fs.write', resource: '*', effect: 'ask' },
    ]);
    const victim = join(proj, 'important.txt');
    writeFileSync(victim, 'ORIGINAL');
    const s = new HookSession(gov, { expectedAgentId: 'worker', boundary: BS(proj), writeProfile: 'auto', projectRoot: proj, backupDir });
    const r = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: victim, content: 'PWNED' } });
    expect(r.permissionDecision).toBe('ask');
    expect(r.reason).toMatch(/human review/i);
  });

  it('a ROUTINE risk escalation is still relaxed by writes=auto (the feature still works)', () => {
    const { gov, proj, backupDir } = env();
    const victim = join(proj, 'notes.txt');
    writeFileSync(victim, 'ORIGINAL');
    const s = new HookSession(gov, { expectedAgentId: 'worker', boundary: BS(proj), writeProfile: 'auto', projectRoot: proj, backupDir });
    const r = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: victim, content: 'new' } });
    expect(r.permissionDecision).toBe('allow');
    expect(r.reason).toMatch(/backed up/i);
  });
});

describe('F-4 — a FAILED pre-image backup must not buy an auto-allow', () => {
  it('an unwritable backup dir escalates instead of overwriting (was: allowed, logged "new file")', () => {
    const { gov, proj, auditPath } = env();
    const victim = join(proj, 'important.txt');
    writeFileSync(victim, 'ORIGINAL');
    // Make the backup destination unusable in a way that fails identically on POSIX and Windows:
    // point backupDir at an existing FILE, so mkdirSync() inside the snapshot throws ENOTDIR/EEXIST.
    // (chmod 0o500 would be a no-op on Windows and silently weaken this test there.)
    const badBase = mkdtempSync(join(tmpdir(), 'sf-ro-'));
    const roBackup = join(badBase, 'backups');
    writeFileSync(roBackup, 'not a directory');
    const s = new HookSession(gov, { expectedAgentId: 'worker', boundary: BS(proj), writeProfile: 'auto', projectRoot: proj, backupDir: roBackup });
    const r = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: victim, content: 'PWNED' } });
    expect(r.permissionDecision).toBe('ask');
    expect(r.reason).toMatch(/backup failed|unrecoverable/i);
    // and the audit must SAY the backup failed — not "new file"
    const log = readFileSync(auditPath, 'utf8');
    expect(log).toMatch(/backup FAILED/i);
    expect(log).not.toMatch(/new file/i);
  });

  it('a genuinely new file is labelled "new file", distinctly from a failure', () => {
    const { gov, proj, backupDir, auditPath } = env();
    const s = new HookSession(gov, { expectedAgentId: 'worker', boundary: BS(proj), writeProfile: 'auto', projectRoot: proj, backupDir });
    const r = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(proj, 'brand-new.txt'), content: 'x' } });
    expect(r.permissionDecision).toBe('allow');
    expect(readFileSync(auditPath, 'utf8')).toMatch(/nothing to back up/i);
  });
});

describe('F-5 — a Glob/Grep pattern is governed, not silently replaced with "."', () => {
  it('an absolute glob root is carried into the governed call', () => {
    expect(ccToGoverned('Glob', { pattern: '/etc/**' }).input.path).toBe('/etc/');
    expect(ccToGoverned('Grep', { pattern: '/var/log/*.log' }).input.path).toBe('/var/log/');
  });
  it('an escaping relative pattern is carried too', () => {
    expect(String(ccToGoverned('Glob', { pattern: '../../secrets/**' }).input.path)).toMatch(/\.\./);
  });
  it('an ordinary relative pattern still resolves to the cwd (no behaviour change)', () => {
    expect(ccToGoverned('Glob', { pattern: 'src/**/*.ts' }).input.path).toBe('.');
    expect(ccToGoverned('Grep', { pattern: 'TODO' }).input.path).toBe('.');
  });
  it('END TO END: Glob outside the boundary is DENIED (was: allowed)', () => {
    const { gov, proj } = env();
    const s = new HookSession(gov, { expectedAgentId: 'worker', boundary: BS(proj) });
    const r = s.handle({ hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input: { pattern: '/etc/**' } });
    expect(r.permissionDecision).toBe('deny');
    expect(r.reason).toMatch(/boundary/i);
  });
});

describe('F-6 — write content reaches the PDP so secret screening can see it', () => {
  it('content is carried through the translation', () => {
    expect(ccToGoverned('Write', { file_path: 'a.txt', content: 'SECRET' }).input.content).toBe('SECRET');
    expect(ccToGoverned('Edit', { file_path: 'a.txt', new_string: 'REPLACED' }).input.content).toBe('REPLACED');
  });
  it('a write with no content is unchanged (no undefined key injected)', () => {
    expect('content' in ccToGoverned('Write', { file_path: 'a.txt' }).input).toBe(false);
  });
});
