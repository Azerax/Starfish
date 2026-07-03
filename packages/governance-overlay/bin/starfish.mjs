#!/usr/bin/env node
// Project Starfish CLI.
//   starfish init   [--dir <path>] [--operator <name>] [--theme fleet|ops] [--yes] [--no-launch]
//   starfish govern <pack-dir> [--apply] [--approve=id1,id2]
// `init` walks first-run setup (customizable install dir), seeds fail-closed governance, then launches
// the UI. `govern` brings a skill/agent build under governance. Apache-2.0. Local-only.
import { AuditLog, CapabilityLedger, loadGovernor } from '@starfish/governance-core';
import { govern, seedInstall, seedOverlay, isInitialized, readLock } from '@starfish/governance-overlay';
import { resolve, join, dirname, sep } from 'node:path';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { PdpDaemon } from '@starfish/governance-hooks';
import { createHash, randomBytes } from 'node:crypto';
import { createGovernance, startSidecar } from '@starfish/sdk';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); if (a) return a.split('=').slice(1).join('='); const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };

function usage() {
  console.error('usage:\n  starfish init   [--dir <path>] [--operator <name>] [--theme fleet|ops] [--yes] [--no-launch]\n  starfish govern <pack-dir> [--apply] [--approve=id1,id2]\n  starfish serve  [--root <governed-root>] [--port N]   (loopback governance API for embedding)\n  starfish embed  [init|remove] [--dir <target>] [--sdk] [--dashboard]   (provision Starfish External into a repo)');
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
  if (flag('overlay')) { const wp = opt('writes') === 'auto' ? 'auto' : 'ask'; const bk = parseInt(opt('backups') || '3', 10); const r = seedOverlay(dir, { operator, theme, force: flag('force'), writeProfile: wp, backups: Number.isFinite(bk) && bk > 0 ? bk : 3 }); registerGoverned(dir); console.log(`\n  \u2713 Overlay governance seeded at ${join(dir, '.starfish')} (project stays untouched).`); console.log('  Next:  starfish install --claude-code   then   starfish daemon'); return; }
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


// ---- overlay enforcement: daemon + hook + installer (fail-closed) ----
const overlayHome = (projectRoot) => join(projectRoot, '.starfish');
function pdpEndpoint(projectRoot) {
  if (platform() === 'win32') return '\\\\.\\pipe\\starfish-pdp-' + createHash('sha1').update(resolve(projectRoot)).digest('hex').slice(0, 12);
  return join(overlayHome(projectRoot), 'pdp.sock');
}
const pidFile = (projectRoot) => join(overlayHome(projectRoot), 'daemon.pid');
function readConfig(projectRoot) { try { return JSON.parse(readFileSync(join(overlayHome(projectRoot), 'starfish.config.json'), 'utf8')); } catch { return {}; } }
function writeProfileFor(projectRoot) {
  const flag = opt('writes'); if (flag === 'ask' || flag === 'auto') return flag;          // per-session flag wins
  const env = process.env.STARFISH_WRITES; if (env === 'ask' || env === 'auto') return env; // then env
  const cfg = readConfig(projectRoot).writeProfile; return cfg === 'auto' ? 'auto' : 'ask'; // then project default
}
function backupsFor(projectRoot) { const v = parseInt(opt('backups') || process.env.STARFISH_BACKUPS || readConfig(projectRoot).backups || '3', 10); return Number.isFinite(v) && v > 0 ? v : 3; }
// #6 Governed-projects registry. A registered project must STAY governed: if its .starfish is gone, the
// shim denies (tamper) instead of passing through. The agent can't edit these (managed dir is root-owned;
// ~/.starfish is outside every project boundary, so in-band tool writes to it are denied).
const userRegistry = () => join(homedir(), '.starfish', 'governed-projects.json');
const managedRegistry = () => join(managedDir(), 'governed-projects.json');
function readRegistry(p) { try { const a = JSON.parse(readFileSync(p, 'utf8')); return Array.isArray(a) ? a.map((x) => resolve(String(x))) : []; } catch { return []; } }
function registeredRoots() { return [...new Set([...readRegistry(managedRegistry()), ...readRegistry(userRegistry())])]; }
function isRegisteredGoverned(projectRoot) {
  const pr = resolve(projectRoot);
  return registeredRoots().some((r) => pr === r || pr.startsWith(r + sep));
}
function registerGoverned(projectRoot, p) {
  const target = p || userRegistry();
  const list = readRegistry(target); const pr = resolve(projectRoot);
  if (!list.includes(pr)) { list.push(pr); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, JSON.stringify(list, null, 2)); }
}
const readStdin = () => new Promise((res) => { if (process.stdin.isTTY) return res(''); let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => d += c); process.stdin.on('end', () => res(d)); });

