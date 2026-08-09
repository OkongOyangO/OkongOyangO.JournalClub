/**
 * Node harness for the schedule logic in ../apps-script/Code.gs.
 *
 * WHY: the date/slot functions are the ones that can lose a real person's talk —
 * write it onto the wrong week, declare a free slot taken, or silently fail to
 * find a row. Code review can only reason about them. This executes them, in
 * Node, against a snapshot of the actual Journal Club schedule.
 *
 * It works by stubbing the handful of Apps Script globals the pure logic touches
 * and loading Code.gs unmodified into a vm context, so the code under test is the
 * code that ships. The stubs and the fixture loader live in ./lib.js, shared with
 * the four attack suites.
 *
 *   node test/harness.js          (host timezone independent — see lib.zonedMidnight)
 *
 * Run the whole suite with: node test/run-all.js
 */
'use strict';

const L = require('./lib');
const { SCHEDULE_TZ, zonedMidnight, loadFixture } = L;
const load = () => L.load();

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; failures.push(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
}
function note(name, value) { console.log(`  · ${name}: ${JSON.stringify(value)}`); }

// ---------------------------------------------------------------------------
const { g, values } = load();
const ctx = g.openSchedule_();
// Midnight 2026-08-08 IN THE SHEET'S TZ (the day this fixture was taken), not in
// whatever timezone this process runs in — see zonedMidnight.
const NOW = zonedMidnight(2026, 7, 8, SCHEDULE_TZ);

console.log('\n=== schedule parsed ===');
note('rows (incl header)', values.length);
note('resolved columns', ctx.col);
note('timezone', ctx.tz);

console.log('\n=== findRowByDate_ ===');
// Real booked rows, verified by hand against the fixture.
check('3 Aug resolves',        g.findRowByDate_(ctx, '2026-08-03').status, 'OK');
check('3 Aug -> speaker',      g.findRowByDate_(ctx, '2026-08-03').row.values[ctx.col.speaker], 'Muyang Chen');
check('17 Aug -> speaker',     g.findRowByDate_(ctx, '2026-08-17').row.values[ctx.col.speaker], 'You-Chiuan Chen');
check('24 Aug -> speaker',     g.findRowByDate_(ctx, '2026-08-24').row.values[ctx.col.speaker], 'Yuting Bai');
// The Wednesday one-off — proof rows are not one-per-Monday.
check('15 Jul (Wed) resolves', g.findRowByDate_(ctx, '2026-07-15').status, 'OK');
check('15 Jul -> speaker',     g.findRowByDate_(ctx, '2026-07-15').row.values[ctx.col.speaker], 'Xiao Wang');
// A Monday with no row at all.
check('13 Jul absent',         g.findRowByDate_(ctx, '2026-07-13').status, 'NOT_IN_SCHEDULE');
// Off the end / before the start.
check('2025 absent',           g.findRowByDate_(ctx, '2025-06-22').status, 'NOT_IN_SCHEDULE');
check('2028 absent',           g.findRowByDate_(ctx, '2028-01-03').status, 'NOT_IN_SCHEDULE');
// THE YEAR TEST: the widget's old CSV heuristic mis-resolved these.
check('25 Jan 2027 resolves',  g.findRowByDate_(ctx, '2027-01-25').status, 'OK');
check('25 Jan 2026 absent',    g.findRowByDate_(ctx, '2026-01-25').status, 'NOT_IN_SCHEDULE');
// Garbage in.
check('empty key',             g.findRowByDate_(ctx, '').status, 'NOT_IN_SCHEDULE');
check('junk key',              g.findRowByDate_(ctx, 'not-a-date').status, 'NOT_IN_SCHEDULE');

console.log('\n=== slotState_ ===');
check('booked -> TAKEN',       g.slotState_(ctx, '2026-08-24', NOW).state, 'TAKEN');
check('N/A   -> BREAK',        g.slotState_(ctx, '2026-08-10', NOW).state, 'BREAK');
check('past  -> PAST',         g.slotState_(ctx, '2026-08-03', NOW).state, 'TAKEN'); // booked AND past: booked wins
check('free future -> FREE',   g.slotState_(ctx, '2027-01-25', NOW).state, 'FREE');
check('missing -> NOT_IN',     g.slotState_(ctx, '2026-07-13', NOW).state, 'NOT_IN_SCHEDULE');
check('no date -> NO_DATE',    g.slotState_(ctx, '', NOW).state, 'NO_DATE');

console.log('\n=== isFreeSlot_ (row-level) ===');
const freeKeys = [];
for (let r = 1; r < values.length; r++) {
  if (g.isFreeSlot_(values[r], ctx.col, ctx.tz, NOW)) {
    freeKeys.push(g.dayKey_(g.coerceDate_(values[r][ctx.col.date], ctx.tz, ''), ctx.tz));
  }
}
note('free future slots', freeKeys.length);
note('first six', freeKeys.slice(0, 6));
check('booked date not free', freeKeys.includes('2026-08-24'), false);
check('N/A date not free',    freeKeys.includes('2026-08-10'), false);
check('past date not free',   freeKeys.includes('2026-06-22'), false);
check('today itself not free',freeKeys.includes('2026-08-08'), false);

console.log('\n=== sanitizeForSheet_ (formula injection) ===');
for (const [inp, why] of [['=IMPORTRANGE("x","y")','='], ['+1+1','+'], ['-1+1','-'], ['@SUM(A1)','@']]) {
  const out = g.sanitizeForSheet_(inp, 80);
  check(`strips leading ${why}`, /^[=+\-@]/.test(out), false);
}
check('leaves normal text', g.sanitizeForSheet_('Strange metals & holography', 80),
                            'Strange metals & holography');
check('truncates to maxLen', g.sanitizeForSheet_('x'.repeat(200), 80).length <= 80, true);

console.log('\n=== normalizeDateKey_ (accepts Date or string) ===');
check('from ISO string', g.normalizeDateKey_('2026-08-24', SCHEDULE_TZ), '2026-08-24');
check('from Date object', g.normalizeDateKey_(zonedMidnight(2026, 7, 24, SCHEDULE_TZ), SCHEDULE_TZ), '2026-08-24');
check('from empty', g.normalizeDateKey_('', SCHEDULE_TZ), '');

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(58));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed\n`);
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log(`PASSED — all ${pass} checks green`);
