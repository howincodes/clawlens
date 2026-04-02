import type { HowinLensConfig } from '../utils/config';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

/**
 * Make an API request to the HowinLens server with automatic retry
 * and exponential backoff on transient failures.
 *
 * Returns the parsed JSON response, or null on permanent failure.
 */
export async function apiRequest(
  config: HowinLensConfig,
  path: string,
  options?: RequestInit,
): Promise<any> {
  const url = `${config.serverUrl}${path}`;
  const tokenHint = config.authToken ? `${config.authToken.substring(0, 8)}...${config.authToken.substring(config.authToken.length - 4)}` : 'MISSING';

  console.log('[api-client] %s %s (auth=%s)', options?.method || 'GET', path, tokenHint);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.authToken}`,
          ...(options?.headers || {}),
        },
      });

      console.log('[api-client]   → %d %s (attempt %d)', res.status, res.statusText, attempt + 1);

      // Don't retry client errors (4xx) — they won't change on retry
      if (res.status >= 400 && res.status < 500) {
        console.error(`[api-client] ✗ ${path} failed: ${res.status} ${res.statusText} (not retrying 4xx)`);
        return null;
      }

      // Retry server errors (5xx)
      if (!res.ok) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[api-client] ⚠ ${path} returned ${res.status}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
        console.error(`[api-client] ✗ ${path} failed: ${res.status} after ${MAX_RETRIES} retries`);
        return null;
      }

      console.log('[api-client] ✓ %s success', path);
      return res.json();
    } catch (err: any) {
      const errMsg = err.code || err.message || 'Unknown error';
      // Network error (ECONNREFUSED, DNS failure, timeout, etc.)
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[api-client] ⚠ ${path} network error: ${errMsg} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
        await sleep(delay);
        continue;
      }
      console.error(`[api-client] ✗ ${path} failed after ${MAX_RETRIES} retries: ${errMsg}`);
      return null;
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
