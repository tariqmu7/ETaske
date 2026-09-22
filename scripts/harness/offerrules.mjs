// Firestore RULES check for offer sign-off (queue D10) — runs against the LOCAL emulator only.
//
//   firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/offerrules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
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
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const fields = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])) });

async function put(path, data, auth) {
  const r = await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(fields(data)) });
  return r.status;
}
async function create(coll, id, data, auth) {
  const r = await fetch(`${BASE}/${coll}?documentId=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(fields(data)) });
  return r.status;
}

const OWNER = 'owner';
const MONA = token('u-mona', 'm@x.com');
const MGR = token('u-mgr', 't@x.com');

let pass = 0, fail = 0;
const expect = (label, status, allowed) => {
  const ok = allowed ? status === 200 : status === 403;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label} (${status}, expected ${allowed ? 'allow' : 'deny'})`);
};

await put('users/u-mona', { status: 'Approved', role: 'Employee', displayName: 'Mona' }, OWNER);
await put('users/u-mgr', { status: 'Approved', role: 'Manager', displayName: 'Tariq' }, OWNER);

const base = { title: 'Tank cleaning', stage: 'Bid Preparation', estimatedValue: 1200000, currency: 'EGP', userId: 'u-mona' };
const req = { status: 'requested', amount: 1200000, currency: 'EGP', requestedById: 'u-mona', requestedByName: 'Mona', requestedAt: 1, log: [{ kind: 'requested', byId: 'u-mona', byName: 'Mona', at: 1 }] };
const appr = { ...req, status: 'approved', decidedById: 'u-mgr', decidedByName: 'Tariq', decidedAt: 2, log: [...req.log, { kind: 'approved', byId: 'u-mgr', byName: 'Tariq', at: 2 }] };
const reset = async (id, extra = {}) => put(`opportunities/${id}`, { ...base, ...extra }, OWNER);

await reset('b1');
expect('employee: Bid Preparation → Submitted with no sign-off', await put('opportunities/b1', { ...base, stage: 'Submitted' }, MONA), false);
expect('employee: → Under Evaluation with no sign-off', await put('opportunities/b1', { ...base, stage: 'Under Evaluation' }, MONA), false);
expect('employee: → Won with no sign-off', await put('opportunities/b1', { ...base, stage: 'Won' }, MONA), false);
expect('employee: writes "approved" themselves', await put('opportunities/b1', { ...base, approval: appr }, MONA), false);
expect('employee: → Lost with no sign-off (dropping is free)', await put('opportunities/b1', { ...base, stage: 'Lost' }, MONA), true);
await reset('b1');
expect('employee: asks (status requested)', await put('opportunities/b1', { ...base, approval: req }, MONA), true);
expect('employee: → Submitted while only requested', await put('opportunities/b1', { ...base, approval: req, stage: 'Submitted' }, MONA), false);
expect('manager: approves', await put('opportunities/b1', { ...base, approval: appr }, MGR), true);
expect('employee: edits the title of an approved bid (approval untouched)', await put('opportunities/b1', { ...base, title: 'Tank cleaning 2026', approval: appr }, MONA), true);
expect('employee: → Submitted but with a NEW price', await put('opportunities/b1', { ...base, title: 'Tank cleaning 2026', approval: appr, estimatedValue: 1300000, stage: 'Submitted' }, MONA), false);
expect('employee: → Submitted at the approved price', await put('opportunities/b1', { ...base, title: 'Tank cleaning 2026', approval: appr, stage: 'Submitted' }, MONA), true);
expect('employee: later stage moves on a sent bid', await put('opportunities/b1', { ...base, title: 'Tank cleaning 2026', approval: appr, stage: 'Under Evaluation' }, MONA), true);

await reset('b2', { stage: 'Submitted' });
expect('employee: old sent bid (no approval) → Under Evaluation', await put('opportunities/b2', { ...base, stage: 'Under Evaluation' }, MONA), true);
await reset('b3');
expect('manager: → Submitted with no sign-off (the app signs it for them)', await put('opportunities/b3', { ...base, stage: 'Submitted' }, MGR), true);
await reset('b4', { approval: appr });
expect('employee: sets a stale approval back to "approved" with a new amount', await put('opportunities/b4', { ...base, approval: { ...appr, amount: 1300000 }, estimatedValue: 1300000 }, MONA), false);
expect('employee: re-asks at a new price', await put('opportunities/b4', { ...base, estimatedValue: 1300000, approval: { ...req, amount: 1300000 } }, MONA), true);

expect('employee: creates a bid already "approved"', await create('opportunities', 'n1', { ...base, approval: appr }, MONA), false);
expect('employee: creates a normal bid', await create('opportunities', 'n2', { ...base }, MONA), true);
expect('manager: creates a bid with an approval', await create('opportunities', 'n3', { ...base, userId: 'u-mgr', approval: appr }, MGR), true);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
