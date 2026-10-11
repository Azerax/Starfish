import { describe, it, expect } from 'vitest';
import { UntaskedCallTracker, TASK_BINDING_MODES, isTightening } from './taskmigration';
import type { TaskBindingMode } from './taskmigration';
import { PDP, resolveTaskBindingMode } from './pdp';
import type { TaskBinding } from './pdp';
import { loadGovernor } from './boot';
import { Registry } from './registry';
import { AuditLog } from './audit';
import { RiskEngine } from './risk';
import { asTaskBound } from './types';
import type { ToolDef, AgentDef, BoundarySet, ToolCall } from './types';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The `ToolCall.taskId` migration ladder. The properties that matter:
//   * v0.28 changes NO existing behaviour — 'off' stays the default and maps to the old code path
//   * the deprecated `enforce: true` keeps working and means 'required'
//   * 'observe' admits exactly what 'off' admits, and records who
//   * a call that CLAIMS a taskId is still checked in 'observe' — only a MISSING taskId is legacy
//   * readiness is derived, and is false in 'off' because nothing was observed (the F-10 trap)
// See taskmigration.ts and docs/SEMVER_AND_WIRE_COMMITMENTS.md "Deprecation policy".

const BS: BoundarySet = { visibility: ['/w'], write: ['/w'] };

function pdpWith(binding: TaskBinding | undefined): { pdp: PDP; audit: AuditLog } {
  const dir = mkdtempSync(join(tmpdir(), 'sf-taskmig-'));
  writeFileSync(join(dir, 'tools.json'), JSON.stringify([{ id: 'fs.read', category: 'read', pathParams: ['path'], allowedAgents: ['worker'] }]));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify([{ id: 'worker' }]));
  const tools = new Registry<ToolDef>(join(dir, 'tools.json'), (t) => t.id);
  const agents = new Registry<AgentDef>(join(dir, 'agents.json'), (a) => a.id);
  const audit = new AuditLog(join(dir, 'audit.jsonl'));
  return { pdp: new PDP(tools, agents, audit, new RiskEngine(), undefined, binding), audit };
}

/** A ledger where only 'task-live' is active for 'worker'. */
const provider = { hasActiveTask: (a: string, t?: string) => a === 'worker' && t === 'task-live' };

const call = (over: Partial<ToolCall> = {}): ToolCall => ({ agentId: 'worker', tool: 'fs.read', input: { path: '/w/a.txt' }, ...over });

// ---------------------------------------------------------------------------

describe('mode resolution is backward compatible and fail-safe', () => {
  it('no binding at all is off', () => {
    expect(resolveTaskBindingMode(undefined)).toBe('off');
  });
  it('the deprecated enforce:true still means required', () => {
    expect(resolveTaskBindingMode({ enforce: true, provider })).toBe('required');
  });
  it('the deprecated enforce:false still means off', () => {
    expect(resolveTaskBindingMode({ enforce: false, provider })).toBe('off');
  });
  it('mode wins when both are present', () => {
    expect(resolveTaskBindingMode({ mode: 'observe', enforce: true, provider })).toBe('observe');
  });
  it('an unrecognised mode resolves to required, never off — a typo must not disable a gate', () => {
    expect(resolveTaskBindingMode({ mode: 'obsrve' as never, provider })).toBe('required');
  });
  it('the ladder has exactly three documented rungs', () => {
    expect([...TASK_BINDING_MODES]).toEqual(['off', 'observe', 'required']);
  });
});

describe('the ladder only ever tightens', () => {
  it('rung comparison accepts holds and promotions, rejects demotions', () => {
    expect(isTightening('off', 'observe')).toBe(true);
    expect(isTightening('observe', 'required')).toBe(true);
    expect(isTightening('observe', 'observe')).toBe(true);
    expect(isTightening('required', 'observe')).toBe(false);
    expect(isTightening('observe', 'off')).toBe(false);
  });
});

describe("v0.28 changes nothing — 'off' reproduces the pre-migration path", () => {
  it('an untasked call is allowed with no binding', () => {
    const { pdp } = pdpWith(undefined);
    expect(pdp.decide('ingress', call(), BS).allow).toBe(true);
  });
  it('and is allowed under an explicit off', () => {
    const { pdp } = pdpWith({ mode: 'off', provider });
    expect(pdp.decide('ingress', call(), BS).allow).toBe(true);
  });
});

describe("'required' reproduces the pre-v0.28 enforceTaskBinding exactly", () => {
  it('an untasked call is denied', () => {
    const { pdp } = pdpWith({ mode: 'required', provider });
    const d = pdp.decide('ingress', call(), BS);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('no active task (no task, no tool)');
  });
  it('a ghost taskId is denied', () => {
    const { pdp } = pdpWith({ mode: 'required', provider });
    expect(pdp.decide('ingress', call({ taskId: 'task-ghost' }), BS).allow).toBe(false);
  });
  it('a live task is allowed', () => {
    const { pdp } = pdpWith({ mode: 'required', provider });
    expect(pdp.decide('ingress', call({ taskId: 'task-live' }), BS).allow).toBe(true);
  });
  it('the legacy enforce:true flag behaves identically', () => {
    const { pdp } = pdpWith({ enforce: true, provider });
    expect(pdp.decide('ingress', call(), BS).allow).toBe(false);
    expect(pdp.decide('ingress', call({ taskId: 'task-live' }), BS).allow).toBe(true);
  });
});

