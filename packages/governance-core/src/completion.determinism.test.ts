import { describe, it, expect } from 'vitest';
import { openReceipt, advance, commitInputs, recordVerification } from './completion';
import type { CompletionReceipt, RequestedEffect, VerificationRecord } from './completion';

// Determinism, the same bar `pdp.determinism.test.ts` and `inquiry.determinism.test.ts` hold.
//
// Why it matters for a RECORD rather than a decision: a receipt is evidence, and evidence that varies
// between two runs of the same inputs cannot be reconciled across the two ledgers it exists to join.
// `at` and `receiptId` are arguments precisely so this property is testable — a clock inside
// openReceipt would have made the module untestable in the one way that matters.

const EFFECT: RequestedEffect = {
  kind: 'write', target: '/w/out.txt', consequential: true, idempotencyKey: 'k-1', description: 'write the thing',
};

const INPUT = {
  receiptId: 'r-1', taskId: 't-1', decisionId: 'd-1', approvalId: 'ap-1', invocationId: 'i-1',
  effect: EFFECT, inputCommitment: commitInputs(EFFECT.target, { a: 1, b: [2, 3] }),
  at: '2026-10-11T00:00:00.000Z',
};

/** Walk the full ladder with fixed timestamps, so the whole machine is pinned rather than just `open`. */
function fullLadder(): CompletionReceipt {
  let r = openReceipt(INPUT);
  for (const to of ['started', 'returned-success'] as const) {
    const res = advance(r, { to, at: '2026-10-11T00:00:01.000Z', actor: 'agent-1', reason: `-> ${to}` });
    if (!res.ok) throw new Error(res.reason);
    r = res.receipt;
  }
  const v: VerificationRecord = {
    method: 'read-back', verifier: 'verifier-1', at: '2026-10-11T00:00:02.000Z',
    evidenceHashes: ['h1', 'h2'], note: 'read back and compared',
  };
  const res = recordVerification(r, v, 'verified', { subjectActor: 'agent-1', at: '2026-10-11T00:00:02.000Z' });
  if (!res.ok) throw new Error(res.reason);
  return res.receipt;
}

describe('completion determinism — identical inputs produce byte-identical receipts', () => {
  it('1000 opens of the same input are byte-identical', () => {
    const first = JSON.stringify(openReceipt(INPUT));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(openReceipt(INPUT))).toBe(first);
    }
  });

  it('1000 full ladders are byte-identical, history and verification included', () => {
    const first = JSON.stringify(fullLadder());
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(fullLadder())).toBe(first);
    }
  });

  it('the seal is stable across runs — a receipt opened twice has the same hash', () => {
    expect(openReceipt(INPUT).hash).toBe(openReceipt(INPUT).hash);
  });

  it('the seal is key-order independent — a reordered effect literal seals identically', () => {
    const reordered: RequestedEffect = {
      description: 'write the thing', idempotencyKey: 'k-1',
      consequential: true, target: '/w/out.txt', kind: 'write',
    };
    expect(openReceipt({ ...INPUT, effect: reordered }).hash).toBe(openReceipt(INPUT).hash);
  });

  it('an absent optional field and an explicit undefined seal identically', () => {
    const { approvalId: _drop, ...noApproval } = INPUT;
    expect(openReceipt({ ...noApproval, approvalId: undefined }).hash)
      .toBe(openReceipt(noApproval).hash);
  });

  it('the seal is sensitive to every field it covers', () => {
    const base = openReceipt(INPUT).hash;
    const variants = [
      { ...INPUT, receiptId: 'r-2' },
      { ...INPUT, taskId: 't-2' },
      { ...INPUT, decisionId: 'd-2' },
      { ...INPUT, approvalId: 'ap-2' },
      { ...INPUT, invocationId: 'i-2' },
      { ...INPUT, inputCommitment: 'different' },
      { ...INPUT, at: '2026-10-11T00:00:00.001Z' },
      { ...INPUT, effect: { ...EFFECT, consequential: false } },
      { ...INPUT, effect: { ...EFFECT, idempotencyKey: 'k-2' } },
      { ...INPUT, effect: { ...EFFECT, description: 'something else' } },
    ];
    for (const v of variants) {
      expect(openReceipt(v).hash, JSON.stringify(v).slice(0, 80)).not.toBe(base);
    }
  });

  it('commitInputs is stable and order-independent for the same object', () => {
    expect(commitInputs('/w/a', { x: 1, y: 2 })).toBe(commitInputs('/w/a', { x: 1, y: 2 }));
    // NOTE: JSON.stringify preserves insertion order, so a reordered literal is a DIFFERENT commitment.
    // That is deliberate and documented rather than hidden: a caller must commit to a canonical input
    // shape, and the receipt's job is to detect "same effect, different inputs" — not to normalise it.
    expect(commitInputs('/w/a', { y: 2, x: 1 })).not.toBe(commitInputs('/w/a', { x: 1, y: 2 }));
  });

  it('no function here reads a clock — a frozen Date cannot change the output', () => {
    const before = JSON.stringify(fullLadder());
    const RealDate = Date;
    try {
      // @ts-expect-error — deliberately replacing the global to prove nothing consults it.
      globalThis.Date = class extends RealDate { constructor() { super('1999-01-01T00:00:00.000Z'); } };
      expect(JSON.stringify(fullLadder())).toBe(before);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});
