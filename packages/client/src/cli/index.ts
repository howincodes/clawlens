#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import {
  loadConfig, saveConfig, clearConfig, getServerUrl,
  CONFIG_DIR, PID_PATH, LOG_PATH,
} from '../config';
import { apiRequest } from '../services/api-client';
import { writeCredentials, deleteCredentials } from '../services/credentials';
import { installAutoStart, uninstallAutoStart } from '../services/auto-start';

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main(): Promise<void> {
  switch (command) {
    case 'login':    return cmdLogin();
    case 'start':    return cmdStart();
    case 'stop':     return cmdStop();
    case 'status':   return cmdStatus();
    case 'logs':     return cmdLogs();
    case 'logout':   return cmdLogout();
    case 'watch-on': return cmdWatchOn();
    case 'watch-off': return cmdWatchOff();
    case 'version':  console.log(`howinlens v${VERSION}`); return;
    case 'help': case '--help': case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdLogin(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  try {
    const token = (await ask('Enter your auth token: ')).trim();
    rl.close();

    if (!token) {
      console.error('No token provided.');
      process.exit(1);
    }

    // Verify with server
    process.stdout.write('Verifying... ');
    const result = await apiRequest(token, '/api/v1/client/status');

    if (!result) {
      console.error('Failed. Check your token and try again.');
      process.exit(1);
    }

    saveConfig({ authToken: token });
    console.log('✓ Authenticated as %s', result.user?.name || result.user?.email || 'user');
    console.log('  Server: %s', getServerUrl());
    console.log('\nRun `howinlens start` to begin syncing.');
  } catch {
    rl.close();
    console.error('Connection failed.');
    process.exit(1);
  }
}

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  if (!config.authToken) {
    console.error('Not logged in. Run: howinlens login');
    process.exit(1);
  }

  // Check if already running
  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    console.log('Already running (pid %d)', existingPid);
    return;
  }

  // Fork daemon
  const daemonPath = path.join(__dirname, '..', 'daemon.js');
  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Wait for PID file
  await waitForPid(3000);
  const pid = readPid();

  if (pid) {
    console.log('✓ Daemon started (pid %d)', pid);
  } else {
    console.log('✓ Daemon starting...');
  }

  // Install OS service for persistence
  try {
    installAutoStart();
    console.log('  Auto-start installed');
  } catch {}

  console.log('  Server: %s', getServerUrl());
  console.log('  Logs: %s', LOG_PATH);
}

async function cmdStop(): Promise<void> {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    console.log('Daemon is not running.');
    // Clean up stale PID
    try { fs.unlinkSync(PID_PATH); } catch {}
    return;
  }

  process.kill(pid, 'SIGTERM');

  // Wait for clean exit
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!isProcessAlive(pid)) {
      console.log('✓ Daemon stopped');
      try { uninstallAutoStart(); } catch {}
      return;
    }
  }

  // Force kill
  try { process.kill(pid, 'SIGKILL'); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}
  console.log('✓ Daemon killed');
}

async function cmdStatus(): Promise<void> {
  const pid = readPid();
  const running = pid && isProcessAlive(pid);

  console.log('HowinLens v%s', VERSION);
  console.log('Server:  %s', getServerUrl());
  console.log('Daemon:  %s', running ? `running (pid ${pid})` : 'not running');

  const config = loadConfig();
  if (!config.authToken) {
    console.log('Auth:    not logged in');
    return;
  }

  console.log('Auth:    configured');

  // Query server for live status
  try {
    const status = await apiRequest(config.authToken, '/api/v1/client/status');
    if (status) {
      console.log('User:    %s', status.user?.name || '?');
      console.log('Watch:   %s', status.watchStatus || 'unknown');
      if (status.credential) {
        console.log('Cred:    %s (%s)', status.credential.email, status.credential.subscriptionType);
      }
      if (status.heartbeat?.lastPingAt) {
        const ago = Math.round((Date.now() - new Date(status.heartbeat.lastPingAt).getTime()) / 1000);
        console.log('Heartbeat: %ds ago', ago);
      }
    }
  } catch {}
}

function cmdLogs(): void {
  if (!fs.existsSync(LOG_PATH)) {
    console.log('No logs yet. Start the daemon first: howinlens start');
    return;
  }

  const follow = args.includes('-f') || args.includes('--follow');

  if (follow) {
    const tail = spawn('tail', ['-f', LOG_PATH], { stdio: 'inherit' });
    tail.on('close', () => process.exit(0));
  } else {
    const content = fs.readFileSync(LOG_PATH, 'utf-8');
    const lines = content.split('\n');
    // Show last 50 lines
    console.log(lines.slice(-50).join('\n'));
  }
}

async function cmdLogout(): Promise<void> {
  await cmdStop();
  clearConfig();
  console.log('✓ Logged out. Config removed.');
}

async function cmdWatchOn(): Promise<void> {
  const config = loadConfig();
  if (!config.authToken) {
    console.error('Not logged in. Run: howinlens login');
    process.exit(1);
  }

  const result = await apiRequest(config.authToken, '/api/v1/client/watch/on', {
    method: 'POST',
    body: JSON.stringify({ source: 'cli' }),
  });

  if (result?.ok && result.credential) {
    await writeCredentials(result.credential);
    console.log('✓ On Watch — credential written');
  } else {
    console.error('Failed to go on watch');
  }
}

async function cmdWatchOff(): Promise<void> {
  const config = loadConfig();
  if (!config.authToken) {
    console.error('Not logged in. Run: howinlens login');
    process.exit(1);
  }

  const result = await apiRequest(config.authToken, '/api/v1/client/watch/off', {
    method: 'POST',
    body: JSON.stringify({ source: 'cli' }),
  });

  if (result?.ok) {
    await deleteCredentials();
    console.log('✓ Off Watch — credential removed');
  } else {
    console.error('Failed to go off watch');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function waitForPid(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(PID_PATH) || Date.now() - start > timeoutMs) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function printHelp(): void {
  console.log(`
howinlens v${VERSION} — AI team operations agent

Usage: howinlens <command>

Commands:
  login       Authenticate with your HowinLens server
  start       Start the background daemon
  stop        Stop the daemon
  status      Show daemon and connection status
  logs [-f]   View daemon logs (use -f to follow)
  logout      Stop daemon and remove credentials
  watch-on    Go on watch (receive Claude credentials)
  watch-off   Go off watch (remove Claude credentials)
  version     Show version
  help        Show this help
`.trim());
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
