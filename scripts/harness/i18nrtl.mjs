// Harness for the Arabic locale + RTL foundation.
//
// Two halves, because the two risks are different:
//   [A] node — the locale tables and i18next config. The risk here is SILENT:
//       a missing key, or a key i18next never resolves, both fall back to the
//       English key text, so an untranslated Arabic UI looks like "we just
//       haven't translated that yet" instead of a bug.
//   [B] headless Edge — the REAL TopNav with the REAL src/index.css, switched
//       to Arabic by a REAL hit-tested click. The risk here is layout: a
//       physical `right: 0` that pins a dropdown off-screen in RTL is
//       invisible to tsc and to any assertion that only reads source.
//
// Real code under test: src/i18n.ts, src/locales/{en,ar}.ts,
//                       src/hooks/useLanguage.ts, src/components/Sidebar.tsx
//                       (TopNav), and the real src/index.css.
// Faked:                firebase/{app,auth,firestore}, src/lib/firebase.ts.
//
//   node scripts/harness/i18nrtl.mjs           (add --headed to watch it)

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
// Section [C] mounts the real dashboards, which need a Firestore that answers.
// Shared with inboxconvert.mjs so the two harnesses can't drift apart.
import { FIRESTORE_STUB } from './fakeFirestore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { build } = await import(pathToFileURL(path.join(ROOT, 'node_modules/esbuild/lib/main.js')).href);

const HEADED = process.argv.includes('--headed');
const SHOT = process.argv.includes('--shot');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'etaske-i18n-'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const AR_RANGE = /[\u0600-\u06FF]/;

// ═══ [A] The locale tables, in node ══════════════════════════════════════════
console.log('\n[A] locale tables + i18next config');

