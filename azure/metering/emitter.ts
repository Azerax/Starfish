// Metering emitter: rolls up DecisionAccountingRecords (schema.ts) into MarketplaceUsageEvents and hands
// them to a UsageEventSubmitter. The rollup math is pure and fully testable offline; the actual HTTP
// submission to Azure's Marketplace Metering Service is NOT implemented tonight -- see
// makeAzureMarketplaceMeteringSubmitter's header for exactly why, matching the same honesty pattern used
// in azure/tier3/telemetry-ingest.ts's makeAzureMonitorTelemetrySource: throw loudly at construction
// rather than silently no-op, so a deployment that forgot to wire this fails at startup, not at billing
// reconciliation time three weeks later.
//
// NOT YET SUBMITTED to the real API anywhere. NOT YET RUN as part of this session's test pass at the
// time this file was written -- see IMPLEMENTATION_PLAN.md Sec 6 (the final consolidated test pass) for
// whether emitter.smoketest.mjs (to be written alongside this) actually ran and what it found.

import type { MarketplaceUsageEvent, MeteringDimensionId, DecisionAccountingRecord } from './schema.ts';
import { METERING_DIMENSIONS } from './schema.ts';

/** Rolls up a batch of DecisionAccountingRecords into however many MarketplaceUsageEvents the configured
 *  dimension implies. Pure function -- no I/O, no clock reads beyond what's passed in -- so it's testable
 *  without a fake server the way the sidecar's own protocol was. Returns [] for an empty batch (nothing
 *  billed, not an error) rather than throwing, since "zero governed decisions this period" is a normal,
 *  valid state (e.g. an idle agent) and should roll up to zero events, not a crash. */
export function rollupToUsageEvents(
  records: readonly DecisionAccountingRecord[],
  opts: {
    dimension: MeteringDimensionId;
    resourceId: string;
    planId: string;
    /** ISO 8601 timestamp to stamp on the resulting event(s). Passed in, never read from the system
     *  clock here, so this stays deterministic and testable -- see schema.ts's note on the Metering
     *  Service API's narrow backdating window; the CALLER is responsible for picking a timestamp close
     *  enough to "now" to be accepted. */
    effectiveStartTime: string;
  },
): MarketplaceUsageEvent[] {
  if (records.length === 0) return [];
  if (!(opts.dimension in METERING_DIMENSIONS)) {
    throw new Error(`rollupToUsageEvents: unknown dimension '${opts.dimension}'`);
  }

  switch (opts.dimension) {
    case 'governed_decision': {
      // One unit per governed decision, regardless of allow/ask/deny -- the product being metered here
      // is "governance was applied," not "governance said yes." A high deny rate should not look like
      // lower usage; that would perversely reward a customer for pointing this at riskier agents less.
      return [{
        resourceId: opts.resourceId,
        quantity: records.length,
        dimension: 'governed_decision',
        effectiveStartTime: opts.effectiveStartTime,
        planId: opts.planId,
      }];
    }
    case 'governed_agent_hour': {
      // One unit per (rootId, calendar-hour-bucket) pair actually seen in this batch -- an agent that's
      // idle for an hour with zero decisions contributes zero hours; an agent that made even one
      // decision in a given hour contributes exactly one hour for that bucket, not a fraction. This
      // undercounts true wall-clock "agent was running" time (this batch only knows about decisions,
      // not idle running time) -- documented here rather than silently assumed away, since it's exactly
      // the kind of gap that should be visible before anyone bills on it.
      const buckets = new Set<string>();
      for (const r of records) {
        const hourBucket = new Date(r.ts - (r.ts % 3_600_000)).toISOString();
        buckets.add(`${r.rootId}::${hourBucket}`);
      }
      return [{
        resourceId: opts.resourceId,
        quantity: buckets.size,
        dimension: 'governed_agent_hour',
        effectiveStartTime: opts.effectiveStartTime,
        planId: opts.planId,
      }];
    }
    case 'active_agent_month': {
      // One unit per distinct rootId seen in this batch, period. Assumes the CALLER only passes records
      // for the current billing month (this function has no calendar awareness) -- a caller that hands
      // it three months of history would get one unit per root for the whole span, which is wrong for
      // this dimension. That's a caller contract, not something this function can enforce from a bare
      // record list, so it's written down here instead.
      const roots = new Set(records.map((r) => r.rootId));
      return [{
        resourceId: opts.resourceId,
        quantity: roots.size,
        dimension: 'active_agent_month',
        effectiveStartTime: opts.effectiveStartTime,
        planId: opts.planId,
      }];
    }
  }
}

export interface UsageEventSubmitter {
  submit(events: readonly MarketplaceUsageEvent[]): Promise<void>;
}

