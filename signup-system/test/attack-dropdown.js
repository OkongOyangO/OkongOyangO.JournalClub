/**
 * ATTACK: the Form dropdown sync (refreshFormDates_) — what a submitter can pick.
 *
 *   TZ=America/New_York node test/attack-dropdown.js
 *
 * Loads the UNMODIFIED apps-script/Code.gs into a vm context (same technique as
 * test/harness.js, whose loadFixture()/formatDate() this file now REQUIRES from
 * test/lib.js rather than copying), but adds:
 *   - a FormApp stub with a fake Form + fake ListItem that RECORDS every
 *     setChoiceValues() argument,
 *   - a writable ScriptProperties stub (refreshFormDates_ legitimately writes
 *     NO_SLOTS_ALERTED / DATE_ITEM_ID, which harness.js forbids),
 *   - a pinned `new Date()` so "now" is deterministic,
 *   - per-scenario schedule values and property overrides.
 *
 * Nothing here talks to Google. Every scenario reloads Code.gs fresh.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCHEDULE_TZ = 'America/New_York';
const CODE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

/* ── shared instrument (fixture loader + formatDate stub) ─────────────────── */
const H = require('./lib');
const { loadFixture, formatDate, zonedMidnight } = H;

/** A Date whose zero-arg constructor is pinned, so `new Date()` inside Code.gs
 *  is deterministic. Everything else delegates to the real Date. */
function pinnedDate(nowMs) {
  const RealDate = Date;
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) { return new RealDate(nowMs).toString(); }
    if (args.length === 0) { return new RealDate(nowMs); }
    return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
  }
  FakeDate.now = () => nowMs;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  FakeDate.prototype = RealDate.prototype;
  return FakeDate;
}

/** Fake Form. `items` is [{title, type, id}]; a LIST item records choices. */
function makeForm(items) {
  const recorded = [];
  const mk = it => ({
    getId: () => it.id,
    getTitle: () => it.title,
    getType: () => it.type,
    asListItem: () => {
      if (it.type !== 'LIST') {
        throw new Error('Google Forms: asListItem() on a ' + it.type + ' item');
      }
      return { setChoiceValues: vals => { recorded.push(vals.slice()); return this; } };
    }
  });
  const wrapped = items.map(mk);
  const form = {
    getItems: () => wrapped,
    getItemById: id => {
      const i = items.findIndex(x => x.id === id);
      if (i < 0) { throw new Error('No item with ID ' + id); }
      return wrapped[i];
    }
  };
  return { form, recorded };
}

const DEFAULT_ITEMS = [
  { id: 111, title: 'Speaker name', type: 'TEXT' },
  { id: 222, title: 'Preferred date', type: 'LIST' },
  { id: 333, title: 'Talk title', type: 'TEXT' }
];

/**
 * Build a sandbox and run Code.gs in it.
 * opts: {values, props, nowMs, items}
 */
