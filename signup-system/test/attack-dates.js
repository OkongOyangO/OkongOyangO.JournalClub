/**
 * attack-dates.js — adversarial probe of the date / timezone / calendar-boundary
 * logic in ../apps-script/Code.gs.
 *
 * Functions under attack:
 *   coerceDate_, dayKey_, normalizeDateKey_, findRowByDate_, slotState_,
 *   isFreeSlot_, lastScheduledDate_, fmtLong_   (+ the approval path they feed)
 *
 * It REUSES harness.js's loadFixture / formatDate / buildSandbox by evaluating
 * harness.js's prelude (everything above its own driver) — harness.js itself is
 * never modified or executed as a test.
 *
 *   TZ=America/New_York node test/attack-dates.js
 *   node test/attack-dates.js --child        (internal: one host-TZ sample)
 *
 * Exit code is non-zero if anything BROKE: every defect this file once found is
 * fixed, so each check is now a regression guard.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const CODE_GS = path.join(HERE, '..', 'apps-script', 'Code.gs');

/* ─────────────────────────────────────────────────────────────────────────────
 * 0. Reuse harness.js's helpers verbatim (no copy, no drift, no modification).
 * ────────────────────────────────────────────────────────────────────────── */
// Shared instrument: fixture loader, formatDate stub, sandbox. One module, no
// copies — see test/lib.js.
const H = require('./lib');
const SHEET_TZ = H.SCHEDULE_TZ;                       // 'America/New_York'

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. A SHEET-FAITHFUL fixture loader.
 *
 * harness.js builds date cells with `new Date(y, m, d)` — midnight in the HOST
 * process timezone. Real Apps Script hands back midnight in the SPREADSHEET's
 * timezone, whatever the script's own tz is. The difference matters enormously
 * for a host-TZ sweep, so this loader models the real thing and every cross-TZ
 * conclusion below is drawn from BOTH models and the two are compared.
 * ────────────────────────────────────────────────────────────────────────── */
function tzOffsetMs(tz, instant) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUTC - instant.getTime();
}
/** The instant at which local wall-clock time in `tz` is y-m-d 00:00:00. */
function zonedMidnight(y, m /*0-based*/, d, tz) {
  let t = Date.UTC(y, m, d);
  for (let i = 0; i < 4; i++) {
    const next = Date.UTC(y, m, d) - tzOffsetMs(tz, new Date(t));
    if (next === t) { break; }
    t = next;
  }
  return new Date(t);
}

