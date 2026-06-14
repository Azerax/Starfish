// Electron main — ring-3 host. Boots governance FIRST (fail-closed), shows the splash, and on
// first run presents the OnboardingWizard whose intake routes through governDefaults
// (vet -> CapabilityLedger). Nothing is registered except via that governed path.
import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHost, type Host } from '@starfish/desktop';
import type { ActionRequest, ActionResult } from '@starfish/desktop';
import { governDefaults } from '@starfish/governance-overlay';
import defaultSkillsJson from '../../../../governance-overlay/defaults/default-skills.json';
import registrySeed from '../../../../governance-overlay/defaults/registry-seed.json';

const HERE = dirname(fileURLToPath(import.meta.url));
let root = '';
let host: Host | undefined;
let splash: BrowserWindow | null = null;
let win: BrowserWindow | null = null;

// Bundled default catalog (sourced from anthropics/skills). Candidates only — confer no trust.
type CatSkill = { id: string; kind: string; category: string; summary: string; expectedRisk: string; recommended?: boolean; plugin: string };
const CATALOG: CatSkill[] = (defaultSkillsJson as { sets: { plugin: string; skills: Omit<CatSkill, 'plugin'>[] }[] })
  .sets.flatMap((set) => set.skills.map((s) => ({ ...s, plugin: set.plugin })));

async function bootGovernance(): Promise<void> {
  try {
    host = await createHost({
      governanceDir: join(root, 'governance'),
      auditPath: join(root, 'audit.jsonl'),
      stateDir: join(root, 'state'),
      projectRoot: root,
      listenPath: process.platform === 'win32' ? '\\\\.\\pipe\\starfish-pdp' : join(root, 'pdp.sock'),
    });
    console.log('[governance] booted — fail-closed checks passed');
  } catch (err) {
    console.error('[governance] fail-closed boot error (run `npm run init:gov`):', (err as Error).message);
  }
}

function onbFile(): string { return join(root, 'state', 'onboarding.json'); }
function readOnb(): { done?: boolean; operator?: string; theme?: string } {
  try { return JSON.parse(readFileSync(onbFile(), 'utf8')); } catch { return { done: false }; }
}
function writeOnb(o: object): void {
  try { mkdirSync(join(root, 'state'), { recursive: true }); writeFileSync(onbFile(), JSON.stringify(o, null, 2)); }
  catch (e) { console.error('[onboarding] persist error:', (e as Error).message); }
}

function loadPage(w: BrowserWindow, page: 'index' | 'splash'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void w.loadURL(`${devUrl}/${page}.html`);
  else void w.loadFile(join(HERE, `../renderer/${page}.html`));
}
function createSplash(): void {
  splash = new BrowserWindow({ width: 560, height: 660, frame: false, resizable: false, alwaysOnTop: true,
    backgroundColor: '#04060f', show: true, center: true,
    webPreferences: { preload: join(HERE, '../preload/splash.mjs'), contextIsolation: true, sandbox: false } });
  loadPage(splash, 'splash');
}
function createWindow(): void {
  win = new BrowserWindow({ width: 1320, height: 860, show: false, backgroundColor: '#04060f',
    webPreferences: { preload: join(HERE, '../preload/index.mjs'), contextIsolation: true, sandbox: false } });
  loadPage(win, 'index');
}

