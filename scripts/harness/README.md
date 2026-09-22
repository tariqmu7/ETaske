# Harnesses

No test framework is installed in this repo and none is being added. These are
plain `node` scripts that bundle the **real** application modules with esbuild
(already present as a Vite dependency), stub only what needs a network or a
Firebase session, and assert on the actual behaviour. Each exits non-zero on
failure.

```bash
node scripts/harness/inboxconvert.mjs # ManagerInbox -> CreateTaskPanel, in a browser (78 assertions)
node scripts/harness/bidtask.mjs      # opportunity -> task: the Tasks tab, in a browser (55)
node scripts/harness/tasklinks.mjs    # task -> bid/project: the link picker + history, browser (59)
node scripts/harness/maillinks.mjs    # email -> bid/project: the correspondence form, the inherited
                                      #   link on the task it is assigned as, the inbox conversion (73)
node scripts/harness/recordlinks.mjs  # src/lib/recordLinks.ts -> the documents a link writes (52)
node scripts/harness/bidalerts.mjs    # src/lib/dueAlerts.ts  -> runBidDeadlineAlerts (35)
node scripts/harness/deeplink.mjs     # src/lib/deepLink.ts   -> notification -> URL -> record (20)
node scripts/harness/bidexport.mjs    # src/lib/exportData.ts -> exportOpportunities workbook (17)
node scripts/harness/mailsuggest.mjs  # src/lib/mailSuggest.ts -> mail -> the record it should become (69)
node scripts/harness/mailthreads.mjs  # src/lib/mailThreads.ts -> reply chains + both "no reply" flags (85)
node scripts/harness/dailybriefing.mjs # src/lib/dailyBriefing.ts -> the once-a-day briefing + manager digest (78)
node scripts/harness/followup.mjs     # src/lib/followUp.ts   -> the AR/EN chaser letters + escalation (266)
node scripts/harness/telegramreply.mjs # google-apps-script.js -> reply "done" / "delay to Sunday" to a
                                      #   Telegram reminder; pure block + the whole webhook vs a fake Firestore (290)
node scripts/harness/quickcapture.mjs # src/lib/quickCapture.ts -> one box: sentence/pasted mail -> record,
                                      #   owner, date, link (226)
node scripts/harness/quickcaptureui.mjs # the Home box in a browser -> the real CreateTaskPanel -> the task
                                      #   written; bid/correspondence hand-off, AR/RTL, 390 px, and the
                                      #   mic (fake recogniser): Arabic voice note -> task (71)
node scripts/harness/voicenote.mjs    # src/lib/dictation.ts + spoken dates in quickCapture.ts -> Egyptian
                                      #   voice notes read right, Android repeats stitched once (110)
node scripts/harness/checklists.mjs   # src/lib/checklists.ts -> starting checklists: templates, dating
                                      #   back from the deadline, tick/add/top-up/re-date, AR keys (192)
node scripts/harness/checklistui.mjs  # the real bid + project boards in a browser: picker -> checklist
                                      #   written, card "0/11 steps", Checklist tab, AR/RTL, 390 px (50)
node scripts/harness/askrecords.mjs   # src/lib/askRecords.ts -> "what did we send NNPC in July?" read into
                                      #   filters (EN/AR periods, client, person, state, sent/received) (179)
node scripts/harness/askui.mjs        # the Ask box in a browser: answer rows, "Understood as", row opens
                                      #   its record, private tasks hidden, example chips, AR/RTL, 390 px (32)
node scripts/harness/homebriefing.mjs # src/lib/homeBriefing.ts -> the Home sentences: late/today/sign-off/
                                      #   tenders/mail/review/contracts, manager vs employee scope, order (35)
node scripts/harness/homeui.mjs       # Home as a briefing page in a browser: wording, each line's target,
                                      #   All sections one level down, all-clear, AR/RTL, 390 px (54)
node scripts/harness/clientfile.mjs   # src/lib/clientFile.ts -> client keys, letter matching (APC ≠ CAPCO),
                                      #   what we owe them, contacts, contracts running out (104)
node scripts/harness/clientui.mjs     # the Clients page in a browser: list, one client's file, rows open
                                      #   records, Outlook helper on/off, AR/RTL, 390 px (55)
node scripts/harness/waitingboard.mjs # src/lib/waitingBoard.ts -> which side each open item is on, its age in days,
                                      # the 'waiting on them' mark and who may set it, filters (87 assertions)
node scripts/harness/waitingui.mjs    # the Waiting board in a browser: both columns, Outlook chains, filters, mark /
                                      # back to us (the only write), follow-up letter, AR/RTL, 390 px (--shot)
node scripts/harness/deadlinecalendar.mjs # src/lib/deadlineCalendar.ts -> which dates land on the calendar, renewals,
                                      # the contracts-running-out watch, filters, month grid, alert buckets/text (102)
node scripts/harness/calendarui.mjs   # the Calendar page in a browser: watch box, grid + "+N more", day panel, month
                                      # links, filters, rows open records, AR/RTL, 390 px day list (50; --shot for PNGs)
node scripts/harness/projectdocs.mjs  # src/lib/projectDocuments.ts -> safe links, filing/edit/remove on the array,
                                      # gathering filed + letters + task files, Arabic folding + search, marks (248)
node scripts/harness/docsui.mjs       # Documents page + project Documents tab in a browser: search, filters, project
                                      # link lands on the tab, file (bad link refused) / edit / remove, AR/RTL, 390 px (54)
node scripts/harness/meetings.mjs     # src/lib/meetings.ts -> meeting helper (D5): stored shape, stages, rights, action
                                      #   points -> task fields, action lines read out of EN/AR notes, series, agenda
                                      #   suggestions, invitation + minutes in EN/AR (Arabic style sweep), locale keys
node scripts/harness/meetingsui.mjs   # Meetings page in a browser: list scope, create, suggestions, agenda save, invite
                                      #   mailto, find action points, create tasks, state follows the board, filing the
                                      #   minutes on a project, read-only, AR/RTL, 390 px (--shot for PNGs)
node scripts/harness/handover.mjs     # src/lib/handover.ts -> handover file (D7): what is open in a person's name,
                                      #   "in charge" name matching (EN/AR titles), who may move what, the writes, note (73)
node scripts/harness/handoverui.mjs   # Handover page in a browser: ?person= link, one row handed over + notification,
                                      #   letter takes its linked task, give-everything with confirm (ONE notification),
                                      #   copied note, employee view with a locked letter, AR/RTL, 390 px (52; --shot)
node scripts/harness/duplicates.mjs   # src/lib/duplicates.ts -> duplicates (D8): same tender number / client+title, letters,
                                      #   tasks, projects, look-alikes NOT flagged, 3 copies = 1 group, clashes, New-bid check (82)
node scripts/harness/duplicatesui.mjs # Duplicates page + New bid warning in a browser: groups + why, filters, dismiss kept
                                      #   across remount, rows open records, "Let them know", AR/RTL, 390 px (46; --shot)
node scripts/harness/weeklyreport.mjs # src/lib/weeklyReport.ts -> weekly Arabic report (D9): Sun–Sat weeks, done/late as of the
                                      #   week's end, letters/bids/projects/meetings, per person, Arabic counts + wording (99; --print)
node scripts/harness/weeklyreportui.mjs # Weekly report page in a browser: text, tiles, week arrows + URL, department heading kept,
                                      #   edit + undo, copy/download, private task out, AR/RTL, 390 px (39; --shot)
```

