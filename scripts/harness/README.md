# Harnesses

No test framework is installed in this repo and none is being added. These are
plain `node` scripts that bundle the **real** application modules with esbuild
(already present as a Vite dependency), stub only what needs a network or a
Firebase session, and assert on the actual behaviour. Each exits non-zero on
failure.

```bash
node scripts/harness/inboxconvert.mjs # ManagerInbox -> CreateTaskPanel, in a browser (78 assertions)
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

Notes for anyone extending it:

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
