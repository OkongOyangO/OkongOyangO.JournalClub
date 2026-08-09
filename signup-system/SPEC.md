# Journal Club Speaker Sign-Up — Architecture Specification

**Status:** authoritative build spec. Downstream agents implement exactly this.
**Date:** 2026-08-08
**Site:** `/Users/jiangyiyang/My_Academic_HomePage/OkongOyangO.JournalClub`
**Owner account:** `jiangyiyang2019@gmail.com` (consumer Gmail, not Workspace)

This document is decisive. Where recon offered alternatives, one has been chosen and the
others are closed. Deviating requires re-opening the relevant hazard.

---

## 0. Design summary in one paragraph

A public **Google Form** collects speaker requests. Responses land in a **separate, private
spreadsheet** (never the public schedule file). A single **standalone Apps Script project**
holds everything: an installable **on-form-submit** trigger that mints a token and emails
Yiyang an Approve/Reject pair of links; a **Web App** whose `doGet` is strictly read-only
(defeating email link-prefetch) and whose `doPost` performs the single mutating write into
the **public schedule spreadsheet** under a script lock with fresh re-validation; and a
**nightly maintenance trigger** that refreshes the Form's date dropdown from the schedule's
genuinely-free slots and alarms on misconfiguration. The Hugo site gains a `/signup/` page,
a menu entry, and a CTA button inside the existing Upcoming Seminars card, all gated on a
`[params.signup]` block so the site can ship before the Form exists.

---

## 1. End-to-end data flow and artifact inventory

### 1.1 Named artifacts

| # | Artifact | Kind | Owner | Visibility | Identifier |
|---|---|---|---|---|---|
| A1 | **JC Schedule** | Google Sheet | Yiyang | **PUBLIC** (Anyone-with-link → Viewer) | `1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4`, tab gid `0` |
| A2 | **JC Speaker Sign-Up** | Google Form | Yiyang | **PUBLIC** (published, link-accessible) | edit ID → `FORM_EDIT_ID` |
| A3 | **JC Signup Responses (PRIVATE — DO NOT SHARE)** | Google Sheet | Yiyang | **PRIVATE** (no link sharing, ever) | → `RESPONSES_SS_ID`, tab `Form Responses 1` |
| A4 | **JC Signup Bot** | Apps Script project, **standalone**, V8 runtime, tz `America/New_York` | Yiyang | private | — |
| A5 | **JC Signup Approvals** | Web App deployment of A4 | Yiyang | Execute as **Me**, access **Anyone** | `/exec` URL → `EXEC_URL` |
| A6 | Site sign-up surface | Hugo page `/signup/`, menu item, in-card CTA | repo | public | — |

**Hard rule (from recon):** A3 must be a *different spreadsheet file* from A1. Sheets sharing
is file-level; a tab inside A1 would be readable anonymously via `/htmlview`,
`/gviz/tq?sheet=Form%20Responses%201`, and `/export?format=csv&gid=N` — and *queryable* via
`tq=select ...`. A3 contains submitter email addresses. Never merge them.

### 1.2 Triggers (exactly two)

| ID | Handler | Type | Source | Schedule |
|---|---|---|---|---|
| T1 | `onSignupSubmit` | installable, **On form submit** | **From spreadsheet** = A3 | event-driven |
| T2 | `nightlyMaintenance` | installable, time-driven | — | `everyDays(1).atHour(4).inTimezone("America/New_York")` |

Both are installable (simple triggers cannot send mail or open other files). Both are created
by `installStep2_triggers()`, which deletes existing triggers with the same handler name first
— re-running the installer must never stack duplicates (limit: 20 triggers/user/script;
duplicates would send duplicate notification emails).

**T1 must be spreadsheet-bound, not form-bound.** Rationale: `e.range` gives the exact row to
write the token into, the responses row is the single durable record, and it avoids
`FormResponse.getItemResponses()` silently dropping unanswered non-text items.
`e.source` is *not* documented for the Sheets form-submit event — derive the spreadsheet from
`e.range.getSheet().getParent()` if ever needed.

### 1.3 The flow