## Logic harnesses (Opportunities module)

`mailsuggest` covers the Outlook Feed's suggestion engine: subject cleaning, the
sender domain, tender numbers, the date formats a deadline can arrive in
(including "within N days" in both languages), matching a mail against the
clients already on the boards, which record each mail should become, the
priority/confidence it lands on, the queue's filtering and order, and the
handled-mail ledger. Its fixtures are all relative dates.

`quickcapture` covers the one-box capture on Home (queue C1): reading a date
out of how people actually type it (today/tomorrow/«بكرة», every weekday name
in both languages from all seven starting days, "next week" = the coming Sunday,
"end of the week" = Thursday, "in 3 days"/«بعد ٣ أيام», 30/9, 5 Oct, Arabic
digits — and what is NOT a date: 2.5 million, "monthly"), who the owner is
("Ahmed to send", "ask Mona", "I will", «على سارة», an ambiguous first name
naming nobody, English accounts found from Arabic names and back), which record
the text is (a new tender → bid, "we received a letter" → correspondence, else
a task), priority, and a pasted Outlook mail (English and Arabic headers) going
through `suggestFromEmail` unchanged. `today` is injected; every expectation is
computed from it.

`voicenote` covers the mic on the same box (queue C2): what a browser's
recogniser writes for Egyptian speech — numbers as words («خمسة وعشرين أكتوبر»،
«الخامس من أكتوبر»، «يوم تلاتين تسعة»), Arabic month names, «بعد يومين»، «خلال
أسبوع», the spoken day names «يوم الحد»، «التلات الجاي» from all seven starting
days — and the same words when they are NOT days («الحد الأدنى»، «التلات عروض»،
«الاتنين هيروحوا»); whole notes to owner/date/link («خلي أحمد يبعت …»،
«فكرني …»); stitching the recogniser's pieces (desktop appends, Android repeats
the whole transcript each time), hesitation sounds, error names.

