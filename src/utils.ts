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
