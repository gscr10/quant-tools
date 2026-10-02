#!/usr/bin/env node

/**
 * Check the generated static bundle for accidental reference-site/auth
 * material.  This is deliberately a narrow release check: provider API URLs
 * and the Vela attribution URL are allowed because they are local code
 * contracts, while the reference app host, Next chunks and browser auth
 * artifacts are not.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = resolve(root, 'dist');
const jsonOutput = process.argv.includes('--json');

const forbiddenPatterns = [
  { id: 'reference-host', pattern: /https?:\/\/app\.luxalgo\.com\b/gi },
  { id: 'next-static-chunk', pattern: /(?:["']?(?:_next\/|next\/static\/))/gi },
  { id: 'storage-state-artifact', pattern: /(?:storageState|storage-state|sessionStorage\s*[:=])/gi },
  { id: 'cookie-artifact', pattern: /(?:set-cookie|document\.cookie|cookie\s*[:=])/gi },
  // Catch accidentally bundled account identifiers without hard-coding a
  // user's address or password in this repository.
  { id: 'email-address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function main() {
  let info;
  try {
    info = await stat(distRoot);
  } catch {
    throw new Error(`Missing ${relative(root, distRoot)}; run npm run build first`);
  }
  if (!info.isDirectory()) throw new Error(`${relative(root, distRoot)} is not a directory`);

  const files = await walk(distRoot);
  const violations = [];
  let bytes = 0;
  const remoteResourceUrls = [];
  for (const file of files) {
    const buffer = await readFile(file);
    bytes += buffer.byteLength;
    // Source maps/binary assets are not part of this check; text bundles are.
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    const name = relative(root, file);
    for (const entry of forbiddenPatterns) {
      entry.pattern.lastIndex = 0;
      let match;
      while ((match = entry.pattern.exec(text)) !== null) {
        const line = text.slice(0, match.index).split('\n').length;
        violations.push({ id: entry.id, file: name, line });
        if (violations.length > 100) break;
      }
      if (violations.length > 100) break;
    }
    if (name.endsWith('.html') || name.endsWith('.css')) {
      const expression = /(?:src|href)=["'](https?:\/\/[^"']+)|url\((?:["']?)(https?:\/\/[^)"']+)/gi;
      let match;
      while ((match = expression.exec(text)) !== null) remoteResourceUrls.push({ file: name, url: match[1] ?? match[2] });
    }
  }

  const report = {
    dist: relative(root, distRoot),
    files: files.length,
    bytes,
    forbiddenMatches: violations,
    staticRemoteResourceUrls: remoteResourceUrls,
    allowedRuntimeUrlNote: 'Provider API URLs and https://luxalgo.com/vela attribution may exist in local bundles; runtime E2E separately blocks unexpected requests.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (violations.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  if (jsonOutput) process.stdout.write(`${JSON.stringify({ error: String(error?.message ?? error) })}\n`);
  else process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