`checklists` / `checklistui` cover the starting checklists (queue C3). The
dating rule is the one to keep an eye on: with the deadline still ahead, a step
whose natural date is already past is pulled up to today (a tender announced a
week before its deadline must not open half red); with the deadline itself
past, the real (late) dates stand. `checklistui` is what caught the
stale-`e.target.value` bug in the row date box — a controlled input snaps back
before the transaction runs, so the value must be read in the handler.

`mailthreads` covers the layer above it: how a reply chain is keyed (RE:/FW:,
[EXTERNAL] tags, stray spacing and punctuation, Arabic رد: and ة/ه, and the
short subject that must stand alone), whether an outgoing mail really answers
the person who wrote in, the working-day count across the Fri/Sat weekend, the
"nobody replied" flag and when it clears or restarts, the chase list and its
own ledger prefix, the MIRROR flag (we wrote last and they have gone quiet,
with its own four-working-day threshold and its own `chase:` ledger prefix),
and the rule that one thread offers exactly one suggestion.
Its "today" is pinned to a known Monday on purpose — the whole point is which
day of the week a date falls on — and every fixture date is relative to it.

`dailybriefing` covers the morning message: which bucket a date falls in
(late / today / inside the week / too far off), the countdown wording and its
singulars, what counts as an open record, the headline sentence and its counts,
the five-bullet cap per section and the "…and N more" tail, the ten-line ceiling
on the manager digest even against a forty-item backlog, the per-person split of
both the load and the late work, the once-a-day ledger (per person, both halves
stamped separately, a corrupt blob survived, an empty day still stamped) and the
payload — no relatedId, and the `#/due-soon` link instead of a record deep link.
Its fixtures are all relative dates; `localDay` is asserted on a fixed local
clock on purpose, since the bug it exists to prevent is a UTC date rollover.

`followup` covers the chaser and the escalation: the tone a wait earns
(polite / firmer / final notice), the English and Arabic letters at each tone
for a client and for a colleague, the Arabic day-count agreement (singular,
dual, the 3-10 plural, singular again from 11), a sweep of every Arabic
tone/audience combination for the marks of a translation (no تم/بواسطة/
الخاص بـ, no Arabic-Indic digits, no Latin comma, no "undefined" and no gap
left by a missing field), the mailto draft, the quiet-day clock (late AND
untouched, an edit buying a fresh window, a closed or undated record never
counting), the two escalation levels, the manager's wording, and the run
itself — employees raise nothing, each level fires once, the per-run and
per-day caps hold and the longest-quiet record is reported first. Its "now"
is a pinned Monday, for the same weekend reason as `mailthreads`.

`bidalerts` / `deeplink` / `bidexport` cover the parts of the bid-deadline
feature that `tsc` cannot see: the countdown buckets and their once-per-day
dedupe, the separate daily budget, the notification wording, the deep-link round
trip, and the derived spreadsheet columns (weighted value, gate slippage,
orphaned child rows).

- `src/utils.ts` reads `import.meta.env` at module load, so the bundle needs
  `define: { 'import.meta.env': ... }` or it throws on import.
- Under `platform: 'neutral'` esbuild will not read `xlsx`'s `main` field —
  resolve it to `node_modules/xlsx/xlsx.mjs` explicitly (see `bidexport.mjs`).
- `bidexport.mjs` captures the workbook by stubbing `URL.createObjectURL`, then
  reads the bytes back with `xlsx` — the assertions run against a real parsed
  `.xlsx`, not against the in-memory objects.

## UI harness (`inboxconvert.mjs`)

A **click-through** of the correspondence → task conversion, which cannot be
exercised against the running app without a signed-in Firebase session. It
renders the real `ManagerInbox`, `CreateTaskPanel` and `ComboBox` — with the
real `src/index.css` — in headless Edge and drives them over CDP.

Real: `ManagerInbox`, `CreateTaskPanel`, `ComboBox`, `counters`, `taskVisibility`,
`pushNotification`, `notifyDetails`, `deepLink`, `utils`, `i18n`, `index.css`.
Faked: `firebase/firestore` (an in-memory store that records every write),
`src/lib/firebase.ts`, and `window.fetch` (the Apps Script push proxy).

```bash
node scripts/harness/inboxconvert.mjs           # 78 assertions
node scripts/harness/inboxconvert.mjs --headed  # watch it in a visible window
node scripts/harness/inboxconvert.mjs --shot    # PNG at each step (gitignored)
```

It covers: the prefill (subject, body, manager note, priority, deadline,
classification, attachment, file paths), the assignee actually chosen in the
panel being mirrored back onto the correspondence, collaborators, the serial
counter, the notification + FCM/Telegram fan-out, the reassign-in-place path for
an already-converted correspondence, and layout at 1440 and 390 px.

## UI harness (`bidtask.mjs`)

