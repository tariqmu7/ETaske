// Firestore RULES check for bid privacy, the server lock (queue M6c) — LOCAL emulator only.
//
//   firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/bidrules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
// Same REST + unsigned-token pattern as medicalrules.mjs. Proves:
//   1. a single bid can be read only by who src/lib/bidVisibility.ts says (canSeeBid);
//   2. every query src/lib/bidReads.ts runs for a role is ALLOWED, and a whole-collection
//      list by a non-admin is REFUSED (rules are guards, not filters);
//   3. writes: nobody edits/deletes a bid they cannot see, only the team or a manager
//      changes who sees it, and the value must be one of the three.
const PROJECT = 'demo-etaske';
// Its own database (a fresh id each run), so bids other rules harnesses left behind never leak into the query checks.
const DB = process.env.DBID || `bidrules-${Date.now()}`;
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
const del = async (path, auth) => (await fetch(`${ROOT}/${path}`, { method: 'DELETE', headers: H(auth) })).status;

// A query the way the app's SDK sends it. `filter` = [field, op, value] or none (whole collection).
async function runQuery(auth, filter) {
  const structuredQuery = { from: [{ collectionId: 'opportunities' }] };
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
  admin: ['u-adm', 'adm@x.com'], boot: ['u-boot', 'tarekmoh123@gmail.com'], manager: ['u-mgr', 'mgr@x.com'],
  owner: ['u-sara', 'sara@x.com'], collab: ['u-mona', 'mona@x.com'], creator: ['u-ali', 'ali@x.com'],
  employee: ['u-emp', 'emp@x.com'], pending: ['u-pend', 'pend@x.com'],
};
const T = Object.fromEntries(Object.entries(U).map(([k, [uid, mail]]) => [k, token(uid, mail)]));

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
await put('users/u-boot', { status: 'Approved', role: 'Admin' }, OWNER);
await put('users/u-mgr', { status: 'Approved', role: 'Manager' }, OWNER);
for (const u of ['u-sara', 'u-mona', 'u-ali', 'u-emp']) await put(`users/${u}`, { status: 'Approved', role: 'Employee' }, OWNER);
await put('users/u-pend', { status: 'Pending', role: 'Employee' }, OWNER);

// Same fixture as bidreaders.mjs, plus one bid that still has NO field (pre-M6).
const BIDS = {
  'b-all':    { title: 'Open to all', visibility: 'all', ownerId: 'u-sara', userId: 'u-sara' },
  'b-old':    { title: 'Old bid, no field', ownerId: 'u-sara', userId: 'u-sara' },
  'b-mgrs':   { title: 'Managers bid', visibility: 'managers', ownerId: 'u-sara', userId: 'u-sara' },
  'b-priv':   { title: 'Private bid', visibility: 'private', ownerId: 'u-sara', userId: 'u-sara' },
  'b-collab': { title: 'Private, Mona helps', visibility: 'private', ownerId: 'u-sara', userId: 'u-sara', collaboratorIds: ['u-mona'] },
  'b-made':   { title: 'Private, Ali made it', visibility: 'private', ownerId: 'u-sara', userId: 'u-ali' },
};
const reseed = async () => { for (const [id, d] of Object.entries(BIDS)) await put(`opportunities/${id}`, d, OWNER); };
await reseed();
await put('opportunities/--stats--', { value: 9 }, OWNER);

// Who may read each bid (mirrors bidVisibility.canSeeBid).
const SEES = {
  admin:    ['b-all', 'b-collab', 'b-made', 'b-mgrs', 'b-old', 'b-priv'],
  boot:     ['b-all', 'b-collab', 'b-made', 'b-mgrs', 'b-old', 'b-priv'],
  manager:  ['b-all', 'b-mgrs', 'b-old'],
  owner:    ['b-all', 'b-collab', 'b-made', 'b-mgrs', 'b-old', 'b-priv'],
  collab:   ['b-all', 'b-collab', 'b-old'],
  creator:  ['b-all', 'b-made', 'b-old'],
  employee: ['b-all', 'b-old'],
  pending:  [],
};

console.log('\n[1] Reading one bid — the server agrees with the screens');
for (const [who, can] of Object.entries(SEES)) {
  for (const id of Object.keys(BIDS)) {
    expect(`${who} reads ${id}`, await get(`opportunities/${id}`, T[who]), can.includes(id));
  }
}
expect('employee reads the serial counter', await get('opportunities/--stats--', T.employee), true);