```
 ┌─ SUBMIT ───────────────────────────────────────────────────────────────────┐
 │ 1. Visitor lands on https://OkongOyangO.github.io/OkongOyangO.JournalClub/  │
 │    → clicks "Sign up to present" (in-card CTA or menu) → /signup/ page      │
 │ 2. Reads how approval works; fills the embedded Form (A2)                   │
 │ 3. Google Forms records a row in A3 "Form Responses 1"                      │
 │ 4. Forms sends the responder a copy of their answers (native feature)       │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │  T1 fires (installable, runs as Yiyang)
                                    ▼
 ┌─ NOTIFY ───────────────────────────────────────────────────────────────────┐
 │ 5. onSignupSubmit reads the row + header row by NAME                        │
 │ 6. Parses ISO date key from the "Preferred date" answer                     │
 │ 7. Mints token = Utilities.getUuid()                                        │
 │ 8. Writes JC Token / JC Status=PENDING / JC Date Key into the same row      │
 │ 9. Reads A1 read-only to report the slot's CURRENT state in the email       │
 │10. MailApp.sendEmail → jiangyiyang2019@gmail.com, replyTo = submitter       │
 │    body contains two links:                                                 │
 │      {EXEC_URL}?t={token}&a=approve                                         │
 │      {EXEC_URL}?t={token}&a=reject                                          │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │  Yiyang clicks (or a scanner prefetches)
                                    ▼
 ┌─ REVIEW  (HTTP GET — ZERO WRITES ANYWHERE) ────────────────────────────────┐
 │11. doGet looks the token up in A3, reads A1 for live slot state,            │
 │    renders a review page + a POST form carrying a stateless HMAC nonce.     │
 │    A link-scanner's GET does exactly this and changes nothing.              │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │  Yiyang clicks the single confirm button
                                    ▼
 ┌─ DECIDE  (HTTP POST — the only mutating request) ──────────────────────────┐
 │12. doPost validates nonce → takes LockService.getScriptLock()               │
 │13. Re-reads A3 row: if not PENDING → idempotent "already processed" page    │
 │14. APPROVE: re-resolves A1 columns by header, re-finds the row by ISO key,  │
 │    re-runs isFreeSlot on FRESH values. Only then writes Speaker /           │
 │    Affiliation / Advisor / Topic (+Room if empty). flush(). Release.        │
 │15. Marks A3 row APPROVED|REJECTED + JC Decided At + JC Decision Note        │
 │16. On approve only: emails the submitter a confirmation                     │
 │17. Renders the outcome page to Yiyang                                       │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 ┌─ PUBLISH ──────────────────────────────────────────────────────────────────┐
 │18. A1 is public; the site's Upcoming Seminars widget fetches it client-side │
 │    on the next page load. No rebuild, no deploy. The talk appears.          │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─ NIGHTLY (T2, ~04:00 America/New_York) ────────────────────────────────────┐
 │ • refreshFormDates: recompute genuinely-free slots from A1, rewrite the     │
 │   "Preferred date" dropdown choices                                         │
 │ • expireStalePending: PENDING rows whose date has passed → EXPIRED          │
 │ • verifySetup: schema, config, mail quota                                   │
 │ • assertResponsesPrivate: alarm if A3 has become link-shared                │
 │ • Emails Yiyang ONLY if something is wrong                                  │
 └────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Script Properties (the only configuration surface)

Code contains no IDs. Everything lives in `PropertiesService.getScriptProperties()`.

| Key | Value | Set by |
|---|---|---|
| `SCHEDULE_SS_ID` | `1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4` | user, step 1 |
| `SCHEDULE_TAB_GID` | `0` | user, step 1 |
| `RESPONSES_SS_ID` | id of A3 | user, step 1 |
| `RESPONSES_TAB_NAME` | `Form Responses 1` | user, step 1 |
| `FORM_EDIT_ID` | id from `/forms/d/<ID>/edit` — **not** the `/forms/d/e/<LONG>/viewform` id | user, step 1 |
| `NOTIFY_EMAIL` | `jiangyiyang2019@gmail.com` | user, step 1 |
| `EXEC_URL` | the `/exec` URL, copied after the **first** deployment | user, step 3 |
| `HMAC_SECRET` | 32 random bytes, base64 | auto, `installStep1_bootstrap()` |
| `DATE_ITEM_ID` | id of the "Preferred date" ListItem | auto, first `refreshFormDates()` |
| `DEFAULT_ROOM` | `Davey 339` (set `""` to disable) | user, step 1 |
| `LEAD_DAYS` | `7` | default |
| `MAX_CHOICES` | `30` | default |
| `NO_SLOTS_ALERTED` | internal dedupe flag | auto |

**`EXEC_URL` must be a stored property, never `ScriptApp.getService().getUrl()`** — under V8
that returns the `/dev` URL when the head deployment executes (issuetracker 170799249,
won't-fix). A `/dev` URL in an email is openable only by script editors.

**Redeploy rule, in the setup guide in bold:** always
`Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy`.
Never `Deploy → New deployment` — that mints a new deployment ID and a new `/exec` URL,
silently orphaning every approve link already sitting in Yiyang's inbox. Archive superseded
deployments so a stale URL cannot keep serving old code.

---

## 2. The Google Form

### 2.1 Form-level settings

| Setting | Value | Why |
|---|---|---|
| Collect email addresses | **Responder input** | `Verified` would exclude non-Google users; `Do not collect` leaves Yiyang unable to reply |
| Limit to 1 response | **Off** | requires Google sign-in |
| Edit after submit | **Off** | an edited response does not re-fire T1 in a way we handle; the record must be immutable |
| Send responders a copy | **Always** | free acknowledgement, zero code |
| Confirmation message | see §2.3 | sets the approval expectation |
| Response destination | **Create a new spreadsheet** → A3 | must be a NEW file, not a tab in A1 |
| Publish | **Published**, responder access = anyone with the link | since Dec 2024 a form is unreachable until Publish is clicked |

### 2.2 Questions — EXACT titles (these become response-sheet headers and handler keys)

Order matters only for the respondent. The handler resolves everything by normalized title
(`trim → lowercase → collapse whitespace → strip U+00A0`), so later edits are safe.

| # | **EXACT title** | Type | Required | Description shown to respondent | → Schedule column |
|---|---|---|---|---|---|
| — | *(auto)* `Email Address` | collected | yes | — | *(none — private)* |
| Q1 | `Speaker name` | Short answer | **Yes** | "Exactly as it should appear on the public schedule." | **Speaker** |
| Q2 | `Affiliation` | Short answer | **Yes** | "Department or institution, e.g. PSU, Cornell, UIUC." | **Affiliation** |
| Q3 | `Advisor` | Short answer | No | "Leave blank if not applicable (faculty, postdoc, or independent)." | **Advisor** |
| Q4 | `Preferred date` | **Dropdown** | **Yes** | "Only currently-open dates are listed. The list is refreshed nightly." | *(row selector, not written)* |
| Q5 | `Talk title` | Short answer | No | "Leave blank if undecided — the schedule will show 'Topic to be announced'." | **Topic** |
| Q6 | `Abstract or short description` | Paragraph | No | "A few sentences on the paper or topic. Only Yiyang sees this; it is not published." | *(none)* |
| Q7 | `Other dates that would also work` | Paragraph | No | "If your first choice is taken, what else could you do?" | *(none)* |
| Q8 | `Anything else Yiyang should know?` | Paragraph | No | — | *(none)* |

Notes that are load-bearing:

- **`Room` is deliberately not asked.** Room is Yiyang's to assign. The script writes
  `DEFAULT_ROOM` into Room **only if that cell is currently empty**.
- **`Date`, `Day of Week`, `TIme` are never written.** The sheet owns them. `15 July 2026` is
  a Wednesday row at `2:00pm - 3:00pm`; these fields are not derivable from the date.
- **`Talk title` is optional on purpose.** Three currently-booked rows have an empty Topic, and
  the site already renders empty Topic as *"Topic to be announced"*.
- The collected-email header text is assumed to be `Email Address`. The resolver accepts any
  of `email address`, `email`, `e-mail address`, `username` (older Forms) and hard-fails at
  **setup-verification** time if none is present. At **submit** time a missing/blank email is
  non-fatal: the notification says `(no email captured)` and omits `replyTo`.

### 2.3 Q4 choice string format — the contract between Form and script

```
{ISO}  —  {DayOfWeek} {DisplayDate}, {TIme}[, {Room}]
```

Example: `2026-09-14 — Monday 14 September, 4:30pm - 6:00pm, Davey 339`

- `{ISO}` = `Utilities.formatDate(dateCell, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd")`.
- The `, {Room}` tail is appended only when Room is non-empty and not `N/A`.
- **The script parses only the leading `/^\s*(\d{4})-(\d{2})-(\d{2})/`.** Everything after is
  human decoration and may be mangled in transit without consequence.
- The ISO prefix guarantees choice uniqueness. `"22 June"` alone is unique today only by luck
  (the sheet spans ~9 months); it collides the moment the schedule exceeds 12 months.
- If the leading ISO does not parse, the submission is marked `ERROR` and Yiyang gets an
  alert with **no action links**.

### 2.4 Confirmation message (Form settings → Presentation)

> Thanks — your request has been sent to Yiyang for review.
>
> Nothing appears on the public schedule until it is approved. You'll hear back by email.
> If your preferred date gets taken in the meantime, Yiyang will write to you about
> alternatives.

---

## 3. Private responses spreadsheet (A3) — exact schema

One tab: `Form Responses 1`. Columns A..N are **owned by Google Forms** (`Timestamp`,
`Email Address`, then one per question, in form order). Google inserts/removes columns in that
block when questions change; because every read resolves by header name, that is safe.

**Admin columns are appended to the right of the last form-owned column**, each prefixed
`JC ` so it can never collide with a question title. `installStep1_bootstrap()` appends any
missing admin header at `getLastColumn() + 1`; it is idempotent.

| Header | Written by | Values | Lifecycle |
|---|---|---|---|
| `JC Token` | T1 at submit | UUIDv4 (`Utilities.getUuid()`) | write-once. Primary key for the approve/reject URLs. Never reused, never regenerated. |
| `JC Status` | T1, then doPost / nightly | `PENDING` → `APPROVED` \| `REJECTED` \| `EXPIRED` \| `ERROR` | `PENDING` at submit. Exactly one transition out of `PENDING`, under the script lock. Any later hit on the token renders the idempotent "already processed" page. `ERROR` is set at submit for malformed rows. |
| `JC Date Key` | T1 at submit | `yyyy-MM-dd`, or `""` on parse failure | write-once. The only value used to locate the schedule row. |
| `JC Decided At` | doPost / nightly | ISO-8601 local, e.g. `2026-08-12T14:31:07-04:00` | set with the status transition; blank while `PENDING` |
| `JC Decision Note` | doPost / T1 / nightly | free text | e.g. `approved → schedule row 15`, `rejected by organizer`, `expired: date passed`, `ERROR: unparseable date key`, `ERROR: schedule schema drift — missing column 'speaker'` |
| `JC Schedule Row` | doPost on approve | integer, 1-indexed sheet row of A1 | audit trail for manual undo |
| `JC Notified` | T1 | `YES` \| `QUOTA` \| `CAPPED` \| `ERROR: <msg>` | whether the notification email actually left. `QUOTA` = the daily send quota was nearly gone; `CAPPED` = more than `MAX_NOTIFY_PER_DAY` sign-ups that day, so digest mode. Anything other than `YES` is reported by the nightly job. |

**No nonce columns.** The confirm-page nonce is stateless (§4.3), so `doGet` writes nothing.

**Sharing:** A3 is never shared with anyone, never link-shared, never published to web. The
nightly job asserts this and alarms if it changes (§7.4).

---

## 4. Approve / reject URL scheme, token design, and the H2 defence

### 4.1 The threat, restated

Gmail/Outlook/corporate scanners issue GETs against URLs found in email. Microsoft Safe Links
documents that "URLs are scanned prior to message delivery, regardless of whether the URLs are
rewritten or not" and that unknown URLs "are detonated asynchronously in the background."
RFC 8058 exists precisely because automated fetches were triggering unsubscriptions. A bare
`GET …&a=approve` that mutates would **auto-approve every submission with no human involved.**

### 4.2 The scheme

| Request | Effect |
|---|---|
| `GET {EXEC_URL}` (no params) | static "Nothing to do here." page. No reads of substance. |
| `GET {EXEC_URL}?t={token}&a=approve` | **read-only** review page + confirm-POST form |
| `GET {EXEC_URL}?t={token}&a=reject` | **read-only** review page + confirm-POST form |
| `POST {EXEC_URL}` body `t=…&a=approve\|reject&n={nonce}` | **the only mutating request** |

Parameter names are `t`, `a`, `n`. **Never `c` or `sid`** — those are reserved by Apps Script
and cause HTTP 405.

`doGet` is fully idempotent and safe to call an unbounded number of times. A scanner that
fetches both links, twice, in any order, changes nothing.

### 4.3 Token and nonce

**Token** — `Utilities.getUuid()`, ~122 bits of entropy, stored in `JC Token`.
It is a **bearer credential**: possession of the token is the sole authorization. It is
single-use by construction (`JC Status` leaves `PENDING` exactly once).

**Nonce** — stateless HMAC, minted fresh by `doGet` on every render, never stored:

```js
var BUCKET_MS = 30 * 60 * 1000;
function currentBucket_() { return Math.floor(Date.now() / BUCKET_MS); }
function nonceFor_(token, action, bucket) {
  var raw = Utilities.computeHmacSha256Signature(
      token + "|" + action + "|" + bucket, getProp_("HMAC_SECRET"));
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, "").slice(0, 22);
}
// doGet  → nonceFor_(t, a, currentBucket_())
// doPost → accept if n === nonceFor_(t, a, b) for b in {currentBucket_(), currentBucket_()-1}
```

Validity window: 30–60 minutes. Expired nonce → a page saying "this confirmation page has
expired, open the link from the email again". **No mutation on nonce failure.**

**What the nonce is and is not.** It is an *anti-prefetch* measure only. Anyone holding the
token can perform the GET themselves to obtain a valid nonce, so the nonce adds **zero**
authorization strength. Its job is exactly one thing: a POST cannot be produced by an
automated GET. Do not describe it as security in the setup guide.

### 4.4 `doGet` — exact behaviour (ZERO writes)

1. `t = e.parameter.t`, `a = e.parameter.a`. If either missing, or `a ∉ {approve, reject}`, or
   `t` fails `/^[0-9a-fA-F-]{36}$/` → render `page_("Nothing to do here", …)`. Return.
2. Open A3, read the `JC Token` column only (`getRange(2, tokenCol, lastRow-1, 1).getValues()`)
   and locate the row. Not found → `"Unknown or expired request."` (deliberately vague).
3. Read that one row with `getDisplayValues()`.
4. If `JC Status ≠ PENDING` → **already-processed page** (§8.4). Idempotent.
5. Read A1 read-only and compute the slot's live state for `JC Date Key`:
   `FREE` / `TAKEN(<name>)` / `BREAK` / `NOT_IN_SCHEDULE` / `AMBIGUOUS` / `SCHEMA_ERROR`.
6. Render the **review page** (§8.1): every submitted field (contextually escaped), the live
   slot state with a warning banner if not `FREE`, one `<form method="post" action="{EXEC_URL}"
   target="_top">` with hidden `t`, `a`, `n`, and one submit button. Also render the opposite
   action as an ordinary GET link so Yiyang can flip approve↔reject without going back to mail.

`doGet` performs **no** `setValue`, no Properties write, no Cache write.

**The review page must not display the submitter's email address.** It shows name,
affiliation, advisor, date, title, abstract, alternates, notes. The email exists only in the
notification email and in A3. This shrinks the blast radius of a leaked token.

### 4.5 `doPost` — exact behaviour (the only mutator)

1. `t`, `a`, `n` from `e.parameter`. Validate shape; validate `n` against buckets
   `{current, current-1}`. Failure → expired/invalid page. **No mutation.**
2. `var lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) → "Busy" page.`
   (`getDocumentLock()` returns `null` in standalone scripts and web apps — never use it.)
3. `try { … } finally { lock.releaseLock(); }`
4. **Inside the lock**, re-read the A3 row by token. Not found → unknown page.
   `JC Status ≠ PENDING` → already-processed page. **No mutation.**
5. **REJECT:** set `JC Status=REJECTED`, `JC Decided At`, `JC Decision Note="rejected by
   organizer"`. `SpreadsheetApp.flush()`. Render the reject page, which points Yiyang at the
   submitter's row in the private log and suggests wording. **No automated rejection email is
   sent** — a canned rejection is wrong for a ten-person journal club. **The page must not
   contain the submitter's address**, in a `mailto:` href or anywhere else: the review page
   deliberately withholds it (§9 threat model), and an outcome page that hands it back defeats
   that in one anonymous POST. `pageBlocked_` is worse still — it is reachable with no state
   change at all, so an address there could be harvested without a trace in the log.
6. **APPROVE:**
   1. `resolveScheduleCols_()` — by header name, **no positional fallback**. Missing `date` or
      `speaker` → set `JC Status=ERROR` + note, render schema-drift page, alert Yiyang.
   2. `findRowByDate_(JC Date Key)` → `NOT_IN_SCHEDULE` / `AMBIGUOUS` / `OK` (§6.2).
      Non-OK → **leave `JC Status = PENDING`**, render an explanatory page. The token stays
      live so Yiyang can retry after fixing the sheet.
   3. `isFreeSlot_()` on the **freshly read** row values (§6.1). Not free → **leave
      `JC Status = PENDING`**, render the slot-taken page naming the current occupant (§8.5).
   4. Write, per-cell, **only** these and **only** by resolved index:
      - `Speaker` ← `sanitizeForSheet_(Q1, 80)` (always; non-empty by form requirement)
      - `Affiliation` ← `sanitizeForSheet_(Q2, 80)` — skip the cell if the sanitized value is empty
      - `Advisor` ← `sanitizeForSheet_(Q3, 80)` — skip if empty
      - `Topic` ← `sanitizeForSheet_(Q5, 200)` — skip if empty
      - `Room` ← `DEFAULT_ROOM` **iff** the current Room cell is exactly `""` and `DEFAULT_ROOM`
        is non-empty
      Use `range.setValue()` per cell, never a whole-row `setValues()` — a whole-row write
      would touch the `Date` / `Day of Week` / `TIme` cells.
   5. `SpreadsheetApp.flush()` (inside the lock).
   6. Set `JC Status=APPROVED`, `JC Decided At`, `JC Schedule Row`, `JC Decision Note`.
7. **After releasing the lock:** send the approval confirmation email to the submitter (§8.7),
   guarded by `MailApp.getRemainingDailyQuota()`.
8. Render the success page (§8.3).

### 4.6 Sheet-write sanitization (formula injection — not previously flagged)

Every string that reaches A1 passes through:

```js
function sanitizeForSheet_(s, maxLen) {
  s = String(s == null ? "" : s);
  s = s.replace(/\u00A0/g, " ");
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ");  // control chars incl. CR/LF/TAB
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[=+@]+\s*/, "");               // formula-injection guard
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trim() + "…";
  return s;
}
```

`Range.setValue("=IMPORTRANGE(...)")` creates a **live formula** in the *public* schedule.
Leading `=`, `+`, `@` are stripped. A leading `-` is deliberately **not** stripped — it is
legitimate in physics topics and does not create a formula via `setValue`. Newlines are
collapsed because the schedule is a one-line-per-cell display. Lengths are capped so a
pathological submission cannot make the public sheet unreadable.

---

## 5. Concurrency and re-validation (H3)

**Rules, all mandatory:**

1. **Every mutation of A1 happens inside `LockService.getScriptLock()`.** `tryLock(30000)` (not
   `waitLock`, so a timeout renders a friendly page instead of a stack trace), released in a
   `finally`.
2. **`SpreadsheetApp.flush()` before releasing**, so the write is committed inside the critical
   section.
3. **Never trust the slot state captured at submit time.** The email's "slot free" line is
   informational and may be minutes-to-weeks stale. `isFreeSlot_` is re-evaluated on values
   read *inside* the lock, immediately before the write.
4. **A lost race does not consume the token.** If the slot is taken at approval time, status
   stays `PENDING`. Yiyang can reject it, or fix the schedule and click again.
5. **`onSignupSubmit` takes no lock**, because it never mutates A1 — it only reads. The one
   exception is the `ensureAdminColumns_()` branch (which appends header cells to A3); that
   branch, and only that branch, is wrapped in the script lock, and it no-ops when the headers
   already exist.
6. **T1, `doGet`, `doPost` and T2 must live in the SAME Apps Script project.** Script locks are
   project-scoped. Splitting them across two projects silently disables all locking.
7. **The lock does not protect against Yiyang hand-editing A1 in the browser.** The re-read →
   write window is milliseconds, and Sheets version history makes it recoverable. Accepted
   residual risk (§10.4).
8. Reads inside the lock are batched: one `getDataRange().getValues()` for the schedule, one
   header `getValues()`. Per-cell `getValue()` loops inside a lock risk the 30 s timeout.

**Double-booking walkthrough.** Alice and Bob both request `2026-09-14`; both rows are
`PENDING`; Yiyang has two emails. He approves Alice: lock → row found → Speaker `""` → free →
write → `APPROVED`. He then opens Bob's link: `doGet` already shows the banner *"This slot is
now taken by Alice Chen."* If he clicks confirm anyway, `doPost` re-checks under the lock,
finds `Speaker = "Alice Chen"`, writes nothing, leaves Bob `PENDING`, and renders §8.5, which
shows the alternates Bob listed in Q7 and points at his row in the private log. **No silent
overwrite is possible.**

---

## 6. `isFreeSlot_` and `findRowByDate_` — exact logic

Grounded in the verified live data: column A is genuinely date-typed
(`{"id":"A","label":"Date","type":"date","pattern":"d mmmm"}`) with real underlying years
spanning `Date(2026,5,22)` … `Date(2027,2,15)`. **Server-side there is no year to infer.**

### 6.1 `isFreeSlot_(rowValues, col, tz, now)`

```
d = coerceDate_(rowValues[col.date], tz)
if (d === null)                    return false   // spacer / formatted-but-empty trailing row
speaker = normCell_(rowValues[col.speaker])
if (speaker !== "")                return false   // BOOKED, or "N/A" = intentional break week
if (dayKey_(d, tz) <= dayKey_(now, tz)) return false   // strictly future; today excluded
return true
```

- **Speaker is the ONLY discriminator.** Verified: three currently-booked rows have an *empty*
  Topic (`17 August`/You-Chiuan Chen, `31 August`/Jinfei Zhou, `21 September`/Wangqian Miao).
  A "Topic empty ⇒ free" test would overwrite three real talks. A test inspecting Room would
  misclassify any slot where Yiyang pre-filled `Davey 339`.
- **`"N/A"` is an intentional break week, never free.** Free is `Speaker === ""` *exactly*.
  Break rows are uniformly `N/A` across Room/Speaker/Affiliation/Advisor/Topic. The site's
  existing JS conflates `""` and `"N/A"` as "not a talk"; the script must not inherit that.
- **`LEAD_DAYS` is applied only when generating dropdown choices, never in approval
  re-validation.** Yiyang may legitimately approve a request for next Monday.

### 6.2 Supporting functions

```js
function normHeader_(s) {
  return String(s == null ? "" : s)
      .replace(/\u00A0/g, " ").trim().toLowerCase().replace(/\s+/g, " ");
}   // "TIme" -> "time";  "Day of Week" -> "day of week"

function normCell_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") return v;
  return String(v == null ? "" : v).replace(/\u00A0/g, " ").trim();
}

function dayKey_(d, tz) { return Utilities.formatDate(d, tz, "yyyy-MM-dd"); }
// MUST be Utilities.formatDate with the SPREADSHEET timezone.
// d.toISOString() is UTC and shifts a midnight-local date to the adjacent calendar day.
```

**Column resolution — by name, hard-fail, no positional fallback:**

```js
var REQUIRED_SCHEDULE_COLS = ["date", "speaker"];
var OPTIONAL_SCHEDULE_COLS = ["day of week", "time", "room", "affiliation", "advisor", "topic"];

function resolveScheduleCols_(headerRow) {
  var col = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = normHeader_(headerRow[i]);
    if (h !== "" && col[h] === undefined) col[h] = i;   // first wins on duplicates
  }
  REQUIRED_SCHEDULE_COLS.forEach(function (name) {
    if (col[name] === undefined) {
      throw new Error("Schedule schema changed: missing column '" + name +
                      "'. Headers seen: " + headerRow.join(" | "));
    }
  });
  return col;
}
```

The site's read-only JS used to fall back to fixed positions (`date→0, time→1, speaker→2,
topic→last`). That is **not** harmless even for rendering: index 2 in this sheet is `TIme`, so
renaming the `Speaker` header made the home page announce that every future week was booked by a
speaker named `4:30pm - 6:00pm`, break weeks included, while the form went on offering six of
those dates. The widget now fails closed on a missing `date` or `speaker` header exactly as the
script does — it renders nothing and the build-time static fallback survives. `time` and `topic`
keep their positional fallbacks; they are decoration.

`coerceDate_` reads the real `Date` object. It retains a *text* fallback only for the case where
someone retypes a cell as text, and that fallback is built on three rules:

- **Every Date is constructed in the SPREADSHEET's timezone** (`dateInTz_`), never with
  `new Date(y, m, d)`, which is midnight in the *script* project's timezone — a different
  setting. With the script east of the sheet, the whole text-typed column keyed one day early:
  the row reading `2026-09-14` answered to `2026-09-13`, the dropdown option's ISO prefix
  disagreed with its own human half, and the speaker was emailed the wrong day.
- **Impossible dates return `null`.** `dateInTz_` round-trips through `dayKey_`, so `2026-02-29`
  no longer rolls over to 1 March and then answers to a request key for a week it is not.
- **A year-less `24 August` needs the row's own `Day of Week` cell** to pick the year in
  `{y-1, y, y+1}` (verified to disambiguate uniquely: 2026 matches 28/39 rows, 2027 the other
  11). Without a usable weekday hint it returns **`null` rather than guessing**. Every tie-break
  was measurably wrong on the real sheet — nearest-year resolved 6 of 39 rows into the past,
  prefer-future was wrong for the 7 rows that really are past — and a wrong guess writes a
  speaker onto the wrong week. It must **not** use the site's `>200 days` rule either.

Because "unreadable" is now a real outcome, `unreadableDateRows_(ctx)` walks the sheet and names
every row whose Date cell is non-empty but unreadable. `refreshFormDates_` and `verifySetup_`
both surface that list. This closes the case the free-slot count cannot see: retyping the WHOLE
column drops the open count to zero and everything shouts, but retyping three cells leaves the
count healthy while those weeks silently stop being offered and an already-submitted request for
one of them is refused as "not in the schedule".

### 6.3 `findRowByDate_(isoKey, sheet, col, tz)`

```
values = sheet.getDataRange().getValues()      // index 0 is the header
hits = []
for r in 1 .. values.length-1:
    d = coerceDate_(values[r][col.date], tz)
    if (d === null) continue                   // trailing formatted-blank rows
    if (dayKey_(d, tz) === isoKey) hits.push({ sheetRow: r + 1, values: values[r], date: d })
if (hits.length === 0) return { status: "NOT_IN_SCHEDULE" }
if (hits.length  >  1) return { status: "AMBIGUOUS", rows: hits }
return { status: "OK", row: hits[0] }
```

- `sheetRow = arrayIndex + 1` (Sheets is 1-indexed, row 1 is the header). An off-by-one here
  writes the approved speaker into the wrong week — possibly over an existing talk.
- **Never compute a row index arithmetically from a date.** Monday `2026-07-13` has no row at
  all, and `2026-07-15` is a Wednesday row at `2:00pm - 3:00pm`. The sheet is not
  one-row-per-Monday. There is also no "first free row after the last booked row" heuristic:
  `14 Sep` FREE, `21 Sep` BOOKED, `28 Sep` FREE.
- `NOT_IN_SCHEDULE` (e.g. the schedule ran out — the last row today is `15 March 2027`) **fails
  loudly**. It must never append a row: Day-of-Week and TIme would have to be invented.

### 6.4 Target sheet resolution

```js
var gid = Number(getProp_("SCHEDULE_TAB_GID") || 0);
var sheet = ss.getSheets().filter(function (s) { return s.getSheetId() === gid; })[0]
         || ss.getSheets()[0];
```
Then immediately `resolveScheduleCols_(header)`, which throws if this is the wrong tab.

---

## 7. Nightly maintenance (T2)

`nightlyMaintenance()` runs four independent steps, each in its own `try/catch`, accumulating
problems into a list. **It emails Yiyang only if the list is non-empty.** Subject:
`[JC signup] Nightly check found N issue(s)`.

### 7.1 `refreshFormDates()`

1. Open A1, resolve columns, read all values.
2. Collect rows where `isFreeSlot_(row)` and the row's day key is at least `LEAD_DAYS`
   **calendar days** past today, both keys taken in the spreadsheet's timezone
   (`dayKey_(date) >= shiftDayKey_(dayKey_(now), LEAD_DAYS)`). This is deliberately not
   `date − now ≥ LEAD_DAYS × 86400000`: the nightly trigger fires at 04:00 and slots are
   midnight, so a millisecond window is four hours short and `LEAD_DAYS = 7` silently
   behaved as 8; a spring-forward week is 23 hours shorter again, which removed the
   schedule's last free slot and replaced the whole dropdown with the placeholder.
3. Sort ascending. **De-duplicate by day key**: a date on two rows is refused by
   `findRowByDate_` as `AMBIGUOUS`, so offering it would advertise a slot no approval can
   complete. Such dates are withheld and named in `problems`.
4. Cap at `MAX_CHOICES` (30), clamped to a minimum of 1 on read — `MAX_CHOICES <= 0`
   otherwise truncated the list to nothing and was indistinguishable from a full schedule.
   The placeholder branch below is decided on the count **before** truncation.
5. Build choice strings per §2.3. Time and Room go through `cellText_`, which FORMATS a
   Date-typed cell rather than stringifying it — a time-typed `TIme` cell otherwise put
   `Sat Dec 30 1899 16:30:00 GMT-0500` into the dropdown and into the speaker's email.
6. Locate the dropdown: `DATE_ITEM_ID` from properties; if absent, find the item whose title
   normalizes to `preferred date`, assert `getType() === FormApp.ItemType.LIST`, and store its
   id. Item not found or wrong type → record a problem, do not throw.
7. `item.asListItem().setChoiceValues(choices)`.
8. **Zero-free-slot guard:** `setChoiceValues([])` **throws**. If `choices.length === 0`, set
   `["(no open dates at the moment — please email yzj5306@psu.edu)"]` and record a problem —
   but only alert once, using the `NO_SLOTS_ALERTED` property as a dedupe flag, cleared as soon
   as slots reappear. Without this the job starts crashing exactly when the last slot fills,
   which is exactly when nobody is watching.

### 7.2 Staleness between sync and submit — the accepted failure mode

The dropdown is a **UX nicety, never a correctness mechanism.** Three windows exist:

| Window | What happens | Handled by |
|---|---|---|
| Slot taken between two nightly runs | dropdown offers a taken date | submit handler flags it in the notification email; approval blocks |
| Respondent has the form page open when the slot fills | stale snapshot, submits a taken date | same |
| Two respondents pick the same free date | both `PENDING`, both offered | approval-time re-validation under lock (§5) |

The submit handler **cannot** reject a submission (the response is already recorded by Google);
it can only annotate. The **only** authoritative gate is `isFreeSlot_` re-run under the script
lock in `doPost`.

### 7.3 `expireStalePending()`

`PENDING` rows whose `JC Date Key` is strictly before today, or whose `Timestamp` is more than
45 days old → `JC Status = EXPIRED`, `JC Decided At = now`,
`JC Decision Note = "expired: requested date passed"` / `"expired: no decision in 45 days"`.
No email to anyone. Their tokens then render the already-processed page.

Three constraints, each of which was a real bug:

- **Runs under the script lock, and re-reads each row's status immediately before writing.**
  The batch snapshot taken at the top can be stale by the time the loop reaches a row, and an
  approval committing in between would otherwise be overwritten with `EXPIRED` — leaving the
  speaker on the public schedule while the private log says the request lapsed.
- **Reads `JC Date Key` as a raw value and coerces it**, rather than regex-testing
  `String(cell)`. Sheets may have stored a Date object there, in which case a
  `/^\d{4}-\d{2}-\d{2}$/` test never matches and the entire "requested date has passed" branch
  is silently unreachable. (`forceAdminTextFormat_` prevents new occurrences; the tolerant read
  handles anything already in the sheet.)
- **"Today" is keyed off the SCHEDULE spreadsheet's timezone**, the same clock that produced
  the stored date keys, not `Session.getScriptTimeZone()`.

The 45-day branch and any row `PENDING` for more than 7 days are named in the nightly report.
Expiry emails nobody, and that is right for a date that has simply passed — but a request that
sat undecided for six weeks is a person who was never answered, and silence there should not
be automatic.

### 7.4 `verifySetup()` + `assertResponsesPrivate()`

Read-only health check, also callable manually from the editor:

- every Script Property present and non-empty; `EXEC_URL` matches `/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/`
  (**explicitly reject a `/dev` URL**)
- A1 resolves `date` + `speaker` by header
- A3 resolves the email column and all seven `JC ` admin headers
- the `Preferred date` ListItem exists and is a `LIST`
- exactly one trigger per handler name
- `MailApp.getRemainingDailyQuota()` ≥ 20
- any `JC Notified != YES` rows from the last 7 days (`QUOTA`, `CAPPED`, `ERROR: …`) → report
  them: those are submissions Yiyang was never individually emailed about
- both spreadsheets' `getSpreadsheetTimeZone()` must equal `Session.getScriptTimeZone()` —
  a drift here is the only way an approval can land on the wrong week
- a queued `LAST_UNSENT_ALERT` script property (an alarm that could not be delivered)
- requests left `PENDING` for more than 7 days, and requests expired at 45 days — both are
  people who were never answered
- **A3 must not be readable by anyone but the owner**, checked three ways because
  `getSharingAccess()` alone sees only one of them:
  1. `getSharingAccess() === Access.PRIVATE` (link sharing);
  2. `getViewers()` / `getEditors()`, minus the owner, must be empty (per-person sharing,
     which `getSharingAccess()` does not report at all);
  3. an **unauthenticated** `UrlFetchApp.fetch(https://docs.google.com/spreadsheets/d/<A3>/gviz/tq?tqx=out:csv,
     {muteHttpExceptions: true, followRedirects: false})` must **not** return 200 — this is
     what catches **Publish to web**, which exposes the data without changing the ACL.
     `followRedirects: false` is required: a private file 302s to the sign-in page and
     following it would return 200 every night.

  Anything else (`ANYONE`, `ANYONE_WITH_LINK`, `DOMAIN*`, a named viewer, a published file) is
  a **CRITICAL** alarm — that state publishes every submitter's email address and every live
  approval token.

These checks cost a read-only Drive scope and an external-request scope on the consent screen.
**They are worth it**: A3 becoming readable is the single worst failure mode of the entire
design, and every route to it is a two-click mistake with no other detection.

Enforcement, separately from detection: `openResponsesSheet_` **throws** if `RESPONSES_SS_ID`
ever equals `SCHEDULE_SS_ID`, so the one misconfiguration that would publish the whole queue
writes nothing rather than being merely reported by a mail channel that can be starved.

---

## 8. Page and email copy

All user-supplied text is rendered with `<?= ?>` (contextual escaping), **never `<?!= ?>`**.
Speaker / Affiliation / Advisor / Talk title / Abstract are attacker-controlled and this page
runs in Yiyang's own session. Every page has `<base target="_top">` in `<head>` — the
HtmlService iframe sandbox does not grant `allow-top-navigation`, so links and form submits
silently do nothing without it. Leave `XFrameOptionsMode` at `DEFAULT` (clickjacking
protection on); the pages are never embedded in the Hugo site.

### 8.1 Review page — `GET …&a=approve` (to Yiyang)

> ### Approve this journal club sign-up?
>
> | | |
> |---|---|
> | Speaker | **Jane Doe** |
> | Affiliation | Cornell |
> | Advisor | Eun-Ah Kim |
> | Requested date | **Monday 14 September 2026**, 4:30pm – 6:00pm |
> | Talk title | Fractionalization in twisted bilayers |
> | Abstract | *(as submitted)* |
> | Other possible dates | *(as submitted)* |
> | Notes | *(as submitted)* |
> | Submitted | 12 Aug 2026, 09:14 |
>
> **✅ This slot is currently free.**
>
> Approving writes **Jane Doe / Cornell / Eun-Ah Kim / Fractionalization in twisted bilayers**
> into row 15 of the public schedule, and emails Jane a confirmation.
> Date, day and time are not changed. Room will be set to *Davey 339* (currently blank).
>
> `[ Confirm approval — write to the schedule ]`   ← the only POST on the page
>
> Changed your mind? → *Reject this request instead* (plain GET link)
>
> ---
> *Nothing has been changed yet. This page is safe to open, close, and reopen.*

That last line is not decoration — it tells Yiyang, correctly, that the link he just clicked
did nothing, which is the whole point of the two-step design.

If the slot is **not** free, the ✅ line is replaced by a red banner and the confirm button is
still present but relabelled `Confirm anyway (will be blocked if still taken)` — since the POST
re-validates, letting him try is harmless and avoids a dead end when the sheet has since changed.

### 8.2 Review page — `GET …&a=reject`

Same table, then:

> Rejecting records the decision privately. **No email is sent to Jane** — the outcome page
> points you at her row in the private log and suggests wording, so you write to her yourself.
>
> `[ Confirm rejection ]`
>
> Changed your mind? → *Approve this request instead*

### 8.3 Approval succeeded (to Yiyang)

> ### ✅ Approved and written to the schedule
>
> **Jane Doe** is now on the schedule for **Monday 14 September 2026**, row 15.
> A confirmation email has been sent to Jane.
> The public site will show the talk on its next page load — no rebuild needed.
>
> *Open the schedule* → (link to A1) · *Open the private log* → (link to A3)
>
> To undo: clear Speaker / Affiliation / Advisor / Topic in row 15 by hand.

If the approval **replaced** text that was already in Affiliation / Advisor / Topic — a free row
can carry hand-written notes, because `isFreeSlot_` looks only at Speaker — both the review page
(before the click) and this page (after it) list the old value beside the new one, and
`JC Decision Note` records it permanently as `REPLACED topic: "…"`. Room is never overwritten at
all, so it never appears in that list.

### 8.4 Already processed (idempotent — the replay page)

> ### Already handled
>
> This request was **approved** on 12 Aug 2026, 14:31 (schedule row 15).
> Nothing has been changed by opening this link.
>
> *(status word and details vary: approved / rejected / expired / error)*

### 8.5 Slot no longer free (status stays PENDING)

> ### ⚠️ Not written — that slot is taken
>
> **Monday 14 September 2026** is now assigned to **Alice Chen (PSU)**.
> Jane's request has been left pending, so this link still works.
>
> Jane said she could also do: *"any Monday in October"*
>
> To offer Jane another date, open the private log — her address is on row 7.
> `[ Reject this request ]`
>
> (No `mailto:` and no address in the HTML — see §7 step 5.)

Break-week variant: *"14 September is marked N/A — an intentional break week. Nothing was
written."* Not-found variant: *"14 September is not in the schedule sheet. The schedule
currently ends on 15 March 2027 — add the row first, then click again."*

### 8.6 Error and edge pages

| Condition | Page |
|---|---|
| No params | "Nothing to do here. This page only works from a link in a sign-up notification email." |
| Unknown token | "Unknown or expired request." (deliberately vague) |
| Expired nonce | "This confirmation page has expired. Open the link in the email again — nothing was changed." |
| Lock timeout | "Another approval is being processed. Nothing was changed — please click Confirm again in a few seconds." |
| Schema drift | "The schedule sheet's columns have changed and I can't safely write to it. Missing column: 'speaker'. Headers found: … Nothing was changed." |

### 8.7 Emails

**Notification to Yiyang** (T1) — subject
`[JC signup] Jane Doe — 14 September 2026 (slot free)`
`replyTo` = submitter's address. HTML body: the field table (including her email, unlike the
web page), the live slot state, then two large buttons — green **Review & approve** →
`?t=…&a=approve`, grey **Review & reject** → `?t=…&a=reject` — under the line
*"Both links open a review page. Nothing changes until you confirm there."*

**Confirmation to the submitter** (on approve only):

> Subject: You're on the Journal Club schedule — Monday 14 September
>
> Hi Jane,
>
> Your journal club talk is confirmed for **Monday 14 September 2026, 4:30pm – 6:00pm,
> Davey 339**. It's now on the public schedule:
> https://OkongOyangO.github.io/OkongOyangO.JournalClub/
>
> Listed topic: *Fractionalization in twisted bilayers* — reply to this email if you'd like it
> changed, or if anything comes up.
>
> — Yiyang

Sent with `MailApp` (narrow `script.send_mail` scope; `GmailApp`'s full-mailbox scope is not
needed and produces a scarier consent screen). The From address is always
`jiangyiyang2019@gmail.com`; the `name` option changes only the display name. The `noReply`
option is Workspace-only and must not be used on this consumer account.

**Quota discipline.** Consumer Gmail allows **100 recipients/day** (not 1,500 — that is
Workspace). A spam flood must not silently starve legitimate notifications, and — the harder
half — it must not silence the report that says notifications are being starved. Three
mechanisms, all required together:

1. **Floor per send.** Routine mail is skipped when
   `MailApp.getRemainingDailyQuota() < MAIL_QUOTA_FLOOR` (5); the row records
   `JC Notified = QUOTA`.
2. **Reserved floor for alarms.** `alertOwner_` passes `minQuota = 1`, so the last sends of
   the day always belong to "something is wrong" rather than routine traffic. Anything it
   *still* cannot send is persisted to the `LAST_UNSENT_ALERT` script property and prepended
   to the next alert that gets through; `verifySetup()` also reports a queued one, and
   `nightlyMaintenance` logs the failure to Executions (the one channel that does not depend
   on mail at all).
3. **Cap on notification volume.** At most `MAX_NOTIFY_PER_DAY` (20) individual sign-up
   notifications are sent per calendar day. Beyond that, one "unusual sign-up volume" alert
   goes out and further rows are recorded `JC Notified = CAPPED`. This is what actually makes
   the quota un-exhaustible through the public form: submission count can no longer drive
   send count.

---

## 9. Site-side changes

Base rules from recon that constrain every line below:
subdirectory deployment means **pipe local paths through `relURL` with no leading slash**;
menu items use **`pageRef`**, never `url`, for internal targets; all CSS goes in
`assets/css/_custom.scss` (`layouts/partials/extend_head.html` is inherited dead code the theme
never references); every rule needs a light version and a `[theme="dark"]` version.

### 9.1 `hugo.toml` — add to `[params]`

Insert immediately before the `# Page Configuration` comment:

```toml
  # Speaker sign-up (approval-gated). The CTA renders only once formURL is set,
  # so this block can ship before the Google Form exists.
  [params.signup]
    enable   = true
    formURL  = ""   # https://forms.gle/XXXXXXXX  (the published responder link)
    embedURL = ""   # https://docs.google.com/forms/d/e/1FAIpQLS.../viewform?embedded=true
    label    = "Sign up to present"
    note     = "Requests are reviewed before they appear on the schedule."
```

And add a third menu entry:

```toml
  [[menu.main]]
    identifier = "signup"
    pre = "<i class='fas fa-user-plus fa-fw'></i>"
    name = "Sign Up"
    pageRef = "/signup"
    weight = 3
```

The menu item ships immediately and unconditionally — menu entries cannot read `[params.*]`,
and the target page degrades to a perfectly sensible "opening soon" notice (§9.6).

### 9.2 Modify `layouts/partials/home/upcoming-seminar.html`

Add near the existing `$sheetCSV` / `$sheetView` definitions:

```gotemplate
{{- $signupPage := "signup/" | relURL -}}
```

Replace line 38 (the lone `<a class="us-schedule">`) with:

```gotemplate
    <div class="us-actions">
        {{- with .Site.Params.signup -}}
        {{- if and (ne .enable false) .formURL -}}
        <a class="us-signup" href="{{ $signupPage }}"><i class="fas fa-user-plus fa-fw" aria-hidden="true"></i>&nbsp;{{ .label | default "Sign up to present" }}</a>
        {{- end -}}
        {{- end -}}
        <a class="us-schedule" href="{{ $sheetView }}" target="_blank" rel="noopener noreferrer">Full schedule <i class="fas fa-external-link-alt fa-fw" aria-hidden="true"></i></a>
    </div>
```

Three things are deliberate:

- **The CTA lives *inside* `<aside class="upcoming-seminar">`.** At ≥1600 px the card becomes
  `position: fixed; right: 1.5rem; width: 14rem` (`_custom.scss:220`). A CTA added as a sibling
  after the partial gets orphaned at the top-left of the content column — screenshot-verified,
  it looks broken. Inside the aside, it travels with the card in both layouts.
- **It links to the local `/signup/` page, not the raw form**, so the approval explanation is
  always in front of people. `$signupPage` is computed outside the `with` block; inside `with`,
  `.` is rebound to the signup map and `$.Site` would be needed for anything site-level.
- **`ne .enable false`, not `.enable`** — an omitted `enable` still counts as on, matching the
  theme's own `{{- if ne $profile.enable false -}}` idiom.

### 9.3 Create `layouts/shortcodes/gform.html`

```gotemplate
{{- $src := .Get "src" -}}
{{- if not $src -}}{{- with site.Params.signup -}}{{- $src = .embedURL -}}{{- end -}}{{- end -}}
{{- $height := .Get "height" | default "1200px" -}}
{{- with $src -}}
<div class="gform-embed">
    <iframe src="{{ . | safeURL }}" height="{{ $height }}" loading="lazy" frameborder="0" marginheight="0" marginwidth="0" title="Journal Club speaker sign-up form">Loading the sign-up form…</iframe>
</div>
{{- end -}}
```

The `with`-guarded `.embedURL` read is required: `site.Params.signup` is nil when the block is
absent, and `index nil "embedURL"` errors. Google Forms iframes **do not auto-resize** — the
pixel height is authoritative and the form scrolls internally, hence the parameter.

### 9.4 Modify `assets/css/_custom.scss`

Inside the existing `.upcoming-seminar { … }` block, add before `.us-schedule`:

```scss
    .us-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.55rem;
        margin-top: 0.85rem;
    }

    .us-signup {
        display: inline-flex;
        align-items: center;
        padding: 0.38rem 0.75rem;
        border-radius: 6px;
        font-size: 0.78rem;
        font-weight: 600;
        color: #fff;
        background-color: $single-link-color;
        text-decoration: none;
        transition: background-color 0.2s ease, transform 0.1s ease;

        &:hover { background-color: $single-link-hover-color; transform: translateY(-1px); }
    }
```

and change `.us-schedule`'s `margin-top: 0.85rem` → `margin-top: 0` (the spacing moved to
`.us-actions`).

