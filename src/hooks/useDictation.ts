import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyError, joinSegments, type DictationError, type DictationLang } from '../lib/dictation';

/* The Web Speech API is not in TypeScript's DOM types yet — only what we use. */
interface RecognitionAlternative { transcript: string }
interface RecognitionResult { readonly isFinal: boolean; readonly length: number; [i: number]: RecognitionAlternative }
interface RecognitionEvent { resultIndex: number; results: { readonly length: number; [i: number]: RecognitionResult } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/**
 * Voice typing through the browser's own recogniser (queue task C2).
 *
 * `onText` receives the WHOLE transcript of the current listening session each
 * time a piece is final, so the caller can rebuild its text from what was
 * there before + this. `interim` is the piece still being heard (shown grey,
 * never written into the box). Firefox has no recogniser: `supported` is false
 * and the caller hides its button.
 */
export function useDictation(onText: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const supported = !!recognitionCtor();

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback((lang: DictationLang) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      if (recRef.current !== rec) return;
      const finals: string[] = [];
      let heard = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const said = r[0]?.transcript || '';
        if (r.isFinal) finals.push(said);
        else if (i >= e.resultIndex) heard += said;
      }
      setInterim(heard.trim());
      if (finals.length) onTextRef.current(joinSegments(finals));
    };
    rec.onerror = e => {
      if (recRef.current !== rec || e.error === 'aborted') return;
      setError(classifyError(e.error));
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    setError(null);
    setInterim('');
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setError('failed');
    }
  }, []);

  // Leaving Home (or closing the app) must not leave the microphone open.
  useEffect(() => () => {
    const rec = recRef.current;
    recRef.current = null;
    rec?.abort();
  }, []);

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) };
}
