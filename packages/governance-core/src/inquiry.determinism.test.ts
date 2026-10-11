import { describe, it, expect } from 'vitest';
import { FixtureInquiryProvider, foldInquiry, inquiryHash, shadowInquiry } from './inquiry';
import type { InquiryQuestion, InquiryRequest, InquiryThresholds } from './inquiry';

// Determinism for the fold, mirroring pdp.determinism.test.ts. The PROVIDER is not deterministic
// and this file does not pretend otherwise — a model may answer differently every time. What must
// be deterministic is Starfish's treatment of a given signal: the same request, signal, thresholds
// and versions must always produce the same category contribution and the same reasons.

const Q: InquiryQuestion = {
  id: 'q.exfil-risk', version: 3, kind: 'likelihood',
  statement: 'This tool call exfiltrates data outside the governed boundary.',
  category: 12, failsafeScore: 10,
};
const T: InquiryThresholds = {
  minConfidence: 0.7,
  likelihoodBands: [{ upTo: 0.2, score: 1 }, { upTo: 0.6, score: 5 }, { upTo: 1, score: 9 }],
};
const REQ: InquiryRequest = {
  requestId: 'req-det', taskId: 'task-det', policyVersion: 'policy-2026.09.01.1',
  question: Q, state: { tool: 'net.post', bytes: 1024 }, evidenceRefs: ['ev-1', 'ev-2'],
  classification: 'internal', deadlineMs: 5000,
};

function provider(): FixtureInquiryProvider {
  const p = new FixtureInquiryProvider();
  p.set(Q.id, Q.version, { outcome: 'answered', likelihood: 0.42, confidence: 0.91, latencyMs: 17 });
  return p;
}

describe('fold determinism', () => {
  it('1000 folds of the same signal are byte-identical', () => {
    const sig = provider().ask(REQ);
    const first = JSON.stringify(foldInquiry(REQ, sig, T));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(foldInquiry(REQ, sig, T))).toBe(first);
    }
  });

  it('the provenance hash is stable across 1000 computations', () => {
    const first = inquiryHash(REQ);
    for (let i = 0; i < 1000; i++) expect(inquiryHash(REQ)).toBe(first);
  });

  it('key insertion order in state does not change the fold', () => {
    const a = { ...REQ, state: { tool: 'net.post', bytes: 1024 } };
    const b = { ...REQ, state: { bytes: 1024, tool: 'net.post' } };
    const sig = provider().ask(a);
    // The fold does not read state, so reordering it must be invisible to the contribution.
    expect(foldInquiry(a, sig, T).categories).toEqual(foldInquiry(b, { ...sig, contentHash: inquiryHash(b) }, T).categories);
  });

  it('shadow evaluation is deterministic over 200 runs', () => {
    const p = provider();
    const first = JSON.stringify(shadowInquiry(REQ, p, T));
    for (let i = 0; i < 200; i++) expect(JSON.stringify(shadowInquiry(REQ, p, T))).toBe(first);
  });

  it('a different policy version produces a different hash but the same score', () => {
    const other = { ...REQ, policyVersion: 'policy-2026.09.02.1' };
    expect(inquiryHash(other)).not.toBe(inquiryHash(REQ));
    const sigA = provider().ask(REQ);
    const sigB = provider().ask(other);
    expect(foldInquiry(other, sigB, T).score).toBe(foldInquiry(REQ, sigA, T).score);
  });

  it('every band boundary maps to exactly one score', () => {
    for (const [lk, expected] of [[0, 1], [0.2, 1], [0.2001, 5], [0.6, 5], [0.6001, 9], [1, 9]] as const) {
      const p = new FixtureInquiryProvider();
      p.set(Q.id, Q.version, { outcome: 'answered', likelihood: lk, confidence: 0.9, latencyMs: 5 });
      expect(foldInquiry(REQ, p.ask(REQ), T).score).toBe(expected);
    }
  });
});
