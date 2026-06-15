export const normalizeArabic = (text: string) => {
  if (!text) return '';
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    // Strip diacritics
    .replace(/[\u064B-\u0652]/g, '')
    .toLowerCase();
};

export const globalSearch = (item: any, searchStr: string): boolean => {
  if (!searchStr) return true;
  const normalizedSearch = normalizeArabic(searchStr);
  
  // Recursively search object values
  const searchInObj = (obj: any): boolean => {
    if (!obj) return false;
    if (typeof obj === 'string') {
      return normalizeArabic(obj).includes(normalizedSearch);
    }
    if (typeof obj === 'number') {
      return obj.toString().includes(normalizedSearch);
    }
    if (Array.isArray(obj)) {
      return obj.some(val => searchInObj(val));
    }
    if (typeof obj === 'object') {
      return Object.values(obj).some(val => searchInObj(val));
    }
    return false;
  };
  
  return searchInObj(item);
};
export const getUserColor = (idOrName: string): string => {
  if (!idOrName) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < idOrName.length; i++) {
    hash = idOrName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  // Use professional, balanced saturation and lightness
  return `hsl(${h}, 65%, 45%)`;
};

export const getGoogleDrivePreviewUrl = (url: string): string => {
  if (!url || !url.includes('drive.google.com')) return url;
  
  // Try to extract file ID from common Google Drive URL patterns
  const fileDMatch = url.match(/\/file\/d\/([^/?#]+)/);
  const idParamMatch = url.match(/[?&]id=([^&#]+)/);
  
  const fileId = fileDMatch ? fileDMatch[1] : (idParamMatch ? idParamMatch[1] : null);
  
  if (fileId) {
    // This format allows direct image embedding for public/shared files
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  
  return url;
};

// Parse a deadline string into a Date.
// A date-only string ("YYYY-MM-DD") is interpreted as the END of that
// calendar day in the user's LOCAL timezone. `new Date('YYYY-MM-DD')` would
// parse as UTC midnight, which then shifts to the previous day for users
// behind UTC (off-by-one overdue/due-soon). Strings carrying a time
// component fall through to the native parser, which handles ISO correctly.
const parseDeadline = (deadlineStr: string): Date => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadlineStr);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
  }
  return new Date(deadlineStr);
};

export const isOverdue = (deadlineStr?: string): boolean => {
  if (!deadlineStr) return false;
  return parseDeadline(deadlineStr) < new Date();
};

export const isDueSoon = (deadlineStr?: string, hours: number = 48): boolean => {
  if (!deadlineStr) return false;
  const diff = parseDeadline(deadlineStr).getTime() - Date.now();
  return diff > 0 && diff <= hours * 60 * 60 * 1000;
};

// Short relative time, e.g. "just now", "5m ago", "3h ago", "2d ago".
// Accepts a Firestore Timestamp, a Date, or a millis number.
export const timeAgo = (when?: { toDate?: () => Date } | Date | number | null): string => {
  if (!when) return '';
  let d: Date;
  if (typeof when === 'number') d = new Date(when);
  else if (when instanceof Date) d = when;
  else if (typeof (when as any).toDate === 'function') d = (when as any).toDate();
  else return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

// True for http(s) links (openable in a browser tab) vs. a local/UNC
// computer path, which a web page is not allowed to navigate to.
export const isWebUrl = (path?: string): boolean =>
  /^https?:\/\//i.test((path || '').trim());

// The shared folder is mapped to a network drive whose letter differs per
// machine (one user mounts it as X:, another as W:, …). A stored "X:\…" path
// therefore won't resolve for anyone whose mapping differs. Rewriting the
// leading drive letter to the share's UNC root makes the copied path portable
// across every machine. Configurable via VITE_SHARE_UNC_ROOT; defaults to the
// org's file server. UNC paths and web URLs are left untouched.
const SHARE_UNC_ROOT = (
  (import.meta.env.VITE_SHARE_UNC_ROOT as string | undefined) || '\\\\fs01'
).replace(/[\\/]+$/, '');

export const toUncPath = (path?: string): string => {
  const value = (path || '').trim().replace(/["']/g, '');
  if (!value) return value;
  if (value.startsWith('\\\\') || isWebUrl(value)) return value;
  // "X:\Folder\file" or "X:/Folder/file" -> "\\fs01\Folder\file"
  const m = value.match(/^[A-Za-z]:[\\/](.*)$/);
  if (m) return `${SHARE_UNC_ROOT}\\${m[1]}`;
  // Bare drive root, e.g. "X:" or "X:\"
  if (/^[A-Za-z]:[\\/]?$/.test(value)) return SHARE_UNC_ROOT;
  return value;
};

// Copy text to the clipboard, with a fallback for non-secure contexts
// and older browsers. Resolves to whether the copy succeeded.
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

// Click action for a shared folder path. A web link opens in a new tab.
// A computer/UNC path can't be opened from a web page (browsers block
// file:// navigation from an https origin for security), so the path is
// copied to the clipboard and the user is told to paste it into File
// Explorer. Returns 'opened' | 'copied' | 'prompted' | 'noop'.
export const openOrCopyPath = async (
  path?: string
): Promise<'opened' | 'copied' | 'prompted' | 'noop'> => {
  const value = toUncPath(path);
  if (!value) return 'noop';
  if (isWebUrl(value)) {
    window.open(value, '_blank', 'noopener,noreferrer');
    return 'opened';
  }
  const copied = await copyToClipboard(value);
  if (copied) {
    alert(
      "Browsers can't open a folder on your computer directly.\n\n" +
        'The path has been copied — open File Explorer (Win + E), click ' +
        'the address bar, paste (Ctrl + V) and press Enter.'
    );
    return 'copied';
  }
  window.prompt('Copy this folder path, then paste it into File Explorer:', value);
  return 'prompted';
};
