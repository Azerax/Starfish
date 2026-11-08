// H4 — gathers the OS facts that core's classifyLaunchPrivilege() needs. Core cannot touch the OS, so
// this is the one place that runs a probe; the CLI daemon and the desktop app both call it.
import { execFileSync } from 'node:child_process';
import { classifyLaunchPrivilege, type PrivilegeProbe, type PrivilegeReading } from '@starfish/governance-core';

export interface PrivilegeProbeDeps {
  platform: string;
  geteuid?: () => number;
  /** Runs a fixed command (no shell) and returns stdout; throws on failure. */
  run: (file: string, args: string[]) => string;
}

export function gatherPrivilegeProbe(deps: PrivilegeProbeDeps): PrivilegeProbe {
  if (deps.platform === 'win32') {
    try {
      // The token's mandatory integrity label is what elevation means on Windows. `net session` (the
      // old check) answers a different question and needs the Server service to be running.
      return { platform: deps.platform, windowsGroups: { ok: true, stdout: deps.run('whoami', ['/groups', '/fo', 'csv', '/nh']) } };
    } catch (e) {
      return { platform: deps.platform, windowsGroups: { ok: false, error: (e as Error).message.split('\n')[0].slice(0, 200) } };
    }
  }
  let uid: number | undefined;
  try { uid = deps.geteuid?.(); } catch { uid = undefined; }
  return { platform: deps.platform, uid };
}

/** The real probe for this process. */
export function detectLaunchPrivilege(): PrivilegeReading & { user: string; platform: string } {
  const probe = gatherPrivilegeProbe({
    platform: process.platform,
    geteuid: typeof process.geteuid === 'function' ? () => process.geteuid!() : (typeof process.getuid === 'function' ? () => process.getuid!() : undefined),
    run: (file, args) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }),
  });
  return { ...classifyLaunchPrivilege(probe), user: process.env.USERNAME || process.env.USER || 'unknown', platform: process.platform };
}
