// Metering-events schema for the Azure Marketplace Metering Service API. The metering UNIT is still an
// open decision (docs/design/azure.md Sec 11: per-agent/month, per-decision-volume, or per-governed-hour)
// -- this schema supports all three as named dimensions so picking one later is a config change, not a
// redesign. Shaped to match the real Marketplace Metering Service usage-event contract (documented at
// Microsoft's marketplace API reference): { resourceId, quantity, dimension, effectiveStartTime, planId }.
// NOT YET SUBMITTED to the real API anywhere -- see emitter.ts's header comment for exactly what's stubbed.

export type MeteringDimensionId = 'governed_decision' | 'governed_agent_hour' | 'active_agent_month';

/** One offer plan can expose multiple dimensions; the Partner Center offer configuration is the source
 *  of truth for which dimension IDs actually exist once the offer is created -- these are the proposed
 *  names, not yet registered anywhere. Kept here as the single place that names them, so the emitter,
 *  any dashboard, and the Partner Center listing configuration can't drift out of sync with each other. */
export const METERING_DIMENSIONS: Record<MeteringDimensionId, { displayName: string; unitOfMeasure: string }> = {
  governed_decision: { displayName: 'Governed decision', unitOfMeasure: 'decision' },
  governed_agent_hour: { displayName: 'Governed agent-hour', unitOfMeasure: 'hour' },
  active_agent_month: { displayName: 'Active governed agent (monthly)', unitOfMeasure: 'agent-month' },
};

export interface MarketplaceUsageEvent {
  /** The Managed Application resource ID (or SaaS subscription ID, depending on final offer type --
   *  docs/design/azure.md Sec 4 recommends a Container offer, whose usage events are still submitted
   *  against a resourceId the customer's deployment is tagged with). */
  resourceId: string;
  quantity: number;
  dimension: MeteringDimensionId;
  /** ISO 8601, must be within the Metering Service API's accepted backdating window (documented as
   *  narrow -- effectively "now, or very recently now") -- do not batch stale events. */
  effectiveStartTime: string;
  planId: string;
}

/** A raw, pre-submission accounting record derived from the sidecar's own audit stream -- one per
 *  governed decision, before it's been rolled up into whichever MeteringDimensionId the deployment is
 *  actually configured to bill on. Kept separate from MarketplaceUsageEvent so the rollup logic (sum
 *  decisions -> one event, or count agent-hours -> one event) is swappable without changing what the
 *  sidecar itself records. */
export interface DecisionAccountingRecord {
  seq: number;               // matches the audit log's own seq, for exact reconciliation/dedup
  ts: number;                // epoch ms
  actor: string;
  rootId: string;            // which governed root / tenant this decision belongs to -- the resourceId
                              // mapping happens at rollup time, not here, so this stays tenant-agnostic
  decision: 'allow' | 'ask' | 'deny';
}
