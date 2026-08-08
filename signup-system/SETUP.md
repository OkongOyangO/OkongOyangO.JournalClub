# Journal Club Speaker Sign-Up — Setup Guide

**For:** Yiyang Jiang · **Google account:** `jiangyiyang2019@gmail.com`
**Time:** about **75–90 minutes**, best done in one sitting.
**Prerequisites:** you are signed into `jiangyiyang2019@gmail.com` in the browser you'll use
throughout, and you own the Journal Club schedule spreadsheet.

You do not need to know Apps Script. You will paste one file of code, fill in a settings
table, press Run four times, and click Deploy once. Everything the code needs to know lives
in that settings table, not in the code.

---

## 0. What you are building

Someone clicks **Sign up to present** on the Journal Club site, fills in a Google Form, and
nothing happens publicly. You get an email with two buttons. Clicking a button opens a review
page that **changes nothing**. Only when you press the confirm button on that page does the
speaker's name get written into the public schedule spreadsheet — and the site picks it up on
the next page load, with no rebuild and no deploy.

Five things get created:

| | What | Where it lives |
|---|---|---|
| **A1** | **JC Schedule** — the spreadsheet you already have | already exists, **public** |
| **A2** | **JC Speaker Sign-Up** — the Google Form | you create it, **public** |
| **A3** | **JC Signup Responses (PRIVATE — DO NOT SHARE)** — a *brand-new* spreadsheet | you create it, **private forever** |
| **A4** | **JC Signup Bot** — the Apps Script project (the code) | you create it, private |
| **A5** | the Web App deployment of A4 — the URL the email buttons point at | created when you press Deploy |

The one thing that can genuinely go wrong and cannot be undone quietly is putting the form
responses in the wrong spreadsheet. Read section 1 before you touch anything.

### Why there are two passes over the settings

There is one unavoidable circular dependency. The script needs to know its own Web App URL
(so it can put approve/reject links into the email), but that URL does not exist until you
deploy the script. So the settings are filled in twice:

- **Pass 1 (Part D)** — everything except `EXEC_URL`.
- **Deploy (Part F)** — this mints the URL.
- **Pass 2 (Part G)** — paste `EXEC_URL` back into the settings.

This is called out again where it happens. Nothing is broken in between; the script simply
has no URL to put in emails until Part G is done.

---

## 1. PUBLIC vs PRIVATE — read this before anything else

Google Sheets sharing is **per file, not per tab**. A file is either shared or it isn't, and
every tab inside it follows. This one fact drives the whole design.

### What is public — anyone on the internet, no login

| Thing | Why |
|---|---|
| **A1, the schedule spreadsheet — every tab, present and future** | It's link-shared *Anyone with the link → Viewer*. That is deliberate: the site's Upcoming Seminars card reads it live from the browser. Verified: it can be read **and queried** anonymously — someone can ask it for "all rows where Speaker is blank" without any credentials. |
| **The Form (A2) and its questions** | Anyone with the link may submit. That's the point. |
| **The Journal Club website**, including the form links baked into the HTML | Static site. |
| **The Web App URL** | It must be callable by anyone, because the person clicking it (you, from your phone, from a mail app) may not be carrying a Google session. The **token in the link is the only authentication.** |

### What is private — only you

| Thing | Why it must stay private |
|---|---|
| **A3, the responses spreadsheet** | It contains **every submitter's email address**, plus their abstract and private notes. |
| **The Apps Script project and its settings** (`HMAC_SECRET`, all the IDs) | Standard. |
| **The tokens** in your inbox and in A3's `JC Token` column | Whoever holds a token can approve that one request. |

### The single rule you must not break

> **The form responses must go into a BRAND-NEW spreadsheet.**
> Never into a new tab of the schedule spreadsheet (A1).

If the responses land in a tab of A1, then every submitter's email address becomes
world-readable — anonymously, permanently, and with no error message to tell you. A tab named
`Form Responses 1` inside a public file can be fetched by name by anyone who guesses the name,
and that name is the default.

In **Part B** the dialog will offer you *Create a new spreadsheet* and *Select existing
spreadsheet*. **Choose Create a new spreadsheet.** That is the whole safeguard.

The script also refuses outright: if the responses ID is ever set equal to the schedule ID, it
throws rather than writing anything, so this cannot happen quietly.

The nightly job re-checks A3 every night and emails you if it ever becomes readable by anyone
else. It looks for all three ways that can happen: link sharing, sharing with a named person,
and **Publish to web** (which does *not* appear in the Share dialog's General access setting —
it is checked by making one anonymous request to the file and alarming if it succeeds).

### One more thing to never do

Do not "Share" the responses spreadsheet with anyone, ever — not with a co-organizer, not
"just to show someone", and do not use **File → Share → Publish to web** on it. If a
co-organizer needs to see the queue, send them a screenshot. (Both mistakes are detected
nightly, but the detection is a safety net, not permission to do it.)

---

## 2. Time budget

Two routes. The fast path runs an installer that does Parts A, B and D for you.

| Part | What | By hand | Fast path |
|---|---|---|---|
| 0 | Publish the website changes | 2 | ✅ already done |
| C | Create the Apps Script project, paste the code | 5 | 5 |
| ⚡ | Run `autoInstall()` — builds the Form, the private sheet, the settings | — | 5 |
| A | Create the Google Form | 20 | skipped |
| B | Link responses to a new private spreadsheet | 5 | skipped |
| D | Settings pass 1 | 10 | skipped |
| E | Run the bootstrap, authorize | 5 | 3 |
| F | Deploy the Web App | 5 | 5 |
| G | Settings pass 2 — `EXEC_URL` | 2 | 2 |
| H | Create the triggers | 2 | 2 |
| I | Populate the date dropdown | 2 | 2 |
| J | Health check | 3 | 3 |
| K | **End-to-end test** | 15 | 15 |
| L | Turn the sign-up button on on the website | 5 | 5 |
| | **Total** | **~85** | **~47** |

The end-to-end test in Part K is the one part worth not rushing either way — it is what
tells you the approval link genuinely does nothing until you confirm.

---

# Part 0 — Publish the website changes FIRST (2 min)

**Do this before Part A.** The site-side work is already written and sitting in your working
tree, but this site is served from the committed `docs/` folder — nothing is live until you
commit it. Two of the changes matter for the test in Part K:

- the `/signup/` page and the **Sign Up** menu entry (without them, Part L has nothing to
  switch on, and the menu item would 404);
- a **bug fix to the home-page Upcoming Seminars card**. The old version guessed the year of
  each date from a string with no year in it, and got it wrong for every row falling in a
  particular window — today that is 8 of 39 rows, including `25 January` and the March dates.
  Those rows were free, so nothing looked broken; but the moment a speaker is approved into
  one of them, the schedule would be correct and **the website would silently show nothing**.
  Part K7 asks you to confirm an approval reached the site, so this fix has to be live first
  or the test can fail for the wrong reason.

