// Confined verifier: copies the repo into an ISOLATED work dir, installs Linux deps there, and runs the
// full gate (typecheck, dep-lint, tests, CLI bundle). All mutation is confined to the work dir, so the
// source tree and the host node_modules are never touched and executing test code cannot escape.
// Usage: node skills/starfish-verify/run.mjs [--src <repo>] [--work <dir>] [--keep]
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = resolve(flag('--src', repoRoot));
const WORK = resolve(flag('--work', join(tmpdir(), 'starfish-verify')));
const KEEP = argv.includes('--keep');

// Confinement guard: never let WORK be the source or live inside it (would recurse / mutate source).
const inside = (child, parent) => (child + '/').startsWith(parent + '/');
if (WORK === SRC || inside(SRC, WORK) || inside(WORK, SRC)) {
  console.error(`refused: work dir (${WORK}) must be OUTSIDE the source (${SRC}) so nothing escapes into the real tree`);
  process.exit(2);
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'out']);
console.log(`[verify] src : ${SRC}`);
console.log(`[verify] work: ${WORK} (isolated; all writes confined here)`);
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
cpSync(SRC, WORK, { recursive: true, filter: (s) => !SKIP.has(s.split(/[\\/]/).pop()) });

const run = (name, cmd, args) => {
  process.stdout.write(`\n==> ${name}\n`);
  const r = spawnSync(cmd, args, { cwd: WORK, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
};

if (!run('install (isolated)', 'npm', ['install', '--no-audit', '--no-fund'])) { console.error('install failed'); process.exit(1); }
const results = [
  ['typecheck', run('typecheck', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])],
  ['dep-direction lint', run('dep-direction lint', 'node', ['scripts/dep-direction-lint.mjs'])],
  ['tests (vitest)', run('tests', 'npx', ['vitest', 'run'])],
  ['CLI bundle', run('CLI bundle', 'node', ['scripts/bundle-cli.mjs'])],
];
if (!KEEP) rmSync(WORK, { recursive: true, force: true });

console.log('\n================ starfish-verify summary ================');
let ok = true;
for (const [n, p] of results) { console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}`); ok = ok && p; }
console.log('========================================================');
process.exit(ok ? 0 : 1);
