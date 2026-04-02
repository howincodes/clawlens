#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Config {
  serverUrl: string;
  authToken: string;
}

const CONFIG_PATH = path.join(os.homedir(), '.howinlens', 'config.json');

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return { serverUrl: '', authToken: '' };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function apiRequest(config: Config, path: string, options?: RequestInit): Promise<any> {
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
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStatus(config: Config) {
  const status = await apiRequest(config, '/api/v1/client/status');
  console.log(`\n  HowinLens Status`);
  console.log(`  ─────────────────`);
  console.log(`  User:     ${status.user?.name || 'Unknown'}`);
  console.log(`  Watch:    ${status.watchStatus === 'on' ? '🟢 On Watch' : '⚫ Off Watch'}`);
  if (status.credential) {
    console.log(`  Account:  ${status.credential.email} (${status.credential.subscriptionType})`);
  }
  if (status.heartbeat) {
    console.log(`  Platform: ${status.heartbeat.platform}`);
    console.log(`  Last Ping: ${new Date(status.heartbeat.lastPingAt).toLocaleTimeString()}`);
  }
  console.log('');
}

async function cmdWatchOn(config: Config) {
  const result = await apiRequest(config, '/api/v1/client/watch/on', {
    method: 'POST',
    body: JSON.stringify({ source: 'cli' }),
  });

  if (result?.ok) {
    console.log('🟢 On Watch — tracking active');
    if (result.credential) {
      // Write credentials (full payload with tokens + oauthAccount)
      const { writeCredentials } = await import('../main/services/credentials.js');
      await writeCredentials(result.credential);
      console.log(`   Account: ${result.credential.oauthAccount?.emailAddress || result.credential.claudeAiOauth?.subscriptionType}`);
    }
  } else {
    console.error('Failed to go On Watch');
  }
}

async function cmdWatchOff(config: Config) {
  const result = await apiRequest(config, '/api/v1/client/watch/off', {
    method: 'POST',
    body: JSON.stringify({ source: 'cli' }),
  });

  if (result?.ok) {
    const { deleteCredentials } = await import('../main/services/credentials.js');
    await deleteCredentials();
    console.log('⚫ Off Watch — tracking paused');
  } else {
    console.error('Failed to go Off Watch');
  }
}

async function cmdTaskList(config: Config) {
  const tasks = await apiRequest(config, '/api/v1/client/tasks');

  if (!tasks || tasks.length === 0) {
    console.log('\n  No tasks assigned to you.\n');
    return;
  }

  console.log(`\n  Your Tasks (${tasks.length})`);
  console.log(`  ─────────────────`);
  for (const task of tasks) {
    const statusIcon = task.status === 'done' ? '✅' : task.status === 'in_progress' ? '🔄' : task.status === 'blocked' ? '🚫' : '📋';
    console.log(`  ${statusIcon} #${task.id} ${task.title} [${task.priority}]`);
  }
  console.log('');
}

async function cmdTaskSet(config: Config, taskId: string) {
  const id = parseInt(taskId);
  if (isNaN(id)) {
    console.error('Invalid task ID');
    process.exit(1);
  }

  await apiRequest(config, '/api/v1/client/active-task', {
    method: 'PUT',
    body: JSON.stringify({ taskId: id }),
  });

  console.log(`Active task set to #${id}`);
}

async function cmdConfig() {
  const config = loadConfig();
  if (!config.serverUrl) {
    console.log(`\n  HowinLens is not configured.`);
    console.log(`  Edit ${CONFIG_PATH}\n`);
    return;
  }

  console.log(`\n  HowinLens Config`);
  console.log(`  ─────────────────`);
  console.log(`  Server:  ${config.serverUrl}`);
  console.log(`  Token:   ${config.authToken ? config.authToken.slice(0, 8) + '...' : '(not set)'}`);
  console.log(`  Config:  ${CONFIG_PATH}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`
  HowinLens CLI

  Usage: howinlens <command>

  Commands:
    status          Show current watch state and info
    watch-on        Start tracking (punch in)
    watch-off       Stop tracking (punch out)
    task list       Show your assigned tasks
    task set <id>   Set active task
    config          Show configuration

  Config file: ~/.howinlens/config.json
`);
    return;
  }

  const config = loadConfig();
  if (!config.serverUrl || !config.authToken) {
    if (command !== 'config') {
      console.error(`HowinLens is not configured. Run 'howinlens config' for details.`);
      process.exit(1);
    }
  }

  try {
    switch (command) {
      case 'status':
        await cmdStatus(config);
        break;
      case 'watch-on':
        await cmdWatchOn(config);
        break;
      case 'watch-off':
        await cmdWatchOff(config);
        break;
      case 'task':
        if (args[1] === 'list' || !args[1]) {
          await cmdTaskList(config);
        } else if (args[1] === 'set' && args[2]) {
          await cmdTaskSet(config, args[2]);
        } else {
          console.error('Usage: howinlens task [list|set <id>]');
        }
        break;
      case 'config':
        await cmdConfig();
        break;
      default:
        console.error(`Unknown command: ${command}. Run 'howinlens help' for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
