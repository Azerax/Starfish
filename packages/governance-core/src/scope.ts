// Scope Contract & non-deviation enforcement (Non-Deviation Enforcement plan; deterministic D1–D4).
// A per-task contract, derived at approval and NARROWER than the agent's general grants, that the
// PDP consults on every call so an agent stays on its approved mission. It is hash-sealed (immutable
// during execution) and amendable only via governed re-approval (proposer ≠ approver). D7 (objective
// drift) is semantic/advisory and lives in the monitor, not here — this module is purely deterministic.
import { resolve } from 'node:path';
import { GovernanceError, type ToolCall } from './types';
import { sameOrUnder } from './boundary';
import { sha256 } from './hash';
import { stampFiles, verifyStamps, type FileStamp, type AttestResult } from './attest';
import type { AuditLog } from './audit';

export type DeviationClass = 'D1-tool' | 'D2-path' | 'D3-command' | 'D4-budget';
export interface ScopeVerdict { ok: boolean; deviation?: DeviationClass; reason?: string; }

export interface ScopeContractInput {
  taskId: string;
  proposer: string;                 // who the contract binds (task proposer/assignee); cannot self-amend
  allowedTools: string[];           // subset of the agent's tools this task may use (D1)
  pathScope: string[];              // directory roots this task may touch (D2)
  allowedCommands?: string[];       // exact command strings this task may run (D3); absent = none permitted
  budget?: { calls?: number };      // max in-scope calls (D4)
  planHash?: string;                // binds the approved plan
}

export interface ScopeContract {
  taskId: string;
  proposer: string;
  allowedTools: string[];
  pathScope: string[];
  allowedCommands: string[];
  budget: { calls?: number };
  planHash: string;
  hash: string;                     // immutability seal over the fields above
  frozen: boolean;
  used: { calls: number };          // meter; advances as calls are admitted in-scope
  inputs: FileStamp[];              // H5: stamps of picked input files (runtime, not sealed) — TOCTOU guard
}

const COMMAND_KEYS = ['command', 'cmd', 'template', 'argv'];

// Canonical seal over the immutable fields (order-independent), so tamper or an unauthorized edit is detectable.
function seal(c: Pick<ScopeContract, 'taskId' | 'proposer' | 'allowedTools' | 'pathScope' | 'allowedCommands' | 'budget' | 'planHash'>): string {
  const canon = JSON.stringify({
    taskId: c.taskId,
    proposer: c.proposer,
    allowedTools: [...c.allowedTools].sort(),
    pathScope: [...c.pathScope].sort(),
    allowedCommands: [...c.allowedCommands].sort(),
    budget: c.budget ?? {},
    planHash: c.planHash,
  });
  return sha256(canon);
}

// Extract a command descriptor from a call's input, if any (string command/cmd/template, or argv[0]).
function commandOf(input: Record<string, unknown>): string | undefined {
  for (const k of COMMAND_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.length) return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return undefined;
}

export class ScopeContractLedger {
  private contracts = new Map<string, ScopeContract>();
  constructor(private audit: AuditLog, private approvers: Set<string> = new Set(['god', 'human'])) {}

  /** Derive (at approval) a sealed, frozen contract for a task. Idempotent per taskId would be surprising,
   *  so a second derive for the same task is refused — use amend() for governed changes. */
  derive(input: ScopeContractInput): ScopeContract {
    if (this.contracts.has(input.taskId)) throw new GovernanceError(`scope contract already exists for ${input.taskId} — use amend()`);
    const base = {
      taskId: input.taskId,
      proposer: input.proposer,
      allowedTools: [...input.allowedTools],
      pathScope: [...input.pathScope],
      allowedCommands: [...(input.allowedCommands ?? [])],
      budget: input.budget ?? {},
      planHash: input.planHash ?? '',
    };
    const c: ScopeContract = { ...base, hash: seal(base), frozen: true, used: { calls: 0 }, inputs: [] };
    this.contracts.set(c.taskId, c);
    this.audit.append({ actor: input.proposer, domain: 'task', action: 'scope:derive', target: c.taskId, decision: 'allow', reason: `tools=${c.allowedTools.length} paths=${c.pathScope.length} cmds=${c.allowedCommands.length}` });
    return c;
  }

  get(taskId: string): ScopeContract | undefined { return this.contracts.get(taskId); }

