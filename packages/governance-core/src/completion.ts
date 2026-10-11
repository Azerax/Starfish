// COMPLETION RECEIPTS — the record that separates "the tool said it worked" from "it worked".
//
// See docs/adr/0003-completion-receipt.md. The short version:
//
// `claims.ts` already closes the gap between what an AGENT says and what the SYSTEM observed. It does
// not close the gap between what the system observed and what actually happened. Today the strongest
// thing the ledger can say about a consequential action is "the tool returned success", and every layer
// above treats that as completion. Three materially different situations end up indistinguishable:
// the effect exists; the tool reported success and the effect does not exist; the call was dispatched
// and no response ever came back.
//
// The third is the sharp one, because both obvious implementations are wrong. Treat a lost response as
// failure and a retry double-executes. Treat it as success and the ledger records an effect nobody
// observed. "We do not know" is a distinct answer and there was nowhere to write it down.
//
// WHAT THIS MODULE IS NOT. It is not outcome verification. There is no verifier here and no verifier
// anywhere in the product yet (ADR 0003 §5). The statuses past `returned-success` are reachable and
// tested; nothing in production produces them. This module is the PLACE verification will be recorded,
// and until a Verifier exists it must not be described as more than that.
//
// Determinism. Every function here is pure: no clock, no randomness, no I/O. `at` and `receiptId` are
// inputs, not side effects, so the same arguments always produce byte-identical JSON. `CompletionLedger`
// is the thin impure shell that owns the clock and the audit wiring.
import type { AuditLog } from './audit';
import { sha256 } from './hash';

export const COMPLETION_SCHEMA = 'starfish.completion' as const;
export const COMPLETION_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The status machine
// ---------------------------------------------------------------------------

/** Where a requested effect stands. Nine values rather than a boolean, because the things being
 *  distinguished are genuinely different and a consumer needs to branch on which one it is.
 *
 *  `returned-success` is deliberately NOT the end of the ladder. It is where the industry stops and
 *  where this module starts: the tool's own report about itself, which a governance system has the
 *  same reason to distrust as it distrusts an agent's own report about itself. */
export type CompletionStatus =
  | 'not-executed'        // the call never left — refused, or opened and abandoned
  | 'started'             // dispatched; no response yet
  | 'returned-success'    // the tool said it worked.  NOT completion.
  | 'returned-failure'    // the tool said it did not work (the effect may STILL exist — partial writes)
  | 'response-lost'       // dispatched, no response, outcome genuinely UNKNOWN (not failure)
  | 'verified'            // independent observation confirms the intended effect
  | 'contradicted'        // independent observation refutes it
  | 'unverifiable'        // no verification method exists for this effect — a real answer, not an error
  | 'claimed-unverified'; // an agent asserted completion on evidence that does not support it

export const COMPLETION_STATUSES: readonly CompletionStatus[] = Object.freeze([
  'not-executed', 'started', 'returned-success', 'returned-failure', 'response-lost',
  'verified', 'contradicted', 'unverifiable', 'claimed-unverified',
]);

/** No outbound edges. `not-executed` is NOT terminal: a receipt opens there and may be dispatched. */
export const TERMINAL_COMPLETION_STATUSES: readonly CompletionStatus[] =
  Object.freeze(['verified', 'contradicted', 'unverifiable', 'claimed-unverified']);

/** The statuses a verification step may conclude. Reachable from any state where the call left. */
const VERDICTS: readonly CompletionStatus[] = Object.freeze(['verified', 'contradicted', 'unverifiable']);

function edges(to: readonly CompletionStatus[]): readonly CompletionStatus[] { return Object.freeze([...to]); }

/** Explicit table, the pattern `evidencetypes.ts` already uses — legal transitions are declared, never
 *  inferred from the order of the enum.
 *
 *  `claimed-unverified` is reachable from EVERY non-terminal state, mirroring how `revoked` works in
 *  the threat-evidence lifecycle. An agent can assert completion at any moment, including before any
 *  response has come back, and the record must always be able to answer "that assertion is not
 *  supported" without first having to advance the dispatch state to get there. */