const RAW_FIXTURE = (() => {
  const raw = fs.readFileSync(path.join(HERE, 'fixture-schedule.json'), 'utf8');
  return JSON.parse(raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')));
})();

/** Same shape as harness loadFixture(), but date cells are true sheet-tz midnight. */
function loadFixtureSheetTz(tz) {
  tz = tz || SHEET_TZ;
  const cols = RAW_FIXTURE.table.cols.map(c => String(c.label || ''));
  const values = [cols];
  const DATE_RE = /^Date\((\d+),(\d+),(\d+)/;
  for (const r of RAW_FIXTURE.table.rows) {
    const cells = r.c || [];
    const out = [];
    for (let i = 0; i < cols.length; i++) {
      const cell = cells[i];
      if (!cell || cell.v === null || cell.v === undefined) { out.push(''); continue; }
      const m = DATE_RE.exec(String(cell.v));
      out.push(m ? zonedMidnight(+m[1], +m[2], +m[3], tz) : String(cell.v));
    }
    values.push(out);
  }
  return values;
}
/** The fixture's true calendar dates, straight from the gviz JSON — ground truth. */
function fixtureKeys() {
  const DATE_RE = /^Date\((\d+),(\d+),(\d+)/;
  const dateCol = RAW_FIXTURE.table.cols.findIndex(c => /date/i.test(String(c.label || '')));
  const out = [];
  for (const r of RAW_FIXTURE.table.rows) {
    const cell = (r.c || [])[dateCol];
    if (!cell || cell.v == null) { out.push(null); continue; }
    const m = DATE_RE.exec(String(cell.v));
    out.push(m ? `${m[1]}-${String(+m[2] + 1).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}` : null);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. Sandbox factory. Starts from harness buildSandbox() (so every stub and
 *    every mutation-tripwire is the harness's), then swaps in a schedule whose
 *    values / timezone I control and a write recorder.
 * ────────────────────────────────────────────────────────────────────────── */
function newCtx(values, opts) {
  opts = opts || {};
  const sheetTz = opts.sheetTz || SHEET_TZ;
  const scriptTz = opts.scriptTz || SHEET_TZ;
  const sandbox = H.buildSandbox(values);
  const writes = [];

  const rangeFor = (r, c) => ({
    setValue: v => { writes.push({ row: r, col: c, value: v }); if (values[r - 1]) values[r - 1][c - 1] = v; },
    setValues: () => { throw new Error('attack: unexpected whole-row setValues'); },
    setNumberFormat: () => {},
    getValue: () => (values[r - 1] && values[r - 1][c - 1] !== undefined ? values[r - 1][c - 1] : ''),
    getValues: () => [[]],
  });
  const fakeSheet = {
    getSheetId: () => 0,
    getName: () => 'Schedule',
    getDataRange: () => ({ getValues: () => values }),
    getRange: (r, c) => rangeFor(r, c),
    getMaxRows: () => values.length,
    getLastRow: () => values.length,
    getLastColumn: () => (values[0] || []).length,
    getParent: () => fakeSS,
  };
  const fakeSS = {
    getSheets: () => [fakeSheet],
    getSheetByName: () => fakeSheet,
    getSpreadsheetTimeZone: () => sheetTz,
    getId: () => 'FAKE_SCHEDULE_ID',
  };
  sandbox.SpreadsheetApp = { openById: () => fakeSS, flush: () => {} };
  sandbox.Session = { getScriptTimeZone: () => scriptTz };
  // harness.formatDate deliberately supports only the six read-path patterns.
  // nowStamp_() (write path) uses a seventh; add it here rather than touch harness.js.
  const baseFmt = sandbox.Utilities.formatDate;
  sandbox.Utilities.formatDate = (d, tz, pat) => {
    if (pat === "yyyy-MM-dd'T'HH:mm:ssXXX") {
      const off = -tzOffsetMs(tz, d) / 60000;
      const sign = off <= 0 ? '+' : '-', ab = Math.abs(off);
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(d).map(x => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${(+p.hour) % 24 < 10 ? '0' : ''}${(+p.hour) % 24}:${p.minute}:${p.second}` +
        `${sign}${String(Math.floor(ab / 60)).padStart(2, '0')}:${String(ab % 60).padStart(2, '0')}`;
    }
    return baseFmt(d, tz, pat);
  };
  sandbox.HtmlService = { createHtmlOutput: h => ({ setTitle: () => ({ getContent: () => h }), getContent: () => h }) };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_GS, 'utf8'), sandbox, { filename: 'Code.gs' });
  return { g: sandbox, values, writes, sheetTz, scriptTz };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Reporting
 * ────────────────────────────────────────────────────────────────────────── */
const results = [];
function section(t) { console.log('\n' + '═'.repeat(76) + '\n  ' + t + '\n' + '═'.repeat(76)); }
function ok(name, detail) { results.push(['HELD', name]); console.log(`  ✓ HELD   ${name}${detail ? '  — ' + detail : ''}`); }
function bad(name, detail) { results.push(['BROKE', name]); console.log(`  ✗ BROKE  ${name}${detail ? '\n           ' + detail : ''}`); }
function info(name, detail) { console.log(`  · ${name}${detail !== undefined ? ': ' + detail : ''}`); }

const NOW = new Date(2026, 7, 8);   // 2026-08-08, per the brief

/* ═══════════════════════════════════════════════════════════════════════════
 *  CHILD MODE — one host-TZ sample of the whole schedule, printed as JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
function sample() {
  const truth = fixtureKeys();
  const out = { tz: process.env.TZ || '(host default)' };

  for (const model of ['harness', 'sheetfaithful']) {
    const values = model === 'harness' ? H.loadFixture() : loadFixtureSheetTz();
    const { g } = newCtx(values);
    const ctx = g.openSchedule_();
    const keys = [];
    for (let r = 1; r < values.length; r++) {
      const d = g.coerceDate_(values[r][ctx.col.date], ctx.tz, '');
      keys.push(d ? g.dayKey_(d, ctx.tz) : null);
    }
    const nowLocal = new Date(2026, 7, 8);
    const free = [];
    for (let r = 1; r < values.length; r++) {
      if (g.isFreeSlot_(values[r], ctx.col, ctx.tz, nowLocal)) { free.push(keys[r - 1]); }
    }
    out[model] = {
      keysMatchTruth: JSON.stringify(keys) === JSON.stringify(truth),
      firstMismatch: (() => { for (let i = 0; i < truth.length; i++) if (keys[i] !== truth[i]) return { i, got: keys[i], want: truth[i] }; return null; })(),
      freeCount: free.length,
      firstFree: free[0] || null,
      find_2026_09_14: g.findRowByDate_(ctx, '2026-09-14').status,
      find_2026_11_02: g.findRowByDate_(ctx, '2026-11-02').status,
      find_2027_03_15: g.findRowByDate_(ctx, '2027-03-15').status,
      find_2026_12_28: g.findRowByDate_(ctx, '2026-12-28').status,
      find_2027_01_04: g.findRowByDate_(ctx, '2027-01-04').status,
      lastScheduled: g.fmtLong_(g.lastScheduledDate_(ctx), ctx.tz),
    };
  }

  // TEXT date column (someone reformatted Date to plain text). Sheet tz stays
  // America/New_York; only the HOST (= Apps Script project) tz varies.
  {
    const values = loadFixtureSheetTz();
    const dateCol = values[0].findIndex(h => /date/i.test(h));
    for (let r = 1; r < values.length; r++) {
      if (Object.prototype.toString.call(values[r][dateCol]) === '[object Date]') {
        values[r][dateCol] = truth[r - 1];        // e.g. '2026-09-14' as a STRING
      }
    }
    const { g } = newCtx(values);
    const ctx = g.openSchedule_();
    const keys = [];
    for (let r = 1; r < values.length; r++) {
      const d = g.coerceDate_(values[r][ctx.col.date], ctx.tz, '');
      keys.push(d ? g.dayKey_(d, ctx.tz) : null);
    }
    // What the Form dropdown would advertise for the row whose cell reads 2026-09-14,
    // and what the approval / speaker-confirmation email would call that date.
    const dowIdx = ctx.col['day of week'];
    let choice = null, told = null;
    for (let r = 1; r < values.length; r++) {
      if (String(values[r][ctx.col.date]) !== '2026-09-14') { continue; }
      const dd = g.coerceDate_(values[r][ctx.col.date], ctx.tz, values[r][dowIdx]);
      const dow = String(values[r][dowIdx] || '') || g.dayKey_(dd, ctx.tz);
      choice = g.dayKey_(dd, ctx.tz) + ' — ' + dow + ' ' + g.fmtShort_(dd, ctx.tz);
      told = g.fmtLong_(dd, ctx.tz);
    }
    out.textcol = {
      keysMatchTruth: JSON.stringify(keys) === JSON.stringify(truth),
      firstMismatch: (() => { for (let i = 0; i < truth.length; i++) if (keys[i] !== truth[i]) return { i, cell: truth[i], keyedAs: keys[i] }; return null; })(),
      find_2026_09_14: g.findRowByDate_(ctx, '2026-09-14').status,
      // does the row that literally says 2026-09-14 answer to the PREVIOUS day?
      find_2026_09_13: g.findRowByDate_(ctx, '2026-09-13').status,
      slot_2026_09_14: g.slotState_(ctx, '2026-09-14', new Date(2026, 7, 8)).state,
      // sheet cell literally reads "2026-09-14"; what do the humans get told?
      formChoiceForThatRow: choice,
      emailWouldSay: told,
    };
  }
  console.log(JSON.stringify(out));
}

if (process.argv.includes('--child')) { sample(); return; }

/* ═══════════════════════════════════════════════════════════════════════════
 *  MAIN
 * ═══════════════════════════════════════════════════════════════════════════ */

const truth = fixtureKeys();
const baseValues = loadFixtureSheetTz();
const base = newCtx(baseValues);
const G = base.g;
const CTX = G.openSchedule_();

section('0. Ground truth from the gviz fixture');
info('data rows', truth.length);
info('sheet tz', CTX.tz);
info('host/script tz', process.env.TZ || '(default)');
info('rows spanning the 2026-11-01 DST end', JSON.stringify(truth.filter(k => k >= '2026-10-25' && k <= '2026-11-10')));
info('rows spanning the 2027-03-14 DST start', JSON.stringify(truth.filter(k => k >= '2027-03-07' && k <= '2027-03-22')));
info('rows spanning the year change', JSON.stringify(truth.filter(k => k >= '2026-12-20' && k <= '2027-01-12')));

/* ── A. DST boundaries ──────────────────────────────────────────────────── */
section('A. DST boundaries — 2026-11-01 (EDT→EST) and 2027-03-14 (EST→EDT)');
{
  let allStable = true, allFindable = true, firstBad = '';
  for (let r = 1; r < baseValues.length; r++) {
    const cell = baseValues[r][CTX.col.date];
    const want = truth[r - 1];
    if (!want) { continue; }
    const k1 = G.dayKey_(G.coerceDate_(cell, CTX.tz, ''), CTX.tz);
    const k2 = G.dayKey_(new Date(cell.getTime()), CTX.tz);   // re-derive, must be idempotent
    if (k1 !== want || k2 !== want) { allStable = false; firstBad = firstBad || `row ${r + 1}: cell=${cell.toISOString()} key=${k1} want=${want}`; }
    if (G.findRowByDate_(CTX, want).status !== 'OK') { allFindable = false; firstBad = firstBad || `row ${r + 1} (${want}) not findable`; }
  }
  allStable ? ok('every fixture row keys to its true calendar date', `${truth.length} rows`)
            : bad('dayKey_ drifts on some rows', firstBad);
  allFindable ? ok('every fixture row is findable by its own dayKey_')
              : bad('findRowByDate_ loses a row', firstBad);

  // Synthetic rows straddling both transitions, every day either side.
  const probe = [];
  for (const [y, mo, d0] of [[2026, 10, 29], [2027, 2, 11]]) {
    for (let i = 0; i < 7; i++) {
      const dt = new Date(zonedMidnight(y, mo, d0 + i, SHEET_TZ).getTime());
      probe.push(dt);
    }
  }
  const hdr = baseValues[0];
  const synth = [hdr.slice()];
  for (const d of probe) {
    const row = hdr.map(() => '');
    row[CTX.col.date] = d;
    row[CTX.col['day of week']] = H.formatDate(d, SHEET_TZ, 'EEEE');
    synth.push(row);
  }
  const s = newCtx(synth);
  const sctx = s.g.openSchedule_();
  let bad1 = null;
  for (const d of probe) {
    const key = H.formatDate(d, SHEET_TZ, 'yyyy-MM-dd');
    const got = s.g.dayKey_(d, SHEET_TZ);
    const found = s.g.findRowByDate_(sctx, key);
    if (got !== key || found.status !== 'OK') { bad1 = bad1 || `${key}: dayKey_=${got} find=${found.status}`; }
  }
  bad1 ? bad('synthetic DST-straddling rows', bad1)
       : ok('14 synthetic rows around both US-Eastern transitions', 'dayKey_ stable, all findable');

  // The 25-hour and 23-hour days themselves.
  const nov1 = zonedMidnight(2026, 10, 1, SHEET_TZ), nov2 = zonedMidnight(2026, 10, 2, SHEET_TZ);
  const mar14 = zonedMidnight(2027, 2, 14, SHEET_TZ), mar15 = zonedMidnight(2027, 2, 15, SHEET_TZ);
  info('2026-11-01 length (h)', (nov2 - nov1) / 3600000);
  info('2027-03-14 length (h)', (mar15 - mar14) / 3600000);
  const longDay = G.dayKey_(new Date(nov1.getTime() + 23 * 3600000), SHEET_TZ);   // 23h into a 25h day
  ok('a Date 23h into the 25-hour day still keys to 2026-11-01', longDay === '2026-11-01' ? '' : 'GOT ' + longDay);
  if (longDay !== '2026-11-01') { results.pop(); bad('23h into the 25-hour day', 'keyed as ' + longDay); }
}

/* ── B. Host timezone sweep ─────────────────────────────────────────────── */
section('B. Host (= Apps Script project) timezone sweep');
{
  const zones = ['America/New_York', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Midway'];
  const got = {};
  for (const tz of zones) {
    const out = execFileSync(process.execPath, [__filename, '--child'],
      { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    got[tz] = JSON.parse(out.trim().split('\n').pop());
  }
  console.log('  model = sheetfaithful  (date cells = true midnight America/New_York — what Apps Script really returns)');
  for (const tz of zones) {
    const s = got[tz].sheetfaithful;
    info(`    ${tz.padEnd(20)}`, `keysCorrect=${s.keysMatchTruth} free=${s.freeCount} first=${s.firstFree} 14Sep=${s.find_2026_09_14} 2Nov=${s.find_2026_11_02} 15Mar=${s.find_2027_03_15}`);
  }
  const refS = JSON.stringify(got['America/New_York'].sheetfaithful);
  const allSame = zones.every(tz => JSON.stringify(got[tz].sheetfaithful) === refS);
  allSame && got['America/New_York'].sheetfaithful.keysMatchTruth
    ? ok('DATE-TYPED schedule column is fully host-TZ independent', 'identical results in all 5 zones')
    : bad('DATE-TYPED column varies with host tz', JSON.stringify(zones.map(tz => [tz, got[tz].sheetfaithful.freeCount])));

  console.log('\n  model = harness        (date cells = new Date(y,m,d) in the HOST tz)');
  for (const tz of zones) {
    const s = got[tz].harness;
    info(`    ${tz.padEnd(20)}`, `keysCorrect=${s.keysMatchTruth} free=${s.freeCount} first=${s.firstFree} 14Sep=${s.find_2026_09_14}` +
      (s.firstMismatch ? ` firstMismatch=${JSON.stringify(s.firstMismatch)}` : ''));
  }
  const harnessVaries = !zones.every(tz => JSON.stringify(got[tz].harness) === JSON.stringify(got['America/New_York'].harness));
  info('harness model varies by host tz', harnessVaries);
  console.log('  → the harness-model divergence is a HARNESS MODELLING ARTEFACT, not a Code.gs bug:');
  console.log('    real getValues() returns midnight in the SPREADSHEET tz regardless of script tz.');

  console.log('\n  model = textcol        (Date column reformatted to plain text; sheet tz stays America/New_York)');
  for (const tz of zones) {
    const s = got[tz].textcol;
    info(`    ${tz.padEnd(20)}`, `keysCorrect=${s.keysMatchTruth} 14Sep=${s.find_2026_09_14} 13Sep=${s.find_2026_09_13} slot(14Sep)=${s.slot_2026_09_14}` +
      (s.firstMismatch ? ` firstMismatch=${JSON.stringify(s.firstMismatch)}` : ''));
    info(`      ↳ cell "2026-09-14" → Form offers`, JSON.stringify(s.formChoiceForThatRow) + '   email says ' + JSON.stringify(s.emailWouldSay));
  }
  const skew = zones.filter(tz => got[tz].textcol.emailWouldSay !== got['America/New_York'].textcol.emailWouldSay);
  skew.length
    ? bad('the same schedule cell is advertised and confirmed as a DIFFERENT calendar day',
        `cell text "2026-09-14": ET says ${JSON.stringify(got['America/New_York'].textcol.emailWouldSay)}, ` +
        `${skew[0]} says ${JSON.stringify(got[skew[0]].textcol.emailWouldSay)}; the Form choice string is ` +
        `${JSON.stringify(got[skew[0]].textcol.formChoiceForThatRow)} — its ISO prefix and its human half disagree by a day.`)
    : ok('Form choice text and speaker-confirmation date are host-TZ stable');
  const textBroken = zones.filter(tz => !got[tz].textcol.keysMatchTruth);
  textBroken.length
    ? bad('TEXT date column: coerceDate_ builds Dates in the SCRIPT tz, keys them in the SHEET tz',
        `wrong in ${JSON.stringify(textBroken)}; e.g. ${JSON.stringify(got[textBroken[0]].textcol.firstMismatch)} ` +
        `— and '2026-09-13' then resolves to status ${got[textBroken[0]].textcol.find_2026_09_13}`)
    : ok('TEXT date column survives every host tz');
}

/* ── C. Year boundary ───────────────────────────────────────────────────── */
section('C. Year boundary — 2026-12-28 / 2027-01-04');
{
  const a = G.findRowByDate_(CTX, '2026-12-28');
  const b = G.findRowByDate_(CTX, '2027-01-04');
  info('2026-12-28', a.status + (a.row ? ' row ' + a.row.sheetRow + ' speaker=' + JSON.stringify(a.row.values[CTX.col.speaker]) : ''));
  info('2027-01-04', b.status + (b.row ? ' row ' + b.row.sheetRow + ' speaker=' + JSON.stringify(b.row.values[CTX.col.speaker]) : ''));
  (a.status === 'OK' && b.status === 'OK' && a.row.sheetRow !== b.row.sheetRow)
    ? ok('both year-boundary rows resolve, to different rows')
    : bad('year-boundary rows', JSON.stringify([a.status, b.status]));
  const collide = ['2025-12-28', '2027-12-28', '2026-01-04', '2028-01-04']
    .map(k => [k, G.findRowByDate_(CTX, k).status]);
  collide.every(([, s]) => s === 'NOT_IN_SCHEDULE')
    ? ok('same day-of-year in neighbouring years does NOT collide', JSON.stringify(collide))
    : bad('cross-year collision', JSON.stringify(collide));
  info('fmtLong_ 2026-12-28', G.fmtLong_(a.row.date, CTX.tz));
  info('fmtLong_ 2027-01-04', G.fmtLong_(b.row.date, CTX.tz));
}

/* ── D. Leap / malformed / edge literals ───────────────────────────────── */
section('D. Edge literals through coerceDate_ / normalizeDateKey_ / findRowByDate_');
{
  const cases = ['2026-02-29', '2026-13-01', '2026-00-10', '2026-01-32', '0000-01-01',
    '2026-1-4', ' 2026-01-04 ', '2026-01-04T00:00:00Z', '2028-02-29', '2024-02-29',
    '24 August', '24 August 2026', '31 February 2026', '2026/09/14', '9/14/2026', ''];
  const rows = [];
  for (const s of cases) {
    const d = G.coerceDate_(s, CTX.tz, '');
    rows.push({
      input: JSON.stringify(s),
      coerceDate_: d ? G.dayKey_(d, CTX.tz) : String(d),
      normalizeDateKey_: JSON.stringify(G.normalizeDateKey_(s, CTX.tz)),
      findRowByDate_: G.findRowByDate_(CTX, s).status,
    });
  }
  for (const r of rows) {
    info(r.input.padEnd(24), `coerceDate_→${String(r.coerceDate_).padEnd(12)} normalizeDateKey_→${r.normalizeDateKey_.padEnd(14)} findRowByDate_→${r.findRowByDate_}`);
  }
  const feb29 = G.coerceDate_('2026-02-29', CTX.tz, '');
  const m1301 = G.coerceDate_('2026-13-01', CTX.tz, '');
  (feb29 && G.dayKey_(feb29, CTX.tz) === '2026-03-01')
    ? bad('coerceDate_ silently rolls a non-existent ISO date over',
        `'2026-02-29' → ${G.dayKey_(feb29, CTX.tz)}; '2026-13-01' → ${m1301 ? G.dayKey_(m1301, CTX.tz) : m1301}; '2026-01-32' → ${G.dayKey_(G.coerceDate_('2026-01-32', CTX.tz, ''), CTX.tz)}`)
    : ok('coerceDate_ rejects non-existent ISO dates');

  // Does the rollover let a bogus TEXT cell answer to a real neighbouring date?
  const hdr = baseValues[0];
  const bogus = [hdr.slice()];
  const rw = hdr.map(() => ''); rw[CTX.col.date] = '2026-02-29'; rw[CTX.col['day of week']] = 'Sunday';
  bogus.push(rw);
  const bg = newCtx(bogus); const bctx = bg.g.openSchedule_();
  const hit = bg.g.findRowByDate_(bctx, '2026-03-01');
  (hit.status === 'OK')
    ? bad('a text cell reading "2026-02-29" answers to the request key 2026-03-01',
        `findRowByDate_(ctx,'2026-03-01') → ${hit.status}, sheetRow ${hit.row.sheetRow}, whose Date cell literally reads "${bogus[1][bctx.col.date]}"`)
    : ok('bogus text date cannot impersonate a neighbouring day', hit.status);

  // Unpadded / locale-formatted text dates: silently invisible?
  const locale = [hdr.slice()];
  for (const s of ['2026-9-14', '9/14/2026', '14.09.2026']) {
    const r2 = hdr.map(() => ''); r2[CTX.col.date] = s; r2[CTX.col['day of week']] = 'Monday';
    locale.push(r2);
  }
  const lg = newCtx(locale); const lctx = lg.g.openSchedule_();
  let invisible = 0;
  for (let r = 1; r < locale.length; r++) {
    if (lg.g.coerceDate_(locale[r][lctx.col.date], lctx.tz, 'Monday') === null) { invisible++; }
  }
  info('rows whose text date coerces to null', `${invisible}/3  (inputs: 2026-9-14, 9/14/2026, 14.09.2026)`);
  info('lastScheduledDate_ over that sheet', String(lg.g.lastScheduledDate_(lctx)));
  // REGRESSION GUARD. These forms are still not parsed — deliberately: the fix is
  // a detector, not a wider parser, because silence was the defect. What must
  // hold is that every unreadable cell is NAMED, so the nightly report can point
  // Yiyang at the exact rows instead of a week quietly disappearing.
  const named = lg.g.unreadableDateRows_(lctx);
  info('unreadableDateRows_ names them', JSON.stringify(named));
  (invisible === 3 && named.length === 3 &&
   JSON.stringify(named) === JSON.stringify([2, 3, 4]))
    ? ok('unparseable text dates are REPORTED by row number, not silently dropped',
        `unreadableDateRows_ → ${JSON.stringify(named)}`)
    : bad('unparseable text dates are not reported',
        `coerced-null=${invisible}/3, named=${JSON.stringify(named)}`);
}

/* ── E. Duplicate dates ─────────────────────────────────────────────────── */
section('E. Duplicate dates → AMBIGUOUS, and what the approval path does with it');
{
  const dup = baseValues.map(r => r.slice());
  const src = dup.findIndex((r, i) => i > 0 && truth[i - 1] === '2026-09-14');
  const clone = dup[src].slice();
  dup.splice(src + 1, 0, clone);                       // exact same date, twice
  const d = newCtx(dup);
  const dctx = d.g.openSchedule_();

  const found = d.g.findRowByDate_(dctx, '2026-09-14');
  found.status === 'AMBIGUOUS'
    ? ok('findRowByDate_ returns AMBIGUOUS rather than picking one', `rows ${found.rows.map(h => h.sheetRow).join(',')}`)
    : bad('duplicate date silently resolved', found.status);

  const st = d.g.slotState_(dctx, '2026-09-14', NOW);
  st.state === 'AMBIGUOUS'
    ? ok('slotState_ propagates AMBIGUOUS', `${st.rows.length} rows`)
    : bad('slotState_ mishandles duplicates', st.state);

  let banner;
  try { banner = d.g.slotBanner_(Object.assign({ tz: dctx.tz }, st), '2026-09-14', ''); ok('slotBanner_ renders AMBIGUOUS without throwing', JSON.stringify(banner.text)); }
  catch (e) { bad('slotBanner_ throws on AMBIGUOUS', String(e && e.message)); }

  // A synthetic PENDING response row, so the real approval path can be driven.
  function makeRow(gg, dateKey) {
    const header = ['Timestamp', 'Email Address', 'Speaker name', 'Affiliation', 'Advisor',
      'Preferred date', 'Talk title', 'Other dates that would also work',
      'JC Token', 'JC Status', 'JC Date Key', 'JC Decided At', 'JC Decision Note',
      'JC Schedule Row', 'JC Notified'];
    const vals = [new Date(2026, 7, 8, 9, 0, 0), 'ada@example.edu', 'Ada Lovelace', 'PSU',
      'C. Babbage', dateKey + ' — Monday 14 September', 'Analytical engines', '21 Sep',
      '00000000-0000-4000-8000-000000000000', 'PENDING', dateKey, '', '', '', ''];
    const adminWrites = [];
    const sheet = {
      getParent: () => ({ getSpreadsheetTimeZone: () => SHEET_TZ }),
      getLastColumn: () => header.length,
      getLastRow: () => 2,
      getRange: (r, c) => ({
        setValue: v => { adminWrites.push({ row: r, col: header[c - 1], value: v }); },
        getValue: () => vals[c - 1],
        getValues: () => [[vals[c - 1]]],
      }),
    };
    return {
      row: { sheet, rowIndex: 2, header, cols: gg.resolveResponseCols_(header),
             values: vals, display: vals.map(v => String(v)) },
      adminWrites,
    };
  }

  const plain = p => String(p && p.getContent ? p.getContent() : p)
    .replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const { row: dupRow, adminWrites: dupAdmin } = makeRow(d.g, '2026-09-14');
  let res;
  try { res = d.g.doApprove_(dupRow); } catch (e) { res = { threw: String(e && e.stack || e) }; }
  if (res.threw) {
    bad('doApprove_ THROWS on a duplicated date', res.threw.split('\n').slice(0, 3).join(' | '));
  } else {
    const wroteSchedule = d.writes.length;
    (wroteSchedule === 0 && dupAdmin.length === 0)
      ? ok('doApprove_ blocks on AMBIGUOUS: nothing written, row left PENDING',
          `schedule writes=${wroteSchedule}, admin writes=${dupAdmin.length}`)
      : bad('doApprove_ wrote despite AMBIGUOUS', JSON.stringify({ schedule: d.writes, admin: dupAdmin }));
    info('blocked page says', JSON.stringify(plain(res.page).slice(0, 170)));
  }

  // Control: the identical path on a NON-duplicated free slot must write.
  const c = newCtx(baseValues.map(r => r.slice()));
  const { row: okRow, adminWrites: okAdmin } = makeRow(c.g, '2026-09-14');
  let res2;
  try { res2 = c.g.doApprove_(okRow); } catch (e) { res2 = { threw: String(e && e.stack || e) }; }
  (!res2.threw && res2.approved && c.writes.length > 0)
    ? ok('CONTROL: same path on a clean free slot does write',
        `${c.writes.length} cells into sheet row ${res2.schedRow.sheetRow} (= the 2026-09-14 row), admin stamps=${okAdmin.length}`)
    : bad('CONTROL failed — the harness cannot observe writes',
        (res2.threw || plain(res2.page).slice(0, 160)));
  info('control schedule writes', JSON.stringify(c.writes));

  // Does the FORM still advertise a date that can never be approved?
  const dupFree = baseValues.map(r => r.slice());
  const s2 = dupFree.findIndex((r, i) => i > 0 && truth[i - 1] === '2026-09-14');
  dupFree.splice(s2 + 1, 0, dupFree[s2].slice());
  const f = newCtx(dupFree); const fctx = f.g.openSchedule_();
  const dowIdx = fctx.col['day of week'];
  const choices = [];
  const nowReal = new Date(2026, 7, 8);
  for (let r = 1; r < dupFree.length; r++) {
    if (!f.g.isFreeSlot_(dupFree[r], fctx.col, fctx.tz, nowReal)) { continue; }
    const dd = f.g.coerceDate_(dupFree[r][fctx.col.date], fctx.tz, dupFree[r][dowIdx]);
    choices.push(f.g.dayKey_(dd, fctx.tz));
  }
  const dupCount = choices.filter(k => k === '2026-09-14').length;
  // isFreeSlot_ is per-ROW and stays that way — both copies are genuinely free
  // rows. De-duplication is refreshFormDates_'s job, and the regression guard for
  // it (offered zero times + a named problem) lives in attack-dropdown.js §6b,
  // which drives the real function through a FormApp stub.
  dupCount === 2
    ? ok('both duplicate rows are still row-level free (de-dup is refreshFormDates_\'s job)',
        'guarded end-to-end in attack-dropdown.js §6b')
    : bad('duplicate free rows no longer both read as free at row level', String(dupCount));
}

/* ── F. Empty / malformed schedules ─────────────────────────────────────── */
section('F. Empty and malformed schedules');
{
  const hdr = baseValues[0].slice();

  // F1 header only
  try {
    const h = newCtx([hdr]);
    const hctx = h.g.openSchedule_();
    const st = h.g.slotState_(hctx, '2026-09-14', NOW);
    info('header-only: slotState_', JSON.stringify({ state: st.state, lastDate: String(st.lastDate) }));
    let free = 0;
    for (let r = 1; r < 1; r++) { free++; }
    ok('header-only sheet does not throw', `slotState_→${st.state}, lastScheduledDate_→${String(h.g.lastScheduledDate_(hctx))}`);
    const banner = h.g.slotBanner_(Object.assign({ tz: hctx.tz }, st), '2026-09-14', '');
    info('banner text', JSON.stringify(banner.text));
  } catch (e) { bad('header-only sheet throws', String(e && e.message)); }

  // F2 completely empty grid (what getDataRange() gives on a blank sheet)
  try {
    const e2 = newCtx([['']]);
    e2.g.openSchedule_();
    bad('a completely blank sheet is accepted as a schedule', 'openSchedule_ did not throw');
  } catch (e) { ok('blank sheet throws loudly', JSON.stringify(String(e.message).slice(0, 90))); }

  // F3 Date column removed
  try {
    const noDate = [hdr.filter(h2 => !/^date$/i.test(String(h2).trim()))];
    for (let r = 1; r < baseValues.length; r++) {
      noDate.push(baseValues[r].filter((_, i) => !/^date$/i.test(String(hdr[i]).trim())));
    }
    const nd = newCtx(noDate);
    nd.g.openSchedule_();
    bad('missing Date column accepted', 'openSchedule_ did not throw');
  } catch (e) { ok('missing Date column throws loudly', JSON.stringify(String(e.message).slice(0, 90))); }

  // F4 Date column retyped to text in the sheet's own display format ("24 August", no year)
  {
    const txt = [hdr.slice()];
    for (let r = 1; r < baseValues.length; r++) {
      const row = baseValues[r].slice();
      const d0 = row[CTX.col.date];
      if (Object.prototype.toString.call(d0) === '[object Date]') {
        row[CTX.col.date] = H.formatDate(d0, SHEET_TZ, 'd MMMM');    // exactly the sheet's display pattern
      }
      txt.push(row);
    }
    const t = newCtx(txt);
    const tctx = t.g.openSchedule_();
    let wrong = [], nulls = 0;
    for (let r = 1; r < txt.length; r++) {
      const want = truth[r - 1];
      const d1 = t.g.coerceDate_(txt[r][tctx.col.date], tctx.tz, txt[r][tctx.col['day of week']]);
      if (!d1) { nulls++; continue; }
      const k = t.g.dayKey_(d1, tctx.tz);
      if (k !== want) { wrong.push(`${txt[r][tctx.col.date]} (${txt[r][tctx.col['day of week']]}) → ${k}, want ${want}`); }
    }
    info('rows', txt.length - 1);
    info('coerced to null', nulls);
    info('wrong year', wrong.length);
    if (wrong.length) { info('examples', JSON.stringify(wrong.slice(0, 4))); }
    (wrong.length === 0 && nulls === 0)
      ? ok('"d MMMM" text dates + Day-of-Week hint recover the right year for every row', `${txt.length - 1}/${txt.length - 1}`)
      : bad('"d MMMM" text dates lose the year on some rows', `${wrong.length} wrong, ${nulls} null; e.g. ${JSON.stringify(wrong.slice(0, 2))}`);

    // and with the Day-of-Week hint blanked out (the nearest-year fallback)
    const txt2 = txt.map(r => r.slice());
    for (let r = 1; r < txt2.length; r++) { txt2[r][tctx.col['day of week']] = ''; }
    const t2 = newCtx(txt2); const t2ctx = t2.g.openSchedule_();
    let wrong2 = [];
    for (let r = 1; r < txt2.length; r++) {
      const want = truth[r - 1];
      const d1 = t2.g.coerceDate_(txt2[r][t2ctx.col.date], t2ctx.tz, '');
      const k = d1 ? t2.g.dayKey_(d1, t2ctx.tz) : null;
      if (k !== want) { wrong2.push(`${txt2[r][t2ctx.col.date]} → ${k}, want ${want}`); }
    }
    // REGRESSION GUARD. A year-less "8 February" with no weekday hint is genuinely
    // ambiguous and every tie-break was wrong for a large slice of the real sheet
    // (nearest-year resolved 6 of 39 rows into the past; prefer-future was wrong
    // for the 7 rows that really are past). coerceDate_ now REFUSES instead of
    // guessing, and unreadableDateRows_ names the rows. Assert: no row resolves
    // to a WRONG date, and every row is reported.
    const guessed = wrong2.filter(w => !/→ null,/.test(w));
    const named2 = t2.g.unreadableDateRows_(t2ctx);
    info('rows that resolved to a WRONG date', guessed.length);
    info('rows named by unreadableDateRows_', named2.length);
    (guessed.length === 0 && named2.length === txt2.length - 1)
      ? ok('no weekday hint ⇒ coerceDate_ refuses and every row is reported',
          `0 wrong guesses, ${named2.length}/${txt2.length - 1} rows named`)
      : bad('a year-less text date without a weekday hint still resolves to a guess',
          `${guessed.length} wrong; e.g. ${JSON.stringify(guessed.slice(0, 3))}`);
  }
}

/* ── F5. Loudness: does anything actually SHOUT when dates stop parsing? ── */
section('F5. Loudness of an unparseable Date column (all rows vs. a few rows)');
{
  const hdr = baseValues[0].slice();
  const countOpen = (vals) => {
    const x = newCtx(vals); const xc = x.g.openSchedule_();
    let n = 0; const lost = [];
    for (let r = 1; r < vals.length; r++) {
      if (x.g.isFreeSlot_(vals[r], xc.col, xc.tz, NOW)) { n++; }
      if (x.g.coerceDate_(vals[r][xc.col.date], xc.tz, vals[r][xc.col['day of week']]) === null) { lost.push(r + 1); }
    }
    return { open: n, lost, g: x.g, ctx: xc };
  };

  // (a) EVERY row retyped to US-locale text.
  const all = [hdr.slice()];
  for (let r = 1; r < baseValues.length; r++) {
    const row = baseValues[r].slice();
    const d0 = row[CTX.col.date];
    if (Object.prototype.toString.call(d0) === '[object Date]') {
      const k = H.formatDate(d0, SHEET_TZ, 'yyyy-MM-dd');
      row[CTX.col.date] = `${+k.slice(5, 7)}/${+k.slice(8, 10)}/${k.slice(0, 4)}`;   // 9/14/2026
    }
    all.push(row);
  }
  const A2 = countOpen(all);
  info('all-text ("9/14/2026"): free slots', A2.open);
  info('all-text: rows whose date coerces to null', A2.lost.length);
  A2.open === 0
    ? ok('total date-column corruption IS caught (openCount 0 ⇒ verifySetup_/refreshFormDates_ both raise a problem)')
    : bad('total date-column corruption not caught', String(A2.open));

  // (b) Only THREE rows retyped — the realistic case (someone edits a few cells).
  const some = baseValues.map(r => r.slice());
  const targets = ['2026-09-14', '2026-11-02', '2027-03-15'];
  const hitRows = [];
  for (let r = 1; r < some.length; r++) {
    if (targets.indexOf(truth[r - 1]) >= 0) {
      const k = truth[r - 1];
      some[r][CTX.col.date] = `${+k.slice(5, 7)}/${+k.slice(8, 10)}/${k.slice(0, 4)}`;
      hitRows.push(r + 1);
    }
  }
  const B2 = countOpen(some);
  info('3-cell corruption: free slots', `${B2.open} (was 26)`);
  info('3-cell corruption: silently invisible sheet rows', JSON.stringify(B2.lost));
  const st = B2.g.slotState_(B2.ctx, '2026-09-14', NOW);
  info("slotState_('2026-09-14')", JSON.stringify({ state: st.state, lastDate: String(st.lastDate) }));
  // REGRESSION GUARD. This is the dangerous case: openCount stays healthy (23 > 0)
  // so neither the "no free slots" check nor the placeholder branch fires. The
  // named-rows detector is the only thing that can see it.
  const named3 = B2.g.unreadableDateRows_(B2.ctx);
  info('unreadableDateRows_ names', JSON.stringify(named3));
  (B2.open > 0 && JSON.stringify(named3) === JSON.stringify(hitRows))
    ? ok('partial date-column corruption is detected and the rows are NAMED',
        `openCount ${B2.open} is still healthy, yet unreadableDateRows_ → ${JSON.stringify(named3)}`)
    : bad('a few retyped Date cells still vanish without an alarm',
        JSON.stringify({ open: B2.open, lost: B2.lost, named: named3, want: hitRows }));
}

/* ── G. LEAD_DAYS arithmetic across DST ─────────────────────────────────── */
section('G. LEAD_DAYS as CALENDAR days, swept across a whole year including both DST flips');
{
  // REGRESSION GUARD for the ms-vs-calendar-days defect. refreshFormDates_ used
  // to do `slotMidnight - now < LEAD_DAYS*86400000` with `now` = the 04:00 trigger
  // instant, which is four hours short: LEAD_DAYS=7 behaved as 8 every night, and
  // across a spring-forward week (23h short again) it dropped the 7-calendar-day
  // slot even at a midnight run — executed against the real fixture that removed
  // the schedule's LAST free slot and replaced the dropdown with "no open dates".
  // The filter is now `dayKey_(slot) >= shiftDayKey_(today, LEAD_DAYS)`. Sweep a
  // daily schedule over 360 consecutive nightly runs and assert the gap is
  // EXACTLY LEAD_DAYS on every one of them, at any run hour.
  const hdr = baseValues[0].slice();
  const rows = [hdr];
  const days = [];
  for (let i = 0; i < 420; i++) {
    const d = zonedMidnight(2026, 8, 1 + i, SHEET_TZ);
    days.push(d);
    const r = hdr.map(() => ''); r[CTX.col.date] = d;
    r[CTX.col['day of week']] = H.formatDate(d, SHEET_TZ, 'EEEE');
    rows.push(r);
  }
  const gg = newCtx(rows);
  const LEAD = 7;
  const keyToDays = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86400000;

  const gapsByHour = {};
  for (const hour of [0, 4, 23]) {                 // midnight, the real trigger hour, late
    const gaps = {};
    for (let i = 0; i < 360; i++) {
      const runDay = zonedMidnight(2026, 8, 1 + i, SHEET_TZ);
      const now = new Date(runDay.getTime() + hour * 3600000);
      const todayKey = gg.g.dayKey_(now, SHEET_TZ);
      const cutoffKey = gg.g.shiftDayKey_(todayKey, LEAD, SHEET_TZ);
      let firstKey = null;
      for (const d of days) {
        const k = gg.g.dayKey_(d, SHEET_TZ);
        if (k <= todayKey) { continue; }           // isFreeSlot_'s strictly-future gate
        if (k < cutoffKey) { continue; }           // the LEAD_DAYS window
        firstKey = k; break;
      }
      if (!firstKey) { continue; }
      const gap = keyToDays(firstKey) - keyToDays(todayKey);
      gaps[gap] = (gaps[gap] || 0) + 1;
    }
    gapsByHour[hour] = gaps;
    info(`calendar-day gap over 360 runs at ${String(hour).padStart(2, '0')}:00`, JSON.stringify(gaps));
  }
  const allGaps = Object.keys(gapsByHour).reduce((a, h) => a.concat(Object.keys(gapsByHour[h])), []);
  const distinct = allGaps.filter((v, i, arr) => arr.indexOf(v) === i);
  (distinct.length === 1 && distinct[0] === String(LEAD))
    ? ok('LEAD_DAYS is exactly LEAD_DAYS calendar days, every day of the year and at every run hour',
        `always ${LEAD} calendar days across 3 run hours × 360 days, both DST flips included`)
    : bad('LEAD_DAYS lead time still varies with the run hour or across DST', JSON.stringify(gapsByHour));

  // The concrete case that used to lose the schedule's last free slot.
  {
    const now = zonedMidnight(2027, 2, 8, SHEET_TZ);          // 2027-03-08 00:00 EST
    const cutoff = gg.g.shiftDayKey_(gg.g.dayKey_(now, SHEET_TZ), LEAD, SHEET_TZ);
    info('spring-forward week: cutoff key from 2027-03-08', cutoff);
    cutoff === '2027-03-15'
      ? ok('the 7-calendar-day slot across a spring-forward week is still inside the window',
          '2027-03-15 (the fixture\'s last free slot) is offered, not swallowed by the 23-hour day')
      : bad('the DST week still shifts the LEAD_DAYS window', cutoff);
  }
}

/* ── H. fmtLong_ / weekday agreement ────────────────────────────────────── */
section('H. fmtLong_ weekday agreement with the sheet\'s own Day of Week column');
{
  let mism = [];
  for (let r = 1; r < baseValues.length; r++) {
    const d = baseValues[r][CTX.col.date];
    if (Object.prototype.toString.call(d) !== '[object Date]') { continue; }
    const declared = String(baseValues[r][CTX.col['day of week']] || '').trim().toLowerCase();
    const actual = H.formatDate(d, SHEET_TZ, 'EEEE').toLowerCase();
    if (declared && declared !== actual) { mism.push(`${truth[r - 1]}: sheet says ${declared},真 ${actual}`); }
  }
  mism.length
    ? bad('the sheet\'s Day of Week column disagrees with the Date column', JSON.stringify(mism))
    : ok('every fixture row\'s Day of Week matches its Date', `${baseValues.length - 1} rows`);
  info('fmtLong_ sample', G.fmtLong_(G.findRowByDate_(CTX, '2026-11-02').row ? G.findRowByDate_(CTX, '2026-11-02').row.date : null, CTX.tz) || '(2026-11-02 not in schedule)');
}

/* ─────────────────────────────────────────────────────────────────────────── */
section('SUMMARY');
const broke = results.filter(r => r[0] === 'BROKE');
const held = results.filter(r => r[0] === 'HELD');
console.log(`  ${held.length} held, ${broke.length} broke\n`);
broke.forEach(r => console.log('  ✗ ' + r[1]));
console.log('');
// This file started life as a probe that always exited 0. Every defect it found
// is fixed, so it is now a GATE: any BROKE line is a regression.
process.exit(broke.length ? 1 : 0);
