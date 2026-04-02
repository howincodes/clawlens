import crypto from 'node:crypto';
import https from 'node:https';

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string) {
  if (DEBUG) console.log(`[oauth] ${msg}`);
}

// ---------------------------------------------------------------------------
// Constants (from Claude Code source: constants/oauth.ts)
// ---------------------------------------------------------------------------

export const OAUTH_CONFIG = {
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  TOKEN_ENDPOINT: 'https://platform.claude.com/v1/oauth/token',
  AUTH_BASE: 'https://claude.com/cai/oauth/authorize',
  REDIRECT_URI: 'https://platform.claude.com/oauth/code/callback',
  USAGE_ENDPOINT: 'https://api.anthropic.com/api/oauth/usage',
  SCOPES: 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
  BETA_HEADER: 'oauth-2025-04-20',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  account?: { uuid: string; email_address: string };
  organization?: { uuid: string; name: string };
}

export interface UsageData {
  five_hour: { utilization: number | null; resets_at: string | null } | null;
  seven_day: { utilization: number | null; resets_at: string | null } | null;
  seven_day_opus: { utilization: number | null; resets_at: string | null } | null;
  seven_day_sonnet: { utilization: number | null; resets_at: string | null } | null;
  extra_usage: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
  } | null;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function buildAuthUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    code: 'true',
    client_id: OAUTH_CONFIG.CLIENT_ID,
    response_type: 'code',
    redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
    scope: OAUTH_CONFIG.SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${OAUTH_CONFIG.AUTH_BASE}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// HTTP helper (uses node:https to avoid curl rate-limiting issues)
// ---------------------------------------------------------------------------

function httpsRequest(
  url: string,
  options: https.RequestOptions,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout (15s)'));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// OAuth token operations
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for tokens (initial login / re-auth).
 * The code comes from the callback page after user logs in via browser.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state: string,
): Promise<OAuthTokenResponse> {
  const requestBody = JSON.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: OAUTH_CONFIG.REDIRECT_URI,
    client_id: OAUTH_CONFIG.CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  });

  debug(`Exchanging auth code (${code.substring(0, 15)}...) for tokens`);

  const res = await httpsRequest(OAUTH_CONFIG.TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody).toString(),
    },
  }, requestBody);

  if (res.status !== 200) {
    const errorBody = JSON.parse(res.body).error ?? res.body;
    debug(`Token exchange failed: HTTP ${res.status} — ${JSON.stringify(errorBody)}`);
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(errorBody)}`);
  }

  const data: OAuthTokenResponse = JSON.parse(res.body);
  debug(`Token exchange success: account=${data.account?.email_address}, expires_in=${data.expires_in}`);
  return data;
}

/**
 * Refresh an access token using a refresh token.
 * CRITICAL: The refresh_token in the response is NEW — the old one is invalidated.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const requestBody = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CONFIG.CLIENT_ID,
    scope: OAUTH_CONFIG.SCOPES,
  });

  debug('Refreshing access token...');

  const res = await httpsRequest(OAUTH_CONFIG.TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody).toString(),
    },
  }, requestBody);

  if (res.status !== 200) {
    const errorBody = JSON.parse(res.body).error ?? res.body;
    debug(`Token refresh failed: HTTP ${res.status} — ${JSON.stringify(errorBody)}`);
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(errorBody)}`);
  }

  const data: OAuthTokenResponse = JSON.parse(res.body);
  debug(`Token refresh success: expires_in=${data.expires_in}, account=${data.account?.email_address}`);
  return data;
}

// ---------------------------------------------------------------------------
// Usage polling
// ---------------------------------------------------------------------------

/**
 * Fetch subscription info (subscriptionType + rateLimitTier) by making a
 * minimal API call and reading the rate-limit headers.
 */
export async function fetchSubscriptionInfo(accessToken: string): Promise<{
  subscriptionType: string | null;
  rateLimitTier: string | null;
} | null> {
  debug('Fetching subscription info via minimal API call...');

  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    const res = await httpsRequest('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': OAUTH_CONFIG.BETA_HEADER,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
    }, body);

    // Parse the response to look for subscription hints
    // The rate-limit tier header tells us the plan
    if (res.status === 200) {
      try {
        const data = JSON.parse(res.body);
        // The model response may contain tier info in headers (not accessible via our helper)
        // But we can infer from the response structure
        debug(`Subscription info: API call succeeded`);
      } catch {}
    }

    // Since our httpsRequest helper doesn't expose headers, we need a raw approach
    return await new Promise((resolve) => {
      const reqBody = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });

      const req = require('node:https').request({
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': OAUTH_CONFIG.BETA_HEADER,
          'Content-Length': Buffer.byteLength(reqBody),
        },
      }, (response: any) => {
        let data = '';
        response.on('data', (chunk: any) => data += chunk);
        response.on('end', () => {
          const tier = response.headers['anthropic-ratelimit-tier'] as string || null;
          // Try to infer subscription type from tier name
          let subscriptionType: string | null = null;
          if (tier) {
            if (tier.includes('max')) subscriptionType = 'max';
            else if (tier.includes('pro')) subscriptionType = 'pro';
            else if (tier.includes('team') || tier.includes('raven')) subscriptionType = 'team';
            else if (tier.includes('enterprise')) subscriptionType = 'enterprise';
          }

          // Also check the response body for model info
          try {
            const body = JSON.parse(data);
            if (body.usage) {
              debug(`Subscription detected: type=${subscriptionType}, tier=${tier}`);
            }
          } catch {}

          resolve({ subscriptionType, rateLimitTier: tier });
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
      req.write(reqBody);
      req.end();
    });
  } catch (err) {
    debug(`fetchSubscriptionInfo error: ${err}`);
    return null;
  }
}

/**
 * Fetch usage data via the OAuth usage endpoint.
 * Returns utilization as percentages (e.g. 12.0 = 12%).
 */
export async function fetchUsage(accessToken: string): Promise<UsageData | null> {
  debug('Fetching usage via /api/oauth/usage...');

  try {
    const res = await httpsRequest(OAUTH_CONFIG.USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_CONFIG.BETA_HEADER,
      },
    });

    if (res.status !== 200) {
      debug(`Usage fetch failed: HTTP ${res.status}`);
      return null;
    }

    const data: UsageData = JSON.parse(res.body);
    debug(`Usage: 5h=${data.five_hour?.utilization ?? 'null'}%, 7d=${data.seven_day?.utilization ?? 'null'}%`);
    return data;
  } catch (err) {
    debug(`Usage fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
