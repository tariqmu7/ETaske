// Upload one file to the department's Google Drive through the Apps Script
// proxy (google-apps-script.js) and return its Drive URL.
//
// The ONLY upload path — the task, correspondence and documents forms all call
// this. The script accepts it only from a signed-in, Approved user (see
// scriptProxy.ts). The stored file is PRIVATE (queue task A2b): the returned
// URL only carries the file id — screens open and preview it through
// driveFiles.ts (openAttachment / DriveImage), never by following the link.

import { callScript } from './scriptProxy';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function uploadToDrive(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Max file size is 10MB.');

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const result = await callScript<{ status?: string; url?: string; message?: string }>({
    action: 'upload',
    filename: file.name,
    mimeType: file.type,
    base64,
  });
  if (result.status === 'success' && result.url) return result.url;
  throw new Error(result.message || 'Upload failed');
}
