import type { SyncStatus } from './sync-contract';

// A session read exercises the deployed backend's database transaction, unlike /health.
export async function verifyOnlineConnection(endpoint: string, fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<SyncStatus> {
  try {
    const response = await fetcher(`${endpoint}/api/pos`, {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: endpoint },
      body: JSON.stringify({ operation: 'auth:state', args: [] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { state: 'error', pending: 0, message: 'The online backend or database is unavailable. Retry the connection.' };
    const result = await response.json();
    if (!result?.data || typeof result.data.demo !== 'boolean' || !Object.hasOwn(result.data, 'user')) {
      return { state: 'error', pending: 0, message: 'The configured address did not return a POS backend response.' };
    }
    return { state: 'online', pending: 0, message: 'Online backend and database connection verified.' };
  } catch {
    return { state: 'offline', pending: 0, message: 'Cannot reach the online POS. Reconnect to continue; catalog caches are preserved.' };
  }
}