Inside the existing `[theme="dark"] .upcoming-seminar { … }` block add:

```scss
    .us-signup { background-color: $single-link-color-dark; color: #16181a; }
    .us-signup:hover { background-color: $single-link-hover-color-dark; color: #16181a; }
```

`color: #16181a` is required, not optional: `$single-link-color-dark` is `#55bde2`, a light
blue, and white text on it fails contrast. The existing `.us-tag` already does exactly this.

Append at the end of the file:

```scss
// ── Sign-up page ──────────────────────────────────────────────────────────────
.gform-embed {
    display: block;
    width: 100%;
    max-width: 100%;
    margin: 1.2rem 0;
    border: 1px solid $global-border-color;
    border-radius: 6px;
    background-color: $code-background-color;

    iframe { display: block; width: 100%; max-width: 100%; border: 0; }
}

.signup-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.55rem 1.1rem;
    border-radius: 6px;
    font-weight: 600;
    color: #fff !important;
    background-color: $single-link-color;
    text-decoration: none !important;
    transition: background-color 0.2s ease, transform 0.1s ease;

    &:hover { background-color: $single-link-hover-color; transform: translateY(-1px); }
}

.signup-note {
    margin-top: 0.6rem;
    font-size: 0.85rem;
    color: $global-font-secondary-color;
}

// The theme right-aligns titles on every _default/single.html page
// (themes/LoveIt/assets/css/_page/_special.scss). Undo it for /signup/.
.page.single.special .single-title { text-align: left; }

[theme="dark"] {
    .gform-embed {
        border-color: $global-border-color-dark;
        background-color: $code-background-color-dark;
    }
    .signup-btn { background-color: $single-link-color-dark; color: #16181a !important; }
    .signup-btn:hover { background-color: $single-link-hover-color-dark; color: #16181a !important; }
    .signup-note { color: darken($global-font-color-dark, 18%); }
}
```