describe("'observe' admits what 'off' admits, and no more", () => {
  it('an untasked call is allowed', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    expect(pdp.decide('ingress', call(), BS).allow).toBe(true);
  });

  it('a call that CLAIMS a bad taskId is still denied — that is a violation, not a legacy caller', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    const d = pdp.decide('ingress', call({ taskId: 'task-ghost' }), BS);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('no active task (no task, no tool)');
  });

  it('an empty-string taskId counts as absent, not as a claim', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    expect(pdp.decide('ingress', call({ taskId: '' }), BS).allow).toBe(true);
  });

  it('a live task is allowed and is NOT recorded as untasked', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    expect(pdp.decide('ingress', call({ taskId: 'task-live' }), BS).allow).toBe(true);
    expect(pdp.taskBindingMigration().totalUntaskedCalls).toBe(0);
  });

  it('observe is strictly more recording than off, never more permissive', () => {
    const offRun = pdpWith({ mode: 'off', provider });
    const obsRun = pdpWith({ mode: 'observe', provider });
    for (const c of [call(), call({ taskId: 'task-live' })]) {
      expect(obsRun.pdp.decide('ingress', c, BS).allow).toBe(offRun.pdp.decide('ingress', c, BS).allow);
    }
  });
});

describe('untasked calls are attributed, and audited once per agent+tool pair', () => {
  it('the deprecation event is written once, not once per call', () => {
    const { pdp, audit } = pdpWith({ mode: 'observe', provider });
    for (let i = 0; i < 10; i++) pdp.decide('ingress', call(), BS);
    const notices = audit.recent().filter((e) => e.action === 'task-binding:untasked-call');
    expect(notices).toHaveLength(1);
    expect(notices[0].actor).toBe('worker');
    expect(notices[0].target).toBe('fs.read');
    expect(notices[0].reason).toMatch(/will be DENIED once the mode is promoted/);
  });

  it('but every call is still counted', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    for (let i = 0; i < 10; i++) pdp.decide('ingress', call(), BS);
    const rep = pdp.taskBindingMigration();
    expect(rep.totalUntaskedCalls).toBe(10);
    expect(rep.untaskedCallers).toHaveLength(1);
    expect(rep.untaskedCallers[0]).toMatchObject({ agentId: 'worker', tool: 'fs.read', calls: 10 });
  });

  it('distinct agent+tool pairs are tracked separately', () => {
    const t = new UntaskedCallTracker();
    expect(t.note('a', 'fs.read', '2026-09-26T00:00:00.000Z')).toBe(true);
    expect(t.note('a', 'fs.read', '2026-09-26T00:00:01.000Z')).toBe(false);
    expect(t.note('a', 'fs.write', '2026-09-26T00:00:02.000Z')).toBe(true);
    expect(t.note('b', 'fs.read', '2026-09-26T00:00:03.000Z')).toBe(true);
    expect(t.total()).toBe(4);
    expect(t.callers()).toHaveLength(3);
  });

  it('caller order is deterministic', () => {
    const t = new UntaskedCallTracker();
    for (const [a, tool] of [['z', 'b'], ['a', 'z'], ['a', 'a'], ['m', 'm']] as const) t.note(a, tool, 'now');
    expect(t.callers().map((c) => `${c.agentId}:${c.tool}`)).toEqual(['a:a', 'a:z', 'm:m', 'z:b']);
  });
});

describe('readiness is derived, and absence of evidence is not evidence of absence', () => {
  it("'off' is NEVER ready, because nothing was observed — the F-10 trap", () => {
    const { pdp } = pdpWith({ mode: 'off', provider });
    for (let i = 0; i < 5; i++) pdp.decide('ingress', call(), BS);   // untasked calls DO happen
    const rep = pdp.taskBindingMigration();
    expect(rep.ready).toBe(false);
    expect(rep.reason).toMatch(/not observing/);
    expect(rep.totalUntaskedCalls).toBe(0);   // genuinely unrecorded, and the report says so
  });

  it('no binding at all is also not ready', () => {
    const { pdp } = pdpWith(undefined);
    expect(pdp.taskBindingMigration().ready).toBe(false);
  });

  it("'observe' with untasked traffic is not ready, and names who", () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    pdp.decide('ingress', call(), BS);
    const rep = pdp.taskBindingMigration();
    expect(rep.ready).toBe(false);
    expect(rep.reason).toMatch(/worker:fs\.read\(1\)/);
  });

  it("'observe' with only tasked traffic IS ready", () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    for (let i = 0; i < 5; i++) pdp.decide('ingress', call({ taskId: 'task-live' }), BS);
    const rep = pdp.taskBindingMigration();
    expect(rep.ready).toBe(true);
    expect(rep.reason).toMatch(/no untasked call was recorded/);
  });

  it("'required' is trivially ready — there is nothing left to promote", () => {
    const { pdp } = pdpWith({ mode: 'required', provider });
    expect(pdp.taskBindingMigration().ready).toBe(true);
  });

  it('the report is deterministic over repeated reads', () => {
    const { pdp } = pdpWith({ mode: 'observe', provider });
    pdp.decide('ingress', call(), BS);
    const first = JSON.stringify(pdp.taskBindingMigration());
    for (let i = 0; i < 100; i++) expect(JSON.stringify(pdp.taskBindingMigration())).toBe(first);
  });
});