`docs/` has already been rebuilt for you. Publish it:

> ## ✅ ALREADY DONE — skip Part 0
>
> This was committed and pushed as `fd3cf7d`.
> <https://OkongOyangO.github.io/OkongOyangO.JournalClub/signup/> is live and returns 200;
> the home page is confirmed serving the fixed (`tqx=out:json`) widget. Start at the
> fast path below.

---

# ⚡ Fast path — run the installer instead of Parts A, B and D (5 min)

`apps-script/Setup.gs` builds the Form, the private responses spreadsheet, the link between
them, and all nine Script Properties **for you**. It replaces roughly 35 minutes of clicking,
and — more importantly — it generates the eight question titles from the same source
`Code.gs` reads them by, so they cannot drift apart from a typo.

1. Do **Part C** first (create the Apps Script project, paste `Code.gs` and
   `appsscript.json`) — the installer is Apps Script, so it needs somewhere to live.
2. Add one more file in the same project: **＋ next to "Files" → Script**, name it `Setup`,
   and paste all of `apps-script/Setup.gs`.
3. In the function dropdown at the top, choose **`autoInstall`**, click **Run**.
4. Authorize when prompted — this is the "unverified app" screen described in **Part E**;
   read that first if you want to know what you are granting.
5. Read what it prints in the **Execution log**. It ends with the exact links you need and a
   numbered list of what is left.

Then continue at **Part F** (deploy the Web App). **Skip Parts A, B and D entirely.**

Two things the installer may not manage on its own, and it will say so plainly if not:

- **Publishing the form.** Since late 2024 a form is unreachable until published, and the
  API for it is not available in every project. If the log says it could not publish, do
  **Part A4** by hand — it is four clicks.
- **Email collection mode.** It must end up on **Responder input**, not *Verified* —
  *Verified* forces a Google sign-in and shuts out anyone whose `.edu` address isn't
  Google-backed. If the log flags this, fix it under **Settings → Responses**.

If a run goes wrong, run **`undoAutoInstall()`**. It clears the properties and prints links
to the two files for you to delete from Drive, so you can re-run cleanly. (It won't delete
them itself — that would need full read-write Drive access, and this project only asks for
read-only on purpose.)

> Prefer to do it by hand, or want to see exactly what is being created? Parts A, B and D
> below are unchanged and still correct. The installer produces precisely what they describe.

---

# Part A — Create the Google Form (20 min) — *skipped if you used the fast path*

## A1. Create it

1. Go to **<https://forms.google.com>**.
2. Under **Start a new form**, click **Blank form**.
3. Click the title **Untitled form** at the top of the form and type:
   `Journal Club — Speaker Sign-Up`
4. Click the line under it (**Form description**) and type something like:
   *Request a date to present at the Condensed Matter + AI Journal Club at Penn State.
   Requests are reviewed before they appear on the public schedule.*
5. In the **top-left**, click **Untitled form** (the file name, next to the Forms icon) and
   rename the file to `JC Speaker Sign-Up`. (The document name and the form title are two
   different fields; renaming both keeps your Drive tidy.)

## A2. Form settings

Click the **Settings** tab at the top of the form (next to **Questions** and **Responses**).

**Under `Responses`** (click the down-arrow to expand it):

| Setting | Set it to | Why |
|---|---|---|
| **Collect email addresses** | **Responder input** | *Verified* forces everyone to sign into a Google account, which excludes anyone using a `.edu` address that isn't Google-backed. *Do not collect* would leave you unable to reply to a request. |
| **Send responders a copy of their response** | **Always** | Free acknowledgement, no code needed. |
| **Allow response editing** | **Off** | An edited response would not re-trigger the review flow, so the record must be immutable. |
| **Limit to 1 response** | **Off** | Turning it on would force a Google sign-in. |

**Under `Presentation`** (expand it):

- Next to **Confirmation message**, click **Edit** and paste:

  ```
  Thanks — your request has been sent to Yiyang for review.

  Nothing appears on the public schedule until it is approved. Yiyang will email you
  either way, usually within a few days. If your preferred date gets taken in the
  meantime, he'll write to you about alternatives.
  ```

  > The wording says "either way" on purpose. Approvals send an automatic confirmation;
  > **rejections do not** — the system hands you a pre-filled draft to send yourself,
  > because a canned rejection is the wrong tone for a ten-person journal club. If you
  > close that tab without sending it, the person never hears anything. The nightly job
  > nags you about requests left undecided for more than a week for the same reason.

- Leave **Show link to submit another response** on or off, your choice.

**Under `Defaults`:** leave everything alone. Do **not** turn on **Make this a quiz**.

## A3. The eight questions — exact titles matter

> **The question titles below become the column headers of the responses spreadsheet, and
> the script finds its data by those names.** Copy them character for character. Capitalisation
> and spacing are forgiving (the script lowercases and collapses spaces), but the words must
> match.
>
> You *can* rename a question later — but then you must rename it back, or the script will
> stop finding that field. The nightly health check will tell you.

To add a question: click the **⊕** (Add question) button in the floating toolbar on the right.
To set the type, use the dropdown on the right of the question row (it starts on
**Multiple choice**).

To add the grey helper text under a question title, click the **⋮** (More) menu at the
bottom-right of that question card and tick **Description**. A second text line appears; type
the description there. **You have to do this per question** — there is no global toggle.

To make a question required, flip the **Required** switch at the bottom-right of the card.

---

**Q1**
- Title: `Speaker name`
- Type: **Short answer**
- Required: **yes**
- Description: `Exactly as it should appear on the public schedule.`

**Q2**
- Title: `Affiliation`
- Type: **Short answer**
- Required: **yes**
- Description: `Department or institution, e.g. PSU, Cornell, UIUC.`

**Q3**
- Title: `Advisor`
- Type: **Short answer**
- Required: no
- Description: `Leave blank if not applicable (faculty, postdoc, or independent).`

**Q4** — the important one
- Title: `Preferred date`
- Type: **Dropdown**
- Required: **yes**
- Description: `Only currently-open dates are listed. The list is refreshed nightly.`
- **Leave the placeholder `Option 1` exactly as it is.** A Dropdown must have at least one
  option or Forms won't save it. The script overwrites the entire option list in Part I with
  the real open dates. Do not add real dates by hand — they will be wiped.

> **Do not change Q4's type later.** If it stops being a Dropdown, the nightly refresh will
> report `Preferred date is not a dropdown` and stop updating the dates.

**Q5**
- Title: `Talk title`
- Type: **Short answer**
- Required: no
- Description: `Leave blank if undecided — the schedule will show "Topic to be announced".`

**Q6**
- Title: `Abstract or short description`
- Type: **Paragraph**
- Required: no
- Description: `A few sentences on the paper or topic. Only Yiyang sees this; it is not published.`