function boot(opts) {
  const values = opts.values || loadFixture();
  const items  = opts.items || DEFAULT_ITEMS;
  const nowMs  = opts.nowMs;
  const forbid = name => () => { throw new Error('unexpected mutation via ' + name); };

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

  const props = Object.assign({
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
  }, opts.props || {});

  const propWrites = [];
  const { form, recorded } = makeForm(items);

  const sandbox = {
    SpreadsheetApp: { openById: () => fakeSS, flush: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { propWrites.push(['set', k, v]); props[k] = v; },
        setProperties: o => { propWrites.push(['setAll', o]); Object.assign(props, o); },
        deleteProperty: k => { propWrites.push(['del', k]); delete props[k]; },
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
    MailApp:  { sendEmail: forbid('MailApp.sendEmail'), getRemainingDailyQuota: () => 100 },
    GmailApp: { createDraft: forbid('GmailApp.createDraft') },
    FormApp:  { openById: () => form, ItemType: { LIST: 'LIST', TEXT: 'TEXT',
                                                  PARAGRAPH_TEXT: 'PARAGRAPH_TEXT',
                                                  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
                                                  DATE: 'DATE' },
                DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    HtmlService: { createHtmlOutput: h => ({ setTitle: () => ({ getContent: () => h }),
                                             getContent: () => h }) },
    ScriptApp:   { newTrigger: forbid('ScriptApp.newTrigger'), getProjectTriggers: () => [] },
    CacheService:{ getScriptCache: () => ({ get: () => null, put: () => {} }) },
    DriveApp:    { getFileById: () => { throw new Error('DriveApp not stubbed'); } },
    UrlFetchApp: { fetch: () => { throw new Error('UrlFetchApp not stubbed'); } },
    Logger:      { log: () => {} },
    console,
    Date: nowMs === undefined ? Date : pinnedDate(nowMs),
    Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseInt, parseFloat,
    Function, Boolean, Infinity, undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE_SRC, sandbox, { filename: 'Code.gs' });
  return { g: sandbox, values, recorded, props, propWrites, form };
}

/** Run refreshFormDates_ and return everything observable about it. */
function refresh(opts) {
  const b = boot(opts);
  const problems = [];
  let summary = null, threw = null;
  try { summary = b.g.refreshFormDates_(problems); }
  catch (e) { threw = e; }
  return Object.assign(b, {
    problems, summary, threw,
    choices: b.recorded.length ? b.recorded[b.recorded.length - 1] : null,
    calls: b.recorded.length
  });
}

/* ── mini assert framework ────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok  ' + name); }
  else {
    fail++;
    failures.push(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`);
    console.log('  FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
  }
}
function note(name, v) { console.log('   ·  ' + name + ': ' + JSON.stringify(v)); }
function hdr(s) { console.log('\n=== ' + s + ' ==='); }

/* ── shared: schedule shape + row builder ─────────────────────────────────── */
const BASE = loadFixture();
const HEADER = BASE[0];
const IDX = {};
HEADER.forEach((h, i) => { IDX[String(h).trim().toLowerCase()] = i; });

function row(y, m, d, opts) {
  opts = opts || {};
  const dt = new Date(y, m - 1, d);
  const r = new Array(HEADER.length).fill('');
  r[IDX['date']] = dt;
  r[IDX['day of week']] = opts.dow !== undefined ? opts.dow
    : formatDate(dt, SCHEDULE_TZ, 'EEEE');
  if (IDX['time'] !== undefined) { r[IDX['time']] = opts.time !== undefined ? opts.time : '4:30pm - 6:00pm'; }
  if (IDX['room'] !== undefined) { r[IDX['room']] = opts.room !== undefined ? opts.room : 'Davey 339'; }
  r[IDX['speaker']] = opts.speaker || '';
  return r;
}

const NOW_MS = new Date(2026, 7, 8).getTime();   // 2026-08-08 local midnight

/** Free-slot ISO keys per isFreeSlot_, computed independently of the dropdown. */
function freeKeys(g, values, nowMs) {
  const ctx = g.openSchedule_();
  const now = new Date(nowMs);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    if (g.isFreeSlot_(values[r], ctx.col, ctx.tz, now)) {
      out.push(g.dayKey_(g.coerceDate_(values[r][ctx.col.date], ctx.tz, ''), ctx.tz));
    }
  }
  out.sort();
  return out;
}

console.log('ATTACK: refreshFormDates_ — the Form date dropdown');
console.log('now = 2026-08-08 00:00 America/New_York');

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Baseline against the real fixture
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('1. baseline: fixture, LEAD_DAYS=7, MAX_CHOICES=30');
{
  const R = refresh({ nowMs: NOW_MS });
  check('did not throw', R.threw === null, true);
  check('setChoiceValues called once', R.calls, 1);
  note('summary', R.summary);
  note('problems', R.problems);
  note('choice count', R.choices.length);
  note('first choice', R.choices[0]);
  note('last choice', R.choices[R.choices.length - 1]);

  const free = freeKeys(R.g, R.values, NOW_MS);
  note('free slots per isFreeSlot_', free.length);
  note('first free', free[0]);

  const offered = R.choices.map(c => R.g.parseIsoPrefix_(c));
  // every offered choice is genuinely free
  check('every offered ISO is in the free set',
        offered.filter(k => free.indexOf(k) < 0), []);
  // nothing free and >= LEAD_DAYS out was dropped (26 free, all >= 7d out, < 30 cap)
  const eligible = free.filter(k => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d).getTime() - NOW_MS >= 7 * 86400000;
  });
  check('offered set == eligible set', offered.slice().sort(), eligible.slice().sort());
  check('offered in ascending date order',
        JSON.stringify(offered) === JSON.stringify(offered.slice().sort()), true);
  check('first offered is the first eligible free slot', offered[0], eligible[0]);

  // ROUND TRIP: what it WRITES vs what the submit path READS.
  let bad = [];
  for (const c of R.choices) {
    const k = R.g.parseIsoPrefix_(c);
    // Code.gs: processSubmission_ does parseIsoPrefix_(getAnswer_(row,'date')),
    // and getAnswer_ is String(...).trim() — so simulate that too.
    const viaAnswer = R.g.parseIsoPrefix_(String(c).trim());
    const viaAdmin  = R.g.normalizeDateKey_(k, SCHEDULE_TZ);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || viaAnswer !== k || viaAdmin !== k) {
      bad.push([c, k, viaAnswer, viaAdmin]);
    }
  }
  check('round-trip choice -> parseIsoPrefix_ -> normalizeDateKey_', bad, []);

  // and each round-tripped key must resolve to a FREE slot
  const states = {};
  const ctx = R.g.openSchedule_();
  for (const c of R.choices) {
    const s = R.g.slotState_(ctx, R.g.parseIsoPrefix_(c), new Date(NOW_MS)).state;
    states[s] = (states[s] || 0) + 1;
  }
  check('every offered choice resolves to state FREE', states, { FREE: R.choices.length });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. LEAD_DAYS
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('2. LEAD_DAYS = 0 / 7 / 3650');
{
  // The fixture's first free slot is 37 days out, so add near-term free rows to
  // put something INSIDE the lead window.
  const v = BASE.map(r => r.slice());
  v.push(row(2026, 8,  9));   // tomorrow
  v.push(row(2026, 8, 12));   // +4 days  (inside a 7-day window)
  v.push(row(2026, 8, 14));   // +6 days  (inside)
  v.push(row(2026, 8, 15));   // +7 days exactly (boundary)
  v.push(row(2026, 8, 16));   // +8 days  (outside)

  const iso = R => R.choices.map(c => R.g.parseIsoPrefix_(c));

  const L0 = refresh({ nowMs: NOW_MS, values: v, props: { LEAD_DAYS: '0' } });
  note('LEAD_DAYS=0 first five', iso(L0).slice(0, 5));
  check('LEAD_DAYS=0 offers tomorrow', iso(L0)[0], '2026-08-09');
  check('LEAD_DAYS=0 never offers today or past',
        iso(L0).filter(k => k <= '2026-08-08'), []);

  const L7 = refresh({ nowMs: NOW_MS, values: v, props: { LEAD_DAYS: '7' } });
  note('LEAD_DAYS=7 first five', iso(L7).slice(0, 5));
  check('LEAD_DAYS=7 excludes +1/+4/+6',
        iso(L7).filter(k => ['2026-08-09', '2026-08-12', '2026-08-14'].indexOf(k) >= 0), []);
  check('LEAD_DAYS=7 first offered is the +7d boundary slot', iso(L7)[0], '2026-08-15');

  const LBIG = refresh({ nowMs: NOW_MS, values: v, props: { LEAD_DAYS: '3650' } });
  note('LEAD_DAYS=3650 summary', LBIG.summary);
  note('LEAD_DAYS=3650 problems', LBIG.problems);
  check('LEAD_DAYS=3650 -> no choices, placeholder installed', LBIG.choices.length, 1);
}

