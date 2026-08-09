/**
 * test/lib.js — the shared instrument every suite in this directory runs on.
 *
 * WHY IT IS A MODULE. These helpers used to be copied into each attack file, or
 * lifted out of harness.js by slicing its source at a marker comment. Both drift:
 * a fix to the fixture model or to the formatDate stub reached one suite and not
 * the others, and a stale copy fails in a way that looks exactly like a Code.gs
 * regression. One module, four requires, no drift.
 *
 * Nothing here talks to Google, sends mail, or writes anything. Every stub that
 * would MUTATE throws loudly, so a read-only code path that starts writing fails
 * the test instead of quietly passing.
 *
 * Regenerate the fixture with:
 *   curl -s "https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json" \
 *        -o test/fixture-schedule.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE_GS_PATH = path.join(__dirname, '..', 'apps-script', 'Code.gs');

const SCHEDULE_TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Fixture -> the 2-D array SpreadsheetApp's getValues() would hand back.
// Date cells become real Date objects at midnight in the sheet's timezone,
// which is exactly what Apps Script does; everything else becomes a string.
// ---------------------------------------------------------------------------

// True midnight of y/m/d in `tz`, whatever timezone this process happens to run
// in. Using `new Date(y, m, d)` here (host-local midnight) made the whole harness
// host-TZ dependent: under TZ=UTC every fixture row keyed one day early and the
// suite died with a TypeError that looked exactly like a Code.gs regression.
// Real getValues() returns sheet-tz midnight regardless of where the script runs,
// so this is also the faithful model.
const _midnightCache = new Map();
function zonedMidnight(y, m, d, tz) {
  const ck = `${tz}|${y}|${m}|${d}`;
  const hit = _midnightCache.get(ck);
  if (hit) { return new Date(hit); }
  const want = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let t = Date.UTC(y, m, d, 12, 0, 0);
  const keyOf = ms => {
    const p = _fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms));
    const g = t => (p.find(x => x.type === t) || {}).value || '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  };
  if (keyOf(t) !== want) { t += (keyOf(t) < want ? 1 : -1) * 86400000; }
  // Walk back from noon to the first instant that is still the same day in tz.
  let lo = t - 18 * 3600000, hi = t;
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
    if (keyOf(mid) === want) { hi = mid; } else { lo = mid; }
  }
  _midnightCache.set(ck, hi);
  return new Date(hi);
}

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
      out.push(m ? zonedMidnight(+m[1], +m[2], +m[3], SCHEDULE_TZ) : String(cell.v));
    }
    values.push(out);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Utilities.formatDate — the only stub with real behaviour to get right.
// Supports exactly the six patterns Code.gs uses.
// ---------------------------------------------------------------------------
// Intl.DateTimeFormat construction dominates the runtime of the whole suite —
// attack-dates alone formats a date over a million times sweeping LEAD_DAYS across
// a year at three run hours. Formatters are immutable, so cache them by shape.
const _fmtCache = new Map();
function _fmt(tz, opts) {
  const key = tz + '|' + JSON.stringify(opts);
  let f = _fmtCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)); _fmtCache.set(key, f); }
  return f;
}

function formatDate(date, tz, pattern) {
  const part = (opts, type) => {
    const p = _fmt(tz, opts).formatToParts(date).find(x => x.type === type);
    return p ? p.value : '';
  };
  // Lazy getters: `yyyy-MM-dd` is by far the hottest pattern and must not pay for
  // the weekday/month-name formatters it never uses.
  const yyyy  = () => part({ year: 'numeric' }, 'year');
  const MM    = () => part({ month: '2-digit' }, 'month');
  const dd    = () => part({ day: '2-digit' }, 'day');
  const d     = () => String(parseInt(dd(), 10));
  const MMMM  = () => part({ month: 'long' }, 'month');
  const EEEE  = () => part({ weekday: 'long' }, 'weekday');
  const EEE   = () => part({ weekday: 'short' }, 'weekday');
  const h24   = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const HH    = () => (part(h24, 'hour') === '24' ? '00' : part(h24, 'hour'));
  const mm    = () => part(h24, 'minute');
  const ss    = () => part(h24, 'second');

  switch (pattern) {
    case 'yyyy-MM-dd':        return `${yyyy()}-${MM()}-${dd()}`;
    case 'yyyy':              return yyyy();
    case 'd MMMM':            return `${d()} ${MMMM()}`;
    case 'EEEE d MMMM yyyy':  return `${EEEE()} ${d()} ${MMMM()} ${yyyy()}`;
    case 'EEEE':              return EEEE();
    case 'EEE':               return EEE();
    // nowStamp_() uses this one — only reached on a MUTATING path, so the
    // read-only core harness never gets here but the approval suite does.
    case "yyyy-MM-dd'T'HH:mm:ssXXX": {
      const off = new Intl.DateTimeFormat('en-US',
        { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(date).find(x => x.type === 'timeZoneName').value;  // "GMT-04:00"
      return `${yyyy()}-${MM()}-${dd()}T${HH()}:${mm()}:${ss()}` + off.replace('GMT', '');
    }
    // cellText_ formats a time-typed cell with this; see its comment.
    case 'h:mm a': {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
      }).formatToParts(date);
      const g = t => (p.find(x => x.type === t) || {}).value || '';
      return `${g('hour')}:${g('minute')} ${g('dayPeriod')}`;
    }
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
/** Load an UNMODIFIED Code.gs into a vm context over `values`. */
function load(values) {
  const src = fs.readFileSync(CODE_GS_PATH, 'utf8');
  const vals = values || loadFixture();
  const sandbox = buildSandbox(vals);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  return { g: sandbox, values: vals };
}

module.exports = {
  SCHEDULE_TZ, CODE_GS_PATH,
  zonedMidnight, loadFixture, formatDate, buildSandbox, load,
};
