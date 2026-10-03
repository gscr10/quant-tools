import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireBuildLock } from '../scripts/fork-build-lock.mjs';

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'quant-tools-fork-lock-'));
}

test('fork build lock releases idempotently and can be reacquired', () => {
  const root = tempRoot();
  try {
    const first = acquireBuildLock({ root });
    assert.ok(first);
    first();
    first();
    const second = acquireBuildLock({ root });
    assert.ok(second);
    second();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fork build lock waits for an active owner instead of reclaiming it', () => {
  const root = tempRoot();
  try {
    const first = acquireBuildLock({ root });
    let waits = 0;
    const second = acquireBuildLock({
      root,
      waitMs: 0,
      isAlive: () => true,
      sleepFn: () => { waits += 1; first(); },
      log: () => {},
    });
    assert.equal(waits, 1);
    second();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fork build lock atomically reclaims an old dead owner', () => {
  const root = tempRoot();
  const lockPath = join(root, '.cache', 'quant-tools-fork-build.lock');
  try {
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: -1 }));
    const old = new Date(Date.now() - 10_000);
    utimesSync(lockPath, old, old);
    const release = acquireBuildLock({
      root,
      staleMs: 1,
      isAlive: () => false,
      sleepFn: () => { throw new Error('stale lock was not reclaimed'); },
      log: () => {},
    });
    assert.ok(release);
    release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an owner-record setup failure does not leave an orphan lock directory', () => {
  const root = tempRoot();
  const lockPath = join(root, '.cache', 'quant-tools-fork-build.lock');
  try {
    // Force owner-record hand-off to fail *after* acquire has claimed
    // lockPath. This must not be modeled by pre-creating lockPath, which is a
    // valid active-lock case and should make callers wait instead.
    assert.throws(() => acquireBuildLock({
      root,
      lockPath,
      beforeOwnerRecord: ({ ownerPath }) => mkdirSync(ownerPath),
    }));
    assert.throws(() => readFileSync(join(lockPath, 'owner.json'), 'utf8'), { code: 'ENOENT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release cannot delete a replacement lock installed after token validation', () => {
  const root = tempRoot();
  const lockPath = join(root, '.cache', 'quant-tools-fork-build.lock');
  let replacement;
  try {
    const first = acquireBuildLock({
      root,
      beforeReleaseRename: () => {
        // Model a stale reclaimer completing between the first owner read and
        // release's atomic hand-off, followed by a new owner acquiring the
        // shared lock name.
        rmSync(lockPath, { recursive: true, force: true });
        replacement = acquireBuildLock({ root });
      },
    });
    first();
    assert.ok(replacement);
    const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
    assert.notEqual(owner.token, undefined);
    replacement();
    assert.throws(() => readFileSync(join(lockPath, 'owner.json')));
  } finally {
    replacement?.();
    rmSync(root, { recursive: true, force: true });
  }
});
