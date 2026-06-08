// Policy Engine — ordered rules, first match wins, default-deny for governed actions.
import { existsSync, readFileSync } from 'node:fs';

export type Effect = 'allow' | 'deny' | 'ask';
export interface PolicyRule { id: string; subject: string; action: string; resource: string; effect: Effect; }

function glob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

export class PolicyEngine {
  constructor(private rules: PolicyRule[] = []) {}
  evaluate(subject: string, action: string, resource: string): Effect | 'nomatch' {
    for (const r of this.rules) {
      if (glob(r.subject, subject) && glob(r.action, action) && glob(r.resource, resource)) return r.effect;
    }
    return 'nomatch';
  }
}

export function loadPolicies(file: string): PolicyRule[] {
  if (!existsSync(file)) return [];
  const arr = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(arr) ? (arr as PolicyRule[]) : [];
}
