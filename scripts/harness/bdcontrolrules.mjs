// Firestore RULES check for the BD control section (queue E4) — LOCAL emulator only.
//
//   npx firebase emulators:exec --only firestore --project demo-etaske "node scripts/harness/bdcontrolrules.mjs"
//
// Needs Java. Never points at the live project (demo-* projects cannot reach production).
// Same REST + unsigned-token pattern as medicalrules.mjs. Every row below is MADE UP — the repo is public,
// the real data lives only in Firestore and BD's folder.
const PROJECT = 'demo-etaske';
const DB = process.env.DBID || 'ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6';
const ROOT = `projects/${PROJECT}/databases/${DB}/documents`;
const BASE = `http://127.0.0.1:8080/v1/${ROOT}`;

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid, email) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, email, email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' },
})}.`;

const enc = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const H = auth => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` });

const put = async (path, data, auth) =>
  (await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: H(auth), body: JSON.stringify({ fields: fields(data) }) })).status;
const get = async (path, auth) => (await fetch(`${BASE}/${path}`, { headers: H(auth) })).status;
const list = async (coll, auth) => (await fetch(`${BASE}/${coll}`, { headers: H(auth) })).status;
const del = async (path, auth) => (await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H(auth) })).status;
// Like the app's updateDoc(ref, {..., lastEditedAt: serverTimestamp()}): only the given fields, server time stamped.
// `stamp` = which fields get the server's request time (default lastEditedAt).
async function edit(path, data, auth, { stamp = ['lastEditedAt'], exists = true } = {}) {
  const write = {
    update: { name: `${ROOT}/${path}`, fields: fields(data) },
    updateMask: { fieldPaths: Object.keys(data) },
    updateTransforms: stamp.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })),
    currentDocument: { exists },
  };
  return (await fetch(`${BASE}:commit`, { method: 'POST', headers: H(auth), body: JSON.stringify({ writes: [write] }) })).status;
}
// Like addDoc(collection(row, 'history'), {..., at: serverTimestamp()}).
const addHistory = (path, data, auth, stamp = ['at']) => edit(path, data, auth, { stamp, exists: false });

const OWNER = 'owner';
const BOOT = token('u-boot', 'tarekmoh123@gmail.com');
const ADMIN = token('u-admin', 'boss@x.com');
const MGR = token('u-mgr', 'mgr@x.com');
const EMP = token('u-emp', 'emp@x.com');
const PMGR = token('u-pmgr', 'pmgr@x.com');
const MED = token('u-med', 'med@x.com');