hdr('2b. the lead window is CALENDAR days, independent of the run hour');
{
  // installStep3 registers nightlyMaintenance with .everyDays(1).atHour(4),
  // so the real `now` is ~04:00-05:00, never midnight.
  const v = BASE.map(r => r.slice());
  v.push(row(2026, 8, 15));   // Saturday, exactly 7 CALENDAR days after 2026-08-08
  v.push(row(2026, 8, 16));   // exactly 8 calendar days out

  const at = h => {
    const R = refresh({ nowMs: new Date(2026, 7, 8, h, 0).getTime(), values: v });
    return R.choices.map(c => R.g.parseIsoPrefix_(c));
  };
  const midnight = at(0);
  const trigger  = at(4);     // the hour the installed trigger actually fires

  const late = at(23);
  note('run at 00:00 -> earliest offered', midnight[0]);
  note('run at 04:00 -> earliest offered', trigger[0]);
  note('run at 23:00 -> earliest offered', late[0]);
  // REGRESSION GUARD. The filter used to be `slotMidnight - now < LEAD_DAYS*86400000`
  // against the exact run instant, so the 04:00 trigger was four hours short and
  // LEAD_DAYS=7 silently behaved as 8 every single night — contradicting the
  // function's own "at least LEAD_DAYS days out". It now compares day keys.
  check('at 00:00 the +7-calendar-day slot IS offered', midnight.indexOf('2026-08-15') >= 0, true);
  check('at 04:00 (the real trigger hour) it is offered TOO',
        trigger.indexOf('2026-08-15') >= 0, true);
  check('and at 23:00 as well', late.indexOf('2026-08-15') >= 0, true);
  check('=> LEAD_DAYS=7 means exactly 7 calendar days at any run hour',
        [midnight[0], trigger[0], late[0]], ['2026-08-15', '2026-08-15', '2026-08-15']);
}

