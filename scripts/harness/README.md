# Logic harnesses (Opportunities module)

No test framework is installed in this repo and none is being added. These are
plain `node` scripts that bundle the **real** `src/lib` modules with esbuild
(already present as a Vite dependency), stub only Firestore and the DOM, and
assert on the actual behaviour. Each exits non-zero on failure.

```bash
node scripts/harness/bidalerts.mjs   # src/lib/dueAlerts.ts  -> runBidDeadlineAlerts (35 assertions)
node scripts/harness/deeplink.mjs    # src/lib/deepLink.ts   -> notification -> URL -> record (20)
node scripts/harness/bidexport.mjs   # src/lib/exportData.ts -> exportOpportunities workbook (17)
```

They cover the parts of the bid-deadline feature that `tsc` cannot see: the
countdown buckets and their once-per-day dedupe, the separate daily budget, the
notification wording, the deep-link round trip, and the derived spreadsheet
columns (weighted value, gate slippage, orphaned child rows).

Notes for anyone extending them:

- `src/utils.ts` reads `import.meta.env` at module load, so the bundle needs
  `define: { 'import.meta.env': ... }` or it throws on import.
- Under `platform: 'neutral'` esbuild will not read `xlsx`'s `main` field —
  resolve it to `node_modules/xlsx/xlsx.mjs` explicitly (see `bidexport.mjs`).
- `bidexport.mjs` captures the workbook by stubbing `URL.createObjectURL`, then
  reads the bytes back with `xlsx` — the assertions run against a real parsed
  `.xlsx`, not against the in-memory objects.
