# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ETaske — a real-time enterprise workflow dashboard (correspondences → tasks → milestones → archive) for a single organization. React 19 + TypeScript + Vite SPA with a Firebase (Auth + Firestore) backend. Originally scaffolded as a Google AI Studio app; the `react-example` package name and AI Studio references are vestigial.

## Commands

```bash
npm install            # install deps
npm run dev            # dev server: Express + Vite middleware on http://localhost:3000
npm run build          # production build -> dist/ (this is what gets deployed)
npm run preview         # serve the built dist/ via Vite
npm run lint           # type-check only: tsc --noEmit  (there is no ESLint)
npm run clean          # rm -rf dist
```

There is **no test suite and no test framework** configured. Do not invent test commands; `npm run lint` (type-check) is the only verification step.

Deploying Firestore security rules is separate from deploying the app:

```bash
firebase deploy --only firestore:rules   # pushes firestore.rules to the NAMED database (see below)
```

## Architecture

### Hosting / runtime split (important)
- `server.ts` is an Express wrapper used **only for local dev** (`npm run dev`/`start`): Vite middleware in dev, static `dist/` in prod, plus a `/api/health` route. It contains **no application/API logic**.
- Production is **static GitHub Pages**: `.github/workflows/deploy.yml` builds `dist/` and publishes it on push to `main`/`master`. The Express server is never deployed. `vite.config.ts` sets `base: './'` for relative asset paths on Pages.
- There **is** a small server-side backend: **Cloud Functions** in `functions/` (codebase `etaske-functions` in `firebase.json`). `functions/src/index.ts` has two Firestore-triggered functions (`onNotificationCreated`, `onAnnouncementCreated`) that send FCM pushes via `firebase-admin` against the named DB. Deploy with `firebase deploy --only functions` (separate from the app build and from rules). The push *proxy* in `google-apps-script.js` predates these and is redundant with them — see env note below.
- Otherwise app logic is client-side. `resend`/`twilio` in `package.json` are unused (can't run from the static client). `@google/genai` / `GEMINI_API_KEY` is leftover AI Studio scaffold and is **not** wired into anything anymore (the old `vite.config.ts` `define` was removed).

### Data layer — Firebase, all real-time
- `src/lib/firebase.ts` initializes Firebase from the committed `firebase-applet-config.json` (public web config — normal for Firebase). Firestore uses `experimentalForceLongPolling: true` **intentionally** (works around a WebSocket internal-assertion bug when many listeners hit permission-denied at once) plus a persistent multi-tab local cache. Do not "simplify" these options away.
- Firestore points at a **named database** `ai-studio-82d500c4-...`, not `(default)` — see `.firebaserc` targets, `firebase.json`, and the third arg to `initializeFirestore`. CLI rule deploys must target this database.
- Collections: `users`, `correspondences`, `tasks`, `milestones`, `notifications`, `messages` (1:1 chat). Schemas live in `src/types.ts` (the source of truth — `firebase-blueprint.json` is stale, e.g. it lists a `Member` role that no longer exists).
- Sequential serial numbers (`TK000001`, `CR000001`) are generated in `src/lib/counters.ts` via a Firestore transaction against a `--stats--` doc inside each collection.
- File attachments are uploaded to **Google Drive via a Google Apps Script web app** (`google-apps-script.js`), POSTed to `import.meta.env.VITE_GOOGLE_SCRIPT_URL`. There is no Firebase Storage usage. Editing the script requires redeploying it as a *New deployment* in script.google.com (see the header comment in that file) and updating the env var. The endpoint is deployed "Anyone" access, so every request must carry a shared secret (`VITE_GOOGLE_SCRIPT_SECRET`, matched against a `SHARED_SECRET` Script Property) and uploads are MIME/size-limited server-side. Being a `VITE_` var it ships in the bundle and is not a true secret — the durable fix is to move uploads/push behind an authenticated Cloud Function.

### Auth, roles, and access control
- Firebase Auth: Google popup + email/password (`LoginScreen.tsx`). On first sign-in `App.tsx` creates the `users/{uid}` doc.
- Admin identity is a **hardcoded email (`tarekmoh123@gmail.com`) in two places that must stay in sync**: `src/App.tsx` (grants Admin role/Approved status) and `firestore.rules` (grants user-management privileges). Changing the admin means editing both.
- Roles: `Admin | Manager | Employee`; statuses: `Pending | Approved | Rejected`. New non-admin users start `Pending` and are gated to `PendingScreen`/`RejectedScreen` until an admin approves them in `AdminDashboard`.
- **Security is now enforced server-side in `firestore.rules`** (hardened — see `RULES-NOTES.md` for the full rationale). Reads on `tasks`/`correspondences`/`milestones`/`notifications` require `status == 'Approved'`; writes are scoped to manager/admin **or** the owner/assignee/author; `notifications` are recipient-only; `--stats--` counters are increment-only and non-deletable; and self-signup/self-update cannot grant itself `Approved`/`Admin`. Role/ownership is no longer just UI gating.
  - **Deploy caveat:** rule edits only take effect after `firebase deploy --only firestore:rules` (to the *named* DB — see Data layer). If the hardened rules have not been deployed, the **live** database may still be running the old `read, write: if request.auth != null` ruleset — verify before relying on server-side enforcement.
  - **Intentional residual openness:** there is **no per-member read isolation** between Approved users (shared org board — every approved member can read all tasks/correspondences/milestones), and the `users` directory is readable to any signed-in account. Both are documented trade-offs in RULES-NOTES.md, not oversights.

### App shell & navigation
- `src/App.tsx` is the hub: it holds all top-level Firestore listeners (auth/profile, all users, notifications, due-soon alerts) and passes `{ user, appUser, projectUsers }` down as `sharedProps`.
- **Navigation is local state, not routing.** Despite `react-router-dom` being a dependency, there is no router. `activeView` (`AppView` union) switches between dashboard components; `components/Sidebar.tsx` (exported as `TopNav`) and the mobile bottom-nav drive it. Default view depends on role (managers/admins → `overview`, others → `tasks`).
- Workflow path: `CorrespondingsDashboard` (intake) → `ManagerInbox` (manager review/assign, converts a correspondence into a `Task`, linked via `correspondingId`) → `TasksDashboard` (work + milestones) → `ArchiveDashboard`. `OverviewDashboard` is the manager/admin analytics view. The big dashboards (`TasksDashboard`, `CorrespondingsDashboard`, `OverviewDashboard` ~1k–1.3k lines) are self-contained and own their own Firestore queries and modals.
- `src/FollowUpDashboard.tsx` is a dead stub (superseded by `CorrespondingsDashboard`) — do not add to it.

### Conventions
- Two separate `utils` modules, do not conflate: `src/utils.ts` = app domain helpers (`normalizeArabic`/`globalSearch` for Arabic-aware search, `getUserColor`, `getGoogleDrivePreviewUrl`, `isOverdue`/`isDueSoon`); `src/lib/utils.ts` = only `cn()` (clsx + tailwind-merge).
- Path alias `@/*` → project root (configured in both `vite.config.ts` and `tsconfig.json`).
- Styling is **Tailwind v4** (via `@tailwindcss/vite`, no `tailwind.config`) combined heavily with inline `style={{}}` objects and CSS custom properties (`var(--surface-2)`, `var(--accent)`, etc.) defined in `src/index.css`. New UI should match the existing inline-style + CSS-variable idiom rather than introducing a component library.
- Search inputs across dashboards run user text through `normalizeArabic` so Arabic content matches regardless of alef/ya/ta-marbuta variants — keep using `globalSearch` for filtering.

## Environment

`.env` (gitignored; `.env*` ignored except `.env.example`) holds: `GEMINI_API_KEY` (unused at runtime), `APP_URL`, `VITE_GOOGLE_SCRIPT_URL` (required for file uploads to work). The CI build injects `VITE_GOOGLE_SCRIPT_URL` from the `VITE_GOOGLE_SCRIPT_URL` GitHub Actions secret.
