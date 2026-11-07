import { describe, it, expect } from 'vitest';
import {
  FixtureInquiryProvider, RulesInquiryProvider,
  admitInquiry, askGoverned, foldInquiry, shadowInquiry,
  inquiryHash, validateQuestion, validateThresholds, validateInquiryRequest,
  buildInquiryHttpRequest, parseInquirySignal, classificationPermitted, treatCalibrationAsValid,
  INQUIRY_FAILSAFE_SCORE, INQUIRY_MIN_SCORE, INQUIRY_SCHEMA,
} from './inquiry';
import type { InquiryQuestion, InquiryRequest, InquiryThresholds, InquiryProvider, InquirySignal, InquiryCalibration } from './inquiry';
import { assessRisk, verdictFor } from './score';
import { HARD_DENY_IDS, FLOOR_TRIGGER } from './riskmatrix';

// Bounded semantic inquiry (ring 1). The properties under test are the ones that make a
// probabilistic input safe to admit into a deny-by-default system:
//   * a signal can RAISE risk and can never lower it, and carries no verdict field at all
//   * every failure mode (absent, late, malformed, unconfident, abstained) contributes the
//     question's failsafe score, not permission
//   * a refused admission never reaches the provider
//   * shadow mode writes nothing
// See docs/adr/0002-semantic-signal-boundary.md.

const CAT_EXFIL = 12;   // riskmatrix: exfiltration — a hard-deny floor category

const LIKELIHOOD_Q: InquiryQuestion = {
  id: 'q.exfil-risk', version: 1, kind: 'likelihood',
  statement: 'This tool call exfiltrates data outside the governed boundary.',
  category: CAT_EXFIL, failsafeScore: 10,
};
const CHOICE_Q: InquiryQuestion = {
  id: 'q.effect-class', version: 1, kind: 'choice',
  statement: 'What class of effect does this call have?',
  options: ['read', 'write', 'external'],
  category: CAT_EXFIL, failsafeScore: 9,
};
const LEVEL_Q: InquiryQuestion = {
  id: 'q.blast-radius', version: 1, kind: 'level',
  statement: 'How far does the blast radius of this call reach?',
  levels: 5, category: CAT_EXFIL, failsafeScore: 8,
};

const T_LIKELIHOOD: InquiryThresholds = {
  minConfidence: 0.7,
  likelihoodBands: [{ upTo: 0.2, score: 1 }, { upTo: 0.6, score: 5 }, { upTo: 1, score: 9 }],
};
const T_CHOICE: InquiryThresholds = {
  minConfidence: 0.7,
  choiceScores: { read: 1, write: 5, external: 9 },
};
const T_LEVEL: InquiryThresholds = { minConfidence: 0.7, levelScores: [1, 3, 5, 7, 9] };

function req(question: InquiryQuestion, over: Partial<InquiryRequest> = {}): InquiryRequest {
  return {
    requestId: 'req-1', taskId: 'task-1', policyVersion: 'policy-2026.09.01.1',
    question, state: { tool: 'net.post' }, evidenceRefs: [],
    classification: 'internal', deadlineMs: 5000, ...over,
  };
}

/** Counts invocations so we can assert a provider was never consulted. */
class CountingProvider implements InquiryProvider {
  readonly id = 'counting'; readonly model = 'counting'; readonly modelVersion = '1';
  readonly maxClassification = 'internal' as const;
  calls = 0;
  constructor(private inner: InquiryProvider) {}
  ask(r: InquiryRequest): InquirySignal { this.calls++; return this.inner.ask(r); }
}

function answering(q: InquiryQuestion, body: Partial<InquirySignal>): FixtureInquiryProvider {
  const p = new FixtureInquiryProvider();
  p.set(q.id, q.version, { outcome: 'answered', confidence: 0.9, latencyMs: 10, ...body });
  return p;
}

// ---------------------------------------------------------------------------

