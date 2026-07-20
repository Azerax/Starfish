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
import { EvidenceWiki } from './wiki';
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
  tasks: TaskLedger; tokens: TokenGovernor; memory: GovernedMemory; wiki: EvidenceWiki; router: MessageRouter;
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
  const memory = new GovernedMemory(audit, policy, { soleWriter: 'herodotus' });
  const wiki = new EvidenceWiki(audit, policy, memory, { soleWriter: 'herodotus' });
  const router = new MessageRouter(audit, tasks, policy);
  const capabilities = new CapabilityLedger(audit);
  const monitor = new SecurityMonitor(auditPath, audit);
  const services = new ServiceRegistry(audit);
  const taskBinding = opts?.enforceTaskBinding ? { enforce: true, provider: tasks } : undefined;
  const integrity = opts?.skillsRoot ? fileIntegrityGate(capabilities, opts.skillsRoot) : undefined;
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), policy, taskBinding, integrity, undefined, opts?.secretGatekeeper ?? 'toby');
  for (const s of ['pdp', 'router', 'tasks', 'memory', 'wiki', 'capabilities', 'monitor', 'audit']) services.register(s, '0.8.0');
  const anchorer = opts?.anchor
    ? new Anchorer(makeAnchorAdapter({ backend: opts.anchor.backend ?? 'noop', filePath: opts.anchor.filePath }), { enabled: opts.anchor.enabled, everyNEvents: opts.anchor.everyNEvents }, audit)
    : new Anchorer(NoopAnchor, { enabled: false }, audit);   // OFF by default — zero overhead for personal use
  const g: Governor = { pdp, tools, agents, audit, tasks, tokens, memory, wiki, router, capabilities, monitor, services, anchorer, safeMode: false };
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

/** Sentinel returned when a state file exists but cannot be parsed. Distinct from `null` (absent) so
 *  the restore path can refuse it instead of mistaking corruption for a fresh install (T19). */
const UNREADABLE = Symbol.for('starfish.state.unreadable');

function readSnapshot(path: string): unknown {
  if (!existsSync(path)) return null;                       // absent — a normal fresh install
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return UNREADABLE; }                              // present but corrupt — must be loud
}

export function persistGovernor(g: Governor, stateDir: string): void {
  saveJson(join(stateDir, 'tasks.snapshot.json'), g.tasks.snapshot());
  saveJson(join(stateDir, 'capabilities.json'), g.capabilities.snapshot());
  saveJson(join(stateDir, 'services.json'), g.services.snapshot());
  saveJson(join(stateDir, 'memory.snapshot.json'), g.memory.snapshot());
  saveJson(join(stateDir, 'wiki.snapshot.json'), g.wiki.snapshot());
}
export function restoreGovernor(g: Governor, stateDir: string): void {
  g.tasks.restore(loadJson(join(stateDir, 'tasks.snapshot.json'), []));
  g.capabilities.restore(loadJson(join(stateDir, 'capabilities.json'), []));
  g.services.restore(loadJson(join(stateDir, 'services.json'), []));

  // Memory does NOT use loadJson. loadJson swallows a parse error and returns its fallback, so an
  // absent file and a corrupt one are indistinguishable to the caller — for memory that is a
  // censorship / tamper-DoS primitive (T19): truncate the file and knowledge silently comes back
  // EMPTY with no signal. Reading it directly keeps the three states apart: absent is a normal fresh
  // install, unparseable is degraded, and a hash mismatch is degraded.
  const mem = g.memory.restore(readSnapshot(join(stateDir, 'memory.snapshot.json')));
  const wiki = g.wiki.restore(readSnapshot(join(stateDir, 'wiki.snapshot.json')));
  for (const r of [mem, wiki]) {
    if (!r.degraded) continue;
    g.safeMode = true;
    g.pdp.setSafeMode(true, `memory state corrupt: ${r.reason}`);
    g.audit.append({
      actor: 'system', domain: 'governance', action: 'memory-state-corrupt',
      decision: 'deny', riskTier: 'critical', reason: r.reason,
    });
  }
}


/** Notarize the audit-to-date through the configured anchorer (best-effort; no-op when disabled). */
export async function anchorAudit(g: Governor, auditPath: string): Promise<AnchorReceipt> {
  const events: AuditEvent[] = existsSync(auditPath)
    ? parseAuditLines(readFileSync(auditPath, 'utf8')).events
    : [];
  return g.anchorer.anchor(events);
}
