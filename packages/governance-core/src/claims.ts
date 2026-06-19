// Evidence Gate — the constitutional principle "no unbacked word." An agent's CLAIM (I created X,
// the suite is green, I ran Y, committed Z, cited W) is not accepted unless backed by RECORDED
// evidence (the deeds in the audit ledger / observed tool results). Unbacked or contradicted claims
// are blocked at turn-end — the agent retries against a one-line correction. Deterministic: it judges
// the agent only against its OWN utterances and the system's own record, never the world's truth.
// A claim that passes becomes "spendable" — a reviewer or another agent can accept it without re-deriving.

export type ClaimKind = 'completion' | 'tests-green' | 'named-test' | 'ran-action' | 'commit' | 'citation';
export interface Claim { kind: ClaimKind; subject?: string; raw: string; }

/** What the system actually OBSERVED this turn (derived from the audit ledger / tool results). */
export interface TurnEvidence {
  anyToolCall: boolean;
  artifacts: string[];      // files created/written (recorded)
  commits: string[];        // commit SHAs recorded
  testsPassed: string[];    // named tests recorded as passing
  testsFailed: string[];    // named tests recorded as failing
  suiteGreen: boolean;      // a recorded full-suite run with zero failures
  citations: string[];      // citation keys known to exist (e.g. CITATIONS.md)
}
export const EMPTY_EVIDENCE: TurnEvidence = { anyToolCall: false, artifacts: [], commits: [], testsPassed: [], testsFailed: [], suiteGreen: false, citations: [] };

export interface ClaimFinding { claim: Claim; backed: boolean; reason: string; retryHint?: string; }
export interface ClaimVerdict { ok: boolean; findings: ClaimFinding[]; }

const norm = (s: string) => s.trim().toLowerCase();
const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
const hasArtifact = (ev: TurnEvidence, subj: string) => {
  const s = norm(subj);
  return ev.artifacts.some((a) => { const n = norm(a); return n === s || norm(base(a)) === s || n.endsWith('/' + s) || n.includes(s); });
};

