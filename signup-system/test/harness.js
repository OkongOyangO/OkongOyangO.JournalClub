/**
 * Node harness for the schedule logic in ../apps-script/Code.gs.
 *
 * WHY: the date/slot functions are the ones that can lose a real person's talk —
 * write it onto the wrong week, declare a free slot taken, or silently fail to
 * find a row. Code review can only reason about them. This executes them, in
 * Node, against a snapshot of the actual Journal Club schedule.
 *
 * It works by stubbing the handful of Apps Script globals the pure logic touches
 * (SpreadsheetApp, Utilities, PropertiesService, Session) and loading Code.gs
 * unmodified into a vm context, so the code under test is the code that ships.
 * Nothing here talks to Google, sends mail, or writes anything.
 *
 *   TZ=America/New_York node test/harness.js
 *
 * Regenerate the fixture with:
 *   curl -s "https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json" \
 *        -o test/fixture-schedule.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCHEDULE_TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Fixture -> the 2-D array SpreadsheetApp's getValues() would hand back.
// Date cells become real Date objects at midnight in the sheet's timezone,
// which is exactly what Apps Script does; everything else becomes a string.
// ---------------------------------------------------------------------------
function loadFixture() {
  const raw = fs.readFileSync(path.join(__dirname, 'fixture-schedule.json'), 'utf8');
  const d = JSON.parse(raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')));
  const cols = d.table.cols.map(c => String(c.label || ''));
  const values = [cols];
  const DATE_RE = /^Date\((\d+),(\d+),(\d+)/;
  for (const r of d.table.rows) {
    const cells = r.c || [];
    const out = [];
    for (let i = 0; i < cols.length; i++) {
      const cell = cells[i];
      if (!cell || cell.v === null || cell.v === undefined) { out.push(''); continue; }
      const m = DATE_RE.exec(String(cell.v));
      out.push(m ? new Date(+m[1], +m[2], +m[3]) : String(cell.v));
    }
    values.push(out);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Utilities.formatDate — the only stub with real behaviour to get right.
// Supports exactly the six patterns Code.gs uses.
// ---------------------------------------------------------------------------
function formatDate(date, tz, pattern) {
  const part = (opts, type) => {
    const p = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts))
      .formatToParts(date).find(x => x.type === type);
    return p ? p.value : '';
  };
  const yyyy  = part({ year: 'numeric' }, 'year');
  const MM    = part({ month: '2-digit' }, 'month');
  const dd    = part({ day: '2-digit' }, 'day');
  const d     = String(parseInt(dd, 10));
  const MMMM  = part({ month: 'long' }, 'month');
  const EEEE  = part({ weekday: 'long' }, 'weekday');
  const EEE   = part({ weekday: 'short' }, 'weekday');

  switch (pattern) {
    case 'yyyy-MM-dd':        return `${yyyy}-${MM}-${dd}`;
    case 'yyyy':              return yyyy;
    case 'd MMMM':            return `${d} ${MMMM}`;
    case 'EEEE d MMMM yyyy':  return `${EEEE} ${d} ${MMMM} ${yyyy}`;
    case 'EEEE':              return EEEE;
    case 'EEE':               return EEE;
    default: throw new Error('harness: unsupported formatDate pattern ' + pattern);
  }
}

// ---------------------------------------------------------------------------
// Stubs. Anything that would mutate throws loudly — if a "read-only" code path
// under test ever reaches one, the test fails instead of quietly passing.
// ---------------------------------------------------------------------------
function buildSandbox(values) {
  const forbid = name => () => { throw new Error('harness: unexpected mutation via ' + name); };

  const fakeSheet = {
    getSheetId: () => 0,
    getName:    () => 'Schedule',
    getDataRange: () => ({ getValues: () => values }),
    getRange:   () => ({ setValue: forbid('Range.setValue'),
                         setValues: forbid('Range.setValues'),
                         setNumberFormat: forbid('Range.setNumberFormat'),
                         getValue: () => '', getValues: () => [[]] }),
    getMaxRows: () => values.length,
    getLastRow: () => values.length,
  };
  const fakeSS = {
    getSheets: () => [fakeSheet],
    getSheetByName: () => fakeSheet,
    getSpreadsheetTimeZone: () => SCHEDULE_TZ,
    getId: () => 'FAKE_SCHEDULE_ID',
  };

  const props = {
    SCHEDULE_SS_ID: 'FAKE_SCHEDULE_ID',
    SCHEDULE_TAB_GID: '0',
    RESPONSES_SS_ID: 'FAKE_RESPONSES_ID',
    RESPONSES_TAB_NAME: 'Form Responses 1',
    FORM_EDIT_ID: 'FAKE_FORM_ID',
    NOTIFY_EMAIL: 'test@example.com',
    DEFAULT_ROOM: 'Davey 339',
    LEAD_DAYS: '7',
    MAX_CHOICES: '30',
    EXEC_URL: 'https://script.google.com/macros/s/FAKE/exec',
    HMAC_SECRET: 'dGVzdC1zZWNyZXQtZm9yLXRoZS1oYXJuZXNz',
  };

  return {
    SpreadsheetApp: {
      openById: () => fakeSS,
      flush: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: forbid('Properties.setProperty'),
        setProperties: forbid('Properties.setProperties'),
        deleteProperty: forbid('Properties.deleteProperty'),
      }),
    },
    Session: { getScriptTimeZone: () => SCHEDULE_TZ },
    Utilities: {
      formatDate,
      getUuid: () => '00000000-0000-4000-8000-000000000000',
      base64Encode: s => Buffer.from(String(s)).toString('base64'),
      base64EncodeWebSafe: s => Buffer.from(String(s)).toString('base64url'),
      computeHmacSha256Signature: () => [1, 2, 3],
      computeDigest: () => [1, 2, 3],
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      sleep: () => {},
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    MailApp:     { sendEmail: forbid('MailApp.sendEmail'), getRemainingDailyQuota: () => 100 },
    GmailApp:    { createDraft: forbid('GmailApp.createDraft') },
    FormApp:     { openById: () => { throw new Error('harness: FormApp not stubbed'); },
                   DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    HtmlService: { createHtmlOutput: h => ({ setTitle: () => ({ getContent: () => h }),
                                             getContent: () => h }) },
    ScriptApp:   { newTrigger: forbid('ScriptApp.newTrigger'), getProjectTriggers: () => [] },
    CacheService:{ getScriptCache: () => ({ get: () => null, put: () => {} }) },
    DriveApp:    { getFileById: () => { throw new Error('harness: DriveApp not stubbed'); } },
    UrlFetchApp: { fetch: () => { throw new Error('harness: UrlFetchApp not stubbed'); } },
    Logger:      { log: () => {} },
    console,
    Date, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat,
  };
}

// ---------------------------------------------------------------------------
function load() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const values = loadFixture();
  const sandbox = buildSandbox(values);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  return { g: sandbox, values };
}

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
const NOW = new Date(2026, 7, 8); // 2026-08-08, the day this fixture was taken

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
check('from Date object', g.normalizeDateKey_(new Date(2026, 7, 24), SCHEDULE_TZ), '2026-08-24');
check('from empty', g.normalizeDateKey_('', SCHEDULE_TZ), '');

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(58));
if (fail) {
  console.log(`FAILED — ${pass} passed, ${fail} failed\n`);
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log(`PASSED — all ${pass} checks green`);