const OUT_A = path.join(WORK, 'i18n.bundle.mjs');
// platform:'node', NOT 'neutral' — under 'neutral' esbuild refuses to read a
// package's `main` field, and react-i18next pulls in CJS-only deps
// (html-parse-stringify). Same trap bidexport.mjs hit with `xlsx`.
await build({
  entryPoints: [path.join(ROOT, 'src/i18n.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT_A, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// i18n.ts stamps <html> at module load, so it needs both of these to exist.
const storeA = new Map();
globalThis.localStorage = {
  getItem: k => (storeA.has(k) ? storeA.get(k) : null),
  setItem: (k, v) => storeA.set(k, String(v)),
  removeItem: k => storeA.delete(k), clear: () => storeA.clear(),
};
// Vite's `import.meta.env`, which node does not have (see bundleOne).
globalThis.__VITE_ENV__ = {};
const htmlAttrs = {};
globalThis.document = { documentElement: { setAttribute: (k, v) => { htmlAttrs[k] = v; } } };

const i18nMod = await import(pathToFileURL(OUT_A).href);
const i18n = i18nMod.default;
const en = (await import(pathToFileURL(await bundleOne('src/locales/en.ts', 'en')).href)).default;
const ar = (await import(pathToFileURL(await bundleOne('src/locales/ar.ts', 'ar')).href)).default;

async function bundleOne(rel, name) {
  const out = path.join(WORK, `${name}.bundle.mjs`);
  // `import.meta.env` is Vite's, and node has no such thing — src/utils.ts
  // reads VITE_SHARE_UNC_ROOT off it at module load, so anything that reaches
  // utils (lib/format.ts does, for parseAmount) throws on import without this.
  await build({
    entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm', platform: 'node',
    outfile: out, logLevel: 'warning',
    define: { 'import.meta.env': 'globalThis.__VITE_ENV__', 'process.env.NODE_ENV': '"production"' },
  });
  return out;
}

const enKeys = Object.keys(en);
const arKeys = Object.keys(ar);
check(`en has ${enKeys.length} keys`, enKeys.length > 60, String(enKeys.length));
check('ar has exactly the same key set', enKeys.length === arKeys.length && enKeys.every(k => k in ar),
  `missing: ${enKeys.filter(k => !(k in ar)).join(', ')} | extra: ${arKeys.filter(k => !(k in en)).join(', ')}`);

// A value left as the English source is the failure mode this whole file exists
// to catch. "English" is the one legitimate Latin value (a language switcher
// must name each language in its own script).
const LATIN_OK = new Set(['English']);
const untranslated = enKeys.filter(k => !LATIN_OK.has(k) && !AR_RANGE.test(ar[k]));
check('every ar value is actually in Arabic script', untranslated.length === 0, untranslated.join(' | '));

const identical = enKeys.filter(k => !LATIN_OK.has(k) && ar[k] === en[k]);
check('no ar value is a copy of its en value', identical.length === 0, identical.join(' | '));

const emptyish = enKeys.filter(k => !ar[k] || !ar[k].trim());
check('no ar value is blank', emptyish.length === 0, emptyish.join(' | '));

// Trailing/leading spaces are load-bearing: those strings sit next to a sibling
// node (a required-field asterisk, a name). Dropping one glues words together.
const spaceMismatch = enKeys.filter(k =>
  /\s$/.test(en[k]) !== /\s$/.test(ar[k]) || /^\s/.test(en[k]) !== /^\s/.test(ar[k]));
check('trailing/leading space matches en', spaceMismatch.length === 0, spaceMismatch.map(k => JSON.stringify([en[k], ar[k]])).join(' | '));

// ★ Western digits, never Arabic-Indic. Task 6a settled this for the formatters
// (`ar-EG-u-nu-latn`), and a hand-typed ٧ in a locale string breaks the same
// rule from the other side: the KPI tile then reads "خلال ٧ أيام" beside a
// value of "2". Caught by LOOKING at i18nrtl-dash-opps.png, then pinned here.
const indicDigits = enKeys.filter(k => /[٠-٩۰-۹]/.test(ar[k]));
check('★ no ar value hand-types Arabic-Indic digits (the app is -u-nu-latn)',
  indicDigits.length === 0, indicDigits.map(k => `${k} → ${ar[k]}`).slice(0, 6).join(' | '));

// ★ The regression this guards. i18next's defaults read '.' as a nested path
// and ':' as a namespace. The keys ARE English sentences, so several contain
// both — those lookups missed entirely and only "looked right" because a miss
// echoes the key back, which was already English. Under ar, a miss is visible.
console.log('\n[A2] keys containing "." and ":" resolve (keySeparator/nsSeparator)');
await i18n.changeLanguage('ar');
const punctuated = enKeys.filter(k => k.includes('.') || k.includes(':'));
check(`${punctuated.length} punctuated keys exist to test`, punctuated.length >= 5, punctuated.join(' | '));
for (const k of punctuated) {
  check(`t(${JSON.stringify(k)}) resolves to Arabic`, i18n.t(k) === ar[k], `got ${JSON.stringify(i18n.t(k))}`);
}
check('a plain key still resolves', i18n.t('Tasks') === ar['Tasks'], i18n.t('Tasks'));
check('an unknown key falls back to itself', i18n.t('Not A Key') === 'Not A Key', i18n.t('Not A Key'));

await i18n.changeLanguage('en');
check('en still resolves after switching back', i18n.t('Tasks') === 'Tasks', i18n.t('Tasks'));
check('en resolves a punctuated key too', i18n.t('From:') === 'From: ', JSON.stringify(i18n.t('From:')));

console.log('\n[A3] language persistence + <html> stamp');
check('dirFor', i18nMod.dirFor('ar') === 'rtl' && i18nMod.dirFor('en') === 'ltr');
check('cold load with nothing stored -> en', htmlAttrs.lang === 'en' && htmlAttrs.dir === 'ltr', JSON.stringify(htmlAttrs));
i18nMod.applyLanguageToDocument('ar');
check('applyLanguageToDocument("ar") stamps lang+dir', htmlAttrs.lang === 'ar' && htmlAttrs.dir === 'rtl', JSON.stringify(htmlAttrs));
storeA.set(i18nMod.LANG_STORAGE_KEY, 'ar');
check('getStoredLanguage reads ar back', i18nMod.getStoredLanguage() === 'ar');
storeA.set(i18nMod.LANG_STORAGE_KEY, 'klingon');
check('a junk stored value falls back to en', i18nMod.getStoredLanguage() === 'en');
check('LANGUAGES lists both, each labelled in its own script',
  i18nMod.LANGUAGES.length === 2 && AR_RANGE.test(i18nMod.LANGUAGES.find(l => l.code === 'ar').label),
  JSON.stringify(i18nMod.LANGUAGES));

// ═══ [A4] No physical inline styles left in src/**.tsx ═══════════════════════
// The browser half below can only measure what it mounts. This half is the
// cheap, total one: a `marginLeft` added to a component nobody renders here
// still fails the run. It is also the only guard tasks 3–6 will have while they
// touch every remaining file.
console.log('\n[A4] inline styles are logical, not physical');

const PHYSICAL = /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\s*:|textAlign:\s*'(left|right)'|text-align:\s*(left|right)\b/g;
// `left:`/`right:` are NOT mechanical. These are the survivors, and each one is
// a deliberate decision, not an oversight:
//   a left:0 + right:0 PAIR (a full-bleed overlay/backdrop) is already
//   symmetric; `left: '50%'` under a translateX(-50%) is centred; ComboBox
//   positions its portal from a getBoundingClientRect(), which is a viewport
//   coordinate and must NOT be mirrored; LoginScreen's two blobs are decoration.
const INSET = /(^|[^A-Za-z.])(left|right)\s*:\s/g;
const INSET_ALLOW = {
  'src/App.tsx': 2,                                // bottom nav, left:0 + right:0
  'src/ArchiveDashboard.tsx': 2,                   // full-bleed row backdrop
  'src/components/Announcements.tsx': 1,           // left:0 with width:100%
  'src/components/ChatBox.tsx': 2,                 // left:0 + right:0 pair
  'src/components/ComboBox.tsx': 4,                // viewport coords from getBoundingClientRect
  'src/components/IdleResyncBanner.tsx': 1,        // left:50% + translateX(-50%)
  'src/CorrespondingsDashboard.tsx': 4,            // backdrop pair + modal scrim
  'src/LoginScreen.tsx': 2,                        // decorative blobs
  'src/OverviewDashboard.tsx': 4,                  // two modal scrims
  'src/TasksDashboard.tsx': 2,                     // full-bleed row backdrop
};

function walkTsx(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const tsxFiles = walkTsx(path.join(ROOT, 'src'));
check(`${tsxFiles.length} .tsx files scanned`, tsxFiles.length > 30, String(tsxFiles.length));

// ★★ The hole task 6c fell through: `PHYSICAL` only matches the LONGHAND
// (`paddingLeft`), so `padding: '10px 12px 10px 36px'` sailed past it — and that
// is precisely the shape every search box in the app used, pairing a logical
// `insetInlineStart` icon with a physical left pad. In RTL the icon crossed to
// the right and the text ran underneath it. Found by LOOKING at a screenshot,
// in FIVE files (Projects / Opportunities / Outlook / ChatBox ×2) plus an
// avatar chip in Announcements.
//
// A 4-value shorthand is the only asymmetric one: 1, 2 and 3 values all give
// the two horizontal sides the same length.
const SHORTHAND = /\b(padding|margin)\s*:\s*'([^']*)'/g;
const asym = (v) => {
  const parts = v.trim().split(/\s+/);
  return parts.length === 4 && parts[1] !== parts[3];
};

const physicalHits = [];
const shorthandHits = [];
const insetCounts = {};
for (const f of tsxFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(PHYSICAL)) {
    physicalHits.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
  }
  for (const m of text.matchAll(SHORTHAND)) {
    if (asym(m[2])) shorthandHits.push(`${rel}:${text.slice(0, m.index).split('\n').length} ${m[0].trim()}`);
  }
  const n = [...text.matchAll(INSET)].length;
  if (n) insetCounts[rel] = n;
}
check('★ no physical margin/padding/border/text-align left in any inline style',
  physicalHits.length === 0, physicalHits.slice(0, 8).join(' | '));
check('★★ no left/right-asymmetric padding/margin SHORTHAND (the longhand scan cannot see it)',
  shorthandHits.length === 0, shorthandHits.slice(0, 8).join(' | '));

const insetDrift = Object.keys({ ...insetCounts, ...INSET_ALLOW })
  .filter(k => (insetCounts[k] || 0) !== (INSET_ALLOW[k] || 0))
  .map(k => `${k}: ${insetCounts[k] || 0} (allowed ${INSET_ALLOW[k] || 0})`);
check('the surviving physical left:/right: are exactly the documented ones',
  insetDrift.length === 0, insetDrift.join(' | '));

// ═══ [A5] The shell/nav/auth files are actually wired to t() ═════════════════
// Task 3 translated these twelve files. The browser half below only mounts the
// header, so this is the cheap total guard: a file reverted to hard-coded
// English (or a new screen added without a translator) fails here. The counts
// are floors, not exact numbers — adding strings is fine, losing them is not.
console.log('\n[A5] shell / nav / auth files use the translator');

// Floors only count t('literal') — the table-driven screens (nav items,
// breadcrumb trail, shortcut rows) call t(variable) and score lower than they
// look. src/i18n.ts's LANGUAGES table is the switcher and is covered by [A3].
const SHELL_FILES = {
  'src/App.tsx': 3,
  'src/components/Sidebar.tsx': 25,
  'src/components/Breadcrumbs.tsx': 3,
  'src/HomeDashboard.tsx': 40,
  'src/components/CommandPalette.tsx': 38,
  'src/components/KeyboardHelp.tsx': 1,
  'src/components/DueSoonBanner.tsx': 4,
  'src/components/Announcements.tsx': 22,
  'src/LoginScreen.tsx': 12,
  'src/PendingScreen.tsx': 3,
  'src/RejectedScreen.tsx': 3,
  'src/UsernameSetupScreen.tsx': 7,
};
// Task 4 added the tasks flow. Same contract, same floors — listed separately
// only so a failure names which pass regressed.
const TASK_FILES = {
  'src/TasksDashboard.tsx': 100,
  'src/components/CreateTaskPanel.tsx': 40,
  'src/components/ComboBox.tsx': 6,
  'src/DueSoonDashboard.tsx': 7,
};
// Task 5 added the correspondence flow. `CorrespondenceInbox.tsx` is NOT here:
// it is a 27-line wrapper that renders CorrespondingsDashboard and contains no
// copy at all, so a floor on it would assert nothing.
const CORR_FILES = {
  'src/CorrespondingsDashboard.tsx': 110,
  'src/ManagerInbox.tsx': 30,
  'src/ArchiveDashboard.tsx': 20,
  'src/OutlookFeed.tsx': 34,
  'src/components/ChatBox.tsx': 25,
};
// Task 6b added the Opportunities module. `opportunityUi.ts` is NOT here: it
// holds colours and money/date arithmetic and no copy at all.
const OPP_FILES = {
  'src/OpportunitiesDashboard.tsx': 70,
  'src/OpportunityDetail.tsx': 24,
  'src/OpportunitiesAnalytics.tsx': 95,
  'src/components/opportunities/OpportunityFollowUpsTab.tsx': 20,
  'src/components/opportunities/OpportunityMilestonesTab.tsx': 34,
  'src/components/opportunities/OpportunityOutcomeTab.tsx': 45,
  // Cross-linking task 3: create-a-task-from-a-bid + the linked-task list.
  'src/components/opportunities/OpportunityTasksTab.tsx': 15,
};
// Task 6c added the Projects module. `ListControls` is the toolbar the four
// detail tabs share — its own chrome is translated here, while the filter and
// option labels arrive already translated from the tab that owns them.
const PROJ_FILES = {
  'src/ProjectsDashboard.tsx': 40,
  'src/ProjectDetail.tsx': 6,
  'src/components/projects/ListControls.tsx': 8,
  'src/components/projects/ProjectTrackingTab.tsx': 12,
  'src/components/projects/ProjectFinancialsTab.tsx': 33,
  'src/components/projects/ProjectContractsTab.tsx': 40,
  'src/components/projects/ProjectSubcontractsTab.tsx': 33,
};
// Task 6c-ii closed the queue: the manager Overview, the admin user-management
// screen, and the two screens no earlier pass had touched at all.
// `ErrorBoundary.tsx` is NOT here: it is a class component and cannot call the
// hook, so it imports the i18n instance and calls `i18n.t` — it is checked
// separately below.
const OV_FILES = {
  'src/OverviewDashboard.tsx': 70,
  'src/AdminDashboard.tsx': 35,
  'src/components/IdleResyncBanner.tsx': 2,
};
// Cross-linking queue: the three shared components the links live in. The
// picker (task 4) writes them, the block (task 6) paints the forward view on a
// task, the panel (task 6) paints the reverse view on a bid / project.
const LINK_FILES = {
  'src/components/RecordLinkPicker.tsx': 8,
  'src/components/LinkedRecordsBlock.tsx': 5,
  'src/components/LinkedRecordsPanel.tsx': 12,
};
const T_FILES = { ...SHELL_FILES, ...TASK_FILES, ...CORR_FILES, ...OPP_FILES, ...PROJ_FILES, ...OV_FILES, ...LINK_FILES };

for (const [rel, min] of Object.entries(T_FILES)) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const calls = [...src.matchAll(/\bt\(\s*['"`]/g)].length;
  check(`${rel}: useTranslation + ≥${min} t() calls`,
    /useTranslation/.test(src) && calls >= min, `${calls} t() calls`);
}

// Every literal passed to t() in those files must exist in en.ts, or it renders
// the key text in English under ar and looks merely "not translated yet".
// Both quote styles: a key containing an apostrophe ("You're all caught up.")
// is written with double quotes, and the single-quote-only regex missed it.
const missingKeys = [];
for (const rel of Object.keys(T_FILES)) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'");
    if (!(key in en)) missingKeys.push(`${rel}: ${key}`);
  }
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = m[1].replace(/\\"/g, '"');
    if (!(key in en)) missingKeys.push(`${rel}: ${key}`);
  }
}
check('★ every t(\'…\') literal in the translated files is a real key in en.ts',
  missingKeys.length === 0, missingKeys.slice(0, 8).join(' | '));

// The error screen is the one place a hook is impossible — a class component
// catches the render throw. It calls the i18n instance directly, and its three
// keys must still resolve.
{
  const eb = fs.readFileSync(path.join(ROOT, 'src/ErrorBoundary.tsx'), 'utf8');
  const ebKeys = [...eb.matchAll(/i18n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  check('ErrorBoundary (a class component) translates through the i18n instance',
    /from '\.\/i18n'/.test(eb) && ebKeys.length >= 3, `${ebKeys.length} i18n.t() calls`);
  check('ErrorBoundary\'s keys are real keys in en.ts',
    ebKeys.every(k => k in en), ebKeys.filter(k => !(k in en)).join(' | '));
}

// ★ The sweep that closes the queue: no .tsx in src/ paints UI copy without a
// translator. A file with NO copy at all (a wrapper, a pure-logic module) is
// allowed; a file that renders English words is not.
const NO_COPY_OK = new Set([
  'src/main.tsx',              // the bootstrap, renders no text
  'src/components/GroupGrid.tsx', // every card string arrives already translated
  'src/CorrespondenceInbox.tsx', // a 27-line deep-link wrapper
  'src/FollowUpDashboard.tsx',   // the dead stub (superseded by Correspondings)
  'src/ErrorBoundary.tsx',       // checked above — i18n.t, not the hook
]);
const noTranslator = [];
for (const f of fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })) {
  const rel = `src/${String(f).replace(/\\/g, '/')}`;
  if (!rel.endsWith('.tsx') || NO_COPY_OK.has(rel)) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (!/useTranslation/.test(src)) noTranslator.push(rel);
}
check('★ every .tsx that renders copy is wired to a translator (final sweep)',
  noTranslator.length === 0, noTranslator.join(' | '));

// ── [A6] the tasks flow keeps no hard-coded English left in its JSX ──────────
// A floor can be met while a whole panel is still English. These are the exact
// strings task 4 replaced; any one of them reappearing as a bare JSX literal
// (not inside a t(...) call) is a revert.
console.log('\n[A6] no reverted literals in the tasks flow');
const REVERT_CANARIES = [
  ['src/TasksDashboard.tsx', [
    /\/>\s*Add Task\s*<\/button>/,
    /placeholder="Search tasks/,
    /\? 'My Tasks' : 'All Tasks'/,
    /^\s*Milestones\s*$/m,
    /\/>\s*Add Path\s*$/m,
    /^\s*Save Changes\s*$/m,
  ]],
  ['src/components/CreateTaskPanel.tsx', [
    /\/>\s*Create Task\s*$/m,
    /placeholder="What needs to be done/,
    /^\s*Advanced\s*$/m,
    /label: 'Public'/,
  ]],
  ['src/DueSoonDashboard.tsx', [
    />Due Soon & Overdue</,
    />Nothing due soon</,
    /^\s*Due: \{fmt/m,
  ]],
  // ── task 5 ──
  ['src/CorrespondingsDashboard.tsx', [
    /placeholder="Search subject or sender/,
    /\/>\s*New Correspondence\s*$/m,
    /^\s*Team Workload\s*$/m,
    /^\s*Previous\s*$/m,
    /\|\| 'Correspondence Details'/,
    /<\/strong>" will be permanently deleted/,
  ]],
  ['src/ManagerInbox.tsx', [
    /^\s*Review incoming correspondences/m,
    /<option value="All">All<\/option>/,
    /^\s*All caught up!\s*$/m,
    />Manager Note \(optional\)</,
    /headerTitle="Assign as Task"/,
  ]],
  ['src/ArchiveDashboard.tsx', [
    /^\s*Archive is empty\s*$/m,
    /placeholder="Search archived tasks/,
    /^\s*Task Details\s*$/m,
    />Milestone History</,
  ]],
  ['src/OutlookFeed.tsx', [
    />Outlook Feed</,
    /^\s*Refresh\s*$/m,
    /^\s*Loading emails…\s*$/m,
    /headerTitle="Create Task from Email"/,
  ]],
  ['src/components/ChatBox.tsx', [
    /placeholder="Type a message/,
    /placeholder="Search users/,
    /^\s*Nothing to show\s*$/m,
    /label: 'Offline'/,
  ]],
  // ── task 6b ──
  ['src/OpportunitiesDashboard.tsx', [
    /placeholder="Search opportunities/,
    /\/>\s*New Opportunity\s*$/m,
    /<option value="All">All stages<\/option>/,
    />Delete opportunity\?</,
    /label="Estimated value"/,
  ]],
  // ── cross-linking task 6 ──
  ['src/components/LinkedRecordsBlock.tsx', [
    />Linked Records</,
    /title="Project record"/,
  ]],
  ['src/components/LinkedRecordsPanel.tsx', [
    />Linked Records</,
    />Loading linked records…</,
    /^\s*Loading linked records…\s*$/m,
  ]],
  ['src/OpportunityDetail.tsx', [
    /\/>\s*All opportunities\s*$/m,
    /<SectionTitle>Bid record<\/SectionTitle>/,
    /label="Submission deadline"/,
  ]],
  ['src/components/opportunities/OpportunityFollowUpsTab.tsx', [
    /placeholder="What happened/,
    /^\s*Latest follow-up\s*$/m,
    /^\s*Post follow-up\s*$/m,
  ]],
  ['src/components/opportunities/OpportunityMilestonesTab.tsx', [
    /^\s*Bid gates\s*$/m,
    /placeholder="e\.g\. Technical clarification/,
    /\/>\s*Add gate\s*$/m,
    /\?\s*'Add the standard bid gates'/,
  ]],
  ['src/components/opportunities/OpportunityOutcomeTab.tsx', [
    /Outcome &amp; feedback/,
    /placeholder="Debrief notes/,
    /<SectionTitle>Reasons<\/SectionTitle>/,
  ]],
  ['src/OpportunitiesAnalytics.tsx', [
    /title="Open pipeline by stage"/,
    /title="Why we lose"/,
    /<th>Decided<\/th>/,
    /<Empty text="/,
  ]],
  // ── task 6c ──
  ['src/ProjectsDashboard.tsx', [
    /placeholder="Search projects/,
    /\/>\s*New Project\s*$/m,
    /<option value="All">All statuses<\/option>/,
    />Delete project\?</,
    /label="Project name \*"/,
    /label: 'Total'/,
  ]],
  ['src/ProjectDetail.tsx', [
    /\/>\s*All projects\s*$/m,
    /label: 'Tracking'/,
    /label: 'Subcontracts'/,
  ]],
  ['src/components/projects/ListControls.tsx', [
    /<span className="lc-label">Sort by<\/span>/,
    /title="Reset filters"/,
    /\? 'Ascending' : 'Descending'/,
  ]],
  ['src/components/projects/ProjectTrackingTab.tsx', [
    /placeholder="Post a status update/,
    /^\s*Current Status\s*$/m,
    /'Posting…' : 'Post update'/,
  ]],
  ['src/components/projects/ProjectFinancialsTab.tsx', [
    /^\s*Financial Records\s*$/m,
    /label="Linked contract"/,
    /<option value="">— None —<\/option>/,
    /'Edit record' : 'Add record'/,
  ]],
  ['src/components/projects/ProjectContractsTab.tsx', [
    /label="Contract value"/,
    /label="Contracting method"/,
    />Enter at least a contract #, subject or company to save\.</,
    /'Edit item' :/,
  ]],
  ['src/components/projects/ProjectSubcontractsTab.tsx', [
    /label="Subcontractor \/ supplier \*"/,
    /placeholder="e\.g\. 50% Completion/,
    /label: 'Expiring soon'/,
    /\{expirySummary\.expired\} expired/,
  ]],
];
for (const [rel, patterns] of REVERT_CANARIES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hit = patterns.filter(p => p.test(src)).map(String);
  check(`${rel}: no bare English literal came back`, hit.length === 0, hit.join(' | '));
}

// ═══ [A7] every enum VALUE in types.ts has a display label ═══════════════════
// Task 6's whole mechanism is `t(storedEnglishValue)`. That call is invisible to
// [A5] (it passes a variable, not a literal), and a miss is SILENT: i18next
// echoes the key back, which is the English word, so a stage nobody translated
// renders exactly like one that is merely "not translated yet". This is the
// guard that makes the set provably complete — it reads the option lists out of
// `src/types.ts` itself, so ADDING a stage/status/reason and forgetting the
// locale fails the run instead of shipping an English badge.
console.log('\n[A7] every enum value in types.ts has an Arabic display label');

const typesSrc = fs.readFileSync(path.join(ROOT, 'src/types.ts'), 'utf8');

// Deliberately NOT display-labelled, with the reason. Anything else that turns
// up in types.ts must be translated.
const NOT_LABELLED = {
  CURRENCY_OPTIONS: 'ISO currency codes — EGP/USD are the same token in Arabic',
  PROJECT_OPTIONS: 'client company names (AMOC, AGIBA…) — proper nouns',
  NotificationType: 'machine values written to Firestore, never painted',
  ProjectContractType: 'machine values; the human text is the `label` field, which IS covered',
  OperationType: 'internal error-reporting enum, never painted',
  UserRole: 'covered via its own values below',
};

const enumValues = new Map(); // name -> string[]

// `export type X = 'a' | 'b' | 'c';` (possibly wrapped over several lines)
for (const m of typesSrc.matchAll(/export type (\w+)\s*=\s*((?:\s*\|?\s*'[^']*')+)\s*;/g)) {
  const vals = [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]);
  if (vals.length > 1) enumValues.set(m[1], vals);
}
// `export const X_OPTIONS: T[] = [ 'a', 'b' ];`
for (const m of typesSrc.matchAll(/export const (\w+OPTIONS)[^=]*=\s*\[([^\]]*)\]/g)) {
  enumValues.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]));
}
// `export const X_OPTIONS: {value;label}[] = [{ value: 'a', label: 'A' }, …]`
// — only the labels are painted.
for (const m of typesSrc.matchAll(/export const (\w+OPTIONS)[^=]*=\s*\[(\s*\{[\s\S]*?)\];/g)) {
  const labels = [...m[2].matchAll(/label:\s*'([^']*)'/g)].map(x => x[1]);
  if (labels.length) enumValues.set(m[1], labels);
}

check(`found ${enumValues.size} option lists in types.ts`, enumValues.size >= 12,
  [...enumValues.keys()].join(', '));

const unlabelled = [];
for (const [name, vals] of enumValues) {
  if (name in NOT_LABELLED) continue;
  for (const v of vals) {
    if (!(v in en)) unlabelled.push(`${name}.${v}: no key`);
    else if (!AR_RANGE.test(ar[v])) unlabelled.push(`${name}.${v}: ar not Arabic`);
  }
}
check('★ every painted enum value has an Arabic label', unlabelled.length === 0,
  unlabelled.slice(0, 10).join(' | '));

// The skip list must stay honest: a name listed there has to still exist.
const staleSkips = Object.keys(NOT_LABELLED).filter(n => !enumValues.has(n) && !typesSrc.includes(n));
check('the [A7] skip list names no enum that has been deleted', staleSkips.length === 0, staleSkips.join(' | '));

// ═══ [A8] the display-label + Intl layer itself ══════════════════════════════
// [A7] proves the WORDS exist. This proves the two modules that use them behave
// — they are pure functions, so they can be exercised in node with no browser.
console.log('\n[A8] lib/displayLabel + lib/format');

const fmtMod = await import(pathToFileURL(await bundleOne('src/lib/format.ts', 'format')).href);
const dlMod = await import(pathToFileURL(await bundleOne('src/lib/displayLabel.ts', 'displayLabel')).href);

await i18n.changeLanguage('ar');
const tAr = i18n.t.bind(i18n);
check('displayLabel paints a stored value in Arabic', dlMod.displayLabel(tAr, 'In Progress') === ar['In Progress'],
  dlMod.displayLabel(tAr, 'In Progress'));
// ★ Free text must survive untouched — `category`, `department` and `sector`
// accept whatever the user typed, and blowing up (or blanking) on those would
// be far worse than leaving one word English.
check('★ displayLabel passes unknown free text through unchanged',
  dlMod.displayLabel(tAr, 'Turnaround Planning Unit') === 'Turnaround Planning Unit');
check('displayLabel is empty-in / empty-out',
  dlMod.displayLabel(tAr, '') === '' && dlMod.displayLabel(tAr, null) === '' && dlMod.displayLabel(tAr, undefined) === '');

// ★ Arabic formats through ar-EG-u-nu-latn: Arabic month NAMES, Western digits.
// Arabic-Indic digits (٢٠٢٦) would be wrong for a dashboard read next to
// English contracts, and would also break every `.ltr-data` span.
const SAMPLE = new Date(2026, 7, 15, 14, 30); // 15 Aug 2026, 14:30 local
check('a numeric date is identical in both languages (it has no words in it)',
  fmtMod.fmtDate(SAMPLE, 'ar') === fmtMod.fmtDate(SAMPLE, 'en') && fmtMod.fmtDate(SAMPLE, 'en') === '15/08/2026',
  `${fmtMod.fmtDate(SAMPLE, 'en')} / ${fmtMod.fmtDate(SAMPLE, 'ar')}`);
const namedAr = fmtMod.fmtDate(SAMPLE, 'ar', fmtMod.DATE_MEDIUM);
check('★ a named-month date is Arabic under ar', AR_RANGE.test(namedAr), namedAr);
check('★ …and still uses Western digits, not Arabic-Indic', /15/.test(namedAr) && /2026/.test(namedAr), namedAr);
check('the same date is English under en', /Aug/.test(fmtMod.fmtDate(SAMPLE, 'en', fmtMod.DATE_MEDIUM)),
  fmtMod.fmtDate(SAMPLE, 'en', fmtMod.DATE_MEDIUM));
check('the time is 24h and Latin in both', fmtMod.fmtTime(SAMPLE, 'ar') === '14:30' && fmtMod.fmtTime(SAMPLE, 'en') === '14:30',
  `${fmtMod.fmtTime(SAMPLE, 'en')} / ${fmtMod.fmtTime(SAMPLE, 'ar')}`);
check('an empty/invalid date formats to empty, never "Invalid Date"',
  fmtMod.fmtDate(null, 'ar') === '' && fmtMod.fmtDate('not a date', 'ar') === '' && fmtMod.fmtDate(undefined, 'en') === '');
check('a Firestore-shaped Timestamp is accepted',
  fmtMod.fmtDate({ toDate: () => SAMPLE }, 'en') === '15/08/2026');

check('money keeps the currency CODE and groups the number',
  fmtMod.fmtMoney(1250000, 'EGP', 'ar') === '1,250,000 EGP', fmtMod.fmtMoney(1250000, 'EGP', 'ar'));
check('★ a non-numeric money value is returned untouched ("TBD" must not become NaN)',
  fmtMod.fmtMoney('TBD', 'EGP', 'ar') === 'TBD', fmtMod.fmtMoney('TBD', 'EGP', 'ar'));

check('the relative clock is Arabic under ar',
  fmtMod.fmtAgo(Date.now() - 3 * 3600_000, 'ar', tAr) === tAr('{{count}}h ago', { count: 3 }),
  fmtMod.fmtAgo(Date.now() - 3 * 3600_000, 'ar', tAr));
// Past 7 days it stops counting and shows the date — which under ar means an
// Arabic month name, so this also proves the two halves of the file join up.
const OLD = Date.now() - 30 * 86_400_000;
check('…and falls back to a named-month date past 7 days',
  fmtMod.fmtAgo(OLD, 'ar', tAr) === fmtMod.fmtDate(OLD, 'ar', fmtMod.DATE_SHORT) && AR_RANGE.test(fmtMod.fmtAgo(OLD, 'ar', tAr)),
  fmtMod.fmtAgo(OLD, 'ar', tAr));
check('a future timestamp reads "just now", never a negative count',
  fmtMod.fmtAgo(Date.now() + 60_000, 'ar', tAr) === tAr('just now'));

// ★ The bidi class has to be chosen from the TEXT, not assumed. `.ltr-data`
// forces a left-to-right run — correct for "15/08/2026" and "Other...", wrong
// for "أخرى...", which it would drag out of the paragraph's direction.
check('★ bidiClassFor: Latin text keeps .ltr-data', fmtMod.bidiClassFor('Other...') === 'ltr-data');
check('★ bidiClassFor: Arabic text gets .bidi-isolate (never forced LTR)',
  fmtMod.bidiClassFor('أخرى...') === 'bidi-isolate');
check('bidiClassFor: empty text is treated as Latin', fmtMod.bidiClassFor('') === 'ltr-data' && fmtMod.bidiClassFor(null) === 'ltr-data');
check('.bidi-isolate exists in index.css', /^\.bidi-isolate\s*\{/m.test(fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')));
await i18n.changeLanguage('en');

// ── revert canaries for the task-6a pass ────────────────────────────────────
// A raw `{item.status}` reads perfectly in English, so nothing but this notices
// when one comes back.
const T6_CANARIES = [
  ['src/TasksDashboard.tsx', [
    /\{task\.status\}<\/span>/,
    /\{task\.priority\}<\/span>/,
    /toLocaleDateString/,
  ]],
  ['src/CorrespondingsDashboard.tsx', [
    /\{item\.status\}<\/span>/,
    /\{formData\.priority\}<\/span>/,
    /\{item\.category\}<\/span>/,
    /toLocaleDateString/,
  ]],
  ['src/ManagerInbox.tsx', [/^\s*\{corr\.status\}\s*$/m, /^\s*\{selectedCorr\.priority\}\s*$/m, /toLocaleDateString/]],
  ['src/ArchiveDashboard.tsx', [/\{ms\.status\}<\/span>/, /toLocaleDateString/]],
  ['src/components/Sidebar.tsx', [/^\s*\{appUser\.role\}\s*$/m, /toLocaleString\('en-GB'/]],
  ['src/components/ChatBox.tsx', [/\{u\.role\} ·/, /toLocaleTimeString/]],
  ['src/components/Announcements.tsx', [/timeAgo\(/]],
  ['src/DueSoonDashboard.tsx', [/toLocaleString\('en-GB'/]],
  ['src/OutlookFeed.tsx', [/toLocaleString\(\)/]],
  // ── task 6b: the Opportunities module's own raw-enum / raw-date shapes ──
  ['src/OpportunitiesDashboard.tsx', [/\{o\.stage\}\s*$/m, /\{s\}<\/option>/, /toLocaleDateString/]],
  ['src/OpportunityDetail.tsx', [/^\s*\{o\.stage\}\s*$/m, /value=\{o\.submissionDeadline\}/, /toLocaleDateString/]],
  ['src/components/opportunities/OpportunityFollowUpsTab.tsx', [/\{f\.stage\}<\/span>/, /toLocaleString\('en-GB'/]],
  ['src/components/opportunities/OpportunityMilestonesTab.tsx', [/\{s\}<\/option>/, /\{m\.title\}\s*$/m]],
  ['src/components/opportunities/OpportunityOutcomeTab.tsx', [/\{record\.outcome\}\s*$/m, /toLocaleString\('en-GB'/]],
  ['src/components/opportunities/OpportunityTasksTab.tsx', [/\{task\.status\}</, /toLocaleDateString/]],
  ['src/OpportunitiesAnalytics.tsx', [/\{o\.stage\}<\/span>/, /\{s\.stage\}<\/span>/, /toLocaleTimeString/, /toLocaleDateString\('en-GB'/]],
  // ── task 6c: the Projects module's own raw-enum / raw-date / raw-money shapes.
  // `formatMoney`/`toLocaleString('en-US')` are the un-localized twins of
  // `fmt.money`/`fmt.number` — correct before this pass, a regression after it.
  ['src/ProjectsDashboard.tsx', [/\{p\.status\}<\/span>/, /\{s\}<\/option>/, /toLocaleDateString/]],
  ['src/ProjectDetail.tsx', [/^\s*\{project\.status\}\s*$/m, /toLocaleDateString/]],
  ['src/components/projects/ProjectTrackingTab.tsx', [
    /\{u\.status\}<\/span>/, /\{s\}<\/option>/, /toLocaleString\('en-GB'/,
    /\{project\.currentStatus \|\| project\.status\}/,
  ]],
  ['src/components/projects/ProjectFinancialsTab.tsx', [
    /\{r\.type\}<\/span>/, /\{r\.status \|\| '—'\}/, /formatMoney\(/, /toLocaleString\('en-US'/,
  ]],
  ['src/components/projects/ProjectContractsTab.tsx', [
    /\{item\.status\}<\/span>/, /\{typeLabel\(item\.type\)\}</, /formatMoney\(/, /toLocaleString\('en-US'/,
  ]],
  ['src/components/projects/ProjectSubcontractsTab.tsx', [
    /\{s\.currentStatus \|\| s\.status\}<\/span>/, /formatMoney\(/, /text: 'Expired'/,
  ]],
  // ── task 6c-ii: Overview + Admin. `const t = (s: string) => s;` is the shape
  // that mattered most here — Overview shipped an IDENTITY translator, so ~20
  // strings looked wired and rendered English forever. Its return is a revert.
  ['src/OverviewDashboard.tsx', [
    /const t = \(s: string\) => s;/,
    /\{item\.status\}\s*$/m, /\{task\.status\}<\/span>/, /\{ms\.status\}<\/span>/,
    /\{selectedCorr\.category\}\s*$/m, /\} Priority/, /toLocaleDateString\('en-GB'\)/,
  ]],
  ['src/AdminDashboard.tsx', [/\{u\.status\}\s*$/m, /<Shield className="w-3 h-3" \/> \{u\.role\}/]],
];
for (const [rel, patterns] of T6_CANARIES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const hit = patterns.filter(p => p.test(src)).map(String);
  check(`${rel}: no raw enum / un-localized date came back`, hit.length === 0, hit.join(' | '));
}

// Every screen task 6a touched must actually hold the layer.
const LAYER_FILES = [
  'src/TasksDashboard.tsx', 'src/components/CreateTaskPanel.tsx', 'src/CorrespondingsDashboard.tsx',
  'src/ManagerInbox.tsx', 'src/ArchiveDashboard.tsx', 'src/components/ChatBox.tsx',
  'src/components/Sidebar.tsx',
  // ── task 6b ──
  'src/OpportunitiesDashboard.tsx', 'src/OpportunityDetail.tsx', 'src/OpportunitiesAnalytics.tsx',
  'src/components/opportunities/OpportunityFollowUpsTab.tsx',
  'src/components/opportunities/OpportunityMilestonesTab.tsx',
  'src/components/opportunities/OpportunityOutcomeTab.tsx',
  'src/components/opportunities/OpportunityTasksTab.tsx',
  // ── task 6c. ListControls is NOT here: it paints only labels its caller has
  // already resolved, so it holds no stored value of its own.
  'src/ProjectsDashboard.tsx', 'src/ProjectDetail.tsx',
  'src/components/projects/ProjectTrackingTab.tsx',
  'src/components/projects/ProjectFinancialsTab.tsx',
  'src/components/projects/ProjectContractsTab.tsx',
  'src/components/projects/ProjectSubcontractsTab.tsx',
  // ── task 6c-ii ──
  'src/OverviewDashboard.tsx', 'src/AdminDashboard.tsx',
  // ── cross-linking task 6: the reverse panel paints a stored task /
  // correspondence status on someone else's page.
  'src/components/LinkedRecordsPanel.tsx',
];
for (const rel of LAYER_FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check(`${rel}: wired to useDisplayLabel`, /useDisplayLabel/.test(src));
}

// ═══ [B] The real TopNav in a real browser ═══════════════════════════════════
console.log('\n[B] real TopNav, real index.css, real clicks');

const FIREBASE_STUB = `export const db = {}; export const auth = {}; export const app = {}; export default {};`;
const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/(firestore|auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firebase' ? FIREBASE_STUB
        : `export const doc = () => ({}); export const updateDoc = async () => {}; export const getDoc = async () => ({ exists: () => false });
           export const onSnapshot = () => () => {}; export const collection = () => ({}); export const query = () => ({});
           export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
           export const addDoc = async () => ({ id: 'stub' }); export const setDoc = async () => {};
           export const deleteDoc = async () => {}; export const deleteField = () => ({ __delete: true });
           export const serverTimestamp = () => ({ __serverTimestamp: true }); export const Timestamp = { now: () => ({ seconds: 0 }) };
           export const runTransaction = async (_d, fn) => fn({ get: async () => ({ exists: () => false }), set: () => {}, update: () => {} });
           export const getDocs = async () => ({ docs: [] }); export const writeBatch = () => ({ set: () => {}, update: () => {}, commit: async () => {} });
           export const arrayUnion = (...a) => a; export const arrayRemove = (...a) => a; export const increment = n => n;
           export const getMessaging = () => ({}); export const getToken = async () => null; export const onMessage = () => () => {};
           export const signOut = async () => {}; export const onAuthStateChanged = () => () => {};`,
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/i18n';
import TopNav from './src/components/Sidebar';

const appUser = {
  id: 'u-mgr', displayName: 'Tariq Salama', email: 'tarekmoh123@gmail.com', photoURL: '',
  status: 'Approved', role: 'Manager', teamId: 'T1', department: 'Maintenance Planning',
  userColor: '#2563eb',
};
const notifications = [
  { id: 'n1', userId: 'u-mgr', type: 'task_assigned', title: 'New task assigned', body: 'Pump P-101 vibration report', read: false, createdAt: { seconds: 1755100000, toDate: () => new Date(1755100000000) } },
  { id: 'n2', userId: 'u-mgr', type: 'opportunity_deadline', title: 'Bid deadline in 3 days', body: 'EGPC turnaround tender', read: true, createdAt: { seconds: 1755000000, toDate: () => new Date(1755000000000) } },
];
const navCounts = { corrNeedsReview: 3, corrUnread: 2, myActiveTasks: 7, openBids: 4, bidsDueSoon: 1 };
const pwa = { canInstall: false, isInstalled: false, install: () => {}, permission: 'default', requestPush: async () => {}, pushEnabled: false, disablePush: async () => {} };

function Harness() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);
  window.__setDark = setDark;
  // activeView is real state (UX task 2): a group button only reads "active"
  // once one of its children is the current view, so a fixed prop would make
  // every active-state assertion vacuous.
  const [view, setView] = React.useState('tasks');
  return React.createElement(TopNav, {
    appUser, activeView: view, onNavigate: v => { window.__navigated = v; setView(v); },
    notifications, dueSoonCount: 2, announcementCount: 1, navCounts,
    onOpenPalette: () => {}, onLogout: () => { window.__loggedOut = true; },
    pwa, isDark: dark, onToggleTheme: () => setDark(d => !d),
  });
}

createRoot(document.getElementById('root')).render(React.createElement(Harness));
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'i18nEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'bundle.js'),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '__VITE_ENV__',
  },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'x' };` },
  plugins: [stubPlugin],
  logLevel: 'warning',
});

// The real stylesheet. The @import webfonts are dropped (they would hang in
// headless) — which also means this run proves LAYOUT, not glyph coverage.
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
  .replace(/@import url\([^)]*\);/g, '')
  .replace(/@tailwind [a-z]+;/g, '');
fs.writeFileSync(path.join(WORK, 'app.css'), css);
fs.writeFileSync(path.join(WORK, 'index.html'),
  `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="bundle.js"></script></body></html>`);

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!EDGE) { console.error('Microsoft Edge not found.'); process.exit(2); }

const PORT = 9511 + (process.pid % 100);
const edge = spawn(EDGE, [
  HEADED ? '--new-window' : '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(WORK, 'profile')}`,
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000',
  pathToFileURL(path.join(WORK, 'index.html')).href,
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function firstPage() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await sleep(150);
  }
  throw new Error('Edge did not expose a page target');
}
const page = await firstPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    pageErrors.push(d.exception?.description || d.text);
  }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Page.enable');

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}
async function waitFor(expr, label, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evalJS(`!!(${expr})`)) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${label || expr}`);
}

const HELPERS = `
window.__vis = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
window.__byText = (sel, text, root) => [...(root || document).querySelectorAll(sel)]
  .filter(e => window.__vis(e) && (e.textContent || '').replace(/\\s+/g, ' ').trim().includes(text));
window.__one = (sel, text) => { const m = window.__byText(sel, text); return m.length ? m[0] : null; };
window.__box = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; };
`;
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'TopNav mount');
await evalJS(HELPERS);

// Grouping is a GRID of group cards now (see components/GroupGrid.tsx): picking
// a dimension shows one card per bucket and the RECORD ROWS only exist after a
// card is opened. Every row-level check below therefore has to drill in first.
// A board with nothing to group renders no cards, so this is a no-op then.
// Not tasks-only: `button[data-group-card]` is GroupGrid's own markup, so this drills into
// the correspondences board the same way.
async function openFirstGroupCard() {
  const has = await evalJS(`!!document.querySelector('#root button[data-group-card]')`);
  if (!has) return false;
  await clickEl(`document.querySelector('#root button[data-group-card]')`, 'first group card');
  await sleep(400);
  return true;
}

async function clickEl(finderJS, label) {
  const info = await evalJS(`(() => {
    ${HELPERS}
    const el = ${finderJS};
    if (!el) return { err: 'not found' };
    el.scrollIntoView({ block: 'center' });
    const b = window.__box(el);
    if (b.w === 0 || b.h === 0) return { err: 'zero-size' };
    const hit = document.elementFromPoint(b.x, b.y);
    return { x: b.x, y: b.y, covered: !(el === hit || el.contains(hit) || (hit && hit.contains(el))),
             hitTag: hit ? hit.tagName + '.' + hit.className : null };
  })()`);
  if (info.err) throw new Error(`click ${label}: ${info.err}`);
  if (info.covered) throw new Error(`click ${label}: something else is on top (${info.hitTag})`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  }
  await sleep(180);
}

// Task 4 of the UX-simplification queue (2026-08-26): every board's filter
// selects now live behind a `Filters` disclosure in the shared BoardToolbar,
// so they are NOT in the DOM until it is opened. Any assertion that reads a
// filter <option> — or drives a sort <select> — has to open it first. Guarded
// on aria-expanded, because a second click would close it again.
async function openBoardFilters() {
  const opened = await evalJS(`(() => {
    const btn = [...document.querySelectorAll('#root button[aria-expanded]')]
      .find(b => /Filters|عوامل التصفية/.test(b.textContent || ''));
    if (!btn) return 'no-button';
    if (btn.getAttribute('aria-expanded') === 'true') return 'already-open';
    btn.click();
    return 'opened';
  })()`);
  await sleep(220);
  return opened;
}

async function shot(name) {
  if (!SHOT) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(ROOT, `scripts/harness/i18nrtl-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log(`       shot -> ${p}`);
}

// A word whose own text is split across more than one line box, or an element
// whose content is cut off by its own border box. Both are how an RTL layout
// bug actually shows up on screen.
const SCAN = `
window.__clipped = () => {
  const out = [];
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const over = el.scrollWidth - el.clientWidth;
    // Only hidden/clip actually cuts content off. 'visible' still draws it — a
    // notification badge is SUPPOSED to hang outside its button — and
    // auto/scroll leaves the user a way to reach it.
    // text-overflow:ellipsis is a DELIBERATE one-line truncation (the
    // correspondence subject, a long assignee name) and is direction-neutral —
    // it renders identically in LTR. Flagging it turns the scan into noise.
    const ellipsised = cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap';
    if (over > 0 && !ellipsised && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.clientWidth > 0) {
      out.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), over, text: (el.textContent || '').trim().slice(0, 30) });
    }
    for (const c of el.children) walk(c);
  };
  walk(document.body);
  return out;
};
// An element sitting outside the viewport is only a DEFECT if the user has no
// way to reach it. Inside a horizontally scrollable strip (the category chips,
// a wide table) it is normal — and in RTL such a strip starts scrolled to the
// far right, so its children legitimately have negative left coordinates. The
// scrollable ancestor is reported, and the caller decides.
window.__scrollParent = el => {
  let p = el.parentElement;
  while (p && p !== document.documentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === 'auto' || ox === 'scroll') return (String(p.className) || p.tagName).slice(0, 40);
    p = p.parentElement;
  }
  return null;
};
window.__offscreen = root => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left < -1 || r.right > vw + 1) {
      bad.push({ cls: String(el.className).slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), vw,
                 scrollable: window.__scrollParent(el) });
    }
  }
  return bad;
};
window.__unreachable = root => window.__offscreen(root).filter(b => !b.scrollable);
window.__docOverflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
`;
await evalJS(SCAN);

console.log('\n[B1] the switcher itself');
check('page renders with no thrown errors', pageErrors.length === 0, pageErrors.join(' || ').slice(0, 300));
check('starts in en/ltr', await evalJS(`document.documentElement.getAttribute('dir')`) === 'ltr');

await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'avatar');
check('avatar opens the user menu',
  await evalJS(`!!window.__one('div','tarekmoh123@gmail.com')`));
check('the menu shows a Language section', await evalJS(`!!window.__one('div','Language')`));
await shot('menu-en');

// ★ The reason the menu is checked for containment: it is positioned with
// inset-inline-end, and a physical `right: 0` would hang it off the left edge
// in RTL — a defect no type-check and no source-reading assertion can see.
const menuOffLtr = await evalJS(`(() => {
  const b = window.__one('button','العربية'); if (!b) return 'no ar button';
  let m = b; while (m && getComputedStyle(m).position !== 'absolute') m = m.parentElement;
  return JSON.stringify(window.__offscreen(m || b));
})()`);
check('user menu sits inside the viewport in LTR', menuOffLtr === '[]', menuOffLtr);

check('both languages are offered', await evalJS(`!!window.__one('button','English') && !!window.__one('button','العربية')`));
check('English is the pressed option',
  await evalJS(`window.__one('button','English').getAttribute('aria-pressed')`) === 'true');

console.log('\n[B2] switching to Arabic');
await clickEl(`window.__one('button','العربية')`, 'Arabic');
check('<html dir> flips to rtl', await evalJS(`document.documentElement.getAttribute('dir')`) === 'rtl');
check('<html lang> flips to ar', await evalJS(`document.documentElement.getAttribute('lang')`) === 'ar');
check('the choice is persisted', await evalJS(`localStorage.getItem('etaske-lang')`) === 'ar');
check('العربية is now the pressed option',
  await evalJS(`window.__one('button','العربية').getAttribute('aria-pressed')`) === 'true');
check('the Language label itself is translated', await evalJS(`!!window.__one('div','اللغة')`));
check('the English button keeps its own script (not "الإنجليزية")',
  await evalJS(`window.__one('button','English').textContent.trim()`) === 'English');

// ★ Task 3: the nav labels themselves. Until this task they were hard-coded
// English strings inside the component, so the bar stayed English while the
// page around it flipped — the most visible possible miss.
const navTabsAr = await evalJS(`JSON.stringify([...document.querySelectorAll('.nav-tab')].map(b => b.textContent.trim()))`);
// UX task 2 regrouped the bar: the top level is now Home + the group buttons
// (Work / Portfolio / Insights / More), and Tasks / Correspondences live one
// level down inside the Work menu — they are asserted in [B7].
check('★ nav tabs are translated (الرئيسية / العمل / المحفظة)',
  /الرئيسية/.test(navTabsAr) && /العمل/.test(navTabsAr) && /المحفظة/.test(navTabsAr), navTabsAr);
const navStillEnglish = await evalJS(`(() => {
  const left = [...document.querySelectorAll('.nav-tab')]
    .map(b => b.textContent.replace(/[0-9+]/g, '').trim())
    .filter(txt => /^[A-Za-z ]+$/.test(txt) && txt.length);
  return JSON.stringify(left);
})()`);
check('★ no nav tab is still English in ar', navStillEnglish === '[]', navStillEnglish);
check('★ Sign Out in the open menu is translated',
  await evalJS(`!!window.__one('button','تسجيل الخروج')`));

// ★ Task 6: the role chip under the user's name. It reads `appUser.role` — a
// value straight out of Firestore — so it was the one word in this menu the
// task-3 pass could not touch.
const roleChip = await evalJS(`(() => {
  const el = [...document.querySelectorAll('div, span')]
    .find(e => e.children.length === 0 && /^(مدير النظام|مدير|موظف|Admin|Manager|Employee)$/.test((e.textContent||'').trim()));
  return el ? (el.textContent || '').trim() : 'not rendered';
})()`);
check('★ the role chip paints the stored role in Arabic', roleChip === 'مدير', roleChip);
await shot('menu-ar');

// The whole header must mirror, not just the menu. The avatar is the last item
// in the flex row, so in RTL it belongs on the LEFT half of the bar.
const avatarSide = await evalJS(`(() => {
  const a = document.querySelector('.topnav-avatar, .topnav-avatar-placeholder');
  const r = a.getBoundingClientRect();
  return JSON.stringify({ centre: Math.round(r.left + r.width / 2), vw: document.documentElement.clientWidth });
})()`).then(JSON.parse);
check('the header actually mirrors (avatar moves to the left half)',
  avatarSide.centre < avatarSide.vw / 2, JSON.stringify(avatarSide));

const menuOffRtl = await evalJS(`(() => {
  const b = window.__one('button','العربية'); if (!b) return 'no ar button';
  let m = b; while (m && getComputedStyle(m).position !== 'absolute') m = m.parentElement;
  return JSON.stringify(window.__offscreen(m || b));
})()`);
check('★ user menu still sits inside the viewport in RTL', menuOffRtl === '[]', menuOffRtl);

console.log('\n[B3] the notifications dropdown in RTL');
await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'close user menu');
await clickEl(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.querySelector('.lucide-bell, .lucide-bell-ring')); return b; })()`, 'bell');
const notifOff = await evalJS(`(() => {
  const d = document.querySelector('.notif-dropdown');
  return d ? JSON.stringify(window.__offscreen(d)) : 'dropdown not found';
})()`);
check('★ notif dropdown sits inside the viewport in RTL', notifOff === '[]', notifOff);
// ★ The unread badge is absolutely positioned AND nudged outward with a
// translateX. A logical property moves it to the inline end; only the explicit
// [dir=rtl] transform override makes it lean the right way. Assert both.
const badge = await evalJS(`(() => {
  const b = document.querySelector('.notif-badge');
  if (!b) return JSON.stringify({ err: 'no .notif-badge rendered' });
  const btn = b.parentElement.getBoundingClientRect(), r = b.getBoundingClientRect();
  return JSON.stringify({
    onInlineEnd: r.left + r.width / 2 < btn.left + btn.width / 2,
    leansOutward: r.left < btn.left,
    transform: getComputedStyle(b).transform,
  });
})()`).then(JSON.parse);
check('unread badge moves to the inline end in RTL', badge.onInlineEnd === true, JSON.stringify(badge));
check('unread badge leans outward, not back over the bell', badge.leansOutward === true, JSON.stringify(badge));

// ★ Task 6: the row timestamp. It was a hard-coded toLocaleString('en-GB') and
// is the one string in this dropdown that stayed English through tasks 1–5.
const notifStamp = await evalJS(`(() => {
  const d = document.querySelector('.notif-dropdown');
  if (!d) return 'dropdown not found';
  const hit = [...d.querySelectorAll('*')]
    .filter(e => e.children.length === 0)
    .map(e => (e.textContent || '').trim())
    .find(txt => /\\d{1,2}[^\\d]+\\d{2}:\\d{2}/.test(txt));
  return hit || 'no timestamp found';
})()`);
check('★ the notification timestamp is an Arabic-month date, not en-GB',
  AR_RANGE.test(notifStamp) && /\d{2}:\d{2}/.test(notifStamp), notifStamp);
await shot('notif-ar');
await clickEl(`(() => [...document.querySelectorAll('button')].find(x => x.querySelector('.lucide-bell, .lucide-bell-ring')))()`, 'close bell');

console.log('\n[B4] no overflow / no clipping, RTL, both themes, 3 widths');
for (const dark of [false, true]) {
  await evalJS(`window.__setDark(${dark})`);
  // A theme flip animates colours; nothing here measures colour, but give the
  // layout a frame to settle before measuring boxes.
  await sleep(250);
  for (const w of [1440, 900, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w <= 768 });
    await sleep(220);
    const over = await evalJS(`window.__docOverflow()`);
    check(`${dark ? 'dark' : 'light'} @${w}px: no horizontal document overflow`, over <= 0, `${over}px`);
    const clipped = await evalJS(`JSON.stringify(window.__clipped())`);
    check(`${dark ? 'dark' : 'light'} @${w}px: nothing clips its own content`, clipped === '[]', clipped.slice(0, 300));
  }
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(150);
await evalJS(`window.__setDark(false)`);

console.log('\n[B5] directional icon flip (menu open — LogOut only renders there)');
await clickEl(`document.querySelector('.topnav-avatar, .topnav-avatar-placeholder')`, 'avatar');
const icons = await evalJS(`(() => {
  const lo = document.querySelector('.lucide-log-out');
  const bell = document.querySelector('.lucide-bell, .lucide-bell-ring');
  return JSON.stringify({
    logOut: lo ? getComputedStyle(lo).transform : 'not rendered',
    bell: bell ? getComputedStyle(bell).transform : 'not rendered',
  });
})()`).then(JSON.parse);
check('a directional icon (LogOut) is mirrored under dir=rtl',
  icons.logOut !== 'none' && icons.logOut !== 'not rendered', JSON.stringify(icons));
// Non-vacuous: proves the rule is scoped, not flipping every icon on the page.
check('a symbolic icon (Bell) is NOT mirrored', icons.bell === 'none', JSON.stringify(icons));

console.log('\n[B6] switching back to English');
// The menu is already open from B5 — toggling the avatar again would close it.
await clickEl(`window.__one('button','English')`, 'English');
check('<html dir> returns to ltr', await evalJS(`document.documentElement.getAttribute('dir')`) === 'ltr');
check('the en choice is persisted', await evalJS(`localStorage.getItem('etaske-lang')`) === 'en');
check('the Language label is English again', await evalJS(`!!window.__one('div','Language')`));
const navTabsEn = await evalJS(`JSON.stringify([...document.querySelectorAll('.nav-tab')].map(b => b.textContent.trim()))`);
check('non-vacuous: the same nav tabs read English again',
  /Work/.test(navTabsEn) && /Portfolio/.test(navTabsEn) && !/العمل/.test(navTabsEn), navTabsEn);

// ═══ [B7] UX task 2 — the grouped nav ════════════════════════════════════════
// The bar used to show up to 7 tabs + More. It must now show at most 5 buttons
// (Home + at most four groups), and every destination that left the top level
// must still be reachable in exactly one click from inside its group menu.
console.log('\n[B7] grouped nav: four groups, every destination still reachable');

const topTabs = await evalJS(`JSON.stringify([...document.querySelectorAll('.nav-tab')]
  .map(b => b.textContent.replace(/[0-9+]/g, '').trim()))`).then(JSON.parse);
check('★ at most 5 top-level nav buttons (was 7 + More)', topTabs.length <= 5, JSON.stringify(topTabs));
check('the group labels are the four intended ones',
  ['Home', 'Work', 'Portfolio', 'Insights', 'More'].every(l => topTabs.includes(l)), JSON.stringify(topTabs));
check('no destination leaked back into the top level',
  !topTabs.some(l => ['Tasks', 'Correspondences', 'Projects', 'Opportunities', 'Overview', 'Bid Analytics', 'Archive', 'Outlook', 'Users'].includes(l)),
  JSON.stringify(topTabs));

// Every group is opened in turn and its menu read, so a destination that was
// dropped from the tables — not just hidden — fails here.
const GROUPS = {
  Work: ['Tasks', 'Correspondences', 'Manager Inbox'],
  Portfolio: ['Projects', 'Opportunities'],
  Insights: ['Overview', 'Bid Analytics'],
  // Users is Admin-only and this harness signs in as a Manager, so it is
  // asserted absent below rather than listed here.
  More: ['Archive', 'Outlook'],
};
for (const [group, expected] of Object.entries(GROUPS)) {
  await clickEl(`window.__one('button','${group}')`, `${group} group`);
  const items = await evalJS(`JSON.stringify([...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
    .map(b => b.textContent.replace(/[0-9+]/g, '').trim()))`).then(JSON.parse);
  check(`${group} menu holds ${expected.join(' / ')}`,
    expected.every(l => items.includes(l)), JSON.stringify(items));
  // Escape closes it, so the next group's menu is read on its own.
  await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const stillOpen = await evalJS(`document.querySelectorAll('[role="menu"]').length`);
  check(`${group} menu closes on Escape`, stillOpen === 0, String(stillOpen));
}

await clickEl(`window.__one('button','More')`, 'More group');
const moreItemsSeen = await evalJS(`JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map(b => b.textContent.trim()))`);
check('Users stays hidden from a Manager', !/Users/.test(moreItemsSeen), moreItemsSeen);
await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

// The badge sums to the group button, or a pending count would be invisible
// behind a closed menu.
const workBadge = await evalJS(`(() => {
  const b = window.__one('button','Work');
  const badge = b && b.querySelector('.tab-badge');
  return badge ? badge.textContent.trim() : 'none';
})()`);
check('★ the Work group carries its children\u2019s badge count', workBadge !== 'none', workBadge);

// Non-vacuous: leave Work first (mount starts on `tasks`), so both the
// navigation and the active state have to actually change.
await clickEl(`window.__one('button','Portfolio')`, 'Portfolio group');
await clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.trim().startsWith('Projects'))`, 'Projects item');
check('Work is no longer active after leaving it',
  !(await evalJS(`window.__one('button','Work').className.includes('active')`)));
check('Portfolio reads active on Projects',
  await evalJS(`window.__one('button','Portfolio').className.includes('active')`));

// One click, not two: the menu item navigates straight to the view.
await clickEl(`window.__one('button','Work')`, 'Work group');
await clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.trim().startsWith('Tasks'))`, 'Tasks item');
check('picking Tasks from the Work menu navigates there',
  (await evalJS(`String(window.__navigated)`)) === 'tasks', await evalJS(`String(window.__navigated)`));
check('the menu closed after navigating', (await evalJS(`document.querySelectorAll('[role="menu"]').length`)) === 0);
check('the Work group now reads active',
  await evalJS(`window.__one('button','Work').className.includes('active')`));

check('no errors across the whole run', pageErrors.length === 0 && (await evalJS(`window.__errors.length`)) === 0,
  pageErrors.join(' || ').slice(0, 400));

// ═══ [C] The big dashboards, mounted for real, in RTL ════════════════════════
// [B] only ever mounted the header. The ~140 physical inline styles this task
// converted live in the dashboards, and a `borderLeft` accent or an absolutely
// positioned search icon only misbehaves once the component is on screen with
// data in it. So: real TasksDashboard / CorrespondingsDashboard /
// OverviewDashboard / OpportunitiesDashboard / ArchiveDashboard, real
// index.css, real (fake-backed) Firestore reads, dir=rtl.
console.log('\n[C] the real dashboards in RTL');

const dashPlugin = {
  name: 'dash-stub',
  setup(b) {
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'stub-firestore', namespace: 'stub' }));
    b.onResolve({ filter: /^firebase\/(auth|app|messaging)$/ }, () => ({ path: 'stub-empty', namespace: 'stub' }));
    b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'stub-firebase', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
      contents: args.path === 'stub-firestore' ? FIRESTORE_STUB
        : args.path === 'stub-firebase'
          ? `export const app = {}; export const db = { __fake: true }; export const auth = { currentUser: { uid: 'u-mgr' } };`
          : `export const getMessaging = () => ({}); export const getToken = async () => null; export const onMessage = () => () => {};
             export const signOut = async () => {}; export const onAuthStateChanged = () => () => {};`,
      loader: 'js',
      resolveDir: ROOT,
    }));
  },
};

const DASH_ENTRY = /* tsx */ `
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from './src/i18n';
import TasksDashboard from './src/TasksDashboard';
import CorrespondingsDashboard from './src/CorrespondingsDashboard';
import OverviewDashboard from './src/OverviewDashboard';
import OpportunitiesDashboard from './src/OpportunitiesDashboard';
import ArchiveDashboard from './src/ArchiveDashboard';
import OpportunitiesAnalytics from './src/OpportunitiesAnalytics';
import ProjectsDashboard from './src/ProjectsDashboard';
import AdminDashboard from './src/AdminDashboard';
import HomeDashboard from './src/HomeDashboard';

const T0 = Math.floor(new Date('2026-08-01T08:00:00Z').getTime() / 1000);
const ts = s => ({ seconds: T0 + s, nanoseconds: 0, toDate: () => new Date((T0 + s) * 1000) });

const USERS = [
  { id: 'u-mgr',  displayName: 'Tariq Salama', email: 't@x.com', photoURL: '', status: 'Approved', role: 'Manager',  teamId: 'T1', department: 'Maintenance Planning', userColor: '#2563eb' },
  { id: 'u-emp1', displayName: 'Nevin Anwar',  email: 'n@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', userColor: '#16a34a' },
  { id: 'u-emp2', displayName: 'Ahmed Salem',  email: 'a@x.com', photoURL: '', status: 'Approved', role: 'Employee', teamId: 'T1', department: 'Maintenance Planning', userColor: '#f97316' },
];

// Long, wrapping, mixed Arabic/Latin content on purpose: a short English title
// never reveals a clipping bug, and a serial number inside Arabic prose is
// exactly where bidi mangling shows up.
const LONG_AR = 'متابعة أعمال الصيانة الدورية لوحدة التقطير الجوي رقم 3 وإعداد تقرير الاهتزازات للمضخة P-101 قبل بدء الوقفة السنوية';

__seed('tasks', '--stats--', { value: 4 });
__seed('correspondences', '--stats--', { value: 4 });
['a', 'b', 'c'].forEach((k, i) => {
  __seed('tasks', 't-' + k, {
    taskName: i === 1 ? LONG_AR : 'Pump P-10' + i + ' vibration report and turnaround readiness review',
    description: i === 1 ? LONG_AR : 'Vendor reports high vibration. Investigate before the turnaround window closes.',
    status: ['Pending', 'In Progress', 'Done'][i], priority: ['High', 'Medium', 'Low'][i],
    serialNumber: 'TK00000' + (i + 1), category: ['Project', 'Administrative', 'Project'][i],
    assignedTo: USERS[i].displayName, assignedToId: USERS[i].id,
    isPrivate: false, collaboratorIds: i === 0 ? ['u-emp2'] : [],
    // Cross-linking task 6: the FIRST task is attached to the first project, so
    // the project's Linked tab has a row to paint. ⚠ No task is attached to a
    // BID — [C7] asserts the bid Tasks tab's empty state.
    ...(i === 0 ? { projectId: 'p-a', projectName: 'Meleiha Gas Plant operations & maintenance contract' } : {}),
    deadline: ['2026-08-16', '2026-12-31', '2026-07-01'][i],
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
  __seed('correspondences', 'c-' + k, {
    subject: i === 1 ? LONG_AR : 'Annual insurance renewal and asset schedule confirmation',
    body: i === 1 ? LONG_AR : 'Finance needs the asset list before the renewal date.',
    sentFrom: ['EGPC', 'الشركة المصرية للتكرير', 'Stores'][i],
    department: 'Maintenance Planning', subCategory: 'Refinery Upgrade',
    category: ['Project', 'Administrative', 'Project'][i], priority: ['High', 'Medium', 'Low'][i],
    dateReceived: '2026-08-1' + i, deadline: ['2026-08-16', '2026-12-31', '2026-07-01'][i],
    serialNumber: 'CR00000' + (i + 1), status: ['Unread', 'Assigned', 'Closed'][i],
    assignedTo: USERS[i].displayName, assignedToId: USERS[i].id,
    // Cross-linking task 6: each correspondence is attached to the bid of the
    // same index, so WHICHEVER bid [C7] opens has exactly one linked email on
    // its overview; the first one also carries the project.
    opportunityId: 'o-' + k, opportunitySerial: 'OP00000' + (i + 1),
    opportunityTitle: 'Linked bid ' + k,
    ...(i === 0 ? { projectId: 'p-a', projectName: 'Meleiha Gas Plant operations & maintenance contract' } : {}),
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
  __seed('milestones', 'm-' + k, {
    taskId: 't-a', title: i === 1 ? LONG_AR : 'Vendor report received and reviewed by planning',
    status: ['Pending', 'In Progress', 'Done'][i], targetDate: '2026-08-2' + i,
    addedById: 'u-mgr', addedByName: 'Tariq Salama', createdAt: ts(10 * i), updatedAt: ts(10 * i),
  });
  __seed('opportunities', 'o-' + k, {
    title: i === 1 ? LONG_AR : 'EGPC turnaround maintenance tender — Alexandria refinery',
    client: ['EGPC', 'هيئة البترول', 'ECHEM'][i], sector: 'Refining',
    // Group-by task 4: the four dimensions need real variety or every assertion
    // passes on a single bucket. o-a and o-b SHARE 'Alexandria' so one bucket
    // holds two cards and the in-bucket order is provable against the board's
    // own sort select; o-c carries NO location and NO source on purpose — that
    // is what proves the "no value" bucket sorts LAST.
    location: ['Alexandria', 'Alexandria', ''][i],
    source: ['Public Tender', 'Framework', ''][i],
    // ★ Real stage VALUES only: 'Bid Submitted' is not one of
    // OPPORTUNITY_STAGE_OPTIONS, so the display-label layer would echo it back
    // in English and [C7] would be asserting against a typo, not a translation.
    tenderNumber: 'RFQ-2026-0' + i, stage: ['Identified', 'Submitted', 'Won'][i],
    probability: [20, 60, 100][i], estimatedValue: 12500000 * (i + 1), currency: 'EGP',
    announcedDate: '2026-07-0' + (i + 1), submissionDeadline: '2026-08-1' + (i + 5),
    ownerId: USERS[i].id, ownerName: USERS[i].displayName, collaboratorIds: [],
    userId: 'u-mgr', teamId: 'T1', createdAt: ts(100 * i), updatedAt: ts(100 * i),
  });
});

// ── task 6c: the Projects module ────────────────────────────────────────────
// Statuses are the stored English values (the display layer is what paints
// them in Arabic); one project carries the tracking summary the detail page
// leads with, and each child collection is keyed to 'p-a' so opening the first
// card lands on populated tabs rather than four empty states.
// ⚠ The list sorts by createdAt DESC, so 'p-a' must be the NEWEST or the click
// in [C8] opens an empty project and six assertions fail on missing data.
__seed('projects', '--stats--', { value: 4 });
[
  ['p-a', 'Meleiha Gas Plant operations & maintenance contract', 'Active', 'AGIBA'],
  ['p-b', LONG_AR, 'On Hold', 'الشركة المصرية للتكرير'],
  ['p-c', 'Alexandria tank farm inspection framework', 'Completed', 'EGPC'],
].forEach(([id, name, status, client], i) => {
  __seed('projects', id, {
    name, status, client, operator: 'EPROM', code: '46000029' + (81 + i),
    serialNumber: 'PR00000' + (i + 1),
    // Group-by task 3: the three group dimensions need real variety or every
    // assertion passes on a single bucket. ⚠ p-a MUST keep 'Alexandria' — [C5b]
    // resolves the correspondence location through this very project.
    // p-c carries NO location on purpose: it is what proves the "no value"
    // bucket sorts last.
    location: ['Alexandria', 'Suez', ''][i],
    description: i === 1 ? LONG_AR : 'Full O&M scope including rotating equipment, static equipment and instrumentation.',
    startDate: '2026-01-0' + (i + 1), endDate: ['2027-06-30', '2026-09-30', ''][i],
    currentStatus: status, lastUpdateText: i === 1 ? LONG_AR : 'Mobilization complete; commissioning spares on order.',
    lastUpdateAt: ts(100 * (2 - i)), userId: ['u-mgr', 'u-emp1', 'u-mgr'][i], teamId: 'T1',
    createdAt: ts(100 * (2 - i)), updatedAt: ts(100 * (2 - i)),
  });
});
// Group-by task 3: a SECOND Active project sharing p-a's client and location.
// Without it every bucket holds exactly one card and no assertion can tell an
// in-bucket sort from luck. ⚠ Its createdAt is the OLDEST of the four, so the
// default "Most recent" sort keeps p-a the first card [C8] clicks — while its
// much earlier endDate makes it first once the sort flips to "End date".
__seed('projects', 'p-d', {
  name: 'Suez refinery jetty maintenance framework', status: 'Active', client: 'AGIBA',
  operator: 'EPROM', code: '4600002984', serialNumber: 'PR000004', location: 'Alexandria',
  description: 'Jetty and loading-arm maintenance under the same framework agreement.',
  startDate: '2026-02-01', endDate: '2026-03-31',
  currentStatus: 'Active', lastUpdateText: 'Scope frozen pending the client walkdown.',
  lastUpdateAt: ts(10), userId: 'u-mgr', teamId: 'T1', createdAt: ts(10), updatedAt: ts(10),
});
['a', 'b'].forEach((k, i) => {
  __seed('projectUpdates', 'pu-' + k, {
    projectId: 'p-a', status: ['Active', 'On Hold'][i],
    text: i === 1 ? LONG_AR : 'Vendor mobilized on site; first turnaround window confirmed with the client.',
    authorId: USERS[i].id, authorName: USERS[i].displayName, authorColor: USERS[i].userColor,
    createdAt: ts(50 * i),
  });
  __seed('projectFinancials', 'pf-' + k, {
    projectId: 'p-a', type: ['invoice', 'expense'][i],
    title: i === 1 ? LONG_AR : 'Milestone 1 progress invoice',
    amount: [12500000, 3400000][i], currency: 'EGP', date: '2026-0' + (6 + i) + '-15',
    status: ['Pending', 'Approved'][i], userId: 'u-mgr', createdAt: ts(50 * i),
  });
  __seed('projectSubcontracts', 'ps-' + k, {
    projectId: 'p-a', name: i === 1 ? 'شركة النيل للخدمات الصناعية' : 'Delta Industrial Services',
    typeOfService: i === 1 ? LONG_AR : 'Scaffolding, insulation and painting during the turnaround window.',
    soOrContract: 'SO-2026-0' + (i + 1), price: [4500000, 980000][i], currency: 'EGP',
    startDate: '2026-02-01', expiryDate: ['2026-09-30', '2027-03-31'][i],
    currentStatus: ['Active', 'On Hold'][i], userId: 'u-mgr', createdAt: ts(50 * i),
  });
});
__seed('projectContracts', 'pc-a', {
  projectId: 'p-a', type: 'contract', contractNumber: '4600002981',
  subject: 'Operations & maintenance of the Meleiha gas processing plant',
  companyName: 'AGIBA Petroleum', department: 'Maintenance Planning',
  contractValue: 480000000, currency: 'EGP', startDate: '2026-01-01', endDate: '2027-06-30',
  status: 'Active', contractingMethod: 'أمر مباشر', inCharge: 'Tariq Salama',
  parentId: null, userId: 'u-mgr', createdAt: ts(0),
});
__seed('projectContracts', 'pc-b', {
  projectId: 'p-a', type: 'amendment', contractNumber: '4600002981-A1',
  amendmentNumber: 'AMD-01', subject: LONG_AR, companyName: 'AGIBA Petroleum',
  contractValue: 480000000, valueAfterIncrease: 512000000, currency: 'EGP',
  status: 'Active', parentId: 'pc-a', userId: 'u-mgr', createdAt: ts(60),
});

const user = { uid: 'u-mgr', displayName: 'Tariq Salama', email: 't@x.com' };
const appUser = USERS[0];
// AdminDashboard is the only screen that renders a PENDING user (the approval
// banner + the two row buttons), so the directory it gets carries a fourth
// account the other dashboards never see.
const ADMIN_USERS = [
  ...USERS,
  { id: 'u-new', displayName: 'Hossam Asaad', email: 'h@x.com', photoURL: '', status: 'Pending', role: 'Employee', teamId: '', department: '', userColor: '#a855f7' },
  { id: 'u-out', displayName: '', email: 'x@x.com', photoURL: '', status: 'Rejected', role: 'Employee', teamId: '', department: '', userColor: '#64748b' },
];
const shared = { user, appUser, projectUsers: USERS, users: ADMIN_USERS };
const VIEWS = {
  tasks: TasksDashboard, corr: CorrespondingsDashboard, overview: OverviewDashboard,
  opps: OpportunitiesDashboard, archive: ArchiveDashboard, bidanalytics: OpportunitiesAnalytics,
  projects: ProjectsDashboard, admin: AdminDashboard, home: HomeDashboard,
};
// UX task 3: Home's "Needs you today" list is fed from App.tsx's listeners, so
// the harness supplies the rows directly - seven of them, one more than the
// six-row cap, which is what makes the cap and the "See all" link assertable.
window.__nav = [];
window.__ATTENTION = [
  { id: 'c-a', kind: 'corresponding', label: 'مراسلة متأخرة من الشركة القابضة', serial: 'CR000001', due: '2026-08-20', reason: 'overdue' },
  { id: 't-a', kind: 'task', label: LONG_AR, serial: 'TK000001', due: '2026-08-25', reason: 'overdue' },
  { id: 't-b', kind: 'task', label: 'Vibration report for pump P-101', serial: 'TK000002', due: '2026-08-27', reason: 'due-soon' },
  { id: 'c-b', kind: 'corresponding', label: 'طلب عرض فني', serial: 'CR000002', due: '2026-08-28', reason: 'due-soon' },
  { id: 'c-c', kind: 'corresponding', label: 'خطاب وارد بانتظار الفرز', serial: 'CR000003', due: '', reason: 'review' },
  { id: 'c-d', kind: 'corresponding', label: 'تعميم إداري', serial: 'CR000004', due: '', reason: 'review' },
  { id: 'c-e', kind: 'corresponding', label: 'مذكرة داخلية', serial: 'CR000005', due: '', reason: 'review' },
];

const root = createRoot(document.getElementById('root'));
// initialStatusFilter/initialView are forced OFF their defaults on purpose:
// Tasks opens on "My Tasks" and Correspondences on "Unassigned", which would
// leave the harness scanning an empty-state card instead of the rows that carry
// nearly every style this task converted.
window.__mount = (name, opts) => root.render(
  React.createElement('div', { className: 'app-main', style: { padding: 16 } },
    React.createElement(VIEWS[name], {
      ...shared, initialStatusFilter: 'All', initialView: 'all',
      dueSoonCount: 4, announcementCount: 2, unreadNotifications: 3,
      navCounts: { corrNeedsReview: 3, corrUnread: 1, myActiveTasks: 2, openBids: 2, bidsDueSoon: 1 },
      attention: window.__ATTENTION,
      onNavigate: v => { window.__nav.push(v); }, onNavigateTasks: () => {}, onNavigateCorrespondences: () => {},
      ...(opts || {}),
    }),
  ),
);
window.__mount('tasks');
// Lets [C4] read the SAME mounted DOM in both languages — the non-vacuous half
// of "this screen is translated" needs the English render to compare against.
window.__setLang = l => i18n.changeLanguage(l);

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)));
window.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
`;

await build({
  stdin: { contents: DASH_ENTRY, resolveDir: ROOT, sourcefile: 'dashEntry.tsx', loader: 'tsx' },
  bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  outfile: path.join(WORK, 'dash.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '__VITE_ENV__' },
  banner: { js: `const __VITE_ENV__ = { VITE_GOOGLE_SCRIPT_URL: 'https://script.test/exec', VITE_GOOGLE_SCRIPT_SECRET: 'x' };` },
  plugins: [dashPlugin],
  logLevel: 'warning',
});
fs.writeFileSync(path.join(WORK, 'dash.html'),
  `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
   <link rel="stylesheet" href="app.css"></head>
   <body><div id="root"></div><script src="dash.js"></script></body></html>`);

// Same origin as the first page, so the 'ar' choice [B2] persisted is still in
// localStorage — i18n.ts reads it at module load and stamps dir=rtl before the
// first paint. That is the real code path, not a test-only setAttribute.
await evalJS(`localStorage.setItem('etaske-lang','ar')`);
const errorsBefore = pageErrors.length;
await send('Page.navigate', { url: pathToFileURL(path.join(WORK, 'dash.html')).href });
await sleep(400);
await waitFor(`document.getElementById('root') && document.getElementById('root').children.length`, 'dashboard mount');
await evalJS(HELPERS);
await evalJS(SCAN);
check('the dashboard page loads already in RTL (no LTR first paint)',
  await evalJS(`document.documentElement.getAttribute('dir')`) === 'rtl');

const DASHBOARDS = [
  ['tasks', 'TasksDashboard'],
  ['corr', 'CorrespondingsDashboard'],
  ['overview', 'OverviewDashboard'],
  ['opps', 'OpportunitiesDashboard'],
  ['bidanalytics', 'OpportunitiesAnalytics'],
  ['archive', 'ArchiveDashboard'],
  ['projects', 'ProjectsDashboard'],
  ['admin', 'AdminDashboard'],
];
for (const [key, label] of DASHBOARDS) {
  console.log(`\n[C:${label}]`);
  await evalJS(`window.__mount('${key}')`);
  await sleep(500);
  check(`${label} renders`, await evalJS(`document.querySelectorAll('#root *').length`) > 40,
    String(await evalJS(`document.querySelectorAll('#root *').length`)));
  for (const w of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w <= 768 });
    await sleep(260);
    const over = await evalJS(`window.__docOverflow()`);
    check(`${label} @${w}px: no horizontal document overflow`, over <= 0, `${over}px`);
    const clipped = await evalJS(`JSON.stringify(window.__clipped())`);
    check(`${label} @${w}px: nothing clips its own content`, clipped === '[]', clipped.slice(0, 240));
    const off = await evalJS(`JSON.stringify(window.__unreachable(document.getElementById('root')))`);
    check(`${label} @${w}px: nothing is stranded outside the viewport`, off === '[]', off.slice(0, 240));
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(150);
  await shot(`dash-${key}`);
}
check('no page errors while mounting all eight dashboards in RTL',
  pageErrors.length === errorsBefore && (await evalJS(`window.__errors.length`)) === 0,
  pageErrors.slice(errorsBefore).join(' || ').slice(0, 400));

// ── [C2] the two conversions that actually move pixels ──────────────────────
// Measured in BOTH directions from the same DOM: an assertion that only holds
// in RTL could be true of a hard-coded layout too.
console.log('\n[C2] the search icon and the card accent, measured both ways');
// The task ROWS (accent stripe, serial number) live behind a group card — see
// openFirstGroupCard. "My Tasks" is still the view under test.
await evalJS(`window.__mount('tasks', { initialView: 'mine' })`);
await sleep(500);
await openFirstGroupCard();

const sideOf = `(() => {
  const icon = document.querySelector('.lucide-search');
  const wrap = icon && icon.parentElement;
  const card = document.querySelector('#root .card[id^="task-"]') || document.querySelector('#root .card');
  if (!icon || !card) return JSON.stringify({ err: 'not rendered' });
  const i = icon.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  const cs = getComputedStyle(card);
  return JSON.stringify({
    iconPastCentre: i.left + i.width / 2 > w.left + w.width / 2,
    accentLeft: cs.borderLeftWidth, accentRight: cs.borderRightWidth,
  });
})()`;
const rtlSide = JSON.parse(await evalJS(sideOf));
check('★ the search icon sits on the RIGHT of its box in RTL', rtlSide.iconPastCentre === true, JSON.stringify(rtlSide));
// The opposite side reads 1px, not 0 — that is .card's own hairline border,
// which the 4px accent overrides on one side only.
check('★ the task card accent stripe moves to the right edge in RTL',
  rtlSide.accentRight === '4px' && rtlSide.accentLeft === '1px', JSON.stringify(rtlSide));

// ★ Found by LOOKING at the screenshot, not by an assertion: the serial
// rendered as "TK000001#". The '#' is a bidi-neutral character, so in an RTL
// paragraph it resolves to the paragraph direction and is drawn at the far end
// of the Latin run. textContent still reads "#TK000001" — only the painted
// glyph positions show it, so this measures the first and last glyph.
const glyphOrder = `(() => {
  const el = [...document.querySelectorAll('#root .ltr-data')].find(e => /^#[A-Z]{2}\\d+/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no serial rendered' });
  // JSX renders \`#{serial}\` as TWO text nodes, so the first and last glyph do
  // not live in the same node — measure across the element's whole text.
  const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  const first = nodes[0], lastNode = nodes[nodes.length - 1];
  const iHash = first.textContent.indexOf('#');
  const r = document.createRange();
  r.setStart(first, iHash); r.setEnd(first, iHash + 1);
  const hash = r.getBoundingClientRect();
  const lt = lastNode.textContent;
  r.setStart(lastNode, lt.length - 1); r.setEnd(lastNode, lt.length);
  const last = r.getBoundingClientRect();
  return JSON.stringify({ hashLeft: Math.round(hash.left), lastLeft: Math.round(last.left),
                          bidi: getComputedStyle(el).unicodeBidi, dir: getComputedStyle(el).direction });
})()`;
const serialRtl = JSON.parse(await evalJS(glyphOrder));
check('★ the "#" of a serial number stays in front of it in RTL (bidi isolation)',
  serialRtl.hashLeft < serialRtl.lastLeft && serialRtl.dir === 'ltr' && serialRtl.bidi === 'isolate',
  JSON.stringify(serialRtl));
// Non-vacuous: strip the isolation off that same element and the '#' really
// does jump to the far end. Without this the check above could be measuring a
// layout that never needed .ltr-data at all.
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = 'normal'; e.style.direction = 'inherit'; })`);
await sleep(120);
const serialBroken = JSON.parse(await evalJS(glyphOrder));
check('non-vacuous: without .ltr-data the "#" jumps behind the serial',
  serialBroken.hashLeft > serialBroken.lastLeft, JSON.stringify(serialBroken));
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = ''; e.style.direction = ''; })`);

await evalJS(`document.documentElement.setAttribute('dir','ltr')`);
await sleep(250);
const ltrSide = JSON.parse(await evalJS(sideOf));
check('non-vacuous: the same icon sits on the LEFT under dir=ltr', ltrSide.iconPastCentre === false, JSON.stringify(ltrSide));
check('non-vacuous: the same accent stripe is on the left edge under dir=ltr',
  ltrSide.accentLeft === '4px' && ltrSide.accentRight === '1px', JSON.stringify(ltrSide));
await evalJS(`document.documentElement.setAttribute('dir','rtl')`);
await shot('dash-ar');

// ── [C3] the literal "→" in the copy ────────────────────────────────────────
// index.css mirrors directional lucide icons, but "assigned → Nevin" is a bare
// text character no [dir] selector can reach. It needs the .dir-arrow wrapper,
// and this is the only thing that proves the wrapper is actually on it.
console.log('\n[C3] the literal arrow in the copy');
await evalJS(`window.__mount('corr')`);
await sleep(500);
// The arrow is painted on a correspondence ROW ("assigned → Nevin"), and rows
// now live behind a group card — drill in or there is nothing to measure.
await openFirstGroupCard();
const arrow = `(() => {
  const a = document.querySelector('#root .dir-arrow');
  return a ? getComputedStyle(a).transform : 'not rendered';
})()`;
const arrowRtl = await evalJS(arrow);
check('★ a literal "→" is mirrored in RTL', /matrix\(-1/.test(arrowRtl), arrowRtl);
await evalJS(`document.documentElement.setAttribute('dir','ltr')`);
await sleep(200);
const arrowLtr = await evalJS(arrow);
check('non-vacuous: the same "→" is not mirrored in LTR', arrowLtr === 'none', arrowLtr);
await evalJS(`document.documentElement.setAttribute('dir','rtl')`);

// ── [C4] the tasks flow really renders Arabic (task 4) ──────────────────────
// [A5]/[A6] only read source. This mounts the real TasksDashboard and the real
// CreateTaskPanel and reads the painted text, then flips the SAME DOM back to
// English so a hard-coded Arabic string could not pass either.
console.log('\n[C4] the tasks flow renders Arabic (task 4)');
await evalJS(`window.__mount('tasks', { initialView: 'mine' })`);
await sleep(500);
await openFirstGroupCard();

const tasksText = `(() => {
  const h1 = document.querySelector('#root h1');
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', btns });
})()`;
const arText = JSON.parse(await evalJS(tasksText));
check('the Tasks heading reads المهام', arText.h1 === 'المهام', arText.h1);
check('the create button reads إضافة مهمة', arText.btns.some(b => b === 'إضافة مهمة'),
  arText.btns.slice(0, 12).join(' | '));
check('the view toggle reads مهامي / كل المهام',
  arText.btns.includes('مهامي') && arText.btns.includes('كل المهام'), arText.btns.slice(0, 12).join(' | '));

// The create panel is a separate component (CreateTaskPanel) reached by a real
// click — the same path a user takes from this screen.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'إضافة مهمة')`, 'Add Task');
await sleep(500);
const panel = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const ph = [...document.querySelectorAll('input, textarea')].map(i => i.placeholder).filter(Boolean);
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, ph, btns });
})()`).then(JSON.parse);
check('the create panel labels are Arabic (اسم المهمة / الوصف)',
  panel.labels.some(l => l.startsWith('اسم المهمة')) && panel.labels.some(l => l.startsWith('الوصف')),
  panel.labels.slice(0, 10).join(' | '));
check('the task-name placeholder is Arabic', panel.ph.includes('ما المطلوب إنجازه؟'), panel.ph.join(' | '));
check('the submit button reads إنشاء المهمة', panel.btns.some(b => b === 'إنشاء المهمة'),
  panel.btns.slice(-6).join(' | '));
check('the privacy toggle reads عامة / خاصة',
  panel.btns.some(b => b === 'عامة') && panel.btns.some(b => b === 'خاصة'), panel.btns.slice(0, 10).join(' | '));
// No label in the panel is still Latin — a floor of t() calls can be met with a
// whole section left in English.
const latinLabels = panel.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no create-panel label is still English', latinLabels.length === 0, latinLabels.join(' | '));

// Non-vacuous: the same nodes must read English again.
await evalJS(`window.__setLang('en')`);
await sleep(400);
const enPanel = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, btns });
})()`).then(JSON.parse);
check('non-vacuous: the same panel reads English under en',
  enPanel.labels.some(l => l.startsWith('Task Name')) && enPanel.btns.some(b => b === 'Create Task'),
  enPanel.labels.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('tasks-panel-ar');
await clickEl(`[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);
check('no errors across the tasks-flow checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C11] one primary action per board + the Filters disclosure (task 4) ───
// The boss's complaint was that every board opens shouting: create + export +
// analytics in the header, then a wrapping bar of six controls. This asserts
// the shape task 4 gives every board — ONE primary button up top, one toolbar
// row, and the rest of the filters folded away — on the REAL tasks board.
console.log('\n[C11] one primary action + the Filters disclosure (task 4)');
await sleep(350);
const c11Collapsed = await evalJS(`(() => {
  const root = document.getElementById('root');
  const primaries = [...root.querySelectorAll('.btn-primary')].map(b => (b.textContent || '').trim());
  const filterBtn = [...root.querySelectorAll('button[aria-expanded]')]
    .find(b => /Filters|عوامل التصفية/.test(b.textContent || ''));
  return JSON.stringify({
    primaries,
    selects: root.querySelectorAll('select').length,
    dates: root.querySelectorAll('input[type=date]').length,
    filterLabel: filterBtn ? (filterBtn.textContent || '').trim() : null,
    expanded: filterBtn ? filterBtn.getAttribute('aria-expanded') : null,
    searches: root.querySelectorAll('input[type=text], input.input:not([type=date])').length,
    groupBy: !!root.querySelector('[role=group]'),
    clearAll: [...root.querySelectorAll('button')].some(b => (b.textContent || '').trim() === 'مسح الكل'),
  });
})()`).then(JSON.parse);
check('★ the board offers exactly ONE primary action', c11Collapsed.primaries.length === 1,
  c11Collapsed.primaries.join(' | '));
check('★ and it is "إضافة مهمة" — the create action, not an export',
  c11Collapsed.primaries[0] === ar['Add Task'], c11Collapsed.primaries[0]);
check('★★ the filters are FOLDED AWAY by default — no select, no date picker on screen',
  c11Collapsed.selects === 0 && c11Collapsed.dates === 0,
  `selects=${c11Collapsed.selects} dates=${c11Collapsed.dates}`);
check('★ what is left is one row: search + Group by + a Filters disclosure',
  c11Collapsed.groupBy && c11Collapsed.searches >= 1 && c11Collapsed.filterLabel !== null,
  `groupBy=${c11Collapsed.groupBy} searches=${c11Collapsed.searches}`);
check('★ the disclosure is labelled in Arabic and starts closed',
  c11Collapsed.filterLabel.includes(ar['Filters']) && c11Collapsed.expanded === 'false',
  `${c11Collapsed.filterLabel} / ${c11Collapsed.expanded}`);
// ★ A collapsed panel MUST NOT claim a filter is on when none is: the count
// badge is the only thing that makes a hidden filter honest, so it may not
// appear until one is actually set. Same for "Clear all".
check('★★ nothing is filtered, so the disclosure shows no count badge and no "مسح الكل"',
  !/\d/.test(c11Collapsed.filterLabel) && !c11Collapsed.clearAll, c11Collapsed.filterLabel);
check('★ opening it is what puts the filters in the DOM', (await openBoardFilters()) === 'opened');
const c11Open = await evalJS(`(() => {
  const root = document.getElementById('root');
  const btn = [...root.querySelectorAll('button[aria-expanded]')]
    .find(b => /Filters|عوامل التصفية/.test(b.textContent || ''));
  return JSON.stringify({
    selects: root.querySelectorAll('select').length,
    dates: root.querySelectorAll('input[type=date]').length,
    expanded: btn ? btn.getAttribute('aria-expanded') : null,
  });
})()`).then(JSON.parse);
check('★ the status and department selects are back once it is open',
  c11Open.selects >= 2 && c11Open.dates === 1 && c11Open.expanded === 'true',
  `selects=${c11Open.selects} dates=${c11Open.dates} expanded=${c11Open.expanded}`);
check('no errors across the toolbar checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C6] the ENUM VALUES themselves are painted in Arabic (task 6) ──────────
// [A7] proves the words exist and [A8] proves the helpers work; only this
// proves the two are actually joined up on a rendered screen. It reads the
// tasks list — the one place where a status is a segmented control, a badge
// AND a filter <option> at once — then flips the SAME DOM to English.
console.log('\n[C6] the enum values render in Arabic (task 6)');
await sleep(400);
const enumAr = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  const badges = [...document.querySelectorAll('#root .badge, #root [class*="badge-"]')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, opts, badges });
})()`).then(JSON.parse);

const allEnumText = [...enumAr.btns, ...enumAr.badges, ...enumAr.opts.map(o => o.t)].filter(Boolean);
check('★ the task status control paints قيد الانتظار / قيد التنفيذ / منجز',
  ['قيد الانتظار', 'قيد التنفيذ', 'منجز'].every(w => allEnumText.includes(w)),
  allEnumText.slice(0, 16).join(' | '));
check('★ the status filter <option>s are Arabic',
  enumAr.opts.some(o => o.t === 'قيد التنفيذ') && enumAr.opts.some(o => o.t === 'منجز'),
  enumAr.opts.slice(0, 10).map(o => `${o.v}=${o.t}`).join(' | '));

// ★★ THE RULE THE WHOLE LAYER RESTS ON: the <option>'s VALUE is what gets
// written to Firestore and compared by every filter, query and rules check —
// only its label may be Arabic. An <option> with no `value` attribute takes its
// TEXT as the value, so labelling one without adding `value=` silently starts
// writing Arabic to the database. This is the assertion that catches that.
const arabicValues = enumAr.opts.filter(o => /[؀-ۿ]/.test(o.v));
check('★★ no <option> VALUE is Arabic — only labels are translated, never the stored value',
  arabicValues.length === 0, arabicValues.map(o => `${o.v} (${o.t})`).join(' | '));

// ★ Project / Internal / External were missed by the first pass of this task
// and found by LOOKING at i18nrtl-tasks-enums-ar.png — the category filter row
// is a plain string array in the JSX, not one of the types.ts option lists, so
// [A7] could never have seen it. Every enum word that reaches this screen is
// named here, not just the ones with a home in types.ts.
const latinEnums = allEnumText.filter(x =>
  /^(Pending|In Progress|Done|Archived|Urgent|High|Medium|Low|Admin|Manager|Employee|Project|Internal|External|Planned|Blocked)$/.test(x));
check('★ no status / priority / role / category is still painted in English',
  latinEnums.length === 0, latinEnums.join(' | '));

await evalJS(`window.__setLang('en')`);
await sleep(450);
const enumEn = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify({ btns, opts });
})()`).then(JSON.parse);
check('non-vacuous: the same controls read English again under en',
  enumEn.btns.includes('In Progress') && enumEn.opts.some(o => o.v === 'Done' && o.t === 'Done'),
  enumEn.btns.slice(0, 14).join(' | '));
check('non-vacuous: the option VALUES never changed', enumEn.opts.some(o => o.v === 'In Progress'),
  enumEn.opts.slice(0, 10).map(o => o.v).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('tasks-enums-ar');
check('no errors across the enum checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C6b] "Group by" is a GRID of group cards, and it drills in ─────────────
// The follow-up to the group-by queue (2026-08-26): picking a dimension no
// longer stacks sections down the page, it paints ONE CARD PER BUCKET carrying
// the group's name and a summary of what is inside, and the records appear only
// after a card is clicked. Every assertion here reads the PAINTED cards after a
// real click, because "the same rows, arranged differently" is the whole
// feature — a props-level test would prove nothing about it.
console.log('\n[C6b] the tasks group-by GRID + drill-in (grid-first grouping)');
await evalJS(`window.__mount('tasks', { initialView: 'all' })`);
await sleep(600);
// ⚠ `root.render` re-renders the SAME TasksDashboard instance, so remounting
// does NOT reset its state — [C6] left a group card open (see
// openFirstGroupCard) and it is still open here. Back out explicitly.
const backToGrid = async () => {
  const has = await evalJS(`(() => { ${HELPERS} return !!window.__one('button', ${JSON.stringify(ar['All Groups'])}); })()`);
  if (!has) return false;
  await clickEl(`window.__one('button', ${JSON.stringify(ar['All Groups'])})`, 'back to the group grid');
  await sleep(420);
  return true;
};
await backToGrid();
const gridCards = () => evalJS(
  `JSON.stringify([...document.querySelectorAll('#root button[data-group-card]')].map(b => (b.innerText || '').trim().replace(/\\s+/g, ' ')))`,
).then(JSON.parse);
const taskRows = () => evalJS(`document.querySelectorAll('#root .card[id^="task-"]').length`);
const pickDim = async (labelAr) => {
  await clickEl(`[...document.querySelectorAll('#root [role="group"][aria-label] button')].find(b => (b.textContent||'').trim() === ${JSON.stringify(labelAr)})`, `group by ${labelAr}`);
  await sleep(420);
  return gridCards();
};

const statusCards = await gridCards();
check('★ the board OPENS on the grid — cards, and not one task row',
  statusCards.length === 3 && (await taskRows()) === 0,
  `${statusCards.length} cards / ${await taskRows()} rows`);
check('★ by status: one card per bucket, in WORKFLOW order (not alphabetical)',
  statusCards[0].includes(ar['Pending']) && statusCards[1].includes(ar['In Progress']) && statusCards[2].includes(ar['Done']),
  statusCards.join(' | '));
// Grouping BY status already names the status in the title, so repeating the
// three-way breakdown under it would be noise — the card omits it on purpose.
check('★ a status card carries its count but NOT a status breakdown',
  statusCards.every(c => c.includes(ar['task'])) && !statusCards[0].includes(ar['Active']),
  statusCards[0]);

const assigneeCards = await pickDim(ar['Assignee']);
check('★ by assignee: one card per person, titled with the bare NAME',
  assigneeCards.length === 3
  && assigneeCards.some(c => c.includes('Tariq Salama')) && assigneeCards.some(c => c.includes('Ahmed Salem'))
  // The "Assigned to {{name}}" framing belongs on a section header, not under
  // the avatar that already says who this is.
  && !assigneeCards.some(c => c.includes(ar['Assigned to {{name}}'].replace('{{name}}', '').trim())),
  assigneeCards.join(' | '));
check('★ each card summarises what is INSIDE it (count + the status breakdown)',
  assigneeCards.every(c => c.includes(ar['task']) && c.includes(ar['Pending']) && c.includes(ar['Active']) && c.includes(ar['Done'])),
  assigneeCards[0]);
check('the person’s role is the card subtitle',
  assigneeCards.some(c => c.includes(ar['Manager'])) && assigneeCards.some(c => c.includes(ar['Employee'])),
  assigneeCards.join(' | '));

// ★ The drill-in: this is the half that makes the grid a navigation and not a
// dashboard. Ahmed Salem owns exactly one of the three seeded tasks.
await clickEl(`[...document.querySelectorAll('#root button[data-group-card]')].find(b => (b.innerText||'').includes('Ahmed Salem'))`, 'the Ahmed Salem card');
await sleep(450);
const drilled = await evalJS(`document.getElementById('root').innerText || ''`);
check('★ clicking a card opens THAT group’s records, and only those',
  (await taskRows()) === 1 && (await gridCards()).length === 0 && drilled.includes('TK000003'),
  `${await taskRows()} rows / ${(await gridCards()).length} cards`);
check('★ the drilled-in list still names the group it came from',
  drilled.includes('Ahmed Salem'), drilled.slice(0, 160).replace(/\n/g, ' / '));
check('★ and there is a way back to the grid',
  drilled.includes(ar['All Groups']), drilled.slice(0, 160).replace(/\n/g, ' / '));
await backToGrid();
check('★ back returns to the full grid, unchanged',
  (await gridCards()).length === 3 && (await taskRows()) === 0);

// Non-vacuous: the SAME DOM flipped to English. The bucket KEYS are the stored
// values — only the card's title is translated.
await evalJS(`window.__setLang('en')`);
await sleep(450);
const assigneeEn = await gridCards();
check('non-vacuous: the same cards read English under en',
  assigneeEn.length === 3 && assigneeEn.some(c => /Pending/.test(c) && /Active/.test(c) && /Done/.test(c))
  && !assigneeEn.some(c => c.includes(ar['Pending'])),
  assigneeEn.join(' | '));
await shot('tasks-groupby-grid-en');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
check('no errors across the group-by grid checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C5] the correspondence flow really renders Arabic (task 5) ─────────────
// Same contract as [C4]: mount the real screens, read the PAINTED text, then
// flip the same DOM back to English. A floor of t() calls can be met with a
// whole modal still in English, so this clicks into the modals as well.
console.log('\n[C5] the correspondence flow renders Arabic (task 5)');
await evalJS(`window.__mount('corr')`);
await sleep(600);

const corrText = `(() => {
  const h1 = document.querySelector('#root h1');
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const body = (document.getElementById('root').innerText || '');
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', btns, body });
})()`;
const corrAr = JSON.parse(await evalJS(corrText));
check('the Correspondences heading reads المراسلات', corrAr.h1 === 'المراسلات', corrAr.h1);
check('the create button reads مراسلة جديدة', corrAr.btns.some(b => b === 'مراسلة جديدة'),
  corrAr.btns.slice(0, 12).join(' | '));
check('the stat row is translated (الإجمالي / مغلق)',
  corrAr.body.includes('الإجمالي') && corrAr.body.includes('مغلق'), corrAr.btns.slice(0, 8).join(' | '));
check('the manager workload panel reads أحمال العمل بالفريق',
  corrAr.body.includes('أحمال العمل بالفريق'), corrAr.body.slice(0, 160));

// Into the form modal — a real click on the same button a user presses.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'مراسلة جديدة')`, 'New Correspondence');
await sleep(500);
const corrModal = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const ph = [...document.querySelectorAll('input, textarea')].map(i => i.placeholder).filter(Boolean);
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, ph, btns });
})()`).then(JSON.parse);
check('the correspondence form labels are Arabic (الموضوع / الجهة المرسلة)',
  corrModal.labels.includes('الموضوع') && corrModal.labels.includes('الجهة المرسِلة'),
  corrModal.labels.slice(0, 10).join(' | '));
check('the subject placeholder is Arabic', corrModal.ph.includes('موضوع المراسلة…'), corrModal.ph.join(' | '));
check('the submit button reads إنشاء المراسلة', corrModal.btns.some(b => b === 'إنشاء المراسلة'),
  corrModal.btns.slice(-6).join(' | '));
// Task 6 turned the enum VALUES Arabic too, so nothing on this form may carry
// Latin letters any more — labels OR chips.
const corrLatin = corrModal.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no correspondence-form label is still English', corrLatin.length === 0, corrLatin.join(' | '));

// ── task 6: the category / priority / status chips paint the ENUM ────────────
const corrChips = await evalJS(`(() => {
  const txt = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify(txt);
})()`).then(JSON.parse);
check('★ the category chips render the enum in Arabic (مشروع / داخلي / خارجي)',
  ['مشروع', 'داخلي', 'خارجي'].every(w => corrChips.includes(w)),
  corrChips.filter(Boolean).slice(0, 14).join(' | '));
check('★ the priority chips render the enum in Arabic (عاجلة / عالية / متوسطة / منخفضة)',
  ['عاجلة', 'عالية', 'متوسطة', 'منخفضة'].every(w => corrChips.includes(w)),
  corrChips.filter(Boolean).slice(0, 14).join(' | '));
// ★ The action chips (None / For info / SR for approval / Action needed) were
// missed by this task's first pass and found by LOOKING at the screenshot, not
// by any assertion — they are an inline `as const` array in the JSX, invisible
// to [A7]'s scan of types.ts. Named explicitly here for that reason.
check('★ the action chips render the enum in Arabic (للعلم / مطلوب إجراء)',
  ['للعلم', 'مطلوب إجراء'].every(w => corrChips.includes(w)),
  corrChips.filter(Boolean).slice(0, 20).join(' | '));
check('★ no chip on the correspondence form is still a Latin enum value',
  !corrChips.some(x => /^(Project|Internal|External|Other\.\.\.|Urgent|High|Medium|Low|Unread|Reviewing|Assigned|Closed|None|For info|SR for approval|Action needed)$/.test(x)),
  corrChips.filter(x => /[A-Za-z]{3}/.test(x)).join(' | '));

// ★ The bidi trap this chip exists for, re-proved. Found originally by LOOKING
// at i18nrtl-corr-modal-ar.png: "Other..." painted as "...Other", because the
// trailing dots are bidi-NEUTRAL and take the paragraph's direction.
//
// Under `ar` the chip now reads "أخرى..." — Arabic, so the dots already sit
// correctly and .ltr-data would be the WRONG class for it (it would force the
// word into a left-to-right run). `bidiClassFor` is what makes that choice, so
// this asserts BOTH halves: the Arabic chip is isolated-but-not-forced, and a
// chip still carrying a Latin value keeps the original .ltr-data protection.
const chipClass = await evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'أخرى...');
  if (!b) return JSON.stringify({ err: 'arabic Other chip not rendered' });
  return JSON.stringify({ cls: b.className, dir: getComputedStyle(b).direction, bidi: getComputedStyle(b).unicodeBidi });
})()`).then(JSON.parse);
check('★ the Arabic "أخرى..." chip is isolated but NOT forced left-to-right',
  chipClass.cls === 'bidi-isolate' && chipClass.dir === 'rtl' && /isolate/.test(chipClass.bidi),
  JSON.stringify(chipClass));

