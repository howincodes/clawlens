import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();

export function installAutoStart(): boolean {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      return installLaunchd();
    } else if (platform === 'linux') {
      return installSystemd();
    } else if (platform === 'win32') {
      return installWindowsTask();
    }
  } catch (err) {
    console.error('[auto-start] Failed to install:', err);
  }
  return false;
}

export function uninstallAutoStart(): boolean {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      const plistPath = path.join(HOME, 'Library', 'LaunchAgents', 'com.howinlens.client.plist');
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`);
      fs.unlinkSync(plistPath);
      return true;
    } else if (platform === 'linux') {
      execSync('systemctl --user stop howinlens-client 2>/dev/null');
      execSync('systemctl --user disable howinlens-client 2>/dev/null');
      const servicePath = path.join(HOME, '.config', 'systemd', 'user', 'howinlens-client.service');
      fs.unlinkSync(servicePath);
      return true;
    } else if (platform === 'win32') {
      execSync('schtasks /delete /tn "HowinLens Client" /f 2>nul');
      return true;
    }
  } catch {}
  return false;
}

function installLaunchd(): boolean {
  const agentsDir = path.join(HOME, 'Library', 'LaunchAgents');
  fs.mkdirSync(agentsDir, { recursive: true });

  const logsDir = path.join(HOME, '.howinlens', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const electronExe = process.execPath;
  const appPath = path.join(__dirname, '../../..');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.howinlens.client</string>
    <key>ProgramArguments</key>
    <array>
        <string>${electronExe}</string>
        <string>${appPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${logsDir}/stderr.log</string>
    <key>StandardOutPath</key>
    <string>${logsDir}/stdout.log</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>`;

  const plistPath = path.join(agentsDir, 'com.howinlens.client.plist');
  fs.writeFileSync(plistPath, plist);
  execSync(`launchctl load "${plistPath}"`);
  console.log('[auto-start] Installed launchd agent');
  return true;
}

function installSystemd(): boolean {
  const serviceDir = path.join(HOME, '.config', 'systemd', 'user');
  fs.mkdirSync(serviceDir, { recursive: true });

  const electronExe = process.execPath;
  const appPath = path.join(__dirname, '../../..');

  const service = `[Unit]
Description=HowinLens Client
After=network.target

[Service]
Type=simple
ExecStart=${electronExe} ${appPath}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=DISPLAY=:0

[Install]
WantedBy=default.target`;

  const servicePath = path.join(serviceDir, 'howinlens-client.service');
  fs.writeFileSync(servicePath, service);
  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable howinlens-client');
  execSync('systemctl --user start howinlens-client');
  console.log('[auto-start] Installed systemd user service');
  return true;
}

function installWindowsTask(): boolean {
  const electronExe = process.execPath.replace(/\\/g, '\\\\');
  const appPath = path.join(__dirname, '../../..').replace(/\\/g, '\\\\');
  execSync(`schtasks /create /tn "HowinLens Client" /tr "\\"${electronExe}\\" \\"${appPath}\\"" /sc ONLOGON /rl LIMITED /f`);
  console.log('[auto-start] Installed Windows scheduled task');
  return true;
}

export function isAutoStartInstalled(): boolean {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      return fs.existsSync(path.join(HOME, 'Library', 'LaunchAgents', 'com.howinlens.client.plist'));
    } else if (platform === 'linux') {
      return fs.existsSync(path.join(HOME, '.config', 'systemd', 'user', 'howinlens-client.service'));
    } else if (platform === 'win32') {
      execSync('schtasks /query /tn "HowinLens Client" 2>nul');
      return true;
    }
  } catch {}
  return false;
}
