// H4 — elevated-launch handling (HARDENING_BACKLOG.md). The enforceable half: a pure classifier that
// fails TOWARD elevated, the signal injected into EnforcementPosture (core never probes the OS), an
// audited finding at boot, and a regression check that system-tree denials still hold with it set.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLaunchPrivilege, type PrivilegeReading } from './privilege';
import { loadGovernor } from './boot';
import type { BoundarySet } from './types';

// Trimmed `whoami /groups /fo csv /nh` output: the mandatory label row is what decides it.
const WHOAMI_MEDIUM = [
  '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"',
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"',
  '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""',
].join('\r\n');
const WHOAMI_HIGH = [
  '"Everyone","Well-known group","S-1-1-0","Mandatory group, Enabled by default, Enabled group"',
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Mandatory group, Enabled by default, Enabled group, Group owner"',
  '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""',
].join('\r\n');

describe('H4 — the classifier fails toward elevated', () => {
  it('Windows: high integrity is elevated, medium is standard', () => {
    expect(classifyLaunchPrivilege({ platform: 'win32', windowsGroups: { ok: true, stdout: WHOAMI_HIGH } }).state).toBe('elevated');
    const std = classifyLaunchPrivilege({ platform: 'win32', windowsGroups: { ok: true, stdout: WHOAMI_MEDIUM } });
    expect(std.state).toBe('standard');
    expect(std.treatAsElevated).toBe(false);
  });

  it('Windows: an admin who did not elevate is standard (deny-only Administrators group, medium label)', () => {
    expect(classifyLaunchPrivilege({ platform: 'win32', windowsGroups: { ok: true, stdout: WHOAMI_MEDIUM } }).state).toBe('standard');
  });

  it('Windows: a probe that failed is unknown and treated as elevated (was: "not elevated")', () => {
    const r = classifyLaunchPrivilege({ platform: 'win32', windowsGroups: { ok: false, error: 'spawn whoami ENOENT' } });
    expect(r.state).toBe('unknown');
    expect(r.treatAsElevated).toBe(true);
    expect(r.reason).toMatch(/ENOENT/);
  });

  it('Windows: no probe, or output with no integrity label, is unknown', () => {
    expect(classifyLaunchPrivilege({ platform: 'win32' }).state).toBe('unknown');
    expect(classifyLaunchPrivilege({ platform: 'win32', windowsGroups: { ok: true, stdout: '' } }).state).toBe('unknown');
  });

  it('POSIX: uid 0 is elevated, any other uid is standard, no uid is unknown', () => {
    expect(classifyLaunchPrivilege({ platform: 'linux', uid: 0 }).state).toBe('elevated');
    expect(classifyLaunchPrivilege({ platform: 'darwin', uid: 501 }).state).toBe('standard');
    expect(classifyLaunchPrivilege({ platform: 'linux' }).state).toBe('unknown');
    expect(classifyLaunchPrivilege({ platform: 'linux', uid: Number.NaN }).state).toBe('unknown');
  });

  it('only positive evidence of a standard account turns the signal off', () => {
    const cases = [
      { platform: 'win32', windowsGroups: { ok: true as const, stdout: WHOAMI_HIGH } },
      { platform: 'win32', windowsGroups: { ok: true as const, stdout: WHOAMI_MEDIUM } },
      { platform: 'win32', windowsGroups: { ok: false as const, error: 'timeout' } },
      { platform: 'win32' },
      { platform: 'linux', uid: 0 },
      { platform: 'linux', uid: 1000 },
      { platform: 'freebsd' },
    ];
    for (const c of cases) {
      const r = classifyLaunchPrivilege(c);
      expect(r.treatAsElevated).toBe(r.state !== 'standard');
    }
  });
});

function governedRoot(): { dir: string; auditPath: string; outside: string } {
  const d = mkdtempSync(join(tmpdir(), 'sf-priv-'));
  const g = join(d, 'governance'); mkdirSync(g, { recursive: true });
  writeFileSync(join(g, 'tools.json'), JSON.stringify([
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: '*' },
    { id: 'shell', category: 'exec', pathParams: [], allowedAgents: '*' },
  ]));
  writeFileSync(join(g, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  writeFileSync(join(g, 'policies.json'), JSON.stringify([]));
  return { dir: g, auditPath: join(d, 'audit.jsonl'), outside: mkdtempSync(join(tmpdir(), 'sf-priv-outside-')) };
}

const ELEVATED: PrivilegeReading = { state: 'elevated', treatAsElevated: true, reason: 'effective uid is 0 (root)' };
const UNKNOWN: PrivilegeReading = { state: 'unknown', treatAsElevated: true, reason: 'could not read the process token (timeout)' };
const STANDARD: PrivilegeReading = { state: 'standard', treatAsElevated: false, reason: 'effective uid is 1000' };

describe('H4 — the signal reaches the posture and the audit', () => {
  it('no probe is stated as "not-checked", never assumed standard', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath);
    expect(g.posture.launchPrivilege).toBe('not-checked');
    expect(g.audit.recent(20).some((e) => e.action === 'elevated-launch')).toBe(false);
  });

  it('an elevated launch is in the posture and audited as a high-risk finding', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath, { launchPrivilege: ELEVATED });
    expect(g.posture.launchPrivilege).toBe('elevated');
    const line = g.audit.recent(20).find((e) => e.action === 'elevated-launch');
    expect(line?.riskTier).toBe('high');
    expect(line?.reason).toMatch(/admin\/root/);
    const posture = g.audit.recent(20).find((e) => e.action === 'enforcement-posture');
    expect((posture?.detail as { launchPrivilege?: string }).launchPrivilege).toBe('elevated');
  });

  it('an uncheckable launch is audited too, and says why', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath, { launchPrivilege: UNKNOWN });
    expect(g.posture.launchPrivilege).toBe('unknown');
    expect(g.audit.recent(20).find((e) => e.action === 'elevated-launch')?.reason).toMatch(/could not confirm/);
  });

  it('a standard launch writes no finding', () => {
    const { dir, auditPath } = governedRoot();
    const g = loadGovernor(dir, auditPath, { launchPrivilege: STANDARD });
    expect(g.posture.launchPrivilege).toBe('standard');
    expect(g.audit.recent(20).some((e) => e.action === 'elevated-launch')).toBe(false);
  });
});

describe('H4 — elevation relaxes nothing', () => {
  for (const reading of [ELEVATED, UNKNOWN, STANDARD]) {
    it(`with launchPrivilege=${reading.state}, writes outside the boundary and catastrophic shell are still denied`, () => {
      const { dir, auditPath, outside } = governedRoot();
      const g = loadGovernor(dir, auditPath, { launchPrivilege: reading });
      const bs: BoundarySet = { visibility: [dir], write: [dir] };
      const sys = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
      for (const path of [sys, join(outside, 'x.txt')]) {
        const d = g.pdp.decide('ingress', { agentId: 'worker', tool: 'fs.write', input: { path, content: 'x' } }, bs);
        expect(d.allow).toBe(false);
        expect(d.ask).toBeFalsy();
      }
      const sh = g.pdp.decide('ingress', { agentId: 'worker', tool: 'shell', input: { command: 'rm -rf /' } }, bs);
      expect(sh.allow).toBe(false);
      expect(sh.ask).toBeFalsy();
    });
  }
});