Two non-negotiables here. `color: … !important` and `text-decoration: none !important` on
`.signup-btn`, because `themes/LoveIt/assets/css/_page/_single.scss:131` applies
`@include link(false, false)` to every `<a>` inside `.content` (same reason `.pdf-download`
carries them). And `darken($global-font-color-dark, 18%)` for muted dark text, **not**
`$global-font-secondary-color-dark` (`#5d5d5f`), which is near-invisible on `#292a2d`.

### 9.5 Create `content/signup.md`

```yaml
---
title: "Sign Up to Present"
date: 2026-08-01T10:00:00-04:00
comment: false
---
```

Never future-date this file — Hugo drops future-dated content and the page would 404 in
production while building fine locally.

Body, in order:

1. One paragraph: who the journal club is for, that anyone at PSU (or visiting) may present.
2. **How it works** — a four-step list: pick an open date → submit the form → Yiyang reviews →
   you get a confirmation email and the talk appears on the schedule. State plainly that
   *nothing appears on the public schedule until it is approved*.
3. **What to expect** — 4:30–6:00pm Mondays in Davey 339, ~60–90 min including discussion,
   slides or board both fine, PDF notes welcome afterwards.
4. The embed / CTA block, guarded:

```gotemplate
{{< gform >}}

{{ with .Site.Params.signup }}{{ if and (ne .enable false) .formURL }}
<p><a class="signup-btn" href="{{ .formURL }}" target="_blank" rel="noopener noreferrer">Open the sign-up form in a new tab</a></p>
<p class="signup-note">{{ .note }}</p>
{{ else }}
<p class="signup-note">Sign-ups aren't open yet — email <a href="mailto:yzj5306@psu.edu">yzj5306@psu.edu</a> and Yiyang will slot you in by hand.</p>
{{ end }}{{ end }}
```

