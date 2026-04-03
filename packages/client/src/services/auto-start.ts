import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const DAEMON_PATH = path.join(HOME, '.howinlens', 'bin', 'daemon.js');
const LABEL = 'com.howinlens.daemon';

function getNodePath(): string {
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return process.execPath;
  }
}

// Resolve daemon.js — prefer installed location, fall back to dev build
function getDaemonPath(): string {
  if (fs.existsSync(DAEMON_PATH)) return DAEMON_PATH;
  // Dev mode: use the built dist/daemon.js
  const devPath = path.join(__dirname, '..', 'daemon.js');
  if (fs.existsSync(devPath)) return devPath;
  return DAEMON_PATH;
}

export function installAutoStart(): boolean {
  try {
    if (process.platform === 'darwin') return installLaunchd();
    if (process.platform === 'linux') return installSystemd();
    if (process.platform === 'win32') return installWindowsTask();
  } catch (err) {
    console.error('[auto-start] Install failed:', err);
  }
  return false;
}

export function uninstallAutoStart(): boolean {
  try {
    if (process.platform === 'darwin') {
      const plistPath = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
      try { execSync(`launchctl remove ${LABEL} 2>/dev/null`); } catch {}
      try { fs.unlinkSync(plistPath); } catch {}
      return true;
    }
    if (process.platform === 'linux') {
      try { execSync('systemctl --user stop howinlens 2>/dev/null'); } catch {}
      try { execSync('systemctl --user disable howinlens 2>/dev/null'); } catch {}
      const svcPath = path.join(HOME, '.config', 'systemd', 'user', 'howinlens.service');
      try { fs.unlinkSync(svcPath); } catch {}
      return true;
    }
    if (process.platform === 'win32') {
      try { execSync('schtasks /delete /tn "HowinLens" /f 2>nul'); } catch {}
      return true;
    }
  } catch {}
  return false;
}

function installLaunchd(): boolean {
  const nodePath = getNodePath();
  const daemonPath = getDaemonPath();
  const logsDir = path.join(HOME, '.howinlens', 'logs');
  const agentsDir = path.join(HOME, 'Library', 'LaunchAgents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardErrorPath</key>
    <string>${logsDir}/launchd-stderr.log</string>
    <key>StandardOutPath</key>
    <string>${logsDir}/launchd-stdout.log</string>
</dict>
</plist>`;

  const plistPath = path.join(agentsDir, `${LABEL}.plist`);
  fs.writeFileSync(plistPath, plist);
  execSync(`launchctl load "${plistPath}"`);
  return true;
}

function installSystemd(): boolean {
  const nodePath = getNodePath();
  const daemonPath = getDaemonPath();
  const serviceDir = path.join(HOME, '.config', 'systemd', 'user');
  fs.mkdirSync(serviceDir, { recursive: true });

  const service = `[Unit]
Description=HowinLens Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target`;

  const svcPath = path.join(serviceDir, 'howinlens.service');
  fs.writeFileSync(svcPath, service);
  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable howinlens');
  execSync('systemctl --user start howinlens');
  return true;
}

function installWindowsTask(): boolean {
  const nodePath = getNodePath().replace(/\\/g, '\\\\');
  const daemonPath = getDaemonPath().replace(/\\/g, '\\\\');
  execSync(`schtasks /create /tn "HowinLens" /tr "\\"${nodePath}\\" \\"${daemonPath}\\"" /sc ONLOGON /rl LIMITED /f`);
  return true;
}

export function isAutoStartInstalled(): boolean {
  try {
    if (process.platform === 'darwin') {
      return fs.existsSync(path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`));
    }
    if (process.platform === 'linux') {
      return fs.existsSync(path.join(HOME, '.config', 'systemd', 'user', 'howinlens.service'));
    }
    if (process.platform === 'win32') {
      execSync('schtasks /query /tn "HowinLens" 2>nul');
      return true;
    }
  } catch {}
  return false;
}
