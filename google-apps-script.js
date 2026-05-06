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

function setup() {
  // Run this function manually once to trigger the authorization prompt for DriveApp.
  var folderId = "1BCyJMwQ1ve84jhPmp6THzd1Mwk9azpTD";
  DriveApp.getFolderById(folderId);
  Logger.log("Authorization successful!");
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var filename = data.filename;
    var base64 = data.base64.split(',')[1];
    var mimeType = data.mimeType;
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
