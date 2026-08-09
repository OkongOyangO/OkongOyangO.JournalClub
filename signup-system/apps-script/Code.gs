/**
 * ============================================================================
 *  JC Signup Bot — approval-gated speaker sign-up for the Penn State
 *  condensed-matter-theory Journal Club.
 *
 *  Project type : STANDALONE Apps Script project (script.google.com), V8 runtime,
 *                 timezone America/New_York.  It must NOT be container-bound to
 *                 either spreadsheet: LockService locks are PROJECT-scoped, and
 *                 splitting the submit handler, the web app and the nightly job
 *                 across two projects would silently disable all locking.
 *
 *  ---------------------------------------------------------------------------
 *  THE FLOW
 *  ---------------------------------------------------------------------------
 *   1. A visitor fills the public Google Form. Google writes a row into the
 *      PRIVATE responses spreadsheet (A3).
 *   2. `onSignupSubmit` (installable on-form-submit trigger, bound to A3) mints a
 *      UUID token, stamps the row PENDING, reads the PUBLIC schedule (A1)
 *      read-only to report the slot's current state, and emails Yiyang two links:
 *          {EXEC_URL}?t={token}&a=approve
 *          {EXEC_URL}?t={token}&a=reject
 *   3. `doGet` renders a REVIEW page.  It performs ZERO writes — no cell, no
 *      property, no cache.  See "H2" below; this is the whole point.
 *   4. `doPost` — reached only when a human presses the confirm button on that
 *      review page — is the ONLY mutating request.  Under a script lock it
 *      re-reads the schedule, re-validates that the slot is still free, and
 *      writes Speaker / Affiliation / Advisor / Topic (and Room, only if blank)
 *      into the single matching row.
 *   5. The public site's Upcoming Seminars widget reads A1 client-side, so the
 *      talk appears on the next page load. No Hugo rebuild, no deploy.
 *   6. `nightlyMaintenance` (time-driven, ~04:00 ET) refreshes the Form's date
 *      dropdown from genuinely-free slots, expires stale PENDING rows, verifies
 *      the setup, and alarms if the private responses file has become shared.
 *      It emails Yiyang ONLY when something is wrong.
 *
 *  ---------------------------------------------------------------------------
 *  SECURITY MODEL — the five things that actually matter
 *  ---------------------------------------------------------------------------
 *  H1  The web app is deployed "Execute as: Me" + "Who has access: Anyone".
 *      It has to be: a visitor holds no rights to either spreadsheet, so
 *      "Execute as: User accessing" cannot work.  Consequence: doGet/doPost are
 *      world-callable and THE TOKEN IS THE ONLY AUTHENTICATION.  Everything else
 *      below exists to make the blast radius of a leaked token trivial.
 *
 *  H2  EMAIL LINK PREFETCH is the headline threat.  Gmail, Outlook, Microsoft
 *      Safe Links and university mail scanners routinely issue GET requests
 *      against URLs found in mail bodies.  A bare `GET ...&a=approve` that
 *      mutated state would AUTO-APPROVE every submission with no human involved.
 *      Hence the two-step design: GET only renders; POST mutates.  The POST
 *      carries a short-lived stateless HMAC nonce minted by the GET, so a POST
 *      cannot be manufactured by a scanner that only follows links.
 *      NOTE the nonce adds ZERO authorization strength — anyone holding the
 *      token can GET the page themselves and read a valid nonce off it.  Its one
 *      and only job is "a POST cannot be produced by an automated GET".
 *
 *  H3  DOUBLE BOOKING.  Two people may request the same date; both sit PENDING.
 *      The slot state captured at submit time is INFORMATIONAL ONLY and may be
 *      weeks stale.  The authoritative gate is `isFreeSlot_` re-evaluated on
 *      values read INSIDE the script lock, immediately before the write.  A lost
 *      race does NOT consume the token — the row stays PENDING so Yiyang can
 *      reject it or retry after fixing the sheet.
 *
 *  H4  DATES CARRY NO YEAR in the schedule's display format ("24 August"), but
 *      column A is genuinely date-typed, so `getValues()` hands back real Date
 *      objects with real years.  All matching is done on a `yyyy-MM-dd` key
 *      produced by `Utilities.formatDate(d, SPREADSHEET_TIMEZONE, ...)`.
 *      Never `d.toISOString()` — that is UTC and shifts a midnight-local date
 *      onto the adjacent calendar day.
 *
 *  H5  COLUMNS ARE RESOLVED BY HEADER NAME, never by position, and the matcher
 *      is deliberately tolerant: the live schedule's header really is spelled
 *      "TIme", and the sheet has grown columns before.  For the SCHEDULE there
 *      is NO positional fallback — a drifted schema hard-fails with an alert,
 *      because guessing would write a speaker's name into the Advisor column.
 *
 *  H6  PRIVACY.  The schedule spreadsheet is public and — because Google Sheets
 *      sharing is FILE-level — every tab in it is public.  The Form's responses
 *      therefore live in a SEPARATE spreadsheet that is never shared with
 *      anyone.  This is enforced, not merely reported: `openResponsesSheet_`
 *      THROWS if RESPONSES_SS_ID ever equals SCHEDULE_SS_ID, so a
 *      misconfiguration writes nothing rather than publishing the queue.
 *      `assertResponsesPrivate_` then re-checks nightly for all three ways the
 *      file can leak — link sharing, per-person sharing, and Publish-to-web
 *      (which is invisible to the sharing ACL and is caught by an anonymous
 *      fetch of the file's own gviz endpoint).
 *
 *  H7  AVAILABILITY OF THE ALARM CHANNEL.  Every alarm in this system travels by
 *      MailApp, and MailApp is the one resource an anonymous stranger can drain
 *      through a public form.  So: owner alerts reserve the bottom of the quota
 *      (MAIL_OWNER_QUOTA_FLOOR), an alert that still cannot be sent is persisted
 *      and prepended to the next one that gets through, and individual sign-up
 *      notifications are capped per day (MAX_NOTIFY_PER_DAY) so submission count
 *      can never drive send count.  Without those three, ~100 spam submissions
 *      silence the system indefinitely, and the silence is indistinguishable
 *      from "nobody signed up this week".
 *
 *  Blast radius of a fully compromised token: one row of an already-public
 *  spreadsheet, one email to one person, reversible by hand in ten seconds
 *  (the row number is recorded in `JC Schedule Row`).
 *
 *  ---------------------------------------------------------------------------
 *  SETUP — THE SETUP GUIDE (SIGNUP_SETUP.md) IS THE SINGLE SOURCE OF TRUTH.
 *  Do not configure anything by editing this file. All configuration lives in
 *  Project Settings > Script Properties; the CONFIG block below only supplies a
 *  default for a property that has never been set. Order of operations, in
 *  brief (the guide has the click-by-click version):
 *      Part D. Enter the Script Properties.
 *      Part E. Run  installStep1_bootstrap()   -> generates the secrets, adds
 *                                                 the admin columns, verifies.
 *      Part F. Deploy > New deployment > Web app (Execute as ME, access ANYONE).
 *      Part G. Add the /exec URL as the EXEC_URL Script Property.
 *      Part H. Run  installStep2_triggers()    -> installs exactly two triggers.
 *      Part I. Run  refreshFormDates()         -> fills the date dropdown.
 *      Part J. Run  verifySetup()              -> must report clean.
 *
 *  MANIFEST: appsscript.json pins the OAuth scopes explicitly (least privilege).
 *  It is a SECOND FILE you have to paste: in the Apps Script editor it is hidden
 *  until you tick Project Settings > "Show 'appsscript.json' manifest file in
 *  editor". SIGNUP_SETUP.md Part C walks through it.
 *  If an authorization error ever names a scope that is not in that list, the
 *  quickest fix is to delete the whole "oauthScopes" array and re-run a function
 *  — Apps Script then auto-detects scopes, at the cost of asking for more than
 *  it strictly needs. The one scope most likely to need widening is
 *  drive.readonly -> drive, for the sharing check in assertResponsesPrivate_.
 *
 *  REDEPLOY RULE, and it matters: to ship a code change always use
 *      Deploy > Manage deployments > (pencil) Edit > Version: New version > Deploy
 *  NEVER "Deploy > New deployment" again.  That mints a new deployment id and a
 *  NEW /exec URL, silently orphaning every approve link already sitting in
 *  Yiyang's inbox.
 * ============================================================================
 */


/* ═══════════════════════════════════════════════════════════════════════════
 *  CONFIG  —  DEFAULTS ONLY.  YOU DO NOT NEED TO EDIT THIS BLOCK.
 *  ═══════════════════════════════════════════════════════════════════════════
 *
 *  Script Properties are the runtime source of truth (so that secrets and ids
 *  never have to be read out of the source), and the setup guide's Part D is
 *  where you enter them.  This block exists only so the script has sane
 *  defaults before that happens.
 *
 *    * A Script Property that EXISTS always wins at read time — even when it is
 *      blank.  That is what lets you switch DEFAULT_ROOM off by setting it to
 *      an empty string in the Script Properties UI.
 *    * CONFIG is used at read time only when the corresponding property has
 *      never been set.
 *    * `installStep1_bootstrap()` seeds a property from CONFIG ONLY when that
 *      property does not exist yet.  It NEVER overwrites a value you typed —
 *      re-running it is genuinely harmless.  If a property disagrees with
 *      CONFIG, bootstrap reports the difference and leaves your value alone.
 */
var CONFIG = {

  // ── Already known — no need to change these ────────────────────────────────

  /** The PUBLIC Journal Club schedule spreadsheet (artifact A1). */
  SCHEDULE_SS_ID: '1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4',

  /** gid of the schedule tab. The only tab today is gid 0. Resolution falls back
   *  to the first tab if this gid no longer exists, and then hard-fails on the
   *  header check if that first tab is not the schedule. */
  SCHEDULE_TAB_GID: '0',

  /** Where approval notifications go. */
  NOTIFY_EMAIL: 'jiangyiyang2019@gmail.com',

  // ── YOU MUST FILL THESE IN ────────────────────────────────────────────────

  /** The PRIVATE responses spreadsheet (artifact A3), created by
   *  Form > Responses > Link to Sheets > CREATE A NEW SPREADSHEET.
   *  MUST NOT be a tab inside SCHEDULE_SS_ID: sharing is file-level, so a tab in
   *  the public file would publish every submitter's email address.
   *  Id is the long string in .../spreadsheets/d/<THIS>/edit */
  RESPONSES_SS_ID: '',

  /** Tab name inside A3. Google's default for the first linked form. */
  RESPONSES_TAB_NAME: 'Form Responses 1',

  /** The Google Form's EDIT id, from https://docs.google.com/forms/d/<THIS>/edit
   *  NOT the responder id in .../forms/d/e/<LONG>/viewform — different strings. */
  FORM_EDIT_ID: '',

  /** The deployed web app URL. Left blank on purpose: it is entered as the
   *  EXEC_URL Script Property in Part G of the setup guide, after the first
   *  deployment mints it.
   *  It must end in /exec — a /dev URL only opens for script editors, so an
   *  emailed /dev link is unusable.
   *  Deliberately NOT derived from ScriptApp.getService().getUrl(): under V8
   *  that returns the /dev URL when the head deployment executes
   *  (issuetracker.google.com/170799249, won't-fix). */
  EXEC_URL: '',

  // ── Tunables ──────────────────────────────────────────────────────────────

  /** Written into the schedule's Room cell ONLY when that cell is currently
   *  empty. To never touch Room, set the DEFAULT_ROOM Script Property to an
   *  empty value — bootstrap will not put this default back. */
  DEFAULT_ROOM: 'Davey 339',

  /** Dates fewer than this many days out are not OFFERED in the form dropdown.
   *  Deliberately NOT applied when re-validating an approval: Yiyang may
   *  legitimately approve a request for next Monday. */
  LEAD_DAYS: '7',

  /** Cap on dropdown options, so the form stays usable. */
  MAX_CHOICES: '30'
};


/* ═══════════════════════════════════════════════════════════════════════════
 *  CONSTANTS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Admin columns appended to the RIGHT of Google's form-owned block in A3.
 *  Every one is prefixed "JC " so it can never collide with a question title,
 *  and every read resolves by header name, so Forms inserting a column for a new
 *  question just shifts them harmlessly. */
var ADMIN = {
  TOKEN:      'JC Token',
  STATUS:     'JC Status',
  DATE_KEY:   'JC Date Key',
  DECIDED_AT: 'JC Decided At',
  NOTE:       'JC Decision Note',
  SCHED_ROW:  'JC Schedule Row',
  NOTIFIED:   'JC Notified'
};
var ADMIN_ORDER = [
  ADMIN.TOKEN, ADMIN.STATUS, ADMIN.DATE_KEY, ADMIN.DECIDED_AT,
  ADMIN.NOTE, ADMIN.SCHED_ROW, ADMIN.NOTIFIED
];

/** Schedule columns. `date` and `speaker` are load-bearing; everything else is
 *  decoration we read but never require. Names are already normalized (lower
 *  case, collapsed whitespace) — note "TIme" normalizes to "time". */
var REQUIRED_SCHEDULE_COLS = ['date', 'speaker'];

/** Question titles -> normalized aliases, first match wins.  The spec fixes the
 *  exact titles; the aliases are cheap insurance against Yiyang lightly
 *  rewording a question later.  `speaker` and `date` are hard-required and
 *  verifySetup() fails loudly if they cannot be resolved. */
var QUESTION_ALIASES = {
  speaker:     ['speaker name', 'speaker', 'presenter', 'presenter name'],
  affiliation: ['affiliation', 'institution', 'department or institution'],
  advisor:     ['advisor', 'adviser', 'supervisor'],
  date:        ['preferred date', 'preferred date to present', 'requested date'],
  title:       ['talk title', 'title of talk', 'talk topic'],
  abstract:    ['abstract or short description', 'abstract', 'short description'],
  alternates:  ['other dates that would also work', 'other dates', 'alternate dates'],
  notes:       ['anything else yiyang should know?', 'anything else yiyang should know', 'anything else', 'notes']
};

/** Header Google uses for the collected email address. It varies with the age of
 *  the form ("Username" on very old ones), hence the list. */
var EMAIL_ALIASES = ['email address', 'email', 'e-mail address', 'e-mail', 'username'];

/** Nonce validity bucket. A POST is accepted if its nonce matches the current
 *  bucket or the previous one, so the real window is 30–60 minutes. Long enough
 *  that Yiyang can leave the review page open over lunch; short enough that a
 *  nonce scraped from a forwarded screenshot is useless tomorrow. */
var NONCE_BUCKET_MS = 30 * 60 * 1000;

/** How long a PENDING row may sit before the nightly job gives up on it. */
var PENDING_MAX_AGE_DAYS = 45;

/** Below this many remaining MailApp recipients we stop sending rather than
 *  throw mid-flow. Consumer Gmail allows 100/day (1500 is Workspace only), so a
 *  spam burst really can exhaust it. */
var MAIL_QUOTA_FLOOR = 5;

/** Owner ALARMS get their own, much lower floor, so the last few sends of the
 *  day always go to "something is wrong" rather than to routine traffic.
 *  Without this the detector and the failure share a single point of failure:
 *  the nightly report that says "notifications are being dropped for quota" is
 *  itself dropped for quota, and the blackout is invisible. */
var MAIL_OWNER_QUOTA_FLOOR = 1;

/** Hard cap on INDIVIDUAL sign-up notification emails per calendar day. Past
 *  this, one digest alert is sent and further submissions are recorded as
 *  `JC Notified = CAPPED` for the nightly job to surface. This is what makes
 *  the mail quota un-exhaustible by form traffic: submission count can no
 *  longer drive send count. */
var MAX_NOTIFY_PER_DAY = 20;

/** A PENDING row older than this many days is nagged about nightly. Silence is
 *  otherwise indistinguishable from "nobody signed up". */
var PENDING_NAG_DAYS = 7;

var STATUS = {
  PENDING:  'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED:  'EXPIRED',
  ERROR:    'ERROR'
};

var PUBLIC_SITE_URL = 'https://OkongOyangO.github.io/OkongOyangO.JournalClub/';
var ORGANIZER_FALLBACK_EMAIL = 'yzj5306@psu.edu';


/* ═══════════════════════════════════════════════════════════════════════════
 *  CONFIGURATION ACCESS
 * ═══════════════════════════════════════════════════════════════════════════ */

function getProps_() {
  return PropertiesService.getScriptProperties();
}

/**
 * Read a configuration value.
 * A property that EXISTS wins even when blank — that is what makes
 * `DEFAULT_ROOM = ""` (meaning "never touch Room") expressible. CONFIG is the
 * fallback only when the property has never been written at all.
 */
function getProp_(key) {
  var v = getProps_().getProperty(key);
  if (v === null || v === undefined) {
    v = Object.prototype.hasOwnProperty.call(CONFIG, key) ? CONFIG[key] : '';
  }
  return (v === null || v === undefined) ? '' : String(v);
}

/** Same, but blank is fatal. Used for ids without which nothing can work. */
function requireProp_(key) {
  var v = getProp_(key).trim();
  if (v === '') {
    throw new Error(
      'Configuration missing: ' + key + '. Fill it in the CONFIG block at the top ' +
      'of Code.gs and re-run installStep1_bootstrap(), or set it under ' +
      'Project Settings > Script Properties.');
  }
  return v;
}

function getNumProp_(key, dflt) {
  var n = parseInt(getProp_(key), 10);
  return isNaN(n) ? dflt : n;
}

/** The /exec URL, validated. A /dev URL here would produce emails whose links
 *  only work for script editors, which is a silent, confusing failure. */
