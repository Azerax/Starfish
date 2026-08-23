// Smoke test for policy.ts + telemetry-ingest.ts. Written now; deliberately NOT run until the final
// consolidated test pass at the end of tonight's session (per the "testing moved to the end" instruction)
// -- see IMPLEMENTATION_PLAN.md Sec 6 for that run's results.
import { checkToolRegistration, DEFAULT_FORBIDDEN_COMBOS } from './policy.ts';
import { Tier3AuditIngestor, makeFakeTelemetrySource } from './telemetry-ingest.ts';

const results = [];
function check(name, cond, detail) { results.push([name, cond, detail]); }

// --- policy.ts ---
{
  const r = checkToolRegistration('agent-a', ['code_interpreter'], { allowed: ['code_interpreter', 'web_search'] });
  check('single allowlisted tool with no combo triggered -> allow', r.allow === true, r.reason);
}
{
  const r = checkToolRegistration('agent-b', ['code_interpreter', 'web_search'], { allowed: ['code_interpreter', 'web_search'] });
  check('code_interpreter + web_search -> denied by default forbidden combo', r.allow === false, r.reason);
}
{
  const r = checkToolRegistration('agent-c', ['file_search'], { allowed: ['code_interpreter'] });
  check('requesting a tool NOT in the allowlist -> denied (deny-by-default)', r.allow === false, r.reason);
}
{
  const r = checkToolRegistration('agent-d', ['code_interpreter', 'web_search'], {
    allowed: ['code_interpreter', 'web_search'],
    allowOverridingDefaults: [{ combo: ['code_interpreter', 'web_search'], reason: 'reviewed and accepted for this sandboxed agent' }],
  });
  check('explicit, reasoned override of a default forbidden combo -> allowed', r.allow === true, r.reason);
}
{
  const r = checkToolRegistration('agent-e', [], {});
  check('empty request against empty policy -> allow (vacuously true, nothing requested)', r.allow === true, r.reason);
}
check('DEFAULT_FORBIDDEN_COMBOS is non-empty', DEFAULT_FORBIDDEN_COMBOS.length > 0, `${DEFAULT_FORBIDDEN_COMBOS.length} combos`);
// The two checks above only ever exercised ONE of the three DEFAULT_FORBIDDEN_COMBOS entries
// (code_interpreter+web_search) -- found on review that custom_code_interpreter+web_search and
// browser_automation+computer_use had no test coverage at all, and separately, that the
// browser_automation+computer_use reason string was truncated mid-sentence (fixed in policy.ts). Added
// below, plus coverage for additionalForbiddenCombos and for override discrimination (does overriding one
// combo accidentally also permit a different one with a different, unrelated reason?), neither of which
// had any test before this pass either.
{
  const r = checkToolRegistration('agent-f', ['custom_code_interpreter', 'web_search'], { allowed: ['custom_code_interpreter', 'web_search'] });
  check('custom_code_interpreter + web_search -> denied by default forbidden combo (previously untested)', r.allow === false, r.reason);
}
{
  const r = checkToolRegistration('agent-g', ['browser_automation', 'computer_use'], { allowed: ['browser_automation', 'computer_use'] });
  check(
    'browser_automation + computer_use -> denied by default forbidden combo, with a complete (non-truncated) reason string (previously untested)',
    r.allow === false && r.reason.includes('corresponding benefit'),
    r.reason,
  );
}
{
  const r = checkToolRegistration('agent-h', ['file_search', 'image_generation'], {
    allowed: ['file_search', 'image_generation'],
    additionalForbiddenCombos: [{ tools: ['file_search', 'image_generation'], reason: 'made-up combo for this test only' }],
  });
  check('additionalForbiddenCombos actually adds a new combo check beyond the three defaults (previously untested)', r.allow === false, r.reason);
}
{
  // Overriding code_interpreter+web_search must NOT also silently permit the unrelated
  // browser_automation+computer_use combo -- comboKey() keys by exact tool SET, so this should still deny.
  const r = checkToolRegistration('agent-i', ['browser_automation', 'computer_use'], {
    allowed: ['browser_automation', 'computer_use', 'code_interpreter', 'web_search'],
    allowOverridingDefaults: [{ combo: ['code_interpreter', 'web_search'], reason: 'reviewed and accepted for this sandboxed agent' }],
  });
  check('an override of ONE default combo does not accidentally permit a DIFFERENT default combo', r.allow === false, r.reason);
}

