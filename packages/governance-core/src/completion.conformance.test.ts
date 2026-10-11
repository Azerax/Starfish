import { describe, it, expect } from 'vitest';
import {
  COMPLETION_STATUSES, TERMINAL_COMPLETION_STATUSES, ALLOWED_COMPLETION_TRANSITIONS,
  CompletionLedger, advance, openReceipt, recordVerification, verifyReceiptSeal, commitInputs,
  canCompletionTransition, isTerminalCompletion, isProvenComplete, outcomeKnown, canCompleteTask,
  statusFromInvocationOutcome,
} from './completion';
import type {
  CompletionStatus, CompletionReceipt, RequestedEffect, VerificationRecord, InvocationOutcome,
} from './completion';
import { AuditLog } from './audit';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Completion receipts (docs/adr/0003-completion-receipt.md). The properties that matter:
//   * `returned-success` is NOT completion — isProvenComplete is true for 'verified' alone
//   * a CONSEQUENTIAL effect cannot complete on the tool's own report, and `consequential` is SEALED
//     so the flag cannot be flipped afterwards to get there
//   * `response-lost` is UNKNOWN, not failure — the retry-safety distinction
//   * `unverifiable` is a real answer, and does not complete consequential work
//   * a verifier may not be the actor whose effect is verified
//   * the transition table is explicit, closed, and fails closed on an unknown status
//   * the seal covers what was fixed at dispatch and NOTHING observed later

const EFFECT: RequestedEffect = { kind: 'write', target: '/w/out.txt', consequential: true };
const CHEAP: RequestedEffect = { kind: 'read', target: '/w/in.txt', consequential: false };

function fresh(effect: RequestedEffect = EFFECT): CompletionReceipt {
  return openReceipt({
    receiptId: 'r-1', taskId: 't-1', decisionId: 'd-1', invocationId: 'i-1',
    effect, inputCommitment: commitInputs(effect.target, { a: 1 }), at: '2026-10-11T00:00:00.000Z',
  });
}

/** Walk a receipt to a given status by the shortest legal path, so a test can start anywhere. */
function at(status: CompletionStatus, effect: RequestedEffect = EFFECT): CompletionReceipt {
  let r = fresh(effect);
  const path: Partial<Record<CompletionStatus, CompletionStatus[]>> = {
    'not-executed': [],
    'started': ['started'],
    'returned-success': ['started', 'returned-success'],
    'returned-failure': ['started', 'returned-failure'],
    'response-lost': ['started', 'response-lost'],
    'claimed-unverified': ['claimed-unverified'],
    'verified': ['started', 'returned-success', 'verified'],
    'contradicted': ['started', 'returned-success', 'contradicted'],
    'unverifiable': ['started', 'returned-success', 'unverifiable'],
  };
  for (const step of path[status] ?? []) {
    const res = advance(r, { to: step, at: '2026-10-11T00:00:01.000Z', actor: 'harness' });
    expect(res.ok, `harness could not reach ${status} via ${step}`).toBe(true);
    if (res.ok) r = res.receipt;
  }
  expect(r.status).toBe(status);
  return r;
}

function auditLog(): AuditLog {
  return new AuditLog(join(mkdtempSync(join(tmpdir(), 'sf-completion-')), 'audit.jsonl'));
}

