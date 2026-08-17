// READ-ONLY audit of the live opportunities collection (named DB).
// Dumps every doc's gap fields so task 4 can be scoped against reality.
import fs from 'fs';
import path from 'path';
import os from 'os';

async function getAccessToken(): Promise<string> {
  const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;
  const now = Date.now();
  if (tokens.access_token && tokens.expires_at && now < tokens.expires_at - 60000) return tokens.access_token;
  const clientId = config.user?.azp || '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
  const clientSecret = process.env.FIREBASE_CLIENT_SECRET || 'j9iVZfS8kkCEFUPaAeJV0sAi';
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!response.ok) throw new Error(`refresh failed: ${response.status} ${await response.text()}`);
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

async function run() {
  const cfg = JSON.parse(fs.readFileSync(path.resolve('./firebase-applet-config.json'), 'utf8'));
  const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId || '(default)'}/documents`;
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}` };

  const res = await fetch(`${base}/opportunities?pageSize=500`, { headers: auth });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const docs = ((await res.json() as any).documents || []).map(decodeDoc)
    .filter((d: any) => d.id !== '--stats--')
    .sort((a: any, b: any) => String(a.serialNumber).localeCompare(String(b.serialNumber)));

  const GAPS = ['estimatedValue', 'currency', 'submissionDeadline', 'ownerName', 'clientContact', 'announcedDate', 'nextActionDate', 'probability'];
  console.log(`live opportunities: ${docs.length}\n`);
  for (const d of docs) {
    const missing = GAPS.filter(g => d[g] === undefined || d[g] === null || d[g] === '');
    console.log(`${d.serialNumber}  ${String(d.id).padEnd(28)} ${String(d.stage).padEnd(16)} ${String(d.client || '-').padEnd(22)} ${d.title}`);
    console.log(`   missing: ${missing.join(', ') || '(none)'}`);
  }
  console.log('\n--- all field names seen ---');
  const keys = new Set<string>();
  docs.forEach((d: any) => Object.keys(d).forEach(k => keys.add(k)));
  console.log([...keys].sort().join(', '));

  console.log('\n--- FULL DUMP: the two Jordan docs ---');
  for (const d of docs.filter((x: any) => x.id === 'ext-edc-jordan' || x.id === 'intl-adc-jordan-tender')) {
    console.log(JSON.stringify(d, null, 2));
  }

  console.log('\n--- FULL DUMP: the two Ramboll docs ---');
  for (const d of docs.filter((x: any) => /rambo/i.test(String(x.client)) || /rambo/i.test(String(x.title)))) {
    console.log(JSON.stringify(d, null, 2));
  }

  console.log('\n--- numeric-field hygiene (NaN / string-typed numbers / empty strings) ---');
  const NUMERIC = ['estimatedValue', 'awardedValue', 'probability'];
  for (const d of docs) {
    const bad: string[] = [];
    for (const k of NUMERIC) {
      const v = (d as any)[k];
      if (v === undefined) continue;
      // NOTE: the REST API returns integerValue as a JSON *string*, so a plain
      // typeof check reports every honest integer as a defect. Only a value that
      // does not parse as a finite number is actually wrong.
      if (v === 'NaN' || (typeof v === 'number' && Number.isNaN(v))) bad.push(`${k}=NaN`);
      else if (!isFinite(Number(v))) bad.push(`${k}="${v}" (not a number)`);
    }
    const empties = Object.entries(d).filter(([, v]) => v === '').map(([k]) => k);
    if (bad.length || empties.length) {
      console.log(`${d.serialNumber} ${d.id}`);
      if (bad.length) console.log(`   BAD: ${bad.join(', ')}`);
      if (empties.length) console.log(`   empty-string fields: ${empties.join(', ')}`);
    }
  }

  const fuRes = await fetch(`${base}/opportunityFollowUps?pageSize=500`, { headers: auth });
  const fus = ((await fuRes.json() as any).documents || []).map(decodeDoc);
  console.log('\n--- follow-ups for the two Jordan docs ---');
  for (const f of fus.filter((x: any) => x.opportunityId === 'ext-edc-jordan' || x.opportunityId === 'intl-adc-jordan-tender')) {
    console.log(JSON.stringify(f, null, 2));
  }
  console.log(`\ntotal follow-ups: ${fus.length}`);
}
run().catch(e => { console.error(e); process.exit(1); });