5. A closing line linking to the full schedule.

Two markdown hazards on this page specifically: `[markup.goldmark.extensions.passthrough]`
treats `$…$` as inline math, so avoid stray `$`; and `typographer = true` rewrites straight
quotes in prose (raw HTML blocks are untouched).

The page is automatically excluded from the home post list and RSS (both filter
`where .Site.RegularPages "Type" "posts"`) and is included in the Lunr search index, which is
desirable. No `hiddenFromSearch`.

### 9.6 Degradation matrix

| State | In-card CTA | Menu item | `/signup/` page |
|---|---|---|---|
| `[params.signup]` absent entirely | nothing | present | "Sign-ups aren't open yet" + mailto |
| block present, `formURL = ""` | nothing | present | same |
| `enable = false` | nothing | present | same |
| `formURL` set, `embedURL` empty | button | present | explanation + "Open the form in a new tab" |
| both set | button | present | explanation + embedded form + tab link |

Every state builds clean with exit 0 and no warnings.

### 9.7 REQUIRED prerequisite: fix the widget's year bug

**This is not optional and must ship with, or before, the approval flow.**
**Status: written, built into `docs/`, and NOT YET COMMITTED.** Because GitHub Pages serves
the committed `docs/` folder on `main`, nothing is live until `git add -A && git commit &&
git push` is run — which is why the setup guide now opens with **Part 0** telling the user to
do exactly that before Part A. Part K7 validates an approval against this widget, so testing
against the old one would fail for the wrong reason.

