import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

const requiredOutputs = [
  'packages/pinets/dist/pinets.min.browser.js',
  'packages/pinets/dist/pinets.min.cjs',
  'packages/pinets/dist/pinets.min.es.js',
  'packages/pinets/dist/pinets.min.browser.es.js',
  'packages/vela-pinets/dist/index.js',
  'packages/vela-pinets/dist/index.cjs',
  'packages/vela-pinets/dist/index.d.ts',
];

const inputRoots = [
  'package.json',
  'package-lock.json',
  'packages/pinets/package.json',
  'packages/pinets/rollup.config.js',
  'packages/pinets/tsconfig.json',
  'packages/pinets/tsconfig.dts.json',
  'packages/vela-pinets/package.json',
  'packages/vela-pinets/tsup.config.ts',
  'packages/vela-pinets/tsconfig.json',
  'packages/pinets/src',
  'packages/pinets/scripts',
  'packages/vela-pinets/src',
];

function mtime(path) {
  try {
    return statSync(join(root, path)).mtimeMs;
  } catch {
    return 0;
  }
}

function newestUnder(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return 0;
  const info = statSync(absolute);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(absolute, { withFileTypes: true }).reduce((latest, entry) => {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.git') return latest;
    const child = relative(root, join(absolute, entry.name));
    return Math.max(latest, newestUnder(child));
  }, info.mtimeMs);
}

const newestInput = Math.max(...inputRoots.map(newestUnder));
const missing = requiredOutputs.filter((path) => !existsSync(join(root, path)));
const oldestOutput = Math.min(...requiredOutputs.map(mtime));
const stale = oldestOutput < newestInput;

if (missing.length === 0 && !stale) {
  console.log('[fork-build] outputs are current; skipping build:forks');
  process.exit(0);
}

const reason = missing.length > 0 ? `missing ${missing.join(', ')}` : 'source or build inputs changed';
console.log(`[fork-build] rebuilding (${reason})`);
execFileSync('npm', ['run', 'build:forks'], { cwd: root, stdio: 'inherit' });
