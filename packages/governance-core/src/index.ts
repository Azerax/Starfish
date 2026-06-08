// @starfish/governance-core — Ring 1 (Trusted Computing Base).
export const VERSION = '0.2.0';
export const RING = 1 as const;

export * from './types';
export { AuditLog } from './audit';
export { Registry } from './registry';
export { containCheck } from './boundary';
export { RiskEngine } from './risk';
export { PolicyEngine, loadPolicies, type Effect, type PolicyRule } from './policy';
export { TEMPLATES, validateParams, runTemplate } from './templates';
export { PDP } from './pdp';
export { loadGovernor } from './boot';
export type { Governor } from './boot';