async function runDaemon() {
  const projectRoot = resolve(opt('root') || process.cwd());
  const home = overlayHome(projectRoot);
  if (flag('stop')) {
    try { const pid = parseInt(readFileSync(pidFile(projectRoot), 'utf8'), 10); process.kill(pid); rmSync(pidFile(projectRoot)); console.log('stopped daemon', pid); }
    catch (e) { console.error('no running daemon for', projectRoot, '(' + (e.message || e) + ')'); process.exit(1); }
    return;
  }
  if (!isInitialized(home)) { console.error('Not governed yet. Run:  starfish init --overlay --dir "' + projectRoot + '" --yes'); process.exit(1); }
  const governor = loadGovernor(join(home, 'governance'), join(home, 'audit.jsonl'), { stateDir: join(home, 'state') });
  // Boundary: the agent may read/write the PROJECT tree, but NEVER the .starfish governance home (deny).
  const boundaryFor = () => ({ visibility: [projectRoot], write: [projectRoot], deny: [home] });
  const wp = writeProfileFor(projectRoot); const bk = backupsFor(projectRoot);
  const daemon = new PdpDaemon(governor, boundaryFor, undefined, { writeProfile: wp, projectRoot, backupDir: join(home, 'backups'), backups: bk });
  const sock = pdpEndpoint(projectRoot);
  await daemon.listen(sock);
  try { writeFileSync(pidFile(projectRoot), String(process.pid)); } catch { /* noop */ }
  console.log('  Starfish PDP daemon online (fail-closed).');
  console.log('  project : ' + projectRoot);
  console.log('  endpoint: ' + sock);
  console.log('  writes : ' + wp + (wp === 'auto' ? ' (in-boundary writes auto-allowed, ' + bk + ' backups kept)' : ' (every write asks)') + ' - system-risk stays gated either way');
  console.log('  Every governed tool call is denied unless this daemon allows it. Ctrl-C to stop.');
  // #7 Config-drift tripwire: baseline the governance-critical Claude Code settings (managed + user +
  // project). If any change after launch, the daemon enters SAFE MODE — the PDP then denies EVERY tool
  // call — until the operator runs `starfish attest`. Catches a settings edit that weakens governance
  // even though it cannot add a managed hook.
  const critFiles = () => {
    const md = managedDir(); const out = [join(md, 'managed-settings.json')];
    try { const dd = join(md, 'managed-settings.d'); if (existsSync(dd)) for (const x of readdirSync(dd)) if (x.endsWith('.json')) out.push(join(dd, x)); } catch { /* noop */ }
    out.push(join(homedir(), '.claude', 'settings.json'));
    out.push(join(projectRoot, '.claude', 'settings.json'));
    out.push(join(projectRoot, '.claude', 'settings.local.json'));
    return out;
  };
  const configHash = () => createHash('sha256').update(critFiles().sort().map((p) => p + ':' + (existsSync(p) ? readFileSync(p, 'utf8') : 'ABSENT')).join('\n')).digest('hex');
  let baseline = configHash();
  const attestReq = join(home, 'state', 'attest.request');
  const guard = setInterval(() => {
    try {
      if (existsSync(attestReq)) {                                  // operator re-attest
        baseline = configHash(); governor.pdp.setSafeMode(false);
        governor.audit.append({ actor: 'operator', domain: 'governance', action: 'config-reattested', decision: 'allow', reason: 'operator re-attested settings baseline; safe mode cleared' });
        try { rmSync(attestReq); } catch { /* noop */ }
        console.log('  [attest] settings re-baselined; safe mode cleared.');
        return;
      }
      if (configHash() !== baseline && !governor.pdp.isSafeMode()) {
        governor.pdp.setSafeMode(true, 'Claude Code settings drift');
        governor.audit.append({ actor: 'system', domain: 'governance', action: 'config-drift', decision: 'deny', reason: 'CC settings changed since baseline — SAFE MODE (deny all) until `starfish attest`' });
        console.error('  [drift] settings changed since launch — SAFE MODE engaged (deny all). Run `starfish attest` to clear.');
      }
    } catch { /* keep watching */ }
  }, 2000);
  guard.unref?.();
  const shutdown = () => { try { clearInterval(guard); } catch { /* noop */ } try { daemon.close(); } catch { /* noop */ } try { rmSync(pidFile(projectRoot)); } catch { /* noop */ } process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

function emitDecision(isPre, resp) {
  if (!isPre) { process.stdout.write('{}'); process.exit(0); }
  const pd = (resp && resp.permissionDecision) ? resp.permissionDecision : 'allow';
  let reason = (resp && resp.reason) ? resp.reason : '';
  if (reason && !reason.startsWith('[Starfish]')) reason = '[Starfish] ' + reason;
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: pd, permissionDecisionReason: reason }, permissionDecision: pd, reason };
  if (pd === 'deny') out.decision = 'block'; else if (pd === 'allow') out.decision = 'approve';
  process.stdout.write(JSON.stringify(out));
  if (pd === 'deny') { process.stderr.write('[starfish] DENY: ' + reason + '\n'); process.exit(2); }
  process.exit(0);
}

