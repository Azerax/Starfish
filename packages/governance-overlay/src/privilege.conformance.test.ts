// H4 — the probe gatherer: whatever goes wrong while probing, core receives a failed probe (which it
// classifies as 'unknown' and treats as elevated), never a silent "standard".
import { describe, it, expect } from 'vitest';
import { classifyLaunchPrivilege } from '@starfish/governance-core';
import { gatherPrivilegeProbe } from './privilege';

describe('H4 — gatherPrivilegeProbe', () => {
  it('Windows: a command that fails becomes a failed probe, classified unknown', () => {
    const probe = gatherPrivilegeProbe({ platform: 'win32', run: () => { throw new Error('spawnSync whoami ETIMEDOUT\nmore'); } });
    expect(probe.windowsGroups).toEqual({ ok: false, error: 'spawnSync whoami ETIMEDOUT' });
    const r = classifyLaunchPrivilege(probe);
    expect(r.state).toBe('unknown');
    expect(r.treatAsElevated).toBe(true);
  });

  it('Windows: runs whoami with a fixed argument list and passes its output through', () => {
    const calls: [string, string[]][] = [];
    const probe = gatherPrivilegeProbe({ platform: 'win32', run: (f, a) => { calls.push([f, a]); return '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""'; } });
    expect(calls).toEqual([['whoami', ['/groups', '/fo', 'csv', '/nh']]]);
    expect(classifyLaunchPrivilege(probe).state).toBe('standard');
  });

  it('POSIX: uses the effective uid, and a throwing getter leaves it unknown', () => {
    const run = (): string => { throw new Error('not used'); };
    expect(classifyLaunchPrivilege(gatherPrivilegeProbe({ platform: 'linux', geteuid: () => 0, run })).state).toBe('elevated');
    expect(classifyLaunchPrivilege(gatherPrivilegeProbe({ platform: 'linux', geteuid: () => 1000, run })).state).toBe('standard');
    expect(classifyLaunchPrivilege(gatherPrivilegeProbe({ platform: 'linux', geteuid: () => { throw new Error('x'); }, run })).state).toBe('unknown');
    expect(classifyLaunchPrivilege(gatherPrivilegeProbe({ platform: 'linux', run })).state).toBe('unknown');
  });
});
