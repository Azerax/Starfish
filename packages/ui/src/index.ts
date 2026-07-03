// @starfish/ui - embeddable governance dashboard components + the sidecar client. Depends only on the
// sidecar HTTP contract (never on @starfish/governance-core), so the engine stays out of the browser bundle.
export { httpBridge, WIRE, type UiBridge, type PendingItem, type BudgetItem, type MonitorView } from './httpBridge';
export { GovernancePanel, PendingList } from './GovernancePanel';
