// Tier-3 governance: best-effort post-hoc audit ingestion for Foundry's service-executed built-in tools
// (see policy.ts's header comment for why this tier can't be a synchronous gate). This module folds
// Foundry's own run/thread telemetry (via Azure Monitor / Application Insights, wherever the customer's
// Foundry resource sends it) into audit-shaped records -- but NEVER as a 'decision', because nothing
// here decided anything. Foundry ran the tool; this is a record of what happened, arriving after the
// fact, sometimes late, sometimes (if telemetry export is misconfigured) not at all. Conflating that
// with the PDP's own hash-chained, tamper-evident decision log would violate GOVERNANCE.md Sec 3
// Principle 6 (no unbacked word) -- an entry that says "allowed" when nothing ever adjudicated it is
// exactly the kind of unbacked claim that principle exists to prevent.
//
// NOT YET CONNECTED to a real Azure Monitor / Log Analytics workspace -- TelemetrySource below is an
// interface with one real implementation stubbed (throws, deliberately, rather than silently returning
// nothing) and one in-memory fake used by this file's own smoke test. Wiring the real implementation
// needs a Log Analytics workspace ID + KQL query design, which needs a real Foundry resource sending
// telemetry somewhere to design against -- see the implementation plan's manual checklist.

export interface FoundryToolInvocationRecord {
  runId: string;
  threadId: string;
  agentId: string;
  tool: string;              // e.g. 'code_interpreter', 'file_search' -- Foundry's own tool name
  startedAt: string;          // ISO 8601, as reported by telemetry
  finishedAt?: string;
  outcome: 'succeeded' | 'failed' | 'unknown';
  // Deliberately NOT modeling tool inputs/outputs here yet -- what Foundry's telemetry actually exposes
  // per tool type needs checking against a real export once one exists, rather than guessed at.
}

export interface TelemetrySource {
  /** Returns invocation records observed since `sinceIso`. Must be safe to call repeatedly and cheaply
   *  (this is a poll loop, not a push subscription -- Foundry/Azure Monitor doesn't offer webhooks for
   *  this as of the research behind docs/design/azure.md). */
  fetchSince(sinceIso: string): Promise<FoundryToolInvocationRecord[]>;
}

/** The real implementation: NOT written yet. Throws on construction rather than returning a source that
 *  silently yields nothing, so a deployment that forgot to configure this fails loudly at startup
 *  instead of quietly running with a permanently-empty Tier-3 audit trail. */
export function makeAzureMonitorTelemetrySource(_opts: { workspaceId: string; kqlQuery?: string }): TelemetrySource {
  throw new Error(
    'makeAzureMonitorTelemetrySource is not implemented yet -- needs a real Log Analytics workspace to ' +
    'design the KQL query against (what Foundry actually exports is not yet confirmed). See the ' +
    'implementation plan’s manual checklist.',
  );
}

/** In-memory fake for local testing -- NOT for production use. */
export function makeFakeTelemetrySource(records: FoundryToolInvocationRecord[]): TelemetrySource {
  return {
    async fetchSince(sinceIso: string) {
      return records.filter((r) => r.startedAt >= sinceIso);
    },
  };
}

export interface AuditAppender {
  /** Appends one entry to the SAME hash-chained audit log the PDP writes to (governance-core's audit.ts
   *  in the real deployment), tagged so it can never be mistaken for a PDP decision. */
  append(entry: {
    domain: 'foundry-telemetry';   // distinct domain -- never 'threat', 'boundary', etc., which are
                                    // reserved for entries the PDP itself produced
    actor: string;
    action: string;
    target: string;
    observedOutcome: string;       // NOT `decision` -- there is no decision to record here
    reason: string;
  }): void;
}

export class Tier3AuditIngestor {
  // NOT using TypeScript constructor parameter-property shorthand (`private readonly x: T` directly in
  // the constructor signature) -- Node's `--experimental-strip-types` is a pure type-ERASURE mode, and
  // parameter properties require actual code generation (an implicit `this.x = x` the compiler inserts),
  // not just stripping type annotations. Discovered by actually running this file's own smoke test
  // during tonight's final consolidated test pass (see IMPLEMENTATION_PLAN.md Sec 6) -- it threw
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Fixed here by declaring fields explicitly and assigning them in
  // the constructor body, which is plain erasable TypeScript.
  private readonly source: TelemetrySource;
  private readonly sink: AuditAppender;
  private readonly lagMs: number;
  private cursor: string;
  // Dedup ledger for records re-delivered by an overlapping poll window (see pollOnce below) -- keyed by
  // runId+tool since a single run can invoke the same tool more than once, and FoundryToolInvocationRecord
  // has no other unique-invocation identifier. Value is the record's own startedAt, used only to know when
  // it's safe to prune (see the pruning comment in pollOnce).
  private readonly seen: Map<string, string>;