The same machinery pointed at **create-a-task-from-a-bid** (`OpportunityDetail`
→ `OpportunityTasksTab` → `CreateTaskPanel` → `src/lib/recordLinks.ts`). It
shares `fakeFirestore.mjs`, so the store, the write log and the assertion style
are identical.

It covers: which tasks the tab lists (linked to *this* bid only, another user's
private task excluded exactly as the rules would, open work sorted above
finished), the deep-link hand-off into the tasks dashboard, the created task
being born with `opportunityId` + its denormalized labels, the follow-up entry
mirrored onto the bid (author = the signed-in uid, English text, **stage and
`nextActionDate` deliberately untouched**), the past-deadline case that must
seed no due date, layout at 1440/390 px, and the whole tab in Arabic/RTL.

- `__setLang` must call **`applyLanguageToDocument` as well as
  `i18n.changeLanguage`** — stamping `<html dir>` is the app's job
  (`hooks/useLanguage.ts`), not i18next's, so calling only `changeLanguage`
  renders Arabic text in an LTR document.
- Assert page copy with **`textContent`, not `innerText`**: `innerText` returns
  the *transformed* text, so an `uppercase` heading reads "WORK ON THIS BID".
- `__exact` exists because the "Tasks" tab and the "New task for this bid"
  button both contain the word — a substring match clicks the wrong element.

## UI harness (`maillinks.mjs`)

The correspondence side of the same feature (queue task 5): the link picker in
the **correspondence form** (`CorrespondingsDashboard`), and the link travelling
from the email onto the task it becomes. One page mounts both screens and swaps
between them (`window.__mount('corr'|'inbox')`) — mounting both at once gives
every text-based finder two candidates.

It covers: the picker's options (ids as values, `--stats--` filtered out), a
correspondence born linked posting one English entry into the bid *and* the
project, an unlinked one inventing no keys and posting nothing, the edit form
opening on the stored link, a re-save posting nothing, attaching / detaching
(`deleteField`), **Closed reading as "completed" rather than "is now"**, the task
created by assigning a linked correspondence **inheriting its links** (both the
modal path and the inline quick-assign), the `ManagerInbox` conversion opening
on the correspondence's own link and posting exactly ONE entry (the panel
announces, the inbox does not), and Arabic/RTL at 1440 and 390 px.

- ⚠ **Seed the serial counter well above the seeded serials.** With
  `--stats--: 40` a correspondence created mid-run got `CR000041`, the same
  serial as a seeded record, and every serial-based finder then edited the wrong
  card — 8 assertions failed for a reason that had nothing to do with the code.
- ⚠ **Scope a field finder to its card.** Every unassigned card carries its own
  quick-assign `<select>`; the first match on the page belongs to someone else.
- ⚠ Give a phase its own untouched record when earlier steps mutate state — the
  inbox phase uses `c-inbox`, which nothing before it opens.

Notes for anyone extending either UI harness:

- **Clicks are real** `Input.dispatchMouseEvent` calls at element centres, and
  `clickEl` refuses to click an element something else covers. That is
  deliberate — it is what proves the slide-over sits above the modal. It also
  means selectors must be scoped: `__one('button', 'Cancel')` finds the
  *modal's* Cancel behind the backdrop, so panel lookups go through
  `__panelRoot()`.
- **A `<select>` cannot be opened headlessly.** `setSelect` writes through the
  native value setter and dispatches `change`, the way React reads it.
- **The fake resolves `serverTimestamp()` on write**, exactly as Firestore does.
  Leaving the sentinel readable makes consumers' `createdAt.toDate()` throw and
  blanks the whole page. Assert the sentinel against `window.__writes` (what was
  sent); assert values against the store (what is readable).
- **`window.onerror` on a `file://` page only says "Script error."** — the real
  stack comes from the CDP `Runtime.exceptionThrown` event, which the harness
  collects and asserts on at the end.
- The generated page carries the same `<meta name="viewport">` as the real
  `index.html`; without it Edge lays the page out wide and scales it down, and
  the narrow-width checks pass while proving nothing.

## Private Drive files (`drivefiles.mjs`, queue task A2b)

Part A runs the real `google-apps-script.js` against fakes of Drive, Firebase
Auth and Firestore: uploads are not link-shared, `download` needs an Approved
user and serves only files inside the ETaske folder (size cap, hourly limit),
and `unshareAll()` closes the folder and every old file, resuming across runs.
Part B runs `src/lib/driveFiles.ts`, `DriveImage.tsx` and the real Documents
page in headless Edge with the script faked: previews load from a blob: once,
a PDF opens in a tab, a Word file is saved, a refusal falls back to the stored
link, and non-Drive links / ctrl-click are left to the browser.

```
node scripts/harness/drivefiles.mjs            # 44 assertions
node scripts/harness/drivefiles.mjs --headed   # watch part B
```
