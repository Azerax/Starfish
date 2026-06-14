// @starfish/desktop — the host shell (ring 3 base) that embeds the composed Governor.
export const VERSION = '0.9.0';
export { createHost, type Host, type HostOptions } from './host';
export { FLEET, displayName, label, type Theme } from './theme';
export { WorktreeRunner, type AgentRunner, type AgentRunSpec, type RunPlan } from './runner';