function askDaemon(projectRoot, agentId, hp) {
  const sessionId = hp.session_id || '';
  return new Promise((res, rej) => {
    const conn = createConnection(pdpEndpoint(projectRoot));
    let buf = '', stage = 'hello', done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { conn.destroy(); } catch { /* noop */ } rej(new Error('timeout')); } }, 4000);
    conn.on('connect', () => conn.write(JSON.stringify({ type: 'hello', agentId, session_id: sessionId }) + '\n'));
    conn.on('data', (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (stage === 'hello') { if (msg.ok) { stage = 'payload'; conn.write(JSON.stringify(hp) + '\n'); } else { done = true; clearTimeout(to); conn.destroy(); rej(new Error('handshake-failed')); } }
        else { done = true; clearTimeout(to); conn.destroy(); res(msg); }
      }
    });
    conn.on('error', (e) => { if (!done) { done = true; clearTimeout(to); rej(e); } });
  });
}

async function runHook() {
  for (const k of ['LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS']) delete process.env[k];   // defense vs loader injection
  const projectRoot = resolve(opt('root') || process.cwd());
  const event = opt('event') || '';
  const agentId = process.env.STARFISH_AGENT || 'worker';
  const permissive = process.env.STARFISH_PERMISSIVE === '1';
  let payload = {}; try { payload = JSON.parse((await readStdin()) || '{}'); } catch { /* noop */ }
  const ev = event || payload.hook_event_name || '';
  const isPre = ev === 'PreToolUse';
  const sessionId = payload.session_id || '';
  const hp = { hook_event_name: ev, tool_name: payload.tool_name, tool_input: payload.tool_input, session_id: sessionId };
  // Governance is opt-in PER PROJECT. Managed hooks fire machine-wide, so a project that has not been
  // brought under Starfish (no .starfish) passes through — we never brick ungoverned repos. Once a repo
  // is governed (.starfish present), enforcement is strict and fail-closed.
  if (isPre) {
    const governed = isInitialized(overlayHome(projectRoot));
    const registered = isRegisteredGoverned(projectRoot);
    if (registered && !governed) {
      return emitDecision(true, { permissionDecision: 'deny', reason: 'registered governed project is missing .starfish (tamper) — fail-closed deny' });
    }
    if (!governed && !registered) {
      return emitDecision(true, { permissionDecision: 'allow', reason: 'project not under Starfish governance (no .starfish)' });
    }
  }
  try {
    const resp = await askDaemon(projectRoot, agentId, hp);
    emitDecision(isPre, resp);
  } catch (e) {
    if (!isPre) { process.stdout.write('{}'); process.exit(0); }                 // observational: nothing to enforce
    if (permissive) { process.stderr.write('[starfish] PERMISSIVE override — allowed WITHOUT governance\n'); emitDecision(true, { permissionDecision: 'allow', reason: 'STARFISH_PERMISSIVE (ungoverned)' }); }
    emitDecision(true, { permissionDecision: 'deny', reason: 'governance daemon unreachable — fail-closed (' + (e.message || e) + ')' });
  }
}

