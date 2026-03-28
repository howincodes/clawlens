import { build } from 'esbuild';
import { existsSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const releaseDir = '../../release';
if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

// 1. Bundle server into single file
await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(releaseDir, 'server.mjs'),
  external: ['better-sqlite3'],
  banner: {
    js: [
      `import{createRequire}from'module';`,
      `import{fileURLToPath}from'url';`,
      `import{dirname}from'path';`,
      `const require=createRequire(import.meta.url);`,
      `const __filename=fileURLToPath(import.meta.url);`,
      `const __dirname=dirname(__filename);`,
    ].join(''),
  },
  minify: true,
});

// 2. Install only better-sqlite3 in release dir (with all deps)
writeFileSync(join(releaseDir, 'package.json'), JSON.stringify({
  name: 'clawlens-server',
  version: '0.2.0',
  type: 'module',
  scripts: { start: 'node server.mjs' },
  dependencies: { 'better-sqlite3': '^11.9.1' },
}));

execSync('npm install --production --ignore-scripts=false', {
  cwd: releaseDir,
  stdio: 'pipe',
});

// 3. Copy dashboard
const dashDist = '../../packages/dashboard/dist';
if (existsSync(dashDist)) {
  cpSync(dashDist, join(releaseDir, 'dashboard'), { recursive: true });
}

// 4. Clean package-lock from release
rmSync(join(releaseDir, 'package-lock.json'), { force: true });

console.log('Release built:');
console.log('  release/server.mjs        — bundled server (1 file)');
console.log('  release/node_modules/     — better-sqlite3 native module');
console.log('  release/dashboard/        — static dashboard files');
console.log('');
console.log('Deploy:');
console.log('  PORT=3000 ADMIN_PASSWORD=secret JWT_SECRET=secret node server.mjs');
