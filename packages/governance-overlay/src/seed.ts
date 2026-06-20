// Single source of truth for the fail-closed governance seed + the base-root scaffold.
// Used by `starfish init` (CLI), the desktop wizard (host), and `npm run init:gov` so all three
// produce an identical, conforming, one-init-per-install layout. NEVER hand-copy these arrays again.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SeedTool { id: string; category: string; pathParams: string[]; allowedAgents: string | string[]; riskTier: string }
export interface SeedAgent { id: string; domain: string; allowedTools?: string[]; riskTier: string }
// PDP looks up policies as evaluate(`agent:<id>`|'*', `tool:<name>`, resource) — subjects MUST be
// 'agent:<id>' or '*', actions MUST be 'tool:<name>'. Bare names never match (silent no-op).
export interface SeedPolicy { id: string; subject: string; action: string; resource: string; effect: 'allow' | 'ask' | 'deny' }

export const GOVERNANCE_SEED: { tools: SeedTool[]; agents: SeedAgent[]; policies: SeedPolicy[] } = {
  tools: [
    { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.list', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
    { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker', 'pam'], riskTier: 'medium' },
    { id: 'fs.delete', category: 'write', pathParams: ['path'], allowedAgents: ['custodian'], riskTier: 'medium' },
    { id: 'git_commit', category: 'exec', pathParams: [], allowedAgents: ['worker'], riskTier: 'high' },
  ],
  agents: [
    { id: 'michael', domain: 'orchestration', riskTier: 'medium' },
    { id: 'dwight', domain: 'planning', allowedTools: ['fs.read'], riskTier: 'low' },
    { id: 'toby', domain: 'intake', allowedTools: ['fs.read'], riskTier: 'medium' },
    { id: 'hank', domain: 'monitor', allowedTools: ['fs.read'], riskTier: 'low' },
    { id: 'pam', domain: 'memory', allowedTools: ['fs.read', 'fs.write'], riskTier: 'low' },
    { id: 'custodian', domain: 'custodial', allowedTools: ['fs.read', 'fs.list', 'fs.delete'], riskTier: 'medium' },
    { id: 'worker', domain: 'execution', allowedTools: ['fs.read', 'fs.write', 'git_commit'], riskTier: 'high' },
  ],
  policies: [
    { id: 'p-read', subject: '*', action: 'tool:fs.read', resource: '*', effect: 'allow' },
    { id: 'p-delete', subject: 'agent:custodian', action: 'tool:fs.delete', resource: '*', effect: 'allow' },
    { id: 'p-commit', subject: 'agent:worker', action: 'tool:git_commit', resource: '*', effect: 'ask' },
  ],
};

export interface SeedOptions { operator?: string; theme?: string; by?: 'cli' | 'ui'; force?: boolean }
export interface SeedResult { ok: boolean; alreadyInitialized: boolean; baseRoot: string; reason: string }

export function lockPath(dir: string): string { return join(dir, '.starfish-init.lock'); }
export function isInitialized(dir: string): boolean { return existsSync(lockPath(dir)); }
export function readLock(dir: string): { by?: string; at?: string; baseRoot?: string } {
  try { return JSON.parse(readFileSync(lockPath(dir), 'utf8')); } catch { return {}; }
}

/**
 * Seed governance + the governed workspace tree at `dir` (the base root = absolute visibility ceiling),
 * then write the single-init lock. Refuses if already initialized unless `force`.
 *   <root>/governance/{tools,agents,policies}.json   state/   audit.jsonl   (above the agents, forbidden)
 *   <root>/tools/<tool>/tool.json   agents/<id>/{workspace,agent.json}   skills/   shared/{PROTOCOL,board,tasks}
 */
export function seedInstall(dir: string, opts: SeedOptions = {}): SeedResult {
  const { operator = 'Operator', theme = 'fleet', by = 'cli', force = false } = opts;
  if (isInitialized(dir) && !force) return { ok: false, alreadyInitialized: true, baseRoot: dir, reason: 'already initialized — one init per install' };

  const gov = join(dir, 'governance');
  mkdirSync(gov, { recursive: true });
  mkdirSync(join(dir, 'state'), { recursive: true });
  const auditPath = join(dir, 'audit.jsonl'); if (!existsSync(auditPath)) writeFileSync(auditPath, '');

  const { tools, agents, policies } = GOVERNANCE_SEED;
  writeFileSync(join(gov, 'tools.json'), JSON.stringify(tools, null, 2));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify(agents, null, 2));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify(policies, null, 2));

  for (const t of tools) {
    const td = join(dir, 'tools', t.id); mkdirSync(td, { recursive: true });
    const m = join(td, 'tool.json'); if (!existsSync(m)) writeFileSync(m, JSON.stringify({ id: t.id, category: t.category, riskTier: t.riskTier, builtin: true }, null, 2));
  }
  for (const a of agents) {
    mkdirSync(join(dir, 'agents', a.id, 'workspace'), { recursive: true });
    const m = join(dir, 'agents', a.id, 'agent.json'); if (!existsSync(m)) writeFileSync(m, JSON.stringify({ id: a.id, domain: a.domain, riskTier: a.riskTier }, null, 2));
  }
  mkdirSync(join(dir, 'skills'), { recursive: true });
  const shared = join(dir, 'shared'); mkdirSync(shared, { recursive: true });
  if (!existsSync(join(shared, 'PROTOCOL.md'))) writeFileSync(join(shared, 'PROTOCOL.md'), '# Shared protocol\n\nReadable by all crew. Governance, audit and state live above this and are invisible to agents.\n');
  if (!existsSync(join(shared, 'board.md'))) writeFileSync(join(shared, 'board.md'), '# Idea board\n');
  if (!existsSync(join(shared, 'tasks.json'))) writeFileSync(join(shared, 'tasks.json'), '[]\n');

  writeFileSync(join(dir, 'starfish.config.json'), JSON.stringify({ baseRoot: dir, installDir: dir, operator, theme, secretGatekeeper: 'toby', createdAt: new Date().toISOString() }, null, 2));
  writeFileSync(lockPath(dir), JSON.stringify({ by, at: new Date().toISOString(), baseRoot: dir }, null, 2));
  return { ok: true, alreadyInitialized: false, baseRoot: dir, reason: 'seeded' };
}