console.log('\n[2] The queries bidReads.ts runs are allowed; the whole book is not');
const me = who => U[who][0];
const QUERIES = who => [
  ['visibility', 'EQUAL', 'all'],
  ...(who === 'manager' ? [['visibility', 'EQUAL', 'managers']] : []),
  ['ownerId', 'EQUAL', me(who)],
  ['userId', 'EQUAL', me(who)],
  ['collaboratorIds', 'ARRAY_CONTAINS', me(who)],
];
for (const who of ['manager', 'owner', 'collab', 'creator', 'employee']) {
  const union = new Set();
  let allOk = true;
  for (const f of QUERIES(who)) {
    const r = await runQuery(T[who], f);
    if (r.status !== 200) { allOk = false; console.log(`        ${who} query ${f.join(' ')} → ${r.status}`); }
    else r.ids.forEach(id => union.add(id));
  }
  expect(`${who}: every one of its queries is allowed`, allOk ? 200 : 403, true);
  // b-old has no field, so no query returns it until the backfill — see scripts/backfill-bid-visibility.ts.
  // b-old is owned by Sara, so only her ownerId/userId queries still reach it.
  same(`${who}: the union is exactly what it may see (minus the un-backfilled bid unless it is theirs)`,
    [...union].sort(), SEES[who].filter(id => id !== 'b-old' || who === 'owner'));
  const whole = await runQuery(T[who]);
  expect(`${who}: whole-collection list is refused${whole.ids ? ` (got ${whole.ids.join(',')})` : ''}`, whole.status, false);
}
expect('employee: query for managers-only bids is refused', (await runQuery(T.employee, ['visibility', 'EQUAL', 'managers'])).status, false);
expect('manager: query for private bids is refused', (await runQuery(T.manager, ['visibility', 'EQUAL', 'private'])).status, false);
expect('employee: query on someone else\'s ownerId is refused', (await runQuery(T.employee, ['ownerId', 'EQUAL', 'u-sara'])).status, false);
const adminAll = await runQuery(T.admin);
expect('admin: whole-collection list is allowed', adminAll.status, true);
same('admin: sees every bid (+ the counter)', adminAll.ids, [...SEES.admin, '--stats--'].sort());
expect('bootstrap admin: whole-collection list is allowed', (await runQuery(T.boot)).status, true);
expect('pending user: even the open query is refused', (await runQuery(T.pending, ['visibility', 'EQUAL', 'all'])).status, false);

console.log('\n[3] Writing');
expect('employee edits an open bid', await put('opportunities/b-all', { notes: 'x' }, T.employee, ['notes']), true);
expect('employee edits a private bid it cannot see', await put('opportunities/b-priv', { notes: 'x' }, T.employee, ['notes']), false);
expect('manager edits a private bid it cannot see', await put('opportunities/b-priv', { notes: 'x' }, T.manager, ['notes']), false);
expect('manager edits a managers-only bid', await put('opportunities/b-mgrs', { notes: 'x' }, T.manager, ['notes']), true);
expect('co-owner edits its private bid', await put('opportunities/b-collab', { notes: 'x' }, T.collab, ['notes']), true);
expect('employee (not team) hides an open bid', await put('opportunities/b-all', { visibility: 'private' }, T.employee, ['visibility']), false);
expect('employee re-saves an open bid with the same setting', await put('opportunities/b-all', { visibility: 'all' }, T.employee, ['visibility']), true);
expect('employee saves an old bid as "all" (its first save after M6)', await put('opportunities/b-old', { visibility: 'all' }, T.employee, ['visibility']), true);
expect('owner makes its bid managers-only', await put('opportunities/b-all', { visibility: 'managers' }, T.owner, ['visibility']), true);
expect('manager opens it back to everyone', await put('opportunities/b-all', { visibility: 'all' }, T.manager, ['visibility']), true);
expect('owner writes a made-up setting', await put('opportunities/b-all', { visibility: 'secret' }, T.owner, ['visibility']), false);
expect('employee creates a private bid of its own', await put('opportunities/b-new', { title: 'New', userId: 'u-emp', visibility: 'private' }, T.employee), true);
expect('…and reads it back', await get('opportunities/b-new', T.employee), true);
expect('…a manager cannot', await get('opportunities/b-new', T.manager), false);
expect('employee creates a bid with a made-up setting', await put('opportunities/b-bad', { title: 'Bad', userId: 'u-emp', visibility: 'secret' }, T.employee), false);
expect('manager deletes a private bid it cannot see', await del('opportunities/b-new', T.manager), false);
expect('admin deletes it', await del('opportunities/b-new', T.admin), true);
expect('manager deletes an open bid (unchanged rule)', await del('opportunities/b-old', T.manager), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
