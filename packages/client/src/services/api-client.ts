import { getServerUrl } from '../config';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Make an API request to the HowinLens server with automatic retry
 * and exponential backoff on transient failures.
 */
export async function apiRequest(
  authToken: string,
  path: string,
  options?: RequestInit,
): Promise<any> {
  const url = `${getServerUrl()}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          ...(options?.headers || {}),
        },
      });

      if (res.status >= 400 && res.status < 500) {
        console.error(`[api] ${options?.method || 'GET'} ${path} → ${res.status} (not retrying)`);
        return null;
      }

      if (!res.ok) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        console.error(`[api] ${path} failed after ${MAX_RETRIES} retries: ${res.status}`);
        return null;
      }

      return res.json();
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      console.error(`[api] ${path} failed: ${err.message}`);
      return null;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
