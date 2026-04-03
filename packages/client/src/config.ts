import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Server URL — hardcoded production, env override for dev
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.HOWINLENS_SERVER || 'https://howinlens.howincloud.com';

export function getServerUrl(): string {
  return SERVER_URL;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CONFIG_DIR = path.join(os.homedir(), '.howinlens');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const PID_PATH = path.join(CONFIG_DIR, 'daemon.pid');
export const LOG_DIR = path.join(CONFIG_DIR, 'logs');
export const LOG_PATH = path.join(LOG_DIR, 'daemon.log');

// ---------------------------------------------------------------------------
// Config — minimal: just the auth token
// ---------------------------------------------------------------------------

export interface HowinLensConfig {
  authToken: string;
}

export function loadConfig(): HowinLensConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {}
  return { authToken: '' };
}

export function saveConfig(config: HowinLensConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function clearConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  } catch {}
}

// ---------------------------------------------------------------------------
// Claude auth status — read from local Claude config files
// ---------------------------------------------------------------------------

export interface ClaudeAuthStatus {
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
  authMethod?: string;
}

export function readClaudeAuthStatus(): ClaudeAuthStatus {
  const result: ClaudeAuthStatus = {};

  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      const raw = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
      const acct = raw.oauthAccount;
      if (acct) {
        result.email = acct.emailAddress;
        result.orgId = acct.organizationUuid;
        result.orgName = acct.organizationName;
      }
    }
  } catch {}

  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    if (fs.existsSync(credPath)) {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      result.subscriptionType = raw.claudeAiOauth?.subscriptionType;
    }
  } catch {}

  result.authMethod = 'claude.ai';
  return result;
}
