// Fail-closed boot (R&C S-9 / T-26). Governance loads FIRST; missing/corrupt required registry -> throw.
// Composes the full governed system into one Governor, registers subsystems as services, and
// (optionally) restores persisted runtime state. When `skillsRoot` is given, the PDP gets a
// verify-before-invoke integrity gate over <skillsRoot>/<id>/source.
import { join } from 'node:path';
import { Registry } from './registry';
import { AuditLog, parseAuditLines } from './audit';
import { PDP } from './pdp';
import { RiskEngine } from './risk';
import { PolicyEngine, loadPolicies } from './policy';
import { TaskLedger } from './tasks';
import { TokenGovernor } from './tokens';
import { GovernedMemory } from './memory';
import { MessageRouter } from './messaging';
import { CapabilityLedger } from './vetting';
import { SecurityMonitor } from './monitor';
import { ServiceRegistry } from './services';
import { fileIntegrityGate } from './integrity';
import { saveJson, loadJson } from './persistence';
import { verifySelfIntegrity } from './selfintegrity';
import { Anchorer, NoopAnchor, makeAnchorAdapter, type AnchorReceipt } from './anchor';
import { readFileSync, existsSync } from 'node:fs';
import type { AuditEvent } from './types';
import type { ToolDef, AgentDef } from './types';

export interface Governor {
  pdp: PDP; tools: Registry<ToolDef>; agents: Registry<AgentDef>; audit: AuditLog;
  tasks: TaskLedger; tokens: TokenGovernor; memory: GovernedMemory; router: MessageRouter;
  capabilities: CapabilityLedger; monitor: SecurityMonitor; services: ServiceRegistry; anchorer: Anchorer; safeMode: boolean;
}

export function loadGovernor(governanceDir: string, auditPath: string, opts?: { enforceTaskBinding?: boolean; stateDir?: string; skillsRoot?: string; secretGatekeeper?: string; selfIntegrity?: { manifestPath: string; expectedPublicKeyPem: string; minEpoch?: number }; anchor?: { enabled: boolean; backend?: 'noop' | 'file'; filePath?: string; everyNEvents?: number } }): Governor {
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
  const services = new ServiceRegistry(audit);
  const taskBinding = opts?.enforceTaskBinding ? { enforce: true, provider: tasks } : undefined;
  const integrity = opts?.skillsRoot ? fileIntegrityGate(capabilities, opts.skillsRoot) : undefined;
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), policy, taskBinding, integrity, undefined, opts?.secretGatekeeper ?? 'toby');
  for (const s of ['pdp', 'router', 'tasks', 'memory', 'capabilities', 'monitor', 'audit']) services.register(s, '0.8.0');
  const anchorer = opts?.anchor
    ? new Anchorer(makeAnchorAdapter({ backend: opts.anchor.backend ?? 'noop', filePath: opts.anchor.filePath }), { enabled: opts.anchor.enabled, everyNEvents: opts.anchor.everyNEvents }, audit)
    : new Anchorer(NoopAnchor, { enabled: false }, audit);   // OFF by default — zero overhead for personal use
  const g: Governor = { pdp, tools, agents, audit, tasks, tokens, memory, router, capabilities, monitor, services, anchorer, safeMode: false };
  // A16/A17: a torn/corrupt/truncated audit is a deliberate safe-mode, not a crash.
  if (!audit.integrity.ok) {
    g.safeMode = true;
    pdp.setSafeMode(true, audit.integrity.reason);
    audit.append({ actor: 'system', domain: 'governance', action: 'audit-integrity-fail', decision: 'deny', riskTier: 'critical', reason: audit.integrity.reason });
    audit.append({ actor: 'system', domain: 'system', action: 'boot-attestation', decision: 'deny', reason: `SAFE MODE — audit integrity: ${audit.integrity.reason}` });
  }
  if (opts?.stateDir) restoreGovernor(g, opts.stateDir);

  // Self-integrity: verify the operator-signed manifest over our OWN config/state/audit. Any tamper,
  // rollback, or audit truncation -> enter safe mode (PDP denies everything until the operator re-attests).
  if (opts?.selfIntegrity) {
    const r = verifySelfIntegrity({ governanceDir, stateDir: opts.stateDir, manifestPath: opts.selfIntegrity.manifestPath, expectedPublicKeyPem: opts.selfIntegrity.expectedPublicKeyPem, audit, minEpoch: opts.selfIntegrity.minEpoch });
    if (!r.ok) {
      g.safeMode = true;
      pdp.setSafeMode(true, r.reason);
      audit.append({ actor: 'system', domain: 'governance', action: 'self-integrity-fail', decision: 'deny', riskTier: 'critical', reason: r.reason, detail: { failures: r.failures } });
      audit.append({ actor: 'system', domain: 'system', action: 'boot-attestation', decision: 'deny', reason: 'SAFE MODE — self-integrity failed; all actions denied until operator re-attests' });
    } else {
      audit.append({ actor: 'system', domain: 'system', action: 'boot-attestation', decision: 'allow', reason: `self-integrity verified (operator-signed, epoch ${r.epoch})` });
    }
  }
  return g;
}

export function persistGovernor(g: Governor, stateDir: string): void {
  saveJson(join(stateDir, 'tasks.snapshot.json'), g.tasks.snapshot());
  saveJson(join(stateDir, 'capabilities.json'), g.capabilities.snapshot());
  saveJson(join(stateDir, 'services.json'), g.services.snapshot());
}
export function restoreGovernor(g: Governor, stateDir: string): void {
  g.tasks.restore(loadJson(join(stateDir, 'tasks.snapshot.json'), []));
  g.capabilities.restore(loadJson(join(stateDir, 'capabilities.json'), []));
  g.services.restore(loadJson(join(stateDir, 'services.json'), []));
}


/** Notarize the audit-to-date through the configured anchorer (best-effort; no-op when disabled). */
export async function anchorAudit(g: Governor, auditPath: string): Promise<AnchorReceipt> {
  const events: AuditEvent[] = existsSync(auditPath)
    ? parseAuditLines(readFileSync(auditPath, 'utf8')).events
    : [];
  return g.anchorer.anchor(events);
}
