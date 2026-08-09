/**
 * attack-approval.js — end-to-end execution of the approval path.
 *
 * Unlike ../test/harness.js (which makes every mutation throw, and therefore can
 * only exercise read-only code), this file gives Code.gs a MUTABLE in-memory
 * responses sheet and a MUTABLE schedule sheet, then drives the real
 * onSignupSubmit -> doGet -> doPost pipeline and asserts on the resulting cells.
 *
 *   TZ=America/New_York node test/attack-approval.js
 *
 * Nothing here talks to Google. Code.gs is loaded UNMODIFIED into a vm context.
 * `loadFixture` and `formatDate` are copied verbatim from harness.js (which
 * exports nothing and must not be edited — other agents are using it).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SCHEDULE_TZ = 'America/New_York';
const SCHEDULE_ID = 'FAKE_SCHEDULE_ID';
const RESPONSES_ID = 'FAKE_RESPONSES_ID';

// ---------------------------------------------------------------------------
// Shared instrument (fixture loader + formatDate stub) — see test/lib.js.
// ---------------------------------------------------------------------------
const H = require('./lib');
const { loadFixture, formatDate, zonedMidnight } = H;

// ---------------------------------------------------------------------------
// Mutable spreadsheet model.  Range.setValue writes ONE cell into the backing
// 2-D array, exactly as Sheets does, and every write is recorded.
// ---------------------------------------------------------------------------
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/** How a US-locale Sheets cell renders. Deliberately faithful: a Date lands as
 *  M/D/YYYY, which is the failure mode forceAdminTextFormat_ exists to prevent. */
function displayOf(v) {
  if (isDate(v)) {
    return (v.getMonth() + 1) + '/' + v.getDate() + '/' + v.getFullYear();
  }
  return (v === null || v === undefined) ? '' : String(v);
}

function makeSheet(world, name, gid, values) {
  function pad(rowIdx, colIdx) {
    while (values.length <= rowIdx) { values.push([]); }
    const row = values[rowIdx];
    while (row.length <= colIdx) { row.push(''); }
  }
  function lastColumn() {
    let n = 0;
    for (const r of values) {
      for (let i = r.length - 1; i >= 0; i--) {
        if (r[i] !== '' && r[i] !== null && r[i] !== undefined) { n = Math.max(n, i + 1); break; }
      }
    }
    return n;
  }

  const sheet = {
    __name: name,
    __values: values,
    getSheetId: () => gid,
    getName: () => name,
    getParent: () => sheet.__ss,
    getMaxRows: () => Math.max(values.length, 2),
    getLastRow: () => values.length,
    getLastColumn: () => Math.max(lastColumn(), 1),
    getDataRange: () => sheet.getRange(1, 1, values.length, Math.max(lastColumn(), 1)),
    getRange: (r, c, nr, nc) => {
      const numRows = (nr === undefined ? 1 : nr);
      const numCols = (nc === undefined ? 1 : nc);
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const row = [];
            for (let j = 0; j < numCols; j++) {
              const rr = values[r - 1 + i];
              const v = rr ? rr[c - 1 + j] : undefined;
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        getDisplayValues: () => {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const row = [];
            for (let j = 0; j < numCols; j++) {
              const rr = values[r - 1 + i];
              row.push(displayOf(rr ? rr[c - 1 + j] : ''));
            }
            out.push(row);
          }
          return out;
        },
        getValue: () => {
          const rr = values[r - 1];
          const v = rr ? rr[c - 1] : '';
          return v === undefined ? '' : v;
        },
        setValue: (v) => {
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) {
              pad(r - 1 + i, c - 1 + j);
              values[r - 1 + i][c - 1 + j] = v;
              world.writes.push({ sheet: name, row: r + i, col: c + j, value: v });
            }
          }
          return this;
        },
        setValues: (arr) => {
          for (let i = 0; i < arr.length; i++) {
            for (let j = 0; j < arr[i].length; j++) {
              pad(r - 1 + i, c - 1 + j);
              values[r - 1 + i][c - 1 + j] = arr[i][j];
              world.writes.push({ sheet: name, row: r + i, col: c + j, value: arr[i][j] });
            }
          }
        },
        setNumberFormat: (f) => { world.formats.push({ sheet: name, r, c, numRows, numCols, f }); },
        setNumberFormats: () => {},
      };
    },
  };
  return sheet;
}

// ---------------------------------------------------------------------------
// The world: two spreadsheets, a clock, a mail spool, a write log.
// ---------------------------------------------------------------------------
const RESPONSE_HEADER = [
  'Timestamp',
  'Email Address',
  'Speaker name',
  'Affiliation',
  'Advisor',
  'Preferred date',
  'Talk title',
  'Abstract or short description',
  'Other dates that would also work',
  'Anything else Yiyang should know?'
];

function submissionRow(opts) {
  return [
    opts.timestamp || new Date(2026, 7, 8, 10, 15, 0),
    opts.email === undefined ? 'ada@psu.edu' : opts.email,
    opts.speaker === undefined ? 'Ada Lovelace' : opts.speaker,
    opts.affiliation === undefined ? 'PSU' : opts.affiliation,
    opts.advisor === undefined ? 'Chaoxing Liu' : opts.advisor,
    opts.date === undefined
      ? '2026-09-14 — Monday 14 September, 4:30pm - 6:00pm, Davey 339'
      : opts.date,
    opts.title === undefined ? 'Analytical engines and anyons' : opts.title,
    opts.abstract === undefined ? 'A short abstract.' : opts.abstract,
    opts.alternates === undefined ? '2026-09-28' : opts.alternates,
    opts.notes === undefined ? '' : opts.notes
  ];
}

