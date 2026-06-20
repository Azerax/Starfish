#!/usr/bin/env node
// Project Starfish CLI.
//   starfish init   [--dir <path>] [--operator <name>] [--theme fleet|ops] [--yes] [--no-launch]
//   starfish govern <pack-dir> [--apply] [--approve=id1,id2]
// `init` walks first-run setup (customizable install dir), seeds fail-closed governance, then launches
// the UI. `govern` brings a skill/agent build under governance. Apache-2.0. Local-only.
import { AuditLog, CapabilityLedger } from '@starfish/governance-core';
import { govern, seedInstall } from '@starfish/governance-overlay';
import { resolve, join } from 'node:path';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); if (a) return a.split('=').slice(1).join('='); const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };

function usage() {
  console.error('usage:\n  starfish init   [--dir <path>] [--operator <name>] [--theme fleet|ops] [--yes] [--no-launch]\n  starfish govern <pack-dir> [--apply] [--approve=id1,id2]');
  process.exit(2);
}

// ---- cross-platform "open" (UI / URL / app) ----
function openTarget(target) {
  try {
    if (platform() === 'win32') spawn('cmd', ['/c', 'start', '""', target], { stdio: 'ignore', detached: true }).unref();
    else if (platform() === 'darwin') spawn('open', [target], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [target], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch { return false; }
}
function findDesktopApp() {
  const explicit = opt('app') || process.env.STARFISH_APP;   // --app <path> or STARFISH_APP wins
  if (explicit && existsSync(explicit)) return explicit;
  const home = homedir(); const p = platform(); const cands = [];
  if (p === 'win32') {
    const la = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    cands.push(join(la, 'Programs', 'GCS Starfish', 'GCS Starfish.exe'), join(pf, 'GCS Starfish', 'GCS Starfish.exe'));
  } else if (p === 'darwin') {
    cands.push('/Applications/GCS Starfish.app', join(home, 'Applications', 'GCS Starfish.app'));
  }
  for (const c of cands) if (existsSync(c)) return c;
  if (p === 'linux') { try { const d = join(home, 'Applications'); if (existsSync(d)) { const m = readdirSync(d).find((x) => /GCS Starfish.*\.AppImage/i.test(x)); if (m) return join(d, m); } } catch { /* ignore */ } }
  return null;
}
function launchUI(installDir) {
  const app = findDesktopApp();
  if (app) {
    try {
      if (platform() === 'darwin' && app.endsWith('.app')) spawn('open', [app, '--args', '--starfish-dir', installDir], { stdio: 'ignore', detached: true }).unref();
      else spawn(app, ['--starfish-dir', installDir], { stdio: 'ignore', detached: true }).unref();
      return 'desktop app';
    } catch { /* fall through to browser */ }
  }
  return openTarget('https://projectstarfish.ca/app') ? 'browser' : null;
}

// Governance seeding + the base-root scaffold now live in ONE place: seedInstall() in
// @starfish/governance-overlay. CLI, desktop wizard, and `npm run init:gov` all call it.

async function runInit() {
  const interactive = process.stdin.isTTY && !flag('yes');
  let dir = opt('dir');
  let operator = opt('operator');
  let theme = opt('theme');
  const defaultDir = join(homedir(), 'Starfish');

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n  Project Starfish — first-run setup\n  Governance loads first and defaults to DENY. You are the operator.\n  The base root is the ABSOLUTE TOP Starfish can see; everything (tools/, agents/, skills/) lives under it.\n');
    dir = dir || (await rl.question(`  Base root directory — the top Starfish can see [${defaultDir}]: `)).trim() || defaultDir;
    operator = operator || (await rl.question('  Operator name [Operator]: ')).trim() || 'Operator';
    theme = theme || ((await rl.question('  Theme (fleet/ops) [fleet]: ')).trim() || 'fleet');
    await rl.close();
  } else {
    dir = dir || defaultDir; operator = operator || 'Operator'; theme = theme || 'fleet';
  }
  dir = resolve(dir);
  if (existsSync(join(dir, '.starfish-init.lock')) && !flag('force')) {
    let by = 'another setup', at = 'a prior run';
    try { const l = JSON.parse(readFileSync(join(dir, '.starfish-init.lock'), 'utf8')); by = l.by || by; at = l.at || at; } catch { /* ignore */ }
    console.error(`\n  ✗ Already initialized at ${dir} (by ${by} on ${at}).\n  One init per install — refusing to re-init. Launch the app, or pass --force to reconfigure.\n`);
    process.exit(1);
  }
  if (theme !== 'fleet' && theme !== 'ops') theme = 'fleet';

  mkdirSync(dir, { recursive: true });
  seedInstall(dir, { operator, theme, by: 'cli', force: flag('force') });

  console.log(`\n  ✓ Base root (visibility ceiling): ${dir}`);
  console.log('  ✓ Layout: governance/ state/ audit.jsonl (above agents) · tools/<tool>/ agents/<id>/workspace/ skills/ shared/');
  console.log('  ✓ Governance seeded (fail-closed).');
  console.log(`  ✓ Operator: ${operator}   Theme: ${theme}   Secret gatekeeper: Toby`);
  console.log('  ✓ Crew: Captain Mykel, First Officer, Oh Brian (intake), Constable Gooey (monitor), D8A, Quartermaster (custodian), Deck Crew\n');

  if (flag('no-launch')) { console.log('  Setup complete. Launch later with the GCS Starfish app or starfish (UI).'); return; }
  const how = launchUI(dir);
  if (how) console.log(`  Launching the Starfish UI (${how})…`);
  else console.log('  Setup complete. Could not auto-launch the UI — open https://projectstarfish.ca/app or run the GCS Starfish app.');
}

async function runGovern() {
  const target = argv[1];
  if (!target || target.startsWith('--')) usage();
  const approve = (opt('approve', '') || '').split(',').filter(Boolean);
  const packDir = resolve(target);
  const ledger = new CapabilityLedger(new AuditLog(resolve(packDir, '.starfish', 'audit.jsonl')));
  const out = govern(packDir, ledger, { approve });
  console.log(`Inventoried ${packDir}`);
  console.log(`  auto-registered (Low): ${out.registered.join(', ') || '(none)'}`);
  console.log(`  quarantined (needs consent): ${out.quarantined.join(', ') || '(none)'}`);
  if (out.approved.length) console.log(`  approved this run: ${out.approved.join(', ')}`);
  console.log(`  boundary: ${out.boundary.visibility.join(', ')}`);
  console.log(`  agents injected: ${out.agents.join(', ')}`);
  console.log('Quarantined capabilities cannot run until you approve them (--approve=<id>).');
}

if (cmd === 'init') await runInit();
else if (cmd === 'govern') await runGovern();
else usage();
