#!/usr/bin/env node

/**
 * Verify the G4a dependency provenance contract without contacting the network.
 *
 * The contract is deliberately checked from three independent places: root
 * manifest (requested spec), lockfile (tarball or workspace link), and the
 * package manifest (exports/repository/license/peer contract). This keeps a
 * stale node_modules tree or a silently widened range from looking like a valid
 * engine baseline. Registry and local-workspace packages may be mixed while a
 * fork is migrated.
 */

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const BASELINE_PATH = path.join(ROOT, 'docs', 'forks', 'DEPENDENCY_BASELINE.json');

const REQUIRED = [
  '@luxalgo/vela',
  '@luxalgo/vela-pinets',
  'pinets',
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail(`Unable to read JSON ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function normalizeRepository(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return '';
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '');
}

function packageManifestPath(name) {
  return path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json');
}

function workspaceManifestPath(entry) {
  assert(entry.workspaceDirectory, `${entry.name}: workspaceDirectory is required`);
  return path.join(ROOT, 'packages', entry.workspaceDirectory, 'package.json');
}

function workspaceBuildInfoPath(entry) {
  return path.join(ROOT, 'packages', entry.workspaceDirectory, 'fork-build-info.json');
}

function lockEntries(lockPackages, name) {
  const suffix = `/node_modules/${name}`;
  return Object.entries(lockPackages)
    .filter(([key]) => key === `node_modules/${name}` || key.endsWith(suffix))
    .map(([key, value]) => ({ key, value }));
}

function expectedRootSpec(entry) {
  // Registry baseline uses exact semver. A workspace baseline may intentionally
  // use a file spec, which is validated by the same script after G4a import.
  return entry.dependencyMode === 'workspace'
    ? `file:./packages/${entry.workspaceDirectory ?? entry.name.replace(/^@luxalgo\//, '').replaceAll('/', '-')}`
    : entry.version;
}

async function npmLsPaths(name) {
  // Importing child_process at module evaluation would make this script harder
  // to embed in browser-oriented tooling; dynamic import keeps the contract
  // script a standalone Node utility.
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['ls', '--parseable', '--all', name], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      // `npm ls --json` repeats a deduped peer under each consumer. Parseable
      // output reports physical package paths and therefore is the right
      // singleton check for a peer-heavy bridge such as Vela-PineTS.
      const paths = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (code !== 0 && paths.length === 0) {
        reject(new Error(`npm ls failed for ${name} (exit ${code}): ${stderr.trim()}`));
        return;
      }
      resolve({ paths, code, stderr });
    });
  });
}

