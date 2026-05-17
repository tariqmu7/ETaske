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
  // Check if token is still valid (expires_at is in milliseconds)
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

    // Save refreshed token back to firebase-tools.json so we don't have to refresh it every time
    config.tokens.access_token = data.access_token;
    config.tokens.expires_at = Date.now() + (data.expires_in * 1000);
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"), 'utf8');

    return data.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
}

async function runBackup() {
  const configPath = path.resolve('./firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';

  console.log(`\n========================================`);
  console.log(`🔥 FIRESTORE BACKUP SYSTEM 🔥`);
  console.log(`========================================`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}`);

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (error: any) {
    console.error(`Authentication Error: ${error.message}`);
    process.exit(1);
  }

  const collectionsToBackup = [
    "correspondences",
    "followUps",
    "messages",
    "milestones",
    "notifications",
    "tasks",
    "users"
  ];

  const backupData: Record<string, any[]> = {};

  for (const collectionName of collectionsToBackup) {
    console.log(`\n📦 Fetching collection: [${collectionName}]...`);
    backupData[collectionName] = [];
    
    let pageToken = '';
    let hasMore = true;
    let docCount = 0;

    while (hasMore) {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${collectionName}`;
      const url = pageToken ? `${baseUrl}?pageToken=${pageToken}` : baseUrl;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  ❌ Error fetching ${collectionName}: ${response.statusText} (${response.status})`);
        console.error(`  Details: ${errorText}`);
        hasMore = false;
        continue;
      }

      const data = await response.json() as any;
      if (data.documents && data.documents.length > 0) {
        backupData[collectionName].push(...data.documents);
        docCount += data.documents.length;
        console.log(`  ➕ Retrieved ${data.documents.length} documents...`);
      }

      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
      } else {
        hasMore = false;
      }
    }

    console.log(`  ✅ Done! Total: ${docCount} documents backed up from [${collectionName}].`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve('./backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilePath = path.join(backupDir, `firestore-backup-${timestamp}.json`);
  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');

  console.log(`\n========================================`);
  console.log(`🎉 SUCCESS: Firestore database backup complete!`);
  console.log(`💾 Saved to: ${backupFilePath}`);
  console.log(`========================================\n`);
}

runBackup().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Backup failed:", err);
  process.exit(1);
});
