// Firestore RULES check for "My daily tasks" (myTodos, owner-only) — LOCAL emulator only.
//
//   firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/mytodorules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
// Same REST + unsigned-token pattern as bidrules.mjs.
// Proves: only the owner reads, lists, edits and deletes their rows — managers and admins included are refused;
// a query not filtered to your own id is refused; a row cannot be created for someone else or reshaped.
const PROJECT = 'demo-etaske';
// Its own database (a fresh id each run), so tasks other harnesses left behind never leak into the query checks.
const DB = process.env.DBID || `mytodorules-${Date.now()}`;
const ROOT = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/${DB}/documents`;

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
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const fields = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])) });
const H = auth => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` });

async function put(path, data, auth, mask) {
  const q = mask ? '?' + mask.map(f => `updateMask.fieldPaths=${f}`).join('&') : '';
  return (await fetch(`${ROOT}/${path}${q}`, { method: 'PATCH', headers: H(auth), body: JSON.stringify(fields(data)) })).status;
}
const get = async (path, auth) => (await fetch(`${ROOT}/${path}`, { headers: H(auth) })).status;

// A query the way the app's SDK sends it. `filter` = [field, op, value] or none (whole collection).
async function runQuery(auth, filter) {
  const structuredQuery = { from: [{ collectionId: 'myTodos' }] };
  if (filter) {
    const [field, op, value] = filter;
    structuredQuery.where = { fieldFilter: { field: { fieldPath: field }, op, value: enc(value) } };
  }
  const res = await fetch(`${ROOT}:runQuery`, { method: 'POST', headers: H(auth), body: JSON.stringify({ structuredQuery }) });
  const body = await res.json().catch(() => []);
  const ids = res.status === 200 ? body.filter(r => r.document).map(r => r.document.name.split('/').pop()).sort() : null;
  return { status: res.status, ids };
}

const OWNER = 'owner';
const U = {
  admin: ['u-adm', 'adm@x.com'], manager: ['u-mgr', 'mgr@x.com'],
  owner: ['u-sara', 'sara@x.com'], collab: ['u-mona', 'mona@x.com'],
  employee: ['u-emp', 'emp@x.com'], pending: ['u-pend', 'pend@x.com'],
};
const T = Object.fromEntries(Object.entries(U).map(([k, [uid, mail]]) => [k, token(uid, mail)]));
const me = who => U[who][0];

let pass = 0, fail = 0;
const expect = (label, status, allowed) => {
  const ok = allowed ? status === 200 : status === 403;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label} (${status}, expected ${allowed ? 'allow' : 'deny'})`);
};
const same = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

await put('users/u-adm', { status: 'Approved', role: 'Admin' }, OWNER);
await put('users/u-mgr', { status: 'Approved', role: 'Manager' }, OWNER);
for (const u of ['u-sara', 'u-mona', 'u-emp']) await put(`users/${u}`, { status: 'Approved', role: 'Employee' }, OWNER);
await put('users/u-pend', { status: 'Pending', role: 'Employee' }, OWNER);

const row = (ownerId, extra = {}) => ({ ownerId, title: 'Call the client', owner: '', action: '', due: '', note: '', done: false, addedDay: '2026-10-11', doneDay: '', ...extra });

console.log('\n[1] Creating rows');
expect('owner creates own row', await put('myTodos/s1', row('u-sara'), T.owner), true);
expect('manager creates own row', await put('myTodos/m1', row('u-mgr'), T.manager), true);
expect('employee creates a row for Sara', await put('myTodos/x1', row('u-sara'), T.employee), false);
expect('pending user creates own row', await put('myTodos/p1', row('u-pend'), T.pending), false);
expect('owner creates a row with an extra field', await put('myTodos/s2', row('u-sara', { assignedToId: 'u-mona' }), T.owner), false);
expect('owner creates a row with a 2,000-letter title', await put('myTodos/s3', row('u-sara', { title: 'x'.repeat(2000) }), T.owner), false);
expect('owner creates a row with done as text', await put('myTodos/s4', row('u-sara', { done: 'yes' }), T.owner), false);

console.log('\n[2] Reading one row — owner only');
for (const who of ['owner', 'admin', 'manager', 'collab', 'employee', 'pending']) {
  expect(`${who} reads Sara's row`, await get('myTodos/s1', T[who]), who === 'owner');
}

console.log('\n[3] Queries — only "my own rows"');
for (const who of ['owner', 'admin', 'manager', 'employee']) {
  const r = await runQuery(T[who], ['ownerId', 'EQUAL', me(who)]);
  expect(`${who} lists own rows`, r.status, true);
}
same('Sara gets exactly her row', (await runQuery(T.owner, ['ownerId', 'EQUAL', 'u-sara'])).ids, ['s1']);
for (const who of ['admin', 'manager', 'employee']) {
  expect(`${who} lists Sara's rows`, (await runQuery(T[who], ['ownerId', 'EQUAL', 'u-sara'])).status, false);
}
for (const who of ['owner', 'admin', 'manager']) {
  expect(`${who} lists the WHOLE collection`, (await runQuery(T[who], null)).status, false);
}

console.log('\n[4] Editing and deleting');
expect('owner ticks own row done', await put('myTodos/s1', { done: true, doneDay: '2026-10-11' }, T.owner, ['done', 'doneDay']), true);
expect('owner edits the title', await put('myTodos/s1', { title: 'Call the client again' }, T.owner, ['title']), true);
expect('owner hands the row to someone else', await put('myTodos/s1', { ownerId: 'u-mona' }, T.owner, ['ownerId']), false);
expect('owner changes the day it was added', await put('myTodos/s1', { addedDay: '2026-01-01' }, T.owner, ['addedDay']), false);
expect('admin edits Sara\'s row', await put('myTodos/s1', { title: 'x' }, T.admin, ['title']), false);
expect('manager edits Sara\'s row', await put('myTodos/s1', { title: 'x' }, T.manager, ['title']), false);
const del = async (path, auth) => (await fetch(`${ROOT}/${path}`, { method: 'DELETE', headers: H(auth) })).status;
expect('admin deletes Sara\'s row', await del('myTodos/s1', T.admin), false);
expect('owner deletes own row', await del('myTodos/s1', T.owner), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
