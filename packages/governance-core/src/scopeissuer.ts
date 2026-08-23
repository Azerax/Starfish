// Scope contract ISSUER + gate policy — the missing half of non-deviation (adversarial finding F-10).
//
// WHY THIS FILE EXISTS
// `scope.ts` implemented the whole deterministic D1-D4 gate — sealed contracts, tamper detection,
// budget metering, 7 green tests — and shipped completely inert: `boot.ts` passed no `scopeGate` and
// hardcoded `posture.scopeNonDeviation = false`. It was correct code that nothing called, and the
// site claimed it as a live control for months.
//
// The reason it was never wired is real, not an oversight: `ScopeContractLedger.check()` fails closed
// when a task has no contract, so switching it on with no issuer would have denied every call in the
// system. Nothing ISSUED contracts. This module is that issuer, plus the gate policy that decides
// which calls the contract applies to.
//
// THE POLICY, AND WHY IT IS NOT A FUDGE
// A scope contract narrows *a task's* authority below the agent's standing grants. So:
//   * a call carrying a taskId    -> a contract MUST exist, or the call is denied (fail-closed).
//   * a call carrying NO taskId   -> there is no mission to deviate from; the gate does not apply,
//                                    and the agent's general grants + boundary + floors still do.
// That second line is a scope statement, not a loophole. "No task, no tool" is a DIFFERENT control
// (`enforceTaskBinding`, pdp.ts) that already exists and composes with this one. Conflating them
// would have made non-deviation impossible to enable without also mandating task binding everywhere.
// `strict: true` requires a taskId on every call, i.e. the composition, for deployments that want it.
import { ScopeContractLedger, type ScopeContract, type ScopeVerdict } from './scope';
import type { ToolCall, ToolDef, AgentDef, BoundarySet } from './types';
import type { Registry } from './registry';
import type { AuditLog } from './audit';

export type ScopeMode = 'off' | 'contracted' | 'strict';

export interface ScopeIssuerOptions {
  mode?: ScopeMode;                       // default 'contracted'
  defaultCallBudget?: number;             // D4 ceiling applied to auto-derived contracts (default: none)
  allowCommandsByDefault?: boolean;       // D3: auto-derived contracts permit no commands unless true
}

/** What a task needs to know to have a contract derived for it. */
export interface DerivationInput {
  taskId: string;
  proposer: string;
  agentId: string;                        // the assignee the contract binds
  boundary?: BoundarySet;                 // pathScope defaults to this agent's roots
  allowedTools?: string[];                // explicit override; otherwise derived from the agent def
  allowedCommands?: string[];
  budgetCalls?: number;
  planHash?: string;
}

/**
 * Derives sealed per-task scope contracts and answers the PDP's non-deviation question.
 *
 * Derivation is deterministic and uses only what governance already knows, so a contract can be
 * issued automatically at task approval without asking anyone to author one:
 *   D1 tools    - the agent's declared `allowedTools`, else every registered tool (you cannot narrow
 *                 what was never declared; the agent allowlist in the PDP still applies either way).
 *   D2 paths    - the agent's boundary roots (write + visibility).
 *   D3 commands - NONE unless explicitly supplied. This is the one place auto-derivation TIGHTENS
 *                 rather than mirrors: a task must name the commands it may run.
 *   D4 budget   - `defaultCallBudget` if configured, else unlimited.
 */
export class ScopeIssuer {
  readonly ledger: ScopeContractLedger;
  private mode: ScopeMode;
  private defaultCallBudget?: number;
  private allowCommandsByDefault: boolean;

  constructor(
    private audit: AuditLog,
    private tools: Registry<ToolDef>,
    private agents: Registry<AgentDef>,
    opts: ScopeIssuerOptions = {},
    approvers?: Set<string>,
  ) {
    this.ledger = new ScopeContractLedger(audit, approvers);
    this.mode = opts.mode ?? 'contracted';
    this.defaultCallBudget = opts.defaultCallBudget;
    this.allowCommandsByDefault = !!opts.allowCommandsByDefault;
  }

  getMode(): ScopeMode { return this.mode; }
  setMode(m: ScopeMode): void { this.mode = m; }
  /** True when the PDP should consult this gate at all. */
  get enforce(): boolean { return this.mode !== 'off'; }

  /** Derive a contract for a task. Idempotent: returns the existing one rather than throwing, so an
   *  approval replayed after a restart doesn't fail the task. */
  issue(input: DerivationInput): ScopeContract {
    const existing = this.ledger.get(input.taskId);
    if (existing) return existing;

    const agentDef = this.agents.get(input.agentId);
    const allowedTools = input.allowedTools
      ?? (agentDef?.allowedTools && agentDef.allowedTools.length > 0
        ? [...agentDef.allowedTools]
        : this.tools.all().map((t) => t.id));

    const pathScope = input.boundary
      ? [...new Set([...input.boundary.write, ...input.boundary.visibility])]
      : [];

    const allowedCommands = input.allowedCommands
      ?? (this.allowCommandsByDefault ? undefined : []);

    const budget = input.budgetCalls !== undefined
      ? { calls: input.budgetCalls }
      : (this.defaultCallBudget !== undefined ? { calls: this.defaultCallBudget } : {});

    return this.ledger.derive({
      taskId: input.taskId,
      proposer: input.proposer,
      allowedTools,
      pathScope,
      allowedCommands,
      budget,
      planHash: input.planHash,
    });
  }

  /**
   * The gate the PDP consults. Implements the applicability policy described at the top of this file;
   * every actual D1-D4 adjudication is delegated unchanged to `ScopeContractLedger.check()`.
   */
  check(call: ToolCall, paths: string[]): ScopeVerdict {
    if (this.mode === 'off') return { ok: true };

    if (!call.taskId) {
      if (this.mode === 'strict') {
        return { ok: false, deviation: 'D1-tool', reason: 'strict scope mode: every call must carry a taskId' };
      }
      return { ok: true };            // no mission -> nothing to deviate from (see header)
    }

    // A call that CLAIMS a task must have a contract for it. This is the fail-closed edge that made
    // the module un-shippable without an issuer, and it is correct now that one exists.
    if (!this.ledger.get(call.taskId)) {
      return { ok: false, deviation: 'D1-tool', reason: `no scope contract for task ${call.taskId} (fail-closed)` };
    }
    return this.ledger.check(call, paths);
  }

  /** The binding shape `PDP` expects. */
  binding(): { enforce: boolean; provider: { check(call: ToolCall, paths: string[]): ScopeVerdict } } {
    return { enforce: this.enforce, provider: { check: (c, p) => this.check(c, p) } };
  }

  snapshot(): ScopeContract[] { return this.ledger.snapshot(); }
  restore(arr: ScopeContract[]): void { this.ledger.restore(arr); }
}
