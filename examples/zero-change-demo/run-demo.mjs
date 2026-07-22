// Governance-integration demo: provision Starfish into a fresh repo, run the sidecar, then run THREE
// host skills against it so the difference between advisory and enforcing is visible rather than
// described:
//
//   1. cooperative  — no Starfish import, gates itself over HTTP, honours the verdict.        (advisory)
//   2. rogue        — same code, ignores the verdict, writes anyway.                          (advisory, disobeyed)
//   3. enforced     — no fs handle at all; Starfish performs the write and re-checks bounds.  (enforcing)
//
// Case 2 is the honest one. A demo that only shows case 1 lets a reader conclude the sidecar stops
// things it cannot stop.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT_REPO = join(here, '..', '..');
const CLI = join(ROOT_REPO, 'packages', 'cli', 'dist', 'cli.mjs');
if (!existsSync(CLI)) { console.error('Build the CLI first:  npm run build:cli'); process.exit(1); }

const run = (cmd, args, env) => new Promise((res) => {
  spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }).on('exit', (c) => res(c ?? 0));
});

const proj = mkdtempSync(join(tmpdir(), 'sf-zerochange-'));
console.log('\n== 1. Provision governance into the repo (install-from-Starfish) ==');
spawnSync('node', [CLI, 'embed', 'init', '--dir', proj], { stdio: 'inherit' });
const root = join(proj, '.starfish');
const port = 8900 + Math.floor(Math.random() * 90);
const URL = 'http://127.0.0.1:' + port;

console.log('\n== 2. Run governance (starfish serve) ==');
const srv = spawn('node', [CLI, 'serve', '--root', root, '--port', String(port)], { stdio: 'inherit' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(URL + '/v1/health')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
const toks = JSON.parse(readFileSync(join(root, 'sidecar-tokens.json'), 'utf8'));
const env = { SF_URL: URL, SF_TOKEN: toks.worker, SF_ROOT: proj };

// An operator that approves whatever gets parked, so the cooperative/enforced paths complete.
const H = { 'x-starfish-wire': '1', authorization: 'Bearer ' + toks.operator };
const seen = new Set();
const op = setInterval(async () => {
  try {
    const pend = await (await fetch(URL + '/v1/pending', { headers: H })).json();
    for (const p of Array.isArray(pend) ? pend : []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      console.log('[operator] approving ' + p.tool + ' ' + (p.target ?? ''));
      await fetch(URL + '/v1/decisions/' + p.id, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }) });
    }
  } catch { /* keep polling */ }
}, 150);

console.log('\n== 3. COOPERATIVE skill — no Starfish import, honours the verdict (ADVISORY) ==');
await run('node', [join(here, 'host-skill.mjs')], env);

console.log('\n== 4. ROGUE skill — same code, ignores the verdict (ADVISORY, DISOBEYED) ==');
console.log('    This is the limit of the sidecar, shown rather than footnoted.');
await run('node', [join(here, 'rogue-skill.mjs')], env);

console.log('\n== 5. ENFORCED skill — no fs handle; Starfish performs the write (ENFORCING) ==');
const bundled = join(mkdtempSync(join(tmpdir(), 'sf-enforced-')), 'enforced.mjs');
await build({
  entryPoints: [join(here, 'host-skill-enforced.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: bundled, absWorkingDir: ROOT_REPO, logLevel: 'warning',
});
await run('node', [bundled], env);

clearInterval(op);
console.log('\n== 6. Result ==');
const wrote = (f) => existsSync(join(proj, f));
console.log('  notes.md          (cooperative, approved) : ' + wrote('notes.md'));
console.log('  rogue.md          (rogue, DENIED)         : ' + wrote('rogue.md') + '   <-- written anyway');
console.log('  notes-enforced.md (enforced, approved)    : ' + wrote('notes-enforced.md'));
console.log('\nWhat this shows:');
console.log('  - The sidecar DECIDES. It does not execute, so it cannot stop a host that disobeys.');
console.log('  - rogue.md exists despite a deny. That is architecture, not a bug — and it is why');
console.log('    "the sidecar gates every tool action" would be an overclaim.');
console.log('  - The enforced path removes the handle from the skill: Starfish does the IO and');
console.log('    re-checks the boundary at execution time.');
console.log('  - For a seam the agent cannot skip at all, use the Claude Code overlay with --managed.');
console.log('\nEvery decision above — including the one the rogue skill ignored — is in the');
console.log('hash-chained audit at ' + join(root, 'audit.jsonl'));
srv.kill();
process.exit(0);
