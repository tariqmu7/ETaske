/**
 * Country name → flag picture, for the "Group by Country" cards.
 *
 * ── Why pictures and not flag emoji ──────────────────────────────────────────
 * Windows has no flag emoji: "🇪🇬" renders as the two letters "EG". The team is
 * on Windows, so the flags are the `flag-icons` SVGs, bundled by Vite (each is
 * its own small hashed file, fetched only when a card shows it — nothing is
 * loaded from a third-party site).
 *
 * ── Matching a free-text country ─────────────────────────────────────────────
 * `location` is typed by hand ("Egypt", "مصر", "UAE", "Cairo, Egypt"). Names are
 * not listed here: they come from `Intl.DisplayNames` in English AND Arabic for
 * every code we have a flag for, plus a short alias list for the abbreviations
 * people actually type. No match → `undefined`, and the card keeps its pin.
 */

// Vite rewrites this call into a plain object at build time. Outside Vite (the
// esbuild harnesses) `import.meta.glob` does not exist — no flags, cards keep the pin.
let FLAG_URLS: Record<string, string> = {};
try {
  FLAG_URLS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>;
} catch { /* not built by Vite */ }

/** ISO code (lower case) → bundled SVG url. */
const BY_CODE: Record<string, string> = {};
for (const [path, url] of Object.entries(FLAG_URLS)) {
  const code = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
  // Two-letter countries only; skips sub-national flags such as "gb-eng".
  if (/^[a-z]{2}$/.test(code)) BY_CODE[code] = url;
}

/** Abbreviations and older names `Intl` does not produce. */
const ALIASES: Record<string, string> = {
  uae: 'ae', 'u a e': 'ae', emirates: 'ae', 'الامارات': 'ae',
  ksa: 'sa', saudi: 'sa', 'السعوديه': 'sa',
  usa: 'us', us: 'us', america: 'us', 'united states of america': 'us', 'امريكا': 'us',
  uk: 'gb', britain: 'gb', 'great britain': 'gb', england: 'gb', 'بريطانيا': 'gb', 'انجلترا': 'gb',
  turkey: 'tr', holland: 'nl', 'the netherlands': 'nl', russia: 'ru', 'south korea': 'kr', korea: 'kr',
  'ivory coast': 'ci', 'czech republic': 'cz', drc: 'cd', congo: 'cg', palestine: 'ps', 'فلسطين': 'ps',
  syria: 'sy', iran: 'ir', vietnam: 'vn', laos: 'la', 'south sudan': 'ss',
};

/** Lower case, no accents/punctuation, Arabic hamza/taa-marbuta folded, "the" / "Sultanate of" etc. dropped. */
function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u0655\u0670]/g, '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^(the|ال)\s+/, '')
    .replace(/^(sultanate|kingdom|state|republic|federal republic|democratic republic|emirate) of\s+/, '')
    .trim();
}

let byName: Map<string, string> | null = null;

function names(): Map<string, string> {
  if (byName) return byName;
  byName = new Map();
  for (const [alias, code] of Object.entries(ALIASES)) byName.set(norm(alias), code);
  for (const lang of ['en', 'ar']) {
    let dn: Intl.DisplayNames | undefined;
    try { dn = new Intl.DisplayNames([lang], { type: 'region' }); } catch { continue; }
    for (const code of Object.keys(BY_CODE)) {
      const name = dn.of(code.toUpperCase());
      if (name && name.toUpperCase() !== code.toUpperCase()) {
        const key = norm(name);
        if (!byName.has(key)) byName.set(key, code);
      }
    }
  }
  return byName;
}

/** The ISO code for a typed country, or undefined. Tries the whole text, then each comma part from the end. */
export function countryCode(location: string | undefined | null): string | undefined {
  if (!location) return undefined;
  const map = names();
  const parts = [location, ...location.split(/[,،\-–/]/).reverse()];
  for (const part of parts) {
    const code = map.get(norm(part));
    if (code) return code;
  }
  return undefined;
}

/** The bundled flag picture for a typed country, or undefined. */
export function countryFlagUrl(location: string | undefined | null): string | undefined {
  const code = countryCode(location);
  return code ? BY_CODE[code] : undefined;
}
