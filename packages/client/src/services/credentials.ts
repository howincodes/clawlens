import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CRED_PATH = path.join(CLAUDE_DIR, '.credentials.json');
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// ---------------------------------------------------------------------------
// Types — matches the server's credential_update payload
// ---------------------------------------------------------------------------

export interface ClaudeAiOauth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;          // UNIX milliseconds
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

export interface OAuthAccount {
  accountUuid: string;
  emailAddress: string;
  organizationUuid: string;
  displayName: string;
  organizationName: string;
}

export interface CredentialPayload {
  claudeAiOauth: ClaudeAiOauth;
  oauthAccount: OAuthAccount;
}

// ---------------------------------------------------------------------------
// Write credentials — tokens + oauthAccount metadata
// ---------------------------------------------------------------------------

/**
 * Write Claude Code credentials to the platform-appropriate location and
 * update the oauthAccount metadata in ~/.claude.json.
 *
 * Platform behavior:
 *   macOS   — Keychain (primary) + file (fallback) + ~/.claude.json
 *   Linux   — File ~/.claude/.credentials.json (0600) + ~/.claude.json
 *   Windows — File ~/.claude/.credentials.json + ~/.claude.json
 */
export async function writeCredentials(payload: CredentialPayload): Promise<void> {
  const { claudeAiOauth, oauthAccount } = payload;

  console.log('[credentials] Writing credentials...');
  console.log('[credentials]   Email: %s', oauthAccount.emailAddress);
  console.log('[credentials]   Org: %s', oauthAccount.organizationName);
  console.log('[credentials]   Token expires: %s', new Date(claudeAiOauth.expiresAt).toISOString());

  // Build the credential JSON in Claude Code's expected format
  const creds = { claudeAiOauth };
  const credsJson = JSON.stringify(creds, null, 2);

  // Ensure ~/.claude/ directory exists
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.log('[credentials] Creating directory: %s', CLAUDE_DIR);
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  // --- Step 1: Write credential tokens ---
  const platform = process.platform;
  console.log('[credentials] Platform: %s', platform);

  if (platform === 'darwin') {
    // macOS: write to Keychain (primary) + file (fallback)
    console.log('[credentials] Writing to Keychain (primary)...');
    writeToKeychain(credsJson);
    console.log('[credentials] Writing to file fallback: %s', CRED_PATH);
    writeToFile(credsJson);
  } else {
    // Linux / Windows: file only
    console.log('[credentials] Writing to file: %s', CRED_PATH);
    writeToFile(credsJson);
  }

  // --- Step 2: Write oauthAccount metadata to ~/.claude.json ---
  console.log('[credentials] Writing oauthAccount to: %s', CLAUDE_JSON_PATH);
  writeOAuthAccount(oauthAccount);

  console.log(`[credentials] ✓ Written — email=${oauthAccount.emailAddress}, expires=${new Date(claudeAiOauth.expiresAt).toISOString()}`);
}

// ---------------------------------------------------------------------------
// Delete credentials
// ---------------------------------------------------------------------------

export async function deleteCredentials(): Promise<void> {
  // Delete credential file
  try {
    if (fs.existsSync(CRED_PATH)) fs.unlinkSync(CRED_PATH);
  } catch {}

  // Delete from keychain (macOS only)
  if (process.platform === 'darwin') {
    try {
      execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${os.userInfo().username}" 2>/dev/null`);
    } catch {}
  }

  // Remove oauthAccount from ~/.claude.json
  try {
    if (fs.existsSync(CLAUDE_JSON_PATH)) {
      const raw = fs.readFileSync(CLAUDE_JSON_PATH, 'utf-8');
      const config = JSON.parse(raw);
      delete config.oauthAccount;
      fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(config, null, 2));
    }
  } catch {}

  console.log('[credentials] Deleted');
}

// ---------------------------------------------------------------------------
// Platform-specific writers
// ---------------------------------------------------------------------------

function writeToFile(credsJson: string): void {
  fs.writeFileSync(CRED_PATH, credsJson, { mode: 0o600 });
}

function writeToKeychain(credsJson: string): void {
  const username = os.userInfo().username;

  try {
    // Delete old entry first — add-generic-password won't overwrite
    try {
      execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${username}" 2>/dev/null`);
    } catch {}

    // Keychain value must be single-line — escape for shell
    const escaped = credsJson.replace(/'/g, "'\\''");
    execSync(`security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${username}" -w '${escaped}' -U`);
  } catch (err) {
    console.error('[credentials] Keychain write failed (file fallback used):', err);
  }
}

/**
 * Read ~/.claude.json, merge in the oauthAccount field, write back.
 * Preserves all other fields in the file.
 */
function writeOAuthAccount(account: OAuthAccount): void {
  let config: Record<string, unknown> = {};

  // Read existing file if present
  try {
    if (fs.existsSync(CLAUDE_JSON_PATH)) {
      const raw = fs.readFileSync(CLAUDE_JSON_PATH, 'utf-8');
      config = JSON.parse(raw);
    }
  } catch {
    // Corrupted or missing — start fresh
    config = {};
  }

  // Set oauthAccount with all required fields
  config.oauthAccount = {
    accountUuid: account.accountUuid,
    emailAddress: account.emailAddress,
    organizationUuid: account.organizationUuid,
    displayName: account.displayName,
    organizationName: account.organizationName,
  };

  fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(config, null, 2));
}
