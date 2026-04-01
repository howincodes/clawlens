import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// NOTE: Credentials are stored in the same format and location that Claude Code
// uses (~/.claude/.credentials.json). File permissions (0o600) restrict access.
// On macOS, credentials are also stored in the system Keychain for additional security.
export async function writeCredentials(accessToken: string, refreshToken: string): Promise<void> {
  const creds = {
    claudeAiOauth: {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 7200000, // 2 hours
      scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
      subscriptionType: 'max',
    },
  };

  const credsJson = JSON.stringify(creds, null, 2);

  // Ensure directory exists
  const dir = path.dirname(CRED_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write credentials file
  fs.writeFileSync(CRED_PATH, credsJson, { mode: 0o600 });

  // Write to platform keychain
  const platform = process.platform;
  const username = os.userInfo().username;

  try {
    if (platform === 'darwin') {
      try { execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${username}" 2>/dev/null`); } catch {}
      execSync(`security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "${username}" -w '${credsJson.replace(/'/g, "\\'")}' -U`);
    } else if (platform === 'linux') {
      try {
        execSync(`echo '${credsJson.replace(/'/g, "\\'")}' | secret-tool store --label="Claude Code" service "${KEYCHAIN_SERVICE}" account "${username}"`);
      } catch {
        // secret-tool may not be available, file-only is fine
      }
    }
    // Windows: credential file only for now
  } catch (err) {
    console.error('[credentials] Failed to write to keychain:', err);
    // File was already written, so credential access still works
  }

  console.log('[credentials] Written successfully');
}

export async function deleteCredentials(): Promise<void> {
  // Delete credential file
  try {
    fs.unlinkSync(CRED_PATH);
  } catch {}

  // Delete from keychain
  const platform = process.platform;
  const username = os.userInfo().username;

  try {
    if (platform === 'darwin') {
      execSync(`security delete-generic-password -s "${KEYCHAIN_SERVICE}" -a "${username}" 2>/dev/null`);
    } else if (platform === 'linux') {
      execSync(`secret-tool clear service "${KEYCHAIN_SERVICE}" account "${username}" 2>/dev/null`);
    }
  } catch {}

  // Try to logout Claude CLI
  try {
    execSync('claude auth logout 2>/dev/null');
  } catch {}

  console.log('[credentials] Deleted');
}
