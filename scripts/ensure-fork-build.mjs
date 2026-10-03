import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { acquireBuildLock } from './fork-build-lock.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check-only');
const incompleteMarker = join(root, '.cache', 'quant-tools-fork-build.incomplete');
const completeManifest = join(root, '.cache', 'quant-tools-fork-build.complete.json');
const buildLock = join(root, '.cache', 'quant-tools-fork-build.lock');

const requiredOutputs = [
  'packages/pinets/dist/pinets.min.browser.js',
  'packages/pinets/dist/pinets.min.cjs',
  'packages/pinets/dist/pinets.min.es.js',
  'packages/pinets/dist/pinets.min.browser.es.js',
  'packages/pinets/dist/types/index.d.ts',
  'packages/vela-pinets/dist/index.js',
  'packages/vela-pinets/dist/index.cjs',
  'packages/vela-pinets/dist/index.d.ts',
  'packages/vela-pinets/dist/audit.js',
  'packages/vela-pinets/dist/audit.cjs',
  'packages/vela-pinets/dist/audit.d.ts',
  'packages/vela-pinets/dist/worker-engine.js',
  'packages/vela-pinets/dist/worker-engine.cjs',
  'packages/vela-pinets/dist/worker-engine.d.ts',
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

function filesUnder(path) {
  const absolute = join(root, path);
  let info;
  try {
    // The build fingerprint is a trust boundary.  Following a symlink here
    // could make an external checkout appear to be part of this workspace,
    // and would allow a changed target to invalidate/reuse the wrong cache.
    info = lstatSync(absolute);
  } catch {
    return [];
  }
  if (info.isSymbolicLink()) throw new Error(`[fork-build] input path must not be a symbolic link: ${path}`);
  if (!info.isDirectory()) return [path];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.git') return [];
    if (entry.isSymbolicLink()) {
      throw new Error(`[fork-build] input path must not contain a symbolic link: ${join(path, entry.name)}`);
    }
    return filesUnder(relative(root, join(absolute, entry.name)));
  });
}

function digestFiles(paths) {
  const hash = createHash('sha256');
  const files = paths.flatMap(filesUnder).sort();
  for (const file of files) {
    hash.update(file).update('\0').update(readFileSync(join(root, file))).update('\0');
  }
  return hash.digest('hex');
}

function inputFingerprint() {
  return digestFiles(inputRoots);
}

function toolchainFingerprint() {
  // The fork output is produced by the pinned workspace toolchain, not by
  // npm's caller metadata.  `npm_config_user_agent` is present for
  // `npm run ...` but absent when this entry point is invoked directly, which
  // used to invalidate an otherwise identical cache on every invocation.
  // Node/platform/arch are the execution inputs that can change the emitted
  // artifacts; dependency and build-script changes are covered by the input
  // SHA-256 fingerprint above.
  return [process.version, process.platform, process.arch].join('|');
}

function outputFingerprint() {
  // Treat a missing, replaced, or unreadable artifact as an invalid cache.
  // `existsSync()` alone is not sufficient here: a truncated/corrupt build
  // can leave a directory at an output path, and attempting to hash it would
  // otherwise throw EISDIR before the normal rebuild/recovery path runs.
  // Use lstat rather than stat so a symlink cannot make an external file look
  // like a valid local build output. Release manifests apply the same
  // fail-closed rule to dist; the fork cache must not weaken that boundary.
  try {
    if (requiredOutputs.some((path) => {
      try { return !lstatSync(join(root, path)).isFile(); } catch { return true; }
    })) return null;
    return digestFiles(requiredOutputs);
  } catch {
    return null;
  }
}

function readManifest() {
  try { return JSON.parse(readFileSync(completeManifest, 'utf8')); } catch { return null; }
}

function cacheIsComplete() {
  if (existsSync(incompleteMarker)) return false;
  const manifest = readManifest();
  return Boolean(manifest?.schema === 1
    && manifest.inputFingerprint === inputFingerprint()
    && manifest.toolchainFingerprint === toolchainFingerprint()
    && typeof manifest.inputFingerprint === 'string'
    && typeof manifest.outputFingerprint === 'string'
    && manifest.outputFingerprint === outputFingerprint());
}

function buildState() {
  const missing = requiredOutputs.filter((path) => {
    try { return !lstatSync(join(root, path)).isFile(); } catch { return true; }
  });
  return { missing, cached: cacheIsComplete() };
}

if (checkOnly) {
  const state = buildState();
  if (existsSync(buildLock)) {
    console.error('[fork-build] another fork build is active; use npm run dev or wait for it to finish');
    process.exitCode = 1;
  } else if (state.missing.length === 0 && state.cached) {
    console.log('[fork-build] verified current outputs; skipping rebuild');
    process.exit(0);
  }
  const reason = existsSync(incompleteMarker) ? 'an incomplete previous build is present'
    : state.missing.length > 0
      ? `missing ${state.missing.join(', ')}`
      : 'source, toolchain, or output contents changed';
  console.error(`[fork-build] current outputs are not verified (${reason}); run npm run build:forks first`);
  process.exitCode = 1;
} else {

  const release = acquireBuildLock({ root });
  try {
    // A second caller may have waited for the first to finish. Re-check after
    // acquiring the lock so it observes the completed outputs instead of
    // rebuilding the same fork artifacts a second time.
    const state = buildState();
    if (state.missing.length === 0 && state.cached) {
      console.log('[fork-build] outputs became current while waiting; skipping build:forks');
    } else {
      const reason = existsSync(incompleteMarker) ? 'previous build did not complete'
        : state.missing.length > 0
        ? `missing ${state.missing.join(', ')}`
        : 'source or build inputs changed';
      console.log(`[fork-build] rebuilding (${reason})`);
      // Persist before touching outputs: even a killed process must not leave
      // newer partial artifacts eligible for reuse on the next invocation.
      writeFileSync(incompleteMarker, JSON.stringify({ startedAt: Date.now(), inputFingerprint: inputFingerprint() }) + '\n');
      execFileSync('npm', ['run', 'build:forks:run'], { cwd: root, stdio: 'inherit' });
      const completed = buildState();
      if (completed.missing.length
        || outputFingerprint() === null
        || inputFingerprint() !== JSON.parse(readFileSync(incompleteMarker, 'utf8')).inputFingerprint) {
        throw new Error('[fork-build] build exited successfully but required outputs are missing or stale');
      }
      const manifestPath = `${completeManifest}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(manifestPath, JSON.stringify({
        schema: 1,
        inputFingerprint: inputFingerprint(),
        outputFingerprint: outputFingerprint(),
        toolchainFingerprint: toolchainFingerprint(),
        completedAt: Date.now(),
      }) + '\n');
      renameSync(manifestPath, completeManifest);
      rmSync(incompleteMarker);
    }
  } finally {
    release();
  }
}
