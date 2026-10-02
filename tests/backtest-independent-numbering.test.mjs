import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSnapshot } from '../src/app/backtest-controller.ts';

function reportFor(specs) {
  const trades = specs.map(([pnl, exitTime], index) => ({
    id: `audit-${index}`, tradeNumber: 42 + index * 35, side: 'long', qty: 1,
    entry: { time: 1000, price: 100 },
    exit: exitTime === null ? undefined : { time: exitTime, price: 100 + pnl },
    open: exitTime === null, pnl,
  }));
  return mapSnapshot({
    key: { cellId: 'audit', indicatorId: 'numbering' }, revision: 1, epoch: 0,
    runToken: 'independent-numbering', status: 'ready', finality: 'historical-final',
    ledgerState: 'ready', ledgerRevision: 1, visible: true,
    capabilities: { tradeLedger: true }, trades,
    context: { meta: { title: 'Independent numbering' }, strategy: { initialCapital: 1000 }, trades },
  });
}

for (const [name, specs, expected] of [
  ['win / breakeven / open', [[10, 2000], [0, 3000], [0, null]], [1, 2, 0]],
  ['closed only', [[10, 3000], [-10, 2000]], [2, 1]],
  ['breakeven only', [[0, 2000], [0, 3000]], [1, 2]],
  ['open only', [[0, null]], [0]],
  ['equal close timestamps', [[10, 2000], [0, 2000], [5, 2000]], [3, 2, 1]],
  ['multiple open lots', [[0, null], [10, 2000], [0, null]], [0, 1, 0]],
]) {
  test(`independent F06: ${name} has positive unique closed ordinals and open #0`, () => {
    const rows = reportFor(specs).trades;
    assert.deepEqual(rows.map(row => row.number), expected);
    const closed = rows.filter(row => row.status !== 'open').map(row => row.number);
    assert.equal(new Set(closed).size, closed.length);
    assert.ok(closed.every(number => Number.isInteger(number) && number > 0));
    assert.ok(rows.filter(row => row.status === 'open').every(row => row.number === 0));
  });
}