describe('a signal is evidence, never authorization', () => {
  it('InquirySignal has no allow/deny/ask/approve field to misread as a decision', () => {
    const sig = answering(LIKELIHOOD_Q, { likelihood: 0.9 }).ask(req(LIKELIHOOD_Q));
    for (const forbidden of ['allow', 'deny', 'ask', 'approve', 'verdict', 'decision']) {
      expect(Object.prototype.hasOwnProperty.call(sig, forbidden)).toBe(false);
    }
  });

  it('the fold returns CategoryScores for exactly one category — the declared blast radius', () => {
    const sig = answering(LIKELIHOOD_Q, { likelihood: 0.9 }).ask(req(LIKELIHOOD_Q));
    const fold = foldInquiry(req(LIKELIHOOD_Q), sig, T_LIKELIHOOD);
    expect(Object.keys(fold.categories)).toEqual([String(CAT_EXFIL)]);
  });
});

describe('raise-only monotonicity — the keystone property', () => {
  it('no answer on any kind ever folds below INQUIRY_MIN_SCORE', () => {
    const cases: Array<[InquiryQuestion, InquiryThresholds, Partial<InquirySignal>]> = [
      [LIKELIHOOD_Q, T_LIKELIHOOD, { likelihood: 0 }],
      [CHOICE_Q, T_CHOICE, { selected: 'read' }],
      [LEVEL_Q, T_LEVEL, { level: 1 }],
    ];
    for (const [q, t, body] of cases) {
      const r = req(q);
      const fold = foldInquiry(r, answering(q, body).ask(r), t);
      expect(fold.score).toBeGreaterThanOrEqual(INQUIRY_MIN_SCORE);
      expect(fold.usable).toBe(true);
    }
  });

  it('a maximally confident benign answer cannot reduce an already-tripped hard-deny floor', () => {
    // The category is already at the floor from deterministic evidence.
    const deterministic = { [CAT_EXFIL]: 10 };
    const before = assessRisk(deterministic);
    expect(before.hardDeny).toBe(true);

    // The most reassuring possible signal arrives.
    const r = req(LIKELIHOOD_Q);
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 0, confidence: 1 }).ask(r), T_LIKELIHOOD);

    // Folding is a merge where deterministic evidence wins ties upward — the caller takes the max.
    const merged = { ...fold.categories, [CAT_EXFIL]: Math.max(10, fold.score) };
    const after = assessRisk(merged);
    expect(after.hardDeny).toBe(true);
    expect(after.score).toBeGreaterThanOrEqual(before.score);
    expect(verdictFor(after, 'nomatch', 'medium').verdict).toBe('deny');
  });

  it('a high-confidence signal cannot override a policy deny', () => {
    const r = req(LIKELIHOOD_Q);
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 0, confidence: 1 }).ask(r), T_LIKELIHOOD);
    const a = assessRisk(fold.categories);
    expect(verdictFor(a, 'deny', 'medium').verdict).toBe('deny');
  });

  it('CAT_EXFIL is genuinely a hard-deny category, so the test above is not vacuous', () => {
    expect(HARD_DENY_IDS).toContain(CAT_EXFIL);
    expect(FLOOR_TRIGGER).toBe(8);
  });
});

