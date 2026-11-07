// Bounded semantic inquiry (ring 1) — typed questions in, advisory signals out, NEVER authorization.
//
// Why this module exists, and why it is shaped the way it is.
//
// detectors.ts:1-8 already states the constraint this module has to live inside: "a constrained
// semantic classifier is deliberately not implemented here — it would need a model call, and
// governance-core stays network-free and off the PDP's synchronous hot path by design." pdp.ts is
// synchronous and pure, and pdp.determinism.test.ts pins 1000 identical calls to identical JSON. A
// model call on that path would break both the invariant and the test.
//
// So this module does NOT sit on the PDP path. It produces a typed signal that enters governance the
// one sanctioned way detectors.ts:2-5 names: as CategoryScores handed to the single scorer in
// score.ts. "INPUTS to the one risk scorer, never a second scoring path." There is exactly one
// scorer and one reducer in Starfish; this adds neither.
//
// THE KEYSTONE PROPERTY — raise-only monotonicity.
// foldInquiry() can only ever RAISE a category score. It cannot lower one, and it cannot emit a
// verdict. That is what makes a probabilistic input safe to admit into a deny-by-default system: the
// worst a compromised, miscalibrated, hallucinating or hostile provider can do is make Starfish MORE
// cautious. It can cost availability. It can never buy authority. Constitutional principle 7
// ("probabilistic models may classify, score, rank or recommend, but may not directly authorize")
// is therefore enforced structurally rather than by convention — InquirySignal has no allow, deny,
// ask or approve field anywhere on it, so there is no field for a caller to misread as a decision.
//
// FAIL-CLOSED DIRECTION. score.ts clamps a missing or non-finite category to FAILSAFE = 10 (worst);
// confidence.ts deliberately inverts and fails to ZERO because there high confidence is the
// dangerous direction. This module follows score.ts: an absent, late, invalid, abstained or
// low-confidence signal contributes the question's declared failsafe score, which is the *high*
// end. Silence is treated as danger, not as permission.

import { GovernanceError } from './types';
import { sha256 } from './hash';
import type { CategoryId } from './riskmatrix';
import { CATEGORY_COUNT } from './riskmatrix';
import type { CategoryScores } from './score';
import type { Confidentiality } from './wikitypes';

// ---------------------------------------------------------------------------
// Schema identity. Mirrors wikitypes.ts:334-337 (WIKI_SCHEMA / WIKI_SCHEMA_VERSION) so persisted
// and wire-carried inquiry records are versioned from the first commit rather than retrofitted.
// ---------------------------------------------------------------------------

export const INQUIRY_SCHEMA = 'starfish.inquiry' as const;
export const INQUIRY_SCHEMA_VERSION = 1 as const;

/** Category score contributed whenever a signal is not usable. score.ts's FAILSAFE, same value and
 *  same direction — 10 is the worst end of the clamped 1..10 category scale. */
export const INQUIRY_FAILSAFE_SCORE = 10 as const;

/** Floor on a usable signal's contribution. score.ts's SAFE_MIN. A usable, confident, benign answer
 *  contributes 1 — it never contributes 0, because 0 is outside the scorer's clamped domain and
 *  would read as "no evidence" rather than "evidence of safety". */
export const INQUIRY_MIN_SCORE = 1 as const;

// ---------------------------------------------------------------------------
// Bounded question types.
//
// Three kinds, all closed. There is no free-text kind, and that is the point: an unbounded answer
// cannot be validated, cannot be calibrated against a held-out set, and cannot be folded into a
// numeric category without an interpretation step that would itself need governing.
//
//   choice     — pick exactly one member of a closed, ordered-irrelevant set
//   level      — pick one position on an ordered scale 1..levels
//   likelihood — probability, 0..1, that a single declared statement is true
// ---------------------------------------------------------------------------

export type InquiryKind = 'choice' | 'level' | 'likelihood';

/** Why a signal is or is not usable. Deliberately NOT a decision vocabulary: none of these values
 *  is allow/deny/ask, and the reducer maps every non-'answered' value to the same fail-closed
 *  contribution. Distinguishing them matters for calibration and for audit, not for authority. */
export type InquiryOutcome =
  | 'answered'      // provider returned a well-formed in-domain answer
  | 'abstained'     // provider declined to answer, or answered below the confidence floor
  | 'unavailable'   // provider unreachable, timed out, or over deadline
  | 'invalid';      // provider answered out of domain, malformed, or for the wrong question