function requireExecUrl_() {
  var url = requireProp_('EXEC_URL');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    throw new Error(
      'EXEC_URL does not look like a deployed web app URL: "' + url + '". ' +
      'It must end in /exec (a /dev URL only opens for script editors). Copy it ' +
      'from Deploy > Manage deployments.');
  }
  return url;
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  NORMALIZATION, DATES, SANITIZATION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normalize a header cell for name-based lookup.
 * U+00A0 is stripped first: Sheets headers pasted from a doc or a browser very
 * often contain non-breaking spaces, which `trim()` alone does not remove, and
 * the resulting lookup miss looks exactly like "column deleted".
 * "TIme" -> "time";  "Day of Week" -> "day of week".
 */
function normHeader_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a data cell. Date objects are returned UNCHANGED — the schedule's
 * date column is genuinely date-typed and we must not stringify away the year.
 * Everything else becomes a trimmed string.
 */
function normCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') { return v; }
  return String(v === null || v === undefined ? '' : v).replace(/\u00A0/g, ' ').trim();
}

/**
 * The canonical calendar-day key.
 * MUST be Utilities.formatDate with the SPREADSHEET's timezone. `toISOString()`
 * is UTC, so a cell holding local midnight of 14 September would key as
 * 13 September and match the wrong week — or no week at all.
 */
function dayKey_(d, tz) {
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

var MONTH_NAMES_ = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11
};

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/**
 * Build a Date that lands on the calendar day y/mon/day **in `tz`** — the
 * SPREADSHEET's timezone, which is the only timezone this system keys dates in.
 *
 * WHY THIS EXISTS. `new Date(y, mon, day)` is midnight in the timezone of the
 * host running the code — for Apps Script that is the SCRIPT project's tz, which
 * is a different setting from the spreadsheet's and is NOT guaranteed to match
 * (a project created outside the US defaults to something else entirely).
 * `dayKey_` then formats the result in the SHEET's tz. If the script tz is east
 * of the sheet's, script-midnight is still the PREVIOUS calendar day in the
 * sheet's tz, and every text-typed schedule row keys one day early: the form
 * offers a date whose ISO prefix and human half disagree, and the speaker is
 * emailed the wrong day for their own talk. Verified: with the Date column
 * retyped as text and the script on UTC, the row reading 2026-09-14 answered to
 * the key 2026-09-13.
 *
 * The construction is anchored at UTC noon and then corrected by at most one
 * day, which is exact for every real zone (offsets run −12h..+14h).
 *
 * It ALSO validates: JS rolls impossible components over silently, so
 * `new Date(2026, 1, 29)` is 1 March. Here the round-trip through `dayKey_`
 * cannot match, so 2026-02-29 returns null instead of quietly re-homing that
 * cell onto a neighbouring real day that an approval could then be written into.
 */
function dateInTz_(y, mon, day, tz) {
  if (!(y >= 1000 && y <= 9999) || !(mon >= 0 && mon <= 11) || !(day >= 1 && day <= 31)) {
    return null;
  }
  var want = y + '-' + pad2_(mon + 1) + '-' + pad2_(day);
  var d = new Date(Date.UTC(y, mon, day, 12, 0, 0));
  var got = dayKey_(d, tz);
  if (got !== want) {
    // ISO keys compare correctly as strings, so this picks the right direction
    // for zones both east and west of UTC.
    d = new Date(d.getTime() + (got < want ? 86400000 : -86400000));
    got = dayKey_(d, tz);
  }
  return got === want ? d : null;
}

/** Shift an ISO day key by whole CALENDAR days in `tz`. Anchoring on the noon
 *  Date from dateInTz_ means a 23- or 25-hour DST day cannot slide the result
 *  into the neighbouring day the way midnight + n*86400000 does. */
function shiftDayKey_(isoKey, n, tz) {
  var m = String(isoKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { return String(isoKey); }
  var base = dateInTz_(Number(m[1]), Number(m[2]) - 1, Number(m[3]), tz);
  if (!base) { return String(isoKey); }
  return dayKey_(new Date(base.getTime() + n * 86400000), tz);
}

/**
 * Turn a schedule Date cell into a real Date.
 *
 * The happy path is trivial because the column is date-typed. The text branch
 * exists only for the case where somebody retypes a cell and Sheets stores a
 * string. In that branch there is genuinely no year, so we disambiguate using
 * the row's OWN "Day of Week" cell: across the live schedule that picks a unique
 * year (2026 matches 28 rows, 2027 the other 11). If the weekday is unusable the
 * row is UNREADABLE and we return null — see the comment at that branch.
 *
 * We deliberately do NOT reuse the website widget's "more than 200 days in the
 * past means next year" rule — it is wrong for 8 of the 39 current rows, and
 * being wrong here means writing a speaker into the wrong week.
 *
 * Every Date here is built through dateInTz_, so it is anchored to the SHEET's
 * timezone (see that function) and an impossible date returns null rather than
 * silently rolling over onto a neighbouring real day.
 */
function coerceDate_(v, tz, dowHint) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v;
  }
  var s = String(v === null || v === undefined ? '' : v).replace(/\u00A0/g, ' ').trim();
  if (s === '') { return null; }

  // ISO first — unambiguous, and what our own JC Date Key column holds.
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return dateInTz_(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), tz);
  }

  // "24 August" / "24 August 2026" / "24 Aug"
  var m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:\s+(\d{4}))?/);
  if (!m) { return null; }
  var day = parseInt(m[1], 10);
  var mon = MONTH_NAMES_[m[2].toLowerCase()];
  if (mon === undefined || !(day >= 1 && day <= 31)) { return null; }
  if (m[3]) { return dateInTz_(Number(m[3]), mon, day, tz); }

  // "This year" must also be read in the SHEET's tz, for the same reason
  // dateInTz_ exists: on 31 December a script east of the sheet is already on
  // next year, which would shift the whole candidate window.
  var nowYear = Number(dayKey_(new Date(), tz).slice(0, 4));
  var candidates = [nowYear - 1, nowYear, nowYear + 1];
  var wanted = normHeader_(dowHint || '').slice(0, 3); // "monday" -> "mon"
  var i, cand;
  if (wanted) {
    for (i = 0; i < candidates.length; i++) {
      cand = dateInTz_(candidates[i], mon, day, tz);
      if (cand && Utilities.formatDate(cand, tz, 'EEE').toLowerCase() === wanted) {
        return cand;
      }
    }
  }
  // NO USABLE WEEKDAY HINT: REFUSE, do not guess.
  //
  // "24 August" with no year and no weekday is genuinely ambiguous, and every
  // tie-break is wrong for a large slice of the real sheet. Measured against the
  // 39 live rows on 2026-08-08: "nearest year in either direction" resolves 6
  // rows into the PAST (|8 Feb 2026 - today| is 181 days, |8 Feb 2027 - today| is
  // 184, so nearest picks the year that already happened) and those weeks then
  // vanish from the form and become unapprovable; "prefer the next future year"
  // is wrong for the 7 rows that really are past and would advertise a past row
  // as a future date. There is no third heuristic that is right; the input does
  // not contain the answer.
  //
  // So return null. A null Date is the system's existing "this row is not
  // readable" signal: isFreeSlot_ drops it, findRowByDate_ skips it, and
  // unreadableDateRows_ NAMES it in the nightly report and in verifySetup_. That
  // turns an invisible wrong guess into a visible "row 21: I cannot read this
  // Date cell", which a human fixes in ten seconds. Guessing here means writing a
  // speaker onto the wrong week; refusing means telling someone to fix a cell.
  return null;
}

/**
 * Everything written into the PUBLIC schedule passes through here.
 *
 *  * Leading = + @ - are stripped. `Range.setValue("=IMPORTRANGE(...)")` creates
 *    a LIVE FORMULA in a public spreadsheet — this is the one input-handling bug
 *    in this whole system that could actually hurt. '-' is in the set for two
 *    independent reasons: Sheets applies Lotus-style coercion to a leading '-'
 *    exactly as it does to '+' (typing `-1+1` yields 0, not text), and '-' is a
 *    standard CSV/DDE-injection prefix in Excel and LibreOffice — and this
 *    spreadsheet is anonymously downloadable as CSV. The cost is that a topic
 *    genuinely starting with a hyphen loses it; that is a far better trade than
 *    a live formula on a world-readable page.
 *  * Newlines/tabs collapse to single spaces because the schedule is a
 *    one-line-per-cell display and an embedded newline silently breaks the
 *    site's rendering and the CSV feed.
 *  * Length is capped so a pathological submission cannot make the public sheet
 *    unreadable.
 */
function sanitizeForSheet_(s, maxLen) {
  s = String(s === null || s === undefined ? '' : s);
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');   // control chars incl. CR/LF/TAB
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[=+@\-]+\s*/, '');              // formula/CSV-injection guard
  if (s.length > maxLen) { s = s.slice(0, maxLen - 1).trim() + '\u2026'; }
  return s;
}

/** HTML-escape. Applied at EVERY interpolation of submitter-controlled text.
 *  These pages render in Yiyang's own session, and Speaker/Topic/Abstract are
 *  attacker-controlled, so a miss here is stored XSS. */
function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** esc_ then turn newlines into <br> — for the free-text paragraph answers. */
function escMultiline_(s) {
  return esc_(s).replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Accept an address only if it is boringly well-formed. Used before anything is
 * put in a `replyTo`/`to` header or a mailto: link — a comma, semicolon, angle
 * bracket or newline in a header is a header-injection primitive.
 */
function safeEmail_(s) {
  s = String(s === null || s === undefined ? '' : s).trim();
  return /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\]+\.[^\s@,;:<>"'\\]+$/.test(s) ? s : '';
}

// mailto_() was deleted on purpose. Its only two callers were doReject_ and
// pageBlocked_, both of which rendered a submitter's address into a page served
// to anyone holding the token — the exact thing the review page goes out of its
// way not to do. Reintroducing the helper is the easy way to reintroduce the
// leak, so the helper is gone rather than merely unused.

/** Local ISO-8601 with offset, e.g. 2026-08-12T14:31:07-04:00. Readable in the
 *  sheet and unambiguous, unlike a bare local timestamp. */
function nowStamp_() {
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  SCHEDULE SPREADSHEET (A1, PUBLIC) — read helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolve schedule columns by header name. NO POSITIONAL FALLBACK, on purpose.
 *
 * The website widget falls back to fixed positions, which is harmless when you
 * are only rendering. Here we WRITE: if the header row ever drifts, a positional
 * guess would put a speaker's name in the Advisor column of a public schedule.
 * Failing loudly and emailing Yiyang is strictly better.
 */
function resolveScheduleCols_(headerRow) {
  var col = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = normHeader_(headerRow[i]);
    // First occurrence wins, so a stray duplicate header later in the row cannot
    // hijack a column we already found.
    if (h !== '' && col[h] === undefined) { col[h] = i; }
  }
  for (var k = 0; k < REQUIRED_SCHEDULE_COLS.length; k++) {
    var name = REQUIRED_SCHEDULE_COLS[k];
    if (col[name] === undefined) {
      throw new Error(
        "Schedule schema changed: missing column '" + name + "'. Headers seen: " +
        headerRow.join(' | '));
    }
  }
  return col;
}

/**
 * Open the schedule and read it in ONE batched call.
 *
 * Batching matters: this runs inside the script lock during an approval, and a
 * per-cell getValue() loop there would risk the 30 s lock timeout.
 *
 * Tab resolution is by gid rather than by name or index, because a tab rename is
 * far more likely than a gid change. If the gid has vanished we fall back to the
 * first sheet and let resolveScheduleCols_ decide whether that was the right
 * guess — it throws if the headers do not look like the schedule.
 */
function openSchedule_() {
  var ss = SpreadsheetApp.openById(requireProp_('SCHEDULE_SS_ID'));
  var gid = getNumProp_('SCHEDULE_TAB_GID', 0);
  var sheets = ss.getSheets();
  var sheet = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) { sheet = sheets[i]; break; }
  }
  if (!sheet) { sheet = sheets[0]; }

  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0] : [];
  return {
    ss: ss,
    sheet: sheet,
    values: values,
    header: header,
    col: resolveScheduleCols_(header),
    // The SPREADSHEET's timezone, not the script's: every Date that came out of
    // getValues() must be formatted back with the tz it was interpreted in.
    tz: ss.getSpreadsheetTimeZone()
  };
}

/** A shareable link to the schedule, for the outcome pages. */
function scheduleUrl_() {
  return 'https://docs.google.com/spreadsheets/d/' + getProp_('SCHEDULE_SS_ID') + '/edit';
}

function responsesUrl_() {
  return 'https://docs.google.com/spreadsheets/d/' + getProp_('RESPONSES_SS_ID') + '/edit';
}

/**
 * Is this schedule row an open slot?
 *
 * SPEAKER IS THE ONLY DISCRIMINATOR, and that is a deliberate, verified choice:
 *   * "Topic empty means free" would be catastrophic — three currently-booked
 *     rows have an empty Topic.
 *   * "Room empty means free" would misclassify every row where Yiyang
 *     pre-filled Davey 339.
 *   * "N/A" is an intentional BREAK WEEK, not a free slot. Free means
 *     Speaker === "" exactly. (The website conflates "" and "N/A" as "not a
 *     talk"; that is fine for rendering and wrong for writing.)
 *
 * The strictly-future test excludes today: approving someone onto a slot that
 * is already happening helps nobody. LEAD_DAYS is NOT applied here — it governs
 * only what the dropdown offers.
 */
function isFreeSlot_(rowValues, col, tz, now) {
  var d = coerceDate_(rowValues[col.date], tz,
                      col['day of week'] !== undefined ? rowValues[col['day of week']] : '');
  if (d === null) { return false; }                       // spacer / blank trailing row
  var speaker = normCell_(rowValues[col.speaker]);
  if (speaker !== '') { return false; }                   // booked, or an N/A break week
  if (dayKey_(d, tz) <= dayKey_(now, tz)) { return false; } // strictly future
  return true;
}

/**
 * Locate the single schedule row for an ISO day key.
 *
 * Never compute a row index arithmetically from a date. The sheet is NOT
 * one-row-per-Monday: 13 July 2026 has no row at all, and 15 July 2026 is a
 * Wednesday row at 2:00–3:00pm. There is likewise no "first free row after the
 * last booked one" heuristic — 14 Sep is free, 21 Sep is booked, 28 Sep is free.
 */
function findRowByDate_(ctx, isoKey) {
  var hits = [];
  var dowIdx = ctx.col['day of week'];
  for (var r = 1; r < ctx.values.length; r++) {   // index 0 is the header row
    var row = ctx.values[r];
    var d = coerceDate_(row[ctx.col.date], ctx.tz, dowIdx !== undefined ? row[dowIdx] : '');
    if (d === null) { continue; }                 // trailing formatted-but-empty rows
    if (dayKey_(d, ctx.tz) === isoKey) {
      // +1 because Sheets rows are 1-indexed and values[0] is the header.
      // Get this wrong and an approval lands on the neighbouring week.
      hits.push({ sheetRow: r + 1, values: row, date: d });
    }
  }
  if (hits.length === 0) { return { status: 'NOT_IN_SCHEDULE' }; }
  if (hits.length > 1) { return { status: 'AMBIGUOUS', rows: hits }; }
  return { status: 'OK', row: hits[0] };
}

/**
 * Human-facing state of a slot: FREE / TAKEN / BREAK / PAST / NOT_IN_SCHEDULE /
 * AMBIGUOUS. Purely informational at submit time (it can be weeks stale by the
 * time Yiyang clicks); authoritative only when computed inside the lock.
 */
function slotState_(ctx, isoKey, now) {
  if (!isoKey) { return { state: 'NO_DATE' }; }
  var found = findRowByDate_(ctx, isoKey);
  if (found.status === 'NOT_IN_SCHEDULE') {
    return { state: 'NOT_IN_SCHEDULE', lastDate: lastScheduledDate_(ctx) };
  }
  if (found.status === 'AMBIGUOUS') {
    return { state: 'AMBIGUOUS', rows: found.rows };
  }
  var row = found.row;
  var speaker = String(normCell_(row.values[ctx.col.speaker]));
  var out = { row: row, sheetRow: row.sheetRow, date: row.date, speaker: speaker };
  if (speaker.toUpperCase() === 'N/A') { out.state = 'BREAK'; return out; }
  if (speaker !== '') {
    out.state = 'TAKEN';
    out.affiliation = ctx.col.affiliation !== undefined
      ? String(normCell_(row.values[ctx.col.affiliation])) : '';
    return out;
  }
  if (dayKey_(row.date, ctx.tz) <= dayKey_(now, ctx.tz)) { out.state = 'PAST'; return out; }
  out.state = 'FREE';
  return out;
}

/** Latest date present in the schedule — used to tell Yiyang "the schedule
 *  currently ends on ..." when a request falls off the end of it. */
function lastScheduledDate_(ctx) {
  var last = null;
  var dowIdx = ctx.col['day of week'];
  for (var r = 1; r < ctx.values.length; r++) {
    var d = coerceDate_(ctx.values[r][ctx.col.date], ctx.tz,
                        dowIdx !== undefined ? ctx.values[r][dowIdx] : '');
    if (d && (last === null || d.getTime() > last.getTime())) { last = d; }
  }
  return last;
}

/**
 * Sheet rows whose Date cell holds something but coerceDate_ cannot read it.
 *
 * WHY THIS IS A DETECTOR AND NOT A PARSER. Every consumer treats "cannot read
 * the date" as "not a scheduled row": isFreeSlot_ returns false, findRowByDate_
 * skips it, lastScheduledDate_ ignores it. When the WHOLE column breaks, the
 * free-slot count hits zero and both verifySetup_ and refreshFormDates_ shout.
 * But retyping three cells — a paste from a doc, a fill-down gone wrong — leaves
 * the count healthy, so nothing fires, those weeks silently stop being offered,
 * and a request already submitted for one of them is refused as "not in the
 * schedule" while the row sits visibly in the sheet. Silence was the defect;
 * naming the rows is the fix.
 */