describe('every failure mode fails closed to the failsafe score', () => {
  const r = req(LIKELIHOOD_Q);

  it('missing thresholds fail closed', () => {
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 0 }).ask(r), undefined);
    expect(fold.usable).toBe(false);
    expect(fold.score).toBe(LIKELIHOOD_Q.failsafeScore);
    expect(fold.reasons.join(' ')).toMatch(/no thresholds configured/);
  });

  it('incomplete thresholds fail closed rather than defaulting', () => {
    const partial: InquiryThresholds = { minConfidence: 0.7, choiceScores: { read: 1 } }; // missing write/external
    const rc = req(CHOICE_Q);
    const fold = foldInquiry(rc, answering(CHOICE_Q, { selected: 'read' }).ask(rc), partial);
    expect(fold.usable).toBe(false);
    expect(fold.reasons.join(' ')).toMatch(/missing option/);
  });

  it('a provider over the deadline fails closed', () => {
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 0, latencyMs: 99_999 }).ask(r), T_LIKELIHOOD);
    expect(fold.effectiveOutcome).toBe('unavailable');
    expect(fold.score).toBe(LIKELIHOOD_Q.failsafeScore);
  });

  it('an unavailable provider fails closed', () => {
    const empty = new FixtureInquiryProvider(); // no fixture for this question
    const fold = foldInquiry(r, empty.ask(r), T_LIKELIHOOD);
    expect(fold.effectiveOutcome).toBe('unavailable');
    expect(fold.usable).toBe(false);
  });

  it('a provider that throws fails closed rather than propagating', () => {
    const boom: InquiryProvider = {
      id: 'boom', model: 'boom', modelVersion: '1', maxClassification: 'restricted',
      ask() { throw new Error('kaboom'); },
    };
    const sig = askGoverned(r, boom);
    expect(sig.outcome).toBe('unavailable');
    expect(foldInquiry(r, sig, T_LIKELIHOOD).score).toBe(LIKELIHOOD_Q.failsafeScore);
  });

  it('an out-of-domain answer fails closed', () => {
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 42 }).ask(r), T_LIKELIHOOD);
    expect(fold.effectiveOutcome).toBe('invalid');
    expect(fold.score).toBe(LIKELIHOOD_Q.failsafeScore);
  });

  it('low confidence is downgraded to abstained, not accepted', () => {
    const fold = foldInquiry(r, answering(LIKELIHOOD_Q, { likelihood: 0, confidence: 0.1 }).ask(r), T_LIKELIHOOD);
    expect(fold.effectiveOutcome).toBe('abstained');
    expect(fold.usable).toBe(false);
    expect(fold.score).toBe(LIKELIHOOD_Q.failsafeScore);
  });

  it('a replayed signal bound to another question version does not verify', () => {
    const v1 = req(LIKELIHOOD_Q);
    const sig = answering(LIKELIHOOD_Q, { likelihood: 0 }).ask(v1);
    const v2 = req({ ...LIKELIHOOD_Q, version: 2 });
    const fold = foldInquiry(v2, sig, T_LIKELIHOOD);
    expect(fold.usable).toBe(false);
    expect(fold.reasons.join(' ')).toMatch(/contentHash does not bind|different question/);
  });
});

describe('admission is checked before the provider is consulted', () => {
  it('a request outside the provider allowlist never reaches the provider', () => {
    const p = new CountingProvider(answering(LIKELIHOOD_Q, { likelihood: 0 }));
    const r = req(LIKELIHOOD_Q, { allowedProviders: ['someone-else'] });
    const sig = askGoverned(r, p);
    expect(p.calls).toBe(0);
    expect(sig.outcome).toBe('invalid');
  });

  it('classified state never reaches an uncleared provider', () => {
    const p = new CountingProvider(answering(LIKELIHOOD_Q, { likelihood: 0 })); // cleared to 'internal'
    const r = req(LIKELIHOOD_Q, { classification: 'restricted' });
    expect(admitInquiry(r, p).ok).toBe(false);
    askGoverned(r, p);
    expect(p.calls).toBe(0);
  });

  it('an inquiry with no task id is refused — no task, no inquiry', () => {
    const p = new CountingProvider(answering(LIKELIHOOD_Q, { likelihood: 0 }));
    const r = req(LIKELIHOOD_Q, { taskId: '' });
    expect(validateInquiryRequest(r).ok).toBe(false);
    askGoverned(r, p);
    expect(p.calls).toBe(0);
  });

  it('an empty allowlist means nobody, not everybody', () => {
    const r = req(LIKELIHOOD_Q, { allowedProviders: [] });
    expect(validateInquiryRequest(r).ok).toBe(false);
  });

  it('classification ranking refuses unknown levels', () => {
    expect(classificationPermitted('restricted', 'internal')).toBe(true);
    expect(classificationPermitted('internal', 'restricted')).toBe(false);
    expect(classificationPermitted('public', 'public')).toBe(true);
    expect(classificationPermitted('bogus' as never, 'public')).toBe(false);
  });
});