let pass = 0, fail = 0;
const expect = (label, status, allowed) => {
  const ok = allowed ? status === 200 : status === 403;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label} (${status}, expected ${allowed ? 'allow' : 'deny'})`);
};

await put('users/u-boot', { status: 'Approved', role: 'Admin', displayName: 'Tariq' }, OWNER);
await put('users/u-admin', { status: 'Approved', role: 'Admin', displayName: 'Second admin' }, OWNER);
await put('users/u-mgr', { status: 'Approved', role: 'Manager', displayName: 'Manager' }, OWNER);
await put('users/u-emp', { status: 'Approved', role: 'Employee', displayName: 'Employee' }, OWNER);
await put('users/u-pmgr', { status: 'Pending', role: 'Manager', displayName: 'Pending manager' }, OWNER);
await put('users/u-med', { status: 'Approved', role: 'Employee', displayName: 'Medical editor', medicalContractsAccess: 'edit' }, OWNER);

const CC = 'bdControl/clientContracts/rows/TESTCO_1_O-M';
const ROW = { sr: 1, client: 'TESTCO', contractType: 'O&M', expiryDate: '2027-01-31', ceilingEgp: 1000000, status: 'Active' };
await put('bdControl/meta', { asof: '2026-01-01', loadedBy: 'loader' }, OWNER);
await put(CC, ROW, OWNER);
await put('bdControl/dayRates/rows/TESTCO_Engineer', { client: 'TESTCO', grade: 'Engineer', dayRateEgp: 5000 }, OWNER);
await put('bdControl/changes/rows/TESTCO_O-M_Ceiling', { client: 'TESTCO', field: 'Ceiling', march2026: 1, september2026: 2 }, OWNER);
await put('bdControl/dataIssues/rows/Clients_1', { table: 'Clients', issue: 'made up' }, OWNER);
await put(`${CC}/history/h0`, { field: 'status', from: 'Draft', to: 'Active', byUid: 'u-mgr', byName: 'Manager' }, OWNER);

console.log('\n[1] Who can read');
expect('bootstrap admin reads a row', await get(CC, BOOT), true);
expect('admin (role) reads a row', await get(CC, ADMIN), true);
expect('Manager reads a row', await get(CC, MGR), true);
expect('Manager lists client contracts', await list('bdControl/clientContracts/rows', MGR), true);
expect('Manager reads meta', await get('bdControl/meta', MGR), true);
expect('Manager reads a data issue', await get('bdControl/dataIssues/rows/Clients_1', MGR), true);
expect('Manager reads a Mar→Sep change', await get('bdControl/changes/rows/TESTCO_O-M_Ceiling', MGR), true);
expect('Manager reads a row history', await list(`${CC}/history`, MGR), true);
expect('Employee reads a row', await get(CC, EMP), false);
expect('Employee lists client contracts', await list('bdControl/clientContracts/rows', EMP), false);
expect('Employee reads meta', await get('bdControl/meta', EMP), false);
expect('Employee reads a row history', await list(`${CC}/history`, EMP), false);
expect('Medical "edit" Employee reads (medical switch is NOT enough)', await get(CC, MED), false);
expect('Pending Manager reads', await get(CC, PMGR), false);
expect('Manager reads a table that is not on the list', await get('bdControl/secret/rows/x', MGR), false);

const note = (f, excelValue) => ({ [f]: { excelValue, byName: 'Manager', at: '2026-10-19T10:00:00Z' } });
const good = { ceilingEgp: 1200000, appEdits: note('ceilingEgp', 1000000), lastEditedBy: 'u-mgr' };

console.log('\n[2] Who can edit, and how');
expect('Employee edits a row', await edit(CC, { ...good, lastEditedBy: 'u-emp' }, EMP), false);
expect('Medical "edit" Employee edits a row', await edit(CC, { ...good, lastEditedBy: 'u-med' }, MED), false);
expect('Pending Manager edits a row', await edit(CC, { ...good, lastEditedBy: 'u-pmgr' }, PMGR), false);
expect('Manager edits with no appEdits note', await edit(CC, { ceilingEgp: 1200000, lastEditedBy: 'u-mgr' }, MGR), false);
expect('Manager edits, note is for another field', await edit(CC, { ...good, appEdits: note('status', 'Active') }, MGR), false);
expect('Manager adds a field that is not on the list', await edit(CC, { ...good, secretMargin: 25, appEdits: { ...note('ceilingEgp', 1e6), ...note('secretMargin', null) } }, MGR), false);
expect('Manager signs as someone else', await edit(CC, { ...good, lastEditedBy: 'u-admin' }, MGR), false);
expect('Manager sets own edit time (not server time)', await edit(CC, { ...good, lastEditedAt: new Date('2020-01-01') }, MGR, { stamp: [] }), false);
expect('Manager edits with no edit time', await edit(CC, good, MGR, { stamp: [] }), false);
expect('Manager edits a row correctly', await edit(CC, good, MGR), true);
expect('Manager drops the earlier note while editing another field', await edit(CC, { status: 'Closed', appEdits: note('status', 'Active'), lastEditedBy: 'u-mgr' }, MGR), false);
expect('Manager edits a second field, keeping the first note', await edit(CC, { status: 'Closed', appEdits: { ...note('ceilingEgp', 1000000), ...note('status', 'Active') }, lastEditedBy: 'u-mgr' }, MGR), true);
expect('Manager only re-stamps (no real change)', await edit(CC, { lastEditedBy: 'u-mgr' }, MGR), false);
expect('admin edits a day rate', await edit('bdControl/dayRates/rows/TESTCO_Engineer', { dayRateEgp: 5500, appEdits: note('dayRateEgp', 5000), lastEditedBy: 'u-admin' }, ADMIN), true);
expect('Manager edits a data issue (loader-only)', await edit('bdControl/dataIssues/rows/Clients_1', { issue: 'x', appEdits: note('issue', 'made up'), lastEditedBy: 'u-mgr' }, MGR), false);
expect('Manager edits a Mar→Sep change (loader-only)', await edit('bdControl/changes/rows/TESTCO_O-M_Ceiling', { september2026: 3, appEdits: note('september2026', 2), lastEditedBy: 'u-mgr' }, MGR), false);
expect('admin writes meta', await put('bdControl/meta', { asof: '2030-01-01' }, ADMIN), false);
expect('Manager creates a new row', await edit('bdControl/clientContracts/rows/NEW_1_O-M', { ...ROW, appEdits: {}, lastEditedBy: 'u-mgr' }, MGR, { exists: false }), false);
expect('admin deletes a row', await del(CC, BOOT), false);

const H1 = { field: 'ceilingEgp', from: 1000000, to: 1200000, byUid: 'u-mgr', byName: 'Manager' };
console.log('\n[3] Change history (append-only)');
expect('Manager adds a history line', await addHistory(`${CC}/history/h1`, H1, MGR), true);
expect('Employee adds a history line', await addHistory(`${CC}/history/h2`, { ...H1, byUid: 'u-emp' }, EMP), false);
expect('Manager adds a line signed as someone else', await addHistory(`${CC}/history/h3`, { ...H1, byUid: 'u-admin' }, MGR), false);
expect('Manager adds a line for a field not on the list', await addHistory(`${CC}/history/h4`, { ...H1, field: 'secretMargin' }, MGR), false);
expect('Manager adds a line with an extra key', await addHistory(`${CC}/history/h5`, { ...H1, note: 'x' }, MGR), false);
expect('Manager adds a line with own time', await addHistory(`${CC}/history/h6`, { ...H1, at: new Date('2020-01-01') }, MGR, []), false);
expect('Manager adds a line under a row that does not exist', await addHistory('bdControl/clientContracts/rows/NOPE/history/h7', H1, MGR), false);
expect('Manager adds a line under a data issue', await addHistory('bdControl/dataIssues/rows/Clients_1/history/h8', { ...H1, field: 'issue' }, MGR), false);
expect('Manager rewrites a history line', await edit(`${CC}/history/h0`, { to: 'Closed' }, MGR, { stamp: [] }), false);
expect('admin deletes a history line', await del(`${CC}/history/h0`, BOOT), false);

// [4] The app's own save (queue E6b, src/lib/bdControlSave.ts): ONE commit = the row update (the whole
// appEdits map written back, each note's `at` + lastEditedAt = server time) + one history doc per field.
async function appSave(rowPath, changed, notes, uid, auth, history) {
  const appEdits = Object.fromEntries(Object.entries(notes).map(([f, n]) => [f, { excelValue: n.excelValue, byName: n.byName }]));
  const writes = [{
    update: { name: `${ROOT}/${rowPath}`, fields: fields({ ...changed, appEdits, lastEditedBy: uid }) },
    updateMask: { fieldPaths: [...Object.keys(changed), 'appEdits', 'lastEditedBy'] },
    updateTransforms: [...Object.keys(notes).map(f => ({ fieldPath: `appEdits.${f}.at`, setToServerValue: 'REQUEST_TIME' })),
      { fieldPath: 'lastEditedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true },
  }, ...history.map((h, i) => ({
    update: { name: `${ROOT}/${rowPath}/history/app${Date.now()}_${i}`, fields: fields(h) },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: false },
  }))];
  return (await fetch(`${BASE}:commit`, { method: 'POST', headers: H(auth), body: JSON.stringify({ writes }) })).status;
}
const SC = 'bdControl/supplierContracts/rows/T-9';
await put(SC, { contractNo: 'T/9', status: 'In Progress', currentEnd: '2027-01-01', currentValueEgp: 100 }, OWNER);
const hl = (field, from, to, uid = 'u-mgr') => ({ field, from, to, byUid: uid, byName: 'Manager' });
const n3 = by => ({ status: { excelValue: 'In Progress', byName: by }, currentEnd: { excelValue: '2027-01-01', byName: by }, currentValueEgp: { excelValue: 100, byName: by } });
console.log("\n[4] The app's save: row + history in one batch");
expect('Manager saves two fields + two history lines in one batch', await appSave(SC, { status: 'Completed', currentEnd: '2027-06-30' },
  { status: { excelValue: 'In Progress', byName: 'Manager' }, currentEnd: { excelValue: '2027-01-01', byName: 'Manager' } }, 'u-mgr', MGR,
  [hl('status', 'In Progress', 'Completed'), hl('currentEnd', '2027-01-01', '2027-06-30')]), true);
expect('… a later save keeps both notes and adds one', await appSave(SC, { currentValueEgp: 150 }, n3('Manager'), 'u-mgr', MGR,
  [hl('currentValueEgp', 100, 150)]), true);
expect('… one bad history line refuses the WHOLE batch', await appSave(SC, { currentValueEgp: 175 }, n3('Manager'), 'u-mgr', MGR,
  [hl('currentValueEgp', 150, 175, 'u-admin')]), false);
expect('… and an Employee cannot run the same batch', await appSave(SC, { currentValueEgp: 175 }, n3('E'), 'u-emp', EMP,
  [hl('currentValueEgp', 150, 175, 'u-emp')]), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
