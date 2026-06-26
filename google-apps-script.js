// GOOGLE APPS SCRIPT FOR DRIVE UPLOADS
// 
// Instructions:
// 1. Go to https://script.google.com/ and open your existing project.
// 2. Paste this entire code into Code.gs (replace all existing code).
// 3. IMPORTANT: Select the "setup" function from the dropdown menu at the top and click "Run".
//    - This will prompt you to "Review permissions".
//    - Click Review Permissions -> Choose your account -> Click "Advanced" -> "Go to Untitled project (unsafe)" -> Click "Allow".
// 4. CRITICAL STEP: You MUST create a **New Deployment** for changes to take effect!
//    - Click "Deploy" at the top right.
//    - Select "New deployment" (Do NOT choose "Manage deployments" -> Edit).
//    - Ensure "Web app" is selected.
//    - Execute as "Me", and Who has access: "Anyone".
//    - Click "Deploy".
// 5. Copy the NEW "Web app URL" provided.
// 6. Go to your app's Settings -> Environment Variables, and set VITE_GOOGLE_SCRIPT_URL to the new URL.
// 7. Restart the dev server.
//
// SHARED SECRET (abuse gate):
//   This web app is deployed with "Anyone" access, so its URL alone would let
//   anyone upload files to the Drive folder or send push notifications. To raise
//   the bar, every request must carry a shared secret that matches a Script
//   Property named SHARED_SECRET.
//   - Set it once: Project Settings (gear) -> Script Properties -> Add property
//     SHARED_SECRET = <a long random string>.
//   - Put the SAME value in the client env var VITE_GOOGLE_SCRIPT_SECRET
//     (and the matching GitHub Actions secret used by the deploy workflow).
//   NOTE: a VITE_-prefixed value is bundled into the static client, so it is not
//   cryptographically secret against someone who reads the JS. It blocks
//   drive-by / scripted hits to the URL; the durable fix is to move uploads and
//   push behind an authenticated Cloud Function.

// Upload limits (defense in depth against the open endpoint).
var MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
var ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument', 'application/vnd.ms-excel',
  'text/plain'];

function setup() {
  // Run this function manually once to trigger the authorization prompt for DriveApp.
  var folderId = "1BCyJMwQ1ve84jhPmp6THzd1Mwk9azpTD";
  DriveApp.getFolderById(folderId);
  Logger.log("Authorization successful!");
}

function isSecretValid(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  // If no secret has been configured yet, fail closed rather than open.
  return !!expected && data && data.secret === expected;
}

function jsonError(message) {
  return ContentService.createTextOutput(JSON.stringify({ status: "error", message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAllowedMime(mimeType) {
  if (!mimeType) return false;
  for (var i = 0; i < ALLOWED_MIME_PREFIXES.length; i++) {
    if (mimeType.indexOf(ALLOWED_MIME_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * Sends a push via the FCM HTTP v1 API using the script owner's OAuth token.
 * No server key or service account needed — just make sure the Google account
 * that owns this script has the "Firebase Cloud Messaging API Admin" role
 * (or is a project owner) in the Firebase/GCP project.
 *
 * The required OAuth scope (https://www.googleapis.com/auth/firebase.messaging)
 * must be listed in appsscript.json → oauthScopes. See instructions below.
 */
function sendFcmPush(token, title, body) {
  if (!token) return { status: 'skipped' };

  var projectId = 'gen-lang-client-0893475577';
  var url = 'https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send';

  var payload = JSON.stringify({
    message: {
      token: token,
      notification: { title: title, body: body },
      android: { priority: 'high' },
      webpush: {
        notification: { icon: '/favicon.png', badge: '/favicon.png' },
        fcm_options: { link: '/' },
      },
    },
  });

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload,
    muteHttpExceptions: true,
  });

  return { status: 'sent', fcm: response.getContentText() };
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // Abuse gate: reject anything without the shared secret.
    if (!isSecretValid(data)) {
      return jsonError("Unauthorized");
    }

    // FCM push proxy
    if (data.action === 'fcm') {
      var result = sendFcmPush(data.token, data.title, data.body);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var filename = data.filename;
    var mimeType = data.mimeType;

    if (!isAllowedMime(mimeType)) {
      return jsonError("Unsupported file type");
    }
    if (typeof data.base64 !== 'string' || data.base64.indexOf(',') === -1) {
      return jsonError("Malformed upload payload");
    }

    var base64 = data.base64.split(',')[1];
    // base64 expands ~4/3; reject oversized uploads before decoding.
    if (!base64 || base64.length * 0.75 > MAX_UPLOAD_BYTES) {
      return jsonError("File too large");
    }

    var folderId = "1BCyJMwQ1ve84jhPmp6THzd1Mwk9azpTD"; // The folder you requested!

    var folder = DriveApp.getFolderById(folderId);
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename);
    var file = folder.createFile(blob);
    
    try {
      // Allow anyone with the link to view the file
      // Note: This may fail on Shared Drives or due to Google Workspace policies.
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      Logger.log("Sharing error, probably due to shared drive or workspace permissions: " + sharingError);
    }
    
    // Return direct link to image
    var directLink = "https://drive.google.com/uc?export=view&id=" + file.getId();
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      url: directLink,
      downloadUrl: file.getDownloadUrl(),
      fileName: file.getName()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput("Web App is running.")
    .setMimeType(ContentService.MimeType.TEXT);
}