describe('shadow mode records without acting', () => {
  it('produces a record marked shadow and mutates nothing', () => {
    const r = req(LIKELIHOOD_Q);
    const p = new CountingProvider(answering(LIKELIHOOD_Q, { likelihood: 0.9 }));
    const before = JSON.stringify(r);
    const rec = shadowInquiry(r, p, T_LIKELIHOOD);
    expect(rec.shadow).toBe(true);
    expect(rec.schema).toBe(INQUIRY_SCHEMA);
    expect(rec.wouldContribute).toEqual({ [CAT_EXFIL]: 9 });
    expect(JSON.stringify(r)).toBe(before);           // request untouched
    expect(p.calls).toBe(1);                           // provider consulted, nothing else
  });

  it('shadow and live folds agree for the same inputs', () => {
    const r = req(LIKELIHOOD_Q);
    const p = answering(LIKELIHOOD_Q, { likelihood: 0.9 });
    const rec = shadowInquiry(r, p, T_LIKELIHOOD);
    const live = foldInquiry(r, askGoverned(r, p), T_LIKELIHOOD);
    expect(rec.wouldContribute).toEqual(live.categories);
    expect(rec.score).toBe(live.score);
  });
});

describe('provenance binds a signal to a question version', () => {
  it('bumping the question version changes the hash', () => {
    const h1 = inquiryHash(req(LIKELIHOOD_Q));
    const h2 = inquiryHash(req({ ...LIKELIHOOD_Q, version: 2 }));
    expect(h1).not.toBe(h2);
  });

  it('rewording the statement changes the hash', () => {
    const h1 = inquiryHash(req(LIKELIHOOD_Q));
    const h2 = inquiryHash(req({ ...LIKELIHOOD_Q, statement: 'Something subtly different.' }));
    expect(h1).not.toBe(h2);
  });

  it('option order does not change the hash — canonical, order-independent', () => {
    const a = inquiryHash(req(CHOICE_Q));
    const b = inquiryHash(req({ ...CHOICE_Q, options: ['external', 'read', 'write'] }));
    expect(a).toBe(b);
  });
});

describe('question-structure linting', () => {
  it('rejects a choice question with fewer than two options', () => {
    expect(validateQuestion({ ...CHOICE_Q, options: ['only'] }).ok).toBe(false);
  });
  it('rejects duplicate options', () => {
    expect(validateQuestion({ ...CHOICE_Q, options: ['a', 'a'] }).ok).toBe(false);
  });
  it('rejects a category outside the 50-category matrix', () => {
    expect(validateQuestion({ ...LIKELIHOOD_Q, category: 99 }).ok).toBe(false);
    expect(validateQuestion({ ...LIKELIHOOD_Q, category: 0 }).ok).toBe(false);
  });
  it('rejects kind/shape mismatches', () => {
    expect(validateQuestion({ ...LIKELIHOOD_Q, levels: 5 }).ok).toBe(false);
    expect(validateQuestion({ ...CHOICE_Q, levels: 3 }).ok).toBe(false);
  });
  it('rejects likelihood bands that do not cover up to 1', () => {
    const t: InquiryThresholds = { minConfidence: 0.5, likelihoodBands: [{ upTo: 0.5, score: 3 }] };
    expect(validateThresholds(LIKELIHOOD_Q, t).ok).toBe(false);
  });
  it('rejects a level scale whose threshold array is the wrong length', () => {
    expect(validateThresholds(LEVEL_Q, { minConfidence: 0.5, levelScores: [1, 2] }).ok).toBe(false);
  });
});

describe('local and HTTP providers satisfy the same contract', () => {
  it('a parsed HTTP body folds identically to the equivalent fixture', () => {
    const r = req(CHOICE_Q);
    const viaFixture = foldInquiry(r, answering(CHOICE_Q, { selected: 'external', confidence: 0.9, latencyMs: 12 }).ask(r), T_CHOICE);
    const viaHttp = foldInquiry(
      r,
      parseInquirySignal(r, 'http', 'sysone', '1', { selected: 'external', confidence: 0.9 }, 12),
      T_CHOICE,
    );
    expect(viaHttp.categories).toEqual(viaFixture.categories);
    expect(viaHttp.usable).toBe(viaFixture.usable);
  });

  it('the HTTP builder never bakes in a default endpoint', () => {
    expect(() => buildInquiryHttpRequest(req(CHOICE_Q), '', 'm')).toThrow();
    expect(() => buildInquiryHttpRequest(req(CHOICE_Q), 'not-a-url', 'm')).toThrow();
    const built = buildInquiryHttpRequest(req(CHOICE_Q), 'http://127.0.0.1:8080/', 'm');
    expect(built.url).toBe('http://127.0.0.1:8080/v1/systemone');
    expect(built.timeoutMs).toBe(5000);
  });

  it('trims trailing slashes in linear time (CodeQL js/polynomial-redos)', () => {
    const many = '/'.repeat(200_000);
    expect(buildInquiryHttpRequest(req(CHOICE_Q), `http://127.0.0.1:8080${many}`, 'm').url)
      .toBe('http://127.0.0.1:8080/v1/systemone');
    // A long run of '/' followed by another character was the quadratic case for /\/+$/.
    const odd = `http://127.0.0.1:8080${many}x`;
    expect(buildInquiryHttpRequest(req(CHOICE_Q), odd, 'm').url).toBe(`${odd}/v1/systemone`);
  });

  it('a hostile HTTP body cannot forge the question it answered', () => {
    const r = req(CHOICE_Q);
    const sig = parseInquirySignal(r, 'http', 'sysone', '1', { questionId: 'other.question', selected: 'read', confidence: 1 });
    expect(sig.outcome).toBe('invalid');
    expect(foldInquiry(r, sig, T_CHOICE).usable).toBe(false);
  });

  it('a hostile HTTP body cannot select an undeclared option', () => {
    const r = req(CHOICE_Q);
    const sig = parseInquirySignal(r, 'http', 'sysone', '1', { selected: 'root-shell', confidence: 1 });
    expect(sig.outcome).toBe('invalid');
  });
});