// Same chip, forced back to the Latin value + the Latin class: the original
// defect and its fix, still measured on GLYPHS rather than on textContent.
const latinChip = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.dataset.bidiProbe === '1');
  if (!b) return JSON.stringify({ err: 'probe chip missing' });
  const n = [...b.childNodes].find(x => x.nodeType === 3);
  const r = document.createRange();
  r.setStart(n, 0); r.setEnd(n, 1);
  const first = r.getBoundingClientRect();
  r.setStart(n, n.textContent.length - 1); r.setEnd(n, n.textContent.length);
  const last = r.getBoundingClientRect();
  return JSON.stringify({ firstLeft: Math.round(first.left), lastLeft: Math.round(last.left),
                          dir: getComputedStyle(b).direction });
})()`;
await evalJS(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'أخرى...');
  b.dataset.bidiProbe = '1'; b.textContent = 'Other...'; b.className = 'ltr-data';
})()`);
await sleep(120);
const chipRtl = JSON.parse(await evalJS(latinChip));
check('★ a Latin "Other..." chip still keeps its dots at the END in RTL',
  chipRtl.firstLeft < chipRtl.lastLeft && chipRtl.dir === 'ltr', JSON.stringify(chipRtl));
await evalJS(`[...document.querySelectorAll('button.ltr-data')].forEach(e => { e.style.unicodeBidi = 'normal'; e.style.direction = 'inherit'; })`);
await sleep(120);
const chipBroken = JSON.parse(await evalJS(latinChip));
check('non-vacuous: without the isolation the dots jump to the front',
  chipBroken.firstLeft > chipBroken.lastLeft, JSON.stringify(chipBroken));
