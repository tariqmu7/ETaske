/**
 * One-time backfill: stamp every existing `tasks` document with `isPrivate:
 * false` if the field is missing.
 *
 * Why this is required (see src/lib/taskVisibility.ts): once the privacy rules
 * are live, clients read tasks via the union of
 *     where('isPrivate', '==', false)   // public board
 *   + where('assignedToId', '==', uid)  // own tasks
 * A Firestore `==` filter does NOT match documents that lack the field, so any
 * pre-existing task without `isPrivate` would silently disappear from every
 * non-owner's board until it is backfilled. (The rules treat a missing field as
 * public, so this is a query-visibility fix, not a security one.)
 *
 * Run this BEFORE — or immediately alongside — deploying the new rules:
 *     npm run firestore:backfill-privacy
 *
 * It talks to the same named production database as scripts/firestore-backup.ts
 * via the Firestore REST API and your `firebase login` credentials. It is
 * idempotent: documents that already have `isPrivate` are skipped.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

async function getAccessToken(): Promise<string> {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Firebase CLI config not found at: ${configPath}. Please run 'firebase login' first.`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;
  if (!tokens) throw new Error("No authenticated session. Please run 'firebase login'.");

  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) throw new Error("Refresh token not found. Please run 'firebase login'.");

  const clientId = config.user?.azp || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) throw new Error(`Failed to refresh token: ${response.statusText} - ${await response.text()}`);
  const data = (await response.json()) as any;
  config.tokens.access_token = data.access_token;
  config.tokens.expires_at = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'), 'utf8');
  return data.access_token;
}

async function run() {
  const firebaseConfig = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const projectId: string = firebaseConfig.projectId;
  const databaseId: string = firebaseConfig.firestoreDatabaseId || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/tasks`;

  console.log(`\n🔒 Backfilling tasks.isPrivate=false on ${projectId} / ${databaseId}\n`);
  const token = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  let pageToken = '';
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  do {
    const url = pageToken ? `${base}?pageToken=${pageToken}&pageSize=300` : `${base}?pageSize=300`;
    const res = await fetch(url, { headers: { ...authHeader, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${res.statusText} - ${await res.text()}`);
    const data = (await res.json()) as any;

    for (const docu of data.documents ?? []) {
      const docId = String(docu.name).split('/').pop();
      if (docId === '--stats--') { skipped++; continue; }
      scanned++;
      if (docu.fields && 'isPrivate' in docu.fields) { skipped++; continue; }

      // PATCH only the isPrivate field (merge) — leaves everything else intact.
      const patchUrl = `https://firestore.googleapis.com/v1/${docu.name}?updateMask.fieldPaths=isPrivate`;
      const patch = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { isPrivate: { booleanValue: false } } }),
      });
      if (!patch.ok) {
        console.error(`  ❌ ${docId}: ${patch.status} ${await patch.text()}`);
      } else {
        updated++;
        if (updated % 25 === 0) console.log(`  …${updated} updated`);
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  console.log(`\n✅ Done. Scanned ${scanned} task docs — updated ${updated}, already-set/skipped ${skipped}.\n`);
}

run().then(() => process.exit(0)).catch(err => { console.error('Backfill failed:', err); process.exit(1); });
