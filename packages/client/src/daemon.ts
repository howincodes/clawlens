#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { loadConfig, CONFIG_DIR, PID_PATH, LOG_DIR, LOG_PATH, getServerUrl } from './config';
import { startAllServices, stopAllServices } from './services/service-manager';

// ---------------------------------------------------------------------------
// HowinLens Daemon — background process that syncs AI tool data to server
// ---------------------------------------------------------------------------

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Single instance check via PID file
// ---------------------------------------------------------------------------

function isAlreadyRunning(): boolean {
  try {
    if (fs.existsSync(PID_PATH)) {
      const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 0); // Check if process exists
          return true;
        } catch {
          // Process doesn't exist — stale PID file
          fs.unlinkSync(PID_PATH);
        }
      }
    }
  } catch {}
  return false;
}

function writePidFile(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PID_PATH, String(process.pid));
}

function removePidFile(): void {
  try { fs.unlinkSync(PID_PATH); } catch {}
}

// ---------------------------------------------------------------------------
// Log redirection — daemon logs to file, not stdout
// ---------------------------------------------------------------------------

function setupLogging(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // Rotate if log > 5MB
  try {
    if (fs.existsSync(LOG_PATH)) {
      const stat = fs.statSync(LOG_PATH);
      if (stat.size > 5 * 1024 * 1024) {
        const rotatedPath = LOG_PATH + '.old';
        try { fs.unlinkSync(rotatedPath); } catch {}
        fs.renameSync(LOG_PATH, rotatedPath);
      }
    }
  } catch {}

  const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
  const { format } = require('util');

  const timestamp = () => new Date().toISOString();

  console.log = (...args: any[]) => {
    logStream.write(`[${timestamp()}] ${format(...args)}\n`);
  };
  console.error = (...args: any[]) => {
    logStream.write(`[${timestamp()}] ERROR: ${format(...args)}\n`);
  };
  console.warn = (...args: any[]) => {
    logStream.write(`[${timestamp()}] WARN: ${format(...args)}\n`);
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (isAlreadyRunning()) {
    process.stderr.write('HowinLens daemon is already running.\n');
    process.exit(1);
  }

  // Setup
  setupLogging();
  writePidFile();

  console.log('HowinLens daemon v%s starting (pid=%d)', VERSION, process.pid);
  console.log('Server: %s', getServerUrl());

  // Load config
  const config = loadConfig();
  if (!config.authToken) {
    console.error('No auth token. Run: howinlens login');
    removePidFile();
    process.exit(1);
  }

  // Start services
  await startAllServices(config);
  console.log('Daemon ready');

  // Signal handling — graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await stopAllServices();
    removePidFile();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep process alive (timers from services keep the event loop running)
}

main().catch(err => {
  console.error('Daemon crashed:', err);
  removePidFile();
  process.exit(1);
});
