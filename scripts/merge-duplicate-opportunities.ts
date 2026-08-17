// Resolves the two duplicate pairs found in the opportunities pipeline (2026-08-17).
// Each source report contributed one copy of the same real-world record:
//
//   Jordan  : OP000010 ext-edc-jordan          -> merge into OP000019 intl-adc-jordan-tender
//   Ramboll : OP000012 9QBwXC0jvDXhFoxseCjE    -> merge into OP000014 intl-ramboll-denmark
//
// "Merge" = carry the loser's follow-up text over as a dated follow-up on the keeper
// (so no wording is lost), then delete the loser and its own follow-ups. The
// opportunities/--stats-- counter is deliberately NOT rewound: serial numbers must
// never be reissued.
//
// Run:  npx tsx scripts/merge-duplicate-opportunities.ts --dry-run
//       npx tsx scripts/merge-duplicate-opportunities.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

const DRY = process.argv.includes('--dry-run');

async function getAccessToken(): Promise<string> {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(configPath)) throw new Error(`Run 'firebase login' first (${configPath} missing).`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;
  if (!tokens) throw new Error("No authenticated session. Run 'firebase login'.");
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60000) return tokens.access_token;
  const clientId = config.user?.azp || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  // See seed-external-work.ts: the refresh needs the CLI's public installed-app secret.
  const clientSecret = process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) throw new Error(`Failed to refresh token: ${response.status} ${await response.text()}`);
  const data = await response.json() as any;
  config.tokens.access_token = data.access_token;
  config.tokens.expires_at = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(configPath, JSON.stringify(config, null, '\t'), 'utf8');
  return data.access_token;
}

function decode(v: any): any {
  if (!v) return null;
  const k = Object.keys(v)[0];
  if (k === 'mapValue') return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([a, b]) => [a, decode(b)]));
  if (k === 'arrayValue') return (v.arrayValue.values || []).map(decode);
  return (v as any)[k];
}
const decodeDoc = (d: any) => ({ id: String(d.name).split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([a, b]) => [a, decode(b)])) } as any);

// Unlike the seeder's toFields(), timestamps are passed through verbatim so a merged
// follow-up keeps the date it was actually written, not "now".
const TIMESTAMPS = new Set(['createdAt', 'updatedAt', 'lastFollowUpAt']);
function toFields(doc: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined || v === null || v === '') continue;
    fields[k] = TIMESTAMPS.has(k) ? { timestampValue: v } : { stringValue: String(v) };
  }
  return fields;
}

type Merge = {
  label: string;
  keeper: string;       // doc id kept
  loser: string;        // doc id deleted
  followUpId: string;   // deterministic id for the carried-over follow-up
  text: (loser: any) => string;
};

const MERGES: Merge[] = [
  {
    label: 'Jordan tender (OP000010 -> OP000019)',
    keeper: 'intl-adc-jordan-tender',
    loser: 'ext-edc-jordan',
    followUpId: 'intl-adc-jordan-tender-merged-ext-edc',
    text: (l) =>
      `Merged from the duplicate record OP000010 ("${l.title}"), which arrived from the External work report ` +
      `(External work.docx, 13/08/2026) while this record came from the International Department report ` +
      `(16/08/2026). Both describe the same ADC Jordan tender. The original verbatim status line is kept here ` +
      `and OP000010 was deleted on 17/08/2026 so the tender is counted once.\n\n${l.lastFollowUpText}`,
  },
  {
    label: 'Ramboll registration (OP000012 -> OP000014)',
    keeper: 'intl-ramboll-denmark',
    loser: '9QBwXC0jvDXhFoxseCjE',
    followUpId: 'intl-ramboll-denmark-merged-op000012',
    text: (l) =>
      `Merged from the duplicate record OP000012 ("${l.title}"), created directly in the app on 15/08/2026 ` +
      `and classified there as sector "${l.sector || '—'}". It described the same Ramboll vendor registration ` +
      `as this record. Its later, more specific status is kept here and OP000012 was deleted on 17/08/2026.\n\n` +
      `${l.lastFollowUpText}`,
  },
];