**Q7**
- Title: `Other dates that would also work`
- Type: **Paragraph**
- Required: no
- Description: `If your first choice is taken, what else could you do?`

**Q8**
- Title: `Anything else Yiyang should know?`
- Type: **Paragraph**
- Required: no
- Description: *(none)*

---

**Deliberately not asked:** Room, Date-as-free-text, Day of Week, Time. The schedule sheet owns
those. Room is yours to assign; the script fills in `Davey 339` only when the Room cell for
that week is empty.

## A4. Publish the form

Since late 2024 a Google Form is **unreachable until you publish it** — the responder link
returns an error before that. This step is not optional.

1. Top right, click **Publish**.
2. In the dialog, next to **Responders**, click **Manage**.
3. Under **General access**, set it to **Anyone with the link**, with the role **Responder**.
4. Click **Done**, then **Publish**.
5. The top-right button now reads **Published**.

## A5. Copy the two links you'll need at the very end

Click **Published** (top right) → **Copy responder link**. You get something like:

```
https://forms.gle/aB3dEfGh1JkLmNoP
```

Paste it into a scratch note — this becomes `formURL` in **Part L**.

Now the embed link. Click **Send** (top right) → the **`< >`** (Embed HTML) tab. You'll see an
`<iframe src="…">` snippet. You only want the URL inside `src="…"`:

```
https://docs.google.com/forms/d/e/1FAIpQLSd0000000000000000000000000000000000/viewform?embedded=true
```

Paste that into your scratch note too — it becomes `embedURL` in **Part L**.

> **If there is no `Send` button** (after the 2024 publish redesign, whether you get a separate
> **Send** button alongside **Published** varies by account), build the same URL by hand — it is
> identical to what that tab would have given you:
>
> 1. Open the `forms.gle/…` responder link you just copied, in a normal browser tab.
> 2. The address bar settles on
>    `https://docs.google.com/forms/d/e/<LONG_ID>/viewform` — copy that.
> 3. Append `?embedded=true`.
>
> That string is `embedURL`.

---

# Part B — The private responses spreadsheet (5 min) — *skipped if you used the fast path*

## B1. Create it — as a NEW file

1. In the form, click the **Responses** tab.
2. Click **Link to Sheets**.
3. A dialog appears with two options. **Select `Create a new spreadsheet`.**
   - The other option, *Select existing spreadsheet*, is how you would accidentally put
     submitter email addresses into the public schedule file. Do not use it.
4. The suggested name will be something like `JC Speaker Sign-Up (Responses)`. Change it to:

   ```
   JC Signup Responses (PRIVATE — DO NOT SHARE)
   ```

5. Click **Create**. A new spreadsheet opens in a new tab, with one sheet named
   **`Form Responses 1`** and a header row already in place.

## B2. Confirm it is private

In the new spreadsheet:

1. Click **Share** (top right).
2. Under **General access** it must say **Restricted**. If it says *Anyone with the link*,
   click it and change it to **Restricted**.
3. Under **People with access** there should be exactly one entry: you, as **Owner**.
4. Close the dialog.

## B3. Copy the responses spreadsheet ID

Look at the address bar of the responses spreadsheet. The ID is the long string between
`/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/1zZyXwVuTsRqPoNmLkJiHgFeDcBa0987654321AbCd/edit#gid=0
                                       └──────────── this part is the ID ────────────┘
```

Copy just that middle chunk into your scratch note as **`RESPONSES_SS_ID`**. Do not include
the slashes, `/d/`, or `/edit`.

## B3a. Check the time zone of BOTH spreadsheets

Do this now, in the responses spreadsheet you just created **and** in the schedule
spreadsheet: **File → Settings → Time zone**. Both must read **Eastern Time — New York**,
and in Part C you will set the Apps Script project to the same.

This matters more than it sounds. Every date in this system is compared as a `yyyy-mm-dd`
string produced under *some* time zone. If the schedule spreadsheet is on a different zone
from the script, a date can resolve to the day before or after — which means an approval can
be written into **the wrong week**. `verifySetup()` (Part J) checks all three against each
other and will tell you if they ever drift apart, but it is easier to just set them now.

## B4. Also copy the schedule spreadsheet's ID and gid (you already have these)

Open the schedule spreadsheet. Its URL looks like:

```
https://docs.google.com/spreadsheets/d/1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4/edit?gid=0#gid=0
                                       └───────────── SCHEDULE_SS_ID ─────────────┘        └─gid
```

- **`SCHEDULE_SS_ID`** = `1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4`
- **`SCHEDULE_TAB_GID`** = the number after `#gid=`, which is `0` for the first tab.
  Click the schedule tab you actually want to write into and read the `#gid=` off the URL —
  if you only have one tab, it is `0`.

## B5. Copy the Form's *edit* ID — this is the classic trap

The Form has **two** different IDs and they look similar. You need the **edit** one.

Open the form for editing (`Edit form`, not the responder view). The address bar shows:

```
https://docs.google.com/forms/d/1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVwXyZ0123456/edit
                                └────────────── FORM_EDIT_ID — use this ───────┘
```

The **responder** link looks like this and is **not** what you want:

```
https://docs.google.com/forms/d/e/1FAIpQLSd0000000000000000000000000000000000/viewform
                                ↑ note the extra "/e/" — this is a DIFFERENT id
```

Rule of thumb: the one you want comes from a URL ending in **`/edit`** and has **no `/e/`** in
it. Copy it to your scratch note as **`FORM_EDIT_ID`**.

If you put the wrong one in, the nightly date refresh will fail with a "not found" error and
`verifySetup()` will flag it — nothing silently breaks.

---

# Part C — Create the Apps Script project (5 min)

The script must be a **standalone** project, not one attached to the form or a spreadsheet.
All four moving parts (submit handler, review page, approval writer, nightly job) have to live
in the same project or the safety locking between them silently stops working.

1. Go to **<https://script.google.com>**.
2. Click **New project** (top left). An editor opens with a file `Code.gs` containing an empty
   `myFunction()`.
3. Click **Untitled project** at the top and rename it to **`JC Signup Bot`**. Click
   **Rename**.
4. In the left sidebar click the gear icon, **Project Settings**.
   - Set **Time zone** to **`(GMT-05:00) Eastern Time - New York`**. This must match the
     spreadsheet's own time zone or dates can land one day off.
   - If you see a checkbox **`Enable Chrome V8 runtime powering Apps Script`**, make sure it is
     **ticked**. New projects have V8 on by default and may not show the checkbox at all —
     that's fine.
   - **While you are on this page, tick the checkbox
     `Show "appsscript.json" manifest file in editor`.** You need it for step 8 below.
     There are **two** files to paste, not one.
5. Click the **`<>` Editor** icon in the left sidebar to go back to the code.
6. Click inside `Code.gs`, select everything (`Cmd`+`A`), delete it, and paste the entire
   contents of the delivered **`Code.gs`**.
