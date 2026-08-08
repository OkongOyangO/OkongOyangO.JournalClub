/**
 * ONE-SHOT INSTALLER — replaces Parts A, B and D of SETUP.md.
 *
 * Run `autoInstall()` once. It creates, in your own Google account:
 *   1. the sign-up Form, with all eight questions, types, help text and required flags
 *   2. a BRAND-NEW, PRIVATE spreadsheet for the responses
 *   3. the link between them
 *   4. every Script Property the main script needs, except EXEC_URL
 *
 * It then prints a checklist of the few things it could not do for you.
 *
 * WHY THIS EXISTS: doing the above by hand is ~35 minutes of clicking, and the eight
 * question titles have to match Code.gs character for character — a typo there fails
 * silently at the worst moment (a real person's request arrives and the field is blank).
 * Generating them from the same source removes that whole class of mistake.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: grant OAuth consent. Running this is what triggers
 * the consent screen, and that decision is yours — the scopes include "send email as you"
 * and "read your Drive".
 *
 * SAFE TO READ FIRST. Nothing happens until you press Run.
 */

// ---------------------------------------------------------------------------
// The public schedule spreadsheet. Already known — this is the sheet the website
// reads. It is world-readable, which is exactly why the responses must NOT live in it.
// ---------------------------------------------------------------------------
var INSTALL = {
  SCHEDULE_SS_ID: '1qyJctJWwThQQqEfSTpArsCFfoyeAas9ttr16yNbRVP4',
  SCHEDULE_TAB_GID: '0',
  NOTIFY_EMAIL: 'jiangyiyang2019@gmail.com',
  DEFAULT_ROOM: 'Davey 339',
  LEAD_DAYS: '7',
  MAX_CHOICES: '30',

  FORM_TITLE: 'Condensed Matter + AI Journal Club — Sign Up to Present',
  RESPONSES_SS_NAME: 'Journal Club Sign-Up Responses (PRIVATE)',

  FORM_DESCRIPTION:
    'Request a slot to present at the Penn State Condensed Matter + AI Journal Club.\n\n' +
    'Every request is read by a human before anything happens — nothing appears on the ' +
    'public schedule until it is approved. You will hear back by email either way.',

  CONFIRMATION:
    'Thanks — your request has been sent to Yiyang for review.\n\n' +
    'Nothing appears on the public schedule until it is approved. Yiyang will email you ' +
    'either way, usually within a few days. If your preferred date gets taken in the ' +
    "meantime, he'll write to you about alternatives."
};

/**
 * The eight questions. `type` maps to the FormApp item constructor.
 * The titles are the contract with Code.gs — it looks its data up by these names.
 */
var QUESTIONS = [
  { type: 'text',      title: 'Speaker name',
    help: 'Exactly as it should appear on the public schedule.', required: true },

  { type: 'text',      title: 'Affiliation',
    help: 'Department or institution, e.g. PSU, Cornell, UIUC.', required: true },

  { type: 'text',      title: 'Advisor',
    help: 'Leave blank if not applicable (faculty, postdoc, or independent).', required: false },

  // The dropdown. Seeded with a placeholder only — refreshFormDates() overwrites the
  // entire choice list with the genuinely open dates. A ListItem must have >= 1 choice
  // or Forms refuses to save it, hence the placeholder.
  { type: 'list',      title: 'Preferred date',
    help: 'Only currently-open dates are listed. The list is refreshed nightly.',
    required: true, choices: ['(dates load after setup — run refreshFormDates)'] },

  { type: 'text',      title: 'Talk title',
    help: 'Leave blank if undecided — the schedule will show "Topic to be announced".',
    required: false },

  { type: 'paragraph', title: 'Abstract or short description',
    help: 'A few sentences, or a paper link. Optional.', required: false },

  { type: 'paragraph', title: 'Other dates that would also work',
    help: 'If your first choice is taken, what else could you do?', required: false },

  { type: 'paragraph', title: 'Anything else Yiyang should know?',
    help: '', required: false }
];

/**
 * Run this. Once.
 */
