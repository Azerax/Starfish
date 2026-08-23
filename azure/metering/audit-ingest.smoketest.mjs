// Smoke test for audit-ingest.ts. Two parts: (1) pure-logic checks against hand-built RawAuditEntry
// fixtures (fast, no container needed), and (2) a REAL test against an actual audit.jsonl file produced
// by a real running sidecar container tonight (IMPLEMENTATION_PLAN.md Sec 6h) -- this is the part that
// matters most, since the whole point of building this file was that nothing had ever exercised the
// translation against genuine governance-core output before. Part 2 is skipped gracefully (not failed) if
// that file isn't present, so this test still runs standalone without requiring Docker.
import { auditEntryToDecisionRecord, AuditMeteringIngestor } from './audit-ingest.ts';
import { rollupToUsageEvents } from './emitter.ts';
import { existsSync, readFileSync } from 'node:fs';

const results = [];
function check(name, cond, detail) { results.push([name, cond, detail]); }

// --- pure logic: a real decision entry translates correctly ---
{
  const rec = auditEntryToDecisionRecord(
    { seq: 5, ts: '2026-08-03T02:10:55.060Z', actor: 'worker', decision: 'allow' },
    'root-abc',
  );
  check(
    'a decision-shaped entry translates to a DecisionAccountingRecord',
    rec && rec.seq === 5 && rec.actor === 'worker' && rec.decision === 'allow' && rec.rootId === 'root-abc' && rec.ts === Date.parse('2026-08-03T02:10:55.060Z'),
    JSON.stringify(rec),
  );
}

// --- pure logic: non-decision entries (boot, enforcement-posture) are filtered out, not mis-billed ---
{
  const rec = auditEntryToDecisionRecord({ seq: 2, ts: '2026-08-03T02:10:00.000Z', actor: 'system' }, 'root-abc');
  check('a non-decision entry (no `decision` field) returns null, not a fabricated record', rec === null, JSON.stringify(rec));
}

// --- pure logic: an ask-shaped entry (real audit shape -- persisted as "deny", see the file's header) ---
// still translates without throwing, and is honestly recorded as 'deny' rather than invented as 'ask'.
{
  const rec = auditEntryToDecisionRecord(
    { seq: 9, ts: '2026-08-03T02:10:55.060Z', actor: 'unrestricted', decision: 'deny' },
    'root-abc',
  );
  check('an ask-shaped real entry (decision:"deny") translates as deny, not a guessed "ask"', rec.decision === 'deny', JSON.stringify(rec));
}

// --- AuditMeteringIngestor: pollOnce advances the cursor past EVERYTHING seen, bills only decisions ---
{
  const entries = [
    { seq: 0, ts: '2026-08-03T02:00:00.000Z', actor: 'system' },                          // boot, not billed
    { seq: 1, ts: '2026-08-03T02:00:01.000Z', actor: 'system' },                          // enforcement-posture, not billed
    { seq: 2, ts: '2026-08-03T02:00:02.000Z', actor: 'worker', decision: 'allow' },       // billed
    { seq: 3, ts: '2026-08-03T02:00:03.000Z', actor: 'worker', decision: 'deny' },        // billed
  ];
  const source = { recentSince: (sinceSeq) => entries.filter((e) => e.seq > sinceSeq) };
  const billed = [];
  const sink = { record: (r) => billed.push(r) };
  const ingestor = new AuditMeteringIngestor(source, sink, 'root-xyz');
  const n = ingestor.pollOnce();
  check('pollOnce bills only the decision-shaped entries', n === 2 && billed.length === 2, `n=${n} billed=${JSON.stringify(billed)}`);
  check('pollOnce advances the cursor past the LAST entry seen, including filtered-out ones', ingestor.lastSeq === 3, `lastSeq=${ingestor.lastSeq}`);

  // second pollOnce with nothing new -- must not re-bill or re-scan
  const n2 = ingestor.pollOnce();
  check('a second pollOnce with no new entries bills nothing (cursor discipline holds)', n2 === 0, `n2=${n2}`);
}

// --- end-to-end: translated records actually roll up correctly through the real emitter.ts logic ---
{
  const entries = [
    { seq: 0, ts: '2026-08-03T02:00:00.000Z', actor: 'worker', decision: 'allow' },
    { seq: 1, ts: '2026-08-03T02:00:00.500Z', actor: 'worker', decision: 'deny' },
    { seq: 2, ts: '2026-08-03T02:00:01.000Z', actor: 'worker', decision: 'allow' },
  ];
  const source = { recentSince: (sinceSeq) => entries.filter((e) => e.seq > sinceSeq) };
  const buffered = [];
  const ingestor = new AuditMeteringIngestor(source, { record: (r) => buffered.push(r) }, 'root-e2e');
  ingestor.pollOnce();
  const events = rollupToUsageEvents(buffered, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1', effectiveStartTime: '2026-08-03T03:00:00.000Z' });
  check(
    'real translated records roll up through emitter.ts unchanged -- 3 decisions -> quantity 3',
    events.length === 1 && events[0].quantity === 3 && events[0].dimension === 'governed_decision',
    JSON.stringify(events),
  );
}

// --- the real thing: against an actual audit.jsonl produced by a real running container tonight ---
const REAL_AUDIT_PATH = '/tmp/allowedtools-test-root/audit.jsonl';
if (existsSync(REAL_AUDIT_PATH)) {
  const lines = readFileSync(REAL_AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const source = { recentSince: (sinceSeq) => lines.filter((e) => e.seq > sinceSeq) };
  const buffered = [];
  const ingestor = new AuditMeteringIngestor(source, { record: (r) => buffered.push(r) }, 'real-root');
  const billed = ingestor.pollOnce();
  const decisionLines = lines.filter((l) => l.decision === 'allow' || l.decision === 'deny');
  check(
    `real audit.jsonl (${lines.length} total lines): billed count matches the real decision-shaped line count exactly`,
    billed === decisionLines.length && buffered.length === decisionLines.length,
    `billed=${billed} expectedDecisionLines=${decisionLines.length}`,
  );
  const events = rollupToUsageEvents(buffered, { dimension: 'governed_decision', resourceId: 'real-res', planId: 'real-plan', effectiveStartTime: '2026-08-03T03:00:00.000Z' });
  check(
    'real audit data rolls up to a single governed_decision usage event with the right quantity',
    events.length === 1 && events[0].quantity === decisionLines.length,
    JSON.stringify(events),
  );
} else {
  check('real-container audit.jsonl test (skipped -- no container was run this pass)', true, `looked for ${REAL_AUDIT_PATH}`);
}

const passed = results.filter(([, ok]) => ok).length;
for (const [name, ok, detail] of results) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
console.log(`\n${passed}/${results.length} audit-ingest checks passed`);
if (passed !== results.length) process.exit(1);