await evalJS(`[...document.querySelectorAll('button.ltr-data')].forEach(e => { e.style.unicodeBidi = ''; e.style.direction = ''; })`);

await evalJS(`window.__setLang('en')`);
await sleep(400);
const corrEn = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.input-label')].map(l => (l.textContent || '').trim());
  const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, btns });
})()`).then(JSON.parse);
check('non-vacuous: the same correspondence form reads English under en',
  corrEn.labels.includes('Subject') && corrEn.btns.some(b => b === 'Create Corresponding'),
  corrEn.labels.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('corr-modal-ar');
await clickEl(`[...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);

// ── [C5b] "Group by (X)" is a GRID of group cards here too ──────────────────
// Group-by queue task 2 of the GRID rollout (2026-08-26): the intake board no
// longer stacks a section per bucket, it paints ONE CARD PER BUCKET (the group's
// name + a summary of what is inside) and the correspondence rows appear only
// after a card is clicked. Every assertion reads the PAINTED cards after a REAL
// click on the segmented control — "the same rows, arranged differently" is the
// whole feature, and a props-level test would prove nothing about it.
console.log('\n[C5b] the correspondences group-by GRID + drill-in (grid task 2)');
const corrGroupBar = await evalJS(`(() => {
  const g = document.querySelector('#root [role="group"][aria-label]');
  if (!g) return JSON.stringify({ err: 'no group-by bar' });
  return JSON.stringify({ aria: g.getAttribute('aria-label'),
    opts: [...g.querySelectorAll('button')].map(b => (b.textContent || '').trim()),
    pressed: [...g.querySelectorAll('button[aria-pressed="true"]')].map(b => (b.textContent || '').trim()) });
})()`).then(JSON.parse);
check('the group-by bar renders its five dimensions in Arabic',
  ['الحالة', 'الفئة', 'الموقع', 'الجهة المرسِلة', 'المسؤول'].every(o => (corrGroupBar.opts || []).includes(o)),
  JSON.stringify(corrGroupBar));
