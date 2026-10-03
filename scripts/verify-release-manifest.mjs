#!/usr/bin/env node

/**
 * Verify a release manifest against an already materialized checkout.
 *
 * This command is deliberately read-only.  It is suitable for both a current
 * checkout and a compatibility manifest produced for an older checkout by
 * `release-manifest.mjs --root <old-root>`.  No checkout, reset, build, or
 * cleanup is performed here; deployment tooling owns the slot switch.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function option(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPathArg = option('--manifest');
const usage = `Usage: npm run release:verify -- --manifest <file> [--root <checkout>] [--require-clean] [--json]

Create a manifest for a built candidate, then verify that same artifact:
  npm run release:manifest --silent -- --require-clean > /tmp/quant-release-manifest.json
  npm run release:verify -- --manifest /tmp/quant-release-manifest.json --require-clean

Verification is read-only. It never generates or replaces its own baseline.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(usage);
  process.exit(0);
}
if (!manifestPathArg || manifestPathArg.startsWith('--')) {
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: '--manifest <file> is required', usage })}\n`);
  } else process.stderr.write(usage);
  process.exit(2);
}
const manifestPath = resolve(manifestPathArg);
const root = resolve(option('--root') ?? defaultRoot);
const jsonOutput = process.argv.includes('--json');
const requireClean = process.argv.includes('--require-clean');

function pathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function npmVersion() {
  try {
    return execFileSync('npm', ['--version'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

async function digest(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function regularFileDigest(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('path is not a regular file');
  return digest(path);
}

function fail(check, message, details = undefined) {
  return { check, ok: false, message, ...(details === undefined ? {} : { details }) };
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read manifest ${manifestPath}: ${String(error?.message ?? error)}`);
  }

  const checks = [];
  if (manifest?.schemaVersion !== 1) {
    checks.push(fail('schemaVersion', `expected schemaVersion=1, got ${String(manifest?.schemaVersion)}`));
  } else {
    checks.push({ check: 'schemaVersion', ok: true });
  }
  if (manifest?.manifestKind !== 'release') {
    checks.push(fail('manifestKind', `expected manifestKind=release, got ${String(manifest?.manifestKind)}`));
  } else {
    checks.push({ check: 'manifestKind', ok: true });
  }

  const runtimeChecks = [
    ['node', manifest?.node, process.version],
    ['npm', manifest?.npm, npmVersion()],
  ];
  for (const [name, expected, actual] of runtimeChecks) {
    if (expected == null) {
      checks.push({ check: name, ok: true, skipped: true });
    } else if (actual !== expected) {
      checks.push(fail(name, `manifest ${String(expected)} does not match checkout runtime ${String(actual)}`, { expected, actual }));
    } else {
      checks.push({ check: name, ok: true, expected, actual });
    }
  }

  const actualCommit = git(['rev-parse', 'HEAD']);
  if (manifest?.commit && actualCommit !== manifest.commit) {
    checks.push(fail('commit', `manifest ${manifest.commit} does not match checkout ${actualCommit ?? 'unavailable'}`, {
      expected: manifest.commit,
      actual: actualCommit,
    }));
  } else {
    checks.push({ check: 'commit', ok: !manifest?.commit || Boolean(actualCommit), ...(manifest?.commit ? { expected: manifest.commit, actual: actualCommit } : {}) });
  }

  const actualBranch = git(['branch', '--show-current']) ?? '';
  if (manifest?.branch != null && actualBranch !== manifest.branch) {
    checks.push(fail('branch', `manifest branch ${JSON.stringify(manifest.branch)} does not match checkout ${JSON.stringify(actualBranch)}`, {
      expected: manifest.branch,
      actual: actualBranch,
    }));
  } else {
    checks.push({ check: 'branch', ok: true, ...(manifest?.branch != null ? { expected: manifest.branch, actual: actualBranch } : {}) });
  }

  const status = git(['status', '--short']);
  const dirtyFiles = status ? status.split('\n').filter(Boolean) : [];
  if (requireClean && dirtyFiles.length > 0) {
    checks.push(fail('gitStatus', `working tree is dirty (${dirtyFiles.length} entries)`, dirtyFiles));
  } else if (manifest?.gitStatus && JSON.stringify(manifest.gitStatus) !== JSON.stringify(dirtyFiles)) {
    // A manifest generated with --require-clean is expected to carry an empty
    // status.  For diagnostic manifests we still report drift instead of
    // silently accepting a different checkout.
    checks.push(fail('gitStatus', 'checkout status differs from manifest', {
      expected: manifest.gitStatus,
      actual: dirtyFiles,
    }));
  } else {
    checks.push({ check: 'gitStatus', ok: true, dirtyFiles });
  }

  const lockfilePath = resolve(root, 'package-lock.json');
  if (manifest?.packageLock == null) {
    checks.push({ check: 'packageLock', ok: true, skipped: true });
  } else if (!pathInside(root, lockfilePath)) {
    checks.push(fail('packageLock', 'package-lock path escaped checkout'));
  } else {
    try {
      const actual = await regularFileDigest(lockfilePath);
      const expected = manifest.packageLock;
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        checks.push(fail('packageLock', 'package-lock.json digest differs', { expected, actual }));
      } else checks.push({ check: 'packageLock', ok: true, actual });
    } catch (error) {
      checks.push(fail('packageLock', `cannot read package-lock.json: ${String(error?.message ?? error)}`));
    }
  }

  const dist = manifest?.dist;
  if (!dist || typeof dist !== 'object') {
    checks.push(fail('dist', 'manifest has no dist section'));
  } else {
    const distRoot = resolve(root, typeof dist.root === 'string' ? dist.root : 'dist');
    if (!pathInside(root, distRoot)) {
      checks.push(fail('dist', 'manifest dist root escaped checkout', { root: dist.root }));
    } else {
      const expectedFiles = Array.isArray(dist.files) ? dist.files : [];
      const actualFiles = [];
      for (const entry of expectedFiles) {
        if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
          checks.push(fail('dist-file', 'manifest contains an invalid file entry', entry));
          continue;
        }
        const filePath = resolve(root, entry.path);
        if (!pathInside(distRoot, filePath)) {
          checks.push(fail('dist-file', `manifest file escaped dist root: ${entry.path}`));
          continue;
        }
        try {
          const actual = await digest(filePath);
          actualFiles.push({ path: entry.path, ...actual });
          if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) {
            checks.push(fail('dist-file', `digest differs: ${entry.path}`, { expected: entry, actual: { path: entry.path, ...actual } }));
          }
        } catch (error) {
          checks.push(fail('dist-file', `missing or unreadable: ${entry.path}`, String(error?.message ?? error)));
        }
      }
      let actualDistFiles = [];
      try {
        const { readdir } = await import('node:fs/promises');
        async function walk(dir) {
          const out = [];
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const child = resolve(dir, entry.name);
            if (entry.isSymbolicLink()) {
              throw new Error(`dist contains unsupported symbolic link: ${child}`);
            }
            if (entry.isDirectory()) out.push(...await walk(child));
            else if (entry.isFile()) out.push(child);
          }
          return out;
        }
        actualDistFiles = (await walk(distRoot)).map((path) => relative(root, path)).sort();
      } catch (error) {
        checks.push(fail('dist', `cannot enumerate dist: ${String(error?.message ?? error)}`));
      }
      const expectedPaths = expectedFiles.map((entry) => entry?.path).filter((value) => typeof value === 'string').sort();
      if (JSON.stringify(expectedPaths) !== JSON.stringify(actualDistFiles)) {
        checks.push(fail('dist-file-set', 'dist file set differs', { expected: expectedPaths, actual: actualDistFiles }));
      } else {
        checks.push({ check: 'dist-file-set', ok: true, files: actualDistFiles.length });
      }
      const actualBytes = actualFiles.reduce((sum, entry) => sum + entry.bytes, 0);
      if (typeof dist.bytes === 'number' && actualBytes !== dist.bytes) {
        checks.push(fail('dist-bytes', `dist byte total differs: expected ${dist.bytes}, got ${actualBytes}`));
      } else checks.push({ check: 'dist-bytes', ok: true, bytes: actualBytes });
      if (dist.present !== true) checks.push(fail('dist-present', 'manifest does not mark dist as present'));
    }
  }

  const ok = checks.every((check) => check.ok);
  const report = {
    schemaVersion: 1,
    manifest: manifestPath,
    root,
    ok,
    checks,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  if (jsonOutput) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: false, error: String(error?.message ?? error) })}\n`);
  else process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