// --- telemetry-ingest.ts ---
{
  const appended = [];
  const sink = { append: (e) => appended.push(e) };
  const T = (s) => new Date(Date.parse('2026-08-03T02:00:00.000Z') + s * 1000).toISOString();
  // Mutable, shared by reference with makeFakeTelemetrySource -- lets this test simulate a record that
  // "arrives late" (wasn't visible to fetchSince on an earlier poll) by pushing it in between poll calls,
  // the same way a real Azure Monitor export lagging behind wall-clock time would surface a record after
  // the fact rather than at the moment its startedAt actually occurred.
  const backing = [
    { runId: 'r1', threadId: 't1', agentId: 'worker', tool: 'file_search', startedAt: T(10), finishedAt: T(15), outcome: 'succeeded' },
  ];
  const source = makeFakeTelemetrySource(backing);
  const ingestor = new Tier3AuditIngestor(source, sink, T(-3600), 15_000 /* 15s lag, sized to this test's second-scale timestamps */);

  const n1 = await ingestor.pollOnce(new Date(Date.parse(T(20))));
  check('poll 1: ingests the one record visible so far', n1 === 1, `ingested ${n1}`);
  check('every appended entry uses domain=foundry-telemetry, never a PDP decision domain', appended.every((e) => e.domain === 'foundry-telemetry'), JSON.stringify(appended.map((e) => e.domain)));
  check('appended entries use observedOutcome, not `decision`', appended.every((e) => 'observedOutcome' in e && !('decision' in e)), JSON.stringify(appended));

  // Simulate late-arriving telemetry: a record whose real startedAt (13s) is BEFORE the finishedAt of the
  // record already ingested in poll 1 (15s) -- under the old (pre-fix) logic, which advanced the cursor
  // straight to the latest finishedAt with no margin, this record would already be excluded by
  // fetchSince's `startedAt >= cursor` filter the moment it appeared, forever, with no error or warning.
  backing.push({ runId: 'r2', threadId: 't1', agentId: 'worker', tool: 'code_interpreter', startedAt: T(13), finishedAt: T(14), outcome: 'failed' });

  const n2 = await ingestor.pollOnce(new Date(Date.parse(T(30))));
  check(
    'poll 2: the late-arriving record IS ingested (the lag margin kept the cursor from passing it) -- this is the bug found and fixed this session',
    n2 === 1,
    `ingested ${n2}, appended so far: ${JSON.stringify(appended.map((e) => e.target))}`,
  );
  check(
    'poll 2: the record from poll 1, re-delivered by the overlap window, is NOT double-appended',
    appended.filter((e) => e.target === 't1/r1').length === 1,
    JSON.stringify(appended.map((e) => e.target)),
  );
  check('exactly 2 distinct records appended total after poll 2', appended.length === 2, JSON.stringify(appended.map((e) => e.target)));

  const n3 = await ingestor.pollOnce(new Date(Date.parse(T(40))));
  check('poll 3: cursor has now advanced past both records -- no new data ingests 0', n3 === 0, `ingested ${n3}`);
  check('poll 3: still no duplicate appends', appended.length === 2, JSON.stringify(appended.map((e) => e.target)));
}

const passed = results.filter(([, ok]) => ok).length;
for (const [name, ok, detail] of results) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
console.log(`\n${passed}/${results.length} tier3 checks passed`);
if (passed !== results.length) process.exit(1);