/** Conservative, deterministic extraction. Fires only on clear claim shapes (low false-positive). */
export function extractClaims(text: string): Claim[] {
  const out: Claim[] = [];
  const push = (kind: ClaimKind, raw: string, subject?: string) => out.push({ kind, raw: raw.trim(), subject });

  // completion with a concrete artifact: "created/added/wrote/saved <path-or-file.ext>"
  for (const m of text.matchAll(/\b(?:created|added|wrote|saved|generated|implemented)\s+(?:the\s+|a\s+|an\s+|new\s+)?(?:file\s+)?[`'"]?([A-Za-z0-9_./\-]+\.[A-Za-z0-9]+|[A-Za-z0-9_./\-]+\/[A-Za-z0-9_./\-]+)[`'"]?/gi))
    push('completion', m[0], m[1]);

  // full-suite green
  for (const m of text.matchAll(/\b(all tests pass(?:ing|ed)?|tests (?:are )?(?:all )?passing|(?:the )?(?:test )?suite (?:is )?green|everything passes)\b/gi))
    push('tests-green', m[0]);

  // a specific named test passing: "test_foo passes" / "passes test_foo"
  for (const m of text.matchAll(/\b(test_[A-Za-z0-9]+)\b[^.\n]{0,40}?\b(?:pass(?:es|ed|ing)?|green|succeeds?)\b/gi)) push('named-test', m[0], m[1]);
  for (const m of text.matchAll(/\b(?:pass(?:es|ed|ing)?|green)\b[^.\n]{0,20}?\b(test_[A-Za-z0-9]+)\b/gi)) push('named-test', m[0], m[1]);

  // "I ran/executed/invoked X"
  for (const m of text.matchAll(/\bI\s+(?:ran|executed|invoked|launched)\s+[`'"]?([A-Za-z0-9_./\- ]{2,40}?)[`'"]?(?=[.,;:\n]|$)/gi))
    push('ran-action', m[0], m[1]);

  // committed/tagged <sha>
  for (const m of text.matchAll(/\b(?:commit(?:ted)?|tag(?:ged)?)\b[^.\n]{0,40}?\b([0-9a-f]{7,40})\b/gi)) push('commit', m[0], m[1]);

  // citation (Author, Year) or [Author Year]
  for (const m of text.matchAll(/[([]([A-Z][A-Za-z\-]+(?:\s+et al\.?)?,?\s+\d{4}[a-z]?)[)\]]/g)) push('citation', m[0], m[1]);

  return out;
}

/** Check each claim against recorded evidence. A claim is backed, unbacked, or CONTRADICTED. */
export function assessClaims(claims: Claim[], ev: TurnEvidence): ClaimVerdict {
  const findings: ClaimFinding[] = claims.map((c) => {
    switch (c.kind) {
      case 'completion': {
        const backed = !!c.subject && hasArtifact(ev, c.subject);
        return { claim: c, backed, reason: backed ? `artifact recorded: ${c.subject}` : `no recorded write of '${c.subject ?? '?'}'`,
          retryHint: backed ? undefined : `Actually create '${c.subject ?? 'the artifact'}' (a recorded Write/Edit) before claiming it, or drop the claim.` };
      }
      case 'tests-green': {
        const contradicted = ev.testsFailed.length > 0;
        const backed = ev.suiteGreen && !contradicted;
        return { claim: c, backed, reason: backed ? 'recorded suite pass, zero failures' : contradicted ? `contradicted: recorded failing test(s): ${ev.testsFailed.join(', ')}` : 'no recorded passing test run',
          retryHint: backed ? undefined : 'Run the suite and let it actually pass before claiming green; do not claim over a recorded failure.' };
      }
      case 'named-test': {
        const s = c.subject ?? '';
        const failed = ev.testsFailed.includes(s);
        const backed = ev.testsPassed.includes(s) && !failed;
        return { claim: c, backed, reason: backed ? `recorded pass: ${s}` : failed ? `contradicted: ${s} is recorded FAILED` : `no recorded result for ${s}`,
          retryHint: backed ? undefined : `Run ${s} and let it pass; don't claim a test you haven't a recorded pass for.` };
      }
      case 'ran-action': {
        const backed = ev.anyToolCall;   // presence-of-work: claiming "I ran X" with no tool call at all is a fabrication
        return { claim: c, backed, reason: backed ? 'work recorded this turn' : 'claimed an action but NO tool call occurred this turn',
          retryHint: backed ? undefined : `Actually run '${c.subject ?? 'it'}' (a real tool call) before saying you did.` };
      }
      case 'commit': {
        const backed = !!c.subject && ev.commits.some((sha) => sha.startsWith(c.subject!) || c.subject!.startsWith(sha));
        return { claim: c, backed, reason: backed ? `commit recorded: ${c.subject}` : `no recorded commit ${c.subject ?? ''}`,
          retryHint: backed ? undefined : 'Present a SHA from a recorded commit, not a fabricated one.' };
      }
      case 'citation': {
        const backed = ev.citations.some((k) => norm(k) === norm(c.subject ?? ''));
        return { claim: c, backed, reason: backed ? `citation on file: ${c.subject}` : `citation '${c.subject ?? ''}' not in the citation record`,
          retryHint: backed ? undefined : 'Cite only sources present in the citation record; add the source first.' };
      }
    }
  });
  return { ok: findings.every((f) => f.backed), findings };
}

/** Convenience: extract + assess in one call. */
export function evidenceGate(text: string, ev: TurnEvidence): ClaimVerdict {
  return assessClaims(extractClaims(text), ev);
}

import type { AuditEvent } from './types';
/** Build the audit-derivable slice of evidence from a turn's audit events (the deeds of record).
 *  Test pass/fail + citations come from observed tool OUTPUT, which the audit doesn't store — the
 *  caller merges those in. This covers anyToolCall, written artifacts, and recorded commit SHAs. */
export function evidenceFromAudit(events: AuditEvent[]): TurnEvidence {
  const ev: TurnEvidence = { anyToolCall: false, artifacts: [], commits: [], testsPassed: [], testsFailed: [], suiteGreen: false, citations: [] };
  for (const e of events) {
    const action = e.action ?? '';
    if (action.startsWith('ingress:') && e.decision === 'allow') {
      ev.anyToolCall = true;
      const tool = action.slice('ingress:'.length);
      if (/write|edit|create|save|delete-soft/i.test(tool) && e.target) ev.artifacts.push(e.target);
    }
    if (action === 'delete-soft' && e.target) { ev.anyToolCall = true; }
    if (/commit/i.test(action)) { const m = (e.reason ?? '').match(/[0-9a-f]{7,40}/); if (m) ev.commits.push(m[0]); }
  }
  return ev;
}
