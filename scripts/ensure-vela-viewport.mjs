#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vela 0.7.7's public viewport API clamps every wheel/pinch/keyboard/animation
 * path to 0.5 CSS px per candle. That cannot frame 2,000 bars on a narrow cell.
 * Lower only the absolute numerical floor; Vela's actual n + margin fit bound,
 * maximum zoom and bounded panning are unchanged. Never rewrite an unknown
 * package: both original and idempotent output are pinned by complete SHA-256.
 */
export const VELA_VIEWPORT_PATCH = Object.freeze({
  version: '0.7.7',
  file: 'node_modules/@luxalgo/vela/dist/chunk-RVQWJOEE.js',
  originalSha256: '9fc236010d69a7def77993d59eb44ee6611538789e58ca33404623a4f9a31eac',
  patchedSha256: 'd7cb041243163b876a4468eb39513d864dfa8a9de16fe1439190ac7b2981e111',
  original: 'var MIN_BAR_SPACING = 0.5;',
  replacement: 'var MIN_BAR_SPACING = 1e-6;',
});

const digest = value => createHash('sha256').update(value).digest('hex');

function regularFile(root, relative) {
  let current = root;
  const segments = relative.split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`[vela-viewport] symbolic link is not allowed: ${relative}`);
    if (index === segments.length - 1 ? !info.isFile() : !info.isDirectory()) {
      throw new Error(`[vela-viewport] invalid package path: ${relative}`);
    }
  }
  return current;
}

export function ensureVelaViewport({ root = process.cwd(), checkOnly = false } = {}) {
  const manifestPath = regularFile(root, 'node_modules/@luxalgo/vela/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== '@luxalgo/vela' || manifest.version !== VELA_VIEWPORT_PATCH.version) {
    throw new Error(`[vela-viewport] unsupported dependency ${manifest.name}@${manifest.version}; expected @luxalgo/vela@${VELA_VIEWPORT_PATCH.version}`);
  }
  const target = regularFile(root, VELA_VIEWPORT_PATCH.file);
  const source = readFileSync(target, 'utf8');
  const currentSha = digest(source);
  if (currentSha === VELA_VIEWPORT_PATCH.patchedSha256) return { status: 'verified', sha256: currentSha };
  if (currentSha !== VELA_VIEWPORT_PATCH.originalSha256) {
    throw new Error(`[vela-viewport] unknown installed content (${currentSha}); refusing to patch ${VELA_VIEWPORT_PATCH.file}`);
  }
  if (checkOnly) throw new Error('[vela-viewport] viewport compatibility patch is missing; run npm run build:forks');
  const patched = source.replace(VELA_VIEWPORT_PATCH.original, VELA_VIEWPORT_PATCH.replacement);
  if (digest(patched) !== VELA_VIEWPORT_PATCH.patchedSha256) {
    throw new Error('[vela-viewport] patched content did not match the reviewed output');
  }
  const temporary = join(dirname(target), `.quant-viewport-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, patched, { flag: 'wx', mode: lstatSync(target).mode });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  // Vite does not fingerprint dependency file contents. Invalidate only its
  // generated metadata, so the NEXT server rebuilds the old optimized chunks.
  // No live server is stopped, no source/output tree is deleted.
  try {
    const metadata = regularFile(root, 'node_modules/.vite/deps/_metadata.json');
    rmSync(metadata);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { status: 'applied', sha256: VELA_VIEWPORT_PATCH.patchedSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = ensureVelaViewport({ checkOnly: process.argv.includes('--check-only') });
    console.log(`[vela-viewport] ${result.status} @luxalgo/vela@${VELA_VIEWPORT_PATCH.version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
