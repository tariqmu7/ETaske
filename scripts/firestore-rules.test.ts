/**
 * Offline Firestore security-rules test (the automated equivalent of the
 * manual "Approved-vs-Pending smoke test" in RULES-NOTES.md).
 *
 * Runs entirely against the local Firestore emulator — it never touches the
 * live named production database and requires no deploy. Java (JDK 11+) is
 * required because the Firestore emulator is a Java process.
 *
 *   npm run rules:test
 *     -> firebase emulators:exec --only firestore "tsx scripts/firestore-rules.test.ts"
 *
 * The rules under test are read from ./firestore.rules. They use
 * `match /databases/{database}/documents` (a wildcard that never branches on
 * the database name), so exercising them against the emulator's default
 * database is equivalent to the named production DB for rule-logic purposes.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';

const ADMIN_EMAIL = 'tarekmoh123@gmail.com'; // mirrors src/App.tsx + firestore.rules
const HOST = '127.0.0.1';
const PORT = 8080;

let passed = 0;
let failed = 0;

/** Run one expectation; `expect` is 'ok' (should succeed) or 'deny' (should be rejected). */
async function check(name: string, expect: 'ok' | 'deny', op: Promise<unknown>) {
  try {
    await (expect === 'ok' ? assertSucceeds(op) : assertFails(op));
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${(e as Error).message}`);
    failed++;
  }
}

async function main() {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'etaske-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: HOST,
      port: PORT,
    },
  });

  // ── Seed baseline data with rules bypassed ────────────────────────────────
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/pending'), { status: 'Pending', role: 'Employee', name: 'P' });
    await setDoc(doc(db, 'users/rejected'), { status: 'Rejected', role: 'Employee', name: 'R' });
    await setDoc(doc(db, 'users/emp'), { status: 'Approved', role: 'Employee', name: 'E' });
    await setDoc(doc(db, 'users/mgr'), { status: 'Approved', role: 'Manager', name: 'M' });
    // Queue A3a: a second admin promoted in the Users screen (no special email),
    // and one whose account was later suspended.
    await setDoc(doc(db, 'users/admin2'), { status: 'Approved', role: 'Admin', name: 'A2' });
    await setDoc(doc(db, 'users/exadmin'), { status: 'Rejected', role: 'Admin', name: 'XA' });
    await setDoc(doc(db, 'users/pending2'), { status: 'Pending', role: 'Employee', name: 'P2' });
    await setDoc(doc(db, 'tasks/T1'), { assignedById: 'mgr', assignedToId: 'emp', title: 't' });
    // Privacy fixtures: TPRIV is a private task owned by emp; TPUB is public.
    await setDoc(doc(db, 'tasks/TPRIV'), { assignedById: 'mgr', assignedToId: 'emp', isPrivate: true, title: 'secret' });
    await setDoc(doc(db, 'tasks/TPUB'), { assignedById: 'mgr', assignedToId: 'emp', isPrivate: false, title: 'open' });
    await setDoc(doc(db, 'tasks/--stats--'), { value: 5 });
    await setDoc(doc(db, 'correspondences/C1'), { userId: 'emp', subject: 's' });
    await setDoc(doc(db, 'correspondences/--stats--'), { value: 3 });
    await setDoc(doc(db, 'milestones/M1'), { addedById: 'emp', taskId: 'T1', text: 'm' });
    await setDoc(doc(db, 'notifications/N1'), { forUserId: 'emp', read: false, body: 'b' });
    await setDoc(doc(db, 'notifications/N2'), { forUserId: 'mgr', read: false, body: 'b' });
  });

  const unauth = env.unauthenticatedContext().firestore();
  const pending = env.authenticatedContext('pending').firestore();
  const rejected = env.authenticatedContext('rejected').firestore();
  const emp = env.authenticatedContext('emp').firestore();
  const mgr = env.authenticatedContext('mgr').firestore();
  const admin = env.authenticatedContext('admin', { email: ADMIN_EMAIL }).firestore();
  const admin2 = env.authenticatedContext('admin2', { email: 'second@example.com' }).firestore();
  const exadmin = env.authenticatedContext('exadmin', { email: 'former@example.com' }).firestore();

  // ── 1. Approved Employee: normal work is UNAFFECTED (the core question) ────
  console.log('\n[Approved Employee — must keep working normally]');
  await check('emp reads task T1', 'ok', getDoc(doc(emp, 'tasks/T1')));
  await check('emp reads correspondence C1', 'ok', getDoc(doc(emp, 'correspondences/C1')));
  await check('emp reads milestone M1', 'ok', getDoc(doc(emp, 'milestones/M1')));
  await check('emp reads own notification N1', 'ok', getDoc(doc(emp, 'notifications/N1')));
  await check('emp reads users directory', 'ok', getDoc(doc(emp, 'users/mgr')));
  await check('emp creates own task', 'ok',
    setDoc(doc(emp, 'tasks/TNEW'), { assignedById: 'emp', assignedToId: 'emp' }));
  await check('emp creates own correspondence', 'ok',
    setDoc(doc(emp, 'correspondences/CNEW'), { userId: 'emp' }));
  await check('emp creates own milestone', 'ok',
    setDoc(doc(emp, 'milestones/MNEW'), { addedById: 'emp', taskId: 'T1' }));
  await check('emp updates task assigned to them', 'ok',
    updateDoc(doc(emp, 'tasks/T1'), { status: 'In Progress' }));
  await check('emp marks own notification read', 'ok',
    updateDoc(doc(emp, 'notifications/N1'), { read: true }));
  await check('emp increments tasks/--stats-- (5 -> 6)', 'ok',
    updateDoc(doc(emp, 'tasks/--stats--'), { value: 6 }));
  await check('emp edits own profile name (no role/status change)', 'ok',
    updateDoc(doc(emp, 'users/emp'), { name: 'Edited' }));

  // ── 2. Pending / Rejected / unauth: denied (intended) ─────────────────────
  console.log('\n[Pending / Rejected / unauthenticated — must be denied]');
  await check('pending reads task T1', 'deny', getDoc(doc(pending, 'tasks/T1')));
  await check('pending creates a task', 'deny',
    setDoc(doc(pending, 'tasks/PX'), { assignedById: 'pending' }));
  await check('rejected reads correspondence C1', 'deny', getDoc(doc(rejected, 'correspondences/C1')));
  await check('unauth reads task T1', 'deny', getDoc(doc(unauth, 'tasks/T1')));
  await check('unauth reads users directory', 'deny', getDoc(doc(unauth, 'users/emp')));
  await check('pending CAN read users (pre-approval screen needs it)', 'ok',
    getDoc(doc(pending, 'users/pending')));

  // ── 3. Self-escalation guards ─────────────────────────────────────────────
  console.log('\n[Privilege-escalation guards]');
  await check('pending cannot self-approve (status -> Approved)', 'deny',
    updateDoc(doc(pending, 'users/pending'), { status: 'Approved' }));
  await check('pending cannot self-promote (role -> Admin)', 'deny',
    updateDoc(doc(pending, 'users/pending'), { role: 'Admin' }));
  await check('emp cannot self-promote (role -> Manager)', 'deny',
    updateDoc(doc(emp, 'users/emp'), { role: 'Manager' }));
  await check('self-signup as Approved is rejected', 'deny',
    setDoc(doc(env.authenticatedContext('evil').firestore(), 'users/evil'),
      { status: 'Approved', role: 'Admin' }));
  await check('self-signup as Pending/Employee is allowed', 'ok',
    setDoc(doc(env.authenticatedContext('newbie').firestore(), 'users/newbie'),
      { status: 'Pending', role: 'Employee' }));
  await check('admin can approve a pending user', 'ok',
    updateDoc(doc(admin, 'users/pending'), { status: 'Approved' }));

  // ── 3b. Second admin (queue A3a) — the role, not the email, is what counts ─
  console.log('\n[Second admin]');
  await check('second admin can approve a pending user', 'ok',
    updateDoc(doc(admin2, 'users/pending2'), { status: 'Approved' }));
  await check('second admin can promote a user to Manager', 'ok',
    updateDoc(doc(admin2, 'users/emp'), { role: 'Manager' }));
  await check('second admin can hand the Admin role on', 'ok',
    updateDoc(doc(admin2, 'users/emp'), { role: 'Admin' }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/emp'), { status: 'Approved', role: 'Employee', name: 'E' });
  });
  await check("second admin can read someone else's notification", 'ok',
    getDoc(doc(admin2, 'notifications/N1')));
  await check('suspended admin (Rejected) cannot approve anyone', 'deny',
    updateDoc(doc(exadmin, 'users/rejected'), { status: 'Approved' }));
  await check('suspended admin cannot re-approve itself', 'deny',
    updateDoc(doc(exadmin, 'users/exadmin'), { status: 'Approved' }));
  await check('manager cannot approve users (admin only)', 'deny',
    updateDoc(doc(mgr, 'users/rejected'), { status: 'Approved' }));
  await check('new signup cannot create itself as Admin without the email', 'deny',
    setDoc(doc(env.authenticatedContext('sneak', { email: 'sneak@example.com' }).firestore(), 'users/sneak'),
      { status: 'Pending', role: 'Admin' }));
  await check("second admin still CANNOT read emp's private task", 'deny',
    getDoc(doc(admin2, 'tasks/TPRIV')));

  // ── 4. Counter integrity (--stats--) ──────────────────────────────────────
  console.log('\n[Counter integrity]');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'correspondences/--stats--'), { value: 3 });
  });
  await check('emp cannot reset counter (-> 0)', 'deny',
    updateDoc(doc(emp, 'correspondences/--stats--'), { value: 0 }));
  await check('emp cannot skip counter (+2)', 'deny',
    updateDoc(doc(emp, 'correspondences/--stats--'), { value: 5 }));
  await check('emp cannot delete counter', 'deny',
    deleteDoc(doc(emp, 'correspondences/--stats--')));

  // ── 5. Notification isolation ─────────────────────────────────────────────
  console.log('\n[Notification isolation]');
  await check("emp cannot read another user's notification N2", 'deny',
    getDoc(doc(emp, 'notifications/N2')));
  await check('emp cannot delete a notification (admin only)', 'deny',
    deleteDoc(doc(emp, 'notifications/N1')));
  await check('emp cannot rewrite notification body (beyond read flag)', 'deny',
    updateDoc(doc(emp, 'notifications/N1'), { forUserId: 'emp', body: 'tampered' }));

  // ── 6. Manager / delete privileges ────────────────────────────────────────
  console.log('\n[Manager privileges]');
  await check('emp cannot delete task T1 (not manager)', 'deny',
    deleteDoc(doc(emp, 'tasks/T1')));
  await check('mgr can delete task T1', 'ok',
    deleteDoc(doc(mgr, 'tasks/T1')));

  // ── 7. Private-task isolation (owner-only: not managers, not admin) ────────
  console.log('\n[Private-task isolation]');
  await check('emp (owner) reads own private task TPRIV', 'ok',
    getDoc(doc(emp, 'tasks/TPRIV')));
  await check('emp reads public task TPUB', 'ok',
    getDoc(doc(emp, 'tasks/TPUB')));
  await check("mgr CANNOT read emp's private task TPRIV", 'deny',
    getDoc(doc(mgr, 'tasks/TPRIV')));
  await check("admin CANNOT read emp's private task TPRIV", 'deny',
    getDoc(doc(admin, 'tasks/TPRIV')));
  await check('mgr can read public task TPUB', 'ok',
    getDoc(doc(mgr, 'tasks/TPUB')));
  await check("mgr CANNOT flip emp's private task to public", 'deny',
    updateDoc(doc(mgr, 'tasks/TPRIV'), { isPrivate: false }));
  await check("mgr CANNOT delete emp's private task TPRIV", 'deny',
    deleteDoc(doc(mgr, 'tasks/TPRIV')));
  await check('emp (owner) can update own private task TPRIV', 'ok',
    updateDoc(doc(emp, 'tasks/TPRIV'), { status: 'In Progress' }));
  await check('emp can make own task private', 'ok',
    updateDoc(doc(emp, 'tasks/TPUB'), { isPrivate: true }));

  // ── Private contact ids (queue A3b) ───────────────────────────────────────
  console.log('\n[Private contact ids]');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/emp/private/contact'), { telegramChatId: '111', fcmToken: 'fcm-emp' });
    // An old copy still on the public doc (before moveContactsToPrivate runs).
    await setDoc(doc(db, 'users/mgr'), { status: 'Approved', role: 'Manager', name: 'M', telegramChatId: '222' });
  });
  await check('emp reads OWN private contact', 'ok', getDoc(doc(emp, 'users/emp/private/contact')));
  await check("mgr CANNOT read emp's private contact", 'deny', getDoc(doc(mgr, 'users/emp/private/contact')));
  await check("admin CANNOT read emp's private contact", 'deny', getDoc(doc(admin, 'users/emp/private/contact')));
  await check("pending CANNOT read emp's private contact", 'deny', getDoc(doc(pending, 'users/emp/private/contact')));
  await check('emp saves own push token', 'ok',
    setDoc(doc(emp, 'users/emp/private/contact'), { fcmToken: 'fcm-new' }, { merge: true }));
  await check('emp removes own Telegram link', 'ok',
    setDoc(doc(emp, 'users/emp/private/contact'), { telegramChatId: deleteField() }, { merge: true }));
  await check("emp CANNOT set a Telegram chat id (only the script links)", 'deny',
    setDoc(doc(emp, 'users/emp/private/contact'), { telegramChatId: '222' }, { merge: true }));
  await check("emp CANNOT write mgr's private contact", 'deny',
    setDoc(doc(emp, 'users/mgr/private/contact'), { fcmToken: 'hijack' }));
  await check('emp CANNOT add other fields to the contact doc', 'deny',
    setDoc(doc(emp, 'users/emp/private/contact'), { role: 'Admin' }, { merge: true }));
  await check('emp CANNOT use another doc name under private/', 'deny',
    setDoc(doc(emp, 'users/emp/private/other'), { fcmToken: 'x' }));
  await check('emp CANNOT put a chat id back on the public doc', 'deny',
    updateDoc(doc(emp, 'users/emp'), { telegramChatId: '999' }));
  await check('emp CANNOT put a push token back on the public doc', 'deny',
    updateDoc(doc(emp, 'users/emp'), { fcmToken: 'x' }));
  await check('mgr can still edit own profile with an old chat id on it', 'ok',
    updateDoc(doc(mgr, 'users/mgr'), { name: 'M2' }));
  await check('mgr can drop the old chat id from the public doc', 'ok',
    updateDoc(doc(mgr, 'users/mgr'), { telegramChatId: deleteField(), fcmToken: deleteField() }));
  await check('mgr CANNOT change the old chat id on the public doc', 'deny',
    updateDoc(doc(mgr, 'users/mgr'), { telegramChatId: '333' }));
  await check('signup cannot bring a chat id on the public doc', 'deny',
    setDoc(doc(env.authenticatedContext('tgnew').firestore(), 'users/tgnew'),
      { status: 'Pending', role: 'Employee', telegramChatId: '1' }));

  await env.cleanup();

  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('  RESULT: rules behave UNEXPECTEDLY — do not deploy.');
    process.exitCode = 1;
  } else {
    console.log('  RESULT: Approved users unaffected; Pending/Rejected denied.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