check('★ "الحالة" is the pressed default', (corrGroupBar.pressed || [])[0] === 'الحالة', JSON.stringify(corrGroupBar.pressed));

// ⚠ `root.render` re-renders the SAME CorrespondingsDashboard instance, so an
// earlier block could have left a card open — back out before reading the grid.
const corrBackToGrid = async () => {
  const has = await evalJS(`(() => { ${HELPERS} return !!window.__one('button', ${JSON.stringify(ar['All Groups'])}); })()`);
  if (!has) return false;
  await clickEl(`window.__one('button', ${JSON.stringify(ar['All Groups'])})`, 'back to the group grid');
  await sleep(420);
  return true;
};
await corrBackToGrid();

const corrCards = () => evalJS(
  `JSON.stringify([...document.querySelectorAll('#root button[data-group-card]')].map(b => (b.innerText || '').trim().replace(/\\s+/g, ' ')))`,
).then(JSON.parse);
// Rows are counted by the serial they paint, not by `.card`: the manager
// workload panel is a `.card` too and would inflate every count.
const corrRows = () => evalJS(
  `((document.getElementById('root').innerText || '').match(/CR0000\\d/g) || []).length`,
);
const corrPickDim = async (labelAr) => {
  await clickEl(`[...document.querySelectorAll('#root [role="group"][aria-label] button')].find(b => (b.textContent||'').trim() === ${JSON.stringify(labelAr)})`, `group by ${labelAr}`);
  await sleep(420);
  return corrCards();
};

const corrStatusCards = await corrCards();
check('★ the board OPENS on the grid — cards, and not one correspondence row',
  corrStatusCards.length === 3 && (await corrRows()) === 0,
  `${corrStatusCards.length} cards / ${await corrRows()} rows`);
// Only three of the four statuses are seeded, and an empty bucket is dropped —
// so this also proves the fixed order is the INTAKE workflow, not alphabetical.
check('★ by status: one card per bucket, in WORKFLOW order (not alphabetical)',
  corrStatusCards[0].includes(ar['Unread']) && corrStatusCards[1].includes(ar['Assigned']) && corrStatusCards[2].includes(ar['Closed']),
  corrStatusCards.join(' | '));
// Grouping BY status already names the status in the title, so repeating the
// breakdown chips under it would be noise — the card omits them on purpose.
check('★ a status card carries its count but NOT a status breakdown',
  corrStatusCards.every(c => c.includes(ar['correspondence']) || c.includes(ar['correspondences']))
  && !corrStatusCards[2].includes(ar['Unread']),
  corrStatusCards[2]);

const corrSenderCards = await corrPickDim('الجهة المرسِلة');
check('★ by sender: the cards became the senders, titled with the bare NAME',
  corrSenderCards.length === 3
  && corrSenderCards.some(c => c.startsWith('EGPC')) && corrSenderCards.some(c => c.startsWith('Stores'))
  // The "من {{name}}" framing belongs on the drilled-in section header.
  && !corrSenderCards.some(c => c.startsWith('من '))
  // …and the status buckets are gone.
  && !corrSenderCards.some(c => c.startsWith(ar['Closed'])),
  corrSenderCards.join(' | '));
check('★ each card summarises what is INSIDE it (count + the status breakdown)',
  corrSenderCards.every(c => c.includes(ar['Unread']) && c.includes(ar['Assigned']) && c.includes(ar['Closed'])),
  corrSenderCards[0]);

// The location dimension is the one with no field of its own: it is resolved
// through the record link `projectId` → projects/{id}.location. Only c-a carries
// a project, so this also proves the UNGROUPED bucket sorts LAST.
const corrLocationCards = await corrPickDim('الموقع');
check('★ by location: resolved through the linked project (only c-a has one)',
  corrLocationCards.some(c => c.startsWith('Alexandria')) && corrLocationCards.some(c => c.startsWith('بدون موقع')),
  corrLocationCards.join(' | '));
check('★ the "no value" card is LAST, never leading the grid',
  corrLocationCards.findIndex(c => c.startsWith('بدون موقع')) === corrLocationCards.length - 1,
  corrLocationCards.join(' | '));

const corrAssigneeCards = await corrPickDim('المسؤول');
check('★ by assignee: one card per person, titled with the bare NAME',
  corrAssigneeCards.length === 3
  && corrAssigneeCards.some(c => c.includes('Tariq Salama')) && corrAssigneeCards.some(c => c.includes('Ahmed Salem'))
  && !corrAssigneeCards.some(c => c.startsWith(ar['Assigned to {{name}}'].replace('{{name}}', '').trim())),
  corrAssigneeCards.join(' | '));
check('the person’s role is the card subtitle',
  corrAssigneeCards.some(c => c.includes(ar['Manager'])) && corrAssigneeCards.some(c => c.includes(ar['Employee'])),
  corrAssigneeCards.join(' | '));

// ★ The drill-in: the half that makes the grid a navigation and not a dashboard.
// Ahmed Salem owns exactly one of the three seeded correspondences (CR000003).
await clickEl(`[...document.querySelectorAll('#root button[data-group-card]')].find(b => (b.innerText||'').includes('Ahmed Salem'))`, 'the Ahmed Salem card');
await sleep(450);
const corrDrilled = await evalJS(`document.getElementById('root').innerText || ''`);
check('★ clicking a card opens THAT group’s records, and only those',
  (await corrRows()) === 1 && (await corrCards()).length === 0 && corrDrilled.includes('CR000003'),
  `${await corrRows()} rows / ${(await corrCards()).length} cards`);
check('★ the corrDrilled-in list still names the group it came from',
  corrDrilled.includes('مُسندة إلى Ahmed Salem'), corrDrilled.slice(0, 200).replace(/\n/g, ' / '));
check('★ and there is a way back to the grid',
  corrDrilled.includes(ar['All Groups']), corrDrilled.slice(0, 200).replace(/\n/g, ' / '));
await corrBackToGrid();
check('★ back returns to the full grid, unchanged',
  (await corrCards()).length === 3 && (await corrRows()) === 0);

// Non-vacuous: the SAME DOM flipped to English. The bucket KEYS are the stored
// values — only the card's title and chips are translated.
await evalJS(`window.__setLang('en')`);
await sleep(450);
const corrAssigneeEn = await corrCards();
check('non-vacuous: the same cards read English under en',
  corrAssigneeEn.length === 3
  && corrAssigneeEn.some(c => /Unread/.test(c) && /Assigned/.test(c) && /Closed/.test(c))
  && !corrAssigneeEn.some(c => c.includes(ar['Unread'])),
  corrAssigneeEn.join(' | '));
await shot('corr-groupby-en');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await corrPickDim('الحالة');
check('no errors across the group-by grid checks', (await evalJS(`window.__errors.length`)) === 0);

