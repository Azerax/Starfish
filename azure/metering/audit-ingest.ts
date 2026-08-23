// Bridges the real governance-core audit log to the metering emitter (emitter.ts) -- a real, previously
// missing piece found tonight while checking whether emitter.smoketest.mjs actually exercises real audit
// data. It didn't: every existing test constructs DecisionAccountingRecord objects by hand. Nothing in
// this deliverable, until this file, showed how a real audit.jsonl entry becomes one. That gap wasn't
// cosmetic -- attempting the translation against real audit.jsonl files produced by tonight's container
// testing (IMPLEMENTATION_PLAN.md Sec 6h) surfaced two concrete mismatches between the real audit shape
// and DecisionAccountingRecord's schema:
//
//   1. `rootId` isn't a field on a real audit entry at all. Per serve.ts's own multi-tenant design (a
//      sidecar can govern multiple roots, "one token maps to exactly one root's context ... its own
//      governance, broker, audit"), the root identity is implicit in WHICH audit.jsonl a line came from,
//      not encoded in the line itself. The caller of this module -- whoever is polling a specific root's
//      AuditLog -- has to supply it; it cannot be recovered from the entry.
//
//   2. A real audit entry's `decision` field is a strict 'allow'|'deny' binary (governance-core's
//      pdp.ts: `decision: d.allow ? 'allow' : 'deny'`) -- an 'ask' outcome (e.g. "medium-risk escalated
//      (no allow policy)") is persisted as `decision: 'deny'`, string-identical to a hard boundary/policy
//      denial. Confirmed against a real container tonight, not assumed: a genuine ask-path entry
//      (`reason: "medium-risk escalated (no allow policy)"`) carries `"decision":"deny"` in the raw
//      audit.jsonl line, with nothing else in the entry marking it as pending-review rather than
//      rejected. DecisionAccountingRecord's own type claims three states ('allow'|'ask'|'deny'), but
//      'ask' is UNRECOVERABLE from a real entry without fragile reason-string matching (at least four
//      distinct phrasings exist across governance-core's own combine()/ingress() paths: "critical --
//      human approval required", "policy requires human review (ask)", "<tier>-risk escalated (no allow
//      policy)", "shell command reads a secret path -- human approval required"). This module does NOT
//      attempt that string-matching -- it maps every real 'deny' straight through as 'deny', which is a
//      documented, deliberate simplification, not a silent wrong answer. It matters less than it might
//      sound: NONE of emitter.ts's three current rollup dimensions (governed_decision, governed_agent_hour,
//      active_agent_month) branch on `.decision`'s value at all today -- grep-verified, not assumed. If a
//      future dimension ever needs to bill differently for an ask vs. a hard deny, recovering that
//      distinction properly needs governance-core itself to persist `ask` as its own audit field (see
//      IMPLEMENTATION_PLAN.md Sec 7 for this flagged as a shared-code item, same as the other Sec 6d/6f
//      findings) -- not another downstream string-matching workaround here.
//
// Also filters out non-decision audit entries (boot/system/enforcement-posture lines, which have no
// `decision` field at all) -- without this, every container restart would silently inflate the
// governed_decision count with entries nothing ever adjudicated, which is exactly the kind of unbacked
// claim GOVERNANCE.md Sec 3 Principle 6 exists to prevent (the same principle telemetry-ingest.ts's
// header comment invokes for the identical reason).
//
// Deliberately has NO @starfish/* import -- RawAuditEntry below is a minimal, duck-typed shape (just the
// fields this module actually reads), not an import of governance-core's real AuditEvent type. Same
// discipline as telemetry-ingest.ts's AuditAppender interface: this stays testable via
// `node --experimental-strip-types` with no bundling step, and a real caller can pass entries straight
// from `governor.audit.recent(undefined, sinceSeq)` (governance-core's AuditLog, which already supports
// exactly this sinceSeq-cursor read pattern) without needing an adapter class in between.

import type { DecisionAccountingRecord } from './schema.ts';

export interface RawAuditEntry {
  seq: number;
  ts: string;                          // ISO 8601, as governance-core's AuditLog writes it
  actor: string;
  decision?: 'allow' | 'deny';         // absent on non-decision entries (boot, enforcement-posture, etc.)
}

/** Converts one raw audit entry into a DecisionAccountingRecord, or null if the entry isn't a governed
 *  tool decision at all (system/boot/enforcement-posture lines, or anything with no `decision` field). */
export function auditEntryToDecisionRecord(entry: RawAuditEntry, rootId: string): DecisionAccountingRecord | null {
  if (entry.decision !== 'allow' && entry.decision !== 'deny') return null;
  return {
    seq: entry.seq,
    ts: Date.parse(entry.ts),
    actor: entry.actor,
    rootId,
    decision: entry.decision,
  };
}

export interface AuditRecordSource {
  /** Entries with seq > sinceSeq, in ascending seq order -- mirrors governance-core's own
   *  `AuditLog.recent(limit, sinceSeq)` signature closely enough to pass that method directly (bound to
   *  the real AuditLog instance) as this interface's implementation with no adapter needed. */
  recentSince(sinceSeq: number): RawAuditEntry[];
}

export interface MeteringSink {
  record(r: DecisionAccountingRecord): void;
}

/** One poll cycle at a time (same "caller decides scheduling" discipline as Tier3AuditIngestor) --
 *  fetches everything new since the last cursor, translates and records the decision-shaped entries,
 *  advances the cursor past EVERYTHING seen (including filtered-out non-decision entries, so a
 *  boot-heavy period doesn't get re-scanned forever). Returns how many records were actually billed, for
 *  the caller's own logging -- distinct from how many entries were seen, since most real audit logs will
 *  have a mix of decision and non-decision lines. */
export class AuditMeteringIngestor {
  private readonly source: AuditRecordSource;
  private readonly sink: MeteringSink;
  private readonly rootId: string;
  private cursor: number;

  constructor(source: AuditRecordSource, sink: MeteringSink, rootId: string, startFromSeq = -1) {
    this.source = source;
    this.sink = sink;
    this.rootId = rootId;
    this.cursor = startFromSeq;
  }

  pollOnce(): number {
    const entries = this.source.recentSince(this.cursor);
    let billed = 0;
    for (const e of entries) {
      const rec = auditEntryToDecisionRecord(e, this.rootId);
      if (rec) { this.sink.record(rec); billed += 1; }
      this.cursor = e.seq;
    }
    return billed;
  }

  /** For tests/observability -- the seq this ingestor has processed up to. */
  get lastSeq(): number {
    return this.cursor;
  }
}
