// H4 — elevated-launch signal (HARDENING_BACKLOG.md). Running as admin/root widens the blast radius of
// everything a governed agent does, so the governor records whether it was launched elevated.
//
// Core never probes the OS itself: no process.getuid(), no child process. The caller gathers the raw
// probe and this pure function classifies it, so the rule is testable and identical on every surface.
//
// The defect this replaces (desktop main `detectPrivilege()`): it ran `net session` and ended in
// `catch { elevated = false }`. A missing net.exe, a PATH change or the timeout all reported "not
// elevated". For a safety signal the unknown case must fail TOWARD elevated, so `treatAsElevated` is
// true for both 'elevated' and 'unknown'. Only positive evidence of a standard account turns it off.

export type LaunchPrivilege = 'elevated' | 'standard' | 'unknown';

export interface PrivilegeProbe {
  platform: string;
  /** POSIX effective uid (process.geteuid ?? process.getuid). Absent when the platform has none. */
  uid?: number;
  /** Windows: the outcome of `whoami /groups /fo csv /nh`. */
  windowsGroups?: { ok: true; stdout: string } | { ok: false; error: string };
}

export interface PrivilegeReading {
  state: LaunchPrivilege;
  /** true for 'elevated' AND 'unknown': a check that could not run is not evidence of safety. */
  treatAsElevated: boolean;
  reason: string;
}

// Windows mandatory integrity levels (S-1-16-<rid>). An elevated token runs at High or System; a
// standard user, or an admin under UAC who did not elevate, runs at Medium (or Low).
const HIGH_INTEGRITY_RID = 12288;

function reading(state: LaunchPrivilege, reason: string): PrivilegeReading {
  return { state, treatAsElevated: state !== 'standard', reason };
}

export function classifyLaunchPrivilege(p: PrivilegeProbe): PrivilegeReading {
  if (p.platform === 'win32') {
    const g = p.windowsGroups;
    if (!g) return reading('unknown', 'no Windows group probe was supplied');
    if (!g.ok) return reading('unknown', `could not read the process token (${g.error})`);
    // Several labels are possible in theory; the highest one present is the token's level.
    const rids = [...g.stdout.matchAll(/S-1-16-(\d+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
    if (rids.length === 0) return reading('unknown', 'no integrity level in the process token');
    const level = Math.max(...rids);
    return level >= HIGH_INTEGRITY_RID
      ? reading('elevated', `process token runs at high integrity (S-1-16-${level})`)
      : reading('standard', `process token runs at medium or low integrity (S-1-16-${level})`);
  }
  if (typeof p.uid === 'number' && Number.isInteger(p.uid) && p.uid >= 0) {
    return p.uid === 0 ? reading('elevated', 'effective uid is 0 (root)') : reading('standard', `effective uid is ${p.uid}`);
  }
  return reading('unknown', `no privilege probe for platform '${p.platform}'`);
}
