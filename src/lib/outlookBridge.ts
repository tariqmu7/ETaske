// The local Outlook helper (outlook_bridge/, the .exe users run on their own PC).
// Shared by the Outlook Feed and the client file (queue D1), which reads the
// last mails naming a client when the helper happens to be running.

export const BRIDGE_URL = 'http://localhost:5111';
export const BRIDGE_TOKEN = 'etaske-bridge-2f9a7c';
export const bridgeHeaders = { 'X-Bridge-Token': BRIDGE_TOKEN };

export type BridgeFolder = 'Inbox' | 'Sent Items';

/**
 * Mail from one folder whose subject, sender, recipients or preview contains
 * `search` (the bridge matches case-insensitively). Null when the helper is not
 * running or does not answer — the caller shows "not connected", never an error.
 */
export async function fetchBridgeMail(folder: BridgeFolder, search: string, limit = 10): Promise<any[] | null> {
  try {
    const params = new URLSearchParams({ limit: String(limit), folder });
    if (search) params.set('search', search);
    const res = await fetch(`${BRIDGE_URL}/emails?${params}`, {
      headers: bridgeHeaders,
      signal: AbortSignal.timeout(15000),
      targetAddressSpace: 'loopback',
    } as RequestInit);
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}
