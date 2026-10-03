#!/usr/bin/env node

/**
 * Emit a reproducible, read-only release manifest.
 *
 * The command deliberately writes only stdout.  A deployment job can redirect
 * it to an artifact, while a developer can run it from the working tree
 * without changing files, checking out another ref, or deleting build output.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const usage = `Usage: npm run release:manifest -- [--root <checkout>] [--dist <directory>] [--require-clean] [--require-dist]

Emit a read-only JSON manifest for an already-built checkout. The manifest is
written to stdout; redirect it to a file outside the checkout before verifying.
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(usage);
  process.exit(0);
}

/**
 * Read a small `--name value`/`--name=value` option without pulling a CLI
 * parser into the release path.  The manifest command is intentionally
 * dependency-free so it can also be used from an older checkout that does
 * not yet contain this script (invoke this copy with `--root`).
 */
function option(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const requestedRoot = option('--root');
const root = resolve(requestedRoot ?? defaultRoot);
const requestedDist = option('--dist');
const distRoot = resolve(root, requestedDist ?? 'dist');

function pathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

if (!pathInside(root, distRoot)) {
  throw new Error(`dist path must be inside root (${distRoot})`);
}

function runGit(args) {
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

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    // A release manifest must describe the bytes that will be served.  A
    // symlink would make that contract depend on the deployment tar/rsync
    // implementation (and could point outside dist), so fail closed instead
    // of silently omitting it from the manifest.
    if (entry.isSymbolicLink()) {
      throw new Error(`dist contains unsupported symbolic link: ${path}`);
    }
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function digest(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function optionalDigest(path) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) throw new Error(`unsupported symbolic link: ${path}`);
  if (!info.isFile()) return null;
  return digest(path);
}

async function main() {
  const distInfo = await lstat(distRoot).catch(() => null);
  const distFiles = [];
  if (distInfo?.isDirectory()) {
    for (const path of await walk(distRoot)) {
      const file = await digest(path);
      distFiles.push({ path: relative(root, path), ...file });
    }
  }
  const lockfile = await optionalDigest(resolve(root, 'package-lock.json'));
  const status = runGit(['status', '--short']);
  const dirtyFiles = status ? status.split('\n').filter(Boolean) : [];
  if (process.argv.includes('--require-clean') && dirtyFiles.length > 0) {
    throw new Error(
      `working tree is not clean (${dirtyFiles.length} entries); omit --require-clean only for a diagnostic manifest`,
    );
  }
  if (process.argv.includes('--require-dist') && !distInfo?.isDirectory()) {
    throw new Error('dist/ is missing; run npm run build before creating a release manifest');
  }
  const manifest = {
    schemaVersion: 1,
    manifestKind: 'release',
    generatedAt: new Date().toISOString(),
    root: '.',
    commit: runGit(['rev-parse', 'HEAD']),
    branch: runGit(['branch', '--show-current']),
    gitStatus: dirtyFiles,
    node: process.version,
    npm: (() => {
      try {
        return execFileSync('npm', ['--version'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return null;
      }
    })(),
    packageLock: lockfile,
    dist: {
      present: Boolean(distInfo?.isDirectory()),
      root: relative(root, distRoot) || '.',
      files: distFiles,
      bytes: distFiles.reduce((sum, file) => sum + file.bytes, 0),
    },
  };
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
