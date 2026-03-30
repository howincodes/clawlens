#!/usr/bin/env node

// Discovers Antigravity model mappings from the running Language Server.
// Usage: node antigravity-models.mjs

import { execSync } from 'child_process';
import https from 'https';
import { platform } from 'os';

function discover() {
  const os = platform();

  if (os === 'darwin' || os === 'linux') {
    const suffix = os === 'darwin' ? 'macos' : 'linux';
    const pid = execSync(`pgrep -f language_server_${suffix}`, { encoding: 'utf-8' }).trim().split('\n')[0];
    const ps = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf-8' });
    const csrf = ps.match(/--csrf_token\s+(\S+)/)[1];
    const lsof = execSync(`lsof -a -p ${pid} -i -P -n`, { encoding: 'utf-8' });
    const port = lsof.match(/:(\d+)\s+\(LISTEN\)/)[1];
    return { port: parseInt(port), csrf };
  }

  if (os === 'win32') {
    const raw = execSync(
      'powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'csrf_token\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"',
      { encoding: 'utf-8' }
    ).trim();
    const data = JSON.parse(raw);
    const proc = Array.isArray(data) ? data[0] : data;
    const csrf = proc.CommandLine.match(/--csrf_token\s+(\S+)/)[1];
    const pid = proc.ProcessId;
    const netstat = execSync('netstat -ano', { encoding: 'utf-8' });
    for (const line of netstat.split('\n')) {
      if (line.includes('LISTENING') && line.includes(String(pid))) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m) return { port: parseInt(m[1]), csrf };
      }
    }
  }

  throw new Error('Could not find Language Server');
}

function callAPI(port, csrf) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1', port,
      path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
      method: 'POST', rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': csrf },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Bad response')); } });
    });
    req.on('error', reject);
    req.write('{}'); req.end();
  });
}

try {
  const { port, csrf } = discover();
  const result = await callAPI(port, csrf);
  const configs = result?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];

  console.log('\n  Antigravity Model Mapping');
  console.log('  ========================\n');
  for (const c of configs) {
    const placeholder = c.modelOrAlias?.model || '?';
    const label = c.label || '?';
    console.log(`  ${placeholder}  →  ${label}`);
  }
  console.log(`\n  Total: ${configs.length} models\n`);
} catch (e) {
  console.error('ERROR:', e.message);
  console.error('Make sure Antigravity IDE is open with a workspace.');
}