`layouts/partials/home/upcoming-seminar.html:100` currently infers the year from the `"24 August"`
display string:

```js
if (d < today0 && (today0 - d) > 200 * 864e5) { d = new Date(now.getFullYear() + 1, mon, day); }
```

Evaluated on 2026-08-08 this mis-dates **8 of 39 rows** — `25 January`, `1/8/15/22 February`,
`1/8/15 March` all resolve to 2026 instead of 2027 and are then dropped by the `d <= today0`
past filter. They are free slots today so nothing visibly breaks. **The moment the approval
script writes a speaker into `1 March`, the homepage widget will silently not display the
approved talk — approval will appear to have done nothing.** The bad window is
`[today − 200 days, today]` and it widens as the year advances.

> **Status: done, plus three further hardenings found by executing the widget's own
> classification code against the same fixture Code.gs is tested on (`test/attack-agreement.js`).**
>
> 1. `resolveCols` no longer falls back to a fixed index for `date` or `speaker`. Index 2 in this
>    sheet is `TIme`, so a single header rename (`Speaker` → `Presenter`) made the card announce
>    that all 31 future weeks were booked by a speaker named `4:30pm - 6:00pm` — break weeks and
>    all 26 free slots included — while the form kept offering six of those dates. Code.gs throws
>    on the same edit; the widget now returns `[]` so the build-time static fallback survives.
> 2. `cellDate` gained the same text fallback `coerceDate_` has (ISO, then `d MMMM` disambiguated
>    by the row's `Day of Week`, refusing rather than guessing). Retyping one Date cell used to
>    delete a **booked** talk from the card with no error, silently promoting the next week.
> 3. "Today" is now the seminar's day in `America/New_York`, not the visitor's. A reader in
>    London/Tokyo/Auckland at 21:00 ET lost that evening's talk from the card ~19 hours early.

**Fix: switch the widget from the gviz CSV endpoint to the gviz JSON endpoint**, which carries
the real years. Verified this session: with an `Origin` header the JSON endpoint returns
`access-control-allow-origin: https://okongoyango.github.io`, and the payload is

```
/*O_o*/
google.visualization.Query.setResponse({"version":"0.6",…,"table":{
  "cols":[{"id":"A","label":"Date","type":"date","pattern":"d mmmm"},
          {"id":"B","label":"Day of Week","type":"string"}, … ],
  "rows":[{"c":[{"v":"Date(2026,5,22)","f":"22 June"},{"v":"Monday"}, … ]}, … ],
  "parsedNumHeaders":1}});
```

Changes:

- `$sheetCSV` → `$sheetJSON` with `?tqx=out:json`.
- Replace `parseCSV` with:

```js
function parseGviz(text) {
    var s = text.indexOf("("), e = text.lastIndexOf(")");
    if (s < 0 || e <= s) { return null; }
    var d;
    try { d = JSON.parse(text.slice(s + 1, e)); } catch (err) { return null; }
    if (!d || !d.table || !d.table.cols) { return null; }
    var cols = d.table.cols.map(function (c) { return String((c && c.label) || ""); });
    var rows = (d.table.rows || []).map(function (r) {
        var c = (r && r.c) || [], out = [];
        for (var i = 0; i < cols.length; i++) {
            var cell = c[i];
            out.push(cell && cell.v != null ? cell : null);   // free cells are null OR {"v":null}
        }
        return out;
    });
    return { cols: cols, rows: rows };
}
var DATE_RE = /^Date\((\d+),(\d+),(\d+)/;
function cellDate(cell) {
    if (!cell) { return null; }
    var m = DATE_RE.exec(String(cell.v));
    return m ? new Date(+m[1], +m[2], +m[3]) : null;   // arg 2 is already 0-based
}
function cellText(cell) {
    if (!cell) { return ""; }
    if (cell.f != null) { return String(cell.f).trim(); }   // "22 June" for dates
    return cell.v == null ? "" : String(cell.v).trim();
}
```

- Delete `parseDate` entirely. The year heuristic disappears.
- `resolveCols` now takes `parsed.cols` (the labels), unchanged logic — it already matches
  `norm(h) === "time"` and so absorbs the `TIme` typo.
- **Off-by-one trap:** `parsedNumHeaders: 1` means the header is already consumed. The row
  loop starts at **`r = 0`**, not `r = 1`. Getting this wrong drops the first talk.
- `sem.dateStr` comes from `cellText(row[col.date])` (the `f` field), preserving the current
  `"22 June"` rendering exactly.
- Keep `credentials: "omit"`, keep the `.catch()` that leaves the static fallback markup in
  place, keep the static fallback block itself.
- Keep the `d <= today0` strictly-future filter and the `!speaker || speaker.toUpperCase() ===
  "N/A"` skip. The site may continue to conflate `""` and `"N/A"`; only the Apps Script needs
  the distinction.

Go's `html/template` JS escaper turns `/` into `\/` inside `<script>` string literals — this is
harmless in a quoted JS string, but the URL must stay inside `var SHEET_JSON = "{{ $sheetJSON }}";`
and never be injected as a bare token or into a template-literal concat.

### 9.8 Build and deploy

```bash
cd /Users/jiangyiyang/My_Academic_HomePage/OkongOyangO.JournalClub
hugo server -D --port 1315 --baseURL http://localhost:1315/OkongOyangO.JournalClub/   # preview
rm -rf docs/ && hugo --gc --minify -d docs
git add . && git commit -m "..." && git push
```

Preview **with the subpath baseURL**. `.claude/launch.json` uses a bare
`--baseURL http://localhost:1315/`, which makes every subdirectory-path bug invisible locally
and visible only in production. Verify `docs/.nojekyll` survives the rebuild — it is required
and committed. `--minify` minifies inline `<script>`; the existing IIFE survives it, so keep
new inline JS semicolon-clean.

---

## 10. Security model — itemised

### 10.1 What is public

1. **The schedule spreadsheet A1, in full.** Verified anonymously (no credentials, no cookies,
   no Referer): `/gviz/tq?tqx=out:csv` → 200, `?tqx=out:json` → 200, `/export?format=csv` →
   200, `/htmlview` → 200 (44 KB rendered grid), `/edit` → 200 (250 KB). Sharing is
   link-shared *Anyone with the link → Viewer*; it is **not** "published to web"
   (`/pubhtml` → 401), so there is nothing to "unpublish" — the sharing setting is the control.
2. **A1 is anonymously *queryable*, not merely readable.** `?tq=select A,E where E is null`
   returns filtered rows. The exposure is a query interface, not a static dump.
3. **All tabs of A1**, present and future — sharing is file-level. `/htmlview` renders every
   tab with no gid and no guessing; `/gviz/tq?sheet=<name>` serves a tab by name and default
   names like `Form Responses 1` are trivially guessable; `/export?format=csv&gid=<n>` is
   gid-probeable (gid 0 → 200; gid 1/2/100/1234567 → 400). **This is why A3 is a separate
   file.**
4. **The Form A2** and its questions (anyone with the link may submit).
5. **The Hugo site**, including `formURL` and `embedURL` in the built HTML.
6. **The Web App `/exec` URL** is world-callable by construction (§10.3).

### 10.2 What is private

1. **A3**, the responses spreadsheet — every submitter's email address, abstract, and notes.
   Never shared, never link-shared. Nightly-asserted `Access.PRIVATE` (§7.4).
2. **Script Properties** — `HMAC_SECRET`, all IDs, `EXEC_URL`.
3. **Tokens** — exist only in Yiyang's inbox and in A3's `JC Token` column.
4. The Apps Script source and its execution log.

### 10.3 An attacker who has the Web App URL but no token

The URL is guessable-adjacent (it may leak via a forwarded email, browser history, or an
extension). Deployment is *Execute as: Me* + *Who has access: Anyone* — mandatory, because the
visitor has no rights to either spreadsheet, so *Execute as: User* cannot work. **The token is
the only authentication.**

| CAN | CANNOT |
|---|---|
| `GET {EXEC}` and receive "Nothing to do here." | list, enumerate, or count pending requests — there is no listing endpoint and `doGet` never enumerates |
| Send arbitrary `t=` values and learn "Unknown or expired request." | brute-force a token: UUIDv4 ≈ 122 bits, and each guess is a full Apps Script invocation |
| Burn Apps Script execution quota with request volume | read any submitter's name, email, abstract, or notes |
| — | write anything to A1 or A3 |
| — | forge a nonce (HMAC-SHA256 under a 32-byte secret they do not have) — though see §10.5 for why this doesn't matter |

`doGet` performs **zero writes of any kind** — no cell, no property, no cache. A scanner storm
costs execution time and nothing else.

### 10.4 An attacker who has a token

This means they read Yiyang's email, a forward of it, or A3 itself.

| CAN | CANNOT |
|---|---|
| View **that one** submission's name, affiliation, advisor, date, title, abstract, alternates, notes | see the submitter's **email address** — the review page deliberately omits it |
| Approve or reject **that one** request | affect any other request — tokens are independent UUIDs with no derivable relationship |
| Cause one speaker name to be written into one row of a **already-public** schedule | write to any other row, add rows, or change Date / Day of Week / TIme |
| — | overwrite an existing talk — `isFreeSlot_` blocks any row whose Speaker is non-empty, including `N/A` break weeks |
| — | inject a formula — leading `=`/`+`/`@` are stripped, lengths capped, newlines collapsed |
| — | escalate: the review page escapes all fields with `<?= ?>`, so no stored XSS in Yiyang's session |

Blast radius of a fully compromised token: **one row of a public spreadsheet, one email to one
person, fully reversible by hand in ten seconds** (clear four cells; `JC Schedule Row` records
which row).

### 10.5 An attacker who submits the Form

| CAN | CANNOT |
|---|---|
| Put arbitrary text in Yiyang's inbox and in A3 | put anything on the public schedule — every path is approval-gated |
| Generate inbox noise, and push the day into digest mode (`JC Notified = CAPPED`) with more than 20 submissions | exhaust the mail quota through the form — notification sends are capped per day (`MAX_NOTIFY_PER_DAY`), so submission count cannot drive send count |
| — | silence the alarm channel — owner alerts reserve the bottom of the quota (`minQuota = 1`), anything still undeliverable is persisted in `LAST_UNSENT_ALERT` and rides along with the next alert, and the nightly failure is written to Executions regardless |
| Occupy dropdown options in others' eyes | *reserve* a slot — there is no reservation at submit time, so submissions never block each other |
| Inject `=IMPORTRANGE(...)` into A3 (Forms writes text, and the review page escapes it) | get that formula into A1 — `sanitizeForSheet_` strips it before any write |

Mitigations chosen: per-day notification cap + reserved alarm quota + persisted undelivered
alerts + `JC Notified` audit column + nightly report.
**No CAPTCHA question is added** — it degrades the experience for the ~10 real users to defend
against a threat whose worst case is inbox noise. If spam ever actually occurs, the escalation
path is a Form setting (restrict to signed-in users / verified email), not code.

### 10.6 Residual risks, stated plainly

1. **The token is a bearer credential in email.** Anyone with inbox access can approve. Not
   mitigated further; the blast radius (§10.4) is deliberately tiny.
2. **`/exec` is world-callable and cannot be rate-limited without writes.** A determined
   attacker can consume execution quota. Emergency remedy: create a *new deployment* (new URL)
   and rotate `HMAC_SECRET` — accepting that all links in already-sent mail die.
3. **`Who has access: Anyone with Google Account` would block unauthenticated scanners
   entirely** and is tempting. It is **not** adopted: the claim is an inference, not documented
   behaviour, and it introduces an account-chooser interstitial for multi-account users and
   misbehaves in some mobile mail webviews. The two-step POST flow already covers the
   documented threat.
4. **`LockService` does not protect against Yiyang hand-editing A1 in the browser** while an
   approval commits. The re-read→write window is milliseconds, and Sheets version history makes
   it recoverable.
5. **A3 becoming link-shared** would publish every submitter's email address. Detected nightly
   (§7.4); not prevented.
6. **Google's own detonation sandboxes could in principle render the confirm page and click the
   button.** If that ever happens the nonce does not help (a sandbox that GETs then POSTs
   obtains a valid nonce). The only stronger gate would be a required unchecked checkbox in the
   POST body. Not adopted, on the judgement that consumer Gmail does not do this and the cost
   is a permanent extra click. Revisit if a phantom approval is ever observed.
7. **Consumer Gmail may or may not prefetch body links** — Google documents image proxying and
   the Workspace admin options, not arbitrary body-link fetching. The two-step design is
   adopted *because* this is undocumented rather than disproven, and because forwarded mail and
   any `.edu`/Microsoft-hosted recipient definitely passes through Safe Links.

---

## 11. Division of labour and setup ordering

Claude cannot touch the Google account. Ordering constraints are real — several properties
cannot exist until a prior step completes.

**User (Yiyang), in this order:**
1. Create the Form A2 with the exact questions in §2.2; set the form-level settings in §2.1;
   **Publish** it.
2. Responses → **Link to Sheets → Create a new spreadsheet** → this is A3. Rename it
   `JC Signup Responses (PRIVATE — DO NOT SHARE)`. Confirm it is *not* shared with anyone.
3. `script.google.com` → New project → name it `JC Signup Bot`. Project Settings → time zone
   `America/New_York`, runtime **V8**. Paste the delivered source.
4. Project Settings → Script Properties → add every key in §1.4 marked *"user, step 1"*.
   `FORM_EDIT_ID` comes from `/forms/d/<ID>/edit`, **not** from the responder
   `/forms/d/e/<LONG_ID>/viewform` link — they are different strings.
5. Run `installStep1_bootstrap()` from the editor; complete the OAuth consent (Sheets, Forms,
   Mail, Drive). Read its report; fix anything it flags.
6. **Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone**. Copy
   the `/exec` URL into the `EXEC_URL` Script Property. *(This is the one and only time
   "New deployment" is correct.)*
7. Run `installStep2_triggers()`.
8. Run `refreshFormDates()` manually once to populate the dropdown and cache `DATE_ITEM_ID`.
9. Run `verifySetup()`; it must report clean.
10. End-to-end test: submit the Form as yourself; confirm the email arrives; click **Review &
    approve**; confirm the page says nothing has changed yet; click confirm; confirm the row
    appears in A1 and on the site after a refresh; then undo by clearing the four cells and
    setting `JC Status` back to `PENDING` by hand.
11. Paste `formURL` (the published responder link) and `embedURL`
    (`…/viewform?embedded=true`) into `hugo.toml`.

**Claude/implementer delivers:** the complete Apps Script source, the click-by-click setup
guide, and all site-side changes in §9 (including the §9.7 prerequisite fix), built and
committed as `docs/`.

---

## 12. Assumptions a reviewer should challenge

Ordered roughly by how much damage a wrong answer does.

1. **Consumer Gmail does not click buttons on rendered pages.** The nonce defeats prefetch
   GETs, not a sandbox that renders and clicks. If Yiyang ever sees a phantom approval, the fix
   is a required unchecked checkbox in the POST body. *(§10.6.6)*
2. **Automated detection of an exposed A3 justifies the Drive and external-request OAuth
   scopes.** The alternative is a bold warning in the setup guide and no automated detection.
   I chose detection. Note `getSharingAccess()` alone covers only ONE of the three ways the
   file can leak — it does not see per-person grants (it reports general access, not the grant
   list) and it does not see **Publish to web** (which exposes `/pubhtml`, `/gviz/tq` and
   `/export` without touching the ACL). So the check is three checks: sharing access,
   `getViewers()`/`getEditors()` minus the owner, and one unauthenticated
   `UrlFetchApp.fetch(... /gviz/tq ..., {followRedirects: false})` that alarms on HTTP 200.
   `followRedirects: false` is load-bearing — a private file 302s to the sign-in page, and
   following that redirect would return 200 and produce a nightly false alarm.
3. **`ss.getSheets()` contains a tab with `getSheetId() === 0` and that tab is the schedule.**
   Verified indirectly (gid 0 → 200, gid 1/2/100 → 400, single-tab `/htmlview`). If Yiyang ever
   deletes and recreates the tab, gid 0 disappears and the `getSheets()[0]` fallback plus the
   header assertion is all that saves it.
4. **The collected-email column header is `Email Address`.** Not verified against a live form.
   The resolver accepts four spellings and hard-fails at setup time, so a wrong guess surfaces
   immediately rather than silently.
5. **Google Forms *inserts* columns for new questions rather than overwriting the admin block
   to its right.** Header-name resolution absorbs a shift; it would not absorb an overwrite.
   Worth testing once by adding a throwaway question.
6. **The dropdown choice string round-trips into the responses sheet with its leading ISO date
   intact.** The parser only requires `/^\s*\d{4}-\d{2}-\d{2}/`, so em-dash or spacing mangling
   is tolerated — but a Forms-side transformation of the leading digits would not be.
7. **The schedule spreadsheet's timezone is `America/New_York`.** Not verified from here, and
   this is the one input that can put a speaker on the wrong Monday, so it is no longer left
   to assumption: `verifySetup()` compares `ss.getSpreadsheetTimeZone()` for BOTH spreadsheets
   against `Session.getScriptTimeZone()` and reports any disagreement, and setup guide Part
   B3a walks the user through **File → Settings → Time zone** on both files.
   `expireStalePending_` also derives "today" from the schedule's timezone rather than the
   script's, so both sides of its `dateKey < todayKey` comparison come off the same clock.
8. **Rejecting should not auto-email the submitter.** Chosen for a ten-person seminar; a larger
   group would want a canned polite decline.
9. **`Talk title` and `Advisor` should be optional.** If Yiyang wants to decide based on the
   topic, make `Talk title` required — but three currently-booked rows have an empty Topic, so
   the sheet clearly tolerates it.
10. **A single `Preferred date` with a free-text `Other dates that would also work` beats a
    structured second-choice dropdown.** A second dropdown would force the approve flow to ask
    *which* date, roughly doubling `doPost`'s branches.
11. **`DEFAULT_ROOM = "Davey 339"` written only into an empty Room cell is helpful, not
    presumptuous.** Set the property to `""` to disable.
12. **`LEAD_DAYS = 7`** — dates fewer than 7 **calendar** days out are not offered in the
    dropdown, but *are* approvable if Yiyang wants. Challenge the number, not the asymmetry.
    The window is measured in calendar days in the sheet's timezone, so it does not move with
    the trigger hour or with a DST transition.
13. **A leading `-` IS stripped, alongside `=`, `+` and `@`.** Reversed from the earlier
    position. Two reasons, either sufficient: Sheets applies Lotus-style coercion to a leading
    `-` exactly as it does to `+` (typing `-1+1` gives 0, not text) and `setValue` uses
    user-entered parsing, so `-` can create a live formula in a world-readable sheet; and `-`
    is a standard CSV/DDE-injection prefix in Excel and LibreOffice, which matters because
    this file *is* anonymously downloadable as CSV (§10.1). Cost: a physics topic genuinely
    beginning with a hyphen loses it. That is the cheaper failure.
14. **The free-slot supply through `2027-03-15` is sufficient** and the correct behaviour on
    exhaustion is to alarm, not to append rows. Appending would require inventing Day-of-Week
    and TIme — and `15 July 2026` (a Wednesday, 2:00–3:00pm) proves those are not derivable.
15. **Rewriting the widget to gviz JSON (§9.7) is in scope.** It is strictly a bug fix, but it
    replaces the CSV parser. The cheaper alternative — keep CSV, disambiguate the year with the
    `Day of Week` column — is a ~15-line change and equally correct on today's data. I chose
    the rewrite because it removes the entire class of bug permanently.
16. **A menu item that can lead to "sign-ups aren't open yet" is acceptable.** The alternative
    is coupling a `hugo.toml` menu edit to the moment the Form goes live.
17. **Nobody else has edit access to A1** in a way that would race an approval.
18. **Two triggers is the right budget.** Folding dropdown refresh, expiry, verification and
    the sharing check into one nightly handler keeps the trigger count at 2 of 20 and the
    trigger-runtime well under the 90 min/day consumer cap, at the cost of one failing step
    being able to mask later ones — hence the per-step `try/catch`.

---

## 12. Tests

```
cd signup-system && node test/run-all.js        # or: npm test
node test/run-all.js -v                         # stream every suite's full output
```

No dependencies, no network, nothing written anywhere. Each suite loads the **unmodified**
`apps-script/Code.gs` into a Node `vm` context over a snapshot of the real schedule
(`test/fixture-schedule.json`, taken 2026-08-08), so the code under test is the code that ships.
Stubs that would mutate throw, so a read-only path that starts writing fails loudly rather than
passing quietly.

| File | What it holds down |
|---|---|
| `test/lib.js` | The shared instrument: fixture loader, `Utilities.formatDate` stub, Apps Script sandbox. **One module, four requires** — these used to be copied per suite and drifted. |
| `test/harness.js` | Core read-only logic: `findRowByDate_`, `slotState_`, `isFreeSlot_`, `sanitizeForSheet_`, `normalizeDateKey_` against the real 39 rows. |
| `test/attack-dates.js` | Dates end to end: both DST transitions, the 25- and 23-hour days, the 2026/2027 year boundary, the Wednesday one-off, the missing Monday, text-typed Date columns under five host timezones, impossible dates, duplicate rows, `LEAD_DAYS` swept over a year at three run hours. |
| `test/attack-dropdown.js` | `refreshFormDates_`: the write/read contract (every generated choice round-trips through `parseIsoPrefix_` to the right key), truncation direction, the zero-slot placeholder, `MAX_CHOICES` misconfiguration, duplicate-date suppression, a missing or wrong-typed Form item. |
| `test/attack-approval.js` | The mutating path, over an in-memory Sheets model with a real HMAC: `doGet` is byte-for-byte non-mutating, the write lands on the right row, the double-booking race, replay and reverse transitions, in-lock re-validation, `N/A` break weeks, formula injection, stored XSS, schema drift, mail-quota exhaustion, every degraded configuration. |
| `test/attack-agreement.js` | The website widget's **real** classification code (lifted out of `layouts/partials/home/upcoming-seminar.html`) against Code.gs on the same rows: no date may be both offered by the dropdown and rendered as a talk, and no booked future talk may be missing from the card. |

Two things about `run-all.js` are load-bearing:

- **Every check is a regression guard.** Each attack suite began as a probe that found something.
  When the defect was fixed the assertion was rewritten to demand the *fixed* behaviour, so the
  suite now fails if the bug comes back. `attack-approval.js` additionally exits non-zero if its
  `defects` list is non-empty.
- **The host-timezone sweep is not decoration.** The whole system turns a spreadsheet cell into a
  calendar day, and the script's timezone and the spreadsheet's are separate settings that are
  equal only by convention. `test/lib.js` builds fixture dates at true midnight in the *sheet's*
  timezone, so `harness.js` must give identical results under any host timezone; the sweep runs
  it from `Pacific/Kiritimati` (UTC+14) to `Pacific/Midway` (UTC−11) to prove no new code has
  started reading dates in the host's zone.

Regenerate the fixture with:

```
curl -s "https://docs.google.com/spreadsheets/d/<SCHEDULE_ID>/gviz/tq?tqx=out:json" \
     -o test/fixture-schedule.json
```
