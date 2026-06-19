// @starfish/desktop — the host shell (ring 3) that embeds the composed Governor,
// plus the UI<->governance contract and the user-swappable theme system.
export const VERSION = '0.9.0';
export { createHost, type Host, type HostOptions } from './host';
export { WorktreeRunner, type AgentRunner, type AgentRunSpec, type RunPlan } from './runner';
export { realFsProbe, TrashStore, trashOps, governedCustodianDelete, type TrashEntry } from './fsdelete';
export { FLEET, OPS, ThemeRegistry, displayName, label, type Theme, type ThemeAssets } from './theme';
export type {
  CrewMemberView, DecisionLogEntry, Verdict, BudgetView, MonitorView, CapabilityView, TaskView,
  Channel, Unsubscribe, GovernanceReadApi,
  UiIntent, ActionRequest, ActionResult, GovernanceActionApi, GovernanceBridge,
} from './ui-contract';