7. Press `Cmd`+`S` (or the floppy-disk **Save project** icon).
8. In the file list on the left you should now also see **`appsscript.json`**. Click it,
   select everything (`Cmd`+`A`), delete it, and paste the entire contents of the delivered
   **`appsscript.json`**. Save again.

   This file pins the exact Google permissions the script asks for. Without it, Apps Script
   auto-detects permissions and asks for **more** than the script needs — notably full
   read/write access to your entire Google Drive instead of read-only. Pasting it before you
   authorize (Part E) means the consent screen you approve is the narrow one.

You should now see, in the function dropdown at the top of the editor, names including
`installStep1_bootstrap`, `installStep2_triggers`, `refreshFormDates`, and `verifySetup`.
If you don't, the paste didn't take — re-paste and save again.

> **Ignore the `CONFIG` block near the top of `Code.gs`.** It only holds fallback defaults
> (the schedule ID and your email are pre-filled there). You configure everything in Part D,
> and the bootstrap never overwrites what you type there.

---

# Part D — Settings, pass 1 (10 min) — *skipped if you used the fast path*

Everything the script needs at runtime comes from a settings table called Script Properties —
**this table is the source of truth.** (`Code.gs` has a small `CONFIG` block near the top with
the schedule ID and your email pre-filled as fallbacks; you never need to touch it, and
nothing you enter below will be overwritten by it.)

1. Left sidebar → gear icon → **Project Settings**.
2. Scroll to the **Script Properties** section.
3. Click **Add script property** (or **Edit script properties** → **Add script property** if
   some already exist).
4. Add each row below. Click **Add script property** again for each new one, then click
   **Save script properties** once at the end.

| Property | Value |
|---|---|
| `SCHEDULE_SS_ID` | `1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4` |
| `SCHEDULE_TAB_GID` | `0` |
| `RESPONSES_SS_ID` | *(from B3)* |
| `RESPONSES_TAB_NAME` | `Form Responses 1` |
| `FORM_EDIT_ID` | *(from B5 — the `/edit` one, no `/e/`)* |
| `NOTIFY_EMAIL` | `jiangyiyang2019@gmail.com` |
| `DEFAULT_ROOM` | `Davey 339` |
| `LEAD_DAYS` | `7` |
| `MAX_CHOICES` | `30` |

**Do not add `EXEC_URL` yet — it does not exist until Part F.** That's the circular dependency;
you'll come back for it in Part G.

Two properties are created automatically and you should never type them yourself:
`HMAC_SECRET` (made by the bootstrap in Part E) and `DATE_ITEM_ID` (cached by the first date
refresh in Part I).

**Notes on the values:**

- `RESPONSES_TAB_NAME` must match the tab name at the bottom of the responses spreadsheet
  exactly. Google's default is `Form Responses 1` — with a space before the `1`. If you renamed
  the tab, use your name.
- `DEFAULT_ROOM` is written into the schedule's Room cell **only when that cell is empty**. Set
  it to an empty value if you'd rather always fill Room in by hand.
- `LEAD_DAYS = 7` means dates fewer than 7 days away aren't offered in the dropdown. You can
  still approve a short-notice request manually — the restriction only applies to what the form
  advertises.

---

# Part E — Run the bootstrap and authorize (5 min)

This is the first time the script runs, so Google will ask for permission.

1. Go back to the **Editor** (`<>` icon).
2. In the toolbar at the top, in the function dropdown (it probably says `myFunction` or the
   first function in the file), select **`installStep1_bootstrap`**.
3. Click **▶ Run**.
4. A dialog appears: **Authorization required**. Click **Review permissions**.
5. Choose the account **jiangyiyang2019@gmail.com**.
6. You will see **"Google hasn't verified this app"**. This is expected and correct — it means
   *you* wrote this app and never submitted it to Google for review. It is your own code
   running in your own account.
   - Click **Advanced** (bottom left).
   - Click **Go to JC Signup Bot (unsafe)**.
