// @starfish/governance-core — Ring 1 (Trusted Computing Base).
export const VERSION = '0.4.0';
export const RING = 1 as const;

export * from './types';
export { AuditLog } from './audit';
export { Registry } from './registry';
export { containCheck } from './boundary';
export { RiskEngine } from './risk';
export { PolicyEngine, loadPolicies, type Effect, type PolicyRule } from './policy';
export { TEMPLATES, validateParams, runTemplate } from './templates';
export { TaskLedger, type Task, type TaskStatus, type TaskType, type Origin } from './tasks';
export { TokenGovernor, type Budget, type BudgetStatus } from './tokens';
export { intakeRoute, ingestExternal, type IntakeRoute } from './intake';
export { PDP } from './pdp';
export { MessageRouter, type OutgoingMessage, type DeliveredMessage, type RouteResult, type MessageAct } from './messaging';
export { GovernedMemory, type Evidence, type Claim, type Entity, type DecisionRecord } from './memory';
export { scanEgress } from './containment';
export { sha256 } from './hash';
export { loadGovernor } from './boot';
export type { Governor } from './boot';