function newWorld(overrides) {
  const world = {
    writes: [],
    formats: [],
    mails: [],
    nowMs: Date.parse('2026-08-08T12:00:00-04:00'),
  };

  const schedValues = loadFixture();
  const respValues = [RESPONSE_HEADER.slice()];

  const schedSheet = makeSheet(world, 'Schedule', 0, schedValues);
  const respSheet = makeSheet(world, 'Form Responses 1', 12345, respValues);

  const schedSS = {
    getSheets: () => [schedSheet],
    getSheetByName: n => (n === 'Schedule' ? schedSheet : null),
    getSpreadsheetTimeZone: () => SCHEDULE_TZ,
    getId: () => SCHEDULE_ID,
    getName: () => 'Journal Club Schedule',
  };
  const respSS = {
    getSheets: () => [respSheet],
    getSheetByName: n => (n === 'Form Responses 1' ? respSheet : null),
    getSpreadsheetTimeZone: () => SCHEDULE_TZ,
    getId: () => RESPONSES_ID,
    getName: () => 'Journal Club Sign-Up Responses (PRIVATE)',
  };
  schedSheet.__ss = schedSS;
  respSheet.__ss = respSS;

  world.sched = schedSheet;
  world.resp = respSheet;
  world.schedValues = schedValues;
  world.respValues = respValues;

  const props = Object.assign({
    SCHEDULE_SS_ID: SCHEDULE_ID,
    SCHEDULE_TAB_GID: '0',
    RESPONSES_SS_ID: RESPONSES_ID,
    RESPONSES_TAB_NAME: 'Form Responses 1',
    FORM_EDIT_ID: 'FAKE_FORM_ID',
    NOTIFY_EMAIL: 'organizer@example.com',
    DEFAULT_ROOM: 'Davey 339',
    LEAD_DAYS: '7',
    MAX_CHOICES: '30',
    EXEC_URL: 'https://script.google.com/macros/s/FAKE/exec',
    HMAC_SECRET: 'dGVzdC1zZWNyZXQtZm9yLXRoZS1hdHRhY2s=',
  }, (overrides && overrides.props) || {});
  world.props = props;

  const FIXED = () => world.nowMs;
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) { super(FIXED()); } else { super(...args); }
    }
    static now() { return FIXED(); }
  }

  const sandbox = {
    SpreadsheetApp: {
      openById: id => {
        if (id === SCHEDULE_ID) { return schedSS; }
        if (id === RESPONSES_ID) { return respSS; }
        throw new Error('attack: unknown spreadsheet id ' + id);
      },
      flush: () => { world.flushes = (world.flushes || 0) + 1; },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: o => { Object.assign(props, o); },
        deleteProperty: k => { delete props[k]; },
        getProperties: () => Object.assign({}, props),
      }),
    },
    Session: { getScriptTimeZone: () => SCHEDULE_TZ, getEffectiveUser: () => ({ getEmail: () => 'organizer@example.com' }) },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      base64Encode: s => Buffer.from(Array.isArray(s) ? Uint8Array.from(s.map(b => b & 0xff)) : String(s)).toString('base64'),
      base64EncodeWebSafe: s => Buffer.from(Array.isArray(s) ? Uint8Array.from(s.map(b => b & 0xff)) : String(s)).toString('base64url'),
      // REAL hmac — the harness's constant stub would make every nonce equal and
      // hide any binding bug.
      computeHmacSha256Signature: (value, key) =>
        Array.from(crypto.createHmac('sha256', String(key)).update(String(value)).digest())
          .map(b => (b > 127 ? b - 256 : b)),
      computeDigest: () => [1, 2, 3],
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      sleep: () => {},
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => (world.lockFails ? false : true),
        waitLock: () => {},
        releaseLock: () => {},
      }),
    },
    MailApp: {
      sendEmail: o => { world.mails.push(o); },
      getRemainingDailyQuota: () => (world.quota === undefined ? 100 : world.quota),
    },
    GmailApp: { createDraft: () => { throw new Error('attack: GmailApp not stubbed'); } },
    FormApp: { openById: () => { throw new Error('attack: FormApp not stubbed'); },
               DestinationType: { SPREADSHEET: 'SPREADSHEET' } },
    HtmlService: {
      createHtmlOutput: h => ({ setTitle: () => ({ getContent: () => h, __html: h }),
                                getContent: () => h, __html: h }),
    },
    ScriptApp: { newTrigger: () => { throw new Error('attack: no triggers'); },
                 getProjectTriggers: () => [] },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    DriveApp: { getFileById: () => { throw new Error('attack: DriveApp not stubbed'); } },
    UrlFetchApp: { fetch: () => { throw new Error('attack: UrlFetchApp not stubbed'); } },
    Logger: { log: () => {} },
    console: { log: () => {}, error: m => { world.consoleErrors = world.consoleErrors || []; world.consoleErrors.push(String(m)); },
               warn: () => {}, info: () => {} },
    Date: FakeDate, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN,
    parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Infinity,
  };

  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  world.g = sandbox;
  return world;
}

// ---------------------------------------------------------------------------
// Helpers over a world
// ---------------------------------------------------------------------------
function snap(values) {
  return JSON.stringify(values, (k, v) =>
    (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) ? 'ISO:' + v : v);
}
function snapWorld(w) { return snap(w.schedValues) + '||' + snap(w.respValues); }

function html(out) { return out && (out.__html || (out.getContent && out.getContent())) || ''; }

function submit(w, opts) {
  w.respValues.push(submissionRow(opts || {}));
  const rowIndex = w.respValues.length;
  const fakeRange = { getSheet: () => w.resp, getRow: () => rowIndex };
  w.g.onSignupSubmit({ range: fakeRange });
  return rowIndex;
}

function adminIndex(w, headerName) {
  const hdr = w.respValues[0].map(h => String(h).trim().toLowerCase());
  return hdr.indexOf(headerName.toLowerCase());
}
function adminCell(w, rowIndex, headerName) {
  const i = adminIndex(w, headerName);
  return i < 0 ? '(no column)' : displayOf(w.respValues[rowIndex - 1][i]);
}
function tokenOf(w, rowIndex) { return adminCell(w, rowIndex, 'JC Token'); }

/** Schedule column index by header name. */
function schedCol(w, name) {
  return w.schedValues[0].map(h => String(h).trim().toLowerCase()).indexOf(name.toLowerCase());
}
/** 1-indexed sheet row for an ISO day key, computed independently of Code.gs. */
function sheetRowFor(w, iso) {
  const dc = schedCol(w, 'Date');
  for (let r = 1; r < w.schedValues.length; r++) {
    const d = w.schedValues[r][dc];
    if (isDate(d) && formatDate(d, SCHEDULE_TZ, 'yyyy-MM-dd') === iso) { return r + 1; }
  }
  return -1;
}
function speakerAt(w, iso) {
  const r = sheetRowFor(w, iso);
  return r < 0 ? '(no row)' : String(w.schedValues[r - 1][schedCol(w, 'Speaker')]);
}

function nonceFromPage(pageHtml) {
  const m = /name="n" value="([^"]*)"/.exec(pageHtml);
  return m ? m[1] : null;
}

function doGet(w, token, action) {
  return html(w.g.doGet({ parameter: { t: token, a: action } }));
}
function doPost(w, token, action, nonce) {
  return html(w.g.doPost({ parameter: { t: token, a: action, n: nonce } }));
}
/** Full review -> confirm, returning both pages. */
function review(w, token, action) {
  const page = doGet(w, token, action);
  return { page, nonce: nonceFromPage(page) };
}