hdr('2c. the lead window does NOT shift across a DST transition');
{
  // 2027-03-14 02:00 EST -> EDT. The fixture already contains a FREE row on
  // 2027-03-15, and 2027-03-08 -> 2027-03-15 is exactly 7 calendar days but
  // only 7*86400000 - 3600000 ms of elapsed time.
  const probe = boot({ nowMs: NOW_MS });
  const ctx0 = probe.g.openSchedule_();
  const r315 = probe.g.findRowByDate_(ctx0, '2027-03-15');
  check('2027-03-15 is a real free row in the fixture',
        [r315.status, String(probe.g.normCell_(r315.row.values[ctx0.col.speaker]))], ['OK', '']);

  // Reference: a non-DST week, run at exactly midnight -> 7 calendar days IS offered.
  const ctrl = refresh({ nowMs: new Date(2027, 1, 8, 0, 0).getTime() });   // 2027-02-08
  const ctrlIso = ctrl.choices.map(c => ctrl.g.parseIsoPrefix_(c));
  check('control: 2027-02-15 (7 cal days, no DST) IS offered at midnight',
        ctrlIso.indexOf('2027-02-15') >= 0, true);

  // The DST week, same midnight run.
  const R = refresh({ nowMs: new Date(2027, 2, 8, 0, 0).getTime() });      // 2027-03-08
  const iso = R.choices.map(c => R.g.parseIsoPrefix_(c));
  note('now = 2027-03-08 00:00 EST; slot 2027-03-15 is 7 calendar days out', null);
  note('elapsed ms between them', new Date(2027, 2, 15).getTime() - new Date(2027, 2, 8).getTime());
  note('7 days in ms', 7 * 86400000);
  note('summary', R.summary);
  // REGRESSION GUARD, and this is the sharp end of it: 2027-03-15 is the LAST free
  // row in the fixture. With the old millisecond window a spring-forward week is
  // 23 hours short, so this slot vanished and the whole dropdown was replaced by
  // "(no open dates at the moment — please email ...)" while the slot was free.
  check('DST week: the identical 7-calendar-day slot IS still offered',
        iso.indexOf('2027-03-15') >= 0, true);
  check('so the form does NOT fall back to the "no open dates" placeholder',
        /no open dates/.test(String(R.choices[0])), false);

  // Fall back: 2026-11-01 02:00 EDT -> EST. 2026-10-26 -> 2026-11-02 is
  // 7 calendar days but 7*86400000 + 3600000 ms, so the window LOOSENS.
  const R2 = refresh({ nowMs: new Date(2026, 9, 26, 0, 30).getTime() });
  const iso2 = R2.choices.map(c => R2.g.parseIsoPrefix_(c));
  note('now = 2026-10-26 00:30 EDT, slot 2026-11-02 (7 cal days, 7d+1h of ms)', null);
  note('offered?', iso2.indexOf('2026-11-02') >= 0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. MAX_CHOICES truncation
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('3. MAX_CHOICES = 30 with > 30 free slots (soonest must survive)');
{
  // Append TEN extra free rows, five of them EARLIER than every existing free
  // slot, appended at the END of the sheet — so if truncation happened before
  // sorting, the near-term dates would be the ones thrown away.
  const v = BASE.map(r => r.slice());
  const early = ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-25'];
  const late  = ['2027-06-07', '2027-06-14', '2027-06-21', '2027-06-28', '2027-07-05'];
  for (const k of early.concat(late)) {
    const [y, m, d] = k.split('-').map(Number);
    v.push(row(y, m, d));
  }
  const R = refresh({ nowMs: NOW_MS, values: v });
  const free = freeKeys(R.g, v, NOW_MS);
  note('free slots now', free.length);
  check('more free slots than the cap', free.length > 30, true);
  const iso = R.choices.map(c => R.g.parseIsoPrefix_(c));
  check('exactly MAX_CHOICES offered', iso.length, 30);
  check('the 30 offered are the 30 SOONEST', iso, free.slice(0, 30));
  check('near-term early rows survived truncation',
        early.filter(k => iso.indexOf(k) < 0), []);
  note('offered first/last', [iso[0], iso[29]]);

  // Small cap, to make the truncation direction unmistakable.
  const R5 = refresh({ nowMs: NOW_MS, values: v, props: { MAX_CHOICES: '5' } });
  const iso5 = R5.choices.map(c => R5.g.parseIsoPrefix_(c));
  check('MAX_CHOICES=5 keeps the 5 soonest', iso5, free.slice(0, 5));
}

hdr('3b. MAX_CHOICES misconfiguration');
{
  const R0 = refresh({ nowMs: NOW_MS, props: { MAX_CHOICES: '0' } });
  note('MAX_CHOICES=0 summary', R0.summary);
  note('MAX_CHOICES=0 problems', R0.problems);
  note('MAX_CHOICES=0 choices', R0.choices);
  // REGRESSION GUARD. Truncation used to happen before the empty check, so a zero
  // or negative MAX_CHOICES was indistinguishable from a genuinely full schedule:
  // the nightly mail said "add more rows to the schedule sheet" with 26 rows free,
  // and every submitter was told to email instead of signing up. MAX_CHOICES is
  // now clamped to >= 1 on read.
  check('MAX_CHOICES=0 is clamped, not treated as "no open slots"',
        /no open dates/.test(String(R0.choices[0])), false);
  check('MAX_CHOICES=0 offers exactly one date', R0.choices.length, 1);
  check('and it is the soonest one', R0.g.parseIsoPrefix_(R0.choices[0]), '2026-09-14');
  check('no misleading "add more rows" problem', R0.problems, []);

  const Rn = refresh({ nowMs: NOW_MS, props: { MAX_CHOICES: '-1' } });
  const isoN = Rn.choices.map(c => Rn.g.parseIsoPrefix_(c));
  note('MAX_CHOICES=-1 choice count', isoN.length);
  note('MAX_CHOICES=-1 first offered', isoN[0]);
  // `open.slice(0, -1)` used to drop the FURTHEST slot with no message at all.
  check('MAX_CHOICES=-1 is clamped too', isoN, ['2026-09-14']);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Zero free slots
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('4. zero free slots');
{
  // Book every currently-free row.
  const v = BASE.map(r => r.slice());
  const probe = boot({ nowMs: NOW_MS, values: v });
  const ctx = probe.g.openSchedule_();
  let booked = 0;
  for (let r = 1; r < v.length; r++) {
    if (probe.g.isFreeSlot_(v[r], ctx.col, ctx.tz, new Date(NOW_MS))) {
      v[r][ctx.col.speaker] = 'Somebody Else'; booked++;
    }
  }
  note('rows booked to empty the schedule', booked);
  check('no free slots remain', freeKeys(probe.g, v, NOW_MS).length, 0);

  const R = refresh({ nowMs: NOW_MS, values: v });
  check('did not throw', R.threw === null, true);
  check('setChoiceValues still called (dropdown NOT left stale)', R.calls, 1);
  check('exactly one placeholder choice', R.choices.length, 1);
  note('placeholder', R.choices[0]);
  note('summary', R.summary);
  note('problems', R.problems);
  check('a problem was reported', R.problems.length, 1);
  check('NO_SLOTS_ALERTED was set',
        R.propWrites.filter(w => w[1] === 'NO_SLOTS_ALERTED'), [['set', 'NO_SLOTS_ALERTED', 'YES']]);

  // Placeholder round-trip: a submitter CAN pick it. What does the submit path see?
  const key = R.g.parseIsoPrefix_(R.choices[0]);
  check('placeholder parses to no date key', key, '');
  note('=> processSubmission_ would set STATUS=ERROR and email "handle by hand"', true);

  // Second nightly run must not re-alert.
  const R2 = refresh({ nowMs: NOW_MS, values: v, props: { NO_SLOTS_ALERTED: 'YES' } });
  check('second run does not re-alert', R2.problems.length, 0);
  check('second run still rewrites the placeholder', R2.calls, 1);

  // And when slots come back the alert is re-armed.
  const R3 = refresh({ nowMs: NOW_MS, props: { NO_SLOTS_ALERTED: 'YES' } });
  check('slots back -> NO_SLOTS_ALERTED deleted',
        R3.propWrites.filter(w => w[1] === 'NO_SLOTS_ALERTED'), [['del', 'NO_SLOTS_ALERTED']]);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. The date question is missing / the wrong type
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('5. wrong item type / missing item');
{
  // (a) titled right, but a TEXT item
  const A = refresh({ nowMs: NOW_MS, items: [
    { id: 111, title: 'Speaker name', type: 'TEXT' },
    { id: 222, title: 'Preferred date', type: 'TEXT' }
  ]});
  check('(a) no setChoiceValues attempted on a TEXT item', A.calls, 0);
  check('(a) did not throw', A.threw === null, true);
  check('(a) reported a problem', A.problems.length, 1);
  note('(a) problem', A.problems[0]);
  note('(a) summary', A.summary);

  // (b) a MULTIPLE_CHOICE item (radio) — a very plausible mis-edit
  const B = refresh({ nowMs: NOW_MS, items: [
    { id: 222, title: 'Preferred date', type: 'MULTIPLE_CHOICE' }
  ]});
  check('(b) MULTIPLE_CHOICE rejected, problem reported', [B.calls, B.problems.length], [0, 1]);

  // (c) item deleted entirely
  const C = refresh({ nowMs: NOW_MS, items: [
    { id: 111, title: 'Speaker name', type: 'TEXT' }
  ]});
  check('(c) missing item -> problem, no throw', [C.calls, C.problems.length, C.threw === null],
        [0, 1, true]);

  // (d) stale DATE_ITEM_ID cache pointing at a deleted item
  const D = refresh({ nowMs: NOW_MS, props: { DATE_ITEM_ID: '9999' } });
  check('(d) stale cached id falls back to title search', D.calls, 1);
  check('(d) cache repaired to the real id',
        D.propWrites.filter(w => w[1] === 'DATE_ITEM_ID'), [['set', 'DATE_ITEM_ID', '222']]);

  // (e) cached id points at an item that is now a TEXT item, and a *different*
  //     LIST item is titled "Preferred date"
  const E = refresh({ nowMs: NOW_MS, props: { DATE_ITEM_ID: '111' }, items: [
    { id: 111, title: 'Preferred date', type: 'TEXT' },
    { id: 777, title: 'Preferred date', type: 'LIST' }
  ]});
  check('(e) type-checked cache falls through to the real dropdown', E.calls, 1);

  // (f) a renamed question that is NOT in QUESTION_ALIASES
  const F = refresh({ nowMs: NOW_MS, items: [
    { id: 222, title: 'Which date works for you?', type: 'LIST' }
  ]});
  check('(f) unrecognised title -> problem, dropdown left stale', [F.calls, F.problems.length],
        [0, 1]);
  note('(f) summary', F.summary);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Choice-string construction under hostile sheet content
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('6. choice string content');
{
  // NOTE: none of these dates exist in the fixture (Sept rows are 7/14/21/28),
  // so each choice below is produced by exactly one row.
  const v = BASE.map(r => r.slice());
  // A time cell that Sheets stored as a real time value (type a bare "4:30 PM"
  // into the TIme column and this is exactly what getValues() hands back).
  v.push(row(2026, 9, 15, { time: new Date(1899, 11, 30, 16, 30) }));
  // A room cell containing a newline (pasted from a doc).
  v.push(row(2026, 9, 16, { room: 'Davey 339\nZoom: 123 456' }));
  // A Day of Week cell that disagrees with the actual date.
  v.push(row(2026, 9, 17, { dow: 'Friday' }));
  // A blank Day of Week cell (falls back to formatDate EEEE).
  v.push(row(2026, 9, 18, { dow: '' }));
  // Room literally "N/A" — code is supposed to omit it.
  v.push(row(2026, 9, 19, { room: 'N/A' }));

  const R = refresh({ nowMs: NOW_MS, values: v, props: { MAX_CHOICES: '200' } });
  const byKey = {};
  R.choices.forEach(c => { byKey[R.g.parseIsoPrefix_(c)] = c; });
  note('time-typed cell  ', byKey['2026-09-15']);
  note('newline in room  ', JSON.stringify(byKey['2026-09-16']));
  note('wrong DOW cell   ', byKey['2026-09-17']);
  note('blank DOW cell   ', byKey['2026-09-18']);
  note('room = N/A       ', byKey['2026-09-19']);

  // REGRESSION GUARD. normCell_ returns Date objects unchanged (right for the date
  // column), and a bare String() of a time-typed TIme cell produced
  // "Sat Dec 30 1899 16:30:00 GMT-0500 (Eastern Standard Time)" inside the
  // dropdown option AND inside the speaker's confirmation email. cellText_ now
  // formats it in the sheet's timezone.
  check('time-typed cell no longer leaks a raw JS Date toString',
        /GMT|Standard Time|Daylight Time|1899/.test(String(byKey['2026-09-15'])), false);
  check('it renders as a readable clock time',
        /, 4:30 PM,/.test(String(byKey['2026-09-15'])), true);
  check('newline survives into the choice string',
        /\n/.test(String(byKey['2026-09-16'])), true);
  check('choice shows the sheet DOW verbatim even when it contradicts the date',
        /Friday 17 September/.test(String(byKey['2026-09-17'])), true);
  check('actual weekday of 2026-09-17', formatDate(new Date(2026, 8, 17), SCHEDULE_TZ, 'EEEE'),
        'Thursday');
  check('blank DOW falls back to the true weekday',
        /Friday 18 September/.test(String(byKey['2026-09-18'])), true);
  check('room "N/A" omitted', /N\/A/.test(String(byKey['2026-09-19'])), false);

  // All of them still round-trip: the ISO prefix is unharmed.
  const bad = R.choices.filter(c => !/^\d{4}-\d{2}-\d{2}/.test(c));
  check('every choice still starts with a bare ISO date', bad, []);

  // The same String(normCell_(time)) pattern is rowTime_, which builds the line
  // in the SPEAKER'S confirmation email ("Your talk is confirmed for ...").
  const ctx2 = R.g.openSchedule_();
  const found = R.g.findRowByDate_(ctx2, '2026-09-15');
  const t = R.g.rowTime_(ctx2, found.row);
  const room = R.g.rowRoom_(ctx2, found.row);
  const whenLine = R.g.fmtLong_(found.row.date, ctx2.tz) + (t ? ', ' + t : '') +
                   (room && room.toUpperCase() !== 'N/A' ? ', ' + room : '');
  note('confirmation-email "when" line for that row', whenLine);
  check('and the speaker confirmation email is clean too',
        /GMT|Standard Time|Daylight Time|1899/.test(whenLine), false);
  check('the email says a real clock time',
        whenLine, 'Tuesday 15 September 2026, 4:30 PM, Davey 339');
}

hdr('6b. two free rows sharing one date -> a choice that cannot be approved');
{
  // 2026-10-06 is NOT in the fixture (Oct rows are 5/12/19/26), so both rows
  // below are ones a human added — the classic copy-paste-the-row mistake.
  const v = BASE.map(r => r.slice());
  v.push(row(2026, 10, 6));
  v.push(row(2026, 10, 6));
  const R = refresh({ nowMs: NOW_MS, values: v, props: { MAX_CHOICES: '200' } });
  const iso = R.choices.map(c => R.g.parseIsoPrefix_(c));
  const dupCount = iso.filter(k => k === '2026-10-06').length;
  note('times 2026-10-06 appears in the dropdown', dupCount);
  note('the choice strings', R.choices.filter(c => /^2026-10-06/.test(c)));
  // REGRESSION GUARD. refreshFormDates_ built one choice per free ROW while
  // findRowByDate_ resolves one row per DATE and refuses a duplicated date as
  // AMBIGUOUS — so the form advertised, twice and byte-identically, a slot no
  // approval could ever complete. The speaker signs up, waits, and the organizer's
  // approve link dead-ends on "remove the duplicate". The date is now withheld and
  // NAMED in the nightly report instead.
  note('problems raised', R.problems);
  check('the duplicated date is NOT offered at all', dupCount, 0);
  check('and the nightly report names it with both row numbers',
        R.problems.some(p => /2026-10-06/.test(p) && /rows \d+, \d+/.test(p)), true);
  check('every other free date is still offered', iso.length > 20, true);
  const ctx = R.g.openSchedule_();
  const st = R.g.slotState_(ctx, '2026-10-06', new Date(NOW_MS)).state;
  note('slotState_ for that withheld date', st);
  check('and it would indeed have been refused as AMBIGUOUS', st, 'AMBIGUOUS');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Empty schedule / schema damage
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('7. degenerate schedules');
{
  const headerOnly = [HEADER.slice()];
  const R = refresh({ nowMs: NOW_MS, values: headerOnly });
  check('header-only sheet -> placeholder, no throw',
        [R.threw === null, R.calls, R.choices.length], [true, 1, 1]);
  note('summary', R.summary);

  // A completely blank sheet: resolveScheduleCols_ should throw, and
  // nightlyMaintenance must catch it rather than die.
  const B = refresh({ nowMs: NOW_MS, values: [[]] });
  check('blank sheet throws out of refreshFormDates_', B.threw !== null, true);
  note('thrown message', B.threw && B.threw.message);
  check('no setChoiceValues attempted', B.calls, 0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. The form itself is gone / not accessible
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('8. FormApp.openById fails');
{
  const b = boot({ nowMs: NOW_MS });
  b.g.FormApp.openById = () => { throw new Error('No item with the given ID could be found'); };
  const problems = [];
  let threw = null;
  try { b.g.refreshFormDates_(problems); } catch (e) { threw = e; }
  check('throws out of refreshFormDates_', threw !== null, true);
  note('message', threw && threw.message);
  note('=> nightlyMaintenance wraps this call in try/catch (Code.gs:2194-2195)', true);

  // Missing FORM_EDIT_ID is a config error, not a crash-with-no-explanation.
  const b2 = boot({ nowMs: NOW_MS, props: { FORM_EDIT_ID: '' } });
  let threw2 = null;
  try { b2.g.refreshFormDates_([]); } catch (e) { threw2 = e; }
  check('blank FORM_EDIT_ID gives a named configuration error',
        /Configuration missing: FORM_EDIT_ID/.test(String(threw2 && threw2.message)), true);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Answers the dropdown never offered (forged POST / stale open page)
 * ══════════════════════════════════════════════════════════════════════════ */
hdr('9. answers that were never in the dropdown');
{
  const b = boot({ nowMs: NOW_MS });
  const ctx = b.g.openSchedule_();
  const now = new Date(NOW_MS);
  const probe = s => {
    const key = b.g.parseIsoPrefix_(s);
    return [key, key ? b.g.slotState_(ctx, key, now).state : 'NO_DATE'];
  };
  const cases = [
    '2026-08-24 — Monday 24 August, 4:30pm - 6:00pm, Davey 339',  // TAKEN
    '2026-08-10 — Monday 10 August',                              // BREAK (N/A)
    '2026-06-22 — Monday 22 June',                                // PAST, booked
    '2026-07-13 — Monday 13 July',                                // no row at all
    '2030-01-01 — whenever I like',                               // far future, no row
    '2026-13-45 — nonsense month/day',                            // syntactically ISO-ish
    'Monday 14 September 2026',                                   // no ISO prefix
    '  2026-09-14 — leading spaces',                              // tolerated?
    '(no open dates at the moment — please email yzj5306@psu.edu)' // the placeholder
  ];
  for (const c of cases) { note(JSON.stringify(c), probe(c)); }
  check('a TAKEN date still parses to a key (PENDING, not rejected at submit)',
        probe(cases[0]), ['2026-08-24', 'TAKEN']);
  check('leading whitespace is tolerated by parseIsoPrefix_',
        probe(cases[7]), ['2026-09-14', 'FREE']);
  check('"2026-13-45" parses to a key that matches no row',
        probe(cases[5]), ['2026-13-45', 'NOT_IN_SCHEDULE']);
  check('a human-readable date with no ISO prefix yields no key at all',
        probe(cases[6]), ['', 'NO_DATE']);
}

/* ── verdict ──────────────────────────────────────────────────────────────── */
console.log('\n' + '='.repeat(70));
if (fail) {
  console.log(`${pass} passed, ${fail} FAILED\n`);
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log(`all ${pass} assertions held`);
