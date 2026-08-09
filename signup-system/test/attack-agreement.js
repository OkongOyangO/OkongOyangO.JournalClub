/**
 * ATTACK: do the WEBSITE and the SCRIPT agree about which weeks are free?
 *
 *   TZ=America/New_York node test/attack-agreement.js
 *
 * Two independent classifiers read the SAME sheet:
 *
 *   1. layouts/partials/home/upcoming-seminar.html  — ES5 in the browser, decides
 *      which rows are "upcoming seminars" and renders them on the home page.
 *   2. apps-script/Code.gs  — isFreeSlot_ / slotState_, decides which dates the
 *      Form dropdown offers and whether an approval is allowed to write.
 *
 * If they disagree, a speaker can book a slot the site shows as taken, or a
 * booked talk can silently vanish from the home page.
 *
 * NOTHING HERE IS RE-IMPLEMENTED. The widget's real functions are lifted out of
 * the .html <script> block and executed; Code.gs is executed unmodified through
 * the shared stubs in test/lib.js — literally the same fixture loader and
 * formatDate the core harness runs on, so the two halves cannot drift apart.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const WIDGET = path.join(ROOT, '..', 'layouts', 'partials', 'home', 'upcoming-seminar.html');
const FIXTURE = path.join(HERE, 'fixture-schedule.json');
const SCHEDULE_TZ = 'America/New_York';

/* ═══════════════════════════════════════════════════════════════════════════
 * 0. Reuse harness.js's helpers WITHOUT running (or touching) its assertions.
 * ═══════════════════════════════════════════════════════════════════════════ */
// Shared instrument: fixture loader, formatDate stub, sandbox. See test/lib.js.
const H = require('./lib');

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. The website widget's classification code, executed.
 * ═══════════════════════════════════════════════════════════════════════════ */
function loadWidget() {
  const html = fs.readFileSync(WIDGET, 'utf8');
  const s = html.indexOf('<script>');
  const e = html.lastIndexOf('</script>');
  if (s < 0 || e <= s) throw new Error('attack: no <script> block in ' + WIDGET);
  let body = html.slice(s + '<script>'.length, e);

  // Unwrap the IIFE so its function declarations land on the vm global and can
  // be called from here. The body itself is byte-for-byte the shipped code.
  const open = body.indexOf('(function () {');
  const close = body.lastIndexOf('})();');
  if (open < 0 || close <= open) throw new Error('attack: could not unwrap the widget IIFE');
  body = body.slice(open + '(function () {'.length, close);

  // Minimal DOM shim: enough for esc() and the load()/DOMContentLoaded tail to
  // run harmlessly. No fetch => load() returns immediately, so nothing renders.
  const el = () => {
    let text = '';
    return {
      set textContent(v) { text = v == null ? '' : String(v); },
      get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    };
  };
  const sandbox = {
    console,
    window: {},                       // no window.fetch -> load() bails out
    document: { readyState: 'complete', addEventListener() {}, createElement: el, getElementById: () => null },
  };
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox, { filename: 'upcoming-seminar.html<script>' });
  for (const k of ['parseGviz', 'cellDate', 'cellText', 'resolveCols', 'collectUpcoming', 'MAX_ITEMS']) {
    if (sandbox[k] === undefined) throw new Error('attack: widget symbol missing: ' + k);
  }
  return sandbox;
}
const W = loadWidget();

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. gviz text  <->  getValues() array, for MUTATED fixtures.
 *
 * loadFixture() only reads the on-disk file, so mutation tests need a
 * parameterised version. To prove it is not a divergent re-implementation, the
 * converter is asserted deep-equal to harness's loadFixture() on the real
 * fixture before any mutation is applied (see check 'converter == loadFixture').
 * ═══════════════════════════════════════════════════════════════════════════ */
const GVIZ_PREFIX = '/*O_o*/\ngoogle.visualization.Query.setResponse(';
const GVIZ_SUFFIX = ');';

function gvizObject(text) {
  return JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
}
function gvizText(obj) { return GVIZ_PREFIX + JSON.stringify(obj) + GVIZ_SUFFIX; }

