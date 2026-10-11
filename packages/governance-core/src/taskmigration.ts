// Task-binding migration telemetry (ring 1).
//
// `ToolCall.taskId` is optional for backward compatibility and is slated to become required
// (GOVERNANCE.md principle 2 — all work is a task). This module exists so that flipping the
// default is an EVIDENCED decision rather than a hopeful one.
//
// The trap this is built to avoid is F-10, recorded in boot.ts:30-35: `scopeNonDeviation: false`
// was hardcoded, which "read as an honest disclosure while being unfalsifiable". The same trap is
// available here in a nastier form — a migration-readiness flag that reports "ready" because
// nothing was watching. So:
//
//   * readiness is DERIVED from observation, never asserted;
//   * and in 'off' mode, where by definition nothing was observed, readiness is FALSE with a
//     reason that says why. Absence of evidence is not evidence of absence.
//
// See docs/SEMVER_AND_WIRE_COMMITMENTS.md "Deprecation policy" for the release cadence this feeds.

/**
 * The migration ladder. Mirrors ScopeMode ('off' | 'contracted' | 'strict') deliberately — same
 * shape, same rung semantics, so an operator who understands one understands the other.
 *
 *   'off'      — pre-v0.28 behaviour exactly. The binding is not consulted at all.
 *   'observe'  — a call with NO taskId is allowed and recorded. A call that CLAIMS a taskId must
 *                still have a valid active one, exactly as in 'required'. This is the
 *                evidence-gathering rung and it weakens nothing: it admits precisely the calls
 *                'off' admits, and records more.
 *   'required' — a call with no active task is denied. Identical to the pre-v0.28
 *                `enforceTaskBinding: true`.
 */
export type TaskBindingMode = 'off' | 'observe' | 'required';

export const TASK_BINDING_MODES: readonly TaskBindingMode[] = ['off', 'observe', 'required'] as const;

/** Rank, so a caller can assert "this change did not loosen the rung". */
const RANK: Record<TaskBindingMode, number> = { off: 0, observe: 1, required: 2 };

/** True when `next` is at least as strict as `prev`. The deprecation policy forbids weakening the
 *  fail-closed floor, so a downgrade must be a deliberate, visible act rather than a default. */
export function isTightening(prev: TaskBindingMode, next: TaskBindingMode): boolean {
  return RANK[next] >= RANK[prev];
}

export interface UntaskedCaller {
  agentId: string;
  tool: string;
  calls: number;
  firstSeen: string;
  lastSeen: string;
}

export interface TaskBindingMigrationReport {
  mode: TaskBindingMode;
  /** Whether it is safe to promote to 'required'. Derived, never set. False whenever the evidence
   *  is absent as well as whenever it is negative. */
  ready: boolean;
  reason: string;
  totalUntaskedCalls: number;
  /** Deterministically ordered: agentId then tool, so two reports over the same data are equal. */
  untaskedCallers: readonly UntaskedCaller[];
}

/**
 * Counts calls that arrived with no taskId, attributed to the agent and tool that made them.
 *
 * Attribution is the point. A bare count tells you that legacy callers exist; it does not tell you
 * whom to go and fix, which is what actually gets a migration finished.
 */
export class UntaskedCallTracker {
  private seen = new Map<string, UntaskedCaller>();

  private static key(agentId: string, tool: string): string { return `${agentId}\u0000${tool}`; }

  /** Record one untasked call. Returns true the FIRST time this (agent, tool) pair is seen, so the
   *  caller can audit once per pair rather than once per call — the same once-per-agent discipline
   *  pdp.ts already uses for the `agent-unrestricted` grant. */
  note(agentId: string, tool: string, nowIso: string): boolean {
    const k = UntaskedCallTracker.key(agentId, tool);
    const hit = this.seen.get(k);
    if (hit) { hit.calls++; hit.lastSeen = nowIso; return false; }
    this.seen.set(k, { agentId, tool, calls: 1, firstSeen: nowIso, lastSeen: nowIso });
    return true;
  }

  callers(): readonly UntaskedCaller[] {
    return [...this.seen.values()]
      .map((c) => ({ ...c }))
      .sort((a, b) => (a.agentId === b.agentId ? a.tool.localeCompare(b.tool) : a.agentId.localeCompare(b.agentId)));
  }

  total(): number { return [...this.seen.values()].reduce((n, c) => n + c.calls, 0); }

  reset(): void { this.seen.clear(); }

  /**
   * Is it safe to promote this deployment to 'required'?
   *
   * Three answers, and the middle one is the one that matters:
   *   - already 'required'          -> ready (nothing to promote)
   *   - 'off'                       -> NOT ready, because nothing was observed
   *   - 'observe' with zero untasked -> ready
   *   - 'observe' with any untasked  -> NOT ready, and the report names who
   */
  report(mode: TaskBindingMode): TaskBindingMigrationReport {
    const untaskedCallers = this.callers();
    const totalUntaskedCalls = this.total();
    if (mode === 'required') {
      return { mode, ready: true, reason: 'already enforcing — nothing to promote', totalUntaskedCalls, untaskedCallers };
    }
    if (mode === 'off') {
      return {
        mode, ready: false,
        reason: 'not observing — absence of recorded untasked calls is not evidence that none occur. Run in "observe" for a release first.',
        totalUntaskedCalls, untaskedCallers,
      };
    }
    if (totalUntaskedCalls > 0) {
      const who = untaskedCallers.slice(0, 5).map((c) => `${c.agentId}:${c.tool}(${c.calls})`).join(', ');
      const more = untaskedCallers.length > 5 ? ` and ${untaskedCallers.length - 5} more` : '';
      return {
        mode, ready: false,
        reason: `${totalUntaskedCalls} untasked call(s) from ${untaskedCallers.length} caller(s): ${who}${more}`,
        totalUntaskedCalls, untaskedCallers,
      };
    }
    return { mode, ready: true, reason: 'observing, and no untasked call was recorded', totalUntaskedCalls, untaskedCallers };
  }
}