function unreadableDateRows_(ctx) {
  var out = [];
  var dowIdx = ctx.col['day of week'];
  for (var r = 1; r < ctx.values.length; r++) {
    var raw = ctx.values[r][ctx.col.date];
    if (normCell_(raw) === '') { continue; }     // genuinely blank / spacer row
    var d = coerceDate_(raw, ctx.tz, dowIdx !== undefined ? ctx.values[r][dowIdx] : '');
    if (d === null) { out.push(r + 1); }         // +1: Sheets rows are 1-indexed
  }
  return out;
}

/**
 * A schedule cell as display text.
 *
 * normCell_ deliberately returns Date objects unchanged, which is right for the
 * date column and wrong everywhere else: typing a bare "4:30 PM" into the TIme
 * column makes Sheets store a real time value, getValues() hands back a Date at
 * the 1899-12-30 epoch, and a bare String() of that put
 * "Sat Dec 30 1899 16:30:00 GMT-0500 (Eastern Standard Time)" into both the form
 * dropdown and the speaker's confirmation email. Format in the SHEET's tz — the
 * tz the value was interpreted in — so the clock time round-trips exactly.
 */
function cellText_(v, tz) {
  var n = normCell_(v);
  if (Object.prototype.toString.call(n) === '[object Date]') {
    return isNaN(n.getTime()) ? '' : Utilities.formatDate(n, tz, 'h:mm a');
  }
  return String(n);
}

/** "Monday 14 September 2026" */
function fmtLong_(d, tz) {
  return d ? Utilities.formatDate(d, tz, 'EEEE d MMMM yyyy') : '';
}

/** "14 September" — matches the sheet's own d-mmmm display pattern. */
function fmtShort_(d, tz) {
  return d ? Utilities.formatDate(d, tz, 'd MMMM') : '';
}

/** Time and room strings for a schedule row, as plain text (may be ''). */
function rowTime_(ctx, row) {
  return ctx.col.time !== undefined ? cellText_(row.values[ctx.col.time], ctx.tz) : '';
}
function rowRoom_(ctx, row) {
  return ctx.col.room !== undefined ? cellText_(row.values[ctx.col.room], ctx.tz) : '';
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  RESPONSES SPREADSHEET (A3, PRIVATE) — read/write helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Open the PRIVATE responses sheet.
 *
 * The equality guard is the enforcement of this design's single hard
 * constraint, and it deliberately FAILS CLOSED. `verifySetup_` also reports the
 * condition, but a report is the wrong posture here: if responses were ever
 * pointed at the public schedule file, every submitter's email address and
 * every live approval token would be world-readable AND world-queryable from
 * the first submission onward, and the report itself travels by an email
 * channel that can be starved. Refusing to run writes nothing.
 */
function openResponsesSheet_() {
  var rid = requireProp_('RESPONSES_SS_ID');
  if (rid === getProp_('SCHEDULE_SS_ID').trim()) {
    throw new Error(
      'REFUSING TO RUN: RESPONSES_SS_ID equals SCHEDULE_SS_ID. The schedule file is ' +
      'PUBLIC and Google Sheets sharing is file-level, so storing responses there ' +
      "would publish every submitter's email address and every live approval token. " +
      'Create a separate, private spreadsheet for the form responses.');
  }
  var ss = SpreadsheetApp.openById(rid);
  var name = getProp_('RESPONSES_TAB_NAME').trim();
  var sheet = name ? ss.getSheetByName(name) : null;
  if (!sheet) { sheet = ss.getSheets()[0]; }   // tolerate a rename
  if (!sheet) { throw new Error('The responses spreadsheet has no sheets.'); }
  return sheet;
}

/** normalized header -> 0-based index, first occurrence wins. */
function headerMap_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = normHeader_(headerRow[i]);
    if (h !== '' && map[h] === undefined) { map[h] = i; }
  }
  return map;
}

/** First alias present in the header map, or -1. */
function resolveAlias_(map, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    if (map[aliases[i]] !== undefined) { return map[aliases[i]]; }
  }
  return -1;
}

/**
 * Resolve every column we care about in the responses sheet.
 * `admin` may contain -1s before ensureAdminColumns_ has run.
 */
function resolveResponseCols_(headerRow) {
  var map = headerMap_(headerRow);
  var q = {};
  for (var key in QUESTION_ALIASES) {
    if (Object.prototype.hasOwnProperty.call(QUESTION_ALIASES, key)) {
      q[key] = resolveAlias_(map, QUESTION_ALIASES[key]);
    }
  }
  var admin = {};
  for (var a in ADMIN) {
    if (Object.prototype.hasOwnProperty.call(ADMIN, a)) {
      var idx = map[normHeader_(ADMIN[a])];
      admin[a] = idx === undefined ? -1 : idx;
    }
  }
  return {
    header: headerRow,
    map: map,
    timestamp: map['timestamp'] === undefined ? -1 : map['timestamp'],
    email: resolveAlias_(map, EMAIL_ALIASES),
    q: q,
    admin: admin
  };
}

/**
 * Append any missing "JC " admin headers to the right of the last used column.
 * Idempotent — safe to call on every submit.
 *
 * Wrapped in the script lock because two near-simultaneous first-ever
 * submissions could otherwise both read "column missing" and both append,
 * producing duplicate headers. This is the ONLY write onSignupSubmit makes that
 * needs the lock, and it no-ops (no lock taken) once the headers exist.
 */
function ensureAdminColumns_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = headerMap_(header);

  var missing = ADMIN_ORDER.filter(function (name) {
    return map[normHeader_(name)] === undefined;
  });
  if (missing.length === 0) { return; }


  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('Could not obtain the script lock to add admin columns; try again.');
  }
  try {
    // Re-read inside the lock: another execution may have just added them.
    lastCol = Math.max(sheet.getLastColumn(), 1);
    header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    map = headerMap_(header);
    var next = lastCol + 1;
    for (var i = 0; i < ADMIN_ORDER.length; i++) {
      var name = ADMIN_ORDER[i];
      if (map[normHeader_(name)] === undefined) {
        sheet.getRange(1, next, 1, 1).setValue(name);
        map[normHeader_(name)] = next - 1;
        next++;
      }
    }
    forceAdminTextFormat_(sheet, map);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Force every admin column to PLAIN TEXT.
 *
 * This is not cosmetic. `Range.setValue('2026-09-14')` on an "Automatic"-format
 * cell is parsed exactly as if a human had typed it, so Sheets stores a DATE
 * VALUE, not the string. Two things then break at once:
 *   * `expireStalePending_` reads raw values and tests /^\d{4}-\d{2}-\d{2}$/
 *     against `String(aDate)` — which never matches, so the entire
 *     "requested date has passed" expiry rule becomes unreachable;
 *   * `getAdmin_('DATE_KEY')` reads the DISPLAY string, which in a US-locale
 *     spreadsheet renders as `9/14/2026`, so `findRowByDate_` matches nothing
 *     and EVERY approval fails with "that date is not in the schedule".
 * `JC Decided At` has the same exposure (its value is an ISO-8601 timestamp).
 *
 * Reads are also made coercion-tolerant (see `normalizeDateKey_`), so an
 * install that already has Date-typed cells keeps working.
 */
function forceAdminTextFormat_(sheet, map) {
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) { return; }
  for (var i = 0; i < ADMIN_ORDER.length; i++) {
    var idx = map[normHeader_(ADMIN_ORDER[i])];
    if (idx === undefined) { continue; }
    sheet.getRange(2, idx + 1, maxRows - 1, 1).setNumberFormat('@');
  }
}

/** Read one response row as {values, display, cols, sheet, rowIndex}. */
function readResponseRow_(sheet, rowIndex) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var range = sheet.getRange(rowIndex, 1, 1, lastCol);
  return {
    sheet: sheet,
    rowIndex: rowIndex,
    header: header,
    cols: resolveResponseCols_(header),
    // Both forms: getValues() keeps the Timestamp a real Date (needed for
    // expiry maths); getDisplayValues() gives text exactly as a human sees it.
    values: range.getValues()[0],
    display: range.getDisplayValues()[0]
  };
}

/** Locate a response row by token. Reads only the token column, so an unknown
 *  token costs one narrow range read — this endpoint is world-callable. */
function findResponseRowByToken_(sheet, token) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = resolveResponseCols_(header);
  if (cols.admin.TOKEN < 0) { return null; }          // bootstrap never ran
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return null; }                    // header only
  var tokens = sheet.getRange(2, cols.admin.TOKEN + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < tokens.length; i++) {
    if (String(tokens[i][0]).trim() === token) {
      return readResponseRow_(sheet, i + 2);           // +2: skip header, 1-index
    }
  }
  return null;
}

/** Write one admin cell by logical name. Silently skips if the column is absent,
 *  so a half-bootstrapped sheet degrades instead of throwing mid-approval. */
function setAdmin_(row, adminKey, value) {
  var idx = row.cols.admin[adminKey];
  if (idx === undefined || idx < 0) { return; }
  row.sheet.getRange(row.rowIndex, idx + 1, 1, 1).setValue(value);
}

function getAdmin_(row, adminKey) {
  var idx = row.cols.admin[adminKey];
  if (idx === undefined || idx < 0) { return ''; }
  return String(row.display[idx] === undefined ? '' : row.display[idx]).trim();
}

/**
 * Turn whatever is sitting in a JC Date Key cell into a `yyyy-MM-dd` string.
 *
 * `forceAdminTextFormat_` keeps new writes as text, but a cell written before
 * that fix (or one a human retyped) may hold a real Date. Reading the RAW value
 * and coercing here is what makes both the approval match and the expiry rule
 * independent of the spreadsheet's locale and number format.
 *
 * `tz` must be the tz the Date was interpreted in — i.e. the RESPONSES
 * spreadsheet's — otherwise a midnight-local date can key onto the day before.
 */
function normalizeDateKey_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : dayKey_(v, tz || Session.getScriptTimeZone());
  }
  return parseIsoPrefix_(String(v === null || v === undefined ? '' : v).trim());
}

/** JC Date Key for a response row, read from the raw value, never the display
 *  string. See normalizeDateKey_ for why. */
function readDateKey_(row) {
  var idx = row.cols.admin.DATE_KEY;
  if (idx === undefined || idx < 0) { return ''; }
  var raw = row.values[idx];
  var tz = null;
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    try { tz = row.sheet.getParent().getSpreadsheetTimeZone(); } catch (ignored) { tz = null; }
  }
  return normalizeDateKey_(raw, tz);
}

/** Answer text for a logical question key ('' when unanswered or absent). */
function getAnswer_(row, qKey) {
  var idx = row.cols.q[qKey];
  if (idx === undefined || idx < 0) { return ''; }
  return String(row.display[idx] === undefined ? '' : row.display[idx]).trim();
}

/**
 * Every submitted answer, in sheet order, as {label, value} — used to render the
 * review page and the notification email without hardcoding the question list,
 * so questions added later show up automatically.
 *
 * `includeEmail` is false for the review PAGE and true for the EMAIL. The page
 * deliberately omits the submitter's address: a leaked token then exposes a name
 * and a talk title rather than a contactable email address.
 *
 * The suppression is CONTENT-BASED as well as index-based, on purpose. An
 * index-only test (`i === row.cols.email`) FAILS OPEN: `resolveAlias_` returns
 * -1 when Google renames or localises the collected-email header, and no loop
 * index is ever -1, so the filter would match nothing and publish the address.
 * Matching the header text and the value shape as well means the worst case is
 * an over-redacted field rather than a leaked address.
 */
function submittedFields_(row, includeEmail) {
  var out = [];
  for (var i = 0; i < row.header.length; i++) {
    var h = normHeader_(row.header[i]);
    if (h === '' || h === 'timestamp') { continue; }
    if (h.indexOf('jc ') === 0) { continue; }              // our own admin block
    var v = String(row.display[i] === undefined ? '' : row.display[i]).trim();
    if (v === '') { continue; }
    if (!includeEmail &&
        (i === row.cols.email ||
         h.indexOf('email') >= 0 || h.indexOf('e-mail') >= 0 ||
         safeEmail_(v) !== '')) { continue; }
    out.push({ label: String(row.header[i]).trim(), value: v });
  }
  return out;
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  TOKEN AND NONCE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** UUIDv4 shape. Cheap pre-filter so a garbage `t=` never reaches a sheet read. */
function isTokenShape_(t) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(t || ''));
}

function currentBucket_() {
  return Math.floor(Date.now() / NONCE_BUCKET_MS);
}

/**
 * Stateless confirm-nonce. Never stored anywhere — which is precisely why doGet
 * can be a pure read. Binding it to (token, action, time bucket) means a nonce
 * minted for "reject" cannot be replayed against "approve".
 */
function nonceFor_(token, action, bucket) {
  var raw = Utilities.computeHmacSha256Signature(
    token + '|' + action + '|' + bucket, requireProp_('HMAC_SECRET'));
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 22);
}