export interface OverlayResult { ok: boolean; alreadyInitialized: boolean; projectRoot: string; governanceHome: string; reason: string }

/**
 * Overlay seeding: govern an EXISTING project in place. Governance lives in <projectRoot>/.starfish/
 * (forbidden to the agent via the boundary `deny`), the project tree itself stays untouched (no
 * tools/agents/skills scatter — that is the desktop workspace model). Reuses the canonical seed.
 */
export function seedOverlay(projectRoot: string, opts: { operator?: string; theme?: string; force?: boolean } = {}): OverlayResult {
  const { operator = 'Operator', theme = 'fleet', force = false } = opts;
  const home = join(projectRoot, '.starfish');
  if (isInitialized(home) && !force) return { ok: false, alreadyInitialized: true, projectRoot, governanceHome: home, reason: 'already initialized — one init per install' };
  const gov = join(home, 'governance');
  mkdirSync(gov, { recursive: true }); mkdirSync(join(home, 'state'), { recursive: true });
  const auditPath = join(home, 'audit.jsonl'); if (!existsSync(auditPath)) writeFileSync(auditPath, '');
  const { tools, agents, policies } = GOVERNANCE_SEED;
  writeFileSync(join(gov, 'tools.json'), JSON.stringify(tools, null, 2));
  writeFileSync(join(gov, 'agents.json'), JSON.stringify(agents, null, 2));
  writeFileSync(join(gov, 'policies.json'), JSON.stringify(policies, null, 2));
  writeFileSync(join(home, 'starfish.config.json'), JSON.stringify({ mode: 'overlay', projectRoot, governanceHome: home, operator, theme, secretGatekeeper: 'toby', createdAt: new Date().toISOString() }, null, 2));
  writeFileSync(lockPath(home), JSON.stringify({ by: 'cli', mode: 'overlay', at: new Date().toISOString(), projectRoot }, null, 2));
  return { ok: true, alreadyInitialized: false, projectRoot, governanceHome: home, reason: 'seeded' };
}
