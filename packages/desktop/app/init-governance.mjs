// Seeds a minimal governance config so the fail-closed boot succeeds in dev.
// Human-authored governance (legitimate Layer-7 action). Writes ./.starfish/governance/*.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '.starfish', 'governance');
mkdirSync(dir, { recursive: true });

const tools = [
  { id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
  { id: 'fs.list', category: 'read', pathParams: ['path'], allowedAgents: '*', riskTier: 'low' },
  { id: 'fs.write', category: 'write', pathParams: ['path'], allowedAgents: ['worker', 'pam'], riskTier: 'medium' },
  { id: 'git_commit', category: 'exec', pathParams: [], allowedAgents: ['worker'], riskTier: 'high' },
];
const agents = [
  { id: 'michael', domain: 'orchestration', riskTier: 'medium' },
  { id: 'dwight', domain: 'planning', allowedTools: ['fs.read'], riskTier: 'low' },
  { id: 'toby', domain: 'intake', allowedTools: ['fs.read'], riskTier: 'medium' },
  { id: 'hank', domain: 'monitor', allowedTools: ['fs.read'], riskTier: 'low' },
  { id: 'pam', domain: 'memory', allowedTools: ['fs.read', 'fs.write'], riskTier: 'low' },
  { id: 'worker', domain: 'execution', allowedTools: ['fs.read', 'fs.write', 'git_commit'], riskTier: 'high' },
];
const policies = [
  { id: 'p-read', subject: '*', action: 'fs.read', resource: '*', effect: 'allow' },
  { id: 'p-commit', subject: 'worker', action: 'git_commit', resource: '*', effect: 'ask' },
];

writeFileSync(join(dir, 'tools.json'), JSON.stringify(tools, null, 2));
writeFileSync(join(dir, 'agents.json'), JSON.stringify(agents, null, 2));
writeFileSync(join(dir, 'policies.json'), JSON.stringify(policies, null, 2));
console.log('Seeded governance at', dir);