describe('the type-level migration path', () => {
  it('asTaskBound narrows a tasked call and rejects an untasked one', () => {
    expect(asTaskBound(call({ taskId: 'task-live' }))?.taskId).toBe('task-live');
    expect(asTaskBound(call())).toBeUndefined();
    expect(asTaskBound(call({ taskId: '' }))).toBeUndefined();
  });

  it('a TaskBoundToolCall is assignable where a ToolCall is expected, so adoption is additive', () => {
    const bound = asTaskBound(call({ taskId: 'task-live' }));
    expect(bound).toBeDefined();
    const asPlain: ToolCall = bound as ToolCall;
    expect(asPlain.tool).toBe('fs.read');
  });
});

describe('the migration mode is visible, not inferred', () => {
  it('the PDP reports its own live rung', () => {
    expect(pdpWith({ mode: 'observe', provider }).pdp.getTaskBindingMode()).toBe('observe');
    expect(pdpWith({ enforce: true, provider }).pdp.getTaskBindingMode()).toBe('required');
    expect(pdpWith(undefined).pdp.getTaskBindingMode()).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// The default is FROZEN, in the same spirit as the wire/API freeze suites:
// docs/SEMVER_AND_WIRE_COMMITMENTS.md — "changing the wire version requires editing the freeze
// test, which is the deliberate, reviewed signal of a breaking change."
//
// The agreed sequence is 0.28 opt-in -> 0.29 default 'observe' -> 0.30 default 'required' and a
// non-optional taskId. Each promotion must be a hand edit HERE, with the release that makes it, so
// the default can never drift upward (silently breaking untasked callers) or downward (silently
// disabling the gate) as a side effect of some other change.
// ---------------------------------------------------------------------------

describe('FROZEN — the default rung for this release line', () => {
  function governor(): ReturnType<typeof loadGovernor> {
    const d = mkdtempSync(join(tmpdir(), 'sf-taskmig-boot-'));
    writeFileSync(join(d, 'tools.json'), '[]');
    writeFileSync(join(d, 'agents.json'), '[]');
    return loadGovernor(d, join(d, 'audit.jsonl'));
  }

  it("0.28: loadGovernor with no options defaults to 'off' — this release changes NO behaviour", () => {
    // 0.29 — change this to 'observe' and update the CHANGELOG in the same commit.
    // 0.30 — change this to 'required' and make ToolCall.taskId non-optional.
    expect(governor().posture.taskBindingMode).toBe('off');
  });

  it('the posture reports the rung, and reports it derived from the live binding', () => {
    const g = governor();
    expect(g.posture.taskBindingMode).toBe(g.pdp.getTaskBindingMode());
    // taskBinding (the boolean) must agree with the rung — true for observe/required, false for off.
    expect(g.posture.taskBinding).toBe(g.posture.taskBindingMode !== 'off');
  });

  it("the deprecated enforceTaskBinding option still selects 'required'", () => {
    const d = mkdtempSync(join(tmpdir(), 'sf-taskmig-boot-'));
    writeFileSync(join(d, 'tools.json'), '[]');
    writeFileSync(join(d, 'agents.json'), '[]');
    const g = loadGovernor(d, join(d, 'audit.jsonl'), { enforceTaskBinding: true });
    expect(g.posture.taskBindingMode).toBe('required');
    expect(g.posture.taskBinding).toBe(true);
  });

  it('taskBindingMode wins over the deprecated flag when both are given', () => {
    const d = mkdtempSync(join(tmpdir(), 'sf-taskmig-boot-'));
    writeFileSync(join(d, 'tools.json'), '[]');
    writeFileSync(join(d, 'agents.json'), '[]');
    const g = loadGovernor(d, join(d, 'audit.jsonl'), { taskBindingMode: 'observe', enforceTaskBinding: true });
    expect(g.posture.taskBindingMode).toBe('observe');
  });

  it('promoting the default one rung at a time is a tightening, never a loosening', () => {
    // The agreed ladder, asserted as a sequence so a future reorder trips here.
    const sequence: TaskBindingMode[] = ['off', 'observe', 'required'];
    for (let i = 1; i < sequence.length; i++) {
      expect(isTightening(sequence[i - 1], sequence[i])).toBe(true);
    }
    // And the reverse is not.
    expect(isTightening('required', 'off')).toBe(false);
  });
});
