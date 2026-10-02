#!/usr/bin/env node

/**
 * Enforce the measured production bundle budget for the startup optimization.
 * The check is intentionally asset-role based instead of hash based, so Vite
 * may continue to fingerprint files without weakening the budget.
 */
import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = resolve(root, 'dist/assets');
const json = process.argv.includes('--json');

// Budgets are deliberately only ~7–10% above the current verified output:
// they catch accidental eager imports without blocking harmless hash changes.
const budgets = {
  main: { raw: 2_450_000, gzip: 720_000 },
  worker: { raw: 900_000, gzip: 240_000 },
  highcharts: { raw: 450_000, gzip: 160_000 },
};

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(directory, entry.name));
}

function roleOf(name) {
  const base = name.split('/').pop() ?? name;
  if (/^worker-engine-.*\.js$/.test(base)) return 'worker';
  if (/^highcharts(?:-more)?-.*\.js$/.test(base)) return 'highcharts';
  if (/^index-.*\.js$/.test(base)) return 'main';
  return null;
}

async function main() {
  let directory;
  try {
    directory = await stat(distRoot);
  } catch {
    throw new Error('Missing dist/assets; run npm run build first');
  }
  if (!directory.isDirectory()) throw new Error('dist/assets is not a directory');

  const files = await filesIn(distRoot);
  const report = Object.fromEntries(Object.keys(budgets).map((role) => [role, {
    files: [], raw: 0, gzip: 0, budget: budgets[role], pass: true,
  }]));
  for (const file of files) {
    const role = roleOf(file);
    if (!role) continue;
    const content = await readFile(file);
    const item = report[role];
    item.files.push(relative(root, file));
    item.raw += content.byteLength;
    item.gzip += gzipSync(content, { level: 9 }).byteLength;
  }
  const missing = Object.entries(report)
    .filter(([, item]) => item.files.length === 0)
    .map(([role]) => role);
  for (const item of Object.values(report)) {
    item.pass = item.files.length > 0
      && item.raw <= item.budget.raw
      && item.gzip <= item.budget.gzip;
  }
  const failures = [
    ...missing.map((role) => ({ role, reason: 'missing asset group' })),
    ...Object.entries(report)
      .filter(([, item]) => !item.pass && item.files.length > 0)
      .map(([role, item]) => ({ role, reason: 'budget exceeded', raw: item.raw, gzip: item.gzip, budget: item.budget })),
  ];
  const output = { dist: relative(root, distRoot), budgets, report, failures, pass: failures.length === 0 };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  if (json) process.stdout.write(`${JSON.stringify({ pass: false, error: String(error?.message ?? error) })}\n`);
  else process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
