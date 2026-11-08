import { existsSync, readFileSync } from 'node:fs';

export function backendConfig(environment: string | undefined, files: string[], fallback?: string) {
  let endpoint = environment?.trim();
  for (const file of files) {
    if (endpoint) break;
    if (existsSync(file)) {
      const config = JSON.parse(readFileSync(file, 'utf8')) as { POS_API_URL?: unknown };
      if (typeof config.POS_API_URL !== 'string' || !config.POS_API_URL.trim()) throw new Error('pos-config.json requires POS_API_URL.');
      endpoint = config.POS_API_URL.trim();
    }
  }
  if (!endpoint) return fallback;
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('POS_API_URL must be an HTTPS origin (HTTP is allowed on localhost only).');
  }
  return url.origin;
}