describe('rules-only provider', () => {
  it('answers deterministically and folds like any other provider', () => {
    const rules = new RulesInquiryProvider({
      [CHOICE_Q.id]: (r) => ({ selected: String((r.state as { tool?: string }).tool ?? '').startsWith('net.') ? 'external' : 'read' }),
    });
    const r = req(CHOICE_Q);
    const fold = foldInquiry(r, askGoverned(r, rules), T_CHOICE);
    expect(fold.usable).toBe(true);
    expect(fold.categories).toEqual({ [CAT_EXFIL]: 9 });
  });

  it('a rule that declines abstains rather than guessing', () => {
    const rules = new RulesInquiryProvider({ [CHOICE_Q.id]: () => undefined });
    const r = req(CHOICE_Q);
    expect(askGoverned(r, rules).outcome).toBe('abstained');
  });

  it('a rule that throws fails closed', () => {
    const rules = new RulesInquiryProvider({ [CHOICE_Q.id]: () => { throw new Error('bad rule'); } });
    const r = req(CHOICE_Q);
    const sig = askGoverned(r, rules);
    expect(sig.outcome).toBe('invalid');
    expect(foldInquiry(r, sig, T_CHOICE).score).toBe(CHOICE_Q.failsafeScore);
  });
});

describe('calibration records are not self-certifying', () => {
  const base: InquiryCalibration = {
    schema: INQUIRY_SCHEMA, schemaVersion: 1,
    questionId: LIKELIHOOD_Q.id, questionVersion: 1,
    provider: 'fixture', model: 'fixture', modelVersion: '1',
    cases: { total: 100, trainingN: 70, heldOutN: 30 },
    observed: { truePositive: 20, falsePositive: 3, trueNegative: 70, falseNegative: 7, abstained: 0, unavailable: 0, invalid: 0 },
    candidateThresholds: T_LIKELIHOOD,
    notes: [],
  };
  const now = '2026-09-01T00:00:00.000Z';

  it('an unapproved calibration is not valid', () => {
    expect(treatCalibrationAsValid(base, now)).toBe(false);
  });
  it('an approved calibration with no expiry is not valid', () => {
    expect(treatCalibrationAsValid({ ...base, approvedThresholds: T_LIKELIHOOD, reviewer: 'scott', approvedAt: now }, now)).toBe(false);
  });
  it('an expired calibration is not valid', () => {
    const c = { ...base, approvedThresholds: T_LIKELIHOOD, reviewer: 'scott', approvedAt: now, expiresAt: '2026-08-01T00:00:00.000Z' };
    expect(treatCalibrationAsValid(c, now)).toBe(false);
  });
  it('an approved, unexpired calibration is valid', () => {
    const c = { ...base, approvedThresholds: T_LIKELIHOOD, reviewer: 'scott', approvedAt: now, expiresAt: '2027-01-01T00:00:00.000Z' };
    expect(treatCalibrationAsValid(c, now)).toBe(true);
  });
});
