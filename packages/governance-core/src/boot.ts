// Fail-closed boot (R&C S-9 / T-26). Governance loads FIRST; missing/corrupt required registry -> throw.
import { join } from 'node:path';
import { Registry } from './registry';
import { AuditLog } from './audit';
import { PDP } from './pdp';
import { RiskEngine } from './risk';
import { PolicyEngine, loadPolicies } from './policy';
import { TaskLedger } from './tasks';
import { TokenGovernor } from './tokens';
import type { ToolDef, AgentDef } from './types';

export interface Governor {
  pdp: PDP;
  tools: Registry<ToolDef>;
  agents: Registry<AgentDef>;
  audit: AuditLog;
  tasks: TaskLedger;
  tokens: TokenGovernor;
  safeMode: boolean;
}

export function loadGovernor(governanceDir: string, auditPath: string, opts?: { enforceTaskBinding?: boolean }): Governor {
  const tools = new Registry<ToolDef>(join(governanceDir, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(governanceDir, 'agents.json'), (a) => a.id);
  const policy = new PolicyEngine(loadPolicies(join(governanceDir, 'policies.json')));
  const audit = new AuditLog(auditPath);
  audit.append({ actor: 'system', domain: 'system', action: 'boot', reason: 'governance loaded; gate active' });
  const tasks = new TaskLedger(audit);
  const tokens = new TokenGovernor(audit);
  const taskBinding = opts?.enforceTaskBinding ? { enforce: true, provider: tasks } : undefined;
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), policy, taskBinding);
  return { pdp, tools, agents, audit, tasks, tokens, safeMode: false };
}
