import type { HowinLensConfig } from '../utils/config';

export async function apiRequest(config: HowinLensConfig, path: string, options?: RequestInit): Promise<any> {
  const url = `${config.serverUrl}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.authToken}`,
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    console.error(`[api-client] ${path} failed: ${res.status}`);
    return null;
  }

  return res.json();
}
