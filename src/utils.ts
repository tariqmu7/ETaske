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

export const isOverdue = (deadlineStr?: string): boolean => {
  if (!deadlineStr) return false;
  const d = new Date(deadlineStr);
  // Set to end of day for overdue check if only date is provided
  if (deadlineStr.length <= 10) d.setHours(23, 59, 59);
  return d < new Date();
};

export const isDueSoon = (deadlineStr?: string, hours: number = 48): boolean => {
  if (!deadlineStr) return false;
  const deadline = new Date(deadlineStr);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  return diff > 0 && diff <= hours * 60 * 60 * 1000;
};
