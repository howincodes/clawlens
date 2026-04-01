import fs from 'fs';
import path from 'path';
import os from 'os';

export interface HowinLensConfig {
  serverUrl: string;
  authToken: string;
  autoStart?: boolean;
  notificationsEnabled?: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), '.howinlens');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: HowinLensConfig = {
  serverUrl: '',
  authToken: '',
  autoStart: true,
  notificationsEnabled: true,
};

export function loadConfig(): HowinLensConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[config] Failed to load config:', err);
  }

  // Create default config
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function saveConfig(config: HowinLensConfig) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[config] Failed to save config:', err);
  }
}