function h1(pageHtml) {
  const m = /<h1>([\s\S]*?)<\/h1>/.exec(pageHtml);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '(no h1)';
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('    ok   ' + name); }
  else {
    fail++;
    failures.push(`  X ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
    console.log('    FAIL ' + name + '\n         got:  ' + JSON.stringify(got) +
                '\n         want: ' + JSON.stringify(want));
  }
}
/** A DEFECT: behaviour that reproduces and that I claim is wrong. Separated from
 *  `check` so a broken expectation of mine cannot be mistaken for a finding. */
const defects = [];
function defect(id, claim, observed) {
  defects.push({ id, claim, observed });
  console.log('    DEFECT ' + id + ' — ' + claim + '\n           observed: ' +
              (typeof observed === 'string' ? observed : JSON.stringify(observed)));
}
function note(k, v) { console.log('    ·    ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v))); }
function head(s) { console.log('\n=== ' + s + ' ==='); }

// ===========================================================================
// A. SUBMIT -> doGet -> doPost, happy path.  Off-by-one is the headline.
// ===========================================================================
head('A. submit, review (read-only), confirm');
{
  const w = newWorld();
  const r = submit(w, {});
  note('response row', r);
  note('admin headers', w.respValues[0].slice(RESPONSE_HEADER.length));
  const token = tokenOf(w, r);
  note('token', token);
  check('A1 status after submit', adminCell(w, r, 'JC Status'), 'PENDING');
  check('A2 date key after submit', adminCell(w, r, 'JC Date Key'), '2026-09-14');
  check('A3 owner was emailed once', w.mails.length, 1);
  check('A4 notify recorded', adminCell(w, r, 'JC Notified'), 'YES');
  check('A5 nothing written to the schedule yet', speakerAt(w, '2026-09-14'), '');

  // ---- THE HEADLINE SECURITY PROPERTY: doGet must not mutate anything -----
  const before = snapWorld(w);
  const writesBefore = w.writes.length;
  const mailsBefore = w.mails.length;
  const pageA = doGet(w, token, 'approve');
  const pageR = doGet(w, token, 'reject');
  doGet(w, token, 'approve');            // a scanner fetching both, twice
  doGet(w, token, 'reject');
  check('A6 doGet x4 wrote zero cells', w.writes.length - writesBefore, 0);
  check('A7 doGet x4 sent zero mail', w.mails.length - mailsBefore, 0);
  check('A8 backing arrays byte-identical after doGet', snapWorld(w) === before, true);
  check('A9 review page heading', h1(pageA).indexOf('Approve') >= 0 || h1(pageA).length > 0, true);
  note('approve page h1', h1(pageA));
  note('reject page h1', h1(pageR));
  check('A10 review page hides submitter email', pageA.indexOf('ada@psu.edu'), -1);

  const nApprove = nonceFromPage(pageA);
  const nReject = nonceFromPage(pageR);
  check('A11 approve/reject nonces differ', nApprove !== nReject, true);

  // ---- confirm ------------------------------------------------------------
  const schedBefore = w.schedValues.map(row => row.slice());
  const out = doPost(w, token, 'approve', nApprove);
  note('confirm page h1', h1(out));
  check('A12 approved page', h1(out).indexOf('Approved') >= 0, true);

  const targetRow = sheetRowFor(w, '2026-09-14');
  note('independent target sheet row', targetRow);
  check('A13 target row is 14', targetRow, 14);
  check('A14 speaker landed on 2026-09-14', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
  check('A15 JC Schedule Row recorded', adminCell(w, r, 'JC Schedule Row'), String(targetRow));

  // Exhaustive diff: which cells changed?
  const changed = [];
  for (let i = 0; i < w.schedValues.length; i++) {
    for (let j = 0; j < w.schedValues[i].length; j++) {
      const a = schedBefore[i] ? schedBefore[i][j] : undefined;
      const b = w.schedValues[i][j];
      if (displayOf(a) !== displayOf(b)) {
        changed.push({ sheetRow: i + 1, col: String(w.schedValues[0][j]), from: displayOf(a), to: displayOf(b) });
      }
    }
  }
  note('schedule cells changed', changed);
  check('A16 every change is on row 14', changed.every(c => c.sheetRow === 14), true);
  check('A17 columns changed', changed.map(c => c.col).sort(),
        ['Advisor', 'Affiliation', 'Room', 'Speaker', 'Topic']);
  check('A18 neighbour rows untouched',
        [speakerAt(w, '2026-09-07'), speakerAt(w, '2026-09-21'), speakerAt(w, '2026-09-28')],
        ['Sarvesh Srinivasan', 'Wangqian Miao', '']);
  check('A19 status APPROVED', adminCell(w, r, 'JC Status'), 'APPROVED');
  check('A20 speaker was emailed', w.mails.length, 2);
  note('speaker mail to/subject', w.mails[1].to + ' / ' + w.mails[1].subject);
  check('A21 speaker mail recipient', w.mails[1].to, 'ada@psu.edu');
}

// ===========================================================================
// B. THE DOUBLE-BOOKING RACE
// ===========================================================================
head('B. double-booking race — two pending requests for 2026-09-14');
{
  const w = newWorld();
  const r1 = submit(w, { speaker: 'Ada Lovelace', email: 'ada@psu.edu' });
  const r2 = submit(w, { speaker: 'Grace Hopper', email: 'grace@psu.edu', affiliation: 'Yale',
                         advisor: 'Howard Aiken', title: 'Compilers and cuprates' });
  const t1 = tokenOf(w, r1), t2 = tokenOf(w, r2);
  check('B1 two distinct tokens', t1 !== t2, true);
  check('B2 both PENDING', [adminCell(w, r1, 'JC Status'), adminCell(w, r2, 'JC Status')],
        ['PENDING', 'PENDING']);

  // Both reviewers open their page BEFORE either confirms — the real race.
  const rev1 = review(w, t1, 'approve');
  const rev2 = review(w, t2, 'approve');

  console.log('    --- schedule row 14 BEFORE any confirm ---');
  note('row 14', w.schedValues[13].map(displayOf));

  const p1 = doPost(w, t1, 'approve', rev1.nonce);
  console.log('    --- schedule row 14 AFTER first confirm ---');
  note('row 14', w.schedValues[13].map(displayOf));
  check('B3 first approval succeeded', h1(p1).indexOf('Approved') >= 0, true);
  check('B4 speaker is Ada', speakerAt(w, '2026-09-14'), 'Ada Lovelace');

  const p2 = doPost(w, t2, 'approve', rev2.nonce);
  console.log('    --- schedule row 14 AFTER second confirm ---');
  note('row 14', w.schedValues[13].map(displayOf));
  note('second confirm h1', h1(p2));
  check('B5 second approval refused', h1(p2).indexOf('Not written') >= 0, true);
  check('B6 Ada NOT overwritten', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
  check('B7 affiliation not overwritten',
        String(w.schedValues[13][schedCol(w, 'Affiliation')]), 'PSU');
  check('B8 loser stays PENDING (token not burned)', adminCell(w, r2, 'JC Status'), 'PENDING');
  check('B9 winner APPROVED', adminCell(w, r1, 'JC Status'), 'APPROVED');
  check('B10 loser was not emailed a confirmation',
        w.mails.filter(m => m.to === 'grace@psu.edu').length, 0);
  // The loser can still be rejected — the token must still work.
  const revR = review(w, t2, 'reject');
  const pr = doPost(w, t2, 'reject', revR.nonce);
  check('B11 loser can still be rejected', h1(pr), 'Rejection recorded');
  check('B12 loser now REJECTED', adminCell(w, r2, 'JC Status'), 'REJECTED');
}

// ===========================================================================
// C. IDEMPOTENCE — approve twice, approve then reject, reject then approve
// ===========================================================================
head('C. replay / state-machine');
{
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const first = doPost(w, t, 'approve', rev.nonce);
  check('C1 first approve ok', h1(first).indexOf('Approved') >= 0, true);
  const schedAfterFirst = snap(w.schedValues);
  const mailsAfterFirst = w.mails.length;

  const second = doPost(w, t, 'approve', rev.nonce);   // same token, same nonce
  note('replay h1', h1(second));
  check('C2 replay is idempotent page', h1(second), 'Already handled');
  check('C3 replay changed no schedule cell', snap(w.schedValues) === schedAfterFirst, true);
  check('C4 replay sent no extra mail', w.mails.length, mailsAfterFirst);

  // approve then reject. The reject review page no longer offers a button, so
  // forge a genuinely valid nonce — the strongest form of the attack.
  const revRej = review(w, t, 'reject');
  check('C5a reject page after approval offers no confirm button', revRej.nonce, null);
  const rej = doPost(w, t, 'reject', w.g.nonceFor_(t, 'reject', w.g.currentBucket_()));
  check('C5 reject-after-approve refused', h1(rej), 'Already handled');
  check('C6 state did not go backwards', adminCell(w, r, 'JC Status'), 'APPROVED');
  check('C7 schedule still holds the speaker', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
}
{
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'reject');
  const rej = doPost(w, t, 'reject', rev.nonce);
  check('C8 reject ok', h1(rej), 'Rejection recorded');
  check('C9 status REJECTED', adminCell(w, r, 'JC Status'), 'REJECTED');
  check('C10 nothing written to schedule', speakerAt(w, '2026-09-14'), '');

  const revA = review(w, t, 'approve');
  note('approve page after rejection h1', h1(revA.page));
  check('C11 approve page after reject is the replay page', h1(revA.page), 'Already handled');
  check('C12 no confirm button offered', revA.nonce, null);
  // Forge a valid nonce anyway — the reviewer could have had the page open first.
  const forged = w.g.nonceFor_(t, 'approve', w.g.currentBucket_());
  const app = doPost(w, t, 'approve', forged);
  check('C13 approve-after-reject refused', h1(app), 'Already handled');
  check('C14 schedule still empty', speakerAt(w, '2026-09-14'), '');
  check('C15 status still REJECTED', adminCell(w, r, 'JC Status'), 'REJECTED');
}

// ===========================================================================
// D. HAND-FILLED IN BETWEEN — re-validation inside the lock
// ===========================================================================
head('D. schedule mutated between doGet and doPost');
{
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  check('D1 review page saw a free slot', rev.page.indexOf('free') >= 0 || rev.nonce !== null, true);

  // Yiyang fills the row in by hand in another tab.
  w.schedValues[13][schedCol(w, 'Speaker')] = 'Richard Feynman';
  w.schedValues[13][schedCol(w, 'Affiliation')] = 'Caltech';

  const out = doPost(w, t, 'approve', rev.nonce);
  note('h1', h1(out));
  check('D2 refused', h1(out).indexOf('Not written') >= 0, true);
  check('D3 names the occupant', out.indexOf('Richard Feynman') >= 0, true);
  check('D4 hand-entered speaker preserved', speakerAt(w, '2026-09-14'), 'Richard Feynman');
  check('D5 request left PENDING', adminCell(w, r, 'JC Status'), 'PENDING');
  check('D6 no confirmation mail sent', w.mails.length, 1);
}

// ===========================================================================
// E. N/A break weeks, both directions
// ===========================================================================
head('E. N/A break week');
{
  // E-a: approve a real person onto a row whose Speaker is already "N/A"
  const w = newWorld();
  const r = submit(w, { date: '2026-08-10 — Monday 10 August, 4:30pm - 6:00pm' });
  const t = tokenOf(w, r);
  check('Ea1 date key', adminCell(w, r, 'JC Date Key'), '2026-08-10');
  const rev = review(w, t, 'approve');
  note('review page h1', h1(rev.page));
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('confirm h1', h1(out));
  check('Ea2 refused', h1(out).indexOf('Not written') >= 0, true);
  check('Ea3 says break week', out.indexOf('break week') >= 0, true);
  check('Ea4 N/A preserved', speakerAt(w, '2026-08-10'), 'N/A');
  check('Ea5 still PENDING', adminCell(w, r, 'JC Status'), 'PENDING');
}
{
  // E-b: a submitter whose *name* is N/A, onto a genuinely free row
  const w = newWorld();
  const r = submit(w, { speaker: 'N/A' });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('confirm h1', h1(out));
  check('Eb1 refused', h1(out).indexOf('Not written') >= 0, true);
  check('Eb2 slot left free', speakerAt(w, '2026-09-14'), '');
  check('Eb3 still PENDING', adminCell(w, r, 'JC Status'), 'PENDING');
}
{
  // E-c: the sentinel dodges — spacing / slash variants and a lookalike
  const variants = ['n/a', 'N / A', 'N.A.', 'n⁄a', ' N/A ', 'NA'];
  for (const v of variants) {
    const w = newWorld();
    const r = submit(w, { speaker: v });
    const t = tokenOf(w, r);
    const rev = review(w, t, 'approve');
    const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
    const landed = speakerAt(w, '2026-09-14');
    note('speaker "' + v + '" -> ' + h1(out) + ' / cell=' + JSON.stringify(landed), '');
  }
}

// ===========================================================================
// F. TOKEN AND NONCE ATTACKS
// ===========================================================================
head('F. token / nonce');
{
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const before = snapWorld(w);
  const writes0 = w.writes.length;

  const bad = [
    ['empty', ''],
    ['garbage', 'not-a-token'],
    ['wrong shape (too short)', '00000000-0000-4000-8000-00000000000'],
    ['wrong shape (sql-ish)', "' OR 1=1 --"],
    ['unknown but well-formed', crypto.randomUUID()],
    ['real token uppercased', t.toUpperCase()],
    ['real token with whitespace', ' ' + t + ' '],
  ];
  for (const [label, tok] of bad) {
    const page = doGet(w, tok, 'approve');
    note('doGet ' + label, h1(page));
  }
  check('F1 no writes from any bad doGet', w.writes.length - writes0, 0);
  check('F2 world unchanged', snapWorld(w) === before, true);

  // POST with a forged-but-shaped token and a nonce computed for it
  const ghost = crypto.randomUUID();
  const ghostNonce = w.g.nonceFor_(ghost, 'approve', w.g.currentBucket_());
  const gp = doPost(w, ghost, 'approve', ghostNonce);
  check('F3 unknown token POST', h1(gp), 'Unknown or expired request');
  check('F4 unknown token POST wrote nothing', snapWorld(w) === before, true);

  // Nonce binding
  const nApprove = w.g.nonceFor_(t, 'approve', w.g.currentBucket_());
  const nReject  = w.g.nonceFor_(t, 'reject',  w.g.currentBucket_());
  check('F5 cross-action nonce refused', h1(doPost(w, t, 'approve', nReject)),
        'This confirmation page has expired');
  check('F6 missing nonce refused', h1(doPost(w, t, 'approve', '')),
        'This confirmation page has expired');
  check('F7 other-token nonce refused',
        h1(doPost(w, t, 'approve', w.g.nonceFor_(crypto.randomUUID(), 'approve', w.g.currentBucket_()))),
        'This confirmation page has expired');
  check('F8 still nothing written', snapWorld(w) === before, true);

  // Nonce window: previous bucket accepted, two buckets back rejected.
  const oldNonce = w.g.nonceFor_(t, 'approve', w.g.currentBucket_());
  w.nowMs += 31 * 60 * 1000;                 // one bucket later
  check('F9 previous-bucket nonce still valid', w.g.nonceValid_(t, 'approve', oldNonce), true);
  w.nowMs += 31 * 60 * 1000;                 // two buckets later
  check('F10 two-bucket-old nonce rejected', w.g.nonceValid_(t, 'approve', oldNonce), false);
  check('F11 expired-nonce POST wrote nothing',
        (doPost(w, t, 'approve', oldNonce), snapWorld(w) === before), true);
  w.nowMs -= 62 * 60 * 1000;

  // Finally the real one still works.
  check('F12 the genuine nonce still approves', h1(doPost(w, t, 'approve', nApprove)).indexOf('Approved') >= 0, true);
}

// ===========================================================================
// G. DATES THAT SHOULD NEVER BE WRITTEN
// ===========================================================================
head('G. bad / hostile dates');
{
  const w = newWorld();
  const before = snap(w.schedValues);
  const cases = [
    ['no row in the schedule', '2026-07-13 — Monday 13 July'],
    ['past but present and booked', '2026-08-03 — Monday 3 August'],
    ['off the end', '2028-01-03 — Monday 3 January'],
    ['unparseable', 'sometime in the fall'],
    ['wrong year, same day/month', '2026-01-25 — Monday 25 January'],
  ];
  for (const [label, dateAnswer] of cases) {
    const r = submit(w, { date: dateAnswer, speaker: 'Attacker ' + label });
    const t = tokenOf(w, r);
    const rev = review(w, t, 'approve');
    const n = rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_());
    const out = doPost(w, t, 'approve', n);
    note(label + ' -> ' + h1(out) + ' | status=' + adminCell(w, r, 'JC Status'), '');
  }
  check('G1 schedule completely untouched by all five', snap(w.schedValues) === before, true);
}
{
  // A free row that is in the PAST — clear a past speaker by hand first.
  const w = newWorld();
  w.schedValues[7][schedCol(w, 'Speaker')] = '';     // 2026-08-03, row 8
  const r = submit(w, { date: '2026-08-03 — Monday 3 August' });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('past free slot -> ' + h1(out), '');
  check('G2 past slot refused', h1(out).indexOf('Not written') >= 0, true);
  check('G3 past slot left empty', speakerAt(w, '2026-08-03'), '');
}
{
  // Duplicated date row -> AMBIGUOUS
  const w = newWorld();
  w.schedValues.push(w.schedValues[13].map(v => (isDate(v) ? new Date(v.getTime()) : v)));
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('duplicate date -> ' + h1(out), '');
  check('G4 ambiguous refused', h1(out).indexOf('duplicated') >= 0, true);
  check('G5 neither duplicate written', [speakerAt(w, '2026-09-14'),
        String(w.schedValues[w.schedValues.length - 1][schedCol(w, 'Speaker')])], ['', '']);
}

// ===========================================================================
// H. CONTENT ATTACKS THROUGH THE FORM INTO A PUBLIC SHEET
// ===========================================================================
head('H. hostile answer content reaching the public schedule');
{
  const w = newWorld();
  const r = submit(w, {
    speaker: '=IMPORTRANGE("1abc","A1")',
    affiliation: '+1+1',
    advisor: '@SUM(A1:A9)',
    title: '-2+3',
  });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('h1', h1(out));
  const row = w.schedValues[13];
  note('row 14 after', row.map(displayOf));
  const cells = ['Speaker', 'Affiliation', 'Advisor', 'Topic']
    .map(c => String(row[schedCol(w, c)]));
  check('H1 no cell starts with = + @ -', cells.filter(c => /^[=+@-]/.test(c)), []);
  note('written cells', cells);
}
{
  const w = newWorld();
  const r = submit(w, {
    speaker: '<img src=x onerror=alert(1)>Mallory',
    title: '</td></tr><script>alert(2)</script>',
  });
  const t = tokenOf(w, r);
  const page = doGet(w, t, 'approve');
  check('H2 no raw <script> on the review page', page.indexOf('<script>'), -1);
  check('H3 no raw <img on the review page', page.indexOf('<img'), -1);
  check('H4a payload is present but entity-escaped', page.indexOf('&lt;img src=x onerror=alert(1)&gt;') >= 0, true);
  note('title line', /<title>[\s\S]*?<\/title>/.exec(page)[0]);
  const rev = { nonce: nonceFromPage(page) };
  doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('speaker cell', speakerAt(w, '2026-09-14'));
  const mail = w.mails[w.mails.length - 1];
  check('H4 speaker mail exists', !!mail, true);
}
{
  // Length caps
  const w = newWorld();
  const r = submit(w, { speaker: 'A'.repeat(300), title: 'T'.repeat(500) });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  const sp = String(w.schedValues[13][schedCol(w, 'Speaker')]);
  const tp = String(w.schedValues[13][schedCol(w, 'Topic')]);
  check('H5 speaker capped at 80', sp.length <= 80, true);
  check('H6 topic capped at 200', tp.length <= 200, true);
  note('lengths', { speaker: sp.length, topic: tp.length });
}

// ===========================================================================
// I. DEGRADED SCHEDULE / RESPONSES SHAPES
// ===========================================================================
head('I. schema drift and missing pieces');
{
  // Topic column renamed away — the answer has nowhere to go.
  const w = newWorld();
  w.schedValues[0][schedCol(w, 'Topic')] = 'Talk Topic';
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  check('I1 still approves', h1(out).indexOf('Approved') >= 0, true);
  check('I2 outcome page warns about the dropped answer',
        out.indexOf('nowhere to go') >= 0, true);
  note('topic cell (renamed col)', String(w.schedValues[13][7]));
}
{
  // Speaker column renamed -> hard schema failure, nothing written.
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  w.schedValues[0][schedCol(w, 'Speaker')] = 'Presenter';
  const before = snap(w.schedValues);
  const out = doPost(w, t, 'approve', rev.nonce);
  note('h1', h1(out));
  check('I3 schema drift blocks the write', snap(w.schedValues) === before, true);
  check('I4 row marked ERROR', adminCell(w, r, 'JC Status'), 'ERROR');
}
{
  // The submitter's speaker-name question renamed -> blank speaker guard.
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  w.respValues[0][2] = 'Who is talking';           // no alias matches
  const out = doPost(w, t, 'approve', rev.nonce);
  note('h1', h1(out));
  check('I5 blank speaker refused', h1(out).indexOf('no speaker name') >= 0, true);
  check('I6 slot untouched', speakerAt(w, '2026-09-14'), '');
  check('I7 left PENDING', adminCell(w, r, 'JC Status'), 'PENDING');
}
{
  // No email captured at all.
  const w = newWorld();
  const r = submit(w, { email: '' });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  check('I8 approves anyway', h1(out).indexOf('Approved') >= 0, true);
  check('I9 outcome page says the mail failed', out.indexOf('NOT sent') >= 0, true);
  check('I10 speaker still written', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
}
{
  // Room already filled -> must not be overwritten.
  const w = newWorld();
  w.schedValues[13][schedCol(w, 'Room')] = 'Osmond 117';
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  check('I11 room preserved', String(w.schedValues[13][schedCol(w, 'Room')]), 'Osmond 117');
}
{
  // Duplicate trigger fire on the same row.
  const w = newWorld();
  const r = submit(w, {});
  const t1 = tokenOf(w, r);
  const mails1 = w.mails.length;
  w.g.onSignupSubmit({ range: { getSheet: () => w.resp, getRow: () => r } });
  check('I12 token not re-minted on duplicate trigger', tokenOf(w, r), t1);
  check('I13 no second notification', w.mails.length, mails1);
}
{
  // JC Date Key holding a real Date (pre-fix install / retyped cell).
  const w = newWorld();
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const dk = adminIndex(w, 'JC Date Key');
  w.respValues[r - 1][dk] = new Date(2026, 8, 14);   // Date-typed, not text
  note('display of the Date-typed key', displayOf(w.respValues[r - 1][dk]));
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('h1', h1(out));
  check('I14 Date-typed key still resolves', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
}

// ===========================================================================
// J. SECOND WAVE
// ===========================================================================
head('J1. does a leaked token really only expose "a name and a talk title"?');
{
  // The stated property, from the comment on submittedFields_:
  //   "The page deliberately omits the submitter's address: a leaked token then
  //    exposes a name and a talk title rather than a contactable email address."
  // The web app is deployed for "Anyone" (it has to be — the links are emailed),
  // so possession of the token is the whole authorisation. Play the attacker:
  // token only, no organizer involvement, no prior page.
  const w = newWorld();
  const r = submit(w, {});
  const stolenToken = tokenOf(w, r);

  const reviewPage = doGet(w, stolenToken, 'reject');
  check('J1a review page does NOT contain the address', reviewPage.indexOf('ada@psu.edu'), -1);

  // Step 2: the same page hands the attacker a valid nonce.
  const n = nonceFromPage(reviewPage);
  check('J1b review page hands out a usable nonce', typeof n === 'string' && n.length > 0, true);

  const outcome = doPost(w, stolenToken, 'reject', n);
  const leaked = outcome.indexOf('ada@psu.edu') >= 0;
  note('reject outcome h1', h1(outcome));
  // REGRESSION GUARD. submittedFields_ states the property in so many words: the
  // review PAGE omits the address so that a leaked token exposes a name and a talk
  // title rather than a contactable .edu address. doReject_ used to hand it
  // straight back in a mailto href, so two anonymous requests (GET for the nonce,
  // POST to confirm) recovered it. No address, and no mailto, on any page now.
  check('J1c the outcome page does NOT leak the address', leaked, false);
  check('J1c2 and there is no mailto anywhere on it', /href="mailto:/.test(outcome), false);
  check('J1c3 the organizer is still told where to find it',
        /private log/.test(outcome), true);
  check('J1d the anonymous token holder also changed the state',
        adminCell(w, r, 'JC Status'), 'REJECTED');
}
{
  // Same leak on the "blocked" page, which needs no state change at all.
  const w = newWorld();
  const r1 = submit(w, { speaker: 'Ada Lovelace', email: 'ada@psu.edu' });
  const r2 = submit(w, { speaker: 'Grace Hopper', email: 'grace@psu.edu' });
  const t1 = tokenOf(w, r1), t2 = tokenOf(w, r2);
  const rev1 = review(w, t1, 'approve');
  doPost(w, t1, 'approve', rev1.nonce);                    // slot now taken
  const rev2 = review(w, t2, 'approve');
  check('J1e blocked-path review page hides the address', rev2.page.indexOf('grace@psu.edu'), -1);
  const blocked = doPost(w, t2, 'approve', rev2.nonce);
  // Worse than the reject page: this one is reachable with NO state change at all,
  // so an address embedded here could be harvested without leaving any trace in
  // the private log.
  check('J1f the blocked page does NOT leak the address',
        blocked.indexOf('grace@psu.edu') >= 0, false);
  check('J1f2 and has no mailto either', /href="mailto:/.test(blocked), false);
  check('J1g and that page is reachable with NO state change',
        adminCell(w, r2, 'JC Status'), 'PENDING');
}

head('J2. hand-entered cells on a free row');
{
  const w = newWorld();
  // Yiyang pencils in a placeholder on the still-free 14 Sep row.
  w.schedValues[13][schedCol(w, 'Room')] = 'Osmond 117';
  w.schedValues[13][schedCol(w, 'Topic')] = 'HOLD — Prof. Kim, do not reassign';
  w.schedValues[13][schedCol(w, 'Advisor')] = 'Eun-Ah Kim';
  w.schedValues[13][schedCol(w, 'Affiliation')] = 'Cornell';
  const before = w.schedValues[13].map(displayOf);
  note('row 14 before approval', before);

  const r = submit(w, {});
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  note('review page promises', (/Approving writes[\s\S]*?<\/p>/.exec(rev.page) || [''])[0]
       .replace(/<[^>]+>/g, ''));
  const out = doPost(w, t, 'approve', rev.nonce);
  note('row 14 after approval', w.schedValues[13].map(displayOf));
  check('J2a Room is protected, as documented',
        String(w.schedValues[13][schedCol(w, 'Room')]), 'Osmond 117');
  check('J2b Topic was overwritten', String(w.schedValues[13][schedCol(w, 'Topic')]),
        'Analytical engines and anyons');
  check('J2c Advisor was overwritten', String(w.schedValues[13][schedCol(w, 'Advisor')]), 'Chaoxing Liu');
  check('J2d Affiliation was overwritten', String(w.schedValues[13][schedCol(w, 'Affiliation')]), 'PSU');
  // REGRESSION GUARD. isFreeSlot_ uses Speaker as the sole discriminator, so a row
  // with an empty Speaker but a hand-written Topic ("HOLD — Prof. Kim, do not
  // reassign") is still "free". Room has an explicit never-overwrite guard; these
  // three cannot have one without blocking legitimate corrections. So the write
  // stands and the LOSS is surfaced — before the click, after it, and permanently
  // in JC Decision Note, which is the only record that survives the page closing.
  note('review page warning', (/This will <strong>replace[\s\S]*?<\/div>/.exec(rev.page) || [''])[0]
       .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  check('J2e the REVIEW page warns before the click, naming the old Topic',
        /This will <strong>replace/.test(rev.page) &&
        rev.page.indexOf('HOLD — Prof. Kim, do not reassign') >= 0, true);
  check('J2f the review page names all three columns',
        ['affiliation', 'advisor', 'topic'].every(c => new RegExp('<strong>' + c + '</strong>').test(rev.page)), true);
  check('J2g the OUTCOME page says what was replaced',
        /This approval <strong>replaced<\/strong>/.test(out) &&
        out.indexOf('HOLD — Prof. Kim, do not reassign') >= 0, true);
  const noteCell = adminCell(w, r, 'JC Decision Note');
  note('JC Decision Note', noteCell);
  check('J2h and the private log records it permanently',
        /REPLACED/.test(noteCell) && noteCell.indexOf('HOLD — Prof. Kim, do not reassign') >= 0, true);
  check('J2i a row with nothing to lose gets no warning', (() => {
    const w2 = newWorld();                     // 14 Sep untouched: all three cells blank
    const r2 = submit(w2, {});
    const rv = review(w2, tokenOf(w2, r2), 'approve');
    return /This will <strong>replace/.test(rv.page);
  })(), false);
}

head('J3. a Date cell retyped as text (no year) — can it write to the wrong week?');
{
  // Row 35 is genuinely 2027-02-08. Retype it as bare text and blank the weekday
  // hint, so coerceDate_ falls back to "nearest candidate year to today".
  const w = newWorld();
  const dc = schedCol(w, 'Date'), wc = schedCol(w, 'Day of Week');
  note('row 35 真 date', displayOf(w.schedValues[34][dc]));
  w.schedValues[34][dc] = '8 February';
  w.schedValues[34][wc] = '';
  const ctx = w.g.openSchedule_();
  // REGRESSION GUARD. "8 February" with no year and no weekday hint is genuinely
  // ambiguous. coerceDate_ used to pick the candidate year NEAREST today, which on
  // 2026-08-08 is 2026 (181 days behind beats 184 ahead) — so a 2027 row keyed
  // into the PAST and answered to a request key for a week it is not. It now
  // refuses, and the row is NAMED by unreadableDateRows_ so the nightly report can
  // point at it instead of the week quietly disappearing.
  note('coerceDate_ with no hint', String(w.g.coerceDate_('8 February', SCHEDULE_TZ, '')));
  check('J3a coerceDate_ refuses to guess', w.g.coerceDate_('8 February', SCHEDULE_TZ, ''), null);
  check('J3b it does NOT answer to the wrong year',
        w.g.findRowByDate_(ctx, '2026-02-08').status, 'NOT_IN_SCHEDULE');
  check('J3b2 the unreadable row is named', w.g.unreadableDateRows_(ctx), [35]);

  // Can an approval land on it? 2026-02-08 is in the past, so freshness must refuse.
  const r = submit(w, { date: '2026-02-08 — Monday 8 February' });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce || w.g.nonceFor_(t, 'approve', w.g.currentBucket_()));
  note('h1', h1(out));
  check('J3c refused (fails closed)', h1(out).indexOf('Not written') >= 0, true);
  check('J3d row 35 speaker untouched', String(w.schedValues[34][schedCol(w, 'Speaker')]), '');

  // And the legitimate request for the real date is now refused too.
  const r2 = submit(w, { date: '2027-02-08 — Monday 8 February' });
  const t2 = tokenOf(w, r2);
  const rev2 = review(w, t2, 'approve');
  const out2 = doPost(w, t2, 'approve', rev2.nonce || w.g.nonceFor_(t2, 'approve', w.g.currentBucket_()));
  note('legit 2027-02-08 -> ' + h1(out2), '');
  // The row is genuinely unreadable, so the legitimate date is still unreachable —
  // but it now FAILS LOUDLY (named row in the nightly report) instead of silently.
  check('J3e legitimate date still unreachable while the cell is broken',
        h1(out2).indexOf('not in the schedule') >= 0, true);
}
{
  // With the weekday hint intact the same cell resolves correctly.
  const w = newWorld();
  w.schedValues[34][schedCol(w, 'Date')] = '8 February';   // Day of Week left as "Monday"
  const ctx = w.g.openSchedule_();
  check('J3f weekday hint rescues the year', w.g.findRowByDate_(ctx, '2027-02-08').status, 'OK');
  check('J3g and 2026-02-08 no longer matches',
        w.g.findRowByDate_(ctx, '2026-02-08').status, 'NOT_IN_SCHEDULE');
}

head('J3x. last-row boundary — an approval on the final schedule row');
{
  const w = newWorld();
  const lastRow = w.schedValues.length;               // 40
  note('last schedule row / date', lastRow + ' / ' + displayOf(w.schedValues[lastRow - 1][schedCol(w, 'Date')]));
  const r = submit(w, { date: '2027-03-15 — Monday 15 March', speaker: 'Boundary Bob' });
  const t = tokenOf(w, r);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce);
  check('J3x1 approved', h1(out).indexOf('Approved') >= 0, true);
  check('J3x2 landed on the last row', sheetRowFor(w, '2027-03-15'), lastRow);
  check('J3x3 speaker in the last row', String(w.schedValues[lastRow - 1][schedCol(w, 'Speaker')]), 'Boundary Bob');
  check('J3x4 row above untouched', String(w.schedValues[lastRow - 2][schedCol(w, 'Speaker')]), '');
  check('J3x5 no row appended', w.schedValues.length, lastRow);
  check('J3x6 JC Schedule Row', adminCell(w, r, 'JC Schedule Row'), String(lastRow));
}

head('J4. notification cap (mail-quota exhaustion by form spam)');
{
  const w = newWorld();
  for (let i = 0; i < 25; i++) { submit(w, { speaker: 'Spammer ' + i, email: 's' + i + '@x.com' }); }
  const notified = [];
  for (let r = 2; r <= w.respValues.length; r++) { notified.push(adminCell(w, r, 'JC Notified')); }
  note('JC Notified values', notified.join(','));
  check('J4a individual sends capped at 20', notified.filter(v => v === 'YES').length, 20);
  check('J4b overflow marked CAPPED', notified.filter(v => v === 'CAPPED').length, 5);
  check('J4c total mail sent = 20 + 1 digest alert', w.mails.length, 21);
  check('J4d all 25 still PENDING with tokens',
        [2, 26].map(r => adminCell(w, r, 'JC Status')), ['PENDING', 'PENDING']);
  // A capped row still has a live token — approval must still work for it.
  const t = tokenOf(w, 26);
  const rev = review(w, t, 'approve');
  const out = doPost(w, t, 'approve', rev.nonce);
  check('J4e a capped row can still be approved', h1(out).indexOf('Approved') >= 0, true);
}

head('J5. nightly expiry vs. a fresh decision');
{
  const w = newWorld();
  const rOld = submit(w, { date: '2026-08-03 — Monday 3 August',   // already past
                           timestamp: new Date(2026, 5, 1, 9, 0, 0) });
  const rNew = submit(w, {});
  const tNew = tokenOf(w, rNew);
  const revNew = review(w, tNew, 'approve');
  doPost(w, tNew, 'approve', revNew.nonce);
  const problems = [];
  const n = w.g.expireStalePending_(problems);
  note('expired count', n);
  note('problems', problems);
  check('J5a the past-dated pending row expired', adminCell(w, rOld, 'JC Status'), 'EXPIRED');
  check('J5b the just-approved row was NOT clobbered', adminCell(w, rNew, 'JC Status'), 'APPROVED');
  check('J5c schedule intact', speakerAt(w, '2026-09-14'), 'Ada Lovelace');
  // An expired token must be dead.
  const tOld = tokenOf(w, rOld);
  const p = doGet(w, tOld, 'approve');
  check('J5d expired token shows the replay page', h1(p), 'Already handled');
  const forged = w.g.nonceFor_(tOld, 'approve', w.g.currentBucket_());
  const before = snap(w.schedValues);
  doPost(w, tOld, 'approve', forged);
  check('J5e expired token cannot write', snap(w.schedValues) === before, true);
}

head('J6. degraded configuration');
{
  // HMAC_SECRET missing entirely.
  const w = newWorld({ props: { HMAC_SECRET: '' } });
  const r = submit(w, {});
  const t = tokenOf(w, r);
  const page = doGet(w, t, 'approve');
  note('doGet h1 with no HMAC_SECRET', h1(page));
  check('J6a no confirm button minted', nonceFromPage(page), null);
  const before = snapWorld(w);
  const out = doPost(w, t, 'approve', 'anything');
  note('doPost h1', h1(out));
  check('J6b POST cannot mutate without a secret', snapWorld(w) === before, true);
}
{
  // EXEC_URL blank -> the email carries no links, the page carries no button.
  const w = newWorld({ props: { EXEC_URL: '' } });
  const r = submit(w, {});
  const t = tokenOf(w, r);
  check('J6c owner mail warns EXEC_URL is unset',
        (w.mails[0].htmlBody || '').indexOf('EXEC_URL is not configured') >= 0, true);
  const page = doGet(w, t, 'approve');
  check('J6d review page explains instead of showing a dead button',
        page.indexOf('EXEC_URL') >= 0, true);
  check('J6e no nonce minted', nonceFromPage(page), null);
}
{
  // RESPONSES_SS_ID === SCHEDULE_SS_ID must refuse to run at all.
  const w = newWorld({ props: { RESPONSES_SS_ID: SCHEDULE_ID } });
  let threw = '';
  try { w.g.openResponsesSheet_(); } catch (e) { threw = String(e.message).slice(0, 60); }
  check('J6f fails closed when responses live in the public file',
        threw.indexOf('REFUSING TO RUN') >= 0, true);
  const before = snapWorld(w);
  const page = doGet(w, '00000000-0000-4000-8000-000000000000', 'approve');
  check('J6g doGet degrades to a generic error', h1(page), 'Something went wrong');
  check('J6h and writes nothing', snapWorld(w) === before, true);
}
{
  // doGet/doPost before installStep1_bootstrap ever added the admin columns.
  const w = newWorld();
  w.respValues.push(submissionRow({}));         // a raw form row, no JC columns
  const before = snapWorld(w);
  const tok = '00000000-0000-4000-8000-000000000000';
  check('J6i doGet -> unknown', h1(doGet(w, tok, 'approve')), 'Unknown or expired request');
  check('J6j doPost -> unknown',
        h1(doPost(w, tok, 'approve', w.g.nonceFor_(tok, 'approve', w.g.currentBucket_()))),
        'Unknown or expired request');
  check('J6k nothing written', snapWorld(w) === before, true);
}

head('J7. the token IS the whole authorisation (by design — recorded, not a bug)');
{
  const w = newWorld();
  const r = submit(w, {});
  const stolen = tokenOf(w, r);
  // Two anonymous HTTP requests, no organizer action, no session, no cookie.
  const p1 = doGet(w, stolen, 'approve');
  const p2 = doPost(w, stolen, 'approve', nonceFromPage(p1));
  check('J7a an anonymous token holder can write to the public schedule',
        speakerAt(w, '2026-09-14'), 'Ada Lovelace');
  check('J7b and the speaker gets a confirmation email', w.mails.length, 2);
  note('requests needed', 'GET ?t=<token>&a=approve  then  POST t,a,n');
}

// ===========================================================================
head('summary');
console.log(`assertions: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nBROKEN EXPECTATIONS (mine, not the code\'s):\n' + failures.join('\n')); }
console.log(`\nDEFECTS REPRODUCED: ${defects.length}`);
for (const d of defects) { console.log(`  ${d.id}: ${d.claim}\n      ${d.observed}`); }
// Every defect this suite once reproduced is fixed and re-encoded above as a
// regression guard, so a non-empty `defects` list is now a regression too.
process.exitCode = (fail || defects.length) ? 1 : 0;
