// Seeds the "External work" pipeline (a colleague's external-business opportunities,
// received as External work.docx on 2026-08-13) into the opportunities module of the
// NAMED Firestore DB, using the Firestore REST API + the local `firebase login` token
// — same mechanism as scripts/seed-agiba.ts and scripts/firestore-restore.ts.
//
// Idempotent: deterministic doc ids (ext-*), so re-running overwrites instead of
// duplicating. Serial numbers (OP00000n) are only assigned to docs that do not
// already have one, and the opportunities/--stats-- counter is advanced (never
// rewound) so app-created bids continue the sequence.
//
// The same script also seeds any other file in the identical shape — pass
// --file=<path>. Used for scripts/international-registrations-seed.json (the
// International Department's Global Entity Qualification & Registration Status
// report, 16/08/2026).
//
// Prereqs:  firebase login   (and `npm i` so tsx is available)
// Run:      npx tsx scripts/seed-external-work.ts
//           npx tsx scripts/seed-external-work.ts --dry-run    (print, write nothing)
//           npx tsx scripts/seed-external-work.ts --file=scripts/international-registrations-seed.json
import fs from 'fs';
import path from 'path';
import os from 'os';

const DRY = process.argv.includes('--dry-run');
const SEED_FILE = (process.argv.find(a => a.startsWith('--file=')) || '').slice('--file='.length)
  || 'scripts/external-work-seed.json';

// The pipeline owner. Resolved to a uid from the users collection; the docs are
// stamped with it so the bids show up as owned rather than orphaned.
const OWNER_EMAIL = 'tarekmoh123@gmail.com';