export async function checkDependencyContract({ checkSingletons = true } = {}) {
  const [manifest, lock, baseline] = await Promise.all([
    readJson(MANIFEST_PATH),
    readJson(LOCK_PATH),
    readJson(BASELINE_PATH),
  ]);

  assert(baseline.schemaVersion === 1, `Unsupported dependency baseline schema: ${baseline.schemaVersion}`);
  assert(
    baseline.mode === 'registry-baseline' || baseline.mode === 'workspace-baseline',
    `Unsupported dependency baseline mode: ${baseline.mode}`,
  );
  assert(lock.lockfileVersion === 3, `Expected lockfileVersion 3, got ${lock.lockfileVersion}`);
  assert(lock.packages?.[''], 'Root package-lock entry is missing');

  const result = [];
  const forkBuilds = new Map();
  for (const name of REQUIRED) {
    const expected = baseline.packages?.[name];
    assert(expected, `Baseline entry missing for ${name}`);

    const rootSpec = manifest.dependencies?.[name];
    const lockRootSpec = lock.packages[''].dependencies?.[name];
    assert(rootSpec === expectedRootSpec(expected), `${name}: package.json spec ${rootSpec} != ${expectedRootSpec(expected)}`);
    assert(lockRootSpec === rootSpec, `${name}: package-lock root spec ${lockRootSpec} != ${rootSpec}`);
    assert(expected.version && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(expected.version), `${name}: baseline version must be exact semver`);
    assert(/^[0-9a-f]{40}$/.test(expected.sourceCommit), `${name}: sourceCommit must be a full SHA`);
    assert(expected.sourceCommit === expected.gitHead, `${name}: npm gitHead and sourceCommit differ`);

    const lockMatches = lockEntries(lock.packages, name);
    assert(lockMatches.length === 1, `${name}: expected one lockfile instance, found ${lockMatches.length}`);
    const lockEntry = lockMatches[0].value;
    if (expected.dependencyMode === 'workspace') {
      assert(lockEntry.link === true, `${name}: workspace baseline must resolve to a workspace link`);
      const expectedResolved = `packages/${expected.workspaceDirectory}`;
      assert(lockEntry.resolved === expectedResolved, `${name}: workspace link ${lockEntry.resolved} != ${expectedResolved}`);
    } else {
      assert(lockEntry.version === expected.version, `${name}: lock version ${lockEntry.version} != ${expected.version}`);
      assert(lockEntry.integrity === expected.integrity, `${name}: lock integrity does not match baseline`);
      assert(lockEntry.resolved === expected.registryTarball, `${name}: lock tarball does not match baseline`);
      assert(!lockEntry.link, `${name}: registry baseline unexpectedly resolves to a workspace link`);
    }

    const installed = await readJson(
      expected.dependencyMode === 'workspace' ? workspaceManifestPath(expected) : packageManifestPath(name),
    );
    assert(installed.name === name, `${name}: installed package name mismatch (${installed.name})`);
    assert(installed.version === expected.version, `${name}: installed version ${installed.version} != ${expected.version}`);
    assert(normalizeRepository(installed.repository) === normalizeRepository(expected.repository), `${name}: repository mismatch`);
    assert(installed.license === expected.license, `${name}: license mismatch`);
    const exportKeys = Object.keys(installed.exports ?? {});
    assert(JSON.stringify(exportKeys) === JSON.stringify(expected.exports), `${name}: exports mismatch (${exportKeys.join(', ')})`);
    if (expected.peerDependencies) {
      assert(JSON.stringify(installed.peerDependencies ?? {}) === JSON.stringify(expected.peerDependencies), `${name}: peerDependencies mismatch`);
    }

    if (expected.dependencyMode === 'workspace') {
      const build = await readJson(workspaceBuildInfoPath(expected));
      assert(build.schemaVersion === 1, `${name}: unsupported fork-build-info schema ${build.schemaVersion}`);
      assert(build.packageName === name, `${name}: fork build packageName mismatch (${build.packageName})`);
      assert(build.packageVersion === expected.version, `${name}: fork build version ${build.packageVersion} != ${expected.version}`);
      assert(build.upstreamSha === expected.sourceCommit, `${name}: fork build upstream SHA does not match dependency baseline`);
      assert(typeof build.localPatchRevision === 'string' && build.localPatchRevision.length > 0, `${name}: localPatchRevision is required`);
      assert(Number.isInteger(build.reportSchemaVersion) && build.reportSchemaVersion > 0, `${name}: reportSchemaVersion must be a positive integer`);
      assert(typeof build.sentinel === 'string' && build.sentinel.length > 0, `${name}: sentinel is required`);
      assert(typeof build.buildFingerprint === 'string' && build.buildFingerprint.length > 0, `${name}: buildFingerprint is required`);
      forkBuilds.set(name, build);
    }

    result.push({ name, version: installed.version, mode: expected.dependencyMode, sourceCommit: expected.sourceCommit });
  }


  const pinetsBuild = forkBuilds.get('pinets');
  const bridgeBuild = forkBuilds.get('@luxalgo/vela-pinets');
  assert(pinetsBuild && bridgeBuild, 'Required fork build metadata is missing');
  assert(bridgeBuild.bridgeSha === bridgeBuild.upstreamSha, '@luxalgo/vela-pinets: bridgeSha must identify the imported bridge source');
  assert(bridgeBuild.embeddedPinetsSha === pinetsBuild.upstreamSha, '@luxalgo/vela-pinets: embedded PineTS SHA is stale');
  assert(bridgeBuild.embeddedPinetsFingerprint === pinetsBuild.buildFingerprint, '@luxalgo/vela-pinets: embedded PineTS fingerprint is stale');
  assert(bridgeBuild.reportSchemaVersion === pinetsBuild.reportSchemaVersion, 'Fork report schema versions differ');

  // Compare the machine-readable files to the actual constants compiled into
  // the in-process and Worker bundles. This deliberately imports source, not
  // dist: a stale dist is exactly the failure the sentinel is intended to find.
  const [pinetsSource, bridgeSource] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'packages', 'pinets', 'src', 'build-info.ts')).href),
    import(pathToFileURL(path.join(ROOT, 'packages', 'vela-pinets', 'src', 'build-info.ts')).href),
  ]);
  assert(JSON.stringify(pinetsSource.PINE_TS_BUILD_INFO) === JSON.stringify(pinetsBuild), 'pinets: compiled build info differs from fork-build-info.json');
  assert(JSON.stringify(bridgeSource.VELA_PINETS_BUILD_INFO) === JSON.stringify(bridgeBuild), '@luxalgo/vela-pinets: compiled build info differs from fork-build-info.json');
  assert(bridgeSource.EMBEDDED_PINE_TS_BUILD_INFO.buildFingerprint === pinetsBuild.buildFingerprint, '@luxalgo/vela-pinets: Worker source embeds the wrong PineTS build');
  assert(bridgeSource.hasCurrentBuildSentinel({ build: bridgeSource.PINE_EXECUTION_BUILD_INFO }), 'Current local build sentinel rejected its own fingerprint');

  if (checkSingletons) {
    for (const name of REQUIRED) {
      const expected = baseline.packages?.[name];
      assert(expected, `Baseline entry missing for ${name}`);
      const { paths, code } = await npmLsPaths(name);
      assert(paths.length === 1, `${name}: npm ls found ${paths.length} physical instances (exit ${code})`);
      const installedPath = path.resolve(paths[0]);
      const expectedPath = path.resolve(path.dirname(packageManifestPath(name)));
      assert(installedPath === expectedPath, `${name}: npm ls resolved ${installedPath}, expected ${expectedPath}`);
      if (expected.dependencyMode === 'workspace') {
        const targetPath = path.resolve(path.dirname(workspaceManifestPath(expected)));
        assert(await realpath(installedPath) === targetPath, `${name}: workspace link target is not ${targetPath}`);
      }
    }
  }

  return Object.freeze({
    mode: baseline.mode,
    capturedAt: baseline.capturedAt,
    packages: Object.freeze(result),
    builds: Object.freeze({
      pinets: pinetsBuild,
      bridge: bridgeBuild,
      executionFingerprint: bridgeSource.PINE_EXECUTION_BUILD_INFO.buildFingerprint,
      sentinel: bridgeSource.PINE_EXECUTION_BUILD_INFO.sentinel,
    }),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await checkDependencyContract();
    console.log(`Dependency contract OK (${result.mode}; ${result.packages.length} packages)`);
    for (const item of result.packages) {
      console.log(`- ${item.name}@${item.version} [${item.mode}] ${item.sourceCommit}`);
    }
    console.log(`- execution fingerprint: ${result.builds.executionFingerprint}`);
  } catch (error) {
    console.error(`Dependency contract FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
