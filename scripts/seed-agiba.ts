// Seeds the Agiba/Meleiha sample project into the (named) Firestore DB using the
// Firestore REST API + the local `firebase login` token — same mechanism as
// scripts/firestore-restore.ts. Idempotent: uses deterministic doc IDs, so
// re-running overwrites instead of duplicating.
//
// Prereqs:  firebase login   (and `npm i` so tsx is available)
// Run:      npx tsx scripts/seed-agiba.ts
//           (regenerate the data first with: python scripts/extract-agiba.py)
import fs from 'fs';
import path from 'path';
import os from 'os';

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
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) throw new Error(`Failed to refresh token: ${response.statusText} - ${await response.text()}`);
  const data = await response.json() as any;
  config.tokens.access_token = data.access_token;
  config.tokens.expires_at = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'), 'utf8');
  return data.access_token;
}

const TIMESTAMP_KEYS = new Set(['createdAt', 'updatedAt', 'lastUpdateAt']);

function encodeValue(key: string, v: any): any {
  if (TIMESTAMP_KEYS.has(key)) return { timestampValue: new Date().toISOString() };
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function toFields(doc: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'id') continue;
    if (v === '' && !TIMESTAMP_KEYS.has(k)) continue; // drop empties to keep docs tidy
    fields[k] = encodeValue(k, v);
  }
  // stamp timestamps even if not present in source
  fields.createdAt = { timestampValue: new Date().toISOString() };
  fields.updatedAt = { timestampValue: new Date().toISOString() };
  return fields;
}

async function run() {
  const seedPath = path.resolve('scripts/agiba-seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}\nRun: python scripts/extract-agiba.py`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const projectId = cfg.projectId;
  const databaseId = cfg.firestoreDatabaseId || '(default)';
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  console.log(`\n🔥 Seeding Agiba project  → project=${projectId}  db=${databaseId}\n`);
  const token = await getAccessToken();

  for (const collection of Object.keys(seed)) {
    const docs: any[] = seed[collection];
    let ok = 0;
    for (const d of docs) {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collection}/${encodeURIComponent(d.id)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFields(d) }),
      });
      if (res.ok) ok++;
      else console.error(`  ❌ ${collection}/${d.id}: ${res.status} ${await res.text()}`);
    }
    console.log(`  ✅ ${collection}: ${ok}/${docs.length}`);
  }

  // Bump the projects serial counter so app-created projects continue the sequence.
  const counterUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/projects/--stats--`;
  await fetch(counterUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { value: { integerValue: String(seed.projects.length) } } }),
  });

  console.log('\n🎉 Done.\n');
}

run().then(() => process.exit(0)).catch(err => { console.error('Seed failed:', err); process.exit(1); });
