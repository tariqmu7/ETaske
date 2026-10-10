// Firestore RULES check for the Medical contracts access switch (queue M2) — LOCAL emulator only.
//
//   firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/medicalrules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
// Same REST + unsigned-token pattern as offerrules.mjs.
const PROJECT = 'demo-etaske';
const DB = process.env.DBID || 'ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6';
const BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/${DB}/documents`;

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid, email) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' },
})}.`;

const enc = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const fields = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])) });
const H = auth => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` });

// `mask` = only those fields, like the app's updateDoc(); without it the whole doc is replaced.
async function put(path, data, auth, mask) {
  const q = mask ? '?' + mask.map(f => `updateMask.fieldPaths=${f}`).join('&') : '';
  return (await fetch(`${BASE}/${path}${q}`, { method: 'PATCH', headers: H(auth), body: JSON.stringify(fields(data)) })).status;
}
const get = async (path, auth) => (await fetch(`${BASE}/${path}`, { headers: H(auth) })).status;
const del = async (path, auth) => (await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H(auth) })).status;
const list = async (coll, auth) => (await fetch(`${BASE}/${coll}`, { headers: H(auth) })).status;

const OWNER = 'owner';
const ADMIN = token('u-admin', 'boss@x.com');
const BOOT = token('u-boot', 'tarekmoh123@gmail.com');
const MGR = token('u-mgr', 'mgr@x.com');
const NONE = token('u-none', 'none@x.com');
const VIEW = token('u-view', 'view@x.com');
const EDIT = token('u-edit', 'edit@x.com');
const PEND = token('u-pend', 'pend@x.com');

let pass = 0, fail = 0;
const expect = (label, status, allowed) => {
  const ok = allowed ? status === 200 : status === 403;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label} (${status}, expected ${allowed ? 'allow' : 'deny'})`);
};

const seedUsers = async () => {
  await put('users/u-admin', { status: 'Approved', role: 'Admin', displayName: 'Second admin' }, OWNER);
  await put('users/u-boot', { status: 'Approved', role: 'Admin', displayName: 'Tariq' }, OWNER);
  await put('users/u-mgr', { status: 'Approved', role: 'Manager', displayName: 'Manager' }, OWNER);
  await put('users/u-none', { status: 'Approved', role: 'Employee', displayName: 'None', medicalContractsAccess: 'none' }, OWNER);
  await put('users/u-view', { status: 'Approved', role: 'Employee', displayName: 'Viewer', medicalContractsAccess: 'view' }, OWNER);
  await put('users/u-edit', { status: 'Approved', role: 'Employee', displayName: 'Editor', medicalContractsAccess: 'edit' }, OWNER);
  await put('users/u-pend', { status: 'Pending', role: 'Employee', displayName: 'Pending', medicalContractsAccess: 'edit' }, OWNER);
};
const C = { contractNo: 'C-001', provider: 'Test hospital', governorate: 'Alexandria', area: 'Smouha' };
const seedContract = () => put('medicalContracts/c1', C, OWNER);

await seedUsers();
await seedContract();
await put('medicalContracts/c1/usage/2026-09', { visits: 4 }, OWNER);

console.log('\n[1] Reading the contracts');
expect('admin (role) reads a contract', await get('medicalContracts/c1', ADMIN), true);
expect('bootstrap admin e-mail reads', await get('medicalContracts/c1', BOOT), true);
expect('admin lists the collection', await list('medicalContracts', ADMIN), true);
expect('"view" user reads a contract', await get('medicalContracts/c1', VIEW), true);
expect('"view" user lists the collection', await list('medicalContracts', VIEW), true);
expect('"edit" user reads a contract', await get('medicalContracts/c1', EDIT), true);
expect('"none" user reads a contract', await get('medicalContracts/c1', NONE), false);
expect('"none" user lists the collection', await list('medicalContracts', NONE), false);
expect('Manager with no switch reads (role is NOT enough)', await get('medicalContracts/c1', MGR), false);
expect('Pending user with "edit" stored reads', await get('medicalContracts/c1', PEND), false);
expect('"view" user reads usage under a contract', await get('medicalContracts/c1/usage/2026-09', VIEW), true);
expect('"none" user reads usage under a contract', await get('medicalContracts/c1/usage/2026-09', NONE), false);

