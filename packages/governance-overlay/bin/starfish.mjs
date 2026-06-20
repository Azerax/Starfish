#!/usr/bin/env node
// Project Starfish CLI.
//   starfish init   [--dir <path>] [--operator <name>] [--theme fleet|ops] [--yes] [--no-launch]
//   starfish govern <pack-dir> [--apply] [--approve=id1,id2]
// `init` walks first-run setup (customizable install dir), seeds fail-closed governance, then launches
// the UI. `govern` brings a skill/agent build under governance. Apache-2.0. Local-only.
import { AuditLog, CapabilityLedger } from '@starfish/governance-core';
import { govern } from '@starfish/governance-overlay';
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
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

// ---- fail-closed governance seed (correct policy format: agent:<id> / tool:<id>) ----
function seedGovernance(dir, operator, theme) {
  const gov = join(dir, 'governance');
  mkdirSync(gov, { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  const auditPath = join(dir, 'audit.jsonl');
  if (!existsSync(auditPath)) appendFileSync(auditPath, '');
  const tools = [
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.list', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker', 'pam'], riskTier: 'medium' },
    { id: 'fs.delete', category: 'write', pathParams: ['path'], allowedAgents: ['custodian'], riskTier: 'medium' },
    { id: 'git_commit', category: 'exec', pathParams: [], allowedAgents: ['worker'], riskTier: 'high' },
  ];
  const agents = [
    { id: 'michael', domain: 'orchestration', riskTier: 'medium' },
    { id: 'dwight', domain: 'planning', allowedTools: ['fs.read'], riskTier: 'low' },
    { id: 'toby', domain: 'intake', allowedTools: ['fs.read'], riskTier: 'medium' },
    { id: 'hank', domain: 'monitor', allowedTools: ['fs.read'], riskTier: 'low' },
    { id: 'pam', domain: 'memory', allowedTools: ['fs.read', 'fs.write'], riskTier: 'low' },
    { id: 'custodian', domain: 'custodial', allowedTools: ['fs.read', 'fs.list', 'fs.delete'], riskTier: 'medium' },
    { id: 'worker', domain: 'execution', allowedTools: ['fs.read', 'fs.write', 'git_commit'], riskTier: 'high' },
  ];
  const policies = [
    { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' },
    { id: 'p-delete', subject: 'agent:custodian', action: 'tool:fs.delete', resource: '*', effect: 'allow' },
    { id: 'p-commit', subject: 'agent:worker', action: 'tool:git_commit', resource: '*', effect: 'ask' },
  ];
  writeFileSync(join(gov, 'tools.json'), JSON.stringify(tools, null, 2));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify(agents, null, 2));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify(policies, null, 2));
  writeFileSync(join(dir, 'starfish.config.json'), JSON.stringify({ operator, theme, installDir: dir, secretGatekeeper: 'toby', createdAt: new Date().toISOString() }, null, 2));
}

async function runInit() {
  const interactive = process.stdin.isTTY && !flag('yes');
  let dir = opt('dir');
  let operator = opt('operator');
  let theme = opt('theme');
  const defaultDir = join(homedir(), 'Starfish');

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n  Project Starfish — first-run setup\n  Governance loads first and defaults to DENY. You are the operator.\n');
    dir = dir || (await rl.question(`  Install directory [${defaultDir}]: `)).trim() || defaultDir;
    operator = operator || (await rl.question('  Operator name [Operator]: ')).trim() || 'Operator';
    theme = theme || ((await rl.question('  Theme (fleet/ops) [fleet]: ')).trim() || 'fleet');
    await rl.close();
  } else {
    dir = dir || defaultDir; operator = operator || 'Operator'; theme = theme || 'fleet';
  }
  dir = resolve(dir);
  if (theme !== 'fleet' && theme !== 'ops') theme = 'fleet';

  mkdirSync(dir, { recursive: true });
  seedGovernance(dir, operator, theme);

  console.log(`\n  ✓ Governance seeded (fail-closed) at ${dir}`);
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
