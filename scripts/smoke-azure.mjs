// Runs every azure/**/*.smoketest.mjs and reports a single pass/fail.
//
// The Azure surface has no vitest coverage — vitest.config.ts scopes to `packages/**/*.test.ts`, so
// these five smoketests were sitting in the tree with nothing ever executing them. They are plain
// node scripts that exit non-zero on failure, so a runner is all that was missing.
//
// Deliberately serial and quiet on success: this runs inside `npm run ci`, where the useful signal is
// "all green" or the exact output of the one that broke.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const azure = join(root, 'azure');

function findSmoketests(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...findSmoketests(full));
    else if (e.endsWith('.smoketest.mjs')) out.push(full);
  }
  return out;
}

const tests = findSmoketests(azure).sort();
if (tests.length === 0) {
  console.log('smoke:azure — no smoketests found under azure/ (nothing to run).');
  process.exit(0);
}

let failed = 0;
for (let i = 0; i < tests.length; i++) {
  const rel = relative(root, tests[i]).replace(/\\/g, '/');
  process.stdout.write(`  [${i + 1}/${tests.length}] ${rel} ... `);
  try {
    execFileSync(process.execPath, [tests[i]], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    console.log('ok');
  } catch (e) {
    failed++;
    console.log('FAILED');
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    console.log(out.split('\n').map((l) => '      ' + l).join('\n').slice(0, 4000));
  }
}

if (failed > 0) {
  console.error(`\nsmoke:azure FAILED — ${failed} of ${tests.length} smoketest(s) broke.`);
  process.exit(1);
}
console.log(`smoke:azure PASSED — ${tests.length} smoketest(s) green.`);