/** The real implementation: NOT written tonight. Submitting usage events to Azure's Marketplace
 *  Metering Service needs an Entra ID access token (client-credentials flow against the Marketplace
 *  Metering resource) and a live offer/plan already published to get a real planId/dimension pairing to
 *  test against -- neither exists yet in this sandbox (no az CLI, no App Registration, no published
 *  offer). Throws at construction, same reasoning as makeAzureMonitorTelemetrySource: a deployment that
 *  forgot to configure real submission should fail loudly at startup, not silently drop every usage
 *  event it ever tries to bill. */
export function makeAzureMarketplaceMeteringSubmitter(_opts: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): UsageEventSubmitter {
  throw new Error(
    'makeAzureMarketplaceMeteringSubmitter is not implemented yet -- needs a real Entra App Registration ' +
    'and a published Marketplace offer/plan to authenticate and submit against. See the implementation ' +
    'plan’s manual checklist (Marketplace/business track).',
  );
}

/** Logs what it would have submitted instead of submitting it. Intended for a dry-run deployment mode
 *  (or local operation before the offer is published) where seeing the rollup output matters more than
 *  actually billing anything -- explicitly NOT a silent no-op; every call is visible in the log. */
export function makeLoggingSubmitter(log: (msg: string) => void = console.log): UsageEventSubmitter {
  return {
    async submit(events) {
      for (const e of events) {
        log(`[metering dry-run] would submit: ${JSON.stringify(e)}`);
      }
    },
  };
}

/** In-memory fake for local testing -- NOT for production use. */
export function makeFakeSubmitter(): UsageEventSubmitter & { submitted: MarketplaceUsageEvent[] } {
  const submitted: MarketplaceUsageEvent[] = [];
  return {
    submitted,
    async submit(events) {
      submitted.push(...events);
    },
  };
}

/** Batches DecisionAccountingRecords in memory and rolls them up to MarketplaceUsageEvents on flush().
 *  Deliberately dumb about scheduling (no internal timer/interval) -- the caller decides when "a billing
 *  period" ends and calls flush(), since that policy differs by dimension (governed_decision might flush
 *  hourly, active_agent_month monthly) and this class shouldn't guess. */
export class MarketplaceMeteringEmitter {
  // NOT using TypeScript constructor parameter-property shorthand -- see Tier3AuditIngestor's
  // (azure/tier3/telemetry-ingest.ts) identical comment; the same ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
  // failure showed up here during tonight's final test pass and got fixed the same way.
  private readonly submitter: UsageEventSubmitter;
  private readonly config: { dimension: MeteringDimensionId; resourceId: string; planId: string };
  private buffer: DecisionAccountingRecord[] = [];

  constructor(submitter: UsageEventSubmitter, config: { dimension: MeteringDimensionId; resourceId: string; planId: string }) {
    this.submitter = submitter;
    this.config = config;
  }

  record(r: DecisionAccountingRecord): void {
    this.buffer.push(r);
  }

  /** Rolls up everything buffered since the last flush and submits it. Returns the events that were
   *  submitted, for the caller's own logging.
   *
   *  Found on review (this class had never been adversarially read before tonight, unlike most of the
   *  rest of this shared surface): the original version cleared `this.buffer` BEFORE awaiting
   *  `submitter.submit()`, with a comment framing that as intentional ("even if submission throws, so a
   *  permanently-failing submitter can't cause unbounded memory growth"). That's true, but the flip side
   *  wasn't written down: a TRANSIENT failure -- a network blip, a 429, a 500 from the Metering Service --
   *  would silently and PERMANENTLY discard the batch. There is no retry queue, no dead-letter store,
   *  nothing durable anywhere else in this module; once `this.buffer = []` ran, that batch of governed
   *  decisions was gone, with only a thrown exception (which the caller might log and move on from) as any
   *  trace it ever existed. For most of this codebase "the caller is expected to alert and address it" is
   *  a fine contract. For a BILLING component, "address it" can't mean anything if the records themselves
   *  are already unrecoverable by the time the alert fires -- that's silent, permanent undercounting of a
   *  customer's real usage, discovered (if ever) only as a revenue discrepancy weeks later with no way to
   *  reconstruct what was lost.
   *
   *  Fixed by putting the batch BACK on failure, prepended so it's retried ahead of (and combined with)
   *  whatever gets recorded before the next flush() call, and re-throwing so the caller's own alerting
   *  still fires exactly as before. This does reintroduce the unbounded-growth risk for a truly,
   *  permanently-dead submitter -- accepted deliberately: silent data loss is strictly worse than a buffer
   *  that grows and is visible via `.pending` for the caller to alert on and cap if it ever matters. */
  async flush(effectiveStartTime: string): Promise<MarketplaceUsageEvent[]> {
    const batch = this.buffer;
    this.buffer = [];
    const events = rollupToUsageEvents(batch, { ...this.config, effectiveStartTime });
    if (events.length > 0) {
      try {
        await this.submitter.submit(events);
      } catch (e) {
        this.buffer = [...batch, ...this.buffer];
        throw e;
      }
    }
    return events;
  }

  /** How many records are currently buffered, unflushed -- for tests/observability, not billing logic. */
  get pending(): number {
    return this.buffer.length;
  }
}
