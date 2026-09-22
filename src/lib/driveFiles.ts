// Read an ETaske attachment back from Google Drive (queue task A2b).
//
// Uploaded files are PRIVATE — no "anyone with the link" — so a stored Drive
// URL no longer opens for a colleague. The app asks the Apps Script for the
// bytes instead (`download` action, same signed-in + Approved gate as upload,
// and only for files in the ETaske folder) and shows them from a blob: URL.
//
// Fallback: if the script refuses or is the old version (the switch-over
// window, before the new google-apps-script.js is pasted), we open / show the
// stored URL exactly as before — which still works while the old files are
// link-shared, and asks for a Google login once unshareAll() has run.

import type React from 'react';
import { callScript } from './scriptProxy';

/** The Drive file id inside a drive.google.com / docs.google.com URL, else null. */
export function driveFileIdOf(url?: string | null): string | null {
  const v = (url || '').trim();
  if (!/^https:\/\/(drive|docs)\.google\.com\//i.test(v)) return null;
  const m = v.match(/\/d\/([A-Za-z0-9_-]{10,})/) || v.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

export interface DriveFile { blobUrl: string; mimeType: string; fileName: string }

// Blob URLs are kept for the session so re-opening a card does not re-download;
// the oldest are released once there are more than this many.
const MAX_CACHED = 12;
const cache = new Map<string, Promise<DriveFile>>();

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

/** Fetch one private file through the script (cached per file id). */
export function fetchDriveFile(fileId: string): Promise<DriveFile> {
  const hit = cache.get(fileId);
  if (hit) return hit;
  const p = callScript<{ status?: string; base64?: string; mimeType?: string; fileName?: string; message?: string }>(
    { action: 'download', fileId },
  ).then(r => {
    if (r.status !== 'success' || typeof r.base64 !== 'string') throw new Error(r.message || 'Download failed');
    const mimeType = r.mimeType || 'application/octet-stream';
    return { blobUrl: URL.createObjectURL(base64ToBlob(r.base64, mimeType)), mimeType, fileName: r.fileName || 'file' };
  });
  cache.set(fileId, p);
  p.catch(() => cache.delete(fileId)); // a failure is retried next time
  while (cache.size > MAX_CACHED) {
    const [oldId, old] = cache.entries().next().value as [string, Promise<DriveFile>];
    cache.delete(oldId);
    old.then(f => URL.revokeObjectURL(f.blobUrl), () => {});
  }
  return p;
}

// What a browser tab can show by itself; anything else (Word, Excel) is saved.
const VIEWABLE = /^(image\/|application\/pdf$|text\/plain$)/;
const VIEWABLE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|pdf|txt)$/i;

/**
 * Open an attachment URL. A Drive file of ours is fetched through the script;
 * any other link (a folder, someone's own shared doc) opens as it always did.
 */
export async function openAttachment(url: string, fileName?: string | null): Promise<void> {
  const id = driveFileIdOf(url);
  if (!id) { window.open(url, '_blank', 'noopener,noreferrer'); return; }

  // Open the tab NOW, inside the click — after an await the browser would
  // block it as a pop-up. Word/Excel files skip the tab and are saved instead.
  const likelyViewable = !fileName || VIEWABLE_NAME.test(fileName);
  const tab = likelyViewable ? window.open('', '_blank') : null;
  if (tab) {
    try { tab.document.title = fileName || 'ETaske'; tab.document.body.textContent = '…'; } catch { /* cross-origin guard */ }
  }
  try {
    const f = await fetchDriveFile(id);
    if (tab && VIEWABLE.test(f.mimeType)) {
      tab.opener = null;
      tab.location.href = f.blobUrl;
      return;
    }
    tab?.close();
    const a = document.createElement('a');
    a.href = f.blobUrl;
    a.download = fileName || f.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Old script / file outside our folder: fall back to the stored link.
    if (tab) { tab.opener = null; tab.location.href = url; }
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * onClick for an `<a href={attachedFile}>`: routes a Drive file of ours through
 * openAttachment and leaves every other link (and ctrl/middle-click) alone.
 */
export function attachmentClick(url?: string | null, fileName?: string | null) {
  return (e: React.MouseEvent) => {
    if (!url || !driveFileIdOf(url)) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void openAttachment(url, fileName);
  };
}
