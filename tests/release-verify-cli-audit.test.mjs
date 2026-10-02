import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = (...args) => spawnSync(process.execPath,
  ['scripts/verify-release-manifest.mjs', ...args], { encoding: 'utf8' });

test('release verifier help explains the two-step workflow without verifying itself', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm run release:manifest/);
  assert.match(result.stdout, /npm run release:verify -- --manifest/);
  assert.doesNotMatch(result.stderr, /Error:|at file:/);
});

test('release verifier missing manifest fails closed with actionable non-stack help', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--manifest/);
  assert.doesNotMatch(result.stderr, /at file:|throw new Error/);
});
