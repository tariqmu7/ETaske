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
