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
import { ScopeIssuer, type ScopeMode } from './scopeissuer';
import { Anchorer, NoopAnchor, makeAnchorAdapter, type AnchorReceipt } from './anchor';
import { readFileSync, existsSync } from 'node:fs';
import type { AuditEvent } from './types';
import type { ToolDef, AgentDef } from './types';

// F0 (phase 1): the actual enforcement posture, recorded so it is never SILENT. An optional gate can
// legitimately be off, but "off" must be a visible, audited fact an operator can read — not an
// invisible absence that reads as "enforced".
//
// Every field here is DERIVED from the live wiring, never written as a literal. That rule exists
// because of F-10: `scopeNonDeviation: false` was hardcoded, which read as an honest disclosure
// while being unfalsifiable — the flag stayed false whatever the gate actually did.
export interface EnforcementPosture {
  integrity: boolean;            // verify-before-invoke wired (needs skillsRoot)
  taskBinding: boolean;          // "no task, no tool" wired
  scopeNonDeviation: boolean;    // D1–D4 scope contract enforcement wired (F-10: now actually wireable)
  scopeMode: ScopeMode;          // 'off' | 'contracted' | 'strict' — WHICH non-deviation policy is live
  strictAgentAllowlist: boolean; // Q4: an agent with no declared allowedTools is denied, not granted all
  selfIntegrity: boolean;        // operator-signed self-integrity manifest verified at boot
  secretGatekeeper: string;      // the identity that may write secret files
}

export interface Governor {
  pdp: PDP; tools: Registry<ToolDef>; agents: Registry<AgentDef>; audit: AuditLog;
  tasks: TaskLedger; tokens: TokenGovernor; memory: GovernedMemory; wiki: EvidenceWiki; router: MessageRouter;
  capabilities: CapabilityLedger; monitor: SecurityMonitor; services: ServiceRegistry; anchorer: Anchorer;
  scope: ScopeIssuer;            // F-10: the contract issuer; `scope.issue(...)` at task approval
  posture: EnforcementPosture; safeMode: boolean;
}

