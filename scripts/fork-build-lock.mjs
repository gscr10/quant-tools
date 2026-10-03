import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_LOCK_WAIT_MS = 100;
export const DEFAULT_STALE_LOCK_MS = 15 * 60 * 1_000;

function sleep(ms) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable by this user. It
    // must still keep the build lock; only ESRCH/invalid-pid means dead.
    return error?.code === 'EPERM';
  }
}

/**
 * Acquire a directory lock. Stale lock reclamation first atomically renames
 * the old directory away; it must not rm the shared path directly, otherwise
 * two waiters can both remove/recreate the same lock and build concurrently.
 */
export function acquireBuildLock({
  root,
  lockPath = join(root, '.cache', 'quant-tools-fork-build.lock'),
  waitMs = DEFAULT_LOCK_WAIT_MS,
  staleMs = DEFAULT_STALE_LOCK_MS,
  pid = process.pid,
  isAlive = processIsAlive,
  sleepFn = sleep,
  log = console.log,
  // Test-only hook.  It is intentionally not used by production callers; it
  // lets the lock regression suite place a replacement owner in the exact
  // window between the first token read and the atomic hand-off below.
  beforeReleaseRename,
  // Test-only hook for forcing owner-record setup failures after mkdir() has
  // claimed the shared lock directory.
  beforeOwnerRecord,
} = {}) {
  mkdirSync(join(root, '.cache'), { recursive: true });
  const token = randomUUID();
  while (true) {
    try {
      mkdirSync(lockPath);
      const ownerPath = join(lockPath, 'owner.json');
      const tempOwnerPath = join(lockPath, `.owner-${pid}-${token}.tmp`);
      try {
        beforeOwnerRecord?.({ lockPath, ownerPath, tempOwnerPath });
        writeFileSync(tempOwnerPath, JSON.stringify({ pid, startedAt: Date.now(), token }));
        renameSync(tempOwnerPath, ownerPath);
      } catch (error) {
        // mkdir(lockPath) is the ownership claim. If writing the owner record
        // fails (disk full, permissions, interrupted filesystem), leaving the
        // empty directory behind turns a transient setup error into a stale
        // lock that every later caller must wait out for 15 minutes. No other
        // process can have acquired this directory while we own the claim, so
        // it is safe to remove our incomplete claim before propagating the
        // original error.
        try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* preserve original error */ }
        throw error;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // Never remove a lock that has been reclaimed/replaced by another
        // process.  First validate the owner, then atomically move the
        // directory out of the shared name.  The second token check matters:
        // a stale-lock reclaimer can replace the shared directory between the
        // first read and rename.  If the moved directory belongs to somebody
        // else, put it back and leave it intact.
        try {
          const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
          if (owner.token !== token) return;
        } catch {
          return;
        }
        beforeReleaseRename?.();
        const releasingPath = `${lockPath}.release-${pid}-${token}`;
        try {
          renameSync(lockPath, releasingPath);
        } catch {
          // Another reclaimer already moved the old directory.  It is not
          // safe to remove anything at the shared path in this case.
          return;
        }
        try {
          const movedOwner = JSON.parse(readFileSync(join(releasingPath, 'owner.json'), 'utf8'));
          if (movedOwner.token !== token) {
            // The shared path was replaced after the first validation.  Do
            // not delete the replacement; restore it under the shared name.
            try { renameSync(releasingPath, lockPath); } catch { /* replacement already owns the path */ }
            return;
          }
        } catch {
          // A malformed/missing owner is not proof that this process owns the
          // directory.  Keep the moved directory recoverable rather than
          // deleting another process's lock.
          try { renameSync(releasingPath, lockPath); } catch { /* best effort */ }
          return;
        }
        rmSync(releasingPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')); } catch { /* owner may be mid-write */ }
      let lockAge = 0;
      try { lockAge = Date.now() - statSync(lockPath).mtimeMs; } catch { /* lock disappeared */ }
      if ((!owner || !isAlive(owner.pid)) && lockAge > staleMs) {
        // Serialize stale reclamation itself. Without this second mutex, two
        // waiters can both inspect the same dead owner; one may create a new
        // lock while the other then renames that fresh lock away.
        const reclaimPath = `${lockPath}.reclaim`;
        let reclaimRelease;
        const reclaimToken = randomUUID();
        try {
          mkdirSync(reclaimPath);
          const reclaimOwner = join(reclaimPath, 'owner.json');
          const reclaimTemp = join(reclaimPath, `.owner-${pid}-${reclaimToken}.tmp`);
          writeFileSync(reclaimTemp, JSON.stringify({ pid, startedAt: Date.now(), token: reclaimToken }));
          renameSync(reclaimTemp, reclaimOwner);
          reclaimRelease = () => {
            try {
              const current = JSON.parse(readFileSync(reclaimOwner, 'utf8'));
              if (current.token === reclaimToken) rmSync(reclaimPath, { recursive: true, force: true });
            } catch { /* another waiter reclaimed or process is tearing down */ }
          };
        } catch (reclaimLockError) {
          if (reclaimLockError?.code !== 'EEXIST') throw reclaimLockError;
          let reclaimOwner = null;
          try { reclaimOwner = JSON.parse(readFileSync(join(reclaimPath, 'owner.json'), 'utf8')); } catch { /* mid-write */ }
          let reclaimAge = 0;
          try { reclaimAge = Date.now() - statSync(reclaimPath).mtimeMs; } catch { /* disappeared */ }
          if ((!reclaimOwner || !isAlive(reclaimOwner.pid)) && reclaimAge > staleMs) {
            const staleReclaim = `${reclaimPath}.stale-${pid}-${Date.now()}-${randomUUID()}`;
            try {
              renameSync(reclaimPath, staleReclaim);
              rmSync(staleReclaim, { recursive: true, force: true });
            } catch (reclaimError) {
              if (reclaimError?.code !== 'ENOENT' && reclaimError?.code !== 'EEXIST') throw reclaimError;
            }
            continue;
          }
          sleepFn(waitMs);
          continue;
        }
        try {
          // Re-read after acquiring the reclaim mutex; the original owner may
          // have released/replaced the lock while we were waiting.
          let currentOwner = null;
          try { currentOwner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')); } catch { /* retry below */ }
          let currentAge = 0;
          try { currentAge = Date.now() - statSync(lockPath).mtimeMs; } catch { /* disappeared */ }
          if ((currentOwner && isAlive(currentOwner.pid)) || currentAge <= staleMs) continue;
        // Rename is atomic within the cache directory. Only the waiter that
          // wins this rename may remove the stale directory.
          const stalePath = `${lockPath}.stale-${pid}-${Date.now()}-${randomUUID()}`;
          try {
            renameSync(lockPath, stalePath);
            rmSync(stalePath, { recursive: true, force: true });
          } catch (reclaimError) {
            if (reclaimError?.code !== 'ENOENT' && reclaimError?.code !== 'EEXIST') throw reclaimError;
          }
        } finally {
          reclaimRelease();
        }
        continue;
      }
      log('[fork-build] another build is active; waiting for its outputs');
      sleepFn(waitMs);
    }
  }
}