function autoInstall() {
  var props = PropertiesService.getScriptProperties();
  var out = [];

  // Guard against a double run. Creating a second Form would leave the first one live
  // and collecting responses nobody reads.
  if (props.getProperty('FORM_EDIT_ID')) {
    throw new Error(
      'FORM_EDIT_ID is already set — autoInstall() appears to have run before.\n' +
      'If you really want to start over, delete the FORM_EDIT_ID and RESPONSES_SS_ID ' +
      'properties under Project Settings > Script Properties, and delete the old Form ' +
      'and responses spreadsheet from your Drive first.');
  }

  // -- 1. the Form -----------------------------------------------------------
  var form = FormApp.create(INSTALL.FORM_TITLE);
  form.setDescription(INSTALL.FORM_DESCRIPTION);
  form.setConfirmationMessage(INSTALL.CONFIRMATION);
  form.setAllowResponseEdits(false);      // an edited response would not re-trigger review
  form.setLimitOneResponsePerUser(false); // would force a Google sign-in
  form.setIsQuiz(false);
  out.push('Created Form: ' + INSTALL.FORM_TITLE);

  // Email collection. The API was renamed when Forms added the "Verified / Responder
  // input" distinction; older projects only have setCollectEmail. Try the new call and
  // fall back, because we want RESPONDER INPUT specifically — "Verified" would force a
  // Google sign-in and shut out anyone whose .edu address isn't Google-backed.
  var emailMode = '';
  try {
    form.setEmailCollectionType(FormApp.EmailCollectionType.RESPONDER_INPUT);
    emailMode = 'Responder input (via setEmailCollectionType)';
  } catch (e1) {
    try {
      form.setCollectEmail(true);
      emailMode = 'enabled via legacy setCollectEmail — CHECK it reads "Responder input", not "Verified"';
    } catch (e2) {
      emailMode = 'COULD NOT SET AUTOMATICALLY — set it by hand (Settings > Responses > Collect email addresses > Responder input)';
    }
  }
  out.push('Email collection: ' + emailMode);

  // -- 2. the questions ------------------------------------------------------
  for (var i = 0; i < QUESTIONS.length; i++) {
    var q = QUESTIONS[i];
    var item;
    if (q.type === 'text')            { item = form.addTextItem(); }
    else if (q.type === 'paragraph')  { item = form.addParagraphTextItem(); }
    else if (q.type === 'list')       { item = form.addListItem(); }
    else { throw new Error('Unknown question type: ' + q.type); }

    item.setTitle(q.title);
    if (q.help) { item.setHelpText(q.help); }
    item.setRequired(!!q.required);
    if (q.choices) { item.asListItem().setChoiceValues(q.choices); }
  }
  out.push('Added ' + QUESTIONS.length + ' questions with exact titles.');

  // -- 3. the PRIVATE responses spreadsheet ----------------------------------
  // A file created by SpreadsheetApp.create() is private to its owner by default.
  // That is the whole point: the schedule spreadsheet is public and Sheets sharing is
  // file-level, so responses (which carry email addresses) need their own file.
  var respSS = SpreadsheetApp.create(INSTALL.RESPONSES_SS_NAME);
  var respId = respSS.getId();
  out.push('Created PRIVATE responses spreadsheet: ' + INSTALL.RESPONSES_SS_NAME);

  if (respId === INSTALL.SCHEDULE_SS_ID) {
    throw new Error('Impossible state: the new spreadsheet has the schedule spreadsheet id.');
  }

  // Match the schedule's timezone so "today" means the same thing in both files.
  try {
    var schedTz = SpreadsheetApp.openById(INSTALL.SCHEDULE_SS_ID).getSpreadsheetTimeZone();
    respSS.setSpreadsheetTimeZone(schedTz);
    out.push('Responses spreadsheet timezone set to ' + schedTz + ' (matches the schedule).');
  } catch (tzErr) {
    out.push('Could not sync timezone automatically: ' + tzErr.message +
             ' — set it by hand under File > Settings on BOTH spreadsheets.');
  }

  // -- 4. link them ----------------------------------------------------------
  form.setDestination(FormApp.DestinationType.SPREADSHEET, respId);
  SpreadsheetApp.flush();

  // Read the real tab name rather than assuming "Form Responses 1" — the casing and
  // numbering vary, and a wrong RESPONSES_TAB_NAME sends the script to the wrong tab.
  var respTabName = '';
  var reopened = SpreadsheetApp.openById(respId);
  var sheets = reopened.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getName() !== 'Sheet1') { respTabName = sheets[s].getName(); break; }
  }
  if (!respTabName) {
    // The linked tab can take a moment to materialise; fall back to the first sheet
    // and tell the user to verify rather than silently guessing.
    respTabName = sheets[0].getName();
    out.push('WARNING: could not identify the linked response tab; guessed "' + respTabName +
             '". Open the spreadsheet and confirm RESPONSES_TAB_NAME matches the tab that ' +
             'has the form headers in row 1.');
  } else {
    out.push('Linked Form to spreadsheet; response tab is "' + respTabName + '".');
    // Remove the empty default sheet so the file has exactly one, unambiguous tab.
    try {
      var blank = reopened.getSheetByName('Sheet1');
      if (blank && reopened.getSheets().length > 1) {
        reopened.deleteSheet(blank);
        out.push('Removed the empty default "Sheet1".');
      }
    } catch (delErr) {
      out.push('Left "Sheet1" in place (' + delErr.message + ') — harmless.');
    }
  }

  // -- 5. the Script Properties ---------------------------------------------
  props.setProperties({
    SCHEDULE_SS_ID:     INSTALL.SCHEDULE_SS_ID,
    SCHEDULE_TAB_GID:   INSTALL.SCHEDULE_TAB_GID,
    RESPONSES_SS_ID:    respId,
    RESPONSES_TAB_NAME: respTabName,
    FORM_EDIT_ID:       form.getId(),
    NOTIFY_EMAIL:       INSTALL.NOTIFY_EMAIL,
    DEFAULT_ROOM:       INSTALL.DEFAULT_ROOM,
    LEAD_DAYS:          INSTALL.LEAD_DAYS,
    MAX_CHOICES:        INSTALL.MAX_CHOICES
  }, false);
  out.push('Wrote 9 Script Properties (EXEC_URL still missing — it cannot exist yet).');

  // -- 6. try to publish -----------------------------------------------------
  // Forms added a publish model in late 2024: a form is unreachable until published.
  // setPublished() is not available in every project, so attempt and report honestly.
  var publishNote;
  try {
    form.setPublished(true);
    publishNote = 'Form published automatically. Still confirm the audience is ' +
                  '"Anyone with the link" (Publish > Manage > General access).';
  } catch (pubErr) {
    publishNote = 'COULD NOT PUBLISH AUTOMATICALLY — do it by hand: open the form, ' +
                  'click Publish (top right), Manage > General access > Anyone with the ' +
                  'link, role Responder, Done, Publish. Until then the responder link errors.';
  }
  out.push(publishNote);

  // -- 7. report -------------------------------------------------------------
  var report =
    '================ AUTO-INSTALL COMPLETE ================\n\n' +
    out.join('\n') + '\n\n' +
    '---------------- LINKS YOU NEED ----------------\n' +
    'Form (edit):      ' + form.getEditUrl() + '\n' +
    'Form (responder): ' + form.getPublishedUrl() + '\n' +
    'Responses sheet:  https://docs.google.com/spreadsheets/d/' + respId + '/edit\n\n' +
    'For hugo.toml [params.signup] at the very end (Part L):\n' +
    '  formURL  = "' + form.getPublishedUrl() + '"\n' +
    '  embedURL = "' + form.getPublishedUrl().replace(/\/viewform.*$/, '/viewform?embedded=true') + '"\n\n' +
    '---------------- WHAT IS LEFT FOR YOU ----------------\n' +
    '1. Verify the publish state and audience (see above).\n' +
    '2. Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.\n' +
    '3. Paste the /exec URL into Script Properties as EXEC_URL.\n' +
    '4. Run installStep1_bootstrap()  (mints HMAC_SECRET, adds the admin columns)\n' +
    '5. Run installStep2_triggers()   (on-submit + nightly)\n' +
    '6. Run refreshFormDates()        (fills the date dropdown)\n' +
    '7. Run verifySetup()             (until it reports clean)\n' +
    '8. Do the end-to-end test — SETUP.md Part K.\n' +
    '=======================================================';

  Logger.log(report);
  console.log(report);
  return report;
}

