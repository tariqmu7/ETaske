/**
 * One-time backfill (queue M6c): stamp every `opportunities` document that has
 * no `visibility` field with `visibility: 'all'`.
 *
 * Why (see src/lib/bidReads.ts): once the bid-privacy rules are live, a
 * non-admin lists bids through rule-safe queries — where('visibility', '==',
 * 'all') plus their own bids. A Firestore `==` filter does NOT match a document
 * that lacks the field, so every bid saved before M6 would vanish from everyone
 * but its own team and the admins until it is backfilled.
 *
 * Run it right AFTER the new app code is live (the old app never writes the
 * field, so a bid created in between would be missed) and right BEFORE / with
 *     firebase deploy --only firestore:rules
 *
 *     npx tsx scripts/backfill-bid-visibility.ts           # dry run: lists what it would change
 *     npx tsx scripts/backfill-bid-visibility.ts --write   # backs up every bid, then writes
 *
 * The backup goes OUTSIDE the repo (~/etaske-backups/) — the repo is public.
 * Each write is masked to `visibility` only and carries the document's
 * updateTime as a precondition, so a bid someone saved in the meantime (perhaps
 * made private) is skipped, never overwritten. Idempotent: a second run finds
 * nothing to do. FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 points it at the local
 * emulator instead (used to test it).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

async function getAccessToken(): Promise<string> {
  if (process.env.FIRESTORE_EMULATOR_HOST) return 'owner';
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
  const write = process.argv.includes('--write');
  const emu = process.env.FIRESTORE_EMULATOR_HOST;
  const firebaseConfig = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const projectId: string = emu ? (process.env.PROJECT || 'demo-etaske') : firebaseConfig.projectId;
  const databaseId: string = firebaseConfig.firestoreDatabaseId || '(default)';
  const host = emu ? `http://${emu}` : 'https://firestore.googleapis.com';
  const base = `${host}/v1/projects/${projectId}/databases/${databaseId}/documents/opportunities`;

  console.log(`\n🔒 Bid visibility backfill on ${projectId} / ${databaseId}${emu ? ' (EMULATOR)' : ''} — ${write ? 'WRITE' : 'dry run'}\n`);
  const token = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${token}` };

  const all: any[] = [];
  let pageToken = '';
  do {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { ...authHeader, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${res.statusText} - ${await res.text()}`);
    const data = (await res.json()) as any;
    all.push(...(data.documents ?? []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  const bids = all.filter(d => String(d.name).split('/').pop() !== '--stats--');
  const todo = bids.filter(d => !(d.fields && 'visibility' in d.fields));
  const label = (d: any) => `${String(d.name).split('/').pop()}  ${d.fields?.serialNumber?.stringValue || ''}  ${d.fields?.title?.stringValue || ''}`;
  console.log(`${bids.length} bids — ${bids.length - todo.length} already have a setting, ${todo.length} need 'all':`);
  todo.forEach(d => console.log(`  · ${label(d)}`));

  if (!write || !todo.length) {
    console.log(write ? '\n✅ Nothing to do.\n' : '\nDry run — nothing written. Add --write to back up and write.\n');
    return;
  }

  const dir = path.join(os.homedir(), 'etaske-backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `opportunities-before-visibility-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(all, null, 2), 'utf8');
  console.log(`\n💾 Backup of all ${all.length} docs: ${backup}`);

  // One atomic commit (a few dozen bids, far under the 500-write limit): if any
  // bid changed since the read, NOTHING is written and a re-run starts clean.
  const writes = todo.map(d => ({
    update: { name: d.name, fields: { visibility: { stringValue: 'all' } } },
    updateMask: { fieldPaths: ['visibility'] },
    currentDocument: { updateTime: d.updateTime },
  }));
  const res = await fetch(`${host}/v1/projects/${projectId}/databases/${databaseId}/documents:commit`, {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) throw new Error(`Nothing written — ${res.status} ${(await res.text()).slice(0, 300)} (a bid changed since the read? run again)`);
  console.log(`\n✅ Done. ${todo.length} set to 'all'.\n`);
}

run().then(() => process.exit(0)).catch(err => { console.error('Backfill failed:', err); process.exit(1); });
