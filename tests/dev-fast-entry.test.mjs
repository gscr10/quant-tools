import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('dev:fast --check-only verifies fork outputs without forwarding the flag to Vite', () => {
  // Keep this focused test runnable on its own as well as through `npm test`.
  // The repository pretest hook normally prepares the fork outputs, but a
  // direct invocation must not depend on a previous build or race with one.
  execFileSync(process.execPath, ['scripts/ensure-fork-build.mjs'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  const output = execFileSync(process.execPath, ['scripts/dev-fast.mjs', '--check-only'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /verified current outputs|outputs became current/);
});