describe('completion receipts — "returned success" is not "it worked"', () => {
  // -------------------------------------------------------------------------
  // The load-bearing predicate
  // -------------------------------------------------------------------------

  it('isProvenComplete is true for "verified" and for NOTHING else', () => {
    for (const s of COMPLETION_STATUSES) {
      expect(isProvenComplete(s), `isProvenComplete(${s})`).toBe(s === 'verified');
    }
  });

  it('returned-success does not prove completion — the whole point of the module', () => {
    expect(isProvenComplete('returned-success')).toBe(false);
  });

  it('a consequential effect cannot complete on the tool\'s own report', () => {
    expect(canCompleteTask('returned-success', { consequential: true })).toBe(false);
    expect(canCompleteTask('verified', { consequential: true })).toBe(true);
  });

  it('a non-consequential effect may complete on returned-success (no friction without return)', () => {
    expect(canCompleteTask('returned-success', { consequential: false })).toBe(true);
  });

  it('no status other than verified/returned-success completes anything', () => {
    for (const s of COMPLETION_STATUSES) {
      if (s === 'verified' || s === 'returned-success') continue;
      expect(canCompleteTask(s, { consequential: false }), `${s} (cheap)`).toBe(false);
      expect(canCompleteTask(s, { consequential: true }), `${s} (consequential)`).toBe(false);
    }
  });

  it('unverifiable does not complete consequential work — the gap is admitted, not papered over', () => {
    expect(canCompleteTask('unverifiable', { consequential: true })).toBe(false);
  });

  // -------------------------------------------------------------------------
  // response-lost is UNKNOWN, not failure
  // -------------------------------------------------------------------------

  it('response-lost and started are the only statuses where the outcome is unknown', () => {
    for (const s of COMPLETION_STATUSES) {
      expect(outcomeKnown(s), `outcomeKnown(${s})`).toBe(s !== 'started' && s !== 'response-lost');
    }
  });

  it('response-lost is distinct from returned-failure — a retry decision depends on which', () => {
    expect(outcomeKnown('returned-failure')).toBe(true);   // safe to reason about
    expect(outcomeKnown('response-lost')).toBe(false);     // NOT safe to assume it did not happen
    expect(isProvenComplete('response-lost')).toBe(false); // and not safe to assume it did
  });

  it('response-lost can still be verified later — a lost response is not a dead end', () => {
    const r = at('response-lost');
    const v: VerificationRecord = {
      method: 'read-back', verifier: 'verifier-1', at: '2026-10-11T00:00:05.000Z', evidenceHashes: ['h1'],
    };
    const res = recordVerification(r, v, 'verified', { subjectActor: 'agent-1', at: '2026-10-11T00:00:05.000Z' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(isProvenComplete(res.receipt.status)).toBe(true);
  });

  it('the duplicate discrepancy exists for exactly the retry-after-lost-response case', () => {
    const r = at('response-lost');
    const v: VerificationRecord = {
      method: 'state-query', verifier: 'verifier-1', at: '2026-10-11T00:00:06.000Z', evidenceHashes: ['h2'],
    };
    const res = recordVerification(r, v, 'contradicted', {
      subjectActor: 'agent-1', at: '2026-10-11T00:00:06.000Z', discrepancy: 'duplicate',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.receipt.discrepancy).toBe('duplicate');
  });

  // -------------------------------------------------------------------------
  // The transition table
  // -------------------------------------------------------------------------

  it('every status has an entry, and terminal statuses have no outbound edges', () => {
    for (const s of COMPLETION_STATUSES) {
      expect(ALLOWED_COMPLETION_TRANSITIONS[s], `missing table entry for ${s}`).toBeDefined();
      if (TERMINAL_COMPLETION_STATUSES.includes(s)) {
        expect(ALLOWED_COMPLETION_TRANSITIONS[s].length, `${s} should be terminal`).toBe(0);
        expect(isTerminalCompletion(s)).toBe(true);
      }
    }
  });

  it('not-executed is NOT terminal — a receipt opens there and may still be dispatched', () => {
    expect(isTerminalCompletion('not-executed')).toBe(false);
    expect(canCompletionTransition('not-executed', 'started')).toBe(true);
  });

  it('claimed-unverified is reachable from EVERY non-terminal state', () => {
    for (const s of COMPLETION_STATUSES) {
      if (isTerminalCompletion(s)) continue;
      expect(canCompletionTransition(s, 'claimed-unverified'), `${s} -> claimed-unverified`).toBe(true);
    }
  });

  it('a status cannot jump the dispatch states — not-executed does not go straight to verified', () => {
    expect(canCompletionTransition('not-executed', 'verified')).toBe(false);
    expect(canCompletionTransition('not-executed', 'returned-success')).toBe(false);
  });

  it('every table target is a known status (no edge to a typo)', () => {
    for (const s of COMPLETION_STATUSES) {
      for (const t of ALLOWED_COMPLETION_TRANSITIONS[s]) {
        expect(COMPLETION_STATUSES, `${s} -> ${t}`).toContain(t);
      }
    }
  });

  it('an unknown status fails closed — it advances nowhere', () => {
    expect(canCompletionTransition('nonsense' as CompletionStatus, 'started')).toBe(false);
    const res = advance(fresh(), { to: 'nonsense' as CompletionStatus, at: 'x', actor: 'a' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('unknown-status');
  });

  it('a terminal receipt refuses every further transition', () => {
    const r = at('verified');
    for (const s of COMPLETION_STATUSES) {
      const res = advance(r, { to: s, at: 'x', actor: 'a' });
      expect(res.ok, `verified -> ${s} should be refused`).toBe(false);
    }
  });

  it('advance returns a NEW receipt and leaves the original alone', () => {
    const r = fresh();
    const res = advance(r, { to: 'started', at: 'x', actor: 'a' });
    expect(r.status).toBe('not-executed');
    if (res.ok) expect(res.receipt.status).toBe('started');
  });

  it('history records each step with from, to and actor', () => {
    const r = at('returned-success');
    expect(r.history.length).toBe(2);
    expect(r.history[0].from).toBe('not-executed');
    expect(r.history[0].to).toBe('started');
    expect(r.history[1].to).toBe('returned-success');
    expect(r.history.every((h) => h.actor === 'harness')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The seal
  // -------------------------------------------------------------------------

  it('a fresh receipt seals, and the seal survives observed transitions', () => {
    expect(verifyReceiptSeal(fresh()).ok).toBe(true);
    expect(verifyReceiptSeal(at('verified')).ok).toBe(true);
  });

  it('`consequential` is SEALED — it cannot be flipped to complete on a self-report', () => {
    const r = at('returned-success');                                   // consequential: cannot complete
    expect(canCompleteTask(r.status, { consequential: r.effect.consequential })).toBe(false);

    const forged = { ...r, effect: { ...r.effect, consequential: false } } as CompletionReceipt;
    // The flag now SAYS cheap, so the naive predicate would pass...
    expect(canCompleteTask(forged.status, { consequential: forged.effect.consequential })).toBe(true);
    // ...but the seal catches it, and the receipt can no longer advance at all.
    expect(verifyReceiptSeal(forged).ok).toBe(false);
    const res = advance(forged, { to: 'verified', at: 'x', actor: 'a' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('completion-receipt-tampered');
  });

  it('tampering with any sealed field is detected', () => {
    const base = fresh();
    const mutations: CompletionReceipt[] = [
      { ...base, taskId: 't-2' },
      { ...base, decisionId: 'd-2' },
      { ...base, invocationId: 'i-2' },
      { ...base, inputCommitment: 'deadbeef' },
      { ...base, at: '2026-10-12T00:00:00.000Z' },
      { ...base, effect: { ...base.effect, target: '/w/elsewhere.txt' } },
      { ...base, effect: { ...base.effect, kind: 'read' } },
    ];
    for (const m of mutations) expect(verifyReceiptSeal(m).ok, JSON.stringify(m.effect)).toBe(false);
  });

  it('observed fields are NOT sealed — recording an observation is not tamper', () => {
    const r = at('returned-success');
    const touched: CompletionReceipt = {
      ...r,
      remoteInvocationId: 'remote-9', externalAuditId: 'ext-9',
      responseCommitment: 'rc', observedStateCommitment: 'osc', auditSeq: 42,
      discrepancy: 'partial',
    };
    expect(verifyReceiptSeal(touched).ok).toBe(true);
  });

  it('inputCommitment is a commitment, not the inputs — same input, same hash; different, different', () => {
    expect(commitInputs('/w/a', { x: 1 })).toBe(commitInputs('/w/a', { x: 1 }));
    expect(commitInputs('/w/a', { x: 1 })).not.toBe(commitInputs('/w/a', { x: 2 }));
    expect(commitInputs('/w/a', { x: 1 })).not.toBe(commitInputs('/w/b', { x: 1 }));
    expect(commitInputs('/w/a', { secret: 'hunter2' })).not.toContain('hunter2');
  });

  // -------------------------------------------------------------------------
  // Verification is not self-certification
  // -------------------------------------------------------------------------

  it('an actor may not verify its own effect', () => {
    const r = at('returned-success');
    const v: VerificationRecord = {
      method: 'read-back', verifier: 'agent-1', at: 'x', evidenceHashes: ['h'],
    };
    const res = recordVerification(r, v, 'verified', { subjectActor: 'agent-1', at: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('verifier-is-subject');
  });

  it('an empty verifier is refused — an absent party is not an independent one', () => {
    const r = at('returned-success');
    const res = recordVerification(r, { method: 'read-back', verifier: '', at: 'x', evidenceHashes: [] },
      'verified', { subjectActor: 'agent-1', at: 'x' });
    expect(res.ok).toBe(false);
  });

  it('"verified" with method "none" is refused — an absent check is not a passed check', () => {
    const r = at('returned-success');
    const res = recordVerification(r, { method: 'none', verifier: 'v1', at: 'x', evidenceHashes: [] },
      'verified', { subjectActor: 'agent-1', at: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('no-method');
  });

  it('"contradicted" must say HOW it diverged — a bare contradiction is not actionable', () => {
    const r = at('returned-success');
    const v: VerificationRecord = { method: 'read-back', verifier: 'v1', at: 'x', evidenceHashes: ['h'] };
    expect(recordVerification(r, v, 'contradicted', { subjectActor: 'a', at: 'x' }).ok).toBe(false);
    expect(recordVerification(r, v, 'contradicted', { subjectActor: 'a', at: 'x', discrepancy: 'absent' }).ok).toBe(true);
  });

  it('"unverifiable" needs no method — admitting there is no check is the honest case', () => {
    const r = at('returned-success');
    const res = recordVerification(r, { method: 'none', verifier: 'v1', at: 'x', evidenceHashes: [] },
      'unverifiable', { subjectActor: 'agent-1', at: 'x' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(canCompleteTask(res.receipt.status, { consequential: true })).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The control-plane bridge
  // -------------------------------------------------------------------------

  it('every McpInvocation outcome maps to a distinct status — including forwarded-error', () => {
    const outcomes: InvocationOutcome[] = ['not-forwarded', 'forwarded-ok', 'forwarded-error', 'forwarded-lost'];
    const mapped = outcomes.map(statusFromInvocationOutcome);
    expect(mapped).toEqual(['not-executed', 'returned-success', 'returned-failure', 'response-lost']);
    expect(new Set(mapped).size).toBe(4);   // no two outcomes collapse into one status
  });

  it('an unknown invocation outcome claims nothing about the effect', () => {
    expect(statusFromInvocationOutcome('garbage' as InvocationOutcome)).toBe('response-lost');
    expect(outcomeKnown(statusFromInvocationOutcome('garbage' as InvocationOutcome))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // There is no allow/deny anywhere in this record
  // -------------------------------------------------------------------------

  it('a receipt carries no authorization field — it reports outcome, it does not grant', () => {
    const keys = Object.keys(at('verified'));
    for (const forbidden of ['allow', 'deny', 'allowed', 'denied', 'approve', 'approved', 'decision', 'verdict']) {
      expect(keys, `a receipt must not carry '${forbidden}'`).not.toContain(forbidden);
    }
    // It carries the decision's ID — a reference to an authorization made elsewhere, not one of its own.
    expect(keys).toContain('decisionId');
  });

  // -------------------------------------------------------------------------
  // The ledger shell
  // -------------------------------------------------------------------------

  it('the ledger audits opening, advancing, AND refusal', () => {
    const audit = auditLog();
    const led = new CompletionLedger(audit, () => '2026-10-11T00:00:00.000Z');
    const r = led.open({
      receiptId: 'r-9', taskId: 't-9', decisionId: 'd-9', invocationId: 'i-9',
      effect: EFFECT, inputCommitment: commitInputs(EFFECT.target, { q: 1 }),
    });
    expect(r.auditSeq).toBeDefined();

    led.advance('r-9', { to: 'started', actor: 'agent-1' });
    led.advance('r-9', { to: 'verified', actor: 'agent-1' });   // illegal: must pass a response state

    const actions = audit.recent().map((e) => e.action);
    expect(actions).toContain('completion-opened');
    expect(actions).toContain('completion-advanced');
    expect(actions).toContain('completion-transition-refused');
    expect(audit.verify()).toBe(true);
    expect(audit.recent().every((e) => e.domain === 'completion')).toBe(true);
  });

  it('the ledger refuses an unknown receipt rather than inventing one', () => {
    const led = new CompletionLedger(undefined, () => 'x');
    const res = led.advance('nope', { to: 'started', actor: 'a' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('unknown-receipt');
  });

  it('unknownOutcomes answers "what did we authorise and never confirm?"', () => {
    const led = new CompletionLedger(undefined, () => 'x');
    for (const id of ['a', 'b', 'c']) {
      led.open({ receiptId: id, taskId: 't', decisionId: 'd', invocationId: id, effect: EFFECT, inputCommitment: 'ic' });
    }
    led.advance('a', { to: 'started', actor: 'x' });
    led.advance('b', { to: 'started', actor: 'x' });
    led.advance('b', { to: 'response-lost', actor: 'x' });
    led.advance('c', { to: 'started', actor: 'x' });
    led.advance('c', { to: 'returned-success', actor: 'x' });

    const unknown = led.unknownOutcomes().map((r) => r.receiptId).sort();
    expect(unknown).toEqual(['a', 'b']);     // dispatched-no-response, and lost
  });

  it('unprovenConsequential includes returned-success — a self-report is an OPEN item', () => {
    const led = new CompletionLedger(undefined, () => 'x');
    led.open({ receiptId: 'big', taskId: 't', decisionId: 'd', invocationId: 'i1', effect: EFFECT, inputCommitment: 'ic' });
    led.open({ receiptId: 'small', taskId: 't', decisionId: 'd', invocationId: 'i2', effect: CHEAP, inputCommitment: 'ic' });
    for (const id of ['big', 'small']) {
      led.advance(id, { to: 'started', actor: 'x' });
      led.advance(id, { to: 'returned-success', actor: 'x' });
    }
    expect(led.unprovenConsequential().map((r) => r.receiptId)).toEqual(['big']);
  });

  it('a verified consequential effect leaves the unproven list', () => {
    const led = new CompletionLedger(undefined, () => 'x');
    led.open({ receiptId: 'big', taskId: 't', decisionId: 'd', invocationId: 'i1', effect: EFFECT, inputCommitment: 'ic' });
    led.advance('big', { to: 'started', actor: 'x' });
    led.advance('big', { to: 'returned-success', actor: 'x' });
    expect(led.unprovenConsequential().length).toBe(1);
    led.advance('big', {
      to: 'verified', actor: 'verifier-1',
      patch: { verification: { method: 'read-back', verifier: 'verifier-1', at: 'x', evidenceHashes: ['h'] } },
    });
    expect(led.unprovenConsequential().length).toBe(0);
  });
});