function valuesFromGviz(d) {                       // mirrors harness loadFixture()
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
      out.push(m ? H.zonedMidnight(+m[1], +m[2], +m[3], H.SCHEDULE_TZ) : String(cell.v));
    }
    values.push(out);
  }
  return values;
}

/** Run Code.gs against an arbitrary values array using harness's own stubs. */
function loadCodeGs(values) {
  const sandbox = H.buildSandbox(values);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8'),
                  sandbox, { filename: 'Code.gs' });
  return sandbox;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. Per-row verdicts.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** SITE verdict for one gviz row, computed with the widget's OWN helpers,
 *  following collectUpcoming()'s branches in order. Cross-checked below against
 *  the real collectUpcoming() output so this cannot drift from it. */
function siteVerdict(parsed, col, cells, now) {
  const at = i => (i >= 0 && i < cells.length) ? cells[i] : null;
  const speaker = W.cellText(at(col.speaker));
  if (!speaker) return { verdict: 'skip', why: 'speaker empty', speaker: speaker };
  if (speaker.toUpperCase() === 'N/A') return { verdict: 'skip', why: 'speaker N/A', speaker: speaker };
  const d = W.cellDate(at(col.date));
  if (!d) return { verdict: 'skip', why: 'date unparseable', speaker: speaker };
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d <= today0) return { verdict: 'skip', why: 'not future', speaker: speaker, date: d };
  return { verdict: 'upcoming', why: '', speaker: speaker, date: d };
}

function iso(d) {
  return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0') : '';
}

