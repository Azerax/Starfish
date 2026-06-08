// Command-template tools — the ONLY shell surface (R&C S-2/S-8; threat model T-05/T-06).
// No raw Bash. Templates run a fixed binary via execFile (no shell), with a typed argv
// allowlist, scrubbed env, and neutralized config/hooks so repo hooks / package scripts
// cannot execute.
import { execFileSync } from 'node:child_process';

const META = /[;&|`$<>(){}\n\r]/;

export interface TemplateDef { id: string; bin: string; build: (p: Record<string, string>) => string[]; }

export const TEMPLATES: Record<string, TemplateDef> = {
  // git with repo hooks disabled (core.hooksPath=/dev/null) + --no-verify; global/system config neutralized via env.
  git_commit: { id: 'git_commit', bin: 'git', build: (p) => ['-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-m', p.message] },
  // tests run the runner binary directly — never `npm test` — so package.json scripts are not an entry point.
  node_test: { id: 'node_test', bin: 'node', build: () => ['--test'] },
};

export function validateParams(params: Record<string, unknown>): { ok: boolean; reason: string } {
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== 'string') continue;
    if (META.test(v)) return { ok: false, reason: `metacharacter in '${k}'` };
    if (v.startsWith('-')) return { ok: false, reason: `option-injection in '${k}'` };
  }
  return { ok: true, reason: 'ok' };
}

function scrubEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
}

export function runTemplate(id: string, params: Record<string, string>, cwd: string): { code: number; out: string } {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`unknown template: ${id}`);
  const v = validateParams(params);
  if (!v.ok) throw new Error(`argv-rejected: ${v.reason}`);
  try {
    const out = execFileSync(t.bin, t.build(params), { cwd, env: scrubEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: String(err.stdout ?? '') + String(err.stderr ?? '') };
  }
}
