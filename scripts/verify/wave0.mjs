// One-command Wave 0 gate. Runs the checks in order and prints a pass/fail summary.
// Usage: node scripts/verify/wave0.mjs   (run from repo root, after `npm install`)
import { spawnSync } from 'node:child_process';
const steps = [
  ['typecheck (tsc)', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['dep-direction lint', 'node', ['scripts/dep-direction-lint.mjs']],
  ['unit + conformance tests', 'npx', ['vitest', 'run']],
  ['CLI bundle (esbuild)', 'node', ['scripts/bundle-cli.mjs']],
];
const results = [];
for (const [name, cmd, args] of steps) {
  process.stdout.write(`\n==> ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push([name, r.status === 0]);
}
console.log('\n================ Wave 0 verify summary ================');
let ok = true;
for (const [name, pass] of results) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`); ok = ok && pass; }
console.log('======================================================');
process.exit(ok ? 0 : 1);
