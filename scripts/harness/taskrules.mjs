// Firestore RULES check for private tasks, the list lock (queue M6d) — LOCAL emulator only.
//
//   firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/taskrules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
// Same REST + unsigned-token pattern as bidrules.mjs. Proves:
//   1. a single task can be read by the same people as before (get rule unchanged);
//   2. the three queries src/lib/taskVisibility.ts runs are ALLOWED and return the right set,
//      and a whole-collection list (or any other query that could surface a private task)
//      is REFUSED — before M6d a bare query by an employee returned other people's private tasks;
//   3. writes still behave as before.
const PROJECT = 'demo-etaske';
// Its own database (a fresh id each run), so tasks other harnesses left behind never leak into the query checks.
const DB = process.env.DBID || `taskrules-${Date.now()}`;
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
  const structuredQuery = { from: [{ collectionId: 'tasks' }] };
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

const TASKS = {
  't-pub':    { title: 'Public task', isPrivate: false, assignedToId: 'u-sara', assignedById: 'u-mgr' },
  't-old':    { title: 'Old task, no field', assignedToId: 'u-sara', assignedById: 'u-mgr' },
  't-priv':   { title: 'Private task', isPrivate: true, assignedToId: 'u-sara', assignedById: 'u-sara' },
  't-collab': { title: 'Private, Mona helps', isPrivate: true, assignedToId: 'u-sara', assignedById: 'u-sara', collaboratorIds: ['u-mona'] },
};
for (const [id, d] of Object.entries(TASKS)) await put(`tasks/${id}`, d, OWNER);
await put('tasks/--stats--', { value: 9 }, OWNER);

// Who may read each task by id (unchanged by M6d: a missing field still counts as public).
const SEES = {
  admin:    ['t-old', 't-pub'],
  manager:  ['t-old', 't-pub'],
  owner:    ['t-collab', 't-old', 't-priv', 't-pub'],
  collab:   ['t-collab', 't-old', 't-pub'],
  employee: ['t-old', 't-pub'],
  pending:  [],
};

console.log('\n[1] Reading one task — same people as before');
for (const [who, can] of Object.entries(SEES)) {
  for (const id of Object.keys(TASKS)) {
    expect(`${who} reads ${id}`, await get(`tasks/${id}`, T[who]), can.includes(id));
  }
}
expect('employee reads the serial counter', await get('tasks/--stats--', T.employee), true);

console.log('\n[2] The queries taskVisibility.ts runs are allowed; anything wider is not');
// What the union of the three queries must return per person (an old task with no field only reaches its owner).
const UNION = {
  admin:    ['t-pub'],
  manager:  ['t-pub'],
  owner:    ['t-collab', 't-old', 't-priv', 't-pub'],
  collab:   ['t-collab', 't-pub'],
  employee: ['t-pub'],
};
for (const who of Object.keys(UNION)) {
  const got = new Set();
  for (const f of [['isPrivate', 'EQUAL', false], ['assignedToId', 'EQUAL', me(who)], ['collaboratorIds', 'ARRAY_CONTAINS', me(who)]]) {
    const r = await runQuery(T[who], f);
    expect(`${who} query ${f[0]} ${f[1]}`, r.status, true);
    (r.ids || []).forEach(id => got.add(id));
  }
  same(`${who} sees exactly their tasks through the three queries`, [...got].sort(), UNION[who]);
}
for (const who of ['admin', 'manager', 'owner', 'collab', 'employee', 'pending']) {
  const r = await runQuery(T[who], null);
  expect(`${who} lists the WHOLE tasks collection`, r.status, false);
}
expect('employee asks for private tasks', (await runQuery(T.employee, ['isPrivate', 'EQUAL', true])).status, false);
expect('employee asks for Sara\'s tasks', (await runQuery(T.employee, ['assignedToId', 'EQUAL', 'u-sara'])).status, false);
expect('manager asks for Sara\'s tasks', (await runQuery(T.manager, ['assignedToId', 'EQUAL', 'u-sara'])).status, false);
expect('employee asks for Mona\'s shared tasks', (await runQuery(T.employee, ['collaboratorIds', 'ARRAY_CONTAINS', 'u-mona'])).status, false);
expect('employee asks for tasks Sara assigned', (await runQuery(T.employee, ['assignedById', 'EQUAL', 'u-sara'])).status, false);
expect('pending user asks for public tasks', (await runQuery(T.pending, ['isPrivate', 'EQUAL', false])).status, false);

console.log('\n[3] Writes behave as before');
expect('owner edits own private task', await put('tasks/t-priv', { title: 'x' }, T.owner, ['title']), true);
expect('collaborator edits shared private task', await put('tasks/t-collab', { title: 'x' }, T.collab, ['title']), true);
expect('employee edits someone else\'s private task', await put('tasks/t-priv', { title: 'x' }, T.employee, ['title']), false);
expect('manager edits a private task', await put('tasks/t-priv', { title: 'x' }, T.manager, ['title']), false);
expect('manager edits a public task', await put('tasks/t-pub', { title: 'x' }, T.manager, ['title']), true);
expect('employee creates a task as themselves', await put('tasks/t-new', { title: 'new', isPrivate: false, assignedById: 'u-emp', assignedToId: 'u-emp' }, T.employee), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
