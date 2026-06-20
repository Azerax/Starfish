// Electron main — ring-3 host. Boots governance FIRST (fail-closed), shows the splash, and on
// first run presents the OnboardingWizard whose intake routes through governDefaults
// (vet -> CapabilityLedger). Nothing is registered except via that governed path.
import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHost, type Host, realFsProbe, TrashStore, governedCustodianDelete,
  crewView, agentDetail, decisionLog, pendingAsView, budgetView, monitorView, bufferView, serviceView } from '@starfish/desktop';
import { homedir } from 'node:os';
import type { ActionRequest, ActionResult } from '@starfish/desktop';
import { governDefaults } from '@starfish/governance-overlay';
import { ProviderRegistry, AVAILABLE_PROVIDERS, ModelRouter, Dispatcher, HostRunner, assessDeletion, DecisionBroker, type KeyResolver, type DeletionConfig, type BoundarySet } from '@starfish/governance-core';
import defaultSkillsJson from '../../../../governance-overlay/defaults/default-skills.json';
import registrySeed from '../../../../governance-overlay/defaults/registry-seed.json';

const HERE = dirname(fileURLToPath(import.meta.url));
let root = '';
let host: Host | undefined;
let broker: DecisionBroker | undefined;
// Paths an agent may never see/write — kept in sync with createHost's forbid list.
const forbidList = (): string[] => [join(root, 'governance'), join(root, 'audit.jsonl'), join(root, 'state')];
// Base root resolution order: --starfish-dir <path> (passed by `starfish init` launch) > env > cwd/.starfish.
function resolveBaseRoot(): string {
  const a = process.argv;
  const i = a.indexOf('--starfish-dir');
  if (i >= 0 && a[i + 1] && !a[i + 1].startsWith('--')) return a[i + 1];
  const eq = a.find((x) => x.startsWith('--starfish-dir='));
  if (eq) return eq.split('=').slice(1).join('=');
  return process.env.STARFISH_PROJECT_ROOT ?? join(process.cwd(), '.starfish');
}
let splash: BrowserWindow | null = null;
let win: BrowserWindow | null = null;
const providerReg = new ProviderRegistry(AVAILABLE_PROVIDERS, 'anthropic');

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
    // Human-in-the-loop seam: a quarantined capability is a real 'needs operator' item — surface each.
    broker = new DecisionBroker(host.governor.audit, join(root, 'state', 'decisions.json'));
    for (const c of host.governor.capabilities.snapshot()) {
      if (c.status === 'quarantined') broker.file({ actor: 'toby', kind: 'capability', tool: 'capability:vet', target: c.id, refId: c.id, riskTier: c.riskTier, reason: `${c.kind} quarantined (tier=${c.riskTier}) — operator consent required` });
    }
  } catch (err) {
    console.error('[governance] fail-closed boot error (run `npm run init:gov`):', (err as Error).message);
  }
}

// ---- single-init-per-install lock. Whichever path (CLI `starfish init` OR the desktop wizard) seeds
// the base root first writes this; the other refuses to re-init. ----
function lockFile(dir: string): string { return join(dir, '.starfish-init.lock'); }
function isInitialized(dir: string): boolean { return existsSync(lockFile(dir)); }
function readLock(dir: string): { by?: string; at?: string; baseRoot?: string } { try { return JSON.parse(readFileSync(lockFile(dir), 'utf8')); } catch { return {}; } }

// Seed governance + the governed workspace tree at `dir` (the base root = absolute visibility ceiling),
// then write the init lock. Mirrors `starfish init` so the two setups produce identical installs.
function seedGovernanceAt(dir: string, operator: string, theme: string, by: 'cli' | 'ui'): void {
  const gov = join(dir, 'governance');
  mkdirSync(gov, { recursive: true }); mkdirSync(join(dir, 'state'), { recursive: true });
  const auditPath = join(dir, 'audit.jsonl'); if (!existsSync(auditPath)) writeFileSync(auditPath, '');
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
  for (const t of tools) { const td = join(dir, 'tools', t.id); mkdirSync(td, { recursive: true }); const m = join(td, 'tool.json'); if (!existsSync(m)) writeFileSync(m, JSON.stringify({ id: t.id, category: t.category, riskTier: t.riskTier, builtin: true }, null, 2)); }
  for (const a of agents) { mkdirSync(join(dir, 'agents', a.id, 'workspace'), { recursive: true }); const m = join(dir, 'agents', a.id, 'agent.json'); if (!existsSync(m)) writeFileSync(m, JSON.stringify({ id: a.id, domain: a.domain, riskTier: a.riskTier }, null, 2)); }
  mkdirSync(join(dir, 'skills'), { recursive: true });
  const shared = join(dir, 'shared'); mkdirSync(shared, { recursive: true });
  if (!existsSync(join(shared, 'PROTOCOL.md'))) writeFileSync(join(shared, 'PROTOCOL.md'), '# Shared protocol\n');
  if (!existsSync(join(shared, 'board.md'))) writeFileSync(join(shared, 'board.md'), '# Idea board\n');
  if (!existsSync(join(shared, 'tasks.json'))) writeFileSync(join(shared, 'tasks.json'), '[]\n');
  writeFileSync(join(dir, 'starfish.config.json'), JSON.stringify({ baseRoot: dir, installDir: dir, operator, theme, secretGatekeeper: 'toby', createdAt: new Date().toISOString() }, null, 2));
  writeFileSync(lockFile(dir), JSON.stringify({ by, at: new Date().toISOString(), baseRoot: dir }, null, 2));   // single-init lock
}