7. Review the permission list, then click **Allow**. Assuming you pasted `appsscript.json` in
   Part C step 8, there are **six** items, and the wording is roughly:
   - see/edit/create/delete your spreadsheets — to read the schedule and write approvals
   - see/edit/create/delete your Google Forms — to refresh the date dropdown
   - send email as you — the notification and confirmation emails
   - **see and download** your Google Drive files (read-only) — used for exactly one thing:
     checking every night that the responses spreadsheet is still private. Note *read-only*:
     the script cannot modify or delete anything in your Drive. If you skipped the manifest,
     this line will instead say see/**edit/create/delete** — that is the auto-detected, wider
     permission, and it is worth going back and pasting the manifest to avoid it.
   - connect to an external service — one anonymous request per night, to the responses
     spreadsheet's own URL, testing whether a stranger can read it. This catches
     *Publish to web*, which does not show up in the Share dialog.
   - run when you are not present — the nightly job and the on-submit handler.
8. The **Execution log** panel opens at the bottom and prints a report.

**What a good report looks like:** it confirms it can open both spreadsheets, lists the
schedule's column headers, says it added the missing `JC …` admin columns to the responses
sheet, generated an `HMAC_SECRET`, and then notes that `EXEC_URL` is **not yet set** — which is
correct at this stage.

**If it reports a problem**, fix it now before continuing. See **Troubleshooting** at the end;
the most common causes are a mistyped ID or a `RESPONSES_TAB_NAME` that doesn't match.

Open the responses spreadsheet in another tab and scroll right: you should now see seven new
columns after the form's own columns — `JC Token`, `JC Status`, `JC Date Key`, `JC Decided At`,
`JC Decision Note`, `JC Schedule Row`, `JC Notified`. **Do not rename, reorder, or delete these
columns.** (Re-running the bootstrap later is harmless: it only fills in settings that have
never been set, and never overwrites a value you typed. If one of your settings differs from
the code's built-in default, it says so in the log and leaves yours alone.)

---

# Part F — Deploy the Web App (5 min)

This is the step that creates the URL your approve/reject buttons point at.

> **This is the one and only time you should use "New deployment".** Every future code change
> uses a different menu path. See section "Changing the script later".

1. Top right of the editor, click **Deploy** → **New deployment**.
2. Next to **Select type**, click the **gear icon** (its tooltip is *Enable deployment types*)
   and choose **Web app**.
3. Fill in:

   | Field | Value |
   |---|---|
   | **Description** | `JC Signup Approvals v1` |
   | **Execute as** | **Me (jiangyiyang2019@gmail.com)** |
   | **Who has access** | **Anyone** |

   Both of those last two are load-bearing:
   - **Execute as: Me** — the code has to open your spreadsheets and send mail as you. A
     visitor has no rights to either file, so the alternative cannot work.
   - **Who has access: Anyone** — you need to be able to click the approve link from any
     device or mail client, including ones not carrying your Google session. This does mean the
     URL is world-callable; the random token in the link is what actually protects it, and the
     design assumes that. Section 0 of the architecture spec covers what someone with the bare
     URL and no token can do: essentially nothing.

4. Click **Deploy**.
5. If prompted to authorize again, do so.
6. The dialog shows a **Web app URL**. Click **Copy**. It looks like:

   ```
   https://script.google.com/macros/s/AKfycbwEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEabc/exec
   ```

7. Click **Done**.

**Two checks on that URL before you go on:**

- It must end in **`/exec`**. If it ends in `/dev`, you copied the test URL from somewhere
  else — a `/dev` URL only opens for people with edit access to the script, so approve links
  in email would fail for you on your phone.
- It must **not** contain `/u/0/` or `/u/1/`. That variant appears if you copy from the browser
  address bar while signed into several Google accounts. The URL from the **Copy** button in
  this dialog is the clean one. The health check in Part J rejects both bad forms.

---

# Part G — Settings, pass 2: `EXEC_URL` (2 min)

Now close the loop.

1. Left sidebar → gear icon → **Project Settings** → **Script Properties**.
2. Click **Edit script properties** → **Add script property**.
3. Property: `EXEC_URL` · Value: the `/exec` URL you just copied.
4. Click **Save script properties**.

Why this is stored by hand rather than detected automatically: Apps Script has a
long-standing bug where a script asking for "my own URL" gets handed the `/dev` test URL
instead of the real one. A `/dev` URL in an email button is unopenable on your phone. Storing
the URL explicitly sidesteps it entirely.

---

# Part H — Create the triggers (2 min)

1. **Editor** → function dropdown → select **`installStep2_triggers`** → click **▶ Run**.
2. The execution log should report that it created two triggers:
   - `onSignupSubmit` — fires when someone submits the form
   - `nightlyMaintenance` — fires around 4am Eastern every night

**Verify:** left sidebar → the alarm-clock icon, **Triggers**. You should see exactly **two**
rows, one per function. If you see duplicates, delete the extras with the **⋮** menu →
**Delete trigger** — duplicated triggers send you duplicate emails for every signup. (Re-running
`installStep2_triggers` is safe: it removes its own old triggers before adding new ones.)

> **Do not try to create these by hand** from the **Add Trigger** dialog. The submit trigger has
> to be attached to the responses spreadsheet specifically, and the installer does that
> correctly. Use the Triggers page for looking and deleting, not creating.

**Optional but recommended:** on the `onSignupSubmit` row, click **⋮** → **Edit trigger**, and
set **Failure notification settings** to **Notify me immediately**. Then if a signup ever fails
to process, you hear about it the same day instead of in the next daily digest.

---

# Part I — Populate the date dropdown (2 min)

1. **Editor** → function dropdown → **`refreshFormDates`** → **▶ Run**.
2. The log reports how many open dates it found and wrote.

**Verify:** open the form, look at **Q4 `Preferred date`**. The placeholder `Option 1` is gone,
replaced by real options like:

```
2026-09-14 — Monday 14 September, 4:30pm - 6:00pm, Davey 339
```

The leading `2026-09-14` is not decoration — it's how the script knows which row of the
schedule the request refers to, unambiguously, without guessing a year. Leave it in place. If
you ever hand-edit these options, keep the `YYYY-MM-DD` at the front.

From now on this list refreshes itself every night. You never need to run this by hand again,
though you can if you just freed up a date and want the form to reflect it immediately.

**If it says there are no open dates:** the dropdown gets a single "no open dates at the
moment" placeholder instead, and the nightly job will remind you once. Add more week rows to
the schedule sheet and re-run.

---

# Part J — Health check (3 min)

1. **Editor** → function dropdown → **`verifySetup`** → **▶ Run**.
2. Read the execution log.

It checks, among other things: every setting is present and non-empty; `EXEC_URL` is a real
`/exec` URL; the schedule sheet still has `Date` and `Speaker` columns findable by name; the
responses sheet has an email column and all seven `JC …` admin columns; `Preferred date` is
still a dropdown; there are exactly two triggers; you have email quota left; **and that the
responses spreadsheet is still `Restricted`.**

**It must report clean before you go on.** If it doesn't, the message names the specific
problem — go fix that one thing and run it again.

You can run `verifySetup` any time, forever. It only reads; it never changes anything.

---

# Part K — Verify it works, end to end (15 min)

Do this before you tell anybody the form exists. You are going to submit a fake request, watch
it arrive, approve it, confirm it lands on the public schedule and the website, and then undo
it.

## K1. Note the "before" state

Open the schedule spreadsheet. Pick a free future Monday **at least 8 days away** — a row with
an **empty Speaker cell** — and write down its date and row number. Say `14 September`, row 15.

> Why 8 days: `LEAD_DAYS = 7` (Part D) means dates closer than a week are deliberately **not
> offered in the form's dropdown**. If you pick next Monday you simply won't find it in the
> list at K2 and it will look like something is broken.

## K2. Submit a fake request

1. Open the form's **responder link** (the `forms.gle/…` one from A5) in a **private/incognito
   window** — this proves the form works for someone who isn't you.
2. Fill it in:
   - Email: your own address (so you see the responder's copy too)
   - `Speaker name`: `TEST — please ignore`
   - `Affiliation`: `TEST`
   - `Preferred date`: pick the date you noted in K1
   - `Talk title`: `TEST talk`
   - leave the rest blank
3. Click **Submit**.

**Expect:** the confirmation message you wrote in A2, and within a minute an email to yourself
titled something like *"Thanks for filling out …"* — that's Forms' own responder copy.

## K3. The notification email

Within a minute or two you should get a second email, from yourself, subject like:

```
[JC signup] TEST — please ignore — 14 September 2026 (slot free)
```

It contains a table of what was submitted (including the submitter's email — that appears here
but deliberately never on the web pages), the current state of that slot, and two buttons:
**Review & approve** and **Review & reject**, under a line saying both links open a review page
and nothing changes until you confirm.

**If it doesn't arrive within ~3 minutes**, check spam, then see Troubleshooting → *"No
notification email"*.

**Also open this email on your phone**, including in dark mode if you use it. This message is
your entire week-to-week interface with the system, and mail clients render HTML differently
enough that it is worth confirming once that the field table and the two buttons are readable
where you will actually be reading them.

## K4. Click Approve — and verify nothing happened

Click **Review & approve**.

A page opens listing the submission and saying **"This slot is currently free."** At the bottom
it says:

> *Nothing has been changed yet. This page is safe to open, close, and reopen.*

**Now go check that this is literally true.** Switch to the schedule spreadsheet. Row 15's
Speaker cell should still be **empty**.

This is the single most important property of the whole system. Mail scanners at Gmail,
Outlook, and university IT routinely fetch every link in an email to check it for malware. If
clicking a link were enough to approve, those scanners would auto-approve every request that
ever came in, without a human involved. That's why approval takes two steps.

Reload the review page a few times if you want. Nothing changes.

## K5. Confirm the approval

Back on the review page, click **Confirm approval — write to the schedule**.

**Expect:** a success page naming the speaker, the date, and the row number, with links to open
the schedule and the private log.

## K6. Verify the spreadsheet

Switch to the schedule spreadsheet. In row 15:

- **Speaker** = `TEST — please ignore`
- **Affiliation** = `TEST`
- **Topic** = `TEST talk`
- **Room** = `Davey 339` (only if it was blank before)
- **Date, Day of Week, TIme** — **unchanged**. Check this explicitly. The script writes
  individual cells and must never touch these three.

## K7. Verify the website picks it up

*(This assumes you did **Part 0**. If you skipped it, the live site is still running the old
card with the year bug and this test can fail even when the approval worked perfectly.)*

Open <https://OkongOyangO.github.io/OkongOyangO.JournalClub/> and hard-refresh
(`Cmd`+`Shift`+`R`).

If `14 September` is the **next** upcoming talk, the Upcoming Seminars card now shows
`TEST — please ignore`. If there are earlier booked talks, it won't — the card only shows the
next one. To confirm the data path anyway, click **Full schedule** in the card; the test row is
there.

No rebuild, no `git push`, no deploy. The card reads the spreadsheet live from the visitor's
browser.

> Google's spreadsheet-query endpoint caches for a minute or two. If the card looks stale,
> wait 60 seconds and hard-refresh again before suspecting anything.

## K8. Verify the private log

Open the responses spreadsheet. The test row should now show:

- `JC Status` = `APPROVED`
- `JC Schedule Row` = `15`
- `JC Decided At` = a timestamp
- `JC Notified` = `YES`

## K9. Check idempotency

Go back to your email and click **Review & approve** on the same test request again.

**Expect:** *"Already handled — this request was approved on … (schedule row 15). Nothing has
been changed by opening this link."* No second write, no error.

Click **Review & reject** on that same email too — same already-handled page. Once decided, a
request is decided.

## K10. Undo the test

1. **Schedule spreadsheet**, row 15: clear **Speaker**, **Affiliation**, **Advisor**, **Topic**,
   and **Room** if the script filled it in. Leave Date / Day of Week / TIme alone.
2. **Responses spreadsheet**: delete the whole test row (right-click the row number →
   **Delete row**). Deleting is cleaner than resetting the status.
3. Reload the site and confirm the card is back to normal.

## K11. Optional: test a rejection

Worth doing once, so you know what it looks like. Submit a second fake request, click
**Review & reject** in the email, confirm on the page. Expect: the request marked `REJECTED` in
the private log, **no email sent to the submitter**, and a page giving you a pre-filled email
draft to write them yourself. That's deliberate — for a ten-person journal club, a canned
rejection email is the wrong tone. Then delete that row too.

---

# Part L — Turn the button on on the website (5 min)

Part 0 already published the `/signup/` page and the menu entry. Right now the page says
*"The online form is being set up — email yzj5306@psu.edu"* and the home-page card shows no
button. Filling in the two links below is what switches the whole thing on.

1. Open `/Users/jiangyiyang/My_Academic_HomePage/OkongOyangO.JournalClub/hugo.toml`.
2. Find the `[params.signup]` block near line 92 and fill in the two empty strings using the
   links from **A5**:

   ```toml
     [params.signup]
       enable   = true
       formURL  = "https://forms.gle/aB3dEfGh1JkLmNoP"
       embedURL = "https://docs.google.com/forms/d/e/1FAIpQLSd0000000000000000000000000000000000/viewform?embedded=true"
       label    = "Sign up to present"
       note     = "Requests are reviewed before they appear on the schedule."
   ```

   Keep the quotes. `formURL` is the short share link; `embedURL` is the long one ending in
   `?embedded=true`.

3. Preview locally — **with the subdirectory in the base URL**, or subdirectory path bugs stay
   invisible until production:

   ```bash
   cd /Users/jiangyiyang/My_Academic_HomePage/OkongOyangO.JournalClub
   hugo server -D --port 1315 --baseURL http://localhost:1315/OkongOyangO.JournalClub/
   ```

   Visit <http://localhost:1315/OkongOyangO.JournalClub/signup/> and check the form actually
   renders inside the page, and that the home page now shows the **Sign up to present** button
   in the Upcoming Seminars card. Stop the server with `Ctrl`+`C`.

4. Build and publish. This site is served from the committed `docs/` folder, so the build output
   must be committed:

   ```bash
   cd /Users/jiangyiyang/My_Academic_HomePage/OkongOyangO.JournalClub
   rm -rf docs/ && hugo --gc --minify -d docs
   git add -A && git commit -m "Enable speaker sign-up form" && git push
   ```

5. Confirm `docs/.nojekyll` still exists (`ls docs/.nojekyll`). It's required and committed.
6. Wait ~1 minute, then check
   <https://OkongOyangO.github.io/OkongOyangO.JournalClub/signup/>.

---

# Changing the script later

## The one rule

> **To publish a code change:**
> **Deploy → Manage deployments → ✏️ (Edit) → Version: `New version` → Deploy**

**Never use `Deploy → New deployment` again.** Here's why it matters:

| Path | What happens to the URL | Consequence |
|---|---|---|
| Manage deployments → ✏️ Edit → New version | **URL stays the same** | Everything keeps working. Old emails still work. |
| Deploy → New deployment | **You get a brand-new URL** | Every approve/reject link already sitting in your inbox now points at the old deployment. Your `EXEC_URL` setting is stale. New emails point at the new URL, old ones at the old. Confusing and easy to not notice. |

If you do accidentally create a new deployment:

1. Copy the new `/exec` URL into the `EXEC_URL` Script Property (Part G).
2. **Deploy → Manage deployments**, find the old deployment, **⋮** → **Archive**, so a stale
   URL can't keep serving old code.
3. Any approve link in an email sent before the change is dead. Approve those requests by
   hand: fill in the schedule row yourself, then set `JC Status` to `APPROVED` in the responses
   sheet.

## Saving is not deploying

Pressing `Cmd`+`S` saves your code. It changes what **triggers** run (the submit handler and
the nightly job always run the latest saved code) but it does **not** change what the **web
pages** serve. The review and confirm pages keep serving the last deployed version until you do
the Manage-deployments dance above.

That asymmetry catches everybody once. If you edit the review page's wording, save, and see no
change — you haven't redeployed.

## Changing settings

Script Properties take effect immediately, everywhere, no deploy needed.

## Changing the form

- **Adding or removing a question** is safe. The script finds its data by column name, and
  Google inserts new columns to the left of your `JC …` admin block.
- **Renaming a question** breaks that field until you rename it back. `verifySetup()` catches it.
- **Changing `Preferred date` away from Dropdown** breaks the nightly date refresh.
- After any structural form change, run `verifySetup()` once.

## Changing the schedule sheet

- Adding rows, adding columns, reordering columns: **safe** — everything is found by header name.
- **Renaming the `Date` or `Speaker` column**: the script refuses to write anything and tells
  you so, rather than guessing and putting a name in the wrong column. Rename it back.
- **Running out of weeks:** when the schedule's last row is in the past, the dropdown empties
  and approvals for unlisted dates are refused. Add more week rows (with their Day of Week and
  Time filled in) — the script will never invent a row, because it can't know whether a given
  week is a Monday 4:30 slot or a Wednesday 2:00 one.

---

# Troubleshooting

## Nothing arrives when someone submits

**No notification email at all.**

1. Left sidebar → **Triggers**. Is there a row for `onSignupSubmit`? If not, run
   `installStep2_triggers` (Part H).
2. Left sidebar → **Executions**. Look for a recent `onSignupSubmit` run.
   - **Not there at all** → the trigger isn't attached to the right spreadsheet. Re-run
     `installStep2_triggers`.
   - **Status `Failed`** → click it and read the error; match it against the list below.
3. Check the responses spreadsheet: did the row even arrive? If not, the problem is the form,
   not the script.
4. Check Gmail spam. The email is from you, to you, which occasionally trips filters. Mark it
   *Not spam* once.

**Error: `Exception: You do not have permission to call MailApp.sendEmail`**
The trigger was created as a simple trigger instead of an installable one. Run
`installStep2_triggers` again and delete any hand-made triggers from the Triggers page.

**Error: `Service invoked too many times for one day: email`** — or a row where `JC Notified`
says `QUOTA` or `CAPPED`.
Apps Script on a consumer `gmail.com` account can send to **100 recipients a day** (a Workspace
account gets 1,500 — this one is not Workspace). Nothing is lost: the submission is safely in
the responses sheet with `JC Status = PENDING`, only the notification failed. The quota resets
on a rolling basis, 24 hours after the first send — so just wait a day, or work straight from
the spreadsheet in the meantime. The nightly job reports any `QUOTA`/`CAPPED` rows from the
last week.

- `CAPPED` means more than 20 sign-ups arrived in one day and the bot switched to digest
  mode on purpose. It sends you one "unusual sign-up volume" email and then stops emailing
  you per request, so that a burst of spam through the public form cannot consume the whole
  day's quota and silence every other alert the bot can raise. Open the private log and work
  through the queue there.
- Alerts the bot could not send at all are **not thrown away**: they are stored and prepended
  to the next alert that does get through, and `verifySetup()` reports any that are still
  queued.

**Error: `Schedule schema changed: missing column 'speaker'. Headers seen: …`**
Someone renamed a column in the schedule sheet. The listed headers tell you what it sees now.
Rename the column back to `Speaker` (or `Date`). Nothing was written.

## Clicking a link in the email

**Page says "Nothing to do here. This page only works from a link in a sign-up notification
email."**
The link lost its `?t=…&a=…` part — usually because a mail client mangled it, or you opened the
bare `/exec` URL. Open the email again and click the button rather than copying the URL.

**Page says "Unknown or expired request."**
The token isn't in the responses sheet. Either the row was deleted, or the link was truncated
in transit. Handle it by hand: find the request in the responses sheet, fill in the schedule
row yourself, and set `JC Status` to `APPROVED`.

**Page says "This confirmation page has expired. Open the link in the email again — nothing was
changed."**
You left the review page sitting open for more than about half an hour. Harmless. Go back to
the email and click the button again to get a fresh page.

**Page says "Another approval is being processed. Nothing was changed — please click Confirm
again in a few seconds."**
Two approvals collided. Wait five seconds and click Confirm again.

**Google asks you to sign in, or says you need access.**
Your `EXEC_URL` is a `/dev` URL, or the deployment's **Who has access** got set to something
other than **Anyone**. Check both: Part F's two URL checks, and
**Deploy → Manage deployments → ✏️ Edit**.

**Error 405 / "Sorry, unable to open the file at this time."**
This is what happens if the URL's query parameters get renamed to Apps Script's reserved names
(`c` or `sid`). It shouldn't happen with the delivered code, which uses `t`, `a`, `n`. If you
see it, you're probably on a mangled or hand-edited link — re-click from the email.

**Error: `Script function not found: doGet`**
The pasted code is incomplete, or you redeployed a version that predates it. Re-paste the
source, save, then **Deploy → Manage deployments → ✏️ Edit → New version → Deploy**.

## Approving didn't write anything

**"⚠️ Not written — that slot is taken."**
Someone else already has that week. The request stays `PENDING`, so the link keeps working. The
page gives you the alternate dates the person offered and a pre-filled email to negotiate. Once
you agree on a new date, the cleanest route is to write the schedule row by hand and mark the
request `REJECTED` (or `APPROVED`) in the responses sheet.

**"14 September is marked N/A — an intentional break week."**
A row whose Speaker cell reads `N/A` is a deliberate break and is never treated as free. If it
shouldn't be a break, clear the `N/A` cells and click the approve link again.

**"14 September is not in the schedule sheet."**
The schedule doesn't have a row for that date. Add the row — including its Day of Week and Time
— then click the approve link again. The request is still `PENDING` and the link still works.

**Two rows have the same date ("ambiguous").**
Delete or fix the duplicate in the schedule sheet, then click the link again.

## The website doesn't show an approved talk

1. Hard-refresh (`Cmd`+`Shift`+`R`). Google's query endpoint caches for a minute or two.
2. Check the card only ever shows the **next** upcoming talk — an approval further out won't
   appear until the earlier ones pass.
3. Confirm the Speaker cell really is filled in in the schedule sheet.
4. If nothing else explains it, open the browser console on the site and look for a fetch error
   from `docs.google.com`. If the schedule spreadsheet's sharing ever got changed away from
   *Anyone with the link → Viewer*, the card falls back to its built-in static text and the
   live sync silently stops. That sharing setting must stay on.

## Nightly emails

You only ever get one when something is wrong. Subject:
`[JC signup] Nightly check found N issue(s)`. The body names each problem. The one to treat as
an emergency:

**`CRITICAL: the private responses spreadsheet is link-shared`** / **`is shared with N other
person/people`** / **`answered an UNAUTHENTICATED request with HTTP 200`**
Three flavours of the same emergency: someone can read the responses spreadsheet, which
publishes every submitter's email address and every live approval token.
- *link-shared* → open it → **Share** → **General access** → **Restricted** → **Done**.
- *shared with people* → open it → **Share** → remove the named people.
- *answered anonymously* → usually **File → Share → Publish to web → Stop publishing**. This
  one does **not** show up in the Share dialog, which is exactly why it is checked separately.

Then re-run `verifySetup()` to confirm.

**`Could not test whether the responses spreadsheet is anonymously readable … needs the
script.external_request OAuth scope`**
You pasted `Code.gs` but not `appsscript.json` (Part C step 8), or you pasted an older
manifest. Paste the delivered manifest, save, and run `verifySetup()` again — it will ask you
to re-authorize once.

**`Timezone mismatch: the schedule spreadsheet is on … but this Apps Script project is on …`**
Set them the same. Spreadsheet: **File → Settings → Time zone**. Apps Script: **Project
Settings → Time zone**. Both should be Eastern Time — New York. Left unfixed, an approval can
be written into the wrong week.

**`N request(s) have been PENDING for more than 7 days`**
Nothing is broken — these are requests you haven't answered. Approve or reject them, or write
to the people. Rejections and expiries send **no** automatic email, so this nag is the only
thing standing between a real person and silence.

**`no open dates`**
The schedule has no free future weeks at least 7 days out. Add rows to the schedule sheet and
run `refreshFormDates()`.

## You get two notification emails per submission

Duplicate triggers. Left sidebar → **Triggers** → delete the extra `onSignupSubmit` row via
**⋮** → **Delete trigger**. Then run `installStep2_triggers` once, which enforces exactly one
of each.

## Emergency stop

To immediately stop all new signups: open the form → click **Published** (top right) → turn
**Accepting responses** off. (There is also an **Unpublish** option there, which takes the form
offline entirely.) Either way, responses already collected are untouched and existing approve
links keep working — the form just stops taking anything new.

To stop the approval machinery too: **Deploy → Manage deployments → ⋮ → Archive**. That kills
every approve link in every email already sent. Use only if you think a token has been leaked
somewhere it shouldn't be.

---

# Quick reference — running it week to week

Once set up, there is nothing to maintain. Your entire routine is:

1. An email arrives: *[JC signup] Someone — some date (slot free)*.
2. Click **Review & approve** (or **Review & reject**).
3. Read the page. Click the confirm button.
4. If you **approved**: done. The speaker gets a confirmation email; the site updates itself.
   If you **rejected**, or the slot turned out to be taken: the page gives you a pre-filled
   email draft — **send it.** Nothing is sent to the person automatically in those cases, and
   if you close the tab they hear nothing at all.

Everything else — refreshing the form's date list, expiring stale requests, checking the
responses sheet is still private — happens on its own at 4am, and you only hear about it if
something is wrong.

**Useful links to bookmark:**

| | |
|---|---|
| Apps Script project | <https://script.google.com> → *JC Signup Bot* |
| Execution history | Apps Script → left sidebar → **Executions** |
| Health check | Apps Script → run `verifySetup` |
| Pending requests | the responses spreadsheet, `JC Status` column |

---

# Appendix — UI labels verified

Google renames things, so the click paths above were checked against current documentation
rather than memory (checked 2026-08-08):

| Claim | Source |
|---|---|
| `Deploy > New deployment`, gear icon → **Web app**, `/exec` vs `/dev` URLs, `/dev` "only be accessed by users who have edit access to the script" | [Web Apps — Apps Script](https://developers.google.com/apps-script/guides/web) |
| Redeploying without changing the URL: **Manage deployments** → pencil → Version **New version** → Deploy; and that **New deployment** mints a new URL | [Create and manage deployments](https://developers.google.com/apps-script/concepts/deployments), [Redeploying Web Apps without Changing URL](https://gist.github.com/tanaikech/ebf92d8f427d02d53989d6c3464a9c43) |
| **Project Settings** → **Script Properties** → **Add script property** / **Edit script properties** / **Save script properties** | [Properties Service](https://developers.google.com/apps-script/guides/properties) |
| Triggers sidebar (alarm-clock icon) → **Add Trigger**; event source **From spreadsheet** with event type **On form submit**; deployment field defaults to *Head* | [Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable), [Essential Apps Script — Forms and events, Univ. of York](https://subjectguides.york.ac.uk/apps-script/forms) |
| script.google.com → **New project**; rename via the **Untitled project** label; **Time zone** in Project Settings | [Apps Script projects](https://developers.google.com/apps-script/guides/projects) |
| **Enable Chrome V8 runtime** checkbox in Project Settings | [Apps Script V8 Runtime Explained](https://www.benlcollins.com/apps-script/apps-script-v8-runtime/) |
| Forms **Publish** button top-right → **Manage** → **General access** → responder role; **Published** → **Copy responder link**; forms now require publishing (fall 2024 change) | [Publish & share your form with responders](https://support.google.com/docs/answer/2839588?hl=en), [Learn about updates in Google Forms](https://support.google.com/docs/answer/16319311) |
| **Collect email addresses** options **Verified / Responder input / Do not collect** | [Google Forms enhanced email collection](https://www.devdiscourse.com/article/technology/2499656-google-forms-introduces-enhanced-email-collection-options), [View & manage form responses](https://support.google.com/docs/answer/139706?hl=en) |
| Responses tab → **Link to Sheets**; Settings → Responses → **Send responders a copy of their response** (*When requested* / *Always*) | [View & manage form responses](https://support.google.com/docs/answer/139706?hl=en) |
| Settings → **Presentation** → **Confirmation message** → **Edit**; **Restrict to 1 response**; **Allow response editing** | [Google Forms: Setting the Confirmation Message](https://alicekeeler.com/2021/12/20/google-forms-setting-the-confirmation-message/) |
| OAuth consent: **"Google hasn't verified this app"** → **Advanced** → **Go to <project> (unsafe)** | [Guide to Complete Google Apps Script Authorization](https://ashtonfei.substack.com/p/guide-to-complete-google-apps-script) |
| Stopping a form: **Published** → turn off **Accepting responses**; **Unpublish** exists too | [How to Close a Google Form](https://supademo.com/blog/how-to-close-a-google-form), [Publish and manage responders](https://developers.google.com/workspace/forms/api/guides/publish-form) |
| Consumer gmail.com email quota = **100 recipients/day** (Workspace 1,500), resetting **24 hours after the first request** | [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) |
| Drive share dialog: **Share** → **General access** → **Restricted** / **Anyone with the link** | [Share files from Google Drive](https://support.google.com/drive/answer/2494822?hl=en) |

Three click paths could not be confirmed from documentation and are described loosely enough
to survive a rename:

- the exact wording of the two radio options in the **Link to Sheets** dialog
  (*Create a new spreadsheet* / *Select existing spreadsheet*);
- the per-question **⋮** → **Description** toggle in the Forms question editor;
- **A5's `Send` → `< >` (Embed HTML)** path. Since the 2024 publish redesign, whether a
  separate **Send** button appears next to **Published** depends on the account, so A5 also
  gives a fallback that needs no menu at all (open the responder link and read the
  `/viewform` URL off the address bar).