let pass = 0, fail = 0; const failures = [];
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return true; }
  fail++; failures.push(`  x ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SITE-ONLY CHILD MODE (used by the visitor-timezone experiment)
 *   node attack-agreement.js --site-only <ISO-instant>
 * prints JSON {tz, localDate, upcoming:[isoDate...]} for the REAL fixture.
 * ═══════════════════════════════════════════════════════════════════════════ */
if (process.argv[2] === '--site-only') {
  const now = new Date(process.argv[3]);
  const parsed = W.parseGviz(fs.readFileSync(FIXTURE, 'utf8'));
  const up = W.collectUpcoming(parsed, now);
  process.stdout.write(JSON.stringify({
    tz: process.env.TZ,
    localDate: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
    upcoming: up.map(u => iso(u.date) + '  ' + u.speaker),
  }));
  process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MAIN
 * ═══════════════════════════════════════════════════════════════════════════ */
const RAW = fs.readFileSync(FIXTURE, 'utf8');
const GV = gvizObject(RAW);
const NOW = new Date(2026, 7, 8);                 // 2026-08-08, per the brief

console.log('=== 0. sanity: the two loaders see the same sheet ===');
{
  const a = JSON.stringify(H.loadFixture());
  const b = JSON.stringify(valuesFromGviz(GV));
  check('converter == harness loadFixture', a === b, true);
}
const values = H.loadFixture();
const g = loadCodeGs(values);
const ctx = g.openSchedule_();
const parsed = W.parseGviz(RAW);
const wcol = W.resolveCols(parsed.cols);
check('same row count (site vs script)', parsed.rows.length, values.length - 1);
console.log('  script columns:', JSON.stringify(ctx.col));
console.log('  site   columns:', JSON.stringify(wcol));
console.log('  site MAX_ITEMS:', W.MAX_ITEMS);

/* --- the agreement table ------------------------------------------------- */
console.log('\n=== 1. AGREEMENT TABLE (now = 2026-08-08, tz = ' + ctx.tz + ') ===');
const leadMs = 7 * 86400000;                      // LEAD_DAYS default, as in refreshFormDates_
const rows = [];
for (let r = 0; r < parsed.rows.length; r++) {
  const cells = parsed.rows[r];
  const vals = values[r + 1];
  const sv = siteVerdict(parsed, wcol, cells, NOW);

  const d = g.coerceDate_(vals[ctx.col.date], ctx.tz,
                          ctx.col['day of week'] !== undefined ? vals[ctx.col['day of week']] : '');
  const key = d ? g.dayKey_(d, ctx.tz) : '';
  const st = key ? g.slotState_(ctx, key, NOW).state : 'NO_DATE_ROW';
  const free = g.isFreeSlot_(vals, ctx.col, ctx.tz, NOW);
  const offered = free && d && (d.getTime() - NOW.getTime() >= leadMs);

  rows.push({
    r: r + 2,                                     // sheet row number
    key: key || '(no date)',
    speakerCell: JSON.stringify(String(vals[ctx.col.speaker])),
    site: sv.verdict === 'upcoming' ? 'UPCOMING' : 'skip: ' + sv.why,
    script: st,
    offered: offered ? 'YES' : '-',
  });
}
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log('  row  date        speaker cell        SITE                 SCRIPT           dropdown');
console.log('  ' + '-'.repeat(88));
for (const x of rows) {
  console.log('  ' + pad(x.r, 4) + ' ' + pad(x.key, 11) + ' ' + pad(x.speakerCell, 20) + ' ' +
              pad(x.site, 20) + ' ' + pad(x.script, 16) + ' ' + x.offered);
}

/* --- cross-check my per-row derivation against the real collectUpcoming --- */
const realUpcoming = W.collectUpcoming(parsed, NOW).map(u => iso(u.date));
const derived = rows.filter(x => x.site === 'UPCOMING').map(x => x.key).sort();
check('derived UPCOMING set == collectUpcoming (pre-slice)',
      derived.slice(0, W.MAX_ITEMS), realUpcoming.slice().sort().slice(0, W.MAX_ITEMS));
console.log('\n  site upcoming rows: ' + derived.length +
            '   (rendered, after MAX_ITEMS slice: ' + realUpcoming.length + ')');
console.log('  script FREE rows:   ' + rows.filter(x => x.script === 'FREE').length +
            '   offered in dropdown: ' + rows.filter(x => x.offered === 'YES').length);

/* --- disagreements on the REAL sheet -------------------------------------- */
console.log('\n=== 2. DISAGREEMENTS on the real fixture ===');
const dis = rows.filter(x => {
  const siteTalk = x.site === 'UPCOMING';
  const scriptTalk = x.script === 'TAKEN';         // script thinks a real talk is booked here
  const scriptFuture = x.script === 'TAKEN' || x.script === 'FREE' || x.script === 'BREAK';
  if (siteTalk && !scriptTalk) return true;        // site shows a talk the script doesn't call TAKEN
  if (!siteTalk && scriptTalk && scriptFuture && x.site !== 'skip: not future') return true;
  return false;
});
if (!dis.length) {
  console.log('  NONE. Every row classifies identically once "" and "N/A" are both');
  console.log('  read as "not a talk" for rendering. Concretely:');
  console.log('    site UPCOMING  <=>  script TAKEN and strictly future');
  console.log('    site skip(speaker empty) <=> script FREE or PAST');
  console.log('    site skip(speaker N/A)   <=> script BREAK');
} else {
  for (const x of dis) console.log('  ' + JSON.stringify(x));
}
check('no disagreement on the real fixture', dis.length, 0);

// The dangerous direction, stated explicitly: is any dropdown-offered date shown
// by the site as a talk?
const bad = rows.filter(x => x.offered === 'YES' && x.site === 'UPCOMING');
check('no date is both offered AND rendered as a talk', bad.length, 0);
// ...and the converse: is any future booked talk missing from the site?
const missing = rows.filter(x => x.script === 'TAKEN' && x.site !== 'UPCOMING' &&
                                 x.key > '2026-08-08');
check('no future booked talk missing from the site', missing.map(x => x.key), []);

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. ATTACK: rename the Speaker header. Site falls back to index 2; Code.gs
 *    resolves by name and throws.
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== 3. ATTACK: Speaker column renamed ("Speaker" -> "Presenter") ===');
{
  const mut = JSON.parse(JSON.stringify(GV));
  const si = mut.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'speaker');
  console.log('  Speaker is column index ' + si + '; header at index 2 is ' +
              JSON.stringify(mut.table.cols[2].label));
  mut.table.cols[si].label = 'Presenter';

  // --- site ---
  const p2 = W.parseGviz(gvizText(mut));
  const c2 = W.resolveCols(p2.cols);
  console.log('  site resolveCols -> ' + JSON.stringify(c2) + '   (speaker fell back to ' + c2.speaker + ')');
  const up2 = W.collectUpcoming(p2, NOW);
  console.log('  site now renders ' + up2.length + ' "seminars"; first three speakers: ' +
              JSON.stringify(up2.slice(0, 3).map(u => iso(u.date) + ' -> ' + u.speaker)));

  // --- script ---
  let err = null;
  try { loadCodeGs(valuesFromGviz(mut)).openSchedule_(); }
  catch (e) { err = e.message; }
  console.log('  script openSchedule_ threw: ' + JSON.stringify(err));

  // REGRESSION GUARD. resolveCols used to fall back to fixed indices, and index 2
  // in this sheet is "TIme" — so renaming the Speaker header made the home page
  // announce that all 31 future weeks were booked by a speaker named
  // "4:30pm - 6:00pm" (break weeks and 26 free slots included) while the sign-up
  // form went on offering six of those dates. The widget now fails closed exactly
  // where Code.gs does, leaving the build-time static fallback markup in place.
  check('site no longer guesses a speaker column', c2.speaker, -1);
  check('site renders NOTHING rather than something wrong', up2.length, 0);
  check('script refuses to run', /missing column 'speaker'/.test(String(err)), true);

  const freeButRendered = up2
    .map(u => iso(u.date))
    .filter(k => rows.some(x => x.key === k && x.offered === 'YES'));
  console.log('  dates the site shows as TAKEN that the dropdown still offers as FREE: ' +
              JSON.stringify(freeButRendered));
  check('site and dropdown can no longer contradict each other', freeButRendered.length, 0);

  // The mirror case: rename Date instead. The site's fallback (index 0) happens
  // to be right today, so the site keeps working while the script is dead.
  const mutD = JSON.parse(JSON.stringify(GV));
  const dj = mutD.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'date');
  mutD.table.cols[dj].label = 'Seminar date';
  const pD = W.parseGviz(gvizText(mutD));
  const upD = W.collectUpcoming(pD, NOW);
  let errD = null;
  try { loadCodeGs(valuesFromGviz(mutD)).openSchedule_(); } catch (e) { errD = e.message; }
  console.log('  ["Date" -> "Seminar date"]  site: resolveCols -> date=' +
              W.resolveCols(pD.cols).date + ', renders ' + upD.length +
              ' seminars unchanged;  script: ' + JSON.stringify(String(errD).slice(0, 60)) + '...');
  // Date has no positional fallback any more either: the old idx.date = 0 was a
  // coin flip that happened to land right on this sheet.
  check('Date rename: site fails closed too', upD.length, 0);
  check('Date rename: script dead', /missing column 'date'/.test(String(errD)), true);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. ATTACK: a Date cell retyped as text (Code.gs's coerceDate_ documents this
 *    exact case). The widget has no text branch at all.
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== 4. ATTACK: one Date cell stored as TEXT ("17 August") ===');
{
  const mut = JSON.parse(JSON.stringify(GV));
  const di = mut.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'date');
  let hit = -1;
  for (let i = 0; i < mut.table.rows.length; i++) {
    const c = mut.table.rows[i].c[di];
    if (c && /^Date\(2026,7,17\)/.test(String(c.v))) { hit = i; break; }
  }
  check('found the 17 Aug row', hit >= 0, true);
  mut.table.rows[hit].c[di] = { v: '17 August', f: '17 August' };   // text, no year

  const p3 = W.parseGviz(gvizText(mut));
  const up3 = W.collectUpcoming(p3, NOW).map(u => iso(u.date) + ' ' + u.speaker);
  console.log('  site upcoming after mutation: ' + JSON.stringify(up3.slice(0, 4)));
  const stillThere = up3.some(s => s.indexOf('You-Chiuan Chen') >= 0);

  const g3 = loadCodeGs(valuesFromGviz(mut));
  const ctx3 = g3.openSchedule_();
  const st3 = g3.slotState_(ctx3, '2026-08-17', NOW);
  console.log('  script slotState_(2026-08-17) = ' + st3.state + ' / speaker=' + JSON.stringify(st3.speaker));

  // REGRESSION GUARD. cellDate used to understand only the gviz "Date(y,m,d)"
  // serialization, so retyping one cell silently deleted a BOOKED talk from the
  // card and promoted the following week to "Next", with no error anywhere.
  // Code.gs has had a text branch for this since day one; the widget now mirrors
  // it, including the year-from-Day-of-Week trick.
  check('site now reads the text date and keeps the talk', stillThere, true);
  check('script still resolves it as TAKEN', st3.state, 'TAKEN');

  // Same mutation on a FREE row: does the dropdown still offer a date the site
  // can never display?
  const mut2 = JSON.parse(JSON.stringify(GV));
  let hit2 = -1;
  for (let i = 0; i < mut2.table.rows.length; i++) {
    const c = mut2.table.rows[i].c[di];
    if (c && /^Date\(2026,8,14\)/.test(String(c.v))) { hit2 = i; break; }
  }
  if (hit2 >= 0) {
    mut2.table.rows[hit2].c[di] = { v: '14 September', f: '14 September' };
    const g4 = loadCodeGs(valuesFromGviz(mut2));
    const ctx4 = g4.openSchedule_();
    console.log('  script slotState_(2026-09-14) with a TEXT date = ' +
                g4.slotState_(ctx4, '2026-09-14', NOW).state +
                '  (still offered in the dropdown)');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. ATTACK: duplicated date row. isFreeSlot_ is per-row; findRowByDate_ is
 *    whole-sheet. Does the dropdown offer a date that can never be approved?
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== 5. ATTACK: the same free date appearing on two rows ===');
{
  const mut = JSON.parse(JSON.stringify(GV));
  const di = mut.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'date');
  let src = -1;
  for (let i = 0; i < mut.table.rows.length; i++) {
    const c = mut.table.rows[i].c[di];
    if (c && /^Date\(2026,8,14\)/.test(String(c.v))) { src = i; break; }
  }
  check('found the 14 Sep free row', src >= 0, true);
  mut.table.rows.splice(src + 1, 0, JSON.parse(JSON.stringify(mut.table.rows[src])));

  const g5 = loadCodeGs(valuesFromGviz(mut));
  const ctx5 = g5.openSchedule_();
  const v5 = valuesFromGviz(mut);
  let offeredTwice = 0;
  for (let r = 1; r < v5.length; r++) {
    if (!g5.isFreeSlot_(v5[r], ctx5.col, ctx5.tz, NOW)) continue;
    const d = g5.coerceDate_(v5[r][ctx5.col.date], ctx5.tz, '');
    if (g5.dayKey_(d, ctx5.tz) === '2026-09-14' && d.getTime() - NOW.getTime() >= leadMs) offeredTwice++;
  }
  const st5 = g5.slotState_(ctx5, '2026-09-14', NOW).state;
  console.log('  refreshFormDates_ would emit ' + offeredTwice + ' dropdown option(s) for 2026-09-14');
  console.log('  slotState_(2026-09-14) at approval time = ' + st5);
  // isFreeSlot_ is per-ROW and stays that way; the de-duplication that keeps the
  // dropdown from advertising an unapprovable date happens in refreshFormDates_,
  // guarded end-to-end in attack-dropdown.js §6b.
  check('both duplicate rows are still row-level free', offeredTwice, 2);
  check('and approval sees AMBIGUOUS', st5, 'AMBIGUOUS');

  const p5 = W.parseGviz(gvizText(mut));
  console.log('  site: free rows are invisible either way -> renders ' +
              W.collectUpcoming(p5, NOW).length + ' seminars (unchanged)');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. ATTACK: speaker-cell spellings on the "" / "N/A" boundary.
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== 6. speaker-cell spellings: does "free" mean the same thing? ===');
{
  const di = GV.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'date');
  const si = GV.table.cols.findIndex(c => String(c.label).trim().toLowerCase() === 'speaker');
  let target = -1;
  for (let i = 0; i < GV.table.rows.length; i++) {
    const c = GV.table.rows[i].c[di];
    if (c && /^Date\(2026,8,14\)/.test(String(c.v))) { target = i; break; }
  }
  const cases = ['', ' ', '  ', '\u00A0', '\t',
                 'N/A', 'n/a', ' N/A ', 'N/A.', 'TBD', 'TBA', '-', '?', 'Ada Lovelace'];
  console.log('  speaker cell        SITE                SCRIPT     dropdown-offers-it');
  console.log('  ' + '-'.repeat(70));
  for (const s of cases) {
    const mut = JSON.parse(JSON.stringify(GV));
    mut.table.rows[target].c[si] = s === '' ? null : { v: s };
    const p = W.parseGviz(gvizText(mut));
    const c = W.resolveCols(p.cols);
    const sv = siteVerdict(p, c, p.rows[target], NOW);
    const v = valuesFromGviz(mut);
    const gg = loadCodeGs(v);
    const cx = gg.openSchedule_();
    const st = gg.slotState_(cx, '2026-09-14', NOW).state;
    const free = gg.isFreeSlot_(v[target + 1], cx.col, cx.tz, NOW);
    const siteStr = sv.verdict === 'upcoming' ? 'UPCOMING' : 'skip: ' + sv.why;
    console.log('  ' + pad(JSON.stringify(s), 19) + ' ' + pad(siteStr, 19) + ' ' +
                pad(st, 10) + ' ' + (free ? 'YES' : '-'));
    // The only harmful combination: site says TALK while the script says FREE.
    check('no "site=talk, script=FREE" for ' + JSON.stringify(s),
          sv.verdict === 'upcoming' && free, false);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. ATTACK: two definitions of "now" — visitor clock vs sheet timezone.
 *    Real child processes, real TZ env, same absolute instant.
 * ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== 7. "now": VISITOR clock (site) vs SHEET timezone (script) ===');
{
  // 2026-08-16 21:00 EDT — the 17 Aug talk is genuinely ~19 h away.
  const instant = new Date(Date.UTC(2026, 7, 17, 1, 0, 0)).toISOString();
  console.log('  absolute instant: ' + instant + '  (= 2026-08-16 21:00 America/New_York)');

  const runSite = tz => JSON.parse(execFileSync(
    process.execPath, [__filename, '--site-only', instant],
    { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' }));

  const tzs = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Pacific/Auckland'];
  const seen = {};
  for (const tz of tzs) {
    const o = runSite(tz);
    seen[tz] = o;
    console.log('  visitor in ' + pad(tz, 20) + ' local date ' + o.localDate +
                ' -> next card: ' + (o.upcoming[0] || '(none)') + '   [' + o.upcoming.length + ' shown]');
  }

  // The script's own view at that same instant, in the sheet's timezone.
  const nowNY = new Date(instant);
  const st = g.slotState_(ctx, '2026-08-17', nowNY);
  console.log('  script slotState_(2026-08-17) at that instant = ' + st.state +
              ' (speaker ' + JSON.stringify(st.speaker) + ')');
  const isFree17 = (() => {
    for (let r = 1; r < values.length; r++) {
      const d = g.coerceDate_(values[r][ctx.col.date], ctx.tz, '');
      if (d && g.dayKey_(d, ctx.tz) === '2026-08-17') {
        return g.isFreeSlot_(values[r], ctx.col, ctx.tz, nowNY);
      }
    }
    return null;
  })();
  console.log('  script isFreeSlot_(17 Aug row) = ' + isFree17);

  // REGRESSION GUARD. collectUpcoming used to build "today" from the VISITOR's
  // clock while Code.gs keys everything in the SPREADSHEET's timezone. At 21:00 ET
  // on the 16th, a reader in London/Tokyo/Auckland was already on the 17th and the
  // card dropped that evening's talk ~19 hours early. The card now tracks the
  // seminar's own timezone, so every visitor sees the same thing at the same
  // instant — which is also what the script sees.
  const firsts = Object.keys(seen).map(z => seen[z].upcoming[0] || '');
  const allAgree = firsts.every(f => f === firsts[0]);
  check('every visitor timezone sees the SAME next talk', allAgree, true);
  check('and it is the 17 Aug talk the script still calls TAKEN',
        /2026-08-17/.test(firsts[0]), true);
  check('script agrees the slot is not free', isFree17, false);
  console.log('  => the card is anchored to the seminar\'s timezone, so the visitor\'s');
  console.log('     clock no longer decides which talk is "Next".');
}

/* ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + '='.repeat(70));
if (fail) {
  console.log(`ATTACK RESULT: ${pass} expectations held, ${fail} did NOT\n`);
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log(`ATTACK RESULT: all ${pass} expectations held.`);