export function loadGovernor(governanceDir: string, auditPath: string, opts?: { enforceTaskBinding?: boolean; stateDir?: string; skillsRoot?: string; secretGatekeeper?: string; scopeMode?: ScopeMode; scopeCallBudget?: number; strictAgentAllowlist?: boolean; selfIntegrity?: { manifestPath: string; expectedPublicKeyPem: string; minEpoch?: number }; anchor?: { enabled: boolean; backend?: 'noop' | 'file'; filePath?: string; everyNEvents?: number } }): Governor {
  const tools = new Registry<ToolDef>(join(governanceDir, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(governanceDir, 'agents.json'), (a) => a.id);
  const policy = new PolicyEngine(loadPolicies(join(governanceDir, 'policies.json')));
  const audit = new AuditLog(auditPath);
  audit.append({ actor: 'system', domain: 'system', action: 'boot', reason: 'governance loaded; gate active' });
  // Q9: the boot append above exercises the anchor write. If it failed, tail truncation has silently
  // stopped being detectable — the chain still verifies, so nothing looks wrong. Surface it as a
  // finding rather than leaving it as a swallowed "best effort".
  if (audit.anchorDegraded) {
    audit.append({ actor: 'system', domain: 'failure', action: 'anchor-degraded', decision: 'deny', riskTier: 'high', reason: audit.anchorDegraded });
  }
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
  // F-10: non-deviation is finally WIRED. `scope.ts` was fully built and tested but unreachable
  // because nothing issued contracts, so switching the gate on would have denied everything.
  // ScopeIssuer supplies the missing half. Default mode 'contracted': a call that claims a taskId
  // must have a contract for it, a call with no taskId is out of scope for this control (see
  // scopeissuer.ts header). 'off' restores the pre-v0.27 behaviour exactly.
  const scope = new ScopeIssuer(audit, tools, agents, {
    mode: opts?.scopeMode ?? 'contracted',
    defaultCallBudget: opts?.scopeCallBudget,
  });
  const pdp = new PDP(tools, agents, audit, new RiskEngine(), policy, taskBinding, integrity, undefined, opts?.secretGatekeeper ?? 'toby', scope.binding());
  if (opts?.strictAgentAllowlist) pdp.setStrictAgentAllowlist(true);   // Q4
  for (const s of ['pdp', 'router', 'tasks', 'memory', 'wiki', 'capabilities', 'monitor', 'audit']) services.register(s, '0.8.0');
  const anchorer = opts?.anchor
    ? new Anchorer(makeAnchorAdapter({ backend: opts.anchor.backend ?? 'noop', filePath: opts.anchor.filePath }), { enabled: opts.anchor.enabled, everyNEvents: opts.anchor.everyNEvents }, audit)
    : new Anchorer(NoopAnchor, { enabled: false }, audit);   // OFF by default — zero overhead for personal use
  // F0 phase 1: record the ACTUAL enforcement posture and audit it, so an off gate is a visible fact.
  const posture: EnforcementPosture = {
    integrity: !!integrity,
    taskBinding: !!taskBinding,
    scopeNonDeviation: scope.enforce,  // F-10: derived from the live gate, never hardcoded again
    scopeMode: scope.getMode(),        // and WHICH policy, so 'on' is not mistaken for 'strict'
    strictAgentAllowlist: pdp.isStrictAgentAllowlist(),   // Q4: undeclared allowlist = deny, not grant
    selfIntegrity: !!opts?.selfIntegrity,
    secretGatekeeper: opts?.secretGatekeeper ?? 'toby',
  };
  audit.append({ actor: 'system', domain: 'governance', action: 'enforcement-posture', reason: 'active enforcement gates at boot', detail: { ...posture } });
  const g: Governor = { pdp, tools, agents, audit, tasks, tokens, memory, wiki, router, capabilities, monitor, services, anchorer, scope, posture, safeMode: false };
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
  // F-10: scope contracts must survive a restart. Without this an in-flight task comes back with no
  // contract and, under 'contracted' mode, every one of its calls is denied — the gate would look
  // broken rather than fail-safe. The seal is stored with the contract, so a hand-edited state file
  // is caught by `check()`'s tamper test rather than silently trusted.
  saveJson(join(stateDir, 'scope.contracts.json'), g.scope.snapshot());
}
export function restoreGovernor(g: Governor, stateDir: string): void {
  // F11: tasks/capabilities/services previously used loadJson(path, []), which returns the SAME empty
  // array for "absent" and "corrupt" — truncating capabilities.json silently erased every quarantined/
  // rejected disposition with no signal (the T19 censorship primitive). Read directly so a corrupt file
  // enters safe mode instead of coming back as a clean-looking empty store.
  const restoreArray = (file: string, restore: (a: unknown[]) => void, label: string): void => {
    const raw = readSnapshot(join(stateDir, file));
    if (raw === null) { restore([]); return; }                     // absent — normal fresh install
    if (typeof raw === 'symbol' || !Array.isArray(raw)) {          // corrupt / wrong shape — do NOT restore
      g.safeMode = true;
      g.pdp.setSafeMode(true, `state file corrupt: ${file}`);
      g.audit.append({ actor: 'system', domain: 'governance', action: 'state-corrupt', target: label, decision: 'deny', riskTier: 'critical', reason: `${file} present but unreadable/wrong-shape` });
      return;
    }
    restore(raw);
  };
  restoreArray('tasks.snapshot.json', (a) => g.tasks.restore(a as never), 'tasks');
  restoreArray('capabilities.json', (a) => g.capabilities.restore(a as never), 'capabilities');
  restoreArray('services.json', (a) => g.services.restore(a as never), 'services');
  restoreArray('scope.contracts.json', (a) => g.scope.restore(a as never), 'scope-contracts');

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