// Re-point the running host at a new base root (used by the desktop base-root step). Boots governance
// there, restoring the vetted default registry on first boot — same as the cold-start path.
async function rebootAt(dir: string): Promise<void> {
  try { host?.stop(); } catch { /* ignore */ }
  host = undefined; root = dir;
  await bootGovernance();
  if (host && host.governor.capabilities.snapshot().length === 0) {
    host.governor.capabilities.restore(registrySeed as never);
    host.persist();
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
  // ---- LIVE read path: every view is projected from the booted Governor (DEV is the pre-boot fallback). ----
  const G = () => host?.governor;
  ipcMain.handle('gov:getCrew', () => { const g = G(); return g ? crewView(g) : DEV.crew; });
  ipcMain.handle('gov:getDecisions', (_e, limit?: number) => {
    const g = G(); if (!g) return DEV.decisions;
    const asks = broker ? pendingAsView(broker.list()) : [];            // STABLE operator queue (front)
    return [...asks, ...decisionLog(g, limit ?? 12)].slice(0, Math.max(limit ?? 12, asks.length));
  });
  ipcMain.handle('gov:getAudit', (_e, sinceSeq?: number) => { const g = G(); return g ? g.audit.recent(200, sinceSeq) : DEV.audit; });
  ipcMain.handle('gov:getTasks', () => { const g = G(); return g ? g.tasks.all() : DEV.tasks; });
  ipcMain.handle('gov:getServices', () => { const g = G(); return g ? serviceView(g) : DEV.services; });
  ipcMain.handle('gov:getBudgets', () => { const g = G(); return g ? budgetView(g) : DEV.budgets; });
  ipcMain.handle('gov:getMonitor', () => { const g = G(); return g ? monitorView(g) : DEV.monitor; });
  ipcMain.handle('gov:getBuffer', () => { const g = G(); return g ? bufferView(g) : DEV.buffer; });
  ipcMain.handle('gov:getAgentDetail', (_e, id: string) => { const g = G(); return g ? agentDetail(g, id, root, forbidList()) : null; });

  // ---- LIVE action path: operator intents adjudicated against the broker / token governor. Nothing
  // mutates governance state except through here, and proposer != approver is enforced in the broker. ----
  ipcMain.handle('gov:requestAction', (_e, req: ActionRequest): ActionResult => {
    const g = G();
    const intent = (req?.intent ?? {}) as { kind?: string; decisionId?: string; agentId?: string };
    const by = req?.actor || 'operator';
    if (!g || !broker) return { decision: { allow: false, ask: true, reason: 'governance not booted' }, applied: false };

    if ((intent.kind === 'approve' || intent.kind === 'deny') && intent.decisionId) {
      const d = broker.get(intent.decisionId);
      const r = broker.resolve(intent.decisionId, intent.kind === 'approve' ? 'approve' : 'deny', by);
      if (r.ok && intent.kind === 'approve' && d?.kind === 'capability' && d.refId) g.capabilities.approve(d.refId, by);  // side-effect: enable the consented capability
      return { decision: { allow: r.ok && intent.kind === 'approve', ask: false, reason: r.reason }, applied: r.ok };
    }
    if (intent.kind === 'resume' && intent.agentId) {
      g.tokens.resume(intent.agentId, by);
      return { decision: { allow: true, ask: false, reason: `resumed ${intent.agentId}` }, applied: true };
    }
    // Unknown / not-yet-wired intents (e.g. dispatch orders — Phase 3) stay fail-closed.
    return { decision: { allow: false, ask: true, reason: 'not yet wired (requires Phase 3 dispatch)' }, applied: false };
  });
  ipcMain.on('splash:enter', () => { win?.show(); splash?.close(); splash = null; });

  // ---- base root (visibility ceiling) + single-init lock. Mirrors `starfish init`; only one init
  // per install — if the CLI already initialized this root, the wizard step is locked (and vice versa). ----
  ipcMain.handle('setup:getBaseRoot', () => ({ root, locked: isInitialized(root), lockedBy: readLock(root).by, suggested: join(homedir(), 'Starfish') }));
  ipcMain.handle('setup:pickDir', async () => {
    const r = await dialog.showOpenDialog(win ?? undefined as never, { title: 'Choose the Starfish base root (the top Starfish can see)', defaultPath: join(homedir(), 'Starfish'), properties: ['openDirectory', 'createDirectory'] });
    return { path: r.canceled || !r.filePaths[0] ? null : r.filePaths[0] };
  });
  ipcMain.handle('setup:setBaseRoot', async (_e, { dir, operator, theme }: { dir: string; operator?: string; theme?: string }) => {
    const target = (dir || '').trim() || join(homedir(), 'Starfish');
    if (isInitialized(target)) { const l = readLock(target); return { ok: false, root: target, reason: `already initialized by ${l.by ?? 'another setup'} on ${l.at ?? 'a prior run'} — one init per install` }; }
    try { mkdirSync(target, { recursive: true }); seedGovernanceAt(target, operator || 'Operator', theme || 'fleet', 'ui'); await rebootAt(target); return { ok: true, root: target, reason: 'seeded + booted' }; }
    catch (e) { return { ok: false, root: target, reason: (e as Error).message }; }
  });

  // ---- providers (model selection + API key). Key stored via OS keychain; never returned. ----
  const secFile = () => join(root, 'state', 'secrets.json');
  const provFile = () => join(root, 'state', 'providers.json');
  const readJson = <T,>(p: string, fb: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fb; } };
  const writeJsonSafe = (p: string, o: unknown) => { try { mkdirSync(join(root, 'state'), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); } catch (e) { console.error('[providers] persist:', (e as Error).message); } };

  ipcMain.handle('provider:list', () => {
    const sec = readJson<Record<string, unknown>>(secFile(), {});
    return providerReg.list().map((p) => ({ id: p.id, name: p.name, kind: p.kind, model: p.model, baseUrl: p.baseUrl, requiresKey: p.requiresKey, hasKey: !!sec[p.id], dataEgress: p.kind === 'router' }));
  });
  ipcMain.handle('provider:active', () => {
    const a = providerReg.active();
    const pj = readJson<{ activeId?: string; model?: string }>(provFile(), {});
    return { id: pj.activeId ?? a.id, model: pj.model ?? a.model };
  });
  ipcMain.handle('provider:setActive', (_e, { id, model }: { id: string; model?: string }) => {
    try { const p = providerReg.setActive(id); writeJsonSafe(provFile(), { activeId: id, model: model ?? p.model });
      host?.governor.audit.append({ actor: 'operator', domain: 'governance', action: 'provider:set-active', target: id, decision: 'allow', reason: `model=${model ?? p.model}` });
      return { ok: true }; } catch { return { ok: false }; }
  });
  ipcMain.handle('provider:setKey', (_e, { id, key }: { id: string; key: string }) => {
    const sec = readJson<Record<string, unknown>>(secFile(), {});
    let stored: 'keychain' | 'fallback' = 'fallback';
    try {
      if (safeStorage.isEncryptionAvailable()) { sec[id] = { enc: safeStorage.encryptString(key).toString('base64') }; stored = 'keychain'; }
      else { sec[id] = { b64: Buffer.from(key, 'utf8').toString('base64') }; }   // dev fallback
    } catch { sec[id] = { b64: Buffer.from(key, 'utf8').toString('base64') }; }
    writeJsonSafe(secFile(), sec);
    host?.governor.audit.append({ actor: 'operator', domain: 'governance', action: 'provider:key-set', target: id, decision: 'allow', reason: `stored via ${stored} (key never logged)` });
    return { ok: true, stored };
  });

  // ---- host key resolver: decrypt the stored key on demand (mirrors provider:setKey). The key is
  // handed straight to the runner's network call and never returned to the renderer or audited. ----
  const resolveProviderKey: KeyResolver = (id) => {
    const sec = readJson<Record<string, { enc?: string; b64?: string }>>(secFile(), {});
    const e = sec[id]; if (!e) return undefined;
    try {
      if (e.enc) return safeStorage.decryptString(Buffer.from(e.enc, 'base64'));
      if (e.b64) return Buffer.from(e.b64, 'base64').toString('utf8');
    } catch { return undefined; }
    return undefined;
  };

  // Runtime factory — wires router -> dispatcher -> runner with the live governor's audit + token
  // governor. The agent-run loop (when built) calls dispatcher.plan(task) then runner.run(plan).
  // OpenRouter (data-egress) stays opt-in via STARFISH_ALLOW_EGRESS.
  const buildRuntime = () => {
    if (!host) throw new Error('governance not booted');
    const router = new ModelRouter(undefined, host.governor.audit);
    const dispatcher = new Dispatcher({ providers: providerReg, router, tokens: host.governor.tokens, audit: host.governor.audit });
    const runner = new HostRunner({ tokens: host.governor.tokens, keyResolver: resolveProviderKey, allowEgress: process.env.STARFISH_ALLOW_EGRESS === '1', audit: host.governor.audit });
    return { dispatcher, runner };
  };
  void buildRuntime;   // exposed for the agent-run loop; referenced to satisfy lint until then

  // ---- governed deletion: the app's ONLY delete path. Soft (recoverable trash), hard-rule-gated,
  // Custodian-only. Hard rules (no system files / no skills / no folders) are enforced in the core gate. ----
  const delCfg = (): DeletionConfig => ({ projectRoot: root, homeDir: homedir(), skillsRoot: join(root, 'skills') });
  const custodianBoundary: BoundarySet = { visibility: [root], write: [root] };   // cleanup scope = the project tree
  const trashDir = () => join(root, 'state', 'trash');
  let trash: TrashStore | null = null;
  const store = () => (trash ??= new TrashStore(trashDir()));
  const impactView = (i: ReturnType<typeof assessDeletion>) => ({ tier: i.tier, decision: i.decision, hard: i.hard, reversible: i.reversible, files: i.files, bytes: i.bytes, reasons: i.reasons });

  ipcMain.handle('delete:assess', (_e, { path, recursive }: { path: string; recursive?: boolean }) =>
    impactView(assessDeletion({ path, recursive }, delCfg(), realFsProbe(), custodianBoundary)));

  ipcMain.handle('delete:file', (_e, { path, recursive, approved }: { path: string; recursive?: boolean; approved?: boolean }) => {
    if (!host) return { ok: false, reason: 'governance not booted', impact: impactView(assessDeletion({ path }, delCfg(), realFsProbe(), custodianBoundary)) };
    const r = governedCustodianDelete(host.governor.pdp, { agentId: 'custodian', tool: 'fs.delete', input: { path, recursive: !!recursive } }, custodianBoundary,
      { cfg: delCfg(), store: store(), trashDir: trashDir(), audit: host.governor.audit, approved: !!approved });
    return { ok: r.ok, reason: r.reason, impact: impactView(r.impact), trashedTo: r.trashedTo };
  });

  ipcMain.handle('delete:trash:list', () => store().list());
  ipcMain.handle('delete:trash:restore', (_e, { id }: { id: string }) => store().restore(id));
  ipcMain.handle('delete:trash:purge', (_e, { id, confirm }: { id: string; confirm: boolean }) => {
    if (confirm !== true) return { ok: false };   // permanent — explicit operator confirmation required
    host?.governor.audit.append({ actor: 'operator', domain: 'governance', action: 'trash-purge', target: id, decision: 'allow', reason: 'permanent removal confirmed by operator' });
    return { ok: store().purge(id) };
  });

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
  root = resolveBaseRoot();
  console.log('[governance] base root (visibility ceiling):', root);
  createSplash();
  registerIpc();
  await bootGovernance();
  try { const pj = JSON.parse(readFileSync(join(root, 'state', 'providers.json'), 'utf8')); if (pj.activeId) providerReg.setActive(pj.activeId); } catch { /* default anthropic */ }
  if (host && host.governor.capabilities.snapshot().length === 0) {
    host.governor.capabilities.restore(registrySeed as never);  // vetted default skills (Low enabled, Medium+ quarantined)
    host.persist();
    console.log('[governance] seeded registry with', registrySeed.length, 'vetted default skills');
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { host?.stop(); if (process.platform !== 'darwin') app.quit(); });