export const INQUIRY_OUTCOMES: readonly InquiryOutcome[] = [
  'answered', 'abstained', 'unavailable', 'invalid',
] as const;

export interface InquiryQuestion {
  id: string;
  /** Monotonic. Bumping it changes the provenance hash (see inquiryHash) and therefore invalidates
   *  any calibration approved against the previous wording. A question is not a prompt you can edit
   *  in place; it is a versioned instrument. */
  version: number;
  kind: InquiryKind;
  /** For 'likelihood', the single statement whose truth is being estimated. For the other kinds,
   *  the question text. Must be non-empty — an unstated question cannot be answered or reviewed. */
  statement: string;
  /** 'choice' only: the closed option set. At least 2, all distinct, all non-empty. */
  options?: readonly string[];
  /** 'level' only: the scale's upper bound. 2..10. */
  levels?: number;
  /** Which of the 50 risk categories (riskmatrix.ts) this question informs. The signal's whole
   *  effect on governance is a contribution to this one category. */
  category: CategoryId;
  /** Score contributed when the signal is not usable. Must be >= the highest score any usable
   *  answer could contribute, so that failing is never cheaper than answering badly. Validated. */
  failsafeScore: number;
}

/** A question asked of a provider. Carries no authority and no credentials. */
export interface InquiryRequest {
  requestId: string;
  /** Required. Constitutional principle 2 — all work is a task. An inquiry with no task cannot be
   *  correlated to anything, so validateInquiryRequest rejects it. Note this is STRICTER than
   *  ToolCall.taskId (types.ts:31), which is optional for backward compatibility. New surface, so
   *  the stricter rule costs nothing. */
  taskId: string;
  policyVersion: string;
  question: InquiryQuestion;
  /** The state the question is asked about. Redaction is the caller's responsibility and is
   *  enforced by classification below — this module never inspects state contents. */
  state: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly string[];
  /** Data classification of `state`. A provider whose declared maxClassification does not cover
   *  this is refused BEFORE the request is built, so classified state cannot leave by accident. */
  classification: Confidentiality;
  deadlineMs: number;
  /** Optional allowlist of provider ids. Empty array means "none permitted" and fails closed;
   *  undefined means "no restriction declared at the request level". */
  allowedProviders?: readonly string[];
}

/** What a provider returns. Note what is absent: there is no allow, deny, ask, approve or verdict
 *  field. A signal is evidence. Only the deterministic scorer and the PDP produce decisions. */
