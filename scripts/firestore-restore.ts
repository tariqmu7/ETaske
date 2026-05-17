import fs from 'fs';
import path from 'path';
import os from 'os';

// Config and credentials setup
async function getAccessToken(): Promise<string> {
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.config', 'configstore', 'firebase-tools.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Firebase CLI config not found at: ${configPath}. Please run 'firebase login' first.`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tokens = config.tokens;

  if (!tokens) {
    throw new Error("No authenticated session or tokens found. Please run 'firebase login'.");
  }

  const now = Date.now();
  if (tokens.access_token && tokens.expires_at && now < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  console.log("Access token has expired or is about to expire. Refreshing token...");
  if (!tokens.refresh_token) {
    throw new Error("Refresh token not found. Please run 'firebase login' to re-authenticate.");
  }

  const clientId = config.user?.azp || "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
  
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to refresh access token: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as any;
    console.log("Token successfully refreshed!");

    config.tokens.access_token = data.access_token;
    config.tokens.expires_at = Date.now() + (data.expires_in * 1000);
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"), 'utf8');

    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
}

async function runRestore() {
  const args = process.argv.slice(2);
  const backupFileName = args[0];

  if (!backupFileName) {
    console.error("\n❌ Error: Please specify the backup file to restore.");
    console.log("Usage: npx tsx scripts/firestore-restore.ts <backup-file-path>");
    console.log("Example: npx tsx scripts/firestore-restore.ts backups/firestore-backup-2026-05-17T10-28-17-459Z.json\n");
    process.exit(1);
  }

  const backupFilePath = path.resolve(backupFileName);
  if (!fs.existsSync(backupFilePath)) {
    console.error(`❌ Error: Backup file not found at ${backupFilePath}`);
    process.exit(1);
  }

  const configPath = path.resolve('./firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Error: Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

  console.log(`\n========================================`);
  console.log(`🔥 FIRESTORE RESTORE SYSTEM 🔥`);
  console.log(`========================================`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);
  console.log(`Restoring from: ${backupFilePath}`);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (error: any) {
    console.error(`Authentication Error: ${error.message}`);
    process.exit(1);
  }

  const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));

  for (const collectionName of Object.keys(backupData)) {
    const documents = backupData[collectionName];
    if (!documents || documents.length === 0) {
      console.log(`\n📦 Collection [${collectionName}] is empty, skipping.`);
      continue;
    }

    console.log(`\n📦 Restoring ${documents.length} documents to [${collectionName}]...`);
    let restoreCount = 0;

    for (const doc of documents) {
      // Clean target document path
      // Extract everything after projects/{project}/databases/{db}/documents/
      const match = doc.name.match(/\/documents\/(.+)$/);
      if (!match) {
        console.error(`  ⚠️ Could not parse document path from: ${doc.name}`);
        continue;
      }
      
      const documentPath = match[1];
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${documentPath}`;

      try {
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            fields: doc.fields
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`  ❌ Error restoring doc ${documentPath}: ${response.statusText} (${response.status})`);
          console.error(`     Details: ${errorText}`);
        } else {
          restoreCount++;
        }
      } catch (err: any) {
        console.error(`  ❌ Network error restoring doc ${documentPath}:`, err.message);
      }
    }

    console.log(`  ✅ Done! Successfully restored ${restoreCount}/${documents.length} documents to [${collectionName}].`);
  }

  console.log(`\n========================================`);
  console.log(`🎉 SUCCESS: Firestore restore operation complete!`);
  console.log(`========================================\n`);
}

runRestore().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Restore failed:", err);
  process.exit(1);
});
