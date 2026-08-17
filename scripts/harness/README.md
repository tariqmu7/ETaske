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
```

## Logic harnesses (Opportunities module)

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
