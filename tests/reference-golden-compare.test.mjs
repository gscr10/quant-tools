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

test('reference golden comparator rejects an omitted required field instead of equating two missing values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    const incomplete = { ...rows[0] };
    delete incomplete.mfe;
    await writeFile(reference, JSON.stringify({ rows: incomplete ? [incomplete] : [] }));
    await writeFile(local, JSON.stringify({ trades: rows }));
    await assert.rejects(
      invoke(reference, local),
      error => error?.code === 1 && /missing-field/.test(String(error.stdout)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator rejects duplicate Trade # records without overwriting one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    await writeFile(reference, JSON.stringify({ rows: [rows[0], { ...rows[0], pnl: 99 }] }));
    await writeFile(local, JSON.stringify({ trades: rows }));
    await assert.rejects(
      invoke(reference, local),
      error => error?.code === 1 && /duplicate-trade-number/.test(String(error.stdout)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator normalizes side case and numeric strings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    const equivalent = {
      ...rows[0],
      side: 'LONG',
      entryTime: '1700000000000',
      exitTime: '1700003600000',
      entryPrice: '100',
      qty: '1',
      pnl: '5',
    };
    await writeFile(reference, JSON.stringify({ rows }));
    await writeFile(local, JSON.stringify({ trades: [equivalent] }));
    const result = await invoke(reference, local);
    assert.match(result.stdout, /"pass": true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator preserves an explicitly empty trades array', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    await writeFile(reference, JSON.stringify({ trades: [] }));
    await writeFile(local, JSON.stringify({ trades: rows }));
    await assert.rejects(
      invoke(reference, local),
      error => error?.code === 1 && /"referenceTrades": 0/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator rejects an envelope containing both trade containers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    await writeFile(reference, JSON.stringify({ trades: [], rows }));
    await writeFile(local, JSON.stringify({ trades: rows }));
    await assert.rejects(
      invoke(reference, local),
      error => error?.code === 1 && /ambiguous trade envelope/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator rejects boolean and fractional Trade # values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const local = join(root, 'local.json');
    await writeFile(local, JSON.stringify({ trades: rows }));
    for (const number of [true, 1.5]) {
      const reference = join(root, `reference-${String(number)}.json`);
      await writeFile(reference, JSON.stringify({ rows: [{ ...rows[0], number }] }));
      await assert.rejects(
        invoke(reference, local),
        error => error?.code === 1 && /invalid-trade-number/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator rejects identical invalid evidence on both sides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    for (const patch of [
      { entryPrice: null }, { entryTime: null }, { qty: null }, { pnl: null },
      { mfe: null }, { mae: null }, { qty: true }, { side: null },
      { side: 'unknown' }, { entryTime: 1.5 }, { mfe: 'Infinity' },
      { open: true }, { exitTime: null },
    ]) {
      const payload = JSON.stringify({ trades: [{ ...rows[0], ...patch }] });
      await writeFile(reference, payload);
      await writeFile(local, payload);
      await assert.rejects(invoke(reference, local), error => {
        assert.equal(error.code, 1, JSON.stringify(patch));
        assert.equal(JSON.parse(error.stdout).pass, false);
        return true;
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference golden comparator accepts explicit null exit and realized P&L for an open trade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-reference-golden-'));
  try {
    const reference = join(root, 'reference.json');
    const local = join(root, 'local.json');
    const payload = JSON.stringify({ trades: [{ ...rows[0], open: true, exitTime: null, exitPrice: null, pnl: null }] });
    await writeFile(reference, payload);
    await writeFile(local, payload);
    assert.equal(JSON.parse((await invoke(reference, local)).stdout).pass, true);
    for (const tolerance of ['NaN', 'Infinity', '-1']) {
      await assert.rejects(run('python3', [
        'tests/reference_golden_compare.py', '--reference', reference,
        '--local', local, '--tolerance', tolerance,
      ]), error => error.code === 1 && /finite and non-negative/.test(error.stderr));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