function ccSettingsPath(projectRoot, scope) { return scope === 'user' ? join(homedir(), '.claude', 'settings.json') : join(projectRoot, '.claude', 'settings.local.json'); }
function managedDir() {
  if (process.env.STARFISH_MANAGED_DIR) return process.env.STARFISH_MANAGED_DIR;   // override (testing / custom)
  const p = platform();
  if (p === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (p === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';                                                        // linux / wsl
}
// The machine-wide lockdown policy: Claude Code itself refuses any non-managed hook, permission rule, or
// bypass mode, so Starfish is the SOLE authority. Hooks resolve the project root from cwd at runtime.
const SELF_CLI = fileURLToPath(import.meta.url);                 // absolute path to THIS installed cli.mjs
const NODE_ABS = process.execPath;                              // absolute node binary
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const integrityPath = () => join(managedDir(), 'starfish-integrity.json');   // sidecar (NOT read by CC)
const launcherPath = () => join(managedDir(), 'starfish-launch.cjs');         // root-owned verify-before-exec shim
// The launcher is referenced by the (root-owned) managed hook command and lives in the (root-owned)
// managed dir, so it is as tamper-resistant as the policy itself. It hashes cli.mjs against the integrity
// baseline BEFORE running it: a swapped/edited cli is refused at run time (fail-closed deny), not just
// flagged by `doctor`.
const LAUNCHER_CJS = [
  '#!/usr/bin/env node',
  "const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');",
  'const args=process.argv.slice(2);',
  "const isPre=args.includes('PreToolUse');",
  'function deny(reason){',
  "  if(isPre){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason},permissionDecision:'deny',reason:reason,decision:'block'}));process.stderr.write('[starfish] '+reason+String.fromCharCode(10));process.exit(2);}",
  "  process.stdout.write('{}');process.exit(0);",
  '}',
  'try{',
  "  const ig=JSON.parse(fs.readFileSync(path.join(__dirname,'starfish-integrity.json'),'utf8'));",
  "  const h=crypto.createHash('sha256').update(fs.readFileSync(ig.cliPath)).digest('hex');",
  "  if(h!==ig.cliSha256){deny('integrity check failed: cli.mjs changed since install');}",
  "  const r=cp.spawnSync(ig.nodePath,[ig.cliPath].concat(args),{stdio:'inherit'});",
  '  process.exit(r.status==null?0:r.status);',
  "}catch(e){deny('integrity verifier error: '+((e&&e.message)||e));}",
  '',
].join(String.fromCharCode(10));
function managedPolicy() {
  const run = (ev) => `"${NODE_ABS}" "${launcherPath()}" hook --event ${ev}`;   // verify-before-exec launcher (root-owned), absolute paths
  const hk = (ev) => ({ matcher: '*', hooks: [{ type: 'command', command: run(ev), timeout: 10000 }] });
  const life = (ev) => ({ hooks: [{ type: 'command', command: run(ev), timeout: 10000 }] });
  return {
    allowManagedHooksOnly: true,
    allowManagedPermissionRulesOnly: true,
    strictPluginOnlyCustomization: ['hooks', 'skills', 'mcp', 'agents'],
    disableBypassPermissionsMode: 'disable',
    disableAutoMode: 'disable',
    disableAllHooks: false,                                  // pinned: a user setting can't switch hooks off (managed wins)
    allowUnsandboxedCommands: false,
    env: { NODE_OPTIONS: '' },                               // neutralize --require/loader injection into the hook process

    statusLine: { type: 'command', command: `"${NODE_ABS}" "${SELF_CLI}" statusline` },
    hooks: {
      PreToolUse: [hk('PreToolUse')],
      PostToolUse: [hk('PostToolUse')],
      ConfigChange: [life('ConfigChange')],
      SessionStart: [life('SessionStart')],
    },
  };
}
// Re-run the managed install with elevation. Windows: trigger a UAC prompt (Start-Process -Verb RunAs)
// that runs an elevated child and -Wait for it (you cannot elevate the running process in place). Unix:
// re-exec under sudo, which prompts in the same terminal. The child carries --elevated to avoid a loop.
function elevateAndInstall() {
  const childArgs = [SELF_CLI, 'install', '--claude-code', '--managed', '--elevated'];
  if (platform() === 'win32') {
    const ps = (x) => "'" + String(x).replace(/'/g, "''") + "'";
    const argList = childArgs.map(ps).join(',');
    const cmd = 'Start-Process -Verb RunAs -Wait -FilePath ' + ps(NODE_ABS) + ' -ArgumentList ' + argList;
    console.error('  Requesting Administrator (a UAC prompt will appear)...');
    const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' });
    return r.status === 0;
  }
  console.error('  Requesting elevation via sudo...');
  const r = spawnSync('sudo', [NODE_ABS, ...childArgs], { stdio: 'inherit' });
  return r.status === 0;
}

function installManaged() {
  const dir = managedDir();
  const dropinDir = join(dir, 'managed-settings.d');
  const target = join(dropinDir, 'starfish.json');
  const policy = managedPolicy();
  try {
    mkdirSync(dropinDir, { recursive: true });
    if (existsSync(target)) copyFileSync(target, target + '.bak.' + Date.now());
    writeFileSync(target, JSON.stringify(policy, null, 2));
    // #5 integrity baseline (sidecar, root-owned, not parsed by Claude Code)
    try { writeFileSync(integrityPath(), JSON.stringify({ cliPath: SELF_CLI, cliSha256: sha256(readFileSync(SELF_CLI)), nodePath: NODE_ABS, installedAt: new Date().toISOString() }, null, 2)); } catch { /* noop */ }
    try { writeFileSync(launcherPath(), LAUNCHER_CJS); } catch { /* noop */ }
    // #8 restrictive perms on unix (root-owned, not group/world writable)
    if (platform() !== 'win32') { try { chmodSync(dropinDir, 0o755); chmodSync(target, 0o644); chmodSync(integrityPath(), 0o644); chmodSync(launcherPath(), 0o755); } catch { /* noop */ } }
    console.log('  ✓ Strategy A managed lockdown installed -> ' + target);
    console.log('  Claude Code will now load ONLY Starfish hooks + managed permission rules; bypass mode is disabled.');
    console.log('  Per project you want governed:  starfish init --overlay --yes   then   starfish daemon');
  } catch (e) {
    if (!flag('elevated') && !flag('no-elevate')) {
      if (elevateAndInstall() && existsSync(join(managedDir(), 'managed-settings.d', 'starfish.json'))) {
        console.log('  \u2713 Managed lockdown installed with elevation -> ' + join(managedDir(), 'managed-settings.d', 'starfish.json'));
        console.log('  Verify: starfish doctor');
        return;
      }
      console.error('  Elevation did not complete. Manual steps below.');
    }
    console.error('  Could not write managed settings (needs elevation): ' + (e.message || e));
    if (platform() === 'win32') {
      console.error('  Re-run in an ELEVATED shell (no sudo on Windows):');
      console.error('    1) Start menu > PowerShell > right-click > Run as administrator, then:');
      console.error('       starfish install --claude-code --managed');
      console.error('    2) ...or elevate just this command from a normal PowerShell:');
      console.error('       Start-Process powershell -Verb RunAs -ArgumentList \'-NoExit\',\'-Command\',\'starfish install --claude-code --managed\'');
      console.error('    3) ...or, on Windows 11 24H2 with sudo enabled (Settings > System > For developers): sudo starfish install --claude-code --managed');
    } else {
      console.error('  Re-run with elevation:  sudo starfish install --claude-code --managed');
      console.error('  ...or create it yourself: sudo mkdir -p "' + dropinDir + '" && sudo tee "' + target + '" >/dev/null  (paste the JSON below)');
      console.error(JSON.stringify(policy, null, 2));
    }
    process.exit(1);
  }
}

const HOOK_EVENTS = ['PreToolUse', 'PostToolUse'];
function runInstall() {
  if (flag('managed')) { installManaged(); return; }
  const projectRoot = resolve(opt('root') || process.cwd());
  const scope = opt('scope') || 'project';
  const p = ccSettingsPath(projectRoot, scope);
  mkdirSync(dirname(p), { recursive: true });
  let cfg = {};
  if (existsSync(p)) { try { cfg = JSON.parse(readFileSync(p, 'utf8')); } catch { cfg = {}; } copyFileSync(p, p + '.bak.' + Date.now()); }
  cfg.hooks = cfg.hooks || {};
  for (const ev of HOOK_EVENTS) {
    const arr = (cfg.hooks[ev] || []).filter((g) => !JSON.stringify(g).includes('starfish hook'));   // idempotent: drop prior starfish entries
    arr.push({ matcher: '*', hooks: [{ type: 'command', command: `starfish hook --event ${ev} --root "${projectRoot}"`, timeout: 10000 }] });
    cfg.hooks[ev] = arr;
  }
  cfg.statusLine = { type: 'command', command: `starfish statusline --root "${projectRoot}"` };
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log('  Installed Starfish hooks + status line -> ' + p);
  console.log('  Events: ' + HOOK_EVENTS.join(', ') + ' (deny-by-default, fail-closed).');
  console.log('  Start the PDP:  starfish daemon --root "' + projectRoot + '"');
}
function runUninstall() {
  const projectRoot = resolve(opt('root') || process.cwd());
  const scope = opt('scope') || 'project';
  const p = ccSettingsPath(projectRoot, scope);
  if (!existsSync(p)) { console.log('nothing to uninstall (no settings at ' + p + ')'); return; }
  let cfg = {}; try { cfg = JSON.parse(readFileSync(p, 'utf8')); } catch { console.error('could not parse ' + p); process.exit(1); }
  copyFileSync(p, p + '.bak.' + Date.now());
  for (const ev of Object.keys(cfg.hooks || {})) {
    cfg.hooks[ev] = (cfg.hooks[ev] || []).filter((g) => !JSON.stringify(g).includes('starfish hook'));
    if (cfg.hooks[ev].length === 0) delete cfg.hooks[ev];
  }
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log('  Removed Starfish hooks from ' + p);
}


function runEmbedDoctor() {
  const root = resolve(opt('root') || join(process.cwd(), '.starfish'));
  const rows = [];
  const add = (n, st, d = '') => rows.push([n, st, d]);
  add('governed root', isInitialized(root) ? 'PASS' : 'FAIL', root);
  try { const v = JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8')).version; add('schema stamp', v ? 'PASS' : 'WARN', 'v' + v); } catch { add('schema stamp', 'WARN', 'no schema.json (stamped on first serve)'); }
  try {
    const g = createGovernance({ root, allowCloudFs: true });
    add('audit chain intact', g.verifyAudit() ? 'PASS' : 'FAIL', g.verifyAudit() ? 'hash-chain verified' : 'TAMPER - chain broken');
    add('deny-by-default active', g.safeMode() ? 'FAIL' : 'PASS', g.safeMode() ? 'in SAFE MODE (integrity failure)' : 'gate live');
  } catch (e) { add('governance boot', 'FAIL', (e && e.message) || String(e)); }
  try { const m = statSync(join(root, 'sidecar-tokens.json')).mode; add('token file perms', (m & 0o077) ? 'WARN' : 'PASS', (m & 0o077) ? 'group/world-accessible - chmod 600' : '0600'); } catch { add('token file', 'WARN', 'none yet (created on first serve)'); }
  try { const pol = JSON.parse(readFileSync(join(root, 'governance', 'policies.json'), 'utf8')); const blanket = pol.find((p) => p.subject === '*' && p.resource === '*' && p.effect === 'allow' && /write|exec|shell|delete/.test(p.action || '')); add('no blanket write/exec allow', blanket ? 'FAIL' : 'PASS', blanket ? 'blanket allow: ' + blanket.id : 'deny-by-default holds'); } catch { add('policies', 'WARN', 'no policies.json'); }
  let bad = 0;
  console.log('  Starfish External - embedded deployment doctor: ' + root);
  for (const [n, st, d] of rows) { if (st === 'FAIL') bad++; console.log('  ' + st.padEnd(5) + ' ' + n + (d ? '  ' + d : '')); }
  console.log(bad ? ('  x ' + bad + ' FAIL') : '  ok - embedded deployment healthy');
  process.exit(bad ? 1 : 0);
}

function runDoctor() {
  if (flag('embed')) { runEmbedDoctor(); return; }
  const projectRoot = resolve(opt('root') || process.cwd());
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  const dropin = join(managedDir(), 'managed-settings.d', 'starfish.json');
  let policy = null; try { policy = JSON.parse(readFileSync(dropin, 'utf8')); } catch { /* absent */ }
  if (!policy) {
    add('managed lockdown deployed', 'FAIL', 'missing ' + dropin + ' - run ' + (platform() === 'win32' ? 'an elevated (Run as administrator) `starfish install --claude-code --managed`' : '`sudo starfish install --claude-code --managed`'));
  } else {
    add('managed lockdown deployed', 'PASS', dropin);
    const need = { allowManagedHooksOnly: true, allowManagedPermissionRulesOnly: true, disableAllHooks: false, disableBypassPermissionsMode: 'disable', allowUnsandboxedCommands: false };
    for (const [k, v] of Object.entries(need)) add('pin ' + k, JSON.stringify(policy[k]) === JSON.stringify(v) ? 'PASS' : 'FAIL', 'is ' + JSON.stringify(policy[k]) + ' (want ' + JSON.stringify(v) + ')');
    const spc = policy.strictPluginOnlyCustomization;
    add('strictPluginOnlyCustomization=hooks', Array.isArray(spc) && spc.includes('hooks') ? 'PASS' : 'WARN', JSON.stringify(spc));
    const cmd = (((policy.hooks || {}).PreToolUse || [])[0] || {}).hooks ? policy.hooks.PreToolUse[0].hooks[0].command : '';
    const absolute = /^"?(\/|[A-Za-z]:\\)/.test(cmd) || cmd.includes('/') && !cmd.startsWith('starfish ');
    add('hook command is absolute (no PATH)', absolute ? 'PASS' : 'FAIL', cmd || '(none)');
  }

  add('verify-before-exec launcher', existsSync(launcherPath()) ? 'PASS' : 'WARN', existsSync(launcherPath()) ? launcherPath() : 'not deployed (managed install writes it)');
  let integ = null; try { integ = JSON.parse(readFileSync(integrityPath(), 'utf8')); } catch { /* absent */ }
  if (integ) {
    let cur = ''; try { cur = sha256(readFileSync(integ.cliPath || SELF_CLI)); } catch { /* noop */ }
    add('cli integrity (vs baseline)', cur && cur === integ.cliSha256 ? 'PASS' : 'FAIL', cur === integ.cliSha256 ? 'matches' : 'cli.mjs changed since install — investigate or reinstall');
  } else add('cli integrity baseline', 'WARN', 'no starfish-integrity.json (run the managed install to record it)');

  // managed file not group/world writable (unix)
  if (platform() !== 'win32' && policy) {
    try { const m = statSync(dropin).mode; add('managed file perms', (m & 0o022) ? 'WARN' : 'PASS', (m & 0o022) ? 'group/world-writable — chmod 644 + root-own' : 'not group/world writable'); } catch { /* noop */ }
  }
  // binary not user-writable in a shared/root location (best-effort)
  try { const m = statSync(SELF_CLI).mode; add('cli binary perms', (m & 0o022) ? 'WARN' : 'PASS', SELF_CLI); } catch { /* noop */ }

  add('project governed (.starfish)', isInitialized(overlayHome(projectRoot)) ? 'PASS' : 'WARN', projectRoot);
  add('daemon running for project', existsSync(pidFile(projectRoot)) ? 'PASS' : 'WARN', existsSync(pidFile(projectRoot)) ? 'pid ' + (() => { try { return readFileSync(pidFile(projectRoot), 'utf8'); } catch { return '?'; } })() : 'start: starfish daemon');

  const pad = (x, n) => (x + ' '.repeat(n)).slice(0, n);
  console.log('\n  Starfish doctor — governance posture for ' + projectRoot + '\n');
  for (const c of checks) console.log('  ' + pad(c.status, 5) + ' ' + pad(c.name, 38) + ' ' + (c.detail || ''));
  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  console.log('\n  ' + (fails ? '✗ ' + fails + ' FAIL' : '✓ no failures') + (warns ? ', ' + warns + ' warning(s)' : '') + '.');
  if (fails) process.exit(1);
}

function runStatusline() {
  // Persistent indicator for the Claude Code status line. Read-only; computed from the audit + daemon.
  const root = resolve(opt('root') || process.cwd());
  const home = overlayHome(root);
  if (!isInitialized(home)) { process.stdout.write('\u2b21 Starfish \u00b7 not governing here'); return; }
  let allow = 0, deny = 0, drift = false;
  try {
    for (const ln of readFileSync(join(home, 'audit.jsonl'), 'utf8').split('\n')) {
      if (!ln.trim()) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      const a = e.action || '';
      if (a.indexOf('ingress:') === 0) { if (e.decision === 'allow') allow++; else if (e.decision === 'deny') deny++; }
      else if (a === 'config-drift') drift = true;
      else if (a === 'config-reattested') drift = false;
    }
  } catch { /* no/locked audit */ }
  const daemonUp = existsSync(pidFile(root));
  const wp = readConfig(root).writeProfile === 'auto' ? 'auto' : 'ask';
  let s = '\u2b21 Starfish';
  s += (drift ? ' \u26a0 SAFE MODE' : ' \u2713 governed');
  s += ` \u00b7 ${allow}\u2713 ${deny}\u26d4`;
  s += daemonUp ? ' \u00b7 daemon up' : ' \u00b7 daemon DOWN (deny-all)';
  s += ' \u00b7 writes:' + wp;
  process.stdout.write(s);
}

function runAttest() {
  const projectRoot = resolve(opt('root') || process.cwd());
  const home = overlayHome(projectRoot);
  if (!isInitialized(home)) { console.error('Not governed: ' + projectRoot); process.exit(1); }
  mkdirSync(join(home, 'state'), { recursive: true });
  writeFileSync(join(home, 'state', 'attest.request'), new Date().toISOString());
  console.log('  Re-attest requested. The running daemon will re-baseline the settings and clear safe mode.');
}

async function runServe() {
  const root = resolve(opt('root') || join(process.cwd(), '.starfish'));
  if (!isInitialized(root)) { console.error('Not a governed root: ' + root + '  (run:  starfish embed init --dir <project>)'); process.exit(1); }
  const tokFile = join(root, 'sidecar-tokens.json');
  let toks;
  try { toks = JSON.parse(readFileSync(tokFile, 'utf8')); }
  catch { toks = { worker: randomBytes(24).toString('hex'), operator: randomBytes(24).toString('hex') }; writeFileSync(tokFile, JSON.stringify(toks, null, 2)); try { chmodSync(tokFile, 0o600); } catch { /* best-effort */ } }
  const gov = createGovernance({ root, keyResolver: () => process.env.ANTHROPIC_API_KEY, allowCloudFs: flag('allow-cloud-fs') });
  const port = parseInt(opt('port', '0'), 10) || 0;
  const sc = await startSidecar({ governance: gov, identities: [{ token: toks.worker, actor: 'worker' }, { token: toks.operator, actor: 'operator' }], port });
  console.log('  Starfish sidecar online (loopback, fail-closed).');
  console.log('  governed root : ' + root);
  console.log('  url           : ' + sc.url);
  console.log('  tokens        : ' + tokFile + '  (worker = skills gate; operator = approvals)');
  console.log('  endpoints     : GET /v1/health, POST /v1/decide, GET /v1/pending, POST /v1/decisions/{id}');
  console.log('  Host skills gate via /v1/decide; operator approves via /v1/decisions/{id}. Ctrl-C to stop.');
  process.stdin.resume();
}

async function runEmbed() {
  const sub = (argv[1] === 'remove') ? 'remove' : 'init';
  const projectRoot = resolve(opt('dir') || process.cwd());
  const home = overlayHome(projectRoot);
  if (sub === 'remove') {
    try { rmSync(join(home, 'embed.json')); console.log('  Starfish External deprovisioned (embed.json removed; governance + audit kept).'); }
    catch { console.error('  no embed config at ' + home); process.exit(1); }
    return;
  }
  if (!isInitialized(home)) {
    seedOverlay(projectRoot, { operator: opt('operator', 'Operator'), theme: opt('theme', 'fleet'), writeProfile: opt('writes') === 'auto' ? 'auto' : 'ask', backups: parseInt(opt('backups', '3'), 10) || 3 });
    registerGoverned(projectRoot);
    console.log('  \u2713 governance seeded at ' + home + ' (project untouched).');
  } else { console.log('  (already governed at ' + home + ')'); }
  const cfg = { root: home, wire: 1, mode: 'sidecar', dashboard: flag('dashboard'), sdk: flag('sdk'), createdAt: new Date().toISOString() };
  writeFileSync(join(home, 'embed.json'), JSON.stringify(cfg, null, 2));
  console.log('  \u2713 Starfish External provisioned (optional, installed from Starfish).');
  console.log('  run governance :  starfish serve --root "' + home + '"');
  console.log('  gate a call    :  POST /v1/decide    approve :  POST /v1/decisions/{id}');
  if (flag('sdk')) console.log('  in-process     :  npm i @starfish/sdk   then createGovernance({ root })');
  if (flag('dashboard')) console.log('  dashboard      :  npm i @starfish/ui   then <GovernancePanel bridge={httpBridge(...)} />');
}

if (cmd === 'init') await runInit();
else if (cmd === 'govern') await runGovern();
else if (cmd === 'daemon') await runDaemon();
else if (cmd === 'hook') await runHook();
else if (cmd === 'install') runInstall();
else if (cmd === 'uninstall') runUninstall();
else if (cmd === 'attest') runAttest();
else if (cmd === 'doctor') runDoctor();
else if (cmd === 'statusline') runStatusline();
else if (cmd === 'serve') await runServe();
else if (cmd === 'embed') await runEmbed();
else usage();
