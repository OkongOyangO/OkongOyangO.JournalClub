/**
 * test/run-all.js — the whole suite, one command, one exit code.
 *
 *   node test/run-all.js            (add -v to stream each suite's full output)
 *
 * Runs the core harness plus the four adversarial suites, each in its own child
 * process so a crash in one cannot take the others with it, and exits non-zero if
 * ANY of them fails. Every check in here is a regression guard: each suite began
 * life as an attack that found something, and the assertions were rewritten to
 * demand the fixed behaviour once the defect was closed.
 *
 * WHY THE TIMEZONE SWEEP. The system's whole job is turning a spreadsheet cell
 * into a calendar day, and the two dangerous "now"s — the SCRIPT's timezone and
 * the SPREADSHEET's — are different settings that are only equal by convention.
 * The harness is timezone-independent by construction (test/lib.js builds fixture
 * dates at true midnight in the sheet's tz), so running it under hostile host
 * timezones is a cheap, real check that no new code has started reading dates in
 * the host's zone. Pacific/Kiritimati is UTC+14 and Pacific/Midway is UTC-11, so
 * between them they bracket every offset a real machine can have.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const VERBOSE = process.argv.indexOf('-v') >= 0 || process.argv.indexOf('--verbose') >= 0;

// The sheet's own timezone. Suites are pinned to it so their output is stable and
// comparable to what the real Apps Script project sees.
const SHEET_TZ = 'America/New_York';

const SUITES = [
  ['harness.js',           'core read-only schedule logic'],
  ['attack-dates.js',      'dates, timezones, DST, year boundaries, LEAD_DAYS'],
  ['attack-dropdown.js',   'Form dropdown sync (refreshFormDates_)'],
  ['attack-approval.js',   'the approval path end to end (mutating)'],
  ['attack-agreement.js',  'website widget vs Apps Script: same rows, same verdict'],
];

// The harness must give identical results in any host timezone. These bracket the
// real range: UTC+14 down to UTC-11.
const TZ_SWEEP = [SHEET_TZ, 'UTC', 'Europe/London', 'Asia/Tokyo',
                  'Pacific/Kiritimati', 'Pacific/Midway'];

function run(file, tz) {
  const r = spawnSync(process.execPath, [path.join(HERE, file)], {
    env: Object.assign({}, process.env, { TZ: tz }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  return { ok: r.status === 0, code: r.status, out: out };
}

/** Last non-empty line — every suite ends with its own verdict line. */
function verdict(out) {
  const lines = out.split('\n').map(s => s.trimEnd()).filter(s => s.trim() !== '');
  return lines.length ? lines[lines.length - 1].trim() : '(no output)';
}

let failed = 0;
console.log('\n' + '='.repeat(74));
console.log('  Journal Club sign-up system — full test suite   (TZ=' + SHEET_TZ + ')');
console.log('='.repeat(74));

for (const [file, what] of SUITES) {
  const r = run(file, SHEET_TZ);
  if (VERBOSE) { console.log('\n' + '─'.repeat(74) + '\n' + file + '\n' + '─'.repeat(74)); console.log(r.out); }
  console.log(`\n  ${r.ok ? 'PASS' : 'FAIL'}  ${file.padEnd(22)} ${what}`);
  console.log(`        ${verdict(r.out)}`);
  if (!r.ok) {
    failed++;
    if (!VERBOSE) {
      // Enough of the tail to identify the regression without -v.
      const tail = r.out.split('\n').slice(-40).join('\n');
      console.log('\n' + tail.replace(/^/gm, '      '));
    }
  }
}

console.log('\n' + '-'.repeat(74));
console.log('  host-timezone sweep — harness.js must be identical everywhere');
console.log('-'.repeat(74));
for (const tz of TZ_SWEEP) {
  const r = run('harness.js', tz);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  TZ=${tz.padEnd(20)} ${verdict(r.out)}`);
  if (!r.ok) { failed++; }
}

console.log('\n' + '='.repeat(74));
if (failed) {
  console.log(`  FAILED — ${failed} suite run(s) did not pass. Re-run with -v for full output.`);
  process.exit(1);
}
console.log('  ALL GREEN');
process.exit(0);