export const ALLOWED_COMPLETION_TRANSITIONS: Readonly<Record<CompletionStatus, readonly CompletionStatus[]>> =
  Object.freeze({
    'not-executed':       edges(['started', 'claimed-unverified']),
    'started':            edges(['returned-success', 'returned-failure', 'response-lost', 'claimed-unverified']),
    'returned-success':   edges([...VERDICTS, 'claimed-unverified']),
    'returned-failure':   edges([...VERDICTS, 'claimed-unverified']),
    'response-lost':      edges([...VERDICTS, 'claimed-unverified']),
    'verified':           edges([]),
    'contradicted':       edges([]),
    'unverifiable':       edges([]),
    'claimed-unverified': edges([]),
  });

export function isTerminalCompletion(s: CompletionStatus): boolean {
  return TERMINAL_COMPLETION_STATUSES.includes(s);
}

/** Unknown values fail closed to `false` — an unrecognised status advances nowhere. */
export function canCompletionTransition(from: CompletionStatus, to: CompletionStatus): boolean {
  const allowed = ALLOWED_COMPLETION_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ---------------------------------------------------------------------------
// The load-bearing predicates
// ---------------------------------------------------------------------------

/** TRUE FOR `verified` ONLY.
 *
 *  This is the whole ADR in one function. `returned-success` is the tool's word for it; proof of
 *  completion is an independent observation of the effect. Making it a predicate rather than a
 *  convention means a caller cannot forget — and means the overclaim has exactly one place to be
 *  audited rather than being re-derived at every call site. */
export function isProvenComplete(s: CompletionStatus): boolean {
  return s === 'verified';
}

/** Is the outcome KNOWN? `response-lost` is the point of this function: it is not failure, and code
 *  that branches `success ? … : failure` silently gets it wrong. A caller deciding whether a retry is
 *  safe must consult this, not the truthiness of a success flag. */
export function outcomeKnown(s: CompletionStatus): boolean {
  return s !== 'started' && s !== 'response-lost';
}

/** May a task be marked complete on this status?
 *
 *  Non-consequential work may complete on `returned-success` — demanding verification of every read
 *  would be friction with no safety return. Consequential work may not: it needs `verified`.
 *
 *  Note which way the asymmetry runs. Consequential effects whose outcome cannot be independently
 *  observed land on `unverifiable` and do NOT complete. That is friction, it is new, and it is
 *  correct — the alternative is a loose verifier that returns `verified` by default, which is worse
 *  than admitting the gap (ADR 0003, rejected alternatives). */
export function canCompleteTask(s: CompletionStatus, opts: { consequential: boolean }): boolean {
  return opts.consequential ? isProvenComplete(s) : (s === 'verified' || s === 'returned-success');
}

// ---------------------------------------------------------------------------
// Bridge to the MCP control plane
// ---------------------------------------------------------------------------

/** `controlplane.ts`'s `McpInvocation.outcome`, widened here so this module does not import it (and
 *  so a status mapping exists before the control plane is wired). */
export type InvocationOutcome = 'not-forwarded' | 'forwarded-ok' | 'forwarded-error' | 'forwarded-lost';

/** Total mapping from a control-plane invocation outcome to a completion status.
 *
 *  This mapping is why `returned-failure` exists at all. The plan this module implements listed eight
 *  statuses and jumped from `returned-success` straight to `response-lost`, but `McpInvocation.outcome`
 *  — written months earlier — already has four values, and `forwarded-error` had nowhere to go. A
 *  caller forced to choose would have labelled a reported failure `not-executed` (false; it executed)
 *  or `returned-success` (false), which is exactly the conflation this module exists to prevent.
 *
 *  Being a function rather than a convention also means the mapping is total: no call site has to
 *  guess, and an unknown value fails closed to the state that claims the least. */
export function statusFromInvocationOutcome(o: InvocationOutcome): CompletionStatus {
  switch (o) {
    case 'not-forwarded':  return 'not-executed';
    case 'forwarded-ok':   return 'returned-success';
    case 'forwarded-error': return 'returned-failure';
    case 'forwarded-lost': return 'response-lost';
    default:               return 'response-lost'; // unknown: claim nothing about the effect
  }
}

// ---------------------------------------------------------------------------
// The effect, and the receipt
// ---------------------------------------------------------------------------

export type EffectKind = 'read' | 'write' | 'exec' | 'network' | 'delete' | 'other';

/** What the call was supposed to DO, fixed at dispatch and sealed.
 *
 *  `consequential` is sealed on purpose. If it were observable-after-the-fact, the cheapest way to
 *  complete a consequential task on a tool's self-report would be to flip the flag afterwards — the
 *  predicate above would then be decorative. Declaring an effect non-consequential is a decision made
 *  before the call, in the open, and it is covered by the hash. */
export interface RequestedEffect {
  kind: EffectKind;
  /** What is being acted on — a path, a URL, a resource id. Not secret-bearing. */
  target: string;
  /** Does this effect change the world in a way that matters? Sealed; see above. */
  consequential: boolean;
  /** Set by a caller that can safely be retried. The Sentinel increment will require this for
   *  anything consequential; this module only records it. */
  idempotencyKey?: string;
  description?: string;
}

/** How an observation was made. `none` is the honest default — an absent method is not a passed check. */
export type VerificationMethod =
  | 'none'                  // nothing was checked
  | 'read-back'             // re-read the target and compared
  | 'state-query'           // queried authoritative state out-of-band
  | 'checksum'              // compared a content commitment
  | 'external-attestation'  // a third party asserted it
  | 'human';                // a person looked

/** How an observation diverged, when it did. Kept coarse and closed — a free-text reason is not a
 *  thing a downstream consumer can branch on, which is the failure of the status quo. */
export type DiscrepancyKind =
  | 'absent'           // the effect is not there at all
  | 'partial'          // some of it happened
  | 'divergent'        // something happened, but not what was asked
  | 'duplicate'        // it happened more than once (the retry-after-lost-response signature)
  | 'unexpected-extra';// it happened, plus something that was not requested

export interface VerificationRecord {
  method: VerificationMethod;
  /** Who or what observed. Never the agent whose effect is being verified — enforced by
   *  `recordVerification`, the same proposer-is-not-approver invariant as `scope.ts:amend`. */
  verifier: string;
  at: string;
  /** Commitments to whatever was looked at. Hashes, never content. */
  evidenceHashes: readonly string[];
  note?: string;
}

export interface CompletionTransition {
  from: CompletionStatus;
  to: CompletionStatus;
  at: string;
  actor: string;
  reason?: string;
}

/** The record itself.
 *
 *  Sealed (fixed at dispatch): schema, ids, effect, inputCommitment, at. Unsealed (observed later):
 *  status, history, response/state commitments, verification, discrepancy, auditSeq.
 *
 *  Sealing an observation would be a mistake in two directions. The visible one: every verification
 *  would look like tamper on the very next transition. The serious one: `recordVerification` takes no
 *  approver, so if it had to re-seal, it would become a sanctioned mutation path for a sealed object —
 *  routing around proposer-is-not-approver exactly as `scope.ts` warns. */
export interface CompletionReceipt {
  readonly schema: typeof COMPLETION_SCHEMA;
  readonly schemaVersion: typeof COMPLETION_SCHEMA_VERSION;

  // --- sealed ---
  readonly receiptId: string;
  readonly taskId: string;
  /** The PDP decision this effect was authorised by. The join key to the decision record. */
  readonly decisionId: string;
  /** The human approval, when the decision was an `ask`. Absent on a straight allow. */
  readonly approvalId?: string;
  /** Starfish's own id for the attempt. */
  readonly invocationId: string;
  readonly effect: RequestedEffect;
  /** Commitment to the arguments as dispatched, so "same effect, different inputs" is detectable. */
  readonly inputCommitment: string;
  /** When the receipt was opened. */
  readonly at: string;
  /** Seal over everything above. */
  readonly hash: string;

  // --- observed; deliberately not sealed ---
  status: CompletionStatus;
  history: readonly CompletionTransition[];
  /** The control plane's id for the forwarded call, and the external ledger's entry id. Correlation
   *  is the whole point: the external activity log and the Starfish chain each know half of what
   *  happened, and without shared ids a reviewer cannot join them. */
  remoteInvocationId?: string;
  externalAuditId?: string;
  /** Commitment to the tool's response. A commitment, not the response — responses carry payloads. */
  responseCommitment?: string;
  /** Commitment to the observed state of the target after the fact. */
  observedStateCommitment?: string;
  verification?: VerificationRecord;
  discrepancy?: DiscrepancyKind;
  /** Where this receipt's latest transition landed on the hash chain. */
  auditSeq?: number;
}

// ---------------------------------------------------------------------------
// Seal
// ---------------------------------------------------------------------------

type SealedFields = Pick<CompletionReceipt,
  'receiptId' | 'taskId' | 'decisionId' | 'approvalId' | 'invocationId' | 'effect' | 'inputCommitment' | 'at'>;

/** Canonical, key-order-independent seal over the fixed-at-dispatch fields. */
function seal(r: SealedFields): string {
  return sha256(JSON.stringify({
    schema: COMPLETION_SCHEMA,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    receiptId: r.receiptId,
    taskId: r.taskId,
    decisionId: r.decisionId,
    approvalId: r.approvalId ?? null,
    invocationId: r.invocationId,
    effect: {
      kind: r.effect.kind,
      target: r.effect.target,
      consequential: r.effect.consequential,
      idempotencyKey: r.effect.idempotencyKey ?? null,
      description: r.effect.description ?? null,
    },
    inputCommitment: r.inputCommitment,
    at: r.at,
  }));
}

export function verifyReceiptSeal(r: CompletionReceipt): { ok: true } | { ok: false; reason: string } {
  return seal(r) === r.hash ? { ok: true } : { ok: false, reason: 'completion-receipt-tampered' };
}

/** Commit to the dispatched arguments. Deterministic for a fixed input; hash only, never the values. */
export function commitInputs(effectTarget: string, input: unknown): string {
  return sha256(JSON.stringify({ target: effectTarget, input: input ?? null }));
}

// ---------------------------------------------------------------------------
// Pure state transitions
// ---------------------------------------------------------------------------

export interface OpenReceiptInput {
  receiptId: string;
  taskId: string;
  decisionId: string;
  approvalId?: string;
  invocationId: string;
  effect: RequestedEffect;
  inputCommitment: string;
  at: string;
}

/** Open a receipt at `not-executed`. Nothing has been dispatched.
 *
 *  Opening at decision time rather than at response time is what makes the "allowed but never ran"
 *  question answerable at all — a question the ledger currently cannot answer, because a call that is
 *  authorised and then quietly abandoned leaves an allow entry and no trace of its non-execution. */
export function openReceipt(i: OpenReceiptInput): CompletionReceipt {
  const sealed: SealedFields = {
    receiptId: i.receiptId,
    taskId: i.taskId,
    decisionId: i.decisionId,
    approvalId: i.approvalId,
    invocationId: i.invocationId,
    effect: { ...i.effect },
    inputCommitment: i.inputCommitment,
    at: i.at,
  };
  return {
    schema: COMPLETION_SCHEMA,
    schemaVersion: COMPLETION_SCHEMA_VERSION,
    ...sealed,
    hash: seal(sealed),
    status: 'not-executed',
    history: Object.freeze([]),
  };
}

/** Observed fields a transition may set. Sealed fields are absent from this type by construction, so
 *  "advance also edited the effect" is a compile error rather than a test we hope someone wrote. */
export type ObservedPatch = Partial<Pick<CompletionReceipt,
  'remoteInvocationId' | 'externalAuditId' | 'responseCommitment' | 'observedStateCommitment'
  | 'verification' | 'discrepancy' | 'auditSeq'>>;

export interface AdvanceInput {
  to: CompletionStatus;
  at: string;
  actor: string;
  reason?: string;
  patch?: ObservedPatch;
}

export type AdvanceResult =
  | { ok: true; receipt: CompletionReceipt }
  | { ok: false; reason: string };

/** Advance a receipt, returning a NEW receipt. Refuses an illegal transition, and refuses to advance
 *  a receipt whose seal no longer matches — so an out-of-band edit to a sealed field is caught at the
 *  next transition rather than at an audit six weeks later. */
export function advance(r: CompletionReceipt, i: AdvanceInput): AdvanceResult {
  const sealOk = verifyReceiptSeal(r);
  if (!sealOk.ok) return { ok: false, reason: sealOk.reason };
  if (!COMPLETION_STATUSES.includes(i.to)) return { ok: false, reason: `unknown-status: ${String(i.to)}` };
  if (!canCompletionTransition(r.status, i.to)) {
    return { ok: false, reason: `illegal-transition: ${r.status} -> ${i.to}` };
  }
  const step: CompletionTransition = Object.freeze({
    from: r.status, to: i.to, at: i.at, actor: i.actor,
    ...(i.reason !== undefined ? { reason: i.reason } : {}),
  });
  return {
    ok: true,
    receipt: { ...r, ...(i.patch ?? {}), status: i.to, history: Object.freeze([...r.history, step]) },
  };
}

/** Record a verification verdict. Separate from `advance` for one reason: the verifier must not be the
 *  actor whose effect is being verified. Same invariant as `scope.ts:amend` and the threat-evidence
 *  approval gate — a party does not get to approve its own work. */
export function recordVerification(
  r: CompletionReceipt,
  v: VerificationRecord,
  verdict: 'verified' | 'contradicted' | 'unverifiable',
  opts: { subjectActor: string; at: string; discrepancy?: DiscrepancyKind; reason?: string },
): AdvanceResult {
  if (!v.verifier || v.verifier === opts.subjectActor) {
    return { ok: false, reason: 'verifier-is-subject: an actor may not verify its own effect' };
  }
  if (verdict === 'verified' && v.method === 'none') {
    return { ok: false, reason: 'no-method: "verified" requires a verification method, not an absent check' };
  }
  if (verdict === 'contradicted' && !opts.discrepancy) {
    return { ok: false, reason: 'no-discrepancy: "contradicted" must say HOW the observation diverged' };
  }
  return advance(r, {
    to: verdict, at: opts.at, actor: v.verifier, reason: opts.reason,
    patch: { verification: v, ...(opts.discrepancy ? { discrepancy: opts.discrepancy } : {}) },
  });
}

// ---------------------------------------------------------------------------
// The impure shell
// ---------------------------------------------------------------------------

/** Owns the clock and the audit wiring; holds no policy. Every decision above is a pure function, so
 *  a test can pin the whole machine without a clock, and this class stays thin enough to eyeball. */
export class CompletionLedger {
  private receipts = new Map<string, CompletionReceipt>();
  constructor(
    private audit?: AuditLog,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  open(i: Omit<OpenReceiptInput, 'at'> & { at?: string }): CompletionReceipt {
    const r = openReceipt({ ...i, at: i.at ?? this.now() });
    this.receipts.set(r.receiptId, r);
    const ev = this.audit?.append({
      actor: r.taskId, domain: 'completion', action: 'completion-opened', target: r.effect.target,
      reason: `effect=${r.effect.kind} consequential=${r.effect.consequential} decision=${r.decisionId}`,
      detail: { receiptId: r.receiptId, invocationId: r.invocationId, inputCommitment: r.inputCommitment },
    });
    if (ev) { const next = { ...r, auditSeq: ev.seq }; this.receipts.set(r.receiptId, next); return next; }
    return r;
  }

  get(receiptId: string): CompletionReceipt | undefined { return this.receipts.get(receiptId); }

  /** Advance a held receipt. Audits BOTH outcomes — a refused transition is a governance event, not a
   *  return value to drop on the floor. */
  advance(receiptId: string, i: Omit<AdvanceInput, 'at'> & { at?: string }): AdvanceResult {
    const r = this.receipts.get(receiptId);
    if (!r) return { ok: false, reason: `unknown-receipt: ${receiptId}` };
    const res = advance(r, { ...i, at: i.at ?? this.now() });
    if (!res.ok) {
      this.audit?.append({
        actor: i.actor, domain: 'completion', action: 'completion-transition-refused',
        target: receiptId, decision: 'deny', reason: res.reason,
      });
      return res;
    }
    const ev = this.audit?.append({
      actor: i.actor, domain: 'completion', action: 'completion-advanced', target: receiptId,
      reason: `${r.status} -> ${res.receipt.status}${i.reason ? `: ${i.reason}` : ''}`,
      detail: { taskId: r.taskId, status: res.receipt.status, proven: isProvenComplete(res.receipt.status) },
    });
    const next = ev ? { ...res.receipt, auditSeq: ev.seq } : res.receipt;
    this.receipts.set(receiptId, next);
    return { ok: true, receipt: next };
  }

  /** Every receipt whose outcome is not yet known. The answer to "what did we authorise and never
   *  confirm?", which is unanswerable today. */
  unknownOutcomes(): readonly CompletionReceipt[] {
    return [...this.receipts.values()].filter((r) => !outcomeKnown(r.status));
  }

  /** Receipts for consequential effects that are NOT proven complete. Includes `returned-success`,
   *  which is the point: a consequential effect sitting on a tool's self-report is an open item. */
  unprovenConsequential(): readonly CompletionReceipt[] {
    return [...this.receipts.values()]
      .filter((r) => r.effect.consequential && !canCompleteTask(r.status, { consequential: true }));
  }
}
