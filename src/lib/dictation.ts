/**
 * Voice note → task (queue task C2) — the pure half.
 *
 * The browser's own speech recognition (Web Speech API: Chrome, Edge, Safari,
 * Android) turns speech into text; that text goes into the one-box capture,
 * where quickCapture.ts reads it like anything typed. There is no model and no
 * key in this app — the browser does the listening.
 *
 * What lives here is the part worth testing without a microphone: stitching
 * the recogniser's pieces into one clean transcript, and naming its errors.
 * `useDictation` (src/hooks) is the thin wrapper round the browser object.
 * `scripts/harness/voicenote.mjs` runs this file unmodified.
 */

export type DictationLang = 'ar-EG' | 'en-US';

export type DictationError = 'blocked' | 'no-speech' | 'network' | 'no-mic' | 'failed';

/** The recogniser's error string → the few cases the user can act on. */
export function classifyError(code: string | undefined): DictationError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return 'blocked';
    case 'no-speech': return 'no-speech';
    case 'network': return 'network';
    case 'audio-capture': return 'no-mic';
    default: return 'failed';
  }
}

// Hesitation sounds, whole words only. Kept tiny on purpose: «يعني» and "like"
// carry meaning often enough that dropping them would change what was said.
// «أم» (or) and «اه» (yes) are words, so the Arabic forms need a drawn-out sound.
const FILLERS = /(?<![\p{L}])(?:ا*م{2,}|آه{2,}|اه{2,}|um+|uh+|erm+|hmm+)(?![\p{L}])/giu;

/** One recognised piece, tidied: no hesitation sounds, single spaces. */
export function tidySpoken(chunk: string): string {
  return (chunk || '')
    .replace(FILLERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([،,.؟?!])/g, '$1')
    .trim();
}

/**
 * The final pieces of one listening session → one transcript.
 *
 * Desktop Chrome hands back each pause as a NEW piece. Chrome on Android (with
 * `continuous`) often hands back the WHOLE transcript so far as every piece —
 * appending those would say everything twice. So a piece that already starts
 * with what we have replaces it, and a piece we already have is dropped.
 */
export function joinSegments(segments: string[]): string {
  let out = '';
  for (const raw of segments) {
    const s = tidySpoken(raw);
    if (!s) continue;
    const key = (x: string) => x.replace(/[\s،,.؟?!]+/g, ' ').trim().toLowerCase();
    if (!out || key(s).startsWith(key(out))) out = s;
    else if (!key(out).endsWith(key(s))) out = `${out} ${s}`;
  }
  return out;
}

/** What was in the box before the mic was pressed + what was said. */
export function withSpoken(before: string, spoken: string): string {
  const b = (before || '').replace(/\s+$/, '');
  if (!spoken) return before || '';
  if (!b) return spoken;
  return `${b}${b.includes('\n') ? '\n' : ' '}${spoken}`;
}

/** The voice language to start with: the one last used, else Arabic. */
export function initialLang(stored: string | null | undefined): DictationLang {
  return stored === 'en-US' ? 'en-US' : 'ar-EG';
}
