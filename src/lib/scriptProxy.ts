// The one door to the Apps Script web app (google-apps-script.js): Drive
// uploads, push and Telegram messages, Telegram link polling.
//
// Every call carries the signed-in user's Firebase ID token. The script checks
// it with Firebase Auth and serves only an Approved user (queue task A2) — the
// URL alone, or the old shared secret, gets "Unauthorized".
//
// `secret` still rides along ONLY so this build keeps working against the
// previous script until the new one is pasted in; the new script ignores it.
// Drop it (and VITE_GOOGLE_SCRIPT_SECRET) once the new script is live.

import { auth } from './firebase';

export const SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined;

/** POST one request to the script as the current user; returns the parsed JSON. */
export async function callScript<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  if (!SCRIPT_URL) throw new Error('Google Script URL (VITE_GOOGLE_SCRIPT_URL) is not configured.');
  const idToken = await auth.currentUser?.getIdToken?.();
  if (!idToken) throw new Error('You are signed out — sign in again and retry.');

  const response = await fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'cors',
    // text/plain keeps it a "simple" request: Apps Script cannot answer a CORS preflight.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      ...payload,
      idToken,
      secret: import.meta.env.VITE_GOOGLE_SCRIPT_SECRET,
    }),
  });
  if (!response.ok) throw new Error('Network response was not ok');
  return (await response.json()) as T;
}