  constructor(
    source: TelemetrySource,
    sink: AuditAppender,
    startFromIso: string = new Date(0).toISOString(),
    // How far behind "now" the cursor is allowed to advance. Found and fixed this session (see the header
    // comment above and IMPLEMENTATION_PLAN.md): the original cursor logic advanced straight to the
    // latest-seen record's finishedAt, with no margin -- fine as long as telemetry always arrives in
    // startedAt order, but this module's own header comment says it can arrive "late" or not at all. A
    // record that started BEFORE an already-ingested record but is reported to this source AFTER it (export
    // lag, retries, out-of-order flush) would have a startedAt earlier than the already-advanced cursor,
    // and fetchSince's `startedAt >= sinceIso` filter would silently exclude it forever -- a permanent,
    // silent gap in exactly the audit trail this module exists to keep complete. Defaulting to 10 minutes;
    // real-world telemetry export lag for Azure Monitor / Application Insights should be checked against
    // an actual Foundry resource once one exists (see the "not yet connected" note above) and this default
    // revisited then.
    lagMs: number = 10 * 60 * 1000,
  ) {
    this.source = source;
    this.sink = sink;
    this.cursor = startFromIso;
    this.lagMs = lagMs;
    this.seen = new Map();
  }

  /** One poll cycle: fetch what's new (which may re-include records from the trailing lag window seen on
   *  a prior poll -- deduped below), append genuinely-new ones (clearly labeled as observed, not decided),
   *  advance the cursor no further than `now - lagMs`. Returns how many NEW records were ingested (re-
   *  delivered duplicates are not counted), for the caller's own logging/metrics.
   *
   *  `now` defaults to the real clock; tests pass an explicit value for determinism -- see
   *  tier3.smoketest.mjs for a worked example of the late-arrival + dedup behavior this exists for. */
  async pollOnce(now: Date = new Date()): Promise<number> {
    const records = await this.source.fetchSince(this.cursor);
    let ingested = 0;
    let maxSeenIso = this.cursor;
    for (const r of records) {
      const key = `${r.runId}:${r.tool}`;
      const stamp = r.finishedAt && r.finishedAt > r.startedAt ? r.finishedAt : r.startedAt;
      if (stamp > maxSeenIso) maxSeenIso = stamp;
      if (this.seen.has(key)) continue; // already ingested in an earlier, overlapping poll -- not a new event
      this.sink.append({
        domain: 'foundry-telemetry',
        actor: r.agentId,
        action: r.tool,
        target: `${r.threadId}/${r.runId}`,
        observedOutcome: r.outcome,
        reason: `Tier-3 post-hoc observation: Foundry service-executed '${r.tool}' ${r.outcome} (run ${r.runId})`,
      });
      this.seen.set(key, r.startedAt);
      ingested++;
    }

    // Never advance past (now - lagMs) -- that trailing margin is what gives a late-arriving record (whose
    // real startedAt is within the margin) a chance to still be fetched on a future poll, at the cost of
    // re-fetching (and deduping, above) some already-ingested records in the overlap. Also never advance
    // past the newest timestamp actually observed this poll -- an idle source shouldn't drag the cursor
    // forward past events nobody has reported yet.
    const safeWatermark = new Date(now.getTime() - this.lagMs).toISOString();
    const candidateCursor = maxSeenIso < safeWatermark ? maxSeenIso : safeWatermark;
    if (candidateCursor > this.cursor) this.cursor = candidateCursor;

    // Prune dedup entries whose startedAt has fallen behind the (now-advanced) cursor -- fetchSince's own
    // `startedAt >= sinceIso` filter means the source will never re-deliver them again, so nothing can ever
    // dedup-match `key` a second time; keeping the entry around would just leak memory in a long-running
    // process.
    for (const [key, startedAt] of this.seen) {
      if (startedAt < this.cursor) this.seen.delete(key);
    }

    return ingested;
  }
}