/**
 * Emergency undo for a botched run: clears the properties autoInstall() set so it
 * can run again cleanly, and prints links to the two files for you to delete.
 *
 * It does NOT delete the files itself. Trashing a Drive file needs the full
 * read-write `drive` scope; this project deliberately only asks for
 * `drive.readonly` (it is used solely to check that the responses sheet has not
 * become shared). Widening that scope permanently, so an undo function that runs
 * maybe once can save two clicks, is a bad trade — a leaked or misbehaving script
 * with `drive` can delete anything you own.
 *
 * Never touches the public schedule spreadsheet.
 */
function undoAutoInstall() {
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty('FORM_EDIT_ID');
  var respId = props.getProperty('RESPONSES_SS_ID');

  if (respId && respId === INSTALL.SCHEDULE_SS_ID) {
    throw new Error('RESPONSES_SS_ID points at the PUBLIC schedule. Refusing to proceed.');
  }

  var keys = ['FORM_EDIT_ID', 'RESPONSES_SS_ID', 'RESPONSES_TAB_NAME', 'DATE_ITEM_ID'];
  for (var i = 0; i < keys.length; i++) { props.deleteProperty(keys[i]); }

  var msg =
    'Cleared: ' + keys.join(', ') + '\n\n' +
    'Now delete these two files from your Drive by hand, so autoInstall() starts clean:\n' +
    (formId ? '  Form:            https://docs.google.com/forms/d/' + formId + '/edit\n'
            : '  Form:            (no FORM_EDIT_ID was set)\n') +
    (respId ? '  Responses sheet: https://docs.google.com/spreadsheets/d/' + respId + '/edit\n'
            : '  Responses sheet: (no RESPONSES_SS_ID was set)\n') +
    '\nThen run autoInstall() again.';

  Logger.log(msg);
  console.log(msg);
  return msg;
}