// The archive is the other screen of this pass that owns its own copy.
await evalJS(`window.__mount('archive')`);
await sleep(500);
const archiveAr = await evalJS(`(() => {
  const h1 = document.querySelector('#root h1');
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the Archive heading reads الأرشيف', archiveAr.h1 === 'الأرشيف', archiveAr.h1);
check('the archive stat labels are Arabic (مهام مكتملة)',
  archiveAr.body.includes('مهام مكتملة'), archiveAr.body.slice(0, 160));
check('no errors across the correspondence-flow checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C7] the Opportunities module really renders Arabic (task 6b) ───────────
// Same contract as [C4]/[C5]: mount the real screens, read the PAINTED text,
// click into the modal a user would open, then flip the SAME DOM to English.
console.log('\n[C7] the Opportunities module renders Arabic (task 6b)');
await evalJS(`window.__mount('opps')`);
await sleep(600);

// The stage/sort selects moved behind the `Filters` disclosure in task 4.
await openBoardFilters();
const oppAr = await evalJS(`(() => {
  const h1 = document.querySelector('#root h1');
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', btns, opts, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the Opportunities heading reads الفرص', oppAr.h1 === 'الفرص', oppAr.h1);
check('the create button reads فرصة جديدة', oppAr.btns.some(b => b === 'فرصة جديدة'),
  oppAr.btns.slice(0, 12).join(' | '));
check('the KPI strip is translated (معدل الفوز / قيمة خط الفرص)',
  oppAr.body.includes('معدل الفوز') && oppAr.body.includes('قيمة خط الفرص'), oppAr.body.slice(0, 200));
check('the stage filter <option>s are Arabic (كل المراحل / مُحدَّد)',
  oppAr.opts.some(o => o.t === 'كل المراحل') && oppAr.opts.some(o => o.v === 'Identified' && o.t === 'مُحدَّد'),
  oppAr.opts.slice(0, 12).map(o => `${o.v}=${o.t}`).join(' | '));
// ★★ The stored value must survive translation — same rule the whole layer
// rests on. A bid whose stage got written in Arabic is invisible to every
// filter, alert and analytics bucket in the module.
const oppArabicValues = oppAr.opts.filter(o => /[؀-ۿ]/.test(o.v));
check('★★ no stage <option> VALUE is Arabic — the stored stage stays English',
  oppArabicValues.length === 0, oppArabicValues.map(o => `${o.v} (${o.t})`).join(' | '));
// Grouping IS the grid now (grid task 4), so a bid card — and therefore its
// stage badge — only exists behind a group card. These four helpers are what
// every opportunities block from here down uses to move between the two views.
const oppGridCards = () => evalJS(
  `JSON.stringify([...document.querySelectorAll('#root button[data-group-card]')].map(b => (b.innerText || '').trim().replace(/\\s+/g, ' ')))`,
).then(JSON.parse);
const oppRows = () => evalJS(`document.querySelectorAll('#root .card.card-interactive').length`);
/** Open a bucket by a substring of its card. Defaults to the first card. */
const openOppGroup = async (match) => {
  const finder = match
    ? `[...document.querySelectorAll('#root button[data-group-card]')].find(b => (b.innerText||'').includes(${JSON.stringify(match)}))`
    : `document.querySelector('#root button[data-group-card]')`;
  await clickEl(finder, `the ${match || 'first'} group card`);
  await sleep(420);
};
/** Back out to the grid if a bucket is open; false when it already was. */
const oppBackToGrid = async () => {
  const has = await evalJS(`(() => { ${HELPERS} return !!window.__one('button', ${JSON.stringify(ar['All Groups'])}); })()`);
  if (!has) return false;
  await clickEl(`window.__one('button', ${JSON.stringify(ar['All Groups'])})`, 'back to the bid group grid');
  await sleep(420);
  return true;
};

// The stage badge on the card paints the seeded value through the same layer.
await openOppGroup();
const cardStages = await evalJS(`(() => {
  const spans = [...document.querySelectorAll('#root .card.card-interactive span')].map(s => (s.textContent || '').trim());
  return JSON.stringify(spans.filter(Boolean).slice(0, 40));
})()`).then(JSON.parse);
// ⚠ Non-vacuous on purpose: with the grid showing there are no bid cards at
// all, and "no Latin badge" would pass on an empty array.
check('★ a card stage badge paints the enum in Arabic (مُحدَّد / مُقدَّم / فوز)',
  cardStages.length > 0 && ['مُحدَّد', 'مُقدَّم', 'فوز'].some(w => cardStages.includes(w)),
  cardStages.slice(0, 14).join(' | '));
check('★ no card badge is still a Latin stage value',
  !cardStages.some(x => /^(Identified|Prequalification|Bid Preparation|Submitted|Under Evaluation|Won|Lost|No Bid|Cancelled)$/.test(x)),
  cardStages.filter(x => /[A-Za-z]{3}/.test(x)).join(' | '));
await oppBackToGrid();

// ── [C7b] "Group by (X)" is a GRID of group cards here too ─────────────────
// Grid task 4 (2026-08-26), the last of the four boards. The stacked-section
// version of this block is gone: picking a dimension now paints ONE CARD PER
// BUCKET (its name, what its live bids are worth, and how they split) and the
// bid cards appear only after a card is clicked. Every assertion reads the
// PAINTED cards after a real click.
console.log('\n[C7b] the opportunities group-by GRID + drill-in (grid task 4)');
const oppText = () => evalJS(`document.getElementById('root').innerText || ''`);
const pickOppGroup = async (labelAr) => {
  await clickEl(`[...document.querySelectorAll('#root [role="group"][aria-label] button')].find(b => (b.textContent||'').trim() === ${JSON.stringify(labelAr)})`, `group by ${labelAr}`);
  await sleep(420);
  return oppGridCards();
};
// The bid-card titles are how a bucket's CONTENT is read back once it is
// drilled into — a group card's count says how many, never which.
const oppCardTitles = () => evalJS(`(() => {
  const h = [...document.querySelectorAll('#root .card.card-interactive h3')].map(x => (x.textContent || '').trim());
  return JSON.stringify(h);
})()`).then(JSON.parse);

const oppStageCards = await oppGridCards();
check('★ the board OPENS on the grid — group cards, and not one bid card',
  oppStageCards.length === 3 && (await oppRows()) === 0,
  `${oppStageCards.length} cards / ${await oppRows()} bid cards`);
check('★ by stage: one card per bucket, in PIPELINE order (not alphabetical)',
  oppStageCards[0].includes('مُحدَّد') && oppStageCards[1].includes('مُقدَّم') && oppStageCards[2].includes('فوز'),
  oppStageCards.join(' | '));
// Grouping BY stage already names the stage on the card, so repeating the
// live/won/lost breakdown under it would be noise — the card omits it.
check('★ a stage card carries its count but NOT an outcome breakdown',
  oppStageCards.every(c => c.includes(ar['opportunities']) || c.includes(ar['opportunity']))
  && !oppStageCards[0].includes('فوز'),
  oppStageCards[0]);

// ★ The drill-in: this is the half that makes the grid a navigation and not a
// dashboard. 'مُحدَّد' holds exactly o-a.
await openOppGroup('مُحدَّد');
const oppIdentified = await oppCardTitles();
check('★ clicking a card opens THAT bucket’s bids, and only those',
  oppIdentified.length === 1 && (await oppGridCards()).length === 0,
  `${oppIdentified.length} bid cards / ${(await oppGridCards()).length} group cards`);
const oppDrilled = await oppText();
check('★ the drilled-in list still names the bucket it came from',
  oppDrilled.includes('فرص: مُحدَّد'), oppDrilled.slice(0, 160).replace(/\n/g, ' / '));
check('★ and there is a way back to the grid',
  oppDrilled.includes(ar['All Groups']), oppDrilled.slice(0, 160).replace(/\n/g, ' / '));
await oppBackToGrid();
check('★ back returns to the full grid, unchanged',
  (await oppGridCards()).length === 3 && (await oppRows()) === 0);

// Like the projects board and unlike tasks/correspondences, an Opportunity OWNS
// its location — no listener, no link to resolve. o-c carries none, which is
// what proves the "no value" bucket sorts LAST.
const oppLocationCards = await pickOppGroup('الموقع');
check('★ by location: read straight off the bid, and the stage buckets are gone',
  oppLocationCards.length === 2 && oppLocationCards[0].includes('Alexandria')
  // The "Location: {{name}}" framing belongs on the drilled-in section header,
  // not under the icon that already says what kind of card this is.
  && !oppLocationCards.some(c => c.includes('موقع:')),
  oppLocationCards.join(' | '));
check('★ the "no location" card is LAST, never leading the grid',
  oppLocationCards[1].includes('بدون موقع'), oppLocationCards.join(' | '));
check('★ each card summarises what is INSIDE it (live / won / lost)',
  oppLocationCards.every(c => c.includes(ar['live']) && c.includes('فوز') && c.includes('خسارة')),
  oppLocationCards[0]);
// ★★ A bid board's summary is MONEY. "2 opportunities" tells a bid manager
// nothing; the subtitle is what the bucket's still-open bids are worth, and it
// must survive the RTL flip as digits-then-currency, not "EGP 37.5M".
check('★★ a card says what its live bids are WORTH, not just how many',
  /37\.5M EGP/.test(oppLocationCards[0]) && oppLocationCards[0].includes(ar['{{value}} open'].replace('{{value}} ', '')),
  oppLocationCards[0]);
// o-a and o-b are both still open and both past their submission deadline, so
// the bucket that holds them is the one that must be badged.
check('★ a bucket whose open bids missed the deadline is badged, the closed one is not',
  oppLocationCards[0].includes(ar['OVERDUE']) && !oppLocationCards[1].includes(ar['OVERDUE']),
  oppLocationCards.join(' | '));

// ★ The in-bucket order is the board's OWN sort select — this board has one, so
// the grouping deliberately forces no order of its own. The Alexandria bucket
// holds two bids: o-a is due first, o-b is worth twice as much.
await openOppGroup('Alexandria');
const alexByDeadline = await oppCardTitles();
check('★ inside a bucket the default "Submission deadline" sort still rules',
  alexByDeadline.length === 2 && alexByDeadline[0].startsWith('EGPC turnaround'),
  alexByDeadline.slice(0, 3).join(' | '));
await openBoardFilters();
await evalJS(`(() => {
  const sel = [...document.querySelectorAll('#root select')].find(s => [...s.options].some(o => o.value === 'value'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'value');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(320);
const alexByValue = await oppCardTitles();
check('★★ switching the sort to "Value (high → low)" reorders INSIDE the open bucket',
  !alexByValue[0].startsWith('EGPC turnaround') && alexByValue[1].startsWith('EGPC turnaround'),
  alexByValue.slice(0, 3).join(' | '));
await evalJS(`(() => {
  const sel = [...document.querySelectorAll('#root select')].find(s => [...s.options].some(o => o.value === 'value'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'deadline');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(320);
await oppBackToGrid();

// The source enum goes through the SAME display layer as the stage badge — a
// card titled "Public Tender" would mean the layer was bypassed.
const oppSourceCards = await pickOppGroup('المصدر');
check('★ by source: the enum is painted through the display layer, not raw',
  oppSourceCards.length === 3
  && oppSourceCards.some(c => c.includes('مناقصة عامة')) && oppSourceCards.some(c => c.includes('اتفاقية إطارية'))
  && !oppSourceCards.some(c => /(Public Tender|Framework)/.test(c)),
  oppSourceCards.join(' | '));
check('★ the "no source" card is LAST', oppSourceCards[2].includes('بدون مصدر'),
  oppSourceCards.join(' | '));

// ★ Unlike a project, an Opportunity STORES `ownerName` beside `ownerId`, so the
// bucket key needs no user lookup — but the FACE on the card still does, and it
// is resolved through `ownerId`, never by matching the display name.
const oppOwnerCards = await pickOppGroup('المسؤول');
check('★ by owner: the stored ownerName is the bucket, one card per person',
  oppOwnerCards.length === 3
  && oppOwnerCards.some(c => c.includes('Tariq Salama')) && oppOwnerCards.some(c => c.includes('Nevin Anwar'))
  && oppOwnerCards.some(c => c.includes('Ahmed Salem')),
  oppOwnerCards.join(' | '));
check('★★ no card leaked a raw uid', !/u-(mgr|emp1|emp2)/.test(oppOwnerCards.join(' ')),
  (oppOwnerCards.join(' ').match(/u-\w+/g) || []).join(' | '));

// Non-vacuous: the SAME DOM, flipped — the group keys are the stored values,
// only the card title is translated.
await evalJS(`window.__setLang('en')`);
await sleep(450);
const oppOwnerCardsEn = await oppGridCards();
check('non-vacuous: the same cards read English under en',
  oppOwnerCardsEn.length === 3
  && oppOwnerCardsEn.some(c => /opportunit/.test(c) && /Won/.test(c) && /live/.test(c))
  && !oppOwnerCardsEn.some(c => c.includes(ar['live'])),
  oppOwnerCardsEn.join(' | '));
await shot('opps-groupby-en');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await pickOppGroup('المرحلة');
check('no errors across the opportunities group-by checks', (await evalJS(`window.__errors.length`)) === 0);

// Into the create modal — a real click on the button a user presses.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'فرصة جديدة')`, 'New Opportunity');
await sleep(500);
const oppModal = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.modal label > span')].map(l => (l.textContent || '').trim());
  const ph = [...document.querySelectorAll('.modal input, .modal textarea')].map(i => i.placeholder).filter(Boolean);
  const btns = [...document.querySelectorAll('.modal button')].map(b => (b.textContent || '').trim());
  const h2 = document.querySelector('.modal h2');
  return JSON.stringify({ labels, ph, btns, h2: h2 ? h2.textContent.trim() : '' });
})()`).then(JSON.parse);
check('the opportunity form heading reads فرصة جديدة', oppModal.h2 === 'فرصة جديدة', oppModal.h2);
check('the form labels are Arabic (العميل / القطاع / المرحلة)',
  ['العميل', 'القطاع', 'المرحلة'].every(w => oppModal.labels.includes(w)),
  oppModal.labels.slice(0, 12).join(' | '));
check('the submit button reads إنشاء الفرصة', oppModal.btns.some(b => b === 'إنشاء الفرصة'),
  oppModal.btns.slice(-4).join(' | '));
// A floor of t() calls can be met with a whole section still English.
const oppLatin = oppModal.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no opportunity-form label is still English', oppLatin.length === 0, oppLatin.join(' | '));

await evalJS(`window.__setLang('en')`);
await sleep(450);
const oppEn = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.modal label > span')].map(l => (l.textContent || '').trim());
  const btns = [...document.querySelectorAll('.modal button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ labels, btns });
})()`).then(JSON.parse);
check('non-vacuous: the same opportunity form reads English under en',
  oppEn.labels.includes('Client') && oppEn.btns.some(b => b === 'Create opportunity'),
  oppEn.labels.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await shot('opps-modal-ar');
await clickEl(`[...document.querySelectorAll('.modal button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);

// ── the detail page and its three tabs ──────────────────────────────────────
// Two thirds of this pass's copy lives behind a card click: the follow-ups,
// bid-gates and outcome tabs are separate components, and a floor of t() calls
// on the list page says nothing about them.
// Grid task 4: a bid card lives behind a group card now. The board is grouped
// by stage and 'مُحدَّد' holds o-a — a bid with a linked correspondence, which
// the "Linked records" checks further down need.
await openOppGroup('مُحدَّد');
await clickEl(`document.querySelector('#root .card.card-interactive')`, 'open a bid');
await sleep(600);
const detail = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the detail tab bar is Arabic (المتابعات / المراحل / النتيجة)',
  ['المتابعات', 'المراحل', 'النتيجة'].every(w => detail.btns.includes(w)),
  detail.btns.slice(0, 14).join(' | '));
check('the back / edit buttons read كل الفرص and تعديل الفرصة',
  detail.btns.includes('كل الفرص') && detail.btns.includes('تعديل الفرصة'),
  detail.btns.slice(0, 8).join(' | '));
check('the follow-ups tab opens in Arabic (آخر متابعة / نشر المتابعة)',
  detail.body.includes('آخر متابعة') && detail.btns.includes('نشر المتابعة'),
  detail.body.slice(0, 200));
check('the headline metrics are Arabic (القيمة التقديرية / احتمالية الفوز)',
  detail.body.includes('القيمة التقديرية') && detail.body.includes('احتمالية الفوز'),
  detail.body.slice(0, 240));

// ★★ Money is "12,500,000 EGP": digits, a NEUTRAL space, then a Latin word. In
// an RTL paragraph that space takes the paragraph direction and the two halves
// swap — the tile painted "EGP 12,500,000". textContent still reads correctly,
// so only the glyph positions can see it (the serial-number trap again).
const moneyOrder = await evalJS(`(() => {
  const el = [...document.querySelectorAll('#root .ltr-data, #root .bidi-isolate')]
    .find(e => /^[\\d,]+ [A-Z]{3}$/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no money value rendered' });
  const n = [...el.childNodes].find(x => x.nodeType === 3);
  const r = document.createRange();
  const txt = n.textContent;
  r.setStart(n, 0); r.setEnd(n, 1);
  const firstDigit = r.getBoundingClientRect();
  r.setStart(n, txt.length - 1); r.setEnd(n, txt.length);
  const lastLetter = r.getBoundingClientRect();
  return JSON.stringify({ text: txt, digitLeft: Math.round(firstDigit.left), letterLeft: Math.round(lastLetter.left),
                          dir: getComputedStyle(el).direction });
})()`).then(JSON.parse);
check('★★ a money value keeps its digits in front of the currency code in RTL',
  moneyOrder.digitLeft < moneyOrder.letterLeft && moneyOrder.dir === 'ltr', JSON.stringify(moneyOrder));
// Non-vacuous: strip the isolation and the currency code really does jump.
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = 'normal'; e.style.direction = 'inherit'; })`);
await sleep(120);
const moneyBroken = JSON.parse(await evalJS(`(() => {
  const el = [...document.querySelectorAll('#root .ltr-data')].find(e => /^[\\d,]+ [A-Z]{3}$/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no money value rendered' });
  const n = [...el.childNodes].find(x => x.nodeType === 3);
  const r = document.createRange(); const txt = n.textContent;
  r.setStart(n, 0); r.setEnd(n, 1);
  const d = r.getBoundingClientRect();
  r.setStart(n, txt.length - 1); r.setEnd(n, txt.length);
  const l = r.getBoundingClientRect();
  return JSON.stringify({ digitLeft: Math.round(d.left), letterLeft: Math.round(l.left) });
})()`));
check('non-vacuous: without the isolation the currency code jumps in front',
  moneyBroken.digitLeft > moneyBroken.letterLeft, JSON.stringify(moneyBroken));
await evalJS(`[...document.querySelectorAll('#root .ltr-data')].forEach(e => { e.style.unicodeBidi = ''; e.style.direction = ''; })`);

// ── cross-linking task 3: the Tasks tab ─────────────────────────────────────
// No seeded task carries an `opportunityId`, so this is the EMPTY state — which
// is the half a floor of t() calls is least likely to cover.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'المهام')`, 'Tasks tab');
await sleep(450);
const bidTasks = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the bid Tasks tab is Arabic (العمل على هذا العطاء / مهمة جديدة لهذا العطاء)',
  bidTasks.body.includes('العمل على هذا العطاء') && bidTasks.btns.includes('مهمة جديدة لهذا العطاء'),
  bidTasks.body.slice(0, 200));
check('its EMPTY state is Arabic too',
  bidTasks.body.includes('لا يوجد عمل جارٍ على هذا العطاء'), bidTasks.body.slice(0, 240));
const bidTasksLatin = bidTasks.btns.filter(b => /^(New task for this bid|Tasks)$/.test(b));
check('★ nothing on the bid Tasks tab is still English', bidTasksLatin.length === 0, bidTasksLatin.join(' | '));

// ── cross-linking task 6: the reverse "Linked records" panel on the bid ─────
// The overview tab is where a bid says what is attached to it. Each seeded
// correspondence carries the bid of its own index, so whichever card [C7]
// opened has exactly one linked email — the POPULATED state, not the empty one.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'نظرة عامة')`, 'Overview tab');
await sleep(450);
const bidLinks = await evalJS(`(() => {
  const body = document.getElementById('root').innerText || '';
  const serials = [...document.querySelectorAll('#root .ltr-data')].map(x => (x.textContent || '').trim());
  return JSON.stringify({ body, serials });
})()`).then(JSON.parse);
check('the bid overview carries the Linked Records panel in Arabic (السجلات المرتبطة)',
  bidLinks.body.includes('السجلات المرتبطة'), bidLinks.body.slice(0, 240));
check('★ it is POPULATED: the linked correspondence group and its serial are painted',
  /المراسلات \(1\)/.test(bidLinks.body) && bidLinks.serials.some(x => /^CR0000\d+$/.test(x)),
  bidLinks.serials.slice(0, 8).join(' | '));
check('★ the count is painted ONCE, in the group heading — no second summary sentence',
  (bidLinks.body.match(/المراسلات \(/g) || []).length === 1 && !/·\s*\d+\s*مهمة/.test(bidLinks.body),
  bidLinks.body.slice(0, 300));
await shot('bid-linked-ar');
check('★ the bid panel points at the Tasks tab instead of listing the same rows twice',
  bidLinks.body.includes('المهام المرتبطة بهذا العطاء معروضة في تبويب المهام الخاص به.'),
  bidLinks.body.slice(0, 400));

await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'المراحل')`, 'Milestones tab');
await sleep(450);
const gates = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the bid-gates tab is Arabic (بوابات العطاء / إضافة بوابة)',
  gates.body.includes('بوابات العطاء') && gates.btns.includes('إضافة بوابة'),
  gates.body.slice(0, 200));
check('the seed-gates button is Arabic', gates.btns.some(b => b === 'إضافة بوابات العطاء القياسية'),
  gates.btns.slice(0, 10).join(' | '));

await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'النتيجة')`, 'Outcome tab');
await sleep(450);
const outcome = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the outcome tab is Arabic (النتيجة والتقييم / تسجيل النتيجة)',
  outcome.body.includes('النتيجة والتقييم') && outcome.btns.includes('تسجيل النتيجة'),
  outcome.body.slice(0, 200));
// ★ The reason chips are OPPORTUNITY_REASON_OPTIONS painted through the display
// label — the same shape as the correspondence action chips that task 5's first
// pass missed entirely.
check('★ the win/loss reason chips paint the enum in Arabic (السعر مرتفع / التقييم الفني)',
  outcome.btns.includes('السعر مرتفع') && outcome.btns.includes('التقييم الفني'),
  outcome.btns.slice(0, 16).join(' | '));
const outcomeLatin = outcome.btns.filter(b =>
  /^(Won|Lost|No Bid|Cancelled|Price too high|Technical evaluation|Local content|Commercial terms|Scope mismatch|Save changes|Record outcome|Cancel|Edit)$/.test(b));
check('★ no outcome-tab chip or button is still English', outcomeLatin.length === 0, outcomeLatin.join(' | '));
await shot('opps-detail-ar');

await evalJS(`window.__setLang('en')`);
await sleep(450);
const outcomeEn = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify(btns);
})()`).then(JSON.parse);
check('non-vacuous: the same outcome tab reads English under en',
  outcomeEn.includes('Record outcome') && outcomeEn.includes('Price too high'),
  outcomeEn.slice(0, 12).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);

// The analytics page owns the other half of this pass's copy — and it is the
// only screen in the app whose month labels are localized (a month NAME is
// language-carrying, unlike the numeric dates everywhere else).
await evalJS(`window.__mount('bidanalytics')`);
await sleep(700);
const anaAr = await evalJS(`(() => {
  const h1 = document.querySelector('#root h1');
  const th = [...document.querySelectorAll('#root th')].map(x => (x.textContent || '').trim());
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', th, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the Bid Analytics heading reads تحليلات العطاءات', anaAr.h1 === 'تحليلات العطاءات', anaAr.h1);
check('the analytics KPI labels are Arabic (معدل الفوز / خط الفرص المفتوح)',
  anaAr.body.includes('معدل الفوز') && anaAr.body.includes('خط الفرص المفتوح'), anaAr.body.slice(0, 200));
check('the analytics card titles are Arabic (خط الفرص المفتوح حسب المرحلة / لماذا نخسر)',
  anaAr.body.includes('خط الفرص المفتوح حسب المرحلة') && anaAr.body.includes('لماذا نخسر'),
  anaAr.body.slice(0, 300));
const anaLatinTh = anaAr.th.filter(x => /[A-Za-z]{3}/.test(x));
check('★ no decided-bids table header is still English', anaLatinTh.length === 0, anaAr.th.join(' | '));

// ★★ The defect no assertion on this page could see and the clip scan misses
// (nothing clips — the labels simply DRAW OVER each other): `ar-EG` month names
// are 5–7 glyphs, the trend axis packs 14 nowrap columns, and "أغسطس 25سبتمبر
// 25أكتوبر" was the result. Measured as overlap, not as text.
// ⚠ Measure the GLYPHS, not the element: `.oa-col-label` is a flex item, so it
// is blockified and its own rect is the column's width — the text spills out of
// it invisibly. A Range over the text node is what actually sees the painted
// run (the same trick the serial-number and "Other..." checks use).
const axisOverlap = await evalJS(`(() => {
  const els = [...document.querySelectorAll('#root .oa-col-label')].filter(e => (e.textContent || '').trim());
  if (els.length < 2) return JSON.stringify({ n: els.length, overlaps: [] });
  const rects = els.map(e => {
    const n = [...e.childNodes].find(x => x.nodeType === 3);
    const r = document.createRange();
    r.selectNodeContents(n || e);
    const box = r.getBoundingClientRect();
    return { t: (e.textContent || '').trim(), left: box.left, right: box.right };
  }).sort((a, b) => a.left - b.left);
  const overlaps = [];
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].left < rects[i - 1].right - 0.5) overlaps.push(rects[i - 1].t + ' / ' + rects[i].t);
  }
  return JSON.stringify({ n: els.length, overlaps });
})()`).then(JSON.parse);
check('★ the trend axis has enough columns to be worth measuring', axisOverlap.n >= 10, String(axisOverlap.n));
check('★★ no two month labels on the trend axis overlap in Arabic',
  axisOverlap.overlaps.length === 0, axisOverlap.overlaps.slice(0, 4).join(' | '));

await evalJS(`window.__setLang('en')`);
await sleep(500);
const anaEn = await evalJS(`(() => {
  const h1 = document.querySelector('#root h1');
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('non-vacuous: the same analytics page reads English under en',
  anaEn.h1 === 'Bid Analytics' && anaEn.body.includes('Win rate'), anaEn.h1);
await evalJS(`window.__setLang('ar')`);
await sleep(400);
await shot('bid-analytics-ar');
check('no errors across the opportunities checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C8] the Projects module really renders Arabic (task 6c) ────────────────
// Same contract as [C4]/[C5]/[C7]. Most of this pass's copy lives behind a card
// click and then behind three more tab clicks, so a t() floor on the list page
// says nothing about the four tabs — this walks all of them.
console.log('\n[C8] the Projects module renders Arabic (task 6c)');
await evalJS(`window.__mount('projects')`);
await sleep(650);

// The status/sort selects moved behind the `Filters` disclosure in task 4.
await openBoardFilters();
const projAr = await evalJS(`(() => {
  const h1 = document.querySelector('#root h1');
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', btns, opts, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the Projects heading reads المشروعات', projAr.h1 === 'المشروعات', projAr.h1);
check('the create button reads مشروع جديد', projAr.btns.some(b => b === 'مشروع جديد'),
  projAr.btns.slice(0, 12).join(' | '));
check('the status tiles are Arabic (الإجمالي / معلّق / مكتمل)',
  ['الإجمالي', 'معلّق', 'مكتمل'].every(w => projAr.body.includes(w)), projAr.body.slice(0, 200));
check('the status filter <option>s are Arabic (كل الحالات / نشط)',
  projAr.opts.some(o => o.t === 'كل الحالات') && projAr.opts.some(o => o.v === 'Active' && o.t === 'نشط'),
  projAr.opts.slice(0, 10).map(o => `${o.v}=${o.t}`).join(' | '));
// ★★ The same rule the whole layer rests on: a project whose status got written
// in Arabic is invisible to the filter, the tiles and OverviewDashboard.
const projArabicValues = projAr.opts.filter(o => /[؀-ۿ]/.test(o.v));
check('★★ no status <option> VALUE is Arabic — the stored status stays English',
  projArabicValues.length === 0, projArabicValues.map(o => `${o.v} (${o.t})`).join(' | '));
// Grouping IS the grid now (grid task 3), so a project card — and therefore its
// status badge — only exists behind a group card. These three helpers are what
// every project block from here down uses to move between the two views.
const projGridCards = () => evalJS(
  `JSON.stringify([...document.querySelectorAll('#root button[data-group-card]')].map(b => (b.innerText || '').trim().replace(/\s+/g, ' ')))`,
).then(JSON.parse);
const projRows = () => evalJS(`document.querySelectorAll('#root .card.card-interactive').length`);
/** Open a bucket by a substring of its card. Defaults to the first card. */
const openProjGroup = async (match) => {
  const finder = match
    ? `[...document.querySelectorAll('#root button[data-group-card]')].find(b => (b.innerText||'').includes(${JSON.stringify(match)}))`
    : `document.querySelector('#root button[data-group-card]')`;
  await clickEl(finder, `the ${match || 'first'} group card`);
  await sleep(420);
};
/** Back out to the grid if a bucket is open; false when it already was. */
const projBackToGrid = async () => {
  const has = await evalJS(`(() => { ${HELPERS} return !!window.__one('button', ${JSON.stringify(ar['All Groups'])}); })()`);
  if (!has) return false;
  await clickEl(`window.__one('button', ${JSON.stringify(ar['All Groups'])})`, 'back to the project group grid');
  await sleep(420);
  return true;
};

await openProjGroup();
const projLatinBadges = await evalJS(`(() => {
  const spans = [...document.querySelectorAll('#root .card.card-interactive .badge')].map(s => (s.textContent || '').trim());
  return JSON.stringify(spans.filter(Boolean));
})()`).then(JSON.parse);
check('★ no project card badge is still a Latin status value',
  projLatinBadges.length > 0
  && !projLatinBadges.some(x => /^(Active|On Hold|Completed|Cancelled)$/.test(x)), projLatinBadges.join(' | '));
await projBackToGrid();

// ★★ The defect this pass found by LOOKING: the search icon is placed with
// `insetInlineStart`, so under RTL it crosses to the right — but the room made
// for it was a physical `padding-left`, leaving the placeholder running under
// the icon. Measured as "the padding on the icon's own side is the big one",
// which is false for every physical-padding version of this box.
const searchPad = await evalJS(`(() => {
  const icon = document.querySelector('#root .lucide-search');
  const input = icon && icon.parentElement.querySelector('input');
  if (!icon || !input) return JSON.stringify({ err: 'no search box' });
  const cs = getComputedStyle(input);
  const i = icon.getBoundingClientRect(), b = input.getBoundingClientRect();
  return JSON.stringify({
    iconOnRight: i.left + i.width / 2 > b.left + b.width / 2,
    padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight),
    iconWidth: Math.round(i.width),
  });
})()`).then(JSON.parse);
check("★★ the search box reserves its room on the icon's side, not on a fixed left edge",
  searchPad.iconOnRight === true && searchPad.padRight >= searchPad.iconWidth + 8 && searchPad.padRight > searchPad.padLeft,
  JSON.stringify(searchPad));

// ── [C8b] "Group by (X)" is a GRID of group cards here too ─────────────────
// Grid task 3 (2026-08-26). The stacked-section version of this block is gone:
// picking a dimension now paints ONE CARD PER BUCKET (its name plus a summary
// of what is inside) and the project cards appear only after a card is clicked.
// Every assertion reads the PAINTED cards after a real click — "the same
// projects, arranged differently" is the feature, and a props-level test proves
// nothing about it.
console.log('\n[C8b] the projects group-by GRID + drill-in (grid task 3)');
const projBar = await evalJS(`(() => {
  const g = document.querySelector('#root [role="group"][aria-label]');
  if (!g) return JSON.stringify({ err: 'no group-by bar' });
  return JSON.stringify({ opts: [...g.querySelectorAll('button')].map(b => (b.textContent || '').trim()),
    pressed: [...g.querySelectorAll('button[aria-pressed="true"]')].map(b => (b.textContent || '').trim()) });
})()`).then(JSON.parse);
check('the projects group-by bar renders its four dimensions in Arabic',
  ['الحالة', 'العميل', 'الموقع', 'المسؤول'].every(o => (projBar.opts || []).includes(o)),
  JSON.stringify(projBar));
check('★ "الحالة" is the pressed default', (projBar.pressed || [])[0] === 'الحالة', JSON.stringify(projBar.pressed));

const projText = () => evalJS(`document.getElementById('root').innerText || ''`);
const pickProjGroup = async (labelAr) => {
  await clickEl(`[...document.querySelectorAll('#root [role="group"][aria-label] button')].find(b => (b.textContent||'').trim() === ${JSON.stringify(labelAr)})`, `group by ${labelAr}`);
  await sleep(420);
  return projGridCards();
};
// The project-card titles are how a bucket's CONTENT is read back once it is
// drilled into — a group card's count says how many, never which.
const projCardTitles = () => evalJS(`(() => {
  const h = [...document.querySelectorAll('#root .card.card-interactive h3')].map(x => (x.textContent || '').trim());
  return JSON.stringify(h);
})()`).then(JSON.parse);

const projStatusCards = await projGridCards();
check('★ the board OPENS on the grid — group cards, and not one project card',
  projStatusCards.length === 3 && (await projRows()) === 0,
  `${projStatusCards.length} cards / ${await projRows()} project cards`);
check('★ by status: one card per bucket, in LIFECYCLE order (not alphabetical)',
  projStatusCards[0].includes('نشط') && projStatusCards[1].includes('معلّق') && projStatusCards[2].includes('مكتمل'),
  projStatusCards.join(' | '));
// Grouping BY status already names the status on the card, so repeating the
// three-way breakdown under it would be noise — the card omits it on purpose.
check('★ a status card carries its count but NOT a status breakdown',
  projStatusCards.every(c => c.includes(ar['projects']) || c.includes(ar['project']))
  && !projStatusCards[2].includes('نشط'),
  projStatusCards[2]);

// ★ The drill-in: this is the half that makes the grid a navigation and not a
// dashboard. Two Active projects also make the in-bucket order provable — p-a
// is the newest, p-d ends 15 months earlier.
await openProjGroup('نشط');
const projActiveRecent = await projCardTitles();
check('★ clicking a card opens THAT bucket’s projects, and only those',
  projActiveRecent.length === 2 && (await projGridCards()).length === 0,
  `${projActiveRecent.length} project cards / ${(await projGridCards()).length} group cards`);
const projDrilled = await projText();
check('★ the drilled-in list still names the bucket it came from',
  projDrilled.includes('مشروعات: نشط'), projDrilled.slice(0, 160).replace(/\n/g, ' / '));
check('★ and there is a way back to the grid',
  projDrilled.includes(ar['All Groups']), projDrilled.slice(0, 160).replace(/\n/g, ' / '));
// ★ The in-bucket order is the board's OWN sort select — this board has one, so
// the grouping deliberately does not force an order of its own.
check('★ inside a bucket the default "Most recent" sort still rules (newest first)',
  projActiveRecent[0].startsWith('Meleiha') && projActiveRecent[1].startsWith('Suez refinery jetty'),
  projActiveRecent.slice(0, 3).join(' | '));
await openBoardFilters();
await evalJS(`(() => {
  const sel = [...document.querySelectorAll('#root select')].find(s => [...s.options].some(o => o.value === 'end'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'end');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(320);
const projActiveByEnd = await projCardTitles();
check('★★ switching the sort to "End date (soonest)" reorders INSIDE the open bucket',
  projActiveByEnd[0].startsWith('Suez refinery jetty') && projActiveByEnd[1].startsWith('Meleiha'),
  projActiveByEnd.slice(0, 3).join(' | '));
await evalJS(`(() => {
  const sel = [...document.querySelectorAll('#root select')].find(s => [...s.options].some(o => o.value === 'end'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'recent');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(320);
await projBackToGrid();
check('★ back returns to the full grid, unchanged',
  (await projGridCards()).length === 3 && (await projRows()) === 0);

const projClientCards = await pickProjGroup('العميل');
check('★ by client: the buckets became the clients, and the status buckets are gone',
  projClientCards.length === 3
  && projClientCards.some(c => c.includes('AGIBA')) && projClientCards.some(c => c.includes('EGPC'))
  // The "Client: {{name}}" framing belongs on the drilled-in section header,
  // not under the icon that already says what kind of card this is.
  && !projClientCards.some(c => c.includes('عميل:')),
  projClientCards.join(' | '));
check('★ each card summarises what is INSIDE it (count + the status breakdown)',
  projClientCards.every(c => c.includes('نشط') && c.includes('معلّق') && c.includes('مكتمل')),
  projClientCards[0]);

// Unlike the tasks and correspondences boards, a Project OWNS its location —
// no listener, no link to resolve. p-c carries none, which is what proves the
// "no value" bucket sorts LAST.
const projLocationCards = await pickProjGroup('الموقع');
check('★ by location: read straight off the project, no linked record needed',
  projLocationCards.some(c => c.includes('Alexandria')) && projLocationCards.some(c => c.includes('Suez')),
  projLocationCards.join(' | '));
check('★ the "no location" card is LAST, never leading the grid',
  projLocationCards.length === 3 && projLocationCards[2].includes('بدون موقع'),
  projLocationCards.join(' | '));

// The owner dimension is the one with no name of its own: a project stores only
// `userId`, so the bucket is keyed by the resolved display name.
const projOwnerCards = await pickProjGroup('المسؤول');
check('★ by owner: the creator uid is resolved to a person, one card each',
  projOwnerCards.length === 2
  && projOwnerCards.some(c => c.includes('Tariq Salama')) && projOwnerCards.some(c => c.includes('Nevin Anwar')),
  projOwnerCards.join(' | '));
check('the person’s role is the card subtitle',
  projOwnerCards.some(c => c.includes(ar['Manager'])) && projOwnerCards.some(c => c.includes(ar['Employee'])),
  projOwnerCards.join(' | '));
check('★★ no card leaked a raw uid', !/u-(mgr|emp1|emp2)/.test(projOwnerCards.join(' ')),
  (projOwnerCards.join(' ').match(/u-\w+/g) || []).join(' | '));

// Non-vacuous: the SAME DOM, flipped — the group keys are the stored values,
// only the card title is translated.
await evalJS(`window.__setLang('en')`);
await sleep(450);
const projOwnerCardsEn = await projGridCards();
check('non-vacuous: the same cards read English under en',
  projOwnerCardsEn.length === 2 && projOwnerCardsEn.some(c => /Manager/.test(c) && /Active/.test(c))
  && !projOwnerCardsEn.some(c => c.includes(ar['Manager'])),
  projOwnerCardsEn.join(' | '));
await shot('projects-groupby-en');
await evalJS(`window.__setLang('ar')`);
await sleep(300);
await pickProjGroup('الحالة');
check('no errors across the projects group-by grid checks', (await evalJS(`window.__errors.length`)) === 0);

// Into the create modal.
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'مشروع جديد')`, 'New Project');
await sleep(500);
const projModal = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.modal label > span')].map(l => (l.textContent || '').trim());
  const btns = [...document.querySelectorAll('.modal button')].map(b => (b.textContent || '').trim());
  const h2 = document.querySelector('.modal h2');
  return JSON.stringify({ labels, btns, h2: h2 ? h2.textContent.trim() : '' });
})()`).then(JSON.parse);
check('the project form heading reads مشروع جديد', projModal.h2 === 'مشروع جديد', projModal.h2);
check('the form labels are Arabic (اسم المشروع * / العميل / المشغّل)',
  ['اسم المشروع *', 'العميل', 'المشغّل'].every(w => projModal.labels.includes(w)),
  projModal.labels.slice(0, 12).join(' | '));
check('the submit button reads إنشاء المشروع', projModal.btns.some(b => b === 'إنشاء المشروع'),
  projModal.btns.slice(-4).join(' | '));
const projLatin = projModal.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no project-form label is still English', projLatin.length === 0, projLatin.join(' | '));
await shot('projects-modal-ar');
await clickEl(`[...document.querySelectorAll('.modal button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);

// ── the detail page and its four tabs ───────────────────────────────────────
// Grid task 3: a project card lives behind a group card now. The board is
// grouped by status and 'نشط' is the first bucket, whose newest project is p-a
// — the one every child collection below is keyed to.
await openProjGroup('نشط');
await clickEl(`document.querySelector('#root .card.card-interactive')`, 'open a project');
await sleep(650);
const projDetail = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the project tab bar is Arabic (المتابعة / الماليات / العقود / عقود الباطن)',
  ['المتابعة', 'الماليات', 'العقود', 'عقود الباطن'].every(w => projDetail.btns.includes(w)),
  projDetail.btns.slice(0, 14).join(' | '));
check('the back / edit buttons read كل المشروعات and تعديل المشروع',
  projDetail.btns.includes('كل المشروعات') && projDetail.btns.includes('تعديل المشروع'),
  projDetail.btns.slice(0, 8).join(' | '));
check('the tracking tab opens in Arabic (الحالة الحالية / نشر التحديث / السجل)',
  projDetail.body.includes('الحالة الحالية') && projDetail.btns.includes('نشر التحديث') && projDetail.body.includes('السجل'),
  projDetail.body.slice(0, 240));
// ★ The shared toolbar is a separate component from the tab that renders it —
// its own chrome ("Sort by", the clear button) has to be translated there.
check('★ the shared list toolbar is Arabic (ترتيب حسب)',
  projDetail.body.includes('ترتيب حسب'), projDetail.body.slice(0, 300));
// The composer's status select and the history badges both paint stored values.
const trackOpts = await evalJS(`(() => {
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify(opts);
})()`).then(JSON.parse);
check('★ the tracking status <option>s are Arabic with English VALUES',
  trackOpts.some(o => o.v === 'Active' && o.t === 'نشط') && !trackOpts.some(o => /[؀-ۿ]/.test(o.v)),
  trackOpts.slice(0, 10).map(o => `${o.v}=${o.t}`).join(' | '));

// ── financials: the money tab, and the one that changed an English string ───
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'الماليات')`, 'Financials tab');
await sleep(500);
const fin = await evalJS(`(() => {
  const th = [...document.querySelectorAll('#root th')].map(x => (x.textContent || '').trim()).filter(Boolean);
  const badges = [...document.querySelectorAll('#root .badge')].map(b => (b.textContent || '').trim());
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ th, badges, btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the financials tab is Arabic (السجلات المالية / إضافة سجل)',
  fin.body.includes('السجلات المالية') && fin.btns.includes('إضافة سجل'), fin.body.slice(0, 200));
check('the per-currency rollup is Arabic (الإيرادات / المصروفات / الصافي)',
  ['الإيرادات', 'المصروفات', 'الصافي'].every(w => fin.body.includes(w)), fin.body.slice(0, 260));
const finLatinTh = fin.th.filter(x => /[A-Za-z]{3}/.test(x));
check('★ no financials table header is still English', finLatinTh.length === 0, fin.th.join(' | '));
// ★ The record type is stored lower-case and used to be presented by a CSS
// capitalize, which cannot produce an Arabic word. It goes through the display
// layer now — and the STORED value is still "invoice".
check('★ the record-type badge paints the stored lower-case enum in Arabic (فاتورة / مصروف)',
  fin.badges.some(b => b === 'فاتورة' || b === 'مصروف'), fin.badges.join(' | '));
check('★ no record-type badge is still the raw English enum',
  !fin.badges.some(b => /^(invoice|income|expense|budget|Invoice|Expense)$/.test(b)), fin.badges.join(' | '));

// ★★ Money is "12,500,000 EGP": digits, a NEUTRAL space, a Latin code. Same
// family as the opportunities tile — measured as glyph positions, not text.
const finMoney = await evalJS(`(() => {
  const el = [...document.querySelectorAll('#root .ltr-data, #root .bidi-isolate')]
    .find(e => /^[\\d,]+ [A-Z]{3}$/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no money value rendered' });
  const n = [...el.childNodes].find(x => x.nodeType === 3);
  const r = document.createRange(); const txt = n.textContent;
  r.setStart(n, 0); r.setEnd(n, 1);
  const d = r.getBoundingClientRect();
  r.setStart(n, txt.length - 1); r.setEnd(n, txt.length);
  const l = r.getBoundingClientRect();
  return JSON.stringify({ text: txt, digitLeft: Math.round(d.left), letterLeft: Math.round(l.left), dir: getComputedStyle(el).direction });
})()`).then(JSON.parse);
check('★★ a financials money value keeps its digits in front of the currency code in RTL',
  finMoney.digitLeft < finMoney.letterLeft && finMoney.dir === 'ltr', JSON.stringify(finMoney));

// ── contracts: the tree, its type badges and the deepest form in the app ────
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'العقود')`, 'Contracts tab');
await sleep(500);
const con = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const spans = [...document.querySelectorAll('#root .card span')].map(s => (s.textContent || '').trim()).filter(Boolean);
  return JSON.stringify({ btns, spans, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the contracts tab is Arabic (العقود / إضافة عقد)',
  con.body.includes('العقود') && con.btns.includes('إضافة عقد'), con.body.slice(0, 200));
check('★ the contract-type badge paints the type label in Arabic (عقد / ملحق)',
  con.spans.includes('عقد') || con.spans.includes('ملحق'), con.spans.slice(0, 16).join(' | '));
check('★ no contract-type badge is still English',
  !con.spans.some(x => /^(Contract|Amendment|Agreement|Work Authorization|Sub-Contract)$/.test(x)),
  con.spans.filter(x => /[A-Za-z]{3}/.test(x)).slice(0, 8).join(' | '));
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'إضافة عقد')`, 'Add contract');
await sleep(500);
const conModal = await evalJS(`(() => {
  const labels = [...document.querySelectorAll('.modal label > span')].map(l => (l.textContent || '').trim());
  const opts = [...document.querySelectorAll('.modal option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify({ labels, opts });
})()`).then(JSON.parse);
check('the contract form labels are Arabic (قيمة العقد / أسلوب التعاقد / رقم الملحق)',
  ['قيمة العقد', 'أسلوب التعاقد', 'رقم الملحق'].every(w => conModal.labels.includes(w)),
  conModal.labels.slice(0, 14).join(' | '));
const conLatin = conModal.labels.filter(l => /[A-Za-z]{3}/.test(l));
check('★ no contract-form label is still English', conLatin.length === 0, conLatin.join(' | '));
// ★ The contract type <option> carries the MACHINE value ('sub_contract') —
// translating its label must not touch it.
check('★★ the contract-type <option> values are still the machine enums',
  conModal.opts.some(o => o.v === 'sub_contract' && /[؀-ۿ]/.test(o.t)) &&
  !conModal.opts.some(o => /[؀-ۿ]/.test(o.v)),
  conModal.opts.map(o => `${o.v}=${o.t}`).join(' | '));
await clickEl(`[...document.querySelectorAll('.modal button')].find(b => (b.textContent||'').trim() === 'إلغاء')`, 'Cancel');
await sleep(300);

// ── subcontracts: the validity clock, the one piece of computed Arabic copy ─
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'عقود الباطن')`, 'Subcontracts tab');
await sleep(500);
const sub = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  const opts = [...document.querySelectorAll('#root option')].map(o => ({ v: o.value, t: (o.textContent || '').trim() }));
  return JSON.stringify({ btns, opts, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
check('the subcontracts tab is Arabic (عقود الباطن / إضافة عقد باطن)',
  sub.body.includes('عقود الباطن') && sub.btns.includes('إضافة عقد باطن'), sub.body.slice(0, 200));
check('the validity filter is Arabic (السريان / يقترب انتهاؤه / منتهٍ)',
  sub.opts.some(o => o.t === 'يقترب انتهاؤه') && sub.opts.some(o => o.t === 'منتهٍ'),
  sub.opts.map(o => o.t).slice(0, 12).join(' | '));
// ★ `daysLeftLabel` is module-level, so it had to take `t` as an argument —
// the same move task 5 made for presenceOf/formatRelativeTime. If it did not,
// this line is the only place in the module still painting English.
// ★★ Found by LOOKING, not by an assertion: an ENGLISH free-text paragraph
// inside the RTL page had its trailing full stop dragged to the front —
// ".Full O&M scope including…". Same bidi-neutral rule as "Other..." and the
// serial number, at paragraph scale. textContent is unchanged, so only the
// painted glyph position can see it: the period must be the RIGHTMOST glyph of
// the last line, not the leftmost.
const prosePunct = await evalJS(`(() => {
  const el = [...document.querySelectorAll('#root .card div, #root .card p')]
    .find(e => e.children.length === 0 && /^[A-Za-z][^؀-ۿ]{25,}\\.$/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no english prose block rendered' });
  const n = [...el.childNodes].find(x => x.nodeType === 3);
  const txt = n.textContent;
  const r = document.createRange();
  r.setStart(n, 0); r.setEnd(n, 1);
  const first = r.getBoundingClientRect();
  r.setStart(n, txt.length - 1); r.setEnd(n, txt.length);
  const dot = r.getBoundingClientRect();
  // ⚠ Compare the dot against ITS OWN LINE, not the element box: the paragraph
  // wraps, so the element's left edge says nothing about where the last line
  // starts. A Range over the whole text node yields one rect per line — the
  // last one is the line the dot lives on.
  const whole = document.createRange();
  whole.selectNodeContents(n);
  const rects = [...whole.getClientRects()];
  const line = rects[rects.length - 1];
  return JSON.stringify({
    text: txt.slice(0, 40), dir: getComputedStyle(el).direction, lines: rects.length,
    dotLeft: Math.round(dot.left), lineLeft: Math.round(line.left), lineRight: Math.round(line.right),
    firstLeft: Math.round(first.left),
  });
})()`).then(JSON.parse);
// The dot must sit in the last 20px of its own line (the end), not at its start.
check('★★ an English paragraph keeps its full stop at the END of its line, not dragged to the front',
  prosePunct.dir === 'ltr' && prosePunct.dotLeft > prosePunct.lineRight - 20 && prosePunct.dotLeft > prosePunct.lineLeft + 4,
  JSON.stringify(prosePunct));

check('★ the days-left clock is Arabic, not "N days left"',
  /متبقٍ|متبقيًا|منتهٍ/.test(sub.body) && !/\d+ days? left/.test(sub.body),
  (sub.body.match(/.{0,30}(left|متبق).{0,20}/) || [''])[0]);
await shot('projects-detail-ar');

// Non-vacuous: the same DOM, flipped back to English.
await evalJS(`window.__setLang('en')`);
await sleep(500);
const subEn = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
// ⚠ `innerText` returns the RENDERED text, and `.lc-label` is
// `text-transform: uppercase` — so this reads "SORT BY", not "Sort by". The
// Arabic half of the same check passes either way because Arabic has no case,
// which is exactly how a case-sensitive match hides here.
check('non-vacuous: the same subcontracts tab reads English under en',
  subEn.btns.includes('Add subcontract') && /sort by/i.test(subEn.body),
  subEn.btns.slice(0, 10).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(350);
// ── cross-linking task 6: the project's own "Linked" tab ────────────────────
// The reverse view again, this time WITH tasks: the first seeded task and the
// first seeded correspondence both carry `projectId: 'p-a'`, and [C8] opened
// that project (it is the newest card).
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').trim() === 'المرتبطة')`, 'Linked tab');
await sleep(550);
const prjLinks = await evalJS(`(() => {
  const body = document.getElementById('root').innerText || '';
  const serials = [...document.querySelectorAll('#root .ltr-data')].map(x => (x.textContent || '').trim());
  const badges = [...document.querySelectorAll('#root .badge')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ body, serials, badges });
})()`).then(JSON.parse);
check('the project Linked tab is Arabic (السجلات المرتبطة)',
  prjLinks.body.includes('السجلات المرتبطة'), prjLinks.body.slice(0, 240));
check('★ BOTH groups are populated and Arabic (المراسلات (1) / المهام (1))',
  /المراسلات \(1\)/.test(prjLinks.body) && /المهام \(1\)/.test(prjLinks.body),
  prjLinks.body.slice(0, 400));
check('★ the linked task and correspondence serials are painted as LTR data',
  prjLinks.serials.some(x => /^TK0000\d+$/.test(x)) && prjLinks.serials.some(x => /^CR0000\d+$/.test(x)),
  prjLinks.serials.slice(0, 10).join(' | '));
// The rows paint a STORED status on a page that does not own it — the display
// layer, not a raw enum.
check('★ no linked row badge is still a Latin status value',
  !prjLinks.badges.some(x => /^(Pending|In Progress|Done|Archived|Unread|Reviewing|Assigned|Closed)$/.test(x)),
  prjLinks.badges.join(' | '));
await evalJS(`window.__setLang('en')`);
await sleep(450);
const prjLinksEn = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('#root button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: document.getElementById('root').innerText || '' });
})()`).then(JSON.parse);
// ⚠ `innerText` returns the TRANSFORMED text and the group titles are
// `text-transform: uppercase` — so this reads "CORRESPONDENCES (1)". The Arabic
// half of the same check passes either way, which is exactly how a
// case-sensitive match hides here (the same trap as the subcontracts pass).
check('non-vacuous: the same Linked tab reads English under en',
  prjLinksEn.btns.includes('Linked') && /correspondences \(1\)/i.test(prjLinksEn.body) && /tasks \(1\)/i.test(prjLinksEn.body),
  JSON.stringify({ btns: prjLinksEn.btns.slice(0, 12), body: prjLinksEn.body.slice(0, 400) }));
await evalJS(`window.__setLang('ar')`);
await sleep(350);
await shot('projects-linked-ar');

check('no errors across the projects checks', (await evalJS(`window.__errors.length`)) === 0);

// ── [C9] Overview + Admin render Arabic (task 6c-ii, the last of the queue) ──
// Overview shipped `const t = (s: string) => s;` — an IDENTITY translator. Every
// t('…') in it looked wired and rendered English forever, and no source-level
// floor could ever have caught it, because the calls were all there. Only a
// rendered read can. Same shape as [C4]: assert Arabic, then flip the SAME DOM
// back to English so a hard-coded Arabic string fails too.
console.log('\n[C9] the Overview + Admin screens render Arabic (task 6c-ii)');
await evalJS(`window.__mount('overview')`);
await sleep(700);

const ov = await evalJS(`(() => {
  const root = document.getElementById('root');
  const h1 = root.querySelector('h1');
  const h2s = [...root.querySelectorAll('h2')].map(e => (e.textContent || '').trim());
  const btns = [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', h2s, btns, body: root.innerText || '' });
})()`).then(JSON.parse);
check('the Overview header is Arabic (النظرة العامة)',
  ov.h1 === 'النظرة العامة' && ov.body.includes('إحصاءات لحظية'), `${ov.h1} | ${ov.body.slice(0, 80)}`);
check('the four summary stat cards are Arabic (المراسلات / مهام نشطة / المتأخرة / نسبة الإنجاز)',
  ['المراسلات', 'مهام نشطة', 'المتأخرة', 'نسبة الإنجاز'].every(w => ov.body.includes(w)),
  ov.body.slice(0, 200));
check('the recency feed and its range tabs are Arabic (الوارد اليوم / أمس / هذا الأسبوع)',
  ov.h2s.some(h => h.includes('الوارد اليوم')) &&
  ['اليوم', 'أمس', 'هذا الأسبوع'].every(w => ov.btns.some(b => b === w)),
  ov.h2s.join(' | '));
// ★ The status BUCKET cards paint stored enum values through the display layer.
check('★ the three status cards paint the stored enums in Arabic (قيد الانتظار / قيد التنفيذ / منجزة)',
  ov.h2s.filter(h => /[؀-ۿ]/.test(h)).length >= 3 &&
  !ov.h2s.some(h => /^(Pending|In Progress|Done)$/.test(h)),
  ov.h2s.join(' | '));
const ovLatin = ov.btns.filter(b => /\b(Correspondences|Tasks|Show all|Back to|View Full Details|FULL DETAILS)\b/.test(b));
check('★ no Overview button is still English', ovLatin.length === 0, ovLatin.slice(0, 6).join(' | '));

// ★★ The KPI panel is collapsed by default, and its "N pts" strings are the
// `<number> <LATIN>` family that needed bidi work everywhere else in this queue.
// ⚠ The KPI header sits ~2,500px down the page. `scrollIntoView` inside the
// finder is not enough on its own here — the click is dispatched at VIEWPORT
// coordinates, so the window itself has to be scrolled first and given a frame
// to settle, or `elementFromPoint` returns null and the click lands nowhere.
await evalJS(`(() => {
  const b = [...document.querySelectorAll('#root button')].find(x => (x.textContent||'').includes('مؤشرات أداء الفريق'));
  if (b) window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 200);
  return !!b;
})()`);
await sleep(300);
await clickEl(`[...document.querySelectorAll('#root button')].find(b => (b.textContent||'').includes('مؤشرات أداء الفريق'))`, 'Team KPIs');
await sleep(450);
const kpi = await evalJS(`(() => {
  const root = document.getElementById('root');
  return JSON.stringify({ body: root.innerText || '' });
})()`).then(JSON.parse);
check('★ the team-KPI panel opens in Arabic and its points are not "N pts"',
  /نقطة/.test(kpi.body) && !/\d+\s*pts\b/.test(kpi.body),
  (kpi.body.match(/.{0,30}(pts|نقطة).{0,15}/) || [''])[0]);

// The drill-in: a status card opens the per-assignee view with its own toolbar.
await clickEl(`[...document.querySelectorAll('#root .card')].find(c => (c.textContent||'').includes('المهام المرتبطة'))`, 'a status card');
await sleep(600);
const drill = await evalJS(`(() => {
  const root = document.getElementById('root');
  const btns = [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  const ph = [...root.querySelectorAll('input')].map(i => i.placeholder || '');
  return JSON.stringify({ btns, ph, body: root.innerText || '' });
})()`).then(JSON.parse);
check('the drill-in toolbar is Arabic (رجوع إلى الحالات + the two count tabs)',
  drill.btns.some(b => b === 'رجوع إلى الحالات') &&
  drill.btns.some(b => /^المراسلات \(\d+\)$/.test(b)) &&
  drill.btns.some(b => /^المهام \(\d+\)$/.test(b)),
  drill.btns.slice(0, 8).join(' | '));
check('the drill-in search box is Arabic', drill.ph.some(p => /[؀-ۿ]/.test(p)), drill.ph.join(' | '));

// ★★ Found by LOOKING at the screenshot with all the assertions above green:
// the English correspondence body on the drill-in card painted as
// ".Finance needs the asset list before the renewal date" — the trailing full
// stop is bidi-NEUTRAL and takes the RTL paragraph's direction. Third screen
// this family has appeared on (Other... / #TK000001 / the projects paragraph):
// assume any free-text block needs `fmt.bidiFor`.
const ovProse = await evalJS(`(() => {
  const el = [...document.querySelectorAll('#root .card p')]
    .find(e => e.children.length === 0 && /^[A-Za-z][^؀-ۿ]{20,}\\.$/.test((e.textContent || '').trim()));
  if (!el) return JSON.stringify({ err: 'no english body rendered' });
  const n = [...el.childNodes].find(x => x.nodeType === 3);
  const txt = n.textContent;
  const r = document.createRange();
  r.setStart(n, txt.length - 1); r.setEnd(n, txt.length);
  const dot = r.getBoundingClientRect();
  const whole = document.createRange();
  whole.selectNodeContents(n);
  const rects = [...whole.getClientRects()];
  const line = rects[rects.length - 1];
  return JSON.stringify({ dir: getComputedStyle(el).direction, dotLeft: Math.round(dot.left),
                          lineLeft: Math.round(line.left), lineRight: Math.round(line.right) });
})()`).then(JSON.parse);
check('★★ the card body keeps its full stop at the END of its line, not dragged to the front',
  ovProse.dir === 'ltr' && ovProse.dotLeft > ovProse.lineRight - 20, JSON.stringify(ovProse));
await shot('overview-ar');

// Non-vacuous: the same mounted Overview, flipped to English.
await evalJS(`window.__setLang('en')`);
await sleep(500);
const ovEn = await evalJS(`(() => {
  const root = document.getElementById('root');
  const btns = [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: root.innerText || '' });
})()`).then(JSON.parse);
check('non-vacuous: the same Overview reads English under en',
  ovEn.btns.includes('Back to Statuses') && /Correspondences \(\d+\)/.test(ovEn.body),
  ovEn.btns.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(350);

// ── Admin: the approval queue, the users table and the export card ──────────
await evalJS(`window.__mount('admin')`);
await sleep(600);
const adm = await evalJS(`(() => {
  const root = document.getElementById('root');
  const h1 = root.querySelector('h1');
  const ths = [...root.querySelectorAll('th')].map(e => (e.textContent || '').trim());
  const btns = [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  const badges = [...root.querySelectorAll('.badge')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ h1: h1 ? h1.textContent.trim() : '', ths, btns, badges, body: root.innerText || '' });
})()`).then(JSON.parse);
check('the Admin screen is Arabic (إدارة المستخدمين + الاعتماد/الرفض)',
  adm.h1 === 'إدارة المستخدمين' && adm.btns.includes('اعتماد') && adm.btns.includes('رفض'),
  `${adm.h1} | ${adm.btns.slice(0, 6).join(' | ')}`);
check('★ no users-table header is still English',
  adm.ths.length >= 5 && adm.ths.every(h => !/[A-Za-z]{3}/.test(h)), adm.ths.join(' | '));
// ★ The status badge is a stored value painted through the display layer, and
// the pending row is the only place all three statuses appear at once.
check('★ the user status badges paint the stored enums in Arabic',
  adm.badges.length >= 3 && adm.badges.every(b => /[؀-ۿ]/.test(b)), adm.badges.join(' | '));
check('the export & backup card is Arabic, and the npm commands are NOT translated',
  /التصدير والنسخ الاحتياطي/.test(adm.body) && adm.btns.some(b => b.includes('تصدير إلى Excel')),
  adm.body.slice(0, 160));
await shot('admin-ar');

await evalJS(`window.__setLang('en')`);
await sleep(450);
const admEn = await evalJS(`(() => {
  const root = document.getElementById('root');
  const btns = [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
  return JSON.stringify({ btns, body: root.innerText || '' });
})()`).then(JSON.parse);
check('non-vacuous: the same Admin screen reads English under en',
  admEn.btns.includes('Approve') && /User Management/i.test(admEn.body),
  admEn.btns.slice(0, 8).join(' | '));
await evalJS(`window.__setLang('ar')`);
await sleep(300);
check('no errors across the Overview + Admin checks', (await evalJS(`window.__errors.length`)) === 0);

// -- [C10] UX task 3: Home's "Needs you today" list --------------------------
// The point of the task is that every role lands on Home and immediately sees
// what is waiting on them. A source floor cannot assert an ORDER, a CAP or a
// click, so this mounts the real HomeDashboard with seven seeded rows and reads
// the paint: overdue before due-soon before review, six rows max with a "See
// all 7" escape hatch, badges and heading in Arabic, serials kept LTR, and a
// row click actually routing to the owning board.
console.log('\n[C10] Home renders "Needs you today" (UX task 3)');
await evalJS(`window.__mount('home')`);
await sleep(500);

const ATTN_ROWS = `[...document.getElementById('root').querySelectorAll('button.card-interactive')]
  .filter(b => b.querySelector('span[style*="flex: 1"], span[style*="flex:1"]'))`;

const homeAr = JSON.parse(await evalJS(`(() => {
  const root = document.getElementById('root');
  const rows = ${ATTN_ROWS};
  return JSON.stringify({
    h2s: [...root.querySelectorAll('h2')].map(e => (e.textContent || '').trim()),
    rowCount: rows.length,
    rowText: rows.map(r => (r.textContent || '').trim()),
    badges: rows.map(r => (r.lastElementChild.textContent || '').trim()),
    ltrSerials: rows.filter(r => r.querySelector('.ltr-data')).length,
    seeAll: [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim())
      .find(x => x.indexOf('عرض الكل') === 0) || '',
  });
})()`));

check('the "Needs you today" heading is Arabic (يحتاج انتباهك اليوم)',
  homeAr.h2s.includes('يحتاج انتباهك اليوم'), JSON.stringify(homeAr.h2s));
check('★ the list is capped at 6 rows even though 7 items need me',
  homeAr.rowCount === 6, homeAr.rowCount);
check('★ the 7th is not lost: a "See all 7" link points at the Due Soon board',
  homeAr.seeAll.indexOf('7') !== -1, homeAr.seeAll);
check('★ the rows are ordered overdue then due-soon then awaiting review',
  JSON.stringify(homeAr.badges) === JSON.stringify(
    ['المتأخرة', 'المتأخرة', 'قرب الموعد', 'قرب الموعد', 'في انتظار المراجعة', 'في انتظار المراجعة']),
  JSON.stringify(homeAr.badges));
check('★ no row badge is still an English reason label',
  !homeAr.badges.some(b => /Overdue|Due Soon|Awaiting/.test(b)), JSON.stringify(homeAr.badges));
check('★ every row paints its serial as LTR data (.ltr-data)',
  homeAr.ltrSerials === 6, homeAr.ltrSerials);
check('the overdue correspondence is the first row',
  (homeAr.rowText[0] || '').indexOf('CR000001') !== -1, homeAr.rowText[0]);
await shot('home-needsme-ar');

// A click has to leave Home for the board that owns the record - the row is
// useless if it only highlights.
await clickEl(`${ATTN_ROWS}.find(b => (b.textContent||'').indexOf('TK000002') !== -1)`, 'a task row');
await sleep(300);
const nav = JSON.parse(await evalJS(`JSON.stringify(window.__nav)`));
check('★ clicking a task row navigates to the tasks board', nav[nav.length - 1] === 'tasks', JSON.stringify(nav));

await evalJS(`window.__nav = []`);
await clickEl(`${ATTN_ROWS}.find(b => (b.textContent||'').indexOf('CR000001') !== -1)`, 'a correspondence row');
await sleep(300);
const nav2 = JSON.parse(await evalJS(`JSON.stringify(window.__nav)`));
check('★ clicking a correspondence row navigates to the correspondences board',
  nav2[nav2.length - 1] === 'correspondences', JSON.stringify(nav2));

// Non-vacuous: the SAME DOM in English, so a hard-coded Arabic label fails too.
await evalJS(`window.__setLang('en')`);
await sleep(350);
const homeEn = JSON.parse(await evalJS(`(() => {
  const root = document.getElementById('root');
  const rows = ${ATTN_ROWS};
  return JSON.stringify({
    h2s: [...root.querySelectorAll('h2')].map(e => (e.textContent || '').trim()),
    badges: rows.map(r => (r.lastElementChild.textContent || '').trim()),
  });
})()`));
check('non-vacuous: the same list reads English under en',
  homeEn.h2s.includes('Needs you today') && homeEn.badges[0] === 'Overdue',
  JSON.stringify(homeEn));
await evalJS(`window.__setLang('ar')`);
await sleep(300);

check('no errors across the Home checks', (await evalJS(`window.__errors.length`)) === 0);

// -- [C12] UX task 5: a record card is quiet until you open it ---------------
// The boss's complaint was that every card shouts every field at once. Task 5
// leaves the collapsed card with title / owner / status / due date + ONE
// action and moves the rest behind the card. A source floor cannot assert
// "not painted", so this reads the real boards: what the collapsed card does
// NOT contain, then that opening it brings the same fields back.
console.log('\n[C12] a record card is quiet until you open it (UX task 5)');
await evalJS(`window.__mount('tasks', { initialView: 'mine' })`);
await sleep(550);
await openFirstGroupCard();

const TASK_CARDS = `[...document.querySelectorAll('#root .card[id^="task-"]')]`;
const readTasks = `(() => {
  const cards = ${TASK_CARDS};
  return JSON.stringify({
    count: cards.length,
    text: cards.map(c => c.innerText || '').join(String.fromCharCode(10)),
  });
})()`;
const c12Collapsed = JSON.parse(await evalJS(readTasks));
check('the tasks board painted its cards', c12Collapsed.count > 0, c12Collapsed.count);
check('★ a collapsed task card still carries its serial, title and owner',
  /TK00000/.test(c12Collapsed.text) && /P-10|متابعة أعمال/.test(c12Collapsed.text)
    && /Tariq Salama|Nevin Anwar|Ahmed Salem/.test(c12Collapsed.text),
  c12Collapsed.text.slice(0, 160));
check('★★ but NOT the description, the "بواسطة" line or the linked project',
  !/Vendor reports high vibration/.test(c12Collapsed.text)
    && !/بواسطة/.test(c12Collapsed.text)
    && !/Meleiha Gas Plant/.test(c12Collapsed.text),
  c12Collapsed.text.slice(0, 300));

// ...and opening the card is what brings them back — the fields moved, they
// were not deleted.
await clickEl(`${TASK_CARDS}[0].querySelector('h3')`, 'first task card');
await sleep(400);
const c12Open = JSON.parse(await evalJS(readTasks));
check('★ opening a card puts the description and the "بواسطة" line back',
  /بواسطة/.test(c12Open.text)
    && c12Open.text.length > c12Collapsed.text.length,
  `${c12Collapsed.text.length} -> ${c12Open.text.length}`);
check('no errors across the task-card checks', (await evalJS(`window.__errors.length`)) === 0);

// The grid boards have no expand — their second action moved into a "···"
// menu, so the card is left with one visible action: opening the record.
await evalJS(`window.__mount('projects')`);
await sleep(650);
// A group-by choice from [C8b] can still be in localStorage, in which case the
// board opens on the group grid and the record cards are one drill-in away.
await openFirstGroupCard();
const PROJ_CARDS = `[...document.querySelectorAll('#root .card.card-interactive')]`;
const projCards = JSON.parse(await evalJS(`(() => {
  const cards = ${PROJ_CARDS};
  return JSON.stringify({
    count: cards.length,
    buttons: cards.map(c => c.querySelectorAll('button').length),
    menuTriggers: cards.filter(c => c.querySelector('button[aria-haspopup="menu"]')).length,
    text: cards.map(c => c.innerText || '').join(String.fromCharCode(10)),
  });
})()`));
check('the projects board painted its cards', projCards.count > 0, projCards.count);
check('★ every project card exposes exactly ONE action button — the "···" menu',
  projCards.buttons.every(n => n === 1) && projCards.menuTriggers === projCards.count,
  JSON.stringify(projCards.buttons));
check('★★ the contract code and the repeated status line are off the card',
  !/46000029/.test(projCards.text), projCards.text.slice(0, 300));
check('★ Edit / Delete are not shouting from the card face',
  !new RegExp(`${ar['Edit']}|${ar['Delete']}`).test(projCards.text), projCards.text.slice(0, 300));

await clickEl(`${PROJ_CARDS}[0].querySelector('button[aria-haspopup="menu"]')`, 'the card menu');
await sleep(300);
const menu = JSON.parse(await evalJS(`(() => {
  const items = [...document.querySelectorAll('#root [role=menu] [role=menuitem]')]
    .map(b => (b.textContent || '').trim());
  return JSON.stringify({ items });
})()`));
check('★ and opening the menu offers them, in Arabic',
  menu.items.includes(ar['Edit']) && menu.items.includes(ar['Delete']), JSON.stringify(menu.items));
await shot('card-menu-ar');
check('no errors across the card-menu checks', (await evalJS(`window.__errors.length`)) === 0);

// -- [C13] UX task 6: first-run guidance on Home -----------------------------
// A new user (the boss) lands on Home knowing nothing about what the app is
// for. Task 6 states the flow once — correspondence -> task -> archive — and
// then never again: the strip hides itself once the user has opened anything,
// and a dismissal is permanent. Source cannot assert "shown, then gone", so
// this drives the real component through both transitions.
console.log('\n[C13] Home explains the flow once, then gets out of the way (UX task 6)');
await evalJS(`(() => {
  localStorage.removeItem('etaske.howitworks.dismissed.v1');
  localStorage.removeItem('etaske.recents.v1');
})()`);
await evalJS(`window.__mount('home')`);
await sleep(500);

const HINT = `(() => {
  const h2 = [...document.getElementById('root').querySelectorAll('h2')]
    .find(e => /\u0643\u064a\u0641 \u064a\u0633\u064a\u0631 \u0627\u0644\u0639\u0645\u0644 \u0647\u0646\u0627|How work flows here/.test(e.textContent || ''));
  return h2 ? h2.parentElement.parentElement : null;
})()`;
const readHint = `(() => {
  const box = ${HINT};
  if (!box) return JSON.stringify({ present: false });
  const steps = [...box.querySelectorAll('.card-grid-sm button')];
  return JSON.stringify({
    present: true,
    heading: (box.querySelector('h2').textContent || '').trim(),
    steps: steps.map(b => (b.innerText || '').trim()),
    dismiss: [...box.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean),
  });
})()`;

const hintAr = JSON.parse(await evalJS(readHint));
check('★ a first-run Home carries the "how work flows here" strip', hintAr.present, JSON.stringify(hintAr));
check('the heading is Arabic (كيف يسير العمل هنا)',
  hintAr.heading === 'كيف يسير العمل هنا', hintAr.heading);
check('★ it is exactly three steps, in order', hintAr.steps.length === 3, JSON.stringify(hintAr.steps));
check('★ each step reads Arabic — no English key text leaked through',
  hintAr.steps.every(s => /[؀-ۿ]/.test(s))
    && !hintAr.steps.some(s => /Log it|Assign it|Finish it|correspondence\b/.test(s)),
  JSON.stringify(hintAr.steps));
check('★ the step numbers stay Latin digits (the app is -u-nu-latn)',
  hintAr.steps.every((s, i) => s.indexOf(String(i + 1)) === 0), JSON.stringify(hintAr.steps));
await shot('home-howitworks-ar');

// Each step is a shortcut to the board it describes, not decoration.
await evalJS(`window.__nav = []`);
await clickEl(`${HINT}.querySelectorAll('.card-grid-sm button')[1]`, 'the "assign it" step');
await sleep(300);
const hintNav = JSON.parse(await evalJS(`JSON.stringify(window.__nav)`));
check('★ clicking step 2 opens the tasks board', hintNav[hintNav.length - 1] === 'tasks', JSON.stringify(hintNav));

// Dismissal has to survive a remount — a hint that returns every visit is an
// ad, not guidance.
// A real remount: HomeDashboard reads localStorage on mount, so it has to be
// unmounted (via another view) or its state simply survives.
await evalJS(`window.__mount('tasks')`);
await sleep(300);
await evalJS(`window.__mount('home')`);
await sleep(400);
await clickEl(`[...${HINT}.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'تمام')`, 'the "Got it" button');
await sleep(250);
check('★ dismissing hides the strip immediately',
  JSON.parse(await evalJS(readHint)).present === false);
check('★ and the dismissal is remembered',
  (await evalJS(`localStorage.getItem('etaske.howitworks.dismissed.v1')`)) === '1');
await evalJS(`window.__mount('tasks')`);
await sleep(300);
await evalJS(`window.__mount('home')`);
await sleep(400);
check('★★ so a remounted Home does not show it again',
  JSON.parse(await evalJS(readHint)).present === false);

// Non-vacuous: the same strip reads English, and only appears for a user with
// no history — one recent record is enough to retire it.
await evalJS(`(() => { localStorage.removeItem('etaske.howitworks.dismissed.v1'); })()`);
await evalJS(`window.__setLang('en')`);
await evalJS(`window.__mount('tasks')`);
await sleep(300);
await evalJS(`window.__mount('home')`);
await sleep(450);
const hintEn = JSON.parse(await evalJS(readHint));
check('non-vacuous: the same strip reads English under en',
  hintEn.present && hintEn.heading === 'How work flows here'
    && /Log it/.test(hintEn.steps[0] || ''),
  JSON.stringify(hintEn).slice(0, 200));

await evalJS(`localStorage.setItem('etaske.recents.v1', JSON.stringify([
  { kind: 'task', id: 't1', label: 'Something I already opened', serial: 'TK000002', at: Date.now() },
]))`);
await evalJS(`window.__mount('tasks')`);
await sleep(300);
await evalJS(`window.__mount('home')`);
await sleep(450);
check('★★ a user who has already opened a record never sees the hint',
  JSON.parse(await evalJS(readHint)).present === false);
await evalJS(`localStorage.removeItem('etaske.recents.v1')`);
await evalJS(`window.__setLang('ar')`);
await sleep(300);
check('no errors across the first-run guidance checks', (await evalJS(`window.__errors.length`)) === 0);

if (fail) {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(ROOT, 'scripts/harness/i18nrtl-failure.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log(`  screenshot: ${p}`);
  } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ''}`);
try { ws.close(); } catch {}
edge.kill();
await sleep(300);
try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
