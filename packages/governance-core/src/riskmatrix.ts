// The 50-category risk matrix as data — the single source of truth for scoring (mirrors docs/RISK_MATRIX.md,
// kept in sync by riskmatrix.conformance.test.ts). No logic here; the scorer in score.ts consumes this.
// A category is a `floor` if hitting its red band forces at least an Ask regardless of the composite;
// `hardDeny` floors force a Deny. These are the matrix expression of the constitutional hard floors —
// a low composite (score dilution, attack A#1) can never sneak a dangerous single dimension past you.

import type { RiskTier } from './types';

export type CategoryId = number; // 1..50

export interface RiskCategory { id: CategoryId; name: string; floor?: boolean; hardDeny?: boolean; }

// floor set (docs §floors): #1 system storage, #6 irreversibility, #8 arbitrary exec, #10 loss of audit,
// #11 secrets, #12 exfiltration, #29 self/governance. hardDeny (force Deny): #1, #8, #11, #12, #29.
export const CATEGORIES: RiskCategory[] = [
  { id: 1, name: 'File and storage access', floor: true, hardDeny: true },
  { id: 2, name: 'Network and internet access' },
  { id: 3, name: 'Data sensitivity' },
  { id: 4, name: 'Scope and volume' },
  { id: 5, name: 'Permissions and privilege' },
  { id: 6, name: 'Action reversibility', floor: true },
  { id: 7, name: 'External side effects' },
  { id: 8, name: 'Execution and code capability', floor: true, hardDeny: true },
  { id: 9, name: 'Autonomy and decision authority' },
  { id: 10, name: 'Oversight, detection, auditability', floor: true },
  { id: 11, name: 'Credential and secret access', floor: true, hardDeny: true },
  { id: 12, name: 'Data egress and exfiltration', floor: true, hardDeny: true },
  { id: 13, name: 'Data deletion and retention' },
  { id: 14, name: 'Data integrity and corruption' },
  { id: 15, name: 'Privacy and personal data' },
  { id: 16, name: 'Encryption and key management' },
  { id: 17, name: 'Input trust and provenance' },
  { id: 18, name: 'Intellectual property and licensing' },
  { id: 19, name: 'Software install and dependencies' },
  { id: 20, name: 'Configuration and settings changes' },
  { id: 21, name: 'Infrastructure and deployment' },
  { id: 22, name: 'Database and schema operations' },
  { id: 23, name: 'Access-control and sharing changes' },
  { id: 24, name: 'Identity and authentication' },
  { id: 25, name: 'Third-party integration' },
  { id: 26, name: 'Production vs non-production target' },
  { id: 27, name: 'Backup and continuity impact' },
  { id: 28, name: 'Logging and telemetry integrity' },
  { id: 29, name: 'Self-modification and governance', floor: true, hardDeny: true },
  { id: 30, name: 'Sub-agent spawning and delegation' },
  { id: 31, name: 'Model and tool selection authority' },
  { id: 32, name: 'Scheduling and persistence' },
  { id: 33, name: 'Prompt and instruction integrity' },
  { id: 34, name: 'Goal stability and non-deviation' },
  { id: 35, name: 'Privilege escalation over time' },
  { id: 36, name: 'Concurrency and fan-out' },
  { id: 37, name: 'Rate and frequency' },
  { id: 38, name: 'Resource consumption and cost' },
  { id: 39, name: 'Financial and payment authority' },
  { id: 40, name: 'Communication and messaging reach' },
  { id: 41, name: 'Content publication' },
  { id: 42, name: 'Impersonation and social engineering' },
  { id: 43, name: 'Physical and device control' },
  { id: 44, name: 'Human safety and wellbeing' },
  { id: 45, name: 'Legal and regulatory exposure' },
  { id: 46, name: 'Reputational and brand impact' },
  { id: 47, name: 'Cross-tenant / multi-user blast radius' },
  { id: 48, name: 'Downstream and dependency chain' },
  { id: 49, name: 'Time sensitivity and urgency' },
  { id: 50, name: 'Task ambiguity and clarity' },
];

export const CATEGORY_COUNT = 50;
export const FLOOR_IDS: readonly CategoryId[] = CATEGORIES.filter((c) => c.floor).map((c) => c.id);
export const HARD_DENY_IDS: readonly CategoryId[] = CATEGORIES.filter((c) => c.hardDeny).map((c) => c.id);

// A category "trips its floor" at or above this red-band score.
export const FLOOR_TRIGGER = 8;

// Decade-aligned tiers + 10 human-readable descriptors (original to Starfish). Ordered ascending.
export interface RiskBand { min: number; max: number; descriptor: string; tier: RiskTier; }
export const RISK_BANDS: RiskBand[] = [
  { min: 0, max: 10, descriptor: 'Clear', tier: 'low' },
  { min: 11, max: 20, descriptor: 'Contained', tier: 'low' },
  { min: 21, max: 30, descriptor: 'Routine', tier: 'low' },
  { min: 31, max: 40, descriptor: 'Noted', tier: 'medium' },
  { min: 41, max: 50, descriptor: 'Weighty', tier: 'medium' },
  { min: 51, max: 60, descriptor: 'Heightened', tier: 'high' },
  { min: 61, max: 70, descriptor: 'Gated', tier: 'high' },
  { min: 71, max: 80, descriptor: 'Acute', tier: 'critical' },
  { min: 81, max: 90, descriptor: 'Grave', tier: 'critical' },
  { min: 91, max: 100, descriptor: 'Forbidden', tier: 'critical' },
];
