// Fail-closed boot (R&C S-9 / T-26). Governance loads FIRST; missing/corrupt required registry -> throw.
// Composes the full governed system into one Governor.
import { join } from 'node:path';
import { Registry } from './registry';
import { AuditLog } from './audit';
import { PDP } from './pdp';
import { RiskEngine } from './risk';
import { PolicyEngine, loadPolicies } from './policy';
import { TaskLedger } from './tasks';
import { TokenGovernor } from './tokens';
import { GovernedMemory } from './memory';
import { MessageRouter } from './messaging';
import { CapabilityLedger } from './vetting';
import { SecurityMonitor } from './monitor';
import type { ToolDef, AgentDef } from './types';

export interface Governor {
  pdp: PDP;
  tools: Registry<ToolDef>;
  agents: Registry<AgentDef>;
  audit: AuditLog;
  tasks: TaskLedger;
  tokens: TokenGovernor;
  memory: GovernedMemory;
  router: MessageRouter;
  capabilities: CapabilityLedger;
  monitor: SecurityMonitor;
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
  const memory = new GovernedMemory(audit, policy);
  const router = new MessageRouter(audit, tasks, policy);
  const capabilities = new CapabilityLedger(audit);
  const monitor = new SecurityMonitor(auditPath, audit);
  const taskBinding = opts?.enforceTaskBinding ? { enforce: true, provider: tasks } : undefined;
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), policy, taskBinding);
  return { pdp, tools, agents, audit, tasks, tokens, memory, router, capabilities, monitor, safeMode: false };
}