async function getAccessToken(): Promise<string> {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Firebase CLI config not found at: ${configPath}. Run 'firebase login' first.`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;
  if (!tokens) throw new Error("No authenticated session. Run 'firebase login'.");

  const now = Date.now();
  if (tokens.access_token && tokens.expires_at && now < tokens.expires_at - 60000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new Error("Refresh token not found. Run 'firebase login'.");

  const clientId = config.user?.azp || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  // Google's token endpoint rejects the refresh without a client_secret. This is the
  // installed-app secret that ships in the open-source firebase-tools CLI (not a real
  // secret — an installed OAuth client cannot keep one); override with FIREBASE_CLIENT_SECRET
  // if the CLI ever rotates it.
  const clientSecret = process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) throw new Error(`Failed to refresh token: ${response.statusText} - ${await response.text()}`);
  const data = await response.json() as any;
  config.tokens.access_token = data.access_token;
  config.tokens.expires_at = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'), 'utf8');
  return data.access_token;
}

const TIMESTAMP_KEYS = new Set(['createdAt', 'updatedAt', 'lastFollowUpAt']);

function encodeValue(key: string, v: any): any {
  if (TIMESTAMP_KEYS.has(key)) return { timestampValue: new Date().toISOString() };
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(x => encodeValue('', x)) } };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}

function toFields(doc: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'id' || v === undefined || v === null || v === '') continue;
    fields[k] = encodeValue(k, v);
  }
  fields.createdAt = { timestampValue: new Date().toISOString() };
  fields.updatedAt = { timestampValue: new Date().toISOString() };
  return fields;
}

function decode(v: any): any {
  if (!v) return null;
  const k = Object.keys(v)[0];
  if (k === 'mapValue') return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([a, b]) => [a, decode(b)]));
  if (k === 'arrayValue') return (v.arrayValue.values || []).map(decode);
  return (v as any)[k];
}
const decodeDoc = (d: any) => ({ id: String(d.name).split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([a, b]) => [a, decode(b)])) } as any);

async function run() {
  const seedPath = path.resolve(SEED_FILE);
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const projectId = cfg.projectId;
  const databaseId = cfg.firestoreDatabaseId || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const items: any[] = seed.opportunities;

  console.log(`\n🔥 Seeding ${path.basename(seedPath)} → project=${projectId}  db=${databaseId}  ${DRY ? '(DRY RUN)' : ''}\n`);
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };

  // ── Resolve the owner uid ───────────────────────────────────────────────────
  const usersRes = await fetch(`${base}/users?pageSize=300`, { headers: auth });
  if (!usersRes.ok) throw new Error(`users read failed: ${usersRes.status} ${await usersRes.text()}`);
  const users = ((await usersRes.json() as any).documents || []).map(decodeDoc);
  const owner = users.find((u: any) => (u.email || '').toLowerCase() === OWNER_EMAIL);
  if (!owner) console.warn(`  ⚠ owner ${OWNER_EMAIL} not found in users — docs will be written without ownerId/userId`);
  else console.log(`  owner: ${owner.displayName} <${owner.email}> (${owner.id})`);

  // ── Existing bids: don't reissue serials, and find the high-water mark ──────
  const oppRes = await fetch(`${base}/opportunities?pageSize=500`, { headers: auth });
  if (!oppRes.ok) throw new Error(`opportunities read failed: ${oppRes.status} ${await oppRes.text()}`);
  const existing = ((await oppRes.json() as any).documents || []).map(decodeDoc).filter((d: any) => d.id !== '--stats--');
  const bySerial = new Map(existing.map((d: any) => [d.id, d.serialNumber]));
  let maxSerial = 0;
  for (const d of existing) {
    const n = parseInt(String(d.serialNumber || '').replace(/^OP/, ''), 10);
    if (Number.isFinite(n)) maxSerial = Math.max(maxSerial, n);
  }
  console.log(`  existing opportunities: ${existing.length} (highest serial OP${String(maxSerial).padStart(6, '0')})\n`);

  // ── Write ───────────────────────────────────────────────────────────────────
  let next = maxSerial;
  let ok = 0;
  for (const item of items) {
    const { followUpStage, ...rest } = item;
    const serial = bySerial.get(item.id) || `OP${String(++next).padStart(6, '0')}`;
    const doc = {
      ...rest,
      serialNumber: serial,
      ...(owner ? { userId: owner.id, ownerId: owner.id, ownerName: owner.displayName } : {}),
      // toFields() turns every TIMESTAMP_KEYS entry into a timestampValue of "now",
      // so the value here only has to be present, not correct.
      lastFollowUpAt: new Date().toISOString(),
    };

    if (DRY) { console.log(`  · ${serial}  ${item.stage.padEnd(16)} ${item.title}`); ok++; continue; }

    const res = await fetch(`${base}/opportunities/${encodeURIComponent(item.id)}`, {
      method: 'PATCH', headers: jsonAuth, body: JSON.stringify({ fields: toFields(doc) }),
    });
    if (!res.ok) { console.error(`  ❌ ${item.id}: ${res.status} ${await res.text()}`); continue; }

    // Mirror the status line into opportunityFollowUps so it shows in the timeline.
    const fu = {
      opportunityId: item.id,
      text: item.lastFollowUpText,
      stage: followUpStage || item.stage,
      ...(item.nextActionDate ? { nextActionDate: item.nextActionDate } : {}),
      ...(owner ? { authorId: owner.id, authorName: owner.displayName } : {}),
    };
    const fuRes = await fetch(`${base}/opportunityFollowUps/${encodeURIComponent(item.id + '-initial')}`, {
      method: 'PATCH', headers: jsonAuth, body: JSON.stringify({ fields: toFields(fu) }),
    });
    if (!fuRes.ok) console.error(`  ⚠ follow-up ${item.id}: ${fuRes.status} ${await fuRes.text()}`);

    console.log(`  ✅ ${serial}  ${item.stage.padEnd(16)} ${item.title}`);
    ok++;
  }

  // ── Advance the serial counter (never rewind) ───────────────────────────────
  if (!DRY && next > maxSerial) {
    const cRes = await fetch(`${base}/opportunities/--stats--`, {
      method: 'PATCH', headers: jsonAuth,
      body: JSON.stringify({ fields: { value: { integerValue: String(next) } } }),
    });
    if (!cRes.ok) console.error(`  ⚠ counter: ${cRes.status} ${await cRes.text()}`);
    else console.log(`\n  counter opportunities/--stats-- → ${next}`);
  }

  console.log(`\n🎉 ${ok}/${items.length} opportunities ${DRY ? 'previewed' : 'written'}.\n`);
}

run().then(() => process.exit(0)).catch(err => { console.error('Seed failed:', err); process.exit(1); });
