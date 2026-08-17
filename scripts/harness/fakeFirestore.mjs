// The fake Firestore both click-through harnesses run against.
//
// Extracted from inboxconvert.mjs so i18nrtl.mjs can mount the real dashboards
// against the SAME store instead of a second, subtly different one. It is an
// esbuild-injectable SOURCE STRING, not a module: it is compiled into the page
// bundle in place of `firebase/firestore`, so the components under test import
// it exactly the way they import the real SDK.
//
// Enough of the API for the real modules to run unmodified. Every write is
// appended to window.__writes, which is what the assertions read.
export const FIRESTORE_STUB = `
const store = new Map();               // collection -> Map(id -> data)
const listeners = [];
let seq = 0;
const coll = name => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
globalThis.__store = store;
globalThis.__writes = [];
globalThis.__seed = (name, id, data) => { coll(name).set(id, data); };

export function collection(_db, name) { return { __coll: name }; }
export function doc(_db, name, id) { return { __coll: name, id }; }
export function where(field, op, value) { return { __t: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { __t: 'orderBy', field, dir }; }
export function limit(n) { return { __t: 'limit', n }; }
export function query(c, ...cs) { return { __coll: c.__coll, __cs: cs }; }

// Real Firestore never leaves a serverTimestamp() sentinel readable: the doc
// comes back with a Timestamp (or null while pending). Mirror that, or the
// consumers' \`createdAt.toDate()\` calls would blow up on a sentinel object.
function stamp() {
  const d = new Date();
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => d };
}
function materialize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = (v && v.__serverTimestamp) ? stamp() : v;
  return out;
}
function valOf(v) { return v && typeof v.seconds === 'number' ? v.seconds : v; }
function rows(q) {
  let out = [...coll(q.__coll).entries()].map(([id, data]) => ({ id, data }));
  for (const c of (q.__cs || [])) {
    if (c.__t === 'where') {
      out = out.filter(r => c.op === 'array-contains'
        ? Array.isArray(r.data[c.field]) && r.data[c.field].includes(c.value)
        : r.data[c.field] === c.value);
    }
  }
  for (const c of (q.__cs || [])) {
    if (c.__t === 'orderBy') {
      out.sort((a, b) => {
        const x = valOf(a.data[c.field]), y = valOf(b.data[c.field]);
        const n = x === y ? 0 : (x > y ? 1 : -1);
        return c.dir === 'desc' ? -n : n;
      });
    }
  }
  for (const c of (q.__cs || [])) if (c.__t === 'limit') out = out.slice(0, c.n);
  return out;
}
function snapshot(q) {
  return { docs: rows(q).map(r => ({ id: r.id, exists: () => true, data: () => ({ ...r.data }) })) };
}
function emit() { for (const l of [...listeners]) { try { l.next(snapshot(l.q)); } catch (e) { console.error(e); } } }
globalThis.__emit = emit;

export function onSnapshot(q, next, _err) {
  const l = { q: q.__cs ? q : { __coll: q.__coll, __cs: [] }, next };
  listeners.push(l);
  Promise.resolve().then(() => next(snapshot(l.q)));
  return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
}
export async function getDocs(q) { return snapshot(q.__cs ? q : { __coll: q.__coll, __cs: [] }); }
export async function getDoc(ref) {
  const d = coll(ref.__coll).get(ref.id);
  return { id: ref.id, exists: () => d !== undefined, data: () => (d ? { ...d } : undefined) };
}
export async function addDoc(c, data) {
  const id = 'doc' + (++seq);
  coll(c.__coll).set(id, materialize(data));
  globalThis.__writes.push({ op: 'add', path: c.__coll + '/' + id, data: { ...data } });
  emit();
  return { id, __coll: c.__coll };
}
export async function updateDoc(ref, data) {
  const m = coll(ref.__coll);
  if (!m.has(ref.id)) throw new Error('no such doc ' + ref.__coll + '/' + ref.id);
  // deleteField() REMOVES the key in real Firestore. Merging the sentinel in as
  // a value instead would leave a truthy \`opportunityId\` behind and make an
  // unlinked record look linked.
  const merged = { ...m.get(ref.id), ...materialize(data) };
  for (const [k, v] of Object.entries(data)) if (v && v.__deleteField) delete merged[k];
  m.set(ref.id, merged);
  globalThis.__writes.push({ op: 'update', path: ref.__coll + '/' + ref.id, data: { ...data } });
  emit();
}
export async function setDoc(ref, data, opts) {
  const m = coll(ref.__coll);
  m.set(ref.id, opts && opts.merge ? { ...(m.get(ref.id) || {}), ...materialize(data) } : materialize(data));
  globalThis.__writes.push({ op: 'set', path: ref.__coll + '/' + ref.id, data: { ...data } });
  emit();
}
export async function deleteDoc(ref) {
  coll(ref.__coll).delete(ref.id);
  globalThis.__writes.push({ op: 'delete', path: ref.__coll + '/' + ref.id });
  emit();
}
export async function runTransaction(_db, fn) {
  return fn({
    get: ref => getDoc(ref),
    set: (ref, data, opts) => { setDoc(ref, data, opts); },
    update: (ref, data) => { updateDoc(ref, data); },
    delete: ref => { deleteDoc(ref); },
  });
}
export function serverTimestamp() { return { __serverTimestamp: true }; }
export function increment(n) { return { __increment: n }; }
export function arrayUnion(...v) { return { __arrayUnion: v }; }
export function arrayRemove(...v) { return { __arrayRemove: v }; }
export function writeBatch() { return { set() {}, update() {}, delete() {}, commit: async () => {} }; }
export function deleteField() { return { __deleteField: true }; }
export const Timestamp = {
  now: () => ({ seconds: Math.floor(Date.now() / 1000), toDate: () => new Date() }),
  fromDate: d => ({ seconds: Math.floor(d.getTime() / 1000), toDate: () => d }),
};
`;
