// Zero-change governance demo: provision Starfish into a fresh repo (install-from-Starfish), run the
// sidecar, then run an UNMODIFIED host skill that gates itself over HTTP. An operator approves the
// parked write, the skill proceeds, and the action is audited. No skill code changed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'packages', 'cli', 'dist', 'cli.mjs');
if (!existsSync(CLI)) { console.error('Build the CLI first:  npm run build:cli'); process.exit(1); }

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

console.log('\n== 3. Run the UNMODIFIED host skill (gates over HTTP) ==');
const skill = spawn('node', [join(here, 'host-skill.mjs')], { stdio: 'inherit', env: { ...process.env, SF_URL: URL, SF_TOKEN: toks.worker, SF_ROOT: proj } });

const H = { 'x-starfish-wire': '1', authorization: 'Bearer ' + toks.operator };
let approved = false;
const op = setInterval(async () => {
  try {
    const pend = await (await fetch(URL + '/v1/pending', { headers: H })).json();
    if (Array.isArray(pend) && pend.length && !approved) {
      approved = true;
      console.log('[operator] approving ' + pend[0].tool + ' ' + (pend[0].target ?? ''));
      await fetch(URL + '/v1/decisions/' + pend[0].id, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ verdict: 'approve' }) });
    }
  } catch { /* keep polling */ }
}, 150);

skill.on('exit', (code) => {
  clearInterval(op);
  console.log('\n== 4. Result ==');
  console.log('notes.md written: ' + existsSync(join(proj, 'notes.md')));
  console.log('(every step is in the hash-chained audit at ' + join(root, 'audit.jsonl') + ')');
  srv.kill();
  process.exit(code ?? 0);
});
