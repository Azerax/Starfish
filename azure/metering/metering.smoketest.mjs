// Smoke test for schema.ts + emitter.ts's pure rollup logic and the in-memory fake submitter. Written
// now; deliberately NOT run until the final consolidated test pass at the end of tonight's session (per
// the "testing moved to the end" instruction) -- see IMPLEMENTATION_PLAN.md Sec 6 for that run's results.
import { rollupToUsageEvents, MarketplaceMeteringEmitter, makeFakeSubmitter, makeLoggingSubmitter } from './emitter.ts';

const results = [];
function check(name, cond, detail) { results.push([name, cond, detail]); }

const R = (seq, ts, actor, rootId, decision) => ({ seq, ts, actor, rootId, decision });

// --- rollupToUsageEvents: governed_decision ---
{
  const records = [R(1, 1000, 'worker', 'root-a', 'allow'), R(2, 2000, 'worker', 'root-a', 'deny'), R(3, 3000, 'worker', 'root-a', 'ask')];
  const events = rollupToUsageEvents(records, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1', effectiveStartTime: '2026-08-03T00:00:00Z' });
  check('governed_decision: one event, quantity = record count regardless of decision outcome', events.length === 1 && events[0].quantity === 3, JSON.stringify(events));
}

// --- rollupToUsageEvents: governed_agent_hour ---
{
  const hour0 = 0;
  const hour1 = 3_600_000;
  const records = [
    R(1, hour0 + 1000, 'w', 'root-a', 'allow'),
    R(2, hour0 + 2000, 'w', 'root-a', 'allow'), // same root, same hour bucket -> should not double count
    R(3, hour1 + 500, 'w', 'root-a', 'allow'),  // same root, next hour -> new bucket
    R(4, hour0 + 500, 'w', 'root-b', 'allow'),  // different root, same hour -> separate bucket
  ];
  const events = rollupToUsageEvents(records, { dimension: 'governed_agent_hour', resourceId: 'res-1', planId: 'plan-1', effectiveStartTime: '2026-08-03T00:00:00Z' });
  check('governed_agent_hour: 3 distinct (root, hour) buckets from 4 records', events.length === 1 && events[0].quantity === 3, JSON.stringify(events));
}

// --- rollupToUsageEvents: active_agent_month ---
{
  const records = [R(1, 1000, 'w', 'root-a', 'allow'), R(2, 2000, 'w', 'root-a', 'deny'), R(3, 3000, 'w', 'root-b', 'allow')];
  const events = rollupToUsageEvents(records, { dimension: 'active_agent_month', resourceId: 'res-1', planId: 'plan-1', effectiveStartTime: '2026-08-03T00:00:00Z' });
  check('active_agent_month: 2 distinct roots from 3 records', events.length === 1 && events[0].quantity === 2, JSON.stringify(events));
}

// --- rollupToUsageEvents: empty batch ---
{
  const events = rollupToUsageEvents([], { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1', effectiveStartTime: '2026-08-03T00:00:00Z' });
  check('empty batch rolls up to zero events, not an error', events.length === 0, JSON.stringify(events));
}

// --- rollupToUsageEvents: unknown dimension throws ---
{
  let threw = false;
  try {
    rollupToUsageEvents([R(1, 1000, 'w', 'root-a', 'allow')], { dimension: 'not_a_real_dimension', resourceId: 'r', planId: 'p', effectiveStartTime: 'x' });
  } catch { threw = true; }
  check('unknown dimension throws rather than silently rolling up wrong', threw, `threw=${threw}`);
}

// --- MarketplaceMeteringEmitter + fake submitter ---
{
  const fake = makeFakeSubmitter();
  const emitter = new MarketplaceMeteringEmitter(fake, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1' });
  emitter.record(R(1, 1000, 'w', 'root-a', 'allow'));
  emitter.record(R(2, 2000, 'w', 'root-a', 'ask'));
  check('emitter buffers records before flush', emitter.pending === 2, `pending=${emitter.pending}`);
  const flushed = await emitter.flush('2026-08-03T00:00:00Z');
  check('flush returns the rolled-up events', flushed.length === 1 && flushed[0].quantity === 2, JSON.stringify(flushed));
  check('flush clears the buffer', emitter.pending === 0, `pending=${emitter.pending}`);
  check('submitter actually received the events', fake.submitted.length === 1 && fake.submitted[0].quantity === 2, JSON.stringify(fake.submitted));
}

// --- MarketplaceMeteringEmitter: flushing an empty buffer submits nothing ---
{
  const fake = makeFakeSubmitter();
  const emitter = new MarketplaceMeteringEmitter(fake, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1' });
  const flushed = await emitter.flush('2026-08-03T00:00:00Z');
  check('flushing with nothing buffered submits nothing (no zero-quantity event)', flushed.length === 0 && fake.submitted.length === 0, JSON.stringify({ flushed, submitted: fake.submitted }));
}

// --- MarketplaceMeteringEmitter: a submission failure must NOT silently lose the batch -- found on
// review that the original flush() cleared its buffer before awaiting submit(), so any transient
// failure (network blip, 429, 500) discarded the records permanently with no retry path; this is a
// billing-adjacent component, so that's undercounted real usage, not just a logged error. Fixed by
// restoring the batch on failure; these checks confirm the fix actually behaves as claimed, not just that
// it compiles. ---
function makeFlakySubmitter(failCount) {
  let calls = 0;
  const submitted = [];
  return {
    submitted,
    async submit(events) {
      calls++;
      if (calls <= failCount) throw new Error(`simulated transient failure (call ${calls})`);
      submitted.push(...events);
    },
  };
}
{
  const flaky = makeFlakySubmitter(1); // fails once, then succeeds
  const emitter = new MarketplaceMeteringEmitter(flaky, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1' });
  emitter.record(R(1, 1000, 'w', 'root-a', 'allow'));
  emitter.record(R(2, 2000, 'w', 'root-a', 'deny'));

  let threw = false;
  try { await emitter.flush('2026-08-03T00:00:00Z'); } catch { threw = true; }
  check('flush() re-throws when the submitter fails, so the caller still finds out', threw, `threw=${threw}`);
  check(
    'the failed batch is NOT lost -- pending still reflects both original records after the failed flush',
    emitter.pending === 2,
    `pending=${emitter.pending}`,
  );
  check('nothing reached the submitter on the failed attempt', flaky.submitted.length === 0, JSON.stringify(flaky.submitted));

  // A record made between the failed flush and the retry must survive alongside the restored batch, not
  // overwrite or duplicate it.
  emitter.record(R(3, 3000, 'w', 'root-a', 'ask'));
  check('a record made after the failed flush is added on top of the restored batch', emitter.pending === 3, `pending=${emitter.pending}`);

  const flushed2 = await emitter.flush('2026-08-03T00:05:00Z');
  check('the retry succeeds and rolls up ALL THREE records (2 restored + 1 new), none lost, none duplicated', flushed2.length === 1 && flushed2[0].quantity === 3, JSON.stringify(flushed2));
  check('the submitter actually received all 3 on the successful retry', flaky.submitted.length === 1 && flaky.submitted[0].quantity === 3, JSON.stringify(flaky.submitted));
  check('buffer is empty again after the successful retry', emitter.pending === 0, `pending=${emitter.pending}`);
}
{
  // A PERMANENTLY failing submitter should keep the records visible (via .pending) rather than silently
  // dropping them -- this is the accepted tradeoff the fix's comment calls out (unbounded growth is
  // visible and alertable; silent loss is not).
  const alwaysFails = makeFlakySubmitter(Infinity);
  const emitter = new MarketplaceMeteringEmitter(alwaysFails, { dimension: 'governed_decision', resourceId: 'res-1', planId: 'plan-1' });
  emitter.record(R(1, 1000, 'w', 'root-a', 'allow'));
  for (let i = 0; i < 3; i++) {
    try { await emitter.flush('2026-08-03T00:00:00Z'); } catch { /* expected every time */ }
  }
  check('a permanently-failing submitter keeps the record visible via .pending across repeated failed flushes, instead of quietly discarding it', emitter.pending === 1, `pending=${emitter.pending}`);
}

// --- makeLoggingSubmitter doesn't throw ---
{
  const lines = [];
  const submitter = makeLoggingSubmitter((m) => lines.push(m));
  await submitter.submit([{ resourceId: 'r', quantity: 1, dimension: 'governed_decision', effectiveStartTime: 'x', planId: 'p' }]);
  check('logging submitter logs one line per event instead of throwing', lines.length === 1, JSON.stringify(lines));
}

const passed = results.filter(([, ok]) => ok).length;
for (const [name, ok, detail] of results) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
console.log(`\n${passed}/${results.length} metering checks passed`);
if (passed !== results.length) process.exit(1);