console.log('\n[2] Writing the contracts');
expect('"view" user edits a contract', await put('medicalContracts/c1', { ...C, provider: 'X' }, VIEW), false);
expect('"view" user creates a contract', await put('medicalContracts/c2', C, VIEW), false);
expect('"view" user deletes a contract', await del('medicalContracts/c1', VIEW), false);
expect('"view" user writes usage', await put('medicalContracts/c1/usage/2026-10', { visits: 1 }, VIEW), false);
expect('Manager with no switch edits', await put('medicalContracts/c1', { ...C, provider: 'X' }, MGR), false);
expect('Pending user with "edit" stored edits', await put('medicalContracts/c1', { ...C, provider: 'X' }, PEND), false);
expect('"edit" user edits a contract', await put('medicalContracts/c1', { ...C, provider: 'Edited' }, EDIT), true);
expect('"edit" user creates a contract', await put('medicalContracts/c3', C, EDIT), true);
expect('"edit" user writes usage', await put('medicalContracts/c1/usage/2026-10', { visits: 1 }, EDIT), true);
expect('"edit" user deletes a contract', await del('medicalContracts/c3', EDIT), true);
expect('admin creates a contract', await put('medicalContracts/c4', C, ADMIN), true);
expect('admin deletes a contract', await del('medicalContracts/c4', ADMIN), true);

console.log('\n[3] Nobody grants themselves access');
expect('"none" user sets own access to edit', await put('users/u-none', { medicalContractsAccess: 'edit' }, NONE, ['medicalContractsAccess']), false);
expect('"view" user raises own access to edit', await put('users/u-view', { medicalContractsAccess: 'edit' }, VIEW, ['medicalContractsAccess']), false);
expect('Manager sets own access to view', await put('users/u-mgr', { medicalContractsAccess: 'view' }, MGR, ['medicalContractsAccess']), false);
expect('Manager grants a colleague access', await put('users/u-none', { medicalContractsAccess: 'view' }, MGR, ['medicalContractsAccess']), false);
expect('Pending user sets own access', await put('users/u-pend', { medicalContractsAccess: 'view' }, PEND, ['medicalContractsAccess']), false);
expect('"view" user still updates own name (field kept)', await put('users/u-view', { displayName: 'Viewer 2' }, VIEW, ['displayName']), true);
expect('Manager (no field) still updates own lastSeen', await put('users/u-mgr', { phoneNumber: '0100' }, MGR, ['phoneNumber']), true);
expect('"view" user lowers own access to none', await put('users/u-view', { medicalContractsAccess: 'none' }, VIEW, ['medicalContractsAccess']), false);

console.log('\n[4] An admin grants and removes it');
expect('admin switches "none" user to view', await put('users/u-none', { medicalContractsAccess: 'view' }, ADMIN, ['medicalContractsAccess']), true);
expect('…who can now read', await get('medicalContracts/c1', NONE), true);
expect('…but not write', await put('medicalContracts/c1', { ...C, provider: 'Y' }, NONE), false);
expect('admin switches them to edit', await put('users/u-none', { medicalContractsAccess: 'edit' }, ADMIN, ['medicalContractsAccess']), true);
expect('…who can now write', await put('medicalContracts/c1', { ...C, provider: 'Y' }, NONE), true);
expect('bootstrap admin switches them off', await put('users/u-none', { medicalContractsAccess: 'none' }, BOOT, ['medicalContractsAccess']), true);
expect('…who can no longer read', await get('medicalContracts/c1', NONE), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