export interface InquirySignal {
  requestId: string;
  provider: string;
  model: string;
  modelVersion: string;
  questionId: string;
  questionVersion: number;
  outcome: InquiryOutcome;
  /** Populated for 'choice' when outcome is 'answered'. */
  selected?: string;
  /** Populated for 'level' when outcome is 'answered'. 1..question.levels. */
  level?: number;
  /** Populated for 'likelihood' when outcome is 'answered'. 0..1. */
  likelihood?: number;
  /** Provider's own confidence, 0..1. Not correctness. See ADR 0002. */
  confidence: number;
  latencyMs: number;
  warnings: readonly string[];
  /** Deterministic hash over the question identity + request identity this signal answers. Binds a
   *  signal to the exact question version it was produced for, so a signal cannot be replayed
   *  against a reworded question. Computed by inquiryHash(). */
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Provenance hashing. Canonical field order, sorted keys — mirrors wiki.ts:61-69 contentHashOf.
// ---------------------------------------------------------------------------

/** Deterministic hash binding a signal to the exact question it answers. Question VERSION is inside
 *  the hash, so rewording a question produces a different hash and any signal or calibration bound
 *  to the old wording stops verifying. */
export function inquiryHash(req: Pick<InquiryRequest, 'requestId' | 'taskId' | 'policyVersion' | 'question'>): string {
  const q = req.question;
  return sha256(JSON.stringify({
    schema: INQUIRY_SCHEMA,
    schemaVersion: INQUIRY_SCHEMA_VERSION,
    requestId: req.requestId,
    taskId: req.taskId,
    policyVersion: req.policyVersion,
    questionId: q.id,
    questionVersion: q.version,
    kind: q.kind,
    statement: q.statement,
    options: q.options ? [...q.options].sort() : null,
    levels: q.levels ?? null,
    category: q.category,
  }));
}

// ---------------------------------------------------------------------------
// Question-structure linting. A malformed question is a governance defect, not a runtime warning:
// it cannot be calibrated, and an uncalibrated question folded into risk is an unbacked number.
// ---------------------------------------------------------------------------

export interface InquiryLint { ok: boolean; problems: readonly string[]; }

export function validateQuestion(q: InquiryQuestion): InquiryLint {
  const problems: string[] = [];
  if (!q.id || !q.id.trim()) problems.push('question id is empty');
  if (!Number.isInteger(q.version) || q.version < 1) problems.push('question version must be an integer >= 1');
  if (!q.statement || !q.statement.trim()) problems.push('question statement is empty');
  if (!Number.isInteger(q.category) || q.category < 1 || q.category > CATEGORY_COUNT) {
    problems.push(`question category must be an integer 1..${CATEGORY_COUNT}`);
  }
  if (!Number.isFinite(q.failsafeScore) || q.failsafeScore < INQUIRY_MIN_SCORE || q.failsafeScore > INQUIRY_FAILSAFE_SCORE) {
    problems.push(`failsafeScore must be ${INQUIRY_MIN_SCORE}..${INQUIRY_FAILSAFE_SCORE}`);
  }
  if (q.kind === 'choice') {
    const opts = q.options ?? [];
    if (opts.length < 2) problems.push('choice question needs at least 2 options');
    if (opts.some((o) => !o || !o.trim())) problems.push('choice options must all be non-empty');
    if (new Set(opts).size !== opts.length) problems.push('choice options must be distinct');
    if (q.levels !== undefined) problems.push('choice question must not declare levels');
  } else if (q.kind === 'level') {
    if (!Number.isInteger(q.levels) || (q.levels as number) < 2 || (q.levels as number) > 10) {
      problems.push('level question needs an integer levels 2..10');
    }
    if (q.options !== undefined) problems.push('level question must not declare options');
  } else if (q.kind === 'likelihood') {
    if (q.options !== undefined) problems.push('likelihood question must not declare options');
    if (q.levels !== undefined) problems.push('likelihood question must not declare levels');
  } else {
    problems.push(`unknown question kind: ${String((q as { kind: unknown }).kind)}`);
  }
  return { ok: problems.length === 0, problems };
}

export function validateInquiryRequest(req: InquiryRequest): InquiryLint {
  const problems: string[] = [...validateQuestion(req.question).problems];
  if (!req.requestId || !req.requestId.trim()) problems.push('requestId is empty');
  if (!req.taskId || !req.taskId.trim()) problems.push('taskId is empty (no task, no inquiry)');
  if (!req.policyVersion || !req.policyVersion.trim()) problems.push('policyVersion is empty');
  if (!Number.isFinite(req.deadlineMs) || req.deadlineMs <= 0) problems.push('deadlineMs must be > 0');
  if (req.allowedProviders && req.allowedProviders.length === 0) {
    problems.push('allowedProviders is an empty list — no provider is permitted (fail-closed)');
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Thresholds. Deterministic code owns these — constitutional principle 6. A model never chooses the
// threshold it is judged against, and a threshold set is invalid unless it is COMPLETE for the
// question it governs. An incomplete set fails closed rather than falling back to a default,
// because a silently-defaulted threshold is indistinguishable from a configured one in audit.
// ---------------------------------------------------------------------------

export interface InquiryThresholds {
  /** Below this provider-reported confidence, a well-formed answer is downgraded to 'abstained'. */
  minConfidence: number;
  /** 'choice': option -> category score. MUST cover every declared option. */
  choiceScores?: Readonly<Record<string, number>>;
  /** 'level': index 0 is level 1. MUST have exactly question.levels entries. */
  levelScores?: readonly number[];
  /** 'likelihood': ascending probability cut-points, each with the score at or below that bound.
   *  MUST end at 1. */
  likelihoodBands?: readonly { upTo: number; score: number }[];
}

function thresholdProblems(q: InquiryQuestion, t: InquiryThresholds | undefined): string[] {
  const problems: string[] = [];
  if (!t) return ['no thresholds configured for this question (fail-closed)'];
  if (!Number.isFinite(t.minConfidence) || t.minConfidence < 0 || t.minConfidence > 1) {
    problems.push('minConfidence must be 0..1');
  }
  const inRange = (n: unknown) => Number.isFinite(n) && (n as number) >= INQUIRY_MIN_SCORE && (n as number) <= INQUIRY_FAILSAFE_SCORE;
  if (q.kind === 'choice') {
    const map = t.choiceScores;
    if (!map) problems.push('choice question has no choiceScores');
    else {
      for (const o of q.options ?? []) {
        if (!(o in map)) problems.push(`choiceScores is missing option "${o}"`);
        else if (!inRange(map[o])) problems.push(`choiceScores["${o}"] out of range`);
      }
    }
  } else if (q.kind === 'level') {
    const arr = t.levelScores;
    if (!arr) problems.push('level question has no levelScores');
    else if (arr.length !== q.levels) problems.push(`levelScores must have exactly ${q.levels} entries, got ${arr.length}`);
    else if (!arr.every(inRange)) problems.push('levelScores contains an out-of-range score');
  } else if (q.kind === 'likelihood') {
    const bands = t.likelihoodBands;
    if (!bands || bands.length === 0) problems.push('likelihood question has no likelihoodBands');
    else {
      let prev = -1;
      for (const b of bands) {
        if (!Number.isFinite(b.upTo) || b.upTo <= prev || b.upTo > 1) problems.push('likelihoodBands must ascend within 0..1');
        if (!inRange(b.score)) problems.push('likelihoodBands contains an out-of-range score');
        prev = b.upTo;
      }
      if (bands[bands.length - 1].upTo !== 1) problems.push('likelihoodBands must end at upTo = 1 (total coverage)');
    }
  }
  return problems;
}

export function validateThresholds(q: InquiryQuestion, t: InquiryThresholds | undefined): InquiryLint {
  const problems = thresholdProblems(q, t);
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// The provider boundary.
//
// Synchronous, because ring 1 is network-free and the whole package is synchronous. An in-core
// provider is therefore either a fixture or a pure rules evaluation. Network-backed providers do
// NOT implement this interface; they use the request-builder pair below, exactly as provider.ts's
// AgentRuntimeAdapter builds a RuntimeRequest it never sends.
// ---------------------------------------------------------------------------

export interface InquiryProvider {
  readonly id: string;
  readonly model: string;
  readonly modelVersion: string;
  /** Highest data classification this provider may receive. Checked before any request is handed
   *  over, so classified state cannot reach a provider that is not cleared for it. */
  readonly maxClassification: Confidentiality;
  ask(req: InquiryRequest): InquirySignal;
}

const CLASSIFICATION_RANK: Record<Confidentiality, number> = {
  public: 0, internal: 1, sensitive: 2, restricted: 3,
};

/** True when `provider` is cleared for `level`. Unknown values rank highest (most restricted) so an
 *  unrecognised classification is refused rather than waved through. */
export function classificationPermitted(provider: Confidentiality, level: Confidentiality): boolean {
  const p = CLASSIFICATION_RANK[provider] ?? Number.MAX_SAFE_INTEGER;
  const l = CLASSIFICATION_RANK[level] ?? Number.MAX_SAFE_INTEGER;
  return p >= l && p !== Number.MAX_SAFE_INTEGER && l !== Number.MAX_SAFE_INTEGER;
}

function unusable(req: InquiryRequest, providerId: string, model: string, modelVersion: string, outcome: InquiryOutcome, warning: string): InquirySignal {
  return {
    requestId: req.requestId,
    provider: providerId,
    model,
    modelVersion,
    questionId: req.question.id,
    questionVersion: req.question.version,
    outcome,
    confidence: 0,
    latencyMs: 0,
    warnings: [warning],
    contentHash: inquiryHash(req),
  };
}

/** Deterministic fixture provider. Answers from a canned table keyed by `questionId:questionVersion`,
 *  so a fixture bound to v1 of a question does NOT silently answer v2 — it reports 'unavailable'.
 *  This is what makes offline conformance meaningful rather than self-confirming. */
export class FixtureInquiryProvider implements InquiryProvider {
  readonly id: string;
  readonly model = 'fixture';
  readonly modelVersion = `${INQUIRY_SCHEMA_VERSION}`;
  readonly maxClassification: Confidentiality;
  private table: Map<string, Partial<InquirySignal>>;

  constructor(
    fixtures: Readonly<Record<string, Partial<InquirySignal>>> = {},
    id = 'fixture',
    maxClassification: Confidentiality = 'restricted',
  ) {
    this.id = id;
    this.maxClassification = maxClassification;
    this.table = new Map(Object.entries(fixtures));
  }

  static key(questionId: string, questionVersion: number): string { return `${questionId}:${questionVersion}`; }

  set(questionId: string, questionVersion: number, signal: Partial<InquirySignal>): void {
    this.table.set(FixtureInquiryProvider.key(questionId, questionVersion), signal);
  }

  ask(req: InquiryRequest): InquirySignal {
    const hit = this.table.get(FixtureInquiryProvider.key(req.question.id, req.question.version));
    if (!hit) return unusable(req, this.id, this.model, this.modelVersion, 'unavailable', 'no fixture for this question version');
    return {
      ...unusable(req, this.id, this.model, this.modelVersion, 'answered', ''),
      warnings: hit.warnings ?? [],
      ...hit,
      // Identity is never taken from the fixture — a fixture cannot forge which question it answered.
      requestId: req.requestId,
      questionId: req.question.id,
      questionVersion: req.question.version,
      contentHash: inquiryHash(req),
    };
  }
}

/** Rules-only provider. No model, no network, no probability: it answers from deterministic
 *  predicates over the request state. Useful as the always-available baseline, and as the control
 *  arm when calibrating a model-backed provider in shadow mode. */
export class RulesInquiryProvider implements InquiryProvider {
  readonly id: string;
  readonly model = 'rules';
  readonly modelVersion = `${INQUIRY_SCHEMA_VERSION}`;
  readonly maxClassification: Confidentiality = 'restricted';
  private rules: Map<string, (req: InquiryRequest) => Partial<InquirySignal> | undefined>;

  constructor(
    rules: Readonly<Record<string, (req: InquiryRequest) => Partial<InquirySignal> | undefined>> = {},
    id = 'rules',
  ) {
    this.id = id;
    this.rules = new Map(Object.entries(rules));
  }

  ask(req: InquiryRequest): InquirySignal {
    const rule = this.rules.get(req.question.id);
    if (!rule) return unusable(req, this.id, this.model, this.modelVersion, 'unavailable', 'no rule for this question');
    let out: Partial<InquirySignal> | undefined;
    try { out = rule(req); } catch {
      return unusable(req, this.id, this.model, this.modelVersion, 'invalid', 'rule threw (fail-closed)');
    }
    if (!out) return unusable(req, this.id, this.model, this.modelVersion, 'abstained', 'rule declined to answer');
    return {
      ...unusable(req, this.id, this.model, this.modelVersion, 'answered', ''),
      // A rule is deterministic, so it reports full confidence in its own output. That is a claim
      // about determinism, not about correctness.
      confidence: 1,
      warnings: out.warnings ?? [],
      ...out,
      requestId: req.requestId,
      questionId: req.question.id,
      questionVersion: req.question.version,
      contentHash: inquiryHash(req),
    };
  }
}

// ---------------------------------------------------------------------------
// Optional HTTP adapter — request BUILDER only. Mirrors provider.ts:34-38: the core builds, a
// higher ring sends. Nothing here opens a socket, so ring 1 stays network-free and unit tests
// cannot accidentally reach the network.
// ---------------------------------------------------------------------------

export interface InquiryHttpRequest {
  method: 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
  timeoutMs: number;
}

/** Drops trailing '/' characters. A loop, not /\/+$/: that regex is quadratic on a long run of '/'
 *  followed by another character, and `baseUrl` is caller input (CodeQL js/polynomial-redos). */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0x2f) end--;
  return s.slice(0, end);
}

/** Builds a System One-compatible request. `baseUrl` is the caller's; no default endpoint is baked
 *  in, because a default endpoint is a silent cloud fallback and those are forbidden. */
export function buildInquiryHttpRequest(req: InquiryRequest, baseUrl: string, model: string): InquiryHttpRequest {
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new GovernanceError('inquiry: baseUrl must be an absolute http(s) URL');
  const q = req.question;
  return {
    method: 'POST',
    url: `${trimTrailingSlashes(baseUrl)}/v1/systemone`,
    headers: { 'content-type': 'application/json' },
    timeoutMs: req.deadlineMs,
    body: {
      schema: INQUIRY_SCHEMA,
      schemaVersion: INQUIRY_SCHEMA_VERSION,
      model,
      question: {
        id: q.id, version: q.version, kind: q.kind, statement: q.statement,
        options: q.options ?? null, levels: q.levels ?? null,
      },
      state: req.state,
      evidenceRefs: req.evidenceRefs,
      deadlineMs: req.deadlineMs,
    },
  };
}

/** Parses an untrusted HTTP body into a signal. Anything unexpected becomes 'invalid' rather than
 *  throwing, so a hostile or broken endpoint produces a fail-closed contribution instead of an
 *  exception that a caller might catch and ignore. */
export function parseInquirySignal(req: InquiryRequest, providerId: string, model: string, modelVersion: string, body: unknown, latencyMs = 0): InquirySignal {
  const base = unusable(req, providerId, model, modelVersion, 'invalid', 'unparseable provider response');
  if (typeof body !== 'object' || body === null) return base;
  const b = body as Record<string, unknown>;
  const q = req.question;
  // A response that names a different question version is a replay, not an answer.
  if (b.questionId !== undefined && b.questionId !== q.id) return { ...base, warnings: ['response questionId does not match request'] };
  if (b.questionVersion !== undefined && b.questionVersion !== q.version) return { ...base, warnings: ['response questionVersion does not match request'] };
  const confidence = typeof b.confidence === 'number' && Number.isFinite(b.confidence) ? Math.min(1, Math.max(0, b.confidence)) : 0;
  const warnings = Array.isArray(b.warnings) ? b.warnings.filter((w): w is string => typeof w === 'string') : [];
  const answered = (extra: Partial<InquirySignal>): InquirySignal => ({
    ...base, outcome: 'answered', confidence, latencyMs, warnings, ...extra,
  });
  if (b.abstained === true) return { ...base, outcome: 'abstained', confidence, latencyMs, warnings: [...warnings, 'provider abstained'] };
  if (q.kind === 'choice') {
    const sel = b.selected;
    if (typeof sel !== 'string' || !(q.options ?? []).includes(sel)) return { ...base, warnings: [...warnings, 'selected is not a declared option'] };
    return answered({ selected: sel });
  }
  if (q.kind === 'level') {
    const lv = b.level;
    if (typeof lv !== 'number' || !Number.isInteger(lv) || lv < 1 || lv > (q.levels ?? 0)) {
      return { ...base, warnings: [...warnings, 'level is out of the declared scale'] };
    }
    return answered({ level: lv });
  }
  const lk = b.likelihood;
  if (typeof lk !== 'number' || !Number.isFinite(lk) || lk < 0 || lk > 1) {
    return { ...base, warnings: [...warnings, 'likelihood is not a probability in 0..1'] };
  }
  return answered({ likelihood: lk });
}

// ---------------------------------------------------------------------------
// The deterministic fold — the sanctioned seam into score.ts.
//
// This is the only function in the module that governance consults, and it returns CategoryScores,
// not a decision. Every path returns a score in INQUIRY_MIN_SCORE..INQUIRY_FAILSAFE_SCORE for
// exactly one category, so the blast radius of the entire semantic layer is one dimension of a
// 50-dimensional deterministic scorer.
// ---------------------------------------------------------------------------

export interface InquiryFold {
  /** Hand straight to assessRisk(). Always exactly one category. */
  categories: CategoryScores;
  /** Whether the signal was usable. False does NOT mean allow or deny — it means the failsafe score
   *  was contributed instead of an answer-derived one. */
  usable: boolean;
  /** The outcome actually used after threshold and validity checks, which may be a downgrade of
   *  what the provider claimed (e.g. 'answered' below minConfidence becomes 'abstained'). */
  effectiveOutcome: InquiryOutcome;
  score: number;
  /** Deterministic, ordered explanation. Same idea as ConfidenceResult.reasons (confidence.ts:44). */
  reasons: readonly string[];
  contentHash: string;
}

/**
 * Fold a signal into category evidence. Deterministic and total: it never throws and never returns
 * a verdict.
 *
 * RAISE-ONLY. The returned score is the max of the answer-derived score and INQUIRY_MIN_SCORE, and
 * every failure path returns the question's failsafeScore. There is no input — no confidence, no
 * option, no probability — that causes this function to return a score below INQUIRY_MIN_SCORE, and
 * no input that causes it to return a decision. A provider therefore cannot lower Starfish's
 * assessment of anything.
 */
export function foldInquiry(req: InquiryRequest, sig: InquirySignal, thresholds: InquiryThresholds | undefined): InquiryFold {
  const q = req.question;
  const reasons: string[] = [];
  const fail = (outcome: InquiryOutcome, why: string): InquiryFold => {
    reasons.push(why);
    const score = Number.isFinite(q.failsafeScore)
      ? Math.min(INQUIRY_FAILSAFE_SCORE, Math.max(INQUIRY_MIN_SCORE, q.failsafeScore))
      : INQUIRY_FAILSAFE_SCORE;
    return {
      categories: { [q.category]: score } as CategoryScores,
      usable: false, effectiveOutcome: outcome, score, reasons,
      contentHash: inquiryHash(req),
    };
  };

  const qLint = validateQuestion(q);
  if (!qLint.ok) return fail('invalid', `malformed question: ${qLint.problems.join('; ')}`);

  const tLint = validateThresholds(q, thresholds);
  if (!tLint.ok) return fail('invalid', `unusable thresholds: ${tLint.problems.join('; ')}`);
  const t = thresholds as InquiryThresholds;

  if (sig.contentHash !== inquiryHash(req)) return fail('invalid', 'signal contentHash does not bind to this request/question version');
  if (sig.questionId !== q.id || sig.questionVersion !== q.version) return fail('invalid', 'signal answers a different question');
  if (sig.outcome === 'unavailable') return fail('unavailable', 'provider unavailable');
  if (sig.outcome === 'invalid') return fail('invalid', 'provider returned an invalid answer');
  if (sig.outcome === 'abstained') return fail('abstained', 'provider abstained');
  if (sig.outcome !== 'answered') return fail('invalid', `unknown outcome: ${String(sig.outcome)}`);
  if (!Number.isFinite(sig.latencyMs) || sig.latencyMs > req.deadlineMs) return fail('unavailable', 'signal exceeded the request deadline');
  if (!Number.isFinite(sig.confidence) || sig.confidence < t.minConfidence) {
    return fail('abstained', `confidence ${String(sig.confidence)} below floor ${t.minConfidence}`);
  }

  let raw: number | undefined;
  if (q.kind === 'choice') {
    if (typeof sig.selected !== 'string') return fail('invalid', 'choice signal has no selected option');
    if (!(q.options ?? []).includes(sig.selected)) return fail('invalid', `selected "${sig.selected}" is not a declared option`);
    raw = t.choiceScores?.[sig.selected];
    reasons.push(`choice "${sig.selected}"`);
  } else if (q.kind === 'level') {
    if (typeof sig.level !== 'number' || !Number.isInteger(sig.level) || sig.level < 1 || sig.level > (q.levels ?? 0)) {
      return fail('invalid', 'level signal is outside the declared scale');
    }
    raw = t.levelScores?.[sig.level - 1];
    reasons.push(`level ${sig.level}/${q.levels}`);
  } else {
    if (typeof sig.likelihood !== 'number' || !Number.isFinite(sig.likelihood) || sig.likelihood < 0 || sig.likelihood > 1) {
      return fail('invalid', 'likelihood signal is not a probability in 0..1');
    }
    const band = (t.likelihoodBands ?? []).find((b) => (sig.likelihood as number) <= b.upTo);
    raw = band?.score;
    reasons.push(`likelihood ${sig.likelihood}`);
  }
  if (!Number.isFinite(raw)) return fail('invalid', 'no threshold mapping for the answer given');

  const score = Math.min(INQUIRY_FAILSAFE_SCORE, Math.max(INQUIRY_MIN_SCORE, raw as number));
  reasons.push(`category ${q.category} <- ${score} (confidence ${sig.confidence} >= ${t.minConfidence})`);
  return {
    categories: { [q.category]: score } as CategoryScores,
    usable: true, effectiveOutcome: 'answered', score, reasons,
    contentHash: inquiryHash(req),
  };
}

// ---------------------------------------------------------------------------
// Admission. Checked BEFORE a provider is handed a request.
// ---------------------------------------------------------------------------

export interface InquiryAdmission { ok: boolean; reason: string; }

export function admitInquiry(req: InquiryRequest, provider: InquiryProvider): InquiryAdmission {
  const lint = validateInquiryRequest(req);
  if (!lint.ok) return { ok: false, reason: `invalid request: ${lint.problems.join('; ')}` };
  if (req.allowedProviders && !req.allowedProviders.includes(provider.id)) {
    return { ok: false, reason: `provider "${provider.id}" is not in the request's allowedProviders` };
  }
  if (!classificationPermitted(provider.maxClassification, req.classification)) {
    return { ok: false, reason: `provider "${provider.id}" is not cleared for ${req.classification} state` };
  }
  return { ok: true, reason: 'admitted' };
}

/** Ask a provider under admission control. A refused admission never reaches the provider and
 *  yields a fail-closed signal, so "we asked and it said yes" cannot be manufactured by sending a
 *  request that should never have been sent. */
export function askGoverned(req: InquiryRequest, provider: InquiryProvider): InquirySignal {
  const adm = admitInquiry(req, provider);
  if (!adm.ok) return unusable(req, provider.id, provider.model, provider.modelVersion, 'invalid', adm.reason);
  try {
    return provider.ask(req);
  } catch {
    return unusable(req, provider.id, provider.model, provider.modelVersion, 'unavailable', 'provider threw (fail-closed)');
  }
}

// ---------------------------------------------------------------------------
// Shadow mode. Computes what the fold WOULD contribute and records it. Pure: it returns a record
// and performs no audit write, no persistence and no provider mutation. The caller decides whether
// to record it, which is what keeps "shadow" honest — a shadow path that wrote to the live ledger
// would be a side effect by another name.
// ---------------------------------------------------------------------------

export interface ShadowInquiryRecord {
  schema: typeof INQUIRY_SCHEMA;
  schemaVersion: typeof INQUIRY_SCHEMA_VERSION;
  shadow: true;
  requestId: string;
  taskId: string;
  policyVersion: string;
  questionId: string;
  questionVersion: number;
  provider: string;
  model: string;
  modelVersion: string;
  outcome: InquiryOutcome;
  effectiveOutcome: InquiryOutcome;
  /** What the fold would have contributed. Advisory. */
  wouldContribute: CategoryScores;
  score: number;
  usable: boolean;
  reasons: readonly string[];
  contentHash: string;
}

export function shadowInquiry(req: InquiryRequest, provider: InquiryProvider, thresholds: InquiryThresholds | undefined): ShadowInquiryRecord {
  const sig = askGoverned(req, provider);
  const fold = foldInquiry(req, sig, thresholds);
  return {
    schema: INQUIRY_SCHEMA,
    schemaVersion: INQUIRY_SCHEMA_VERSION,
    shadow: true,
    requestId: req.requestId,
    taskId: req.taskId,
    policyVersion: req.policyVersion,
    questionId: req.question.id,
    questionVersion: req.question.version,
    provider: sig.provider,
    model: sig.model,
    modelVersion: sig.modelVersion,
    outcome: sig.outcome,
    effectiveOutcome: fold.effectiveOutcome,
    wouldContribute: fold.categories,
    score: fold.score,
    usable: fold.usable,
    reasons: fold.reasons,
    contentHash: fold.contentHash,
  };
}

// ---------------------------------------------------------------------------
// Calibration records — DURABLE SCHEMA ONLY.
//
// Deliberately incomplete, and saying so is the point. What is implemented here is the record shape
// and the expiry check. What is NOT implemented: the statistics. Nothing in this file computes
// accuracy, calibration error or drift, and no claim of statistical validity should be made from a
// record that was filled in by hand. docs/adr/0002 lists the remaining work.
// ---------------------------------------------------------------------------

export interface InquiryCalibration {
  schema: typeof INQUIRY_SCHEMA;
  schemaVersion: typeof INQUIRY_SCHEMA_VERSION;
  questionId: string;
  questionVersion: number;
  provider: string;
  model: string;
  modelVersion: string;
  /** Counts, not rates — rates are derived so they cannot disagree with their own denominators. */
  cases: { total: number; trainingN: number; heldOutN: number };
  observed: {
    truePositive: number; falsePositive: number;
    trueNegative: number; falseNegative: number;
    abstained: number; unavailable: number; invalid: number;
  };
  candidateThresholds: InquiryThresholds;
  approvedThresholds?: InquiryThresholds;
  reviewer?: string;
  approvedAt?: string;
  /** ISO date. Past this, treatCalibrationAsValid() returns false and the caller must re-validate. */
  expiresAt?: string;
  notes: readonly string[];
}

/** A calibration with no reviewer, no approval or a past expiry is NOT valid. Fail-closed: an
 *  unapproved or stale calibration must not license a threshold in production. */
export function treatCalibrationAsValid(c: InquiryCalibration, nowIso: string): boolean {
  if (!c.approvedThresholds || !c.reviewer || !c.approvedAt) return false;
  if (!c.expiresAt) return false;
  const now = Date.parse(nowIso);
  const exp = Date.parse(c.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(exp)) return false;
  return now < exp;
}