/** Accept the current bucket or the previous one -> a 30–60 minute window. */
function nonceValid_(token, action, nonce) {
  if (!nonce) { return false; }
  var b = currentBucket_();
  return nonce === nonceFor_(token, action, b) || nonce === nonceFor_(token, action, b - 1);
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  T1 — ON FORM SUBMIT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Installable on-form-submit trigger, installed FROM THE SPREADSHEET (A3), not
 * from the form. Three reasons that matters:
 *   * `e.range` gives the exact row, so there is no "find the row I just wrote"
 *     race;
 *   * the sheet row is the durable record we stamp with the token;
 *   * FormResponse.getItemResponses() silently omits unanswered items, which
 *     would make optional questions disappear.
 *
 * A SIMPLE onFormSubmit(e) could not do this job at all — simple triggers may
 * not send mail or open other files.
 *
 * The whole body is wrapped: a throw here is invisible (triggers fail silently
 * from the user's point of view) and would mean a submission Yiyang never hears
 * about. So we always try to tell him something.
 */
function onSignupSubmit(e) {
  var sheet, rowIndex;
  try {
    if (e && e.range) {
      sheet = e.range.getSheet();
      rowIndex = e.range.getRow();
    } else {
      // Manual run from the editor (no event object): operate on the last row so
      // the function is testable without submitting the form again.
      sheet = openResponsesSheet_();
      rowIndex = sheet.getLastRow();
      if (rowIndex < 2) { throw new Error('No response rows to process.'); }
    }
    ensureAdminColumns_(sheet);
    processSubmission_(sheet, rowIndex);
  } catch (err) {
    // Last-ditch: tell the owner in plain text. No links, nothing clickable.
    try {
      sendMailSafe_({
        to: getProp_('NOTIFY_EMAIL'),
        subject: '[JC signup] FAILED to process a sign-up',
        body: 'A journal club sign-up arrived but the handler threw:\n\n' +
              (err && err.stack ? err.stack : String(err)) +
              '\n\nResponses sheet: ' + responsesUrl_() +
              '\nRow: ' + (rowIndex || 'unknown') +
              '\n\nThe response itself is safe in the sheet; nothing was written ' +
              'to the public schedule.'
      });
    } catch (ignored) { /* nothing left to try */ }
    throw err;   // still surface it in the execution log
  }
}

/** The real work, factored out so it can be re-run on a row by hand. */
function processSubmission_(sheet, rowIndex) {
  var row = readResponseRow_(sheet, rowIndex);

  // Idempotence: if this row already has a token, the trigger fired twice (it
  // happens) — do not mint a second token and do not re-notify.
  if (getAdmin_(row, 'TOKEN') !== '') {
    return 'already processed (token present)';
  }

  var token = Utilities.getUuid();          // ~122 bits; this is the bearer credential
  var dateAnswer = getAnswer_(row, 'date');
  var dateKey = parseIsoPrefix_(dateAnswer);

  setAdmin_(row, 'TOKEN', token);
  setAdmin_(row, 'DATE_KEY', dateKey);
  setAdmin_(row, 'STATUS', dateKey ? STATUS.PENDING : STATUS.ERROR);
  if (!dateKey) {
    setAdmin_(row, 'NOTE', 'ERROR: unparseable date answer: "' + dateAnswer + '"');
    setAdmin_(row, 'DECIDED_AT', nowStamp_());
  }
  SpreadsheetApp.flush();   // make the token durable before we email a link to it

  // Re-read so `row.display` reflects what we just wrote (the email prints it).
  row = readResponseRow_(sheet, rowIndex);

  // Slot state is read-only and PURELY INFORMATIONAL here — by the time Yiyang
  // clicks, it may be weeks out of date. doPost re-validates under the lock.
  var slot = null, scheduleError = '';
  try {
    var ctx = openSchedule_();
    slot = slotState_(ctx, dateKey, new Date());
    slot.tz = ctx.tz;
  } catch (schemaErr) {
    scheduleError = String(schemaErr && schemaErr.message ? schemaErr.message : schemaErr);
  }

  var notified = notifyOwner_(row, token, dateKey, slot, scheduleError);
  setAdmin_(row, 'NOTIFIED', notified);
  SpreadsheetApp.flush();
  return 'processed: ' + (dateKey || 'NO DATE') + ', mail=' + notified;
}

/**
 * Pull the ISO date out of a dropdown choice.
 *
 * The choice reads "2026-09-14 — Monday 14 September, 4:30pm - 6:00pm, Davey 339".
 * We parse ONLY the leading yyyy-MM-dd; everything after it is human decoration
 * and may be mangled in transit without consequence. The ISO prefix is also what
 * guarantees choices are unique — "22 June" alone is unique today only by luck,
 * and collides the moment the schedule spans more than twelve months.
 */
function parseIsoPrefix_(s) {
  var m = String(s === null || s === undefined ? '' : s).match(/^\s*(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  EMAIL
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Send mail, never throwing, and never sending when the quota is nearly gone.
 * Returns 'YES' | 'QUOTA' | 'ERROR: msg', which is recorded in JC Notified so
 * the nightly job can tell Yiyang which notifications were lost.
 *
 * Consumer Gmail allows 100 recipients/day. Roughly a hundred spam submissions
 * would otherwise starve every legitimate notification silently.
 */
function sendMailSafe_(opts) {
  try {
    var to = safeEmail_(opts.to);
    if (!to) { return 'ERROR: no valid recipient'; }
    // Owner ALARMS pass a lower floor, so routine traffic can never consume the
    // last sends of the day and silence the only channel that reports failure.
    var floor = (opts.minQuota === undefined || opts.minQuota === null)
      ? MAIL_QUOTA_FLOOR : opts.minQuota;
    if (MailApp.getRemainingDailyQuota() < floor) { return 'QUOTA'; }
    var payload = {
      to: to,
      subject: opts.subject,
      // Plain-text body is always supplied: some clients (and every screen
      // reader fallback) prefer it, and it keeps the message out of spam.
      body: opts.body || stripHtml_(opts.htmlBody || ''),
      // Display name only — the From address is always the account that deployed
      // the script. Mail to the organizer is labelled as the bot; mail to a
      // speaker is labelled as Yiyang, because that is who they think they are
      // corresponding with (and replyTo points back at him either way).
      name: opts.name || 'JC Signup Bot'
    };
    if (opts.htmlBody) { payload.htmlBody = opts.htmlBody; }
    var reply = safeEmail_(opts.replyTo);
    if (reply) { payload.replyTo = reply; }
    // MailApp, not GmailApp: script.send_mail is a narrow scope, whereas GmailApp
    // asks for full mailbox access and a much scarier consent screen.
    // `noReply` is Workspace-only and must not be used on a consumer account.
    MailApp.sendEmail(payload);
    return 'YES';
  } catch (err) {
    return 'ERROR: ' + (err && err.message ? err.message : String(err));
  }
}

function stripHtml_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Inline styles everywhere below: Gmail and Outlook strip <style> blocks, so a
 * stylesheet would leave the mail unformatted on exactly the device Yiyang is
 * most likely to be holding. 16px base and 14px-tall buttons keep it tappable.
 *
 * `background-color` is NOT optional either: Gmail's mobile dark theme applies
 * partial colour inversion, darkening the message background while preserving
 * author-specified text colours it judges intentional. A wrapper with
 * `color:#16181a` and no background is the classic recipe for near-black text
 * on a dark grey card — on exactly the device this mail is most likely to be
 * read on. Stating both colours keeps the block self-consistent. */
var MAIL_WRAP_OPEN =
  '<div style="max-width:600px;margin:0 auto;padding:8px;' +
  'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;' +
  'font-size:16px;line-height:1.5;color:#16181a;background-color:#ffffff">';
var MAIL_WRAP_CLOSE = '</div>';

function mailButton_(href, label, bg) {
  return '<a href="' + esc_(href) + '" style="display:block;box-sizing:border-box;' +
    'width:100%;max-width:320px;margin:0 0 12px 0;padding:14px 20px;border-radius:6px;' +
    'background-color:' + bg + ';color:#ffffff;font-size:16px;font-weight:600;' +
    'text-align:center;text-decoration:none">' + esc_(label) + '</a>';
}

function mailFieldTable_(fields) {
  var rows = fields.map(function (f) {
    return '<tr>' +
      '<td style="padding:6px 12px 6px 0;color:#5a6068;vertical-align:top;' +
      'font-size:14px;white-space:nowrap">' + esc_(f.label) + '</td>' +
      '<td style="padding:6px 0;vertical-align:top">' + escMultiline_(f.value) + '</td>' +
      '</tr>';
  }).join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" ' +
    'style="width:100%;border-collapse:collapse;font-size:16px">' + rows + '</table>';
}

/** One-line human description of a slot's state, plus a colour for the banner. */
function slotBanner_(slot, dateKey, scheduleError) {
  if (scheduleError) {
    return { text: 'Could not read the schedule: ' + scheduleError, bg: '#fdecea', fg: '#a3261a' };
  }
  if (!slot || slot.state === 'NO_DATE') {
    return { text: 'No usable date in this request.', bg: '#fdecea', fg: '#a3261a' };
  }
  var when = slot.date ? fmtLong_(slot.date, slot.tz || Session.getScriptTimeZone()) : dateKey;
  switch (slot.state) {
    case 'FREE':
      return { text: 'This slot is currently free.', bg: '#e7f5ec', fg: '#1c6b3a' };
    case 'TAKEN':
      return { text: when + ' is already assigned to ' + slot.speaker +
                     (slot.affiliation ? ' (' + slot.affiliation + ')' : '') + '.',
               bg: '#fdecea', fg: '#a3261a' };
    case 'BREAK':
      return { text: when + ' is marked N/A — an intentional break week.',
               bg: '#fff6e5', fg: '#8a5a00' };
    case 'PAST':
      return { text: when + ' is not in the future any more.',
               bg: '#fff6e5', fg: '#8a5a00' };
    case 'NOT_IN_SCHEDULE':
      return { text: dateKey + ' is not in the schedule sheet' +
                     (slot.lastDate ? ' — the schedule currently ends on ' +
                      fmtLong_(slot.lastDate, slot.tz || Session.getScriptTimeZone()) : '') + '.',
               bg: '#fdecea', fg: '#a3261a' };
    case 'AMBIGUOUS':
      return { text: dateKey + ' appears in ' + slot.rows.length +
                     ' schedule rows — fix the duplicate before approving.',
               bg: '#fdecea', fg: '#a3261a' };
    default:
      return { text: 'Slot state unknown.', bg: '#fff6e5', fg: '#8a5a00' };
  }
}

/** The notification to Yiyang. Includes the submitter's email (unlike the web
 *  review page) so he can just hit Reply — replyTo is set to it as well. */
function notifyOwner_(row, token, dateKey, slot, scheduleError) {
  // Volume gate BEFORE any work: this is the only send in the system whose rate
  // an anonymous stranger controls.
  var used = claimNotifySlot_();
  if (used > MAX_NOTIFY_PER_DAY) {
    if (used === MAX_NOTIFY_PER_DAY + 1) {
      alertOwner_('Unusual sign-up volume — switching to digest mode for today',
        'More than ' + MAX_NOTIFY_PER_DAY + ' journal club sign-ups have arrived today.\n\n' +
        'To protect the daily email quota (a consumer Gmail account can send to 100 ' +
        'recipients a day, and starving it would silence every alert this bot can ' +
        'raise), further requests today will NOT be emailed to you individually. ' +
        'They are still recorded, still PENDING, and nothing is lost.\n\n' +
        'Rows notified this way are marked JC Notified = CAPPED. The nightly check ' +
        'counts them for you.\n\n' +
        'Private log: ' + responsesUrl_() + '\n\n' +
        'If this is spam rather than a rush of real interest: open the form, click ' +
        'Published (top right) and turn Accepting responses off.');
    }
    return 'CAPPED';
  }

  var speaker = getAnswer_(row, 'speaker') || '(no name given)';
  var submitterEmail = safeEmail_(row.cols.email >= 0 ? row.display[row.cols.email] : '');
  var tz = (slot && slot.tz) || Session.getScriptTimeZone();
  var when = (slot && slot.date) ? fmtLong_(slot.date, tz) : (dateKey || 'no date');
  var banner = slotBanner_(slot, dateKey, scheduleError);

  var subjectTag = (slot && slot.state === 'FREE') ? ' (slot free)'
                 : (!dateKey ? ' (BAD DATE)' : ' (CHECK SLOT)');
  var subject = '[JC signup] ' + sanitizeForSheet_(speaker, 60) + ' — ' +
                ((slot && slot.date) ? fmtShort_(slot.date, tz) + ' ' +
                 Utilities.formatDate(slot.date, tz, 'yyyy') : (dateKey || '?')) +
                subjectTag;

  var fields = submittedFields_(row, true);
  fields.push({ label: 'Submitted',
                value: row.cols.timestamp >= 0 ? String(row.display[row.cols.timestamp]) : '' });

  var html = MAIL_WRAP_OPEN +
    '<h2 style="margin:0 0 4px 0;font-size:20px">New journal club sign-up</h2>' +
    '<p style="margin:0 0 16px 0;color:#5a6068;font-size:15px">' +
      esc_(speaker) + ' asked for <strong>' + esc_(when) + '</strong>.</p>' +
    '<div style="margin:0 0 18px 0;padding:10px 14px;border-radius:6px;font-size:15px;' +
      'background-color:' + banner.bg + ';color:' + banner.fg + '">' +
      esc_(banner.text) + '</div>' +
    mailFieldTable_(fields);

  if (dateKey) {
    // Two GET links. Both merely RENDER a review page — see the H2 note at the
    // top of this file. That is why it is safe to put them in an email that
    // Safe Links, Gmail and any university scanner will happily fetch.
    var exec;
    try {
      exec = requireExecUrl_();
    } catch (urlErr) {
      exec = '';
      html += '<p style="margin:18px 0;padding:10px 14px;border-radius:6px;' +
        'background-color:#fdecea;color:#a3261a">EXEC_URL is not configured, so no ' +
        'approve/reject links could be generated. Approve by hand, or fix EXEC_URL ' +
        'and re-send.</p>';
    }
    if (exec) {
      var approveUrl = exec + '?t=' + encodeURIComponent(token) + '&a=approve';
      var rejectUrl  = exec + '?t=' + encodeURIComponent(token) + '&a=reject';
      html += '<div style="margin:22px 0 6px 0">' +
        mailButton_(approveUrl, 'Review & approve', '#1c7c3f') +
        mailButton_(rejectUrl, 'Review & reject', '#5a6068') +
        '</div>' +
        '<p style="margin:0;color:#5a6068;font-size:14px">' +
        'Both links open a review page. <strong>Nothing changes until you confirm ' +
        'there.</strong></p>';
    }
  } else {
    html += '<p style="margin:18px 0;padding:10px 14px;border-radius:6px;' +
      'background-color:#fdecea;color:#a3261a">No approve/reject links: the ' +
      '&ldquo;Preferred date&rdquo; answer did not start with a yyyy-mm-dd date, so ' +
      'there is no schedule row to write to. Handle this one by hand.</p>';
  }

  html += '<p style="margin:22px 0 0 0;font-size:13px;color:#8a9099">' +
    'Private log: <a href="' + esc_(responsesUrl_()) + '" style="color:#4b8fd6">responses sheet</a> · ' +
    'Public schedule: <a href="' + esc_(scheduleUrl_()) + '" style="color:#4b8fd6">schedule sheet</a>' +
    '</p>' + MAIL_WRAP_CLOSE;

  return sendMailSafe_({
    to: getProp_('NOTIFY_EMAIL'),
    subject: subject,
    htmlBody: html,
    replyTo: submitterEmail        // hitting Reply writes to the speaker directly
  });
}

/** Confirmation to the speaker. Sent on approval only — a canned rejection is
 *  the wrong tone for a ten-person journal club, so rejections give Yiyang a
 *  pre-filled draft to write himself. */
function notifySubmitterApproved_(row, ctx, schedRow) {
  var to = safeEmail_(row.cols.email >= 0 ? row.display[row.cols.email] : '');
  if (!to) { return 'ERROR: no submitter email captured'; }

  var name = getAnswer_(row, 'speaker');
  var first = name.split(/\s+/)[0] || 'there';
  var when = fmtLong_(schedRow.date, ctx.tz);
  var time = rowTime_(ctx, schedRow);
  var room = rowRoom_(ctx, schedRow);
  var topic = getAnswer_(row, 'title');

  var whenLine = when + (time ? ', ' + time : '') +
                 (room && room.toUpperCase() !== 'N/A' ? ', ' + room : '');

  var html = MAIL_WRAP_OPEN +
    '<p style="margin:0 0 14px 0">Hi ' + esc_(first) + ',</p>' +
    '<p style="margin:0 0 14px 0">Your journal club talk is confirmed for ' +
      '<strong>' + esc_(whenLine) + '</strong>. It is now on the public schedule: ' +
      '<a href="' + esc_(PUBLIC_SITE_URL) + '" style="color:#2f6fb0">' +
      esc_(PUBLIC_SITE_URL) + '</a></p>' +
    (topic
      ? '<p style="margin:0 0 14px 0">Listed topic: <em>' + esc_(topic) + '</em> — reply to ' +
        'this email if you would like it changed, or if anything comes up.</p>'
      : '<p style="margin:0 0 14px 0">The schedule currently shows &ldquo;Topic to be ' +
        'announced&rdquo; — just reply to this email with a title whenever you have one.</p>') +
    '<p style="margin:0">— Yiyang</p>' +
    MAIL_WRAP_CLOSE;

  return sendMailSafe_({
    to: to,
    subject: "You're on the Journal Club schedule — " + fmtLong_(schedRow.date, ctx.tz),
    htmlBody: html,
    replyTo: getProp_('NOTIFY_EMAIL'),
    name: 'Yiyang Jiang'
  });
}

/**
 * Plain-text alert to the owner about a script-level problem.
 *
 * Two properties make this the channel of last resort rather than just another
 * send: it reserves the bottom of the mail quota (MAIL_OWNER_QUOTA_FLOOR), and
 * anything it still fails to deliver is PERSISTED and prepended to the next
 * alert that does go out. Without the second half, the nightly report that says
 * "your notifications are being dropped" is itself dropped, and the resulting
 * blackout has no symptom at all from Yiyang's side.
 */
function alertOwner_(subject, message) {
  var props = null, carried = '';
  try {
    props = getProps_();
    carried = props.getProperty('LAST_UNSENT_ALERT') || '';
  } catch (ignored) { props = null; }

  var body = carried
    ? ('[CARRIED OVER — this alert could not be sent when it happened]\n\n' + carried +
       '\n\n' + new Array(60).join('-') + '\n\n' + message)
    : message;

  var res = sendMailSafe_({
    to: getProp_('NOTIFY_EMAIL'),
    subject: '[JC signup] ' + subject,
    body: body,
    minQuota: MAIL_OWNER_QUOTA_FLOOR
  });

  try {
    if (props) {
      if (res === 'YES') {
        if (carried) { props.deleteProperty('LAST_UNSENT_ALERT'); }
      } else {
        // 9 KB is the per-property limit; stay well inside it.
        props.setProperty('LAST_UNSENT_ALERT', (subject + '\n\n' + body).slice(0, 7000));
      }
    }
  } catch (ignored) { /* nothing further to try */ }
  return res;
}

/**
 * Claim one slot in today's individual-notification budget, and return the
 * running count. Bounding notification volume is what makes the mail quota
 * un-exhaustible by form traffic: without it, ~100 anonymous submissions to a
 * public, un-CAPTCHA'd form starve every alarm in the system for the rest of
 * the day, and the failure is silent because silence is exactly what "nobody
 * signed up this week" looks like.
 */
function claimNotifySlot_() {
  try {
    var props = getProps_();
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var parts = String(props.getProperty('NOTIFY_BUDGET') || '').split('|');
    var n = (parts[0] === today) ? (parseInt(parts[1], 10) || 0) : 0;
    n++;
    props.setProperty('NOTIFY_BUDGET', today + '|' + n);
    return n;
  } catch (ignored) {
    return 1;   // never let budget accounting block a notification
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  HTML PAGES
 * ═══════════════════════════════════════════════════════════════════════════ */

/* Everything is a plain string with esc_() at every interpolation, rather than
 * an HtmlService template with <?= ?>. Same guarantee (contextual escaping at
 * every insertion point), one less file for Yiyang to paste, and no chance of
 * anyone reaching for <?!= ?> by mistake. */
var PAGE_CSS =
  ':root{color-scheme:light dark}' +
  '*{box-sizing:border-box}' +
  'body{margin:0;padding:24px 16px;background:#f6f7f8;color:#16181a;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;" +
    'font-size:16px;line-height:1.55}' +
  '.wrap{max-width:660px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;' +
    'border-radius:10px;padding:24px}' +
  'h1{margin:0 0 14px;font-size:22px;line-height:1.3}' +
  'p{margin:0 0 14px}' +
  'table.f{width:100%;border-collapse:collapse;margin:0 0 18px}' +
  'table.f td{padding:7px 0;vertical-align:top;border-bottom:1px solid #eef0f2}' +
  'table.f td.k{width:38%;color:#5a6068;font-size:14px;padding-right:14px}' +
  '.banner{margin:0 0 18px;padding:11px 14px;border-radius:6px;font-size:15px}' +
  '.ok{background:#e7f5ec;color:#1c6b3a}' +
  '.warn{background:#fff6e5;color:#8a5a00}' +
  '.bad{background:#fdecea;color:#a3261a}' +
  '.btn{display:inline-block;width:100%;max-width:380px;padding:14px 20px;border:0;' +
    'border-radius:6px;font-size:16px;font-weight:600;color:#fff;text-align:center;' +
    'text-decoration:none;cursor:pointer}' +
  '.btn.go{background:#1c7c3f}' +
  '.btn.no{background:#a3261a}' +
  '.btn.neutral{background:#5a6068}' +
  '.alt{display:inline-block;margin:14px 0 0;color:#2f6fb0}' +
  '.foot{margin:22px 0 0;padding-top:14px;border-top:1px solid #eef0f2;' +
    'font-size:13px;color:#8a9099}' +
  '@media (prefers-color-scheme:dark){' +
    'body{background:#1b1c1e;color:#e8e9ea}' +
    '.wrap{background:#25272a;border-color:#3a3d41}' +
    'table.f td{border-bottom-color:#33363a}' +
    'table.f td.k{color:#9aa0a6}' +
    '.foot{border-top-color:#33363a;color:#8a9099}' +
    '.ok{background:#173626;color:#8fd6ab}' +
    '.warn{background:#3a2f14;color:#f0c674}' +
    '.bad{background:#3a1d1a;color:#f0a79c}' +
    '.alt{color:#7fb6ea}' +
  '}';

/**
 * Wrap body HTML in a full document.
 *
 * `<base target="_top">` is NOT optional: Apps Script serves web-app HTML inside
 * a sandboxed iframe that is not granted allow-top-navigation, so without it
 * every link and every form submit on this page silently does nothing.
 *
 * XFrameOptionsMode is left at DEFAULT (Google's clickjacking protection on) —
 * these pages are never embedded in the Hugo site.
 */
function page_(title, bodyHtml) {
  var html =
    '<!DOCTYPE html><html><head>' +
    '<base target="_top">' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc_(title) + '</title>' +
    '<style>' + PAGE_CSS + '</style>' +
    '</head><body><div class="wrap">' + bodyHtml + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title);
}

function fieldTableHtml_(fields) {
  if (!fields.length) { return ''; }
  return '<table class="f">' + fields.map(function (f) {
    return '<tr><td class="k">' + esc_(f.label) + '</td>' +
           '<td>' + escMultiline_(f.value) + '</td></tr>';
  }).join('') + '</table>';
}

/** Deliberately vague, and identical for "never existed" and "wrong shape", so
 *  the endpoint leaks nothing to someone probing token values. */
function pageUnknown_() {
  return page_('Unknown request',
    '<h1>Unknown or expired request</h1>' +
    '<p>This link does not correspond to a sign-up that is waiting for a decision.</p>' +
    '<p class="foot">Nothing has been changed.</p>');
}

function pageNothingToDo_() {
  return page_('Journal Club sign-up',
    '<h1>Nothing to do here</h1>' +
    '<p>This page only works from a link in a sign-up notification email.</p>' +
    '<p class="foot">Journal Club — Penn State condensed matter theory.</p>');
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  doGet — REVIEW ONLY. ZERO WRITES. THIS IS THE H2 DEFENCE.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Renders a review page and nothing else. No setValue, no PropertiesService
 * write, no CacheService write, anywhere on any code path reachable from here.
 *
 * A mail scanner that fetches BOTH links, twice, in any order, changes nothing.
 * That property is the entire reason this system has a doPost at all.
 *
 * Parameter names are t / a / n. Never `c` or `sid` — Apps Script reserves those
 * and a web app that uses them answers HTTP 405.
 */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var token = String(p.t || '').trim();
    var action = String(p.a || '').trim().toLowerCase();

    if (!token || (action !== 'approve' && action !== 'reject') || !isTokenShape_(token)) {
      return pageNothingToDo_();
    }

    var sheet = openResponsesSheet_();
    var row = findResponseRowByToken_(sheet, token);
    if (!row) { return pageUnknown_(); }

    var status = getAdmin_(row, 'STATUS').toUpperCase();
    if (status !== STATUS.PENDING) { return pageAlreadyHandled_(row, status); }

    var dateKey = readDateKey_(row);
    var ctx = null, slot = null, schemaError = '';
    try {
      ctx = openSchedule_();
      slot = slotState_(ctx, dateKey, new Date());
      slot.tz = ctx.tz;
    } catch (schemaErr) {
      schemaError = String(schemaErr && schemaErr.message ? schemaErr.message : schemaErr);
    }

    return pageReview_(row, token, action, dateKey, ctx, slot, schemaError);
  } catch (err) {
    // Deliberately no alertOwner_ here. doGet is world-callable, so mailing on
    // every failure would turn a request flood into a mail flood — and burn the
    // 100/day quota that legitimate notifications depend on. The execution log
    // records it; the nightly job reports anything structural.
    // Even the error page is a pure read — nothing to roll back.
    //
    // The message is deliberately generic: this endpoint answers anonymous
    // callers, and err.message here names configuration keys and schedule
    // header rows. The detail goes to the execution log instead.
    console.error('doGet failed: ' + (err && err.stack ? err.stack : String(err)));
    return page_('Error',
      '<h1>Something went wrong</h1>' +
      '<div class="banner bad">This request could not be processed.</div>' +
      '<p class="foot">Nothing has been changed. If you are the organizer, the details ' +
      'are in the Apps Script execution log.</p>');
  }
}

function pageReview_(row, token, action, dateKey, ctx, slot, schemaError) {
  var approving = (action === 'approve');
  var speaker = getAnswer_(row, 'speaker');

  // Fields WITHOUT the email address: a leaked token should not hand over a
  // contactable address, only a name and a talk title.
  var fields = submittedFields_(row, false);
  if (row.cols.timestamp >= 0) {
    fields.push({ label: 'Submitted', value: String(row.display[row.cols.timestamp]) });
  }

  // A broken schedule blocks APPROVAL only. Rejection never touches the schedule,
  // so it must stay available \u2014 otherwise a schema problem would also freeze
  // Yiyang's ability to clear the queue.
  var banner, canProceed = true;
  if (schemaError) {
    banner = '<div class="banner bad">The schedule sheet\u2019s columns have changed and ' +
             'I cannot safely write to it. ' + esc_(schemaError) + '</div>';
    canProceed = !approving;
  } else {
    var b = slotBanner_(slot, dateKey, '');
    var cls = (slot && slot.state === 'FREE') ? 'ok'
            : (slot && (slot.state === 'BREAK' || slot.state === 'PAST')) ? 'warn' : 'bad';
    banner = '<div class="banner ' + cls + '">' +
             (cls === 'ok' ? '\u2705 ' : (cls === 'warn' ? '\u26a0\ufe0f ' : '\u26d4 ')) +
             esc_(b.text) + '</div>';
  }

  var body = '<h1>' + (approving ? 'Approve' : 'Reject') + ' this journal club sign-up?</h1>' +
    banner + fieldTableHtml_(fields);

  if (schemaError) {
    // Its own paragraph. Falling through to the rejection copy here would tell
    // Yiyang he is about to reject when he clicked approve — at the exact moment
    // he is already puzzled by a red schema banner.
    body += '<p>Approval is blocked until the schedule sheet&rsquo;s header row is fixed. ' +
      '<strong>Nothing has been changed.</strong>' +
      (approving ? ' You can still reject this request — rejection never touches the ' +
                   'schedule.' : '') + '</p>';
  } else if (approving) {
    // Spell out exactly what will be written. Yiyang should never have to guess
    // which cells a click is going to touch in a public spreadsheet.
    var willWrite = [speaker, getAnswer_(row, 'affiliation'), getAnswer_(row, 'advisor'),
                     getAnswer_(row, 'title')].filter(function (x) { return x; }).join(' / ');
    var rowNote = (slot && slot.sheetRow) ? ' into row ' + slot.sheetRow + ' of the public schedule'
                                          : ' into the matching schedule row';
    var roomDefault = getProp_('DEFAULT_ROOM').trim();
    var currentRoom = (slot && slot.row && ctx) ? rowRoom_(ctx, slot.row) : '';
    var roomNote = (roomDefault && currentRoom === '')
      ? ' Room will be set to <em>' + esc_(roomDefault) + '</em> (currently blank).'
      : (currentRoom ? ' Room stays <em>' + esc_(currentRoom) + '</em>.' : '');
    body += '<p>Approving writes <strong>' + esc_(willWrite) + '</strong>' + rowNote +
      ', and emails the speaker a confirmation. Date, day and time are not changed.' +
      roomNote + '</p>';
    // And exactly what it will DESTROY. The paragraph above enumerates what gets
    // written but said nothing about what gets replaced, so a hand-written
    // "HOLD - Prof. Kim, do not reassign" in Topic vanished on one click with no
    // warning anywhere. Room is protected by a never-overwrite rule; these columns
    // cannot be, so they get a warning instead.
    var willReplace = plannedReplacements_(ctx, slot, row);
    if (willReplace.length) {
      body += '<div class="banner warn">⚠️ This will <strong>replace</strong> text ' +
        'already in that row:<br>' + willReplace.map(function (x) {
          return '<strong>' + esc_(x.column) + '</strong>: ' + esc_(x.from) +
                 ' → ' + esc_(x.to);
        }).join('<br>') + '</div>';
    }
  } else {
    body += '<p>Rejecting records the decision privately. <strong>No email is sent to ' +
      esc_(speaker || 'the speaker') + '</strong> — you will get a pre-filled draft to ' +
      'write to them yourself.</p>';
  }

  if (canProceed) {
    var slotIsFree = slot && slot.state === 'FREE';
    var label = approving
      ? (slotIsFree ? 'Confirm approval — write to the schedule'
                    : 'Confirm anyway (will be blocked if still taken)')
      : 'Confirm rejection';
    body += confirmFormHtml_(token, action, approving ? 'go' : 'no', label);
  } else {
    body += '<div class="banner bad">Approval is not offered until the schedule sheet is ' +
            'fixed. Nothing has been changed. (You can still reject the request — that ' +
            'never touches the schedule.)</div>';
  }

  var other = approving ? 'reject' : 'approve';
  var otherUrl = reviewUrl_(token, other);
  if (otherUrl) {
    body += '<p><a class="alt" href="' + esc_(otherUrl) + '">Changed your mind? ' +
            (approving ? 'Reject this request instead' : 'Approve this request instead') +
            '</a></p>';
  }

  body += '<p class="foot">Nothing has been changed yet. This page is safe to open, ' +
          'close and reopen &mdash; the link you clicked in the email did not modify ' +
          'anything.</p>';

  return page_((approving ? 'Approve' : 'Reject') + ' sign-up' +
               (speaker ? ' — ' + speaker : ''), body);
}

/** A review-page link for the other action, or '' when EXEC_URL is unusable.
 *  Never build these off `getProp_('EXEC_URL')` unchecked: a blank property
 *  yields a relative link back to the googleusercontent /echo URL the page was
 *  served from, which routes nowhere and looks like a dead control. */
function reviewUrl_(token, action) {
  var exec;
  try { exec = requireExecUrl_(); } catch (err) { return ''; }
  return exec + '?t=' + encodeURIComponent(token) + '&a=' + encodeURIComponent(action);
}

/**
 * The one and only mutating control on any page: a POST form carrying a nonce.
 * `target="_top"` for the same iframe-sandbox reason as <base>.
 *
 * If EXEC_URL is missing or is a /dev URL, an explicit banner is rendered rather
 * than a button that posts to the wrong place and silently does nothing — a
 * dead confirm button is the worst possible presentation of a misconfiguration.
 */
function confirmFormHtml_(token, action, btnClass, label) {
  var exec;
  try {
    exec = requireExecUrl_();
  } catch (err) {
    return '<div class="banner bad">This page cannot offer a confirm button: ' +
      '<strong>EXEC_URL</strong> is not set to a deployed <code>/exec</code> web app URL. ' +
      'Set it under Project Settings &gt; Script Properties (setup guide, Part G), then ' +
      'open the link in the email again. Nothing has been changed.</div>';
  }
  return '<form method="post" action="' + esc_(exec) + '" target="_top" style="margin:18px 0 0">' +
    '<input type="hidden" name="t" value="' + esc_(token) + '">' +
    '<input type="hidden" name="a" value="' + esc_(action) + '">' +
    '<input type="hidden" name="n" value="' + esc_(nonceFor_(token, action, currentBucket_())) + '">' +
    '<button type="submit" class="btn ' + btnClass + '">' + esc_(label) + '</button>' +
    '</form>';
}

/** Idempotent replay page. Any hit on a token that has left PENDING lands here,
 *  whether it is Yiyang double-clicking or a scanner re-fetching a week later. */
function pageAlreadyHandled_(row, status) {
  var decidedAt = getAdmin_(row, 'DECIDED_AT');
  var note = getAdmin_(row, 'NOTE');
  var schedRow = getAdmin_(row, 'SCHED_ROW');
  var word = {
    APPROVED: 'approved',
    REJECTED: 'rejected',
    EXPIRED: 'expired',
    ERROR: 'flagged as an error'
  }[status] || ('recorded as ' + status.toLowerCase());

  var body = '<h1>Already handled</h1>' +
    '<p>This request was <strong>' + esc_(word) + '</strong>' +
    (decidedAt ? ' on ' + esc_(decidedAt) : '') +
    (schedRow ? ' (schedule row ' + esc_(schedRow) + ')' : '') + '.</p>' +
    (note ? '<div class="banner warn">' + esc_(note) + '</div>' : '') +
    '<p class="foot">Nothing has been changed by opening this link.</p>';
  return page_('Already handled', body);
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  doPost — THE ONLY MUTATING REQUEST
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reached only from the confirm button on a review page.
 *
 * Order of operations is load-bearing:
 *   nonce check (no mutation on failure)
 *   -> lock
 *   -> re-read status  (idempotence: exactly one transition out of PENDING)
 *   -> re-read schedule and re-validate freshness  (H3)
 *   -> write, flush, release
 *   -> only then send email
 *
 * A lost race leaves the row PENDING so the token stays usable — Yiyang can
 * reject it, or fix the sheet and click again.
 */
function doPost(e) {
  var token = '', action = '';
  try {
    var p = (e && e.parameter) || {};
    token = String(p.t || '').trim();
    action = String(p.a || '').trim().toLowerCase();
    var nonce = String(p.n || '').trim();

    if (!isTokenShape_(token) || (action !== 'approve' && action !== 'reject')) {
      return pageNothingToDo_();
    }
    // The nonce check gets its OWN try/catch, and it must come before anything
    // that can page the owner. `nonceFor_` calls requireProp_('HMAC_SECRET'),
    // which throws by construction when that property is missing or blank — and
    // the catch-all at the bottom of this function sends mail. Without this
    // guard, an anonymous caller who has authenticated nothing could reach a
    // code path that emails Yiyang once per request: a mail amplifier that
    // drains the very quota every alarm depends on.
    var nonceOk = false;
    try {
      nonceOk = nonceValid_(token, action, nonce);
    } catch (nonceErr) {
      console.error('nonce check failed: ' +
                    (nonceErr && nonceErr.stack ? nonceErr.stack : String(nonceErr)));
      nonceOk = false;
    }
    if (!nonceOk) {
      // Also the landing spot for any POST manufactured without first loading a
      // review page. No mutation on this path.
      return page_('Expired',
        '<h1>This confirmation page has expired</h1>' +
        '<p>Open the link in the email again — nothing was changed.</p>');
    }

    // tryLock, not waitLock: a timeout should render a friendly page rather than
    // throw a stack trace at Yiyang.
    var lock = LockService.getScriptLock();   // getDocumentLock() returns null in
                                              // standalone scripts and web apps.
    if (!lock.tryLock(30000)) {
      return page_('Busy',
        '<h1>Another approval is being processed</h1>' +
        '<p>Nothing was changed — please click Confirm again in a few seconds.</p>');
    }
    var outcome;
    try {
      outcome = decideUnderLock_(token, action);
    } finally {
      lock.releaseLock();
    }

    // Post-commit side effects happen OUTSIDE the lock. Sending mail takes on the
    // order of a second; holding a global lock for that would serialise unrelated
    // approvals for no benefit, and a mail failure must never be able to roll back
    // or block a schedule write that has already been flushed.
    if (outcome && outcome.approved) {
      var mailed = notifySubmitterApproved_(outcome.row, outcome.ctx, outcome.schedRow);
      return pageApproved_(outcome, mailed);
    }
    return (outcome && outcome.page) ? outcome.page : pageNothingToDo_();
  } catch (err) {
    // Reachable only AFTER the nonce has validated, so this send cannot be
    // triggered by an unauthenticated caller.
    alertOwner_('Approval failed',
      'A confirm click failed.\n\naction=' + action + '\ntoken=' + token + '\n\n' +
      (err && err.stack ? err.stack : String(err)) +
      '\n\nCheck the schedule row before retrying — the write to the public schedule ' +
      'happens before the private log is stamped, so it is possible the schedule was ' +
      'updated and only the bookkeeping failed.\n\nSchedule: ' + scheduleUrl_() +
      '\nPrivate log: ' + responsesUrl_());
    return page_('Error',
      '<h1>Something went wrong</h1>' +
      '<div class="banner bad">' + esc_(err && err.message ? err.message : String(err)) + '</div>' +
      '<p>The request is still marked pending, so this link still works — but do not ' +
      'assume nothing changed. <strong>Check the schedule row first:</strong> the public ' +
      'schedule is written before the private log is stamped, so a failure in between ' +
      'leaves the speaker on the schedule with the request still showing as pending.</p>' +
      '<p>A copy of this error has been emailed to you.</p>' +
      '<p><a class="alt" href="' + esc_(scheduleUrl_()) + '">Open the schedule</a> ' +
      '&nbsp;·&nbsp; <a class="alt" href="' + esc_(responsesUrl_()) + '">Open the private log</a></p>');
  }
}

/**
 * Everything that touches a spreadsheet in the decision path. Runs inside the
 * script lock; the caller releases it.
 *
 * Returns either {page: HtmlOutput} — render this, we are done — or
 * {approved: true, row, ctx, schedRow, wrote} meaning "the schedule write is
 * committed; the caller should now, outside the lock, email the speaker and
 * render the success page".
 */
function decideUnderLock_(token, action) {
  var sheet = openResponsesSheet_();
  var row = findResponseRowByToken_(sheet, token);
  if (!row) { return { page: pageUnknown_() }; }

  // Re-read status INSIDE the lock. This is what makes the token single-use even
  // if two confirm clicks land in the same second.
  var status = getAdmin_(row, 'STATUS').toUpperCase();
  if (status !== STATUS.PENDING) { return { page: pageAlreadyHandled_(row, status) }; }

  if (action === 'reject') { return doReject_(row); }
  return doApprove_(row);
}

function doReject_(row) {
  setAdmin_(row, 'STATUS', STATUS.REJECTED);
  setAdmin_(row, 'DECIDED_AT', nowStamp_());
  setAdmin_(row, 'NOTE', 'rejected by organizer');
  SpreadsheetApp.flush();

  var speaker = getAnswer_(row, 'speaker');
  var email = safeEmail_(row.cols.email >= 0 ? row.display[row.cols.email] : '');
  var first = (speaker || '').split(/\s+/)[0] || 'there';

  // NO mailto: HERE, AND NO ADDRESS IN THE HTML. The review page deliberately
  // withholds the submitter's address so that a leaked token exposes a name and a
  // talk title rather than a contactable .edu address (submittedFields_ says so
  // explicitly). This page used to hand the address straight back inside a mailto
  // href, undoing that property in one anonymous POST. The address lives in the
  // private log, behind Google auth — point there instead. Losing one click is a
  // fair price for a security property the code claims and now actually keeps.

  var body = '<h1>Rejection recorded</h1>' +
    '<p>' + esc_(speaker || 'The request') + '\u2019s request has been marked rejected in ' +
    'the private log. <strong>No email was sent to them.</strong></p>' +
    (email
      ? '<p>To write to ' + esc_(first) + ' yourself, open the private log below — their ' +
        'address is on row ' + row.rowIndex + '. Suggested wording: <em>&ldquo;Thanks for ' +
        'offering to present at the journal club. Unfortunately that date doesn&rsquo;t ' +
        'work out &mdash; could we find another one?&rdquo;</em></p>'
      : '<div class="banner warn">No email address was captured for this submission, so ' +
        'there is nobody to write to.</div>') +
    '<p class="foot">Nothing was written to the public schedule. ' +
    '<a class="alt" href="' + esc_(responsesUrl_()) + '">Open the private log</a></p>';
  return { page: page_('Rejected', body) };
}

function doApprove_(row) {
  var dateKey = readDateKey_(row);
  if (!dateKey) {
    setAdmin_(row, 'STATUS', STATUS.ERROR);
    setAdmin_(row, 'DECIDED_AT', nowStamp_());
    setAdmin_(row, 'NOTE', 'ERROR: no JC Date Key to match against the schedule');
    SpreadsheetApp.flush();
    return { page: page_('Cannot approve',
      '<h1>No usable date</h1>' +
      '<div class="banner bad">This submission has no parseable date, so there is no ' +
      'schedule row to write to. Nothing was changed.</div>') };
  }

  // ── schema ─────────────────────────────────────────────────────────────────
  var ctx;
  try {
    ctx = openSchedule_();
  } catch (schemaErr) {
    var msg = String(schemaErr && schemaErr.message ? schemaErr.message : schemaErr);
    setAdmin_(row, 'STATUS', STATUS.ERROR);
    setAdmin_(row, 'DECIDED_AT', nowStamp_());
    setAdmin_(row, 'NOTE', 'ERROR: schedule schema drift — ' + msg);
    SpreadsheetApp.flush();
    alertOwner_('Schedule schema drift', msg);
    return { page: page_('Schema problem',
      '<h1>The schedule sheet has changed shape</h1>' +
      '<div class="banner bad">' + esc_(msg) + '</div>' +
      '<p>Nothing was changed. Fix the header row, then open the link again.</p>') };
  }

  // ── locate the row ─────────────────────────────────────────────────────────
  var found = findRowByDate_(ctx, dateKey);
  if (found.status === 'NOT_IN_SCHEDULE') {
    // Deliberately NOT appending a row: Day of Week and TIme are not derivable
    // (15 July 2026 is a Wednesday 2:00–3:00pm row), so inventing them would put
    // wrong information on a public page. Leave PENDING and ask for a fix.
    var last = lastScheduledDate_(ctx);
    return pageBlocked_(row,
      '<h1>\u26a0\ufe0f Not written — that date is not in the schedule</h1>',
      esc_(dateKey) + ' has no row in the schedule sheet' +
      (last ? '. The schedule currently ends on <strong>' + esc_(fmtLong_(last, ctx.tz)) +
              '</strong> — add the row first, then click the link again' : '') + '.');
  }
  if (found.status === 'AMBIGUOUS') {
    var rowsList = found.rows.map(function (h) { return 'row ' + h.sheetRow; }).join(', ');
    return pageBlocked_(row,
      '<h1>\u26a0\ufe0f Not written — the date is duplicated</h1>',
      esc_(dateKey) + ' appears in ' + found.rows.length + ' schedule rows (' +
      esc_(rowsList) + '). Remove the duplicate, then click the link again.');
  }

  // ── freshness (H3) — evaluated on values read INSIDE the lock ──────────────
  var schedRow = found.row;
  if (!isFreeSlot_(schedRow.values, ctx.col, ctx.tz, new Date())) {
    var occupant = String(normCell_(schedRow.values[ctx.col.speaker]));
    var affil = ctx.col.affiliation !== undefined
      ? String(normCell_(schedRow.values[ctx.col.affiliation])) : '';
    var when = fmtLong_(schedRow.date, ctx.tz);
    var explain;
    if (occupant.toUpperCase() === 'N/A') {
      explain = esc_(when) + ' is marked <strong>N/A</strong> — an intentional break week.';
    } else if (occupant !== '') {
      explain = esc_(when) + ' is now assigned to <strong>' + esc_(occupant) +
                (affil ? ' (' + esc_(affil) + ')' : '') + '</strong>.';
    } else {
      explain = esc_(when) + ' is no longer in the future.';
    }
    return pageBlocked_(row, '<h1>\u26a0\ufe0f Not written — that slot is not available</h1>', explain);
  }

  // ── the write ──────────────────────────────────────────────────────────────
  // Guard: never write a blank Speaker. The question is required, so a blank here
  // means the question was renamed and getAnswer_('speaker') silently resolved to
  // nothing — in which case writing '' would leave the slot looking free while the
  // request counted as approved. Fail loudly instead.
  var speakerValue = sanitizeForSheet_(getAnswer_(row, 'speaker'), 80);
  if (!speakerValue) {
    return pageBlocked_(row, '<h1>⚠️ Not written — no speaker name</h1>',
      'This submission has no readable answer to the &ldquo;Speaker name&rdquo; question, ' +
      'so there is nothing to put in the Speaker cell. If the question was renamed, ' +
      'rename it back to <strong>Speaker name</strong> (or add the new title to ' +
      'QUESTION_ALIASES) and click the link again.');
  }

  // Sentinel collision. "N/A" in the Speaker cell means "intentional break week"
  // to isFreeSlot_, to slotState_ and to the website widget, which skips such
  // rows outright. Writing it would hide the talk from the site, make the date
  // read as a deliberate break, AND leave the slot permanently unbookable by
  // anyone else — all while the request is recorded as APPROVED. It takes one
  // inattentive approval, so refuse it at the write.
  if (/^n\s*\/?\s*a$/i.test(speakerValue)) {
    return pageBlocked_(row, '<h1>⚠️ Not written — reserved speaker name</h1>',
      '&ldquo;' + esc_(speakerValue) + '&rdquo; is the schedule&rsquo;s marker for an ' +
      '<strong>intentional break week</strong>. Writing it would hide the talk from the ' +
      'website and leave the slot permanently unbookable. If this is a real request, fix ' +
      'the Speaker name in the private log (or fill the row in by hand) before approving.');
  }

  // Per-cell setValue by RESOLVED index, never a whole-row setValues(): a row
  // write would clobber Date / Day of Week / TIme, which the sheet owns.
  var sheetRow = schedRow.sheetRow;
  var wrote = [];
  var skipped = [];
  var replaced = [];   // hand-entered cells this approval is about to overwrite
  var sv = schedRow.values;
  writeIfPresent_(ctx, sheetRow, 'speaker', speakerValue, 80, wrote, true, skipped, sv, replaced);
  writeIfPresent_(ctx, sheetRow, 'affiliation', getAnswer_(row, 'affiliation'), 80, wrote, false, skipped, sv, replaced);
  writeIfPresent_(ctx, sheetRow, 'advisor', getAnswer_(row, 'advisor'), 80, wrote, false, skipped, sv, replaced);
  writeIfPresent_(ctx, sheetRow, 'topic', getAnswer_(row, 'title'), 200, wrote, false, skipped, sv, replaced);

  // Room: only ever filled in when it is currently EMPTY. Never overwritten —
  // if Yiyang put something there, he meant it.
  var defaultRoom = getProp_('DEFAULT_ROOM').trim();
  if (defaultRoom && ctx.col.room !== undefined &&
      String(normCell_(schedRow.values[ctx.col.room])) === '') {
    var roomValue = sanitizeForSheet_(defaultRoom, 80);
    ctx.sheet.getRange(sheetRow, ctx.col.room + 1, 1, 1).setValue(roomValue);
    // Mirror into the in-memory snapshot. `schedRow` is handed to
    // notifySubmitterApproved_ after the lock is released, and a stale snapshot
    // means the speaker's confirmation email omits the room in exactly the case
    // the DEFAULT_ROOM feature exists for.
    schedRow.values[ctx.col.room] = roomValue;
    wrote.push('Room');
  }

  // Commit inside the critical section, so the next approval attempt reads the
  // new value rather than a stale one.
  SpreadsheetApp.flush();

  // FROM HERE THE PUBLIC SCHEDULE IS ALREADY UPDATED. A throw while stamping the
  // private log must never be reported as "nothing changed": that sends Yiyang
  // back to the approve link, where the freshness check now sees the speaker he
  // just added and blocks the request permanently.
  try {
    setAdmin_(row, 'STATUS', STATUS.APPROVED);
    setAdmin_(row, 'DECIDED_AT', nowStamp_());
    setAdmin_(row, 'SCHED_ROW', sheetRow);
    // The replaced-values list goes into the PERMANENT note, not just the page:
    // the page is seen once and closed, and this is the only record of what the
    // approval destroyed that does not require the spreadsheet's version history.
    setAdmin_(row, 'NOTE', 'approved \u2192 schedule row ' + sheetRow +
                           ' (' + wrote.join(', ') + ')' +
                           (replaced.length ? '; REPLACED ' + replaced.map(function (x) {
                             return x.column + ': "' + x.from + '"';
                           }).join(', ') : ''));
    SpreadsheetApp.flush();
  } catch (bookErr) {
    var bookMsg = errText_(bookErr);
    alertOwner_('Approval half-committed \u2014 fix the private log by hand',
      'The PUBLIC SCHEDULE WAS WRITTEN: row ' + sheetRow + ' now holds "' + speakerValue +
      '" (' + wrote.join(', ') + ').\n\nStamping the private log then failed:\n' +
      bookMsg + '\n\nSet JC Status to APPROVED and JC Schedule Row to ' + sheetRow +
      ' by hand, so the row is not re-offered, re-approved or expired. The speaker has ' +
      'NOT been emailed.\n\nSchedule: ' + scheduleUrl_() +
      '\nPrivate log: ' + responsesUrl_());
    return { page: page_('Partly done',
      '<h1>\u26a0\ufe0f Written to the schedule, but the log was not updated</h1>' +
      '<div class="banner warn">Row ' + sheetRow + ' of the public schedule <strong>was ' +
      'written</strong> (' + esc_(wrote.join(', ')) + '). Recording the decision in the ' +
      'private log failed: ' + esc_(bookMsg) + '</div>' +
      '<p>Do <strong>not</strong> click the approve link again \u2014 it would now see the ' +
      'slot as taken and refuse. Open the private log instead and set <code>JC Status</code> ' +
      'to <code>APPROVED</code> and <code>JC Schedule Row</code> to ' + sheetRow +
      ' by hand.</p>' +
      '<p>The speaker has <strong>not</strong> been emailed; write to them yourself.</p>' +
      '<p><a class="alt" href="' + esc_(responsesUrl_()) + '">Open the private log</a>' +
      ' &nbsp;\u00b7&nbsp; <a class="alt" href="' + esc_(scheduleUrl_()) +
      '">Open the schedule</a></p>') };
  }

  // The decision is now durable. Emailing the speaker and rendering the outcome
  // page both happen back in doPost, AFTER the lock has been released.
  return { approved: true, row: row, ctx: ctx, schedRow: schedRow,
           wrote: wrote, skipped: skipped, replaced: replaced };
}

/** Success page. Rendered outside the lock, once the speaker has been emailed
 *  (or the send has failed and we need to say so). */
function pageApproved_(outcome, mailed) {
  var ctx = outcome.ctx;
  var schedRow = outcome.schedRow;
  var sheetRow = schedRow.sheetRow;
  var speakerName = getAnswer_(outcome.row, 'speaker');
  var body = '<h1>\u2705 Approved and written to the schedule</h1>' +
    '<p><strong>' + esc_(speakerName) + '</strong> is now on the schedule for <strong>' +
    esc_(fmtLong_(schedRow.date, ctx.tz)) + '</strong>, row ' + sheetRow + '. ' +
    (mailed === 'YES'
      ? 'A confirmation email has been sent to them.'
      : '<span style="color:#a3261a">The confirmation email was NOT sent (' +
        esc_(mailed) + ') — write to them yourself.</span>') +
    '</p>' +
    '<p>Cells written: ' + esc_(outcome.wrote.join(', ') || 'none') + '. Date, day and ' +
    'time were not touched.</p>' +
    ((outcome.replaced && outcome.replaced.length)
      ? '<div class="banner warn">⚠️ This approval <strong>replaced</strong> values '
        + 'that were already in row ' + sheetRow + '. The old text is not recoverable '
        + 'from this page after you close it — it is also recorded in JC Decision Note:<br>' +
        outcome.replaced.map(function (x) {
          return '<strong>' + esc_(x.column) + '</strong>: ' + esc_(x.from) +
                 ' → ' + esc_(x.to);
        }).join('<br>') + '</div>'
      : '') +
    ((outcome.skipped && outcome.skipped.length)
      ? '<div class="banner warn">⚠️ Some answers had nowhere to go — the schedule ' +
        'has no matching column, so they were <strong>not</strong> written and you will ' +
        'need to add them to row ' + sheetRow + ' by hand:<br>' +
        outcome.skipped.map(function (s) {
          return '<strong>' + esc_(s.column) + '</strong>: ' + esc_(s.value);
        }).join('<br>') +
        '<br><br>Add a column with that header back to the schedule and future approvals ' +
        'will fill it automatically.</div>'
      : '') +
    '<p>The public site will show the talk on its next page load — no rebuild needed.</p>' +
    '<p><a class="alt" href="' + esc_(scheduleUrl_()) + '">Open the schedule</a> &nbsp;·&nbsp; ' +
    '<a class="alt" href="' + esc_(responsesUrl_()) + '">Open the private log</a></p>' +
    '<p class="foot">To undo: clear Speaker / Affiliation / Advisor / Topic in row ' +
    sheetRow + ' by hand.</p>';
  return page_('Approved — ' + (speakerName || 'sign-up'), body);
}

/** Write one sanitized answer into a schedule cell, if the column exists and
 *  (unless `always`) the value is non-empty. Skipping empties means an approval
 *  never blanks a cell Yiyang had already filled in.
 *
 *  A value that had somewhere to go but no column to go INTO is recorded in
 *  `skippedList`, so the outcome page can say so. Silently dropping it — which
 *  is what a renamed `Topic` column used to do — reports full success while the
 *  site renders "Topic to be announced", and the only signal is a nightly note
 *  up to 24 hours later. */
function writeIfPresent_(ctx, sheetRow, colName, value, maxLen, wroteList, always,
                        skippedList, rowValues, replacedList) {
  var idx = ctx.col[colName];
  var clean = sanitizeForSheet_(value, maxLen);
  if (idx === undefined) {
    if (clean && skippedList) {
      skippedList.push({ column: colName, value: clean });
    }
    return;
  }
  if (!clean && !always) { return; }
  // RECORD WHAT IS LOST. isFreeSlot_ uses Speaker as the sole discriminator, so a
  // row with an empty Speaker but a hand-written Topic ("HOLD — Prof. Kim, do not
  // reassign") or a pre-filled Affiliation/Advisor is still "free". Room gets an
  // explicit never-overwrite guard; these columns do not, and cannot get one
  // without blocking legitimate corrections. So the write stands and the loss is
  // surfaced instead — on the outcome page and in JC Decision Note, where an undo
  // is possible without digging through the spreadsheet's version history.
  if (rowValues && replacedList && idx < rowValues.length) {
    var prior = String(normCell_(rowValues[idx]));
    if (prior !== '' && prior !== clean) {
      replacedList.push({ column: colName, from: prior, to: clean });
    }
  }
  ctx.sheet.getRange(sheetRow, idx + 1, 1, 1).setValue(clean);
  wroteList.push(colName.charAt(0).toUpperCase() + colName.slice(1));
}

/**
 * What an approval would overwrite in the target schedule row, as
 * [{column, from, to}]. Read-only preview for the review page; doApprove_
 * computes the same list for real, inside the lock, from the values it is about
 * to write. Kept in step with writeIfPresent_'s three overwritable columns —
 * Speaker is excluded because a FREE row has an empty Speaker by definition, and
 * Room is excluded because it is never overwritten at all.
 */
function plannedReplacements_(ctx, slot, row) {
  var out = [];
  if (!ctx || !slot || !slot.row || !slot.row.values) { return out; }
  var plan = [['affiliation', getAnswer_(row, 'affiliation'), 80],
              ['advisor',     getAnswer_(row, 'advisor'),     80],
              ['topic',       getAnswer_(row, 'title'),       200]];
  for (var i = 0; i < plan.length; i++) {
    var idx = ctx.col[plan[i][0]];
    if (idx === undefined || idx >= slot.row.values.length) { continue; }
    var to = sanitizeForSheet_(plan[i][1], plan[i][2]);
    if (!to) { continue; }                       // unanswered: nothing is written
    var from = String(normCell_(slot.row.values[idx]));
    if (from !== '' && from !== to) {
      out.push({ column: plan[i][0], from: from, to: to });
    }
  }
  return out;
}

/**
 * "Blocked but still live" page. STATUS IS LEFT AT PENDING on purpose — a lost
 * race must not burn the token. Offers a mailto draft using whatever alternative
 * dates the speaker volunteered, plus a one-click route to reject instead.
 */
function pageBlocked_(row, headingHtml, explainHtml) {
  var speaker = getAnswer_(row, 'speaker');
  var first = (speaker || '').split(/\s+/)[0] || 'there';
  var alternates = getAnswer_(row, 'alternates');
  var email = safeEmail_(row.cols.email >= 0 ? row.display[row.cols.email] : '');
  var token = getAdmin_(row, 'TOKEN');

  // NO mailto: HERE — same reason as doReject_, and worse: this page is reachable
  // with NO state change at all (a token holder just POSTs approve against a taken
  // slot), so an address embedded here could be harvested without leaving a trace
  // in the private log. The address stays behind Google auth.

  var body = headingHtml +
    '<div class="banner bad">' + explainHtml + '</div>' +
    '<p>' + esc_(speaker || 'This') + '\u2019s request has been <strong>left pending</strong>, ' +
    'so the links in the email still work.</p>' +
    (alternates
      ? '<p>They said they could also do: <em>' + escMultiline_(alternates) + '</em></p>'
      : '') +
    (email
      ? '<p>To offer ' + esc_(first) + ' another date, open the private log — their ' +
        'address is on row ' + row.rowIndex + '.</p>'
      : '') +
    (token && reviewUrl_(token, 'reject')
      ? '<p><a class="alt" href="' + esc_(reviewUrl_(token, 'reject')) +
        '">Reject this request instead</a></p>'
      : '') +
    '<p class="foot">Nothing was written to the public schedule.</p>';
  // Same {page: ...} envelope every other decision branch uses, so doPost can
  // treat "blocked" and "done" uniformly.
  return { page: page_('Not written', body) };
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  T2 — NIGHTLY MAINTENANCE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Four independent steps, each in its own try/catch so one failure cannot mask
 * the others (the price of folding four jobs into one trigger, which keeps the
 * trigger budget at 2 of 20 and the runtime well under the daily cap).
 *
 * Emails Yiyang ONLY if something is wrong. A nightly "all fine" message would
 * be ignored within a week, and then the one that mattered would be too.
 */
function nightlyMaintenance() {
  var problems = [];

  try { refreshFormDates_(problems); }
  catch (err) { problems.push('refreshFormDates failed: ' + errText_(err)); }

  try { expireStalePending_(problems); }
  catch (err) { problems.push('expireStalePending failed: ' + errText_(err)); }

  try { verifySetup_(problems); }
  catch (err) { problems.push('verifySetup failed: ' + errText_(err)); }

  try { assertResponsesPrivate_(problems); }
  catch (err) {
    problems.push('CRITICAL: could not check whether the responses spreadsheet is still ' +
      'private (' + errText_(err) + '). If this persists, widen the Drive scope in ' +
      'appsscript.json to https://www.googleapis.com/auth/drive and re-authorize.');
  }

  if (problems.length) {
    // alertOwner_ persists anything it cannot send and prepends it to the next
    // successful alert, so a quota-starved night does not silently lose the
    // report. Logging the outcome here makes the failure visible in Executions
    // too, which is the only channel that does not depend on mail at all.
    var sent = alertOwner_('Nightly check found ' + problems.length + ' issue(s)',
      'The journal club sign-up bot found these problems:\n\n' +
      problems.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n\n') +
      '\n\nSchedule: ' + scheduleUrl_() + '\nPrivate log: ' + responsesUrl_() + '\n');
    if (sent !== 'YES') {
      console.error('Nightly report could NOT be emailed (' + sent + '). It has been ' +
                    'stored in the LAST_UNSENT_ALERT script property and will ride along ' +
                    'with the next alert that gets through. Problems were:\n' +
                    problems.join('\n'));
    }
  }
  return problems;
}

function errText_(err) {
  return err && err.message ? err.message : String(err);
}

/* ── 7.1 dropdown refresh ─────────────────────────────────────────────────── */

/** Public wrapper — this is the one the setup guide tells Yiyang to run. */
function refreshFormDates() {
  var problems = [];
  var summary = refreshFormDates_(problems);
  Logger.log(summary + (problems.length ? '\n\nProblems:\n- ' + problems.join('\n- ') : ''));
  return summary;
}

/**
 * Rewrite the "Preferred date" dropdown from genuinely-free schedule slots.
 *
 * This is a UX NICETY, NEVER A CORRECTNESS MECHANISM. Three staleness windows
 * are unavoidable (slot fills between nightly runs; respondent has the page open
 * when it fills; two respondents pick the same free date), and none of them can
 * be closed here — a submission is already recorded by Google before this script
 * ever sees it. The only authoritative gate is isFreeSlot_ under the lock in
 * doPost.
 */
function refreshFormDates_(problems) {
  var ctx = openSchedule_();
  var now = new Date();
  // LEAD_DAYS is a number of CALENDAR days, not a span of milliseconds.
  // Subtracting `now` (the trigger fires at 04:00) from slot MIDNIGHT is short by
  // four hours, so a slot exactly LEAD_DAYS days out was dropped every single
  // night \u2014 LEAD_DAYS=7 behaved as 8 \u2014 and a spring-forward week is 23 hours
  // shorter still, which silently removed the schedule's last free slot and
  // replaced the whole dropdown with the "no open dates" placeholder. Comparing
  // day keys makes the window independent of the run hour and of DST.
  var cutoffKey = shiftDayKey_(dayKey_(now, ctx.tz), getNumProp_('LEAD_DAYS', 7), ctx.tz);
  // Clamp: MAX_CHOICES <= 0 used to slice the list to nothing, which is
  // indistinguishable downstream from a genuinely full schedule \u2014 the nightly
  // mail then said "add more rows" while 26 rows were free.
  var maxChoices = Math.max(1, getNumProp_('MAX_CHOICES', 30));

  var open = [];
  var unreadable = unreadableDateRows_(ctx);
  var dowIdx = ctx.col['day of week'];
  for (var r = 1; r < ctx.values.length; r++) {
    var vals = ctx.values[r];
    if (!isFreeSlot_(vals, ctx.col, ctx.tz, now)) { continue; }
    var d = coerceDate_(vals[ctx.col.date], ctx.tz, dowIdx !== undefined ? vals[dowIdx] : '');
    if (dayKey_(d, ctx.tz) < cutoffKey) { continue; }   // LEAD_DAYS applies HERE only
    open.push({ date: d, values: vals, sheetRow: r + 1 });
  }
  open.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

  // De-duplicate by day key. findRowByDate_ resolves one row PER DATE and refuses
  // a date that appears twice as AMBIGUOUS, so offering a duplicated date puts an
  // option in the dropdown that no approval can ever complete: the speaker signs
  // up, waits, and the approve link dead-ends on "remove the duplicate". Drop the
  // date entirely and name it, rather than advertise something unapprovable.
  var i, key;
  var rowsByKey = {};                            // key -> [sheetRow, ...]
  for (i = 0; i < open.length; i++) {
    key = dayKey_(open[i].date, ctx.tz);
    if (!rowsByKey[key]) { rowsByKey[key] = []; }
    rowsByKey[key].push(open[i].sheetRow);
  }
  var deduped = [], dupList = [];
  for (i = 0; i < open.length; i++) {
    key = dayKey_(open[i].date, ctx.tz);
    if (rowsByKey[key].length === 1) { deduped.push(open[i]); continue; }
    if (open[i].sheetRow === rowsByKey[key][0]) {   // report each duplicated date once
      dupList.push(key + ' (rows ' + rowsByKey[key].join(', ') + ')');
    }
  }
  if (dupList.length && problems) {
    problems.push('These dates appear on more than one schedule row, so an approval for ' +
      'them would be refused as ambiguous. They were NOT offered on the form: ' +
      dupList.join('; ') + '. Delete the duplicate row(s).');
  }
  if (unreadable.length && problems) {
    problems.push(unreadable.length + ' schedule row(s) have a Date cell this script ' +
      'cannot read, so those weeks are invisible to the form and to approvals: rows ' +
      unreadable.join(', ') + '. Retype the Date cell as a real date (Format > Number > Date).');
  }
  open = deduped;

  var openCount = open.length;                   // BEFORE truncation \u2014 see below
  if (open.length > maxChoices) { open = open.slice(0, maxChoices); }

  var choices = open.map(function (slot) {
    // Contract with parseIsoPrefix_: leading yyyy-MM-dd, then human decoration.
    var iso = dayKey_(slot.date, ctx.tz);
    var dow = dowIdx !== undefined ? String(normCell_(slot.values[dowIdx])) : '';
    if (!dow) { dow = Utilities.formatDate(slot.date, ctx.tz, 'EEEE'); }
    var time = ctx.col.time !== undefined ? cellText_(slot.values[ctx.col.time], ctx.tz) : '';
    var room = ctx.col.room !== undefined ? cellText_(slot.values[ctx.col.room], ctx.tz) : '';
    var s = iso + ' \u2014 ' + dow + ' ' + fmtShort_(slot.date, ctx.tz);
    if (time) { s += ', ' + time; }
    if (room && room.toUpperCase() !== 'N/A') { s += ', ' + room; }
    return s;
  });

  var form = FormApp.openById(requireProp_('FORM_EDIT_ID'));
  var item = findDateItem_(form);
  if (!item) {
    problems.push('Could not find a "Preferred date" dropdown in the form. The date ' +
      'list was not refreshed. (Is the question titled exactly "Preferred date", and ' +
      'is it a Dropdown?)');
    return 'Form dropdown NOT refreshed (item not found). ' + choices.length + ' open slots.';
  }

  var props = getProps_();
  // Decided on the count BEFORE truncation, so "no open slots" can only ever mean
  // what it says. (maxChoices is clamped to >= 1, so the two counts agree today;
  // keying off openCount keeps that true if the clamp is ever loosened.)
  if (openCount === 0) {
    // setChoiceValues([]) THROWS. Without this guard the nightly job would start
    // crashing exactly when the last slot fills — i.e. precisely when nobody is
    // watching and the form silently keeps accepting requests.
    item.asListItem().setChoiceValues(
      ['(no open dates at the moment — please email ' + ORGANIZER_FALLBACK_EMAIL + ')']);
    if (props.getProperty('NO_SLOTS_ALERTED') !== 'YES') {
      problems.push('There are no open schedule slots at least ' +
        getNumProp_('LEAD_DAYS', 7) + ' days out. The form now shows a placeholder ' +
        'option. Add more rows to the schedule sheet.');
      props.setProperty('NO_SLOTS_ALERTED', 'YES');   // alert once, not every night
    }
    return 'No open slots; placeholder option installed.';
  }

  item.asListItem().setChoiceValues(choices);
  props.deleteProperty('NO_SLOTS_ALERTED');   // slots are back; re-arm the alert
  return 'Refreshed the date dropdown with ' + choices.length + ' open slot(s): ' +
         choices[0] + (choices.length > 1 ? ' … ' + choices[choices.length - 1] : '');
}

/** Locate the dropdown, preferring the cached id, falling back to a title match,
 *  and caching whatever it finds. A title match also asserts the item really is
 *  a LIST — setChoiceValues on a text item would throw. */
function findDateItem_(form) {
  var props = getProps_();
  var cached = props.getProperty('DATE_ITEM_ID');
  if (cached) {
    try {
      var byId = form.getItemById(Number(cached));
      if (byId && byId.getType() === FormApp.ItemType.LIST) { return byId; }
    } catch (ignored) { /* item deleted or id stale — fall through to title search */ }
  }
  var items = form.getItems();
  for (var i = 0; i < items.length; i++) {
    var t = normHeader_(items[i].getTitle());
    if (QUESTION_ALIASES.date.indexOf(t) >= 0 && items[i].getType() === FormApp.ItemType.LIST) {
      props.setProperty('DATE_ITEM_ID', String(items[i].getId()));
      return items[i];
    }
  }
  return null;
}

/* ── 7.3 expiry ───────────────────────────────────────────────────────────── */

function expireStalePending() {
  var problems = [];
  var n = expireStalePending_(problems);
  Logger.log('Expired ' + n + ' stale pending row(s).' +
             (problems.length ? '\n' + problems.join('\n') : ''));
  return n;
}

/**
 * PENDING rows whose requested date has passed, or which have sat undecided for
 * PENDING_MAX_AGE_DAYS, become EXPIRED. Their tokens then render the
 * already-handled page instead of offering an approval that would be refused
 * anyway. Nobody is emailed automatically — but a 45-day expiry means a real
 * person was never answered, so those rows are named in the nightly report, as
 * are requests that have simply been sitting undecided for a while.
 *
 * MUTATES UNDER THE SCRIPT LOCK, and re-reads each row's status immediately
 * before writing. Without both, the batch snapshot taken at the top of this
 * function can be stale by the time the loop reaches a row: an approval that
 * commits in between would be overwritten with EXPIRED, leaving the speaker on
 * the public schedule while the private log claims the request lapsed.
 */
function expireStalePending_(problems) {
  var sheet = openResponsesSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return 0; }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = resolveResponseCols_(header);
  if (cols.admin.STATUS < 0) {
    problems.push('The responses sheet has no "JC Status" column — run installStep1_bootstrap().');
    return 0;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var now = new Date();
  // The JC Date Key values were minted from the SCHEDULE spreadsheet's tz, so
  // "today" has to be measured on the same clock or the comparison mixes units.
  var tz = Session.getScriptTimeZone();
  try { tz = openSchedule_().tz; } catch (ignored) { /* fall back to script tz */ }
  var responsesTz = tz;
  try { responsesTz = sheet.getParent().getSpreadsheetTimeZone(); } catch (ignored) { }
  var todayKey = dayKey_(now, tz);
  var count = 0;
  var lapsed = [];
  var stalling = 0;

  var lock = LockService.getScriptLock();
  var haveLock = lock.tryLock(20000);
  if (!haveLock) {
    problems.push('expireStalePending could not obtain the script lock (an approval was ' +
      'probably in flight). Nothing was expired; it will retry tomorrow.');
    return 0;
  }
  try {
    for (var i = 0; i < data.length; i++) {
      var vals = data[i];
      if (String(vals[cols.admin.STATUS]).trim().toUpperCase() !== STATUS.PENDING) { continue; }

      var reason = '';
      // Read the RAW value and coerce: Sheets may have retyped this cell to a
      // Date, in which case a /^\d{4}-\d{2}-\d{2}$/ test on String(value) never
      // matches and this whole branch silently never fires.
      var dateKey = cols.admin.DATE_KEY >= 0
        ? normalizeDateKey_(vals[cols.admin.DATE_KEY], responsesTz) : '';
      var ts = cols.timestamp >= 0 ? vals[cols.timestamp] : null;
      var ageMs = (Object.prototype.toString.call(ts) === '[object Date]')
        ? (now.getTime() - ts.getTime()) : -1;

      if (dateKey && dateKey < todayKey) {
        reason = 'expired: requested date passed';
      } else if (ageMs > PENDING_MAX_AGE_DAYS * 86400000) {
        reason = 'expired: no decision in ' + PENDING_MAX_AGE_DAYS + ' days';
      } else if (ageMs > PENDING_NAG_DAYS * 86400000) {
        stalling++;
      }
      if (!reason) { continue; }

      var sheetRow = i + 2;   // +2: data starts at row 2
      // Re-read this one cell inside the lock. Cheap (a handful of rows a night)
      // and it is the whole defence against clobbering a fresh decision.
      var liveStatus = String(sheet.getRange(sheetRow, cols.admin.STATUS + 1).getValue())
                         .trim().toUpperCase();
      if (liveStatus !== STATUS.PENDING) { continue; }

      sheet.getRange(sheetRow, cols.admin.STATUS + 1, 1, 1).setValue(STATUS.EXPIRED);
      if (cols.admin.DECIDED_AT >= 0) {
        sheet.getRange(sheetRow, cols.admin.DECIDED_AT + 1, 1, 1).setValue(nowStamp_());
      }
      if (cols.admin.NOTE >= 0) {
        sheet.getRange(sheetRow, cols.admin.NOTE + 1, 1, 1).setValue(reason);
      }
      if (reason.indexOf('no decision') >= 0) {
        lapsed.push('row ' + sheetRow + ' (' + (dateKey || 'no date') + ')');
      }
      count++;
    }
    if (count) { SpreadsheetApp.flush(); }
  } finally {
    lock.releaseLock();
  }

  // Closing the loop on the submitter is a human step, so make the human aware.
  if (lapsed.length) {
    problems.push(lapsed.length + ' request(s) were expired after ' + PENDING_MAX_AGE_DAYS +
      ' days with no decision: ' + lapsed.join(', ') + '. Nobody was emailed about them — ' +
      'if any were real, write to those people yourself.');
  }
  if (stalling) {
    problems.push(stalling + ' request(s) have been PENDING for more than ' +
      PENDING_NAG_DAYS + ' days. Approve or reject them, or write to the people who sent ' +
      'them: ' + responsesUrl_());
  }
  return count;
}

/* ── 7.4 health checks ────────────────────────────────────────────────────── */

/** Public wrapper — run this from the editor after setup; it must report clean. */
function verifySetup() {
  var problems = [];
  try { verifySetup_(problems); }
  catch (err) { problems.push('verifySetup threw: ' + errText_(err)); }
  try { assertResponsesPrivate_(problems); }
  catch (err) { problems.push('CRITICAL: sharing check failed: ' + errText_(err)); }

  var report = problems.length
    ? 'FOUND ' + problems.length + ' PROBLEM(S):\n- ' + problems.join('\n- ')
    : 'All checks passed. Setup looks correct.';
  Logger.log(report);
  return report;
}

function verifySetup_(problems) {
  // ── configuration ──────────────────────────────────────────────────────────
  ['SCHEDULE_SS_ID', 'RESPONSES_SS_ID', 'FORM_EDIT_ID', 'NOTIFY_EMAIL',
   'EXEC_URL', 'HMAC_SECRET'].forEach(function (key) {
    if (getProp_(key).trim() === '') {
      problems.push('Script Property / CONFIG value "' + key + '" is empty.');
    }
  });
  var exec = getProp_('EXEC_URL').trim();
  if (exec && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(exec)) {
    problems.push('EXEC_URL is "' + exec + '". It must be the deployed /exec URL — a /dev ' +
      'URL only opens for script editors, so emailed links would be dead for everyone else.');
  }
  if (!safeEmail_(getProp_('NOTIFY_EMAIL'))) {
    problems.push('NOTIFY_EMAIL is not a valid address.');
  }
  if (getProp_('SCHEDULE_SS_ID').trim() &&
      getProp_('SCHEDULE_SS_ID').trim() === getProp_('RESPONSES_SS_ID').trim()) {
    problems.push('CRITICAL: RESPONSES_SS_ID equals SCHEDULE_SS_ID. The schedule file is ' +
      'PUBLIC and Google Sheets sharing is file-level, so form responses stored there ' +
      "would publish every submitter's email address. They must be different files.");
  }

  // An alert that could not be delivered when it happened. Surfacing it here as
  // well means it is visible from a manual verifySetup() run, not only from the
  // next alert email that happens to get through.
  var stuck = getProps_().getProperty('LAST_UNSENT_ALERT');
  if (stuck) {
    problems.push('An earlier alert could NOT be emailed and is still queued in the ' +
      'LAST_UNSENT_ALERT script property:\n' + String(stuck).slice(0, 1500));
  }

  // ── schedule schema ────────────────────────────────────────────────────────
  var ctx = null;
  try {
    ctx = openSchedule_();
  } catch (err) {
    problems.push('Cannot read the schedule: ' + errText_(err));
  }
  if (ctx) {
    // TIMEZONE AGREEMENT. Every calendar-day key in this system is produced with
    // Utilities.formatDate under some timezone, and the two sides of a
    // comparison must use the same one. If the schedule spreadsheet's own tz
    // drifts from the script's, findRowByDate_ can match the WRONG WEEK — the
    // one failure mode that puts a speaker on the wrong Monday. This is the
    // single check that catches it, and the spreadsheet tz is set in Sheets
    // (File > Settings > Time zone), not in Apps Script.
    var scriptTz = Session.getScriptTimeZone();
    if (ctx.tz !== scriptTz) {
      problems.push('Timezone mismatch: the schedule spreadsheet is on "' + ctx.tz +
        '" but this Apps Script project is on "' + scriptTz + '". Dates can land one day ' +
        'off. Fix it in the schedule sheet: File > Settings > Time zone, or in Apps ' +
        'Script: Project Settings > Time zone. They must match.');
    }
    try {
      var rTz = SpreadsheetApp.openById(getProp_('RESPONSES_SS_ID').trim())
                              .getSpreadsheetTimeZone();
      if (rTz !== scriptTz) {
        problems.push('Timezone mismatch: the responses spreadsheet is on "' + rTz +
          '" but this Apps Script project is on "' + scriptTz + '". Set both to ' +
          'Eastern Time (File > Settings > Time zone).');
      }
    } catch (tzErr) { /* the responses sheet is reported on separately below */ }

    ['day of week', 'time', 'room', 'affiliation', 'advisor', 'topic'].forEach(function (name) {
      if (ctx.col[name] === undefined) {
        problems.push('Schedule column "' + name + '" not found — approvals will simply ' +
          'skip it, but check the header row is what you expect.');
      }
    });
    var openCount = 0, now = new Date();
    for (var r = 1; r < ctx.values.length; r++) {
      if (isFreeSlot_(ctx.values[r], ctx.col, ctx.tz, now)) { openCount++; }
    }
    if (openCount === 0) {
      problems.push('The schedule has no free future slots at all. Add rows before ' +
        'advertising the form.');
    }
    // A handful of retyped Date cells leaves openCount healthy, so the check
    // above cannot see them — see unreadableDateRows_ for why silence there is
    // the dangerous case.
    var badDates = unreadableDateRows_(ctx);
    if (badDates.length) {
      problems.push(badDates.length + ' schedule row(s) have a Date cell that cannot be ' +
        'read, so those weeks are invisible to the sign-up form and cannot be approved: ' +
        'rows ' + badDates.join(', ') + '. Retype them as real dates ' +
        '(Format > Number > Date), not as text.');
    }
  }

  // ── responses schema ───────────────────────────────────────────────────────
  try {
    var sheet = openResponsesSheet_();
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var cols = resolveResponseCols_(header);
    if (cols.email < 0) {
      problems.push('No email column in the responses sheet. Turn on Form settings > ' +
        'Responses > Collect email addresses (Responder input), otherwise you cannot ' +
        'reply to anyone. Headers seen: ' + header.join(' | '));
    }
    if (cols.q.speaker < 0) {
      problems.push('No "Speaker name" question found in the responses sheet. Headers ' +
        'seen: ' + header.join(' | '));
    }
    if (cols.q.date < 0) {
      problems.push('No "Preferred date" question found in the responses sheet. Headers ' +
        'seen: ' + header.join(' | '));
    }
    ADMIN_ORDER.forEach(function (name) {
      if (cols.admin[adminKeyFor_(name)] < 0) {
        problems.push('Admin column "' + name + '" is missing — run installStep1_bootstrap().');
      }
    });
    // Notifications that were dropped for quota in the last week: these are
    // submissions Yiyang never heard about, and nothing else would surface them.
    if (cols.admin.NOTIFIED >= 0 && cols.timestamp >= 0 && sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      var cutoff = Date.now() - 7 * 86400000;
      var lost = 0;
      for (var i = 0; i < data.length; i++) {
        var ts = data[i][cols.timestamp];
        var notified = String(data[i][cols.admin.NOTIFIED]).trim().toUpperCase();
        if (notified && notified !== 'YES' &&
            Object.prototype.toString.call(ts) === '[object Date]' &&
            ts.getTime() > cutoff) { lost++; }
      }
      if (lost) {
        problems.push(lost + ' submission(s) in the last 7 days have JC Notified != YES ' +
          '(QUOTA = the mail quota ran out, CAPPED = more than ' + MAX_NOTIFY_PER_DAY +
          ' sign-ups arrived that day so digest mode kicked in) — you were never emailed ' +
          'about them individually. Open the private log and review them by hand: ' +
          responsesUrl_());
      }
    }
  } catch (err) {
    problems.push('Cannot read the responses sheet: ' + errText_(err));
  }

  // ── form ───────────────────────────────────────────────────────────────────
  try {
    var form = FormApp.openById(requireProp_('FORM_EDIT_ID'));
    if (!findDateItem_(form)) {
      problems.push('The form has no Dropdown question titled "Preferred date".');
    }
    if (!form.isAcceptingResponses()) {
      problems.push('The form is not accepting responses, so the sign-up page leads ' +
        'nowhere. Turn responses back on in the form editor.');
    }
  } catch (err) {
    problems.push('Cannot open the form (FORM_EDIT_ID): ' + errText_(err) +
      '. Note it is the id from /forms/d/<ID>/edit, NOT from /forms/d/e/<LONG>/viewform.');
  }

  // ── triggers ───────────────────────────────────────────────────────────────
  try {
    var counts = { onSignupSubmit: 0, nightlyMaintenance: 0 };
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (counts[h] !== undefined) { counts[h]++; }
    });
    ['onSignupSubmit', 'nightlyMaintenance'].forEach(function (h) {
      if (counts[h] === 0) {
        problems.push('No trigger installed for ' + h + '() — run installStep2_triggers().');
      } else if (counts[h] > 1) {
        // Duplicates mean duplicate notification emails and duplicate nightly work.
        problems.push(counts[h] + ' triggers installed for ' + h + '() — run ' +
          'installStep2_triggers() to collapse them back to one.');
      }
    });
  } catch (err) {
    problems.push('Cannot read project triggers: ' + errText_(err));
  }

  // ── mail quota ─────────────────────────────────────────────────────────────
  try {
    var remaining = MailApp.getRemainingDailyQuota();
    if (remaining < 20) {
      problems.push('Only ' + remaining + ' email recipients left today (consumer Gmail ' +
        'allows 100/day). Notifications may be dropped.');
    }
  } catch (err) {
    problems.push('Cannot read the mail quota: ' + errText_(err));
  }

  return problems;
}

/** 'JC Token' -> 'TOKEN'. Small helper so verifySetup can iterate ADMIN_ORDER. */
function adminKeyFor_(headerName) {
  for (var k in ADMIN) {
    if (Object.prototype.hasOwnProperty.call(ADMIN, k) && ADMIN[k] === headerName) { return k; }
  }
  return '';
}

/**
 * THE most important check in the file.
 *
 * A3 holds every submitter's email address, abstract and private notes. If it
 * ever becomes link-shared — two clicks in the Drive UI, no warning, no other
 * detection — all of that is public. Google Sheets sharing is file-level, so
 * "just this one tab" is not a thing.
 *
 * This is why the manifest asks for a Drive scope. drive.readonly is used rather
 * than full drive so a compromised script still cannot delete anything; if
 * getSharingAccess() ever starts throwing an authorization error, widen it to
 * https://www.googleapis.com/auth/drive and re-authorize.
 *
 * THREE mechanisms can expose this file, and getSharingAccess() only sees one:
 *   1. link sharing            -> getSharingAccess() != PRIVATE
 *   2. per-person sharing      -> invisible to getSharingAccess(); it reports
 *                                 GENERAL access, not the individual grant list,
 *                                 so adding a co-organizer as Viewer would read
 *                                 clean forever. Hence the viewer/editor check.
 *   3. File > Share > Publish to web -> exposes /pubhtml, /gviz/tq and /export
 *                                 to the world WITHOUT touching the ACL, so
 *                                 (1) and (2) both still report clean. Hence the
 *                                 anonymous fetch below, which tests the
 *                                 property we actually care about \u2014 "can a
 *                                 stranger read this?" \u2014 instead of a proxy.
 */
function assertResponsesPrivate_(problems) {
  var id = getProp_('RESPONSES_SS_ID').trim();
  if (!id) { return; }   // already reported by verifySetup_

  var file = DriveApp.getFileById(id);
  var access = file.getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) {
    problems.push('CRITICAL: the private responses spreadsheet is link-shared (' + access +
      '). It contains every submitter\u2019s email address. Open ' + responsesUrl_() +
      ' > Share > General access and set it back to Restricted immediately.');
  }

  // (2) individual grants
  try {
    var ownerEmail = '';
    try { ownerEmail = String(file.getOwner().getEmail() || '').toLowerCase(); }
    catch (ignored) { ownerEmail = ''; }
    var others = [];
    [].concat(file.getViewers(), file.getEditors()).forEach(function (u) {
      var e = String(u.getEmail() || '').toLowerCase();
      if (e && e !== ownerEmail && others.indexOf(e) < 0) { others.push(e); }
    });
    if (others.length) {
      problems.push('CRITICAL: the responses spreadsheet is shared with ' + others.length +
        ' other person/people (' + others.join(', ') + '). It contains every ' +
        'submitter\u2019s email address and every live approval token. Open ' +
        responsesUrl_() + ' > Share and remove them.');
    }
  } catch (err) {
    problems.push('Could not list who the responses spreadsheet is shared with: ' +
      errText_(err));
  }

  // (3) publish-to-web / anything else that makes it anonymously readable.
  // followRedirects:false matters: a private file 302s to the sign-in page, and
  // following that would return 200 and produce a false alarm every night.
  try {
    var res = UrlFetchApp.fetch(
      'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv',
      { muteHttpExceptions: true, followRedirects: false });
    if (res.getResponseCode() === 200) {
      problems.push('CRITICAL: the responses spreadsheet answered an UNAUTHENTICATED ' +
        'request with HTTP 200 \u2014 a stranger can read it right now. The usual cause is ' +
        'File > Share > Publish to web, which does NOT show up in the Share dialog\u2019s ' +
        'General access setting. Open ' + responsesUrl_() +
        ' > File > Share > Publish to web > Stop publishing, and check Share > General ' +
        'access says Restricted.');
    }
  } catch (err) {
    problems.push('Could not test whether the responses spreadsheet is anonymously ' +
      'readable: ' + errText_(err) + '. (This check needs the ' +
      'script.external_request OAuth scope \u2014 check appsscript.json.)');
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  INSTALLERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Step 1 — run from the editor after filling CONFIG.
 * Idempotent: safe (and expected) to re-run after pasting EXEC_URL.
 *
 *  * copies non-empty CONFIG values into Script Properties
 *  * generates HMAC_SECRET once, if absent
 *  * appends missing "JC " admin columns to the responses sheet
 *  * runs the full verification and logs the report
 */
function installStep1_bootstrap() {
  var props = getProps_();
  var lines = [];

  // Seed properties that DO NOT EXIST YET, and never touch one that does.
  //
  // This used to force-sync every non-empty CONFIG value over the top of the
  // Script Properties, which quietly undid the settings the setup guide asks you
  // to type: a DEFAULT_ROOM deliberately blanked came back as "Davey 339", a
  // SCHEDULE_TAB_GID pointing at a second tab reverted to 0 (so approvals could
  // land in the wrong tab of a public file), and a renamed RESPONSES_TAB_NAME
  // reverted to Google's default. Re-running bootstrap is now genuinely
  // harmless, exactly as the guide promises.
  var seeded = [], differing = [];
  for (var key in CONFIG) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG, key)) { continue; }
    var v = String(CONFIG[key] === null || CONFIG[key] === undefined ? '' : CONFIG[key]);
    if (v.trim() === '') { continue; }
    var existing = props.getProperty(key);
    if (existing === null) {
      props.setProperty(key, v);
      seeded.push(key);
    } else if (existing !== v) {
      differing.push(key + ' (yours: "' + existing + '", CONFIG default: "' + v + '")');
    }
  }
  lines.push('Properties seeded from CONFIG defaults: ' +
             (seeded.length ? seeded.join(', ') : '(none — all already set)'));
  if (differing.length) {
    lines.push('Properties you have set differently from the CONFIG defaults — LEFT ' +
               'UNCHANGED, which is intended: ' + differing.join('; '));
  }

  // HMAC secret: generated once and never rotated automatically — rotating it
  // invalidates every confirm page currently open, which is a fine emergency
  // measure but a terrible surprise.
  if (!props.getProperty('HMAC_SECRET')) {
    // Apps Script has no crypto.getRandomValues; two UUIDv4s give ~244 bits of
    // entropy, folded to 32 bytes through SHA-256.
    var seedMaterial = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' +
                       Date.now() + '|' + Math.random();
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seedMaterial);
    props.setProperty('HMAC_SECRET', Utilities.base64Encode(bytes));
    lines.push('Generated a new HMAC_SECRET (32 bytes).');
  } else {
    lines.push('HMAC_SECRET already present — left alone.');
  }

  // Admin columns, plus the plain-text number format that keeps JC Date Key and
  // JC Decided At from being silently retyped as Dates by Sheets. The format
  // pass runs unconditionally so an install created before this fix is repaired
  // by re-running the bootstrap.
  try {
    var sheet = openResponsesSheet_();
    ensureAdminColumns_(sheet);
    var hdr = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    forceAdminTextFormat_(sheet, headerMap_(hdr));
    lines.push('Admin columns present and formatted as plain text on "' +
               sheet.getName() + '".');
  } catch (err) {
    lines.push('COULD NOT prepare the responses sheet: ' + errText_(err));
  }

  // Schedule sanity.
  try {
    var ctx = openSchedule_();
    lines.push('Schedule OK: tab "' + ctx.sheet.getName() + '", ' +
               (ctx.values.length - 1) + ' data rows, timezone ' + ctx.tz + '.');
  } catch (err) {
    lines.push('COULD NOT read the schedule: ' + errText_(err));
  }

  var report = lines.join('\n') + '\n\n' + verifySetup();
  Logger.log(report);
  return report;
}

/**
 * Step 2 — install exactly two installable triggers.
 *
 * Existing triggers for these handlers are deleted first. Without that, every
 * re-run would STACK another trigger: two on-submit triggers means two
 * notification emails per sign-up, and the per-user limit is 20.
 *
 * The submit trigger is bound to the SPREADSHEET, not the form — see the
 * comment on onSignupSubmit for why.
 */
function installStep2_triggers() {
  var handlers = ['onSignupSubmit', 'nightlyMaintenance'];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  var responsesSs = SpreadsheetApp.openById(requireProp_('RESPONSES_SS_ID'));
  ScriptApp.newTrigger('onSignupSubmit')
    .forSpreadsheet(responsesSs)
    .onFormSubmit()
    .create();

  ScriptApp.newTrigger('nightlyMaintenance')
    .timeBased()
    .everyDays(1)
    .atHour(4)                            // 04:00, well clear of any human editing
    .inTimezone('America/New_York')
    .create();

  var msg = 'Removed ' + removed + ' old trigger(s); installed onSignupSubmit ' +
            '(on form submit, from the responses spreadsheet) and nightlyMaintenance ' +
            '(daily ~04:00 America/New_York).';
  Logger.log(msg);
  return msg;
}

/**
 * Convenience for a rainy day: rotate the nonce secret. This invalidates every
 * confirm page currently open in a browser (the emailed links themselves keep
 * working — they just have to be re-opened to mint a fresh nonce).
 */
function rotateHmacSecret() {
  var seedMaterial = Utilities.getUuid() + '|' + Utilities.getUuid() + '|' +
                     Date.now() + '|' + Math.random();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seedMaterial);
  getProps_().setProperty('HMAC_SECRET', Utilities.base64Encode(bytes));
  var msg = 'HMAC_SECRET rotated. Open review links must be reloaded from the email.';
  Logger.log(msg);
  return msg;
}
