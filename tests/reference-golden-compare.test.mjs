import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const rows = [{
  number: 1,
  side: 'long',
  entryTime: 1_700_000_000_000,
  entryPrice: 100,
  exitTime: 1_700_003_600_000,
  exitPrice: 105,
  qty: 1,
  pnl: 5,
  mfe: 8,
  mae: -2,
}];

async function invoke(reference, local) {
  return run('python3', ['tests/reference_golden_compare.py', '--reference', reference, '--local', local], {
    cwd: process.cwd(),
  });
}

test('reference golden comparator accepts a complete matching report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    await writeFile(reference, JSON.stringify({ rows }));
    await writeFile(local, JSON.stringify({ trades: rows }));
    const result = await invoke(reference, local);
    assert.match(result.stdout, /"pass": true/);
    assert.match(result.stdout, /"differenceCount": 0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator rejects a field mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    await writeFile(reference, JSON.stringify({ rows }));
    await writeFile(local, JSON.stringify({ trades: [{ ...rows[0], pnl: 5.5 }] }));
    await assert.rejects(
      invoke(reference, local),
      error => error?.code === 1 && /"pass": false/.test(String(error.stdout)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator returns not-run for missing complete inputs', async () => {
  await assert.rejects(
    invoke('/tmp/quant-reference-does-not-exist.json', '/tmp/quant-local-does-not-exist.json'),
    error => error?.code === 2 && /both complete golden inputs are required/.test(String(error.stdout)),
  );
});