const DEV = {
  crew: [
    { id: 'michael', role: 'Orchestrator', status: 'active', currentTaskId: '#412', riskTier: 'medium' },
    { id: 'dwight', role: 'Planner', status: 'active', currentTaskId: '#418', riskTier: 'low' },
    { id: 'toby', role: 'Intake & vetting', status: 'idle', riskTier: 'medium' },
    { id: 'hank', role: 'Security monitor', status: 'sweeping', riskTier: 'low' },
    { id: 'pam', role: 'Memory', status: 'active', riskTier: 'low' },
    { id: 'worker', role: 'Execution', status: 'paused', currentTaskId: '#412', riskTier: 'high' },
  ],
  decisions: [
    { id: 'd1', ts: '20:31:04', actor: 'dwight', tool: 'fs.read', target: '/proj/src/app.ts', verdict: 'allow', reason: 'registered; in boundary; risk low', riskTier: 'low' },
    { id: 'd2', ts: '20:31:02', actor: 'worker', tool: 'git_commit', verdict: 'ask', reason: 'risk high -> human approval (proposer != approver)', riskTier: 'high' },
    { id: 'd3', ts: '20:30:58', actor: 'worker', tool: 'shell.raw', verdict: 'deny', reason: 'default-deny; raw shell unregistered', riskTier: 'critical' },
  ],
  audit: [], tasks: [], services: [],
  budgets: [
    { scope: 'global', status: 'ok', usdUsed: 6.4, usdLimit: 10, tokensUsed: 812000, tokensLimit: 1500000 },
    { scope: 'worker', status: 'hard', usdUsed: 4.1, usdLimit: 4, tokensUsed: 410000, tokensLimit: 400000 },
  ],
  monitor: { lastSweepTs: '20:31:00', counters: { denials: 3, boundaryEscapes: 0, hashMismatches: 0, budgetHard: 1, orphanPosts: 0, casualties: 1 }, findings: [], reconciled: true },
  buffer: [{ id: 'web-search-mcp', kind: 'mcp', state: 'quarantined' }],
};

function registerIpc(): void {
  const reads: Record<string, () => unknown> = {
    'gov:getCrew': () => DEV.crew, 'gov:getDecisions': () => DEV.decisions, 'gov:getAudit': () => DEV.audit,
    'gov:getTasks': () => DEV.tasks, 'gov:getServices': () => DEV.services, 'gov:getBudgets': () => DEV.budgets,
    'gov:getMonitor': () => DEV.monitor, 'gov:getBuffer': () => DEV.buffer,
  };
  for (const [ch, fn] of Object.entries(reads)) ipcMain.handle(ch, () => fn());
  ipcMain.handle('gov:requestAction', (_e, _req: ActionRequest): ActionResult =>
    ({ decision: { allow: false, ask: true, reason: 'human approval required (proposer != approver)' }, applied: false }));
  ipcMain.on('splash:enter', () => { win?.show(); splash?.close(); splash = null; });

  // ---- onboarding ----
  ipcMain.handle('onboarding:get', () => { const o = readOnb(); return { done: !!o.done, operator: o.operator, theme: o.theme }; });
  ipcMain.handle('onboarding:catalog', () => CATALOG);
  ipcMain.handle('onboarding:complete', (_e, input: { operator: string; theme: string; enabledIds: string[] }) => {
    let res = { registered: [] as string[], quarantined: [] as string[], approved: [] as string[], missing: [] as string[] };
    try {
      const packDir = process.env.STARFISH_SKILLS_PACK ?? join(root, 'skills');
      if (host && existsSync(packDir)) {
        // GOVERNED PATH: each consented default is vetted into the CapabilityLedger (no exemption).
        const out = governDefaults(packDir, host.governor.capabilities, { approve: input.enabledIds, catalog: CATALOG });
        res = { registered: out.registered, quarantined: out.quarantined, approved: out.approved, missing: out.missing ?? [] };
        host.persist();
      } else {
        // No skill sources present yet — nothing is registered (no source, no vet). Consent recorded for later govern.
        res.missing = CATALOG.map((s) => s.id);
      }
    } catch (err) { console.error('[onboarding] govern error:', (err as Error).message); }
    writeOnb({ done: true, operator: input.operator, theme: input.theme, consent: input.enabledIds });
    return res;
  });
}

app.whenReady().then(async () => {
  root = process.env.STARFISH_PROJECT_ROOT ?? join(process.cwd(), '.starfish');
  createSplash();
  registerIpc();
  await bootGovernance();
  if (host && host.governor.capabilities.snapshot().length === 0) {
    host.governor.capabilities.restore(registrySeed as never);  // vetted default skills (Low enabled, Medium+ quarantined)
    host.persist();
    console.log('[governance] seeded registry with', registrySeed.length, 'vetted default skills');
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { host?.stop(); if (process.platform !== 'darwin') app.quit(); });