  /** H5 — stamp the input files this task picked; a later swap (cloud-sync/TOCTOU) is caught by verifyInputs. */
  stampInputs(taskId: string, paths: string[]): void {
    const c = this.contracts.get(taskId);
    if (c) { c.inputs = stampFiles(paths); this.audit.append({ actor: c.proposer, domain: 'task', action: 'scope:stamp-inputs', target: taskId, decision: 'allow', reason: `${c.inputs.length} file(s) stamped` }); }
  }
  /** Re-verify stamped inputs at time-of-use. A changed file → deviation (fail-closed). */
  verifyInputs(taskId: string): AttestResult {
    const c = this.contracts.get(taskId);
    if (!c) return { ok: false, changed: true, reason: 'no scope contract' };
    const r = verifyStamps(c.inputs);
    if (!r.ok) this.audit.append({ actor: c.proposer, domain: 'task', action: 'scope:input-deviation', target: taskId, decision: 'deny', riskTier: 'high', reason: r.reason });
    return r;
  }

  /** Verify a contract's seal still matches its fields — detects out-of-band tamper (attestation). */
  attest(taskId: string): ScopeVerdict {
    const c = this.contracts.get(taskId);
    if (!c) return { ok: false, reason: 'no-scope-contract' };
    const { hash, frozen, used, ...fields } = c;
    return seal(fields) === hash ? { ok: true } : { ok: false, reason: 'scope-contract-tampered' };
  }

  /** The deterministic non-deviation gate. Returns the FIRST deviation (D1→D3→D2→D4) or ok.
   *  On an ok verdict the call is metered against the budget (defined effect of admitting a call). */
  check(call: ToolCall, paths: string[]): ScopeVerdict {
    const c = call.taskId ? this.contracts.get(call.taskId) : undefined;
    if (!c) return { ok: false, deviation: 'D1-tool', reason: 'no-scope-contract (fail-closed)' };
    if (seal({ ...c }) !== c.hash) return { ok: false, reason: 'scope-contract-tampered' };

    // D1 — tool must be in the task's allowed set (narrower than the agent's general grants)
    if (!c.allowedTools.includes(call.tool)) return { ok: false, deviation: 'D1-tool', reason: `tool '${call.tool}' not in task scope` };

    // D3 — a command-bearing call must name a command the task is explicitly allowed to run
    const cmd = commandOf(call.input);
    if (cmd !== undefined && !c.allowedCommands.includes(cmd)) {
      return { ok: false, deviation: 'D3-command', reason: `command '${cmd}' not in task scope` };
    }

    // D2 — every path the call touches must fall within the task's pathScope
    for (const p of paths) {
      const inScope = c.pathScope.some((root) => sameOrUnder(resolve(p), resolve(root)));
      if (!inScope) return { ok: false, deviation: 'D2-path', reason: 'path outside task scope' };
    }

    // D4 — budget: refuse the call that would exceed the approved call ceiling, then meter it
    if (typeof c.budget.calls === 'number' && c.used.calls + 1 > c.budget.calls) {
      return { ok: false, deviation: 'D4-budget', reason: `call budget exhausted (${c.budget.calls})` };
    }
    c.used.calls += 1;
    return { ok: true };
  }

  /** Governed amendment: proposer ≠ approver, actor must be an approver. Re-seals with the new fields. */
  amend(taskId: string, patch: Partial<Pick<ScopeContractInput, 'allowedTools' | 'pathScope' | 'allowedCommands' | 'budget' | 'planHash'>>, actor: string): ScopeContract {
    const c = this.contracts.get(taskId);
    if (!c) throw new GovernanceError(`no scope contract for ${taskId}`);
    if (!this.approvers.has(actor)) {
      this.audit.append({ actor, domain: 'task', action: 'scope:amend', target: taskId, decision: 'deny', reason: 'not-an-approver' });
      throw new GovernanceError('only an approver may amend a scope contract');
    }
    if (actor === c.proposer) {
      this.audit.append({ actor, domain: 'task', action: 'scope:amend', target: taskId, decision: 'deny', reason: 'proposer-cannot-approve-own-amendment' });
      throw new GovernanceError('proposer cannot approve their own scope amendment');
    }
    if (patch.allowedTools) c.allowedTools = [...patch.allowedTools];
    if (patch.pathScope) c.pathScope = [...patch.pathScope];
    if (patch.allowedCommands) c.allowedCommands = [...patch.allowedCommands];
    if (patch.budget) c.budget = patch.budget;
    if (patch.planHash !== undefined) c.planHash = patch.planHash;
    c.hash = seal({ ...c });
    this.audit.append({ actor, domain: 'task', action: 'scope:amend', target: taskId, decision: 'allow', reason: `by ${actor}` });
    return c;
  }

  snapshot(): ScopeContract[] { return [...this.contracts.values()]; }
  restore(arr: ScopeContract[]): void { this.contracts = new Map(arr.map((c) => [c.taskId, c])); }
}
