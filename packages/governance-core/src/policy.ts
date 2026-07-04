// Policy Engine — ordered rules, first match wins, default-deny for governed actions.
// v0.20.0: human-readable explain() + dry-run simulate() so an operator can see WHY a request is
// allowed/denied and exactly what a proposed rule change would alter — without ever being able to weaken
// the deny-by-default floor (policy is only one PDP input; boundary/secret/shell/net floors are separate
// hard rules that policy cannot override).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Effect = 'allow' | 'deny' | 'ask';
export interface PolicyRule { id: string; subject: string; action: string; resource: string; effect: Effect; }

function glob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

export interface PolicyExplanation {
  decision: Effect | 'default-deny';
  matched?: { id: string; index: number; rule: PolicyRule };
  reason: string;
}

const FLOOR_NOTE = 'hard safety floors (out-of-boundary, secret paths, raw/catastrophic shell, internal-egress) are enforced separately and cannot be overridden by policy';

/** Explain the first-match outcome for a governed (subject, action, resource) triple. */
export function explainPolicy(rules: PolicyRule[], subject: string, action: string, resource: string): PolicyExplanation {
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (glob(r.subject, subject) && glob(r.action, action) && glob(r.resource, resource)) {
      return { decision: r.effect, matched: { id: r.id, index: i, rule: r }, reason: `matched rule #${i} '${r.id}' (subject '${r.subject}', action '${r.action}', resource '${r.resource}') -> ${r.effect}. Note: ${FLOOR_NOTE}.` };
    }
  }
  return { decision: 'default-deny', reason: `no policy rule matched — governed actions are deny-by-default. Note: ${FLOOR_NOTE}.` };
}

export interface PolicySample { subject: string; action: string; resource: string; }
export interface PolicyDelta { sample: PolicySample; before: Effect | 'default-deny'; after: Effect | 'default-deny'; changed: boolean; loosened: boolean; }
export interface PolicySimulation { deltas: PolicyDelta[]; loosened: number; tightened: number; unchanged: number; note: string; }

const rank: Record<Effect | 'default-deny', number> = { deny: 0, 'default-deny': 0, ask: 1, allow: 2 };

/** Dry-run: compare current vs proposed rules across sample requests and report the delta. `loosened`
 *  flags any sample that moves toward allow (deny/ask -> ask/allow) so a widening is never silent. */
export function simulatePolicyChange(current: PolicyRule[], proposed: PolicyRule[], samples: PolicySample[]): PolicySimulation {
  const deltas: PolicyDelta[] = samples.map((s) => {
    const before = explainPolicy(current, s.subject, s.action, s.resource).decision;
    const after = explainPolicy(proposed, s.subject, s.action, s.resource).decision;
    const changed = before !== after;
    const loosened = rank[after] > rank[before];
    return { sample: s, before, after, changed, loosened };
  });
  const loosened = deltas.filter((d) => d.loosened).length;
  const tightened = deltas.filter((d) => d.changed && !d.loosened).length;
  const unchanged = deltas.filter((d) => !d.changed).length;
  return { deltas, loosened, tightened, unchanged, note: `Policy changes never weaken the floor: ${FLOOR_NOTE}.` };
}

export class PolicyEngine {
  constructor(private rules: PolicyRule[] = []) {}
  evaluate(subject: string, action: string, resource: string): Effect | 'nomatch' {
    for (const r of this.rules) {
      if (glob(r.subject, subject) && glob(r.action, action) && glob(r.resource, resource)) return r.effect;
    }
    return 'nomatch';
  }
  explain(subject: string, action: string, resource: string): PolicyExplanation {
    return explainPolicy(this.rules, subject, action, resource);
  }
  list(): PolicyRule[] { return [...this.rules]; }
}

export function loadPolicies(file: string): PolicyRule[] {
  if (!existsSync(file)) return [];
  const arr = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(arr) ? (arr as PolicyRule[]) : [];
}

export function savePolicies(file: string, rules: PolicyRule[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rules, null, 2));
}