async function run() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const projectId = cfg.projectId;
  const databaseId = cfg.firestoreDatabaseId || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  console.log(`\n🔀 Merging duplicates → project=${projectId}  db=${databaseId}  ${DRY ? '(DRY RUN)' : ''}\n`);

  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, 'Content-Type': 'application/json' };

  const get = async (p: string) => {
    const r = await fetch(`${base}/${p}`, { headers: auth });
    return r.ok ? decodeDoc(await r.json()) : null;
  };
  const listAll = async (coll: string) => {
    const r = await fetch(`${base}/${coll}?pageSize=500`, { headers: auth });
    if (!r.ok) throw new Error(`${coll} read failed: ${r.status} ${await r.text()}`);
    return ((await r.json() as any).documents || []).map(decodeDoc);
  };

  // Child collections that reference an opportunity — all must be cleaned up with it.
  const CHILDREN = ['opportunityFollowUps', 'opportunityMilestones', 'opportunityFeedback'];
  const children: Record<string, any[]> = {};
  for (const c of CHILDREN) {
    try { children[c] = await listAll(c); } catch { children[c] = []; }
    console.log(`  ${c}: ${children[c].length} docs`);
  }
  console.log('');

  for (const m of MERGES) {
    console.log(`── ${m.label}`);
    const keeper = await get(`opportunities/${encodeURIComponent(m.keeper)}`);
    const loser = await get(`opportunities/${encodeURIComponent(m.loser)}`);
    if (!keeper) { console.error(`  ❌ keeper ${m.keeper} not found — skipping, nothing deleted.`); continue; }
    if (!loser) { console.log(`  · loser ${m.loser} already gone — nothing to do.`); continue; }
    console.log(`  keep   ${keeper.serialNumber}  ${keeper.title}`);
    console.log(`  delete ${loser.serialNumber}  ${loser.title}`);

    // 1. Carry the loser's status line onto the keeper as a dated follow-up.
    const fu = {
      opportunityId: m.keeper,
      text: m.text(loser),
      stage: keeper.stage,
      authorId: loser.ownerId || keeper.ownerId,
      authorName: loser.ownerName || keeper.ownerName,
      createdAt: loser.updatedAt || loser.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (DRY) {
      console.log(`  · would write opportunityFollowUps/${m.followUpId}`);
    } else {
      const r = await fetch(`${base}/opportunityFollowUps/${encodeURIComponent(m.followUpId)}`, {
        method: 'PATCH', headers: jsonAuth, body: JSON.stringify({ fields: toFields(fu) }),
      });
      if (!r.ok) { console.error(`  ❌ follow-up write failed: ${r.status} ${await r.text()}`); console.error('     ABORTING this merge — nothing deleted.'); continue; }
      console.log(`  ✅ follow-up carried over → opportunityFollowUps/${m.followUpId}`);
    }

    // 2. Refresh the keeper's lastFollowUp* so the list page shows the merged note.
    const patch = { lastFollowUpText: fu.text, lastFollowUpAt: new Date().toISOString() };
    const patchUrl = `${base}/opportunities/${encodeURIComponent(m.keeper)}` +
      `?updateMask.fieldPaths=lastFollowUpText&updateMask.fieldPaths=lastFollowUpAt&updateMask.fieldPaths=updatedAt`;
    if (DRY) {
      console.log(`  · would refresh ${m.keeper} lastFollowUpText/lastFollowUpAt`);
    } else {
      const r = await fetch(patchUrl, {
        method: 'PATCH', headers: jsonAuth,
        body: JSON.stringify({ fields: toFields({ ...patch, updatedAt: new Date().toISOString() }) }),
      });
      if (!r.ok) console.error(`  ⚠ keeper refresh failed: ${r.status} ${await r.text()}`);
      else console.log(`  ✅ keeper lastFollowUp refreshed`);
    }

    // 3. Delete the loser's own child docs, then the loser itself.
    for (const c of CHILDREN) {
      for (const d of children[c].filter((x: any) => x.opportunityId === m.loser)) {
        if (DRY) { console.log(`  · would delete ${c}/${d.id}`); continue; }
        const r = await fetch(`${base}/${c}/${encodeURIComponent(d.id)}`, { method: 'DELETE', headers: auth });
        console.log(r.ok ? `  ✅ deleted ${c}/${d.id}` : `  ❌ delete ${c}/${d.id}: ${r.status}`);
      }
    }
    if (DRY) {
      console.log(`  · would delete opportunities/${m.loser}  (${loser.serialNumber})`);
    } else {
      const r = await fetch(`${base}/opportunities/${encodeURIComponent(m.loser)}`, { method: 'DELETE', headers: auth });
      console.log(r.ok ? `  ✅ deleted opportunities/${m.loser}  (${loser.serialNumber})` : `  ❌ delete failed: ${r.status} ${await r.text()}`);
    }
    console.log('');
  }

  // The counter is intentionally left where it is — a deleted serial is retired,
  // never reissued.
  const c = await get('opportunities/--stats--');
  console.log(`  counter opportunities/--stats-- = ${c?.value} (left untouched by design)\n`);
  console.log(`🎉 ${DRY ? 'Dry run complete — nothing written.' : 'Merge complete.'}\n`);
}

run().then(() => process.exit(0)).catch(err => { console.error('Merge failed:', err); process.exit(1); });
