import test from 'node:test';
import assert from 'node:assert/strict';

test('Vela Workspace adapter focuses executions through the public renderer seam', async () => {
  const { focusBacktestExecution } = await import(
    '../src/integrations/vela/backtest-chart-adapter.ts?workspace-adapter-test'
  );
  const calls = [];
  let highlights = [
    { from: 100, to: 200, color: 'rgba(1,2,3,0.1)' },
  ];
  const cell = {
    timeframe: '60',
    chart: {
      getVisibleRange: () => ({ from: 0, to: 1000 }),
      setVisibleRange: (range) => calls.push({ kind: 'range', range }),
      renderer: {
        supportsExternalCrosshair: true,
        setExternalCrosshair: (time, price) => calls.push({ kind: 'crosshair', time, price }),
        supports: (feature) => feature === 'highlights',
        get: (feature) => feature === 'highlights' ? highlights : undefined,
        set: (feature, value) => {
          assert.equal(feature, 'highlights');
          highlights = value;
          calls.push({ kind: 'highlight', value });
        },
      },
    },
    focus: () => calls.push({ kind: 'focus' }),
  };
  const workspace = {
    root: {},
    cell: (id) => id === 'cell-1' ? cell : undefined,
    setActiveCell: (id) => calls.push({ kind: 'active', id }),
  };
  assert.equal(focusBacktestExecution(workspace, {
    cellId: 'cell-1',
    indicatorId: 'strategy-1',
    barIndex: 4,
    time: 500,
    price: 101.25,
    side: 'entry',
  }), true);
  assert.deepEqual(calls.map((call) => call.kind), [
    'active', 'range', 'crosshair', 'highlight', 'focus',
  ]);
  assert.deepEqual(calls[2], { kind: 'crosshair', time: 500, price: 101.25 });
  assert.deepEqual(calls[3], {
    kind: 'highlight',
    value: [
      { from: 100, to: 200, color: 'rgba(1,2,3,0.1)' },
      { from: 500, to: 500 + 60 * 60 * 1000, color: 'rgba(37, 99, 235, 0.18)' },
    ],
  });

  // A second locate replaces the previous temporary band while retaining
  // unrelated host highlights. Exit uses the distinct reference red token.
  calls.length = 0;
  assert.equal(focusBacktestExecution(workspace, {
    cellId: 'cell-1',
    indicatorId: 'strategy-1',
    time: 800,
    price: 99.5,
    side: 'exit',
  }), true);
  assert.deepEqual(calls.find((call) => call.kind === 'highlight'), {
    kind: 'highlight',
    value: [
      { from: 100, to: 200, color: 'rgba(1,2,3,0.1)' },
      { from: 800, to: 800 + 60 * 60 * 1000, color: 'rgba(239, 68, 68, 0.18)' },
    ],
  });
  assert.equal(focusBacktestExecution(workspace, {
    cellId: 'missing',
    indicatorId: 'strategy-1',
    time: 500,
    side: 'exit',
  }), false);
});

test('chart locate degrades cleanly when a renderer cannot paint highlights', async () => {
  const { focusBacktestExecution } = await import(
    '../src/integrations/vela/backtest-chart-adapter.ts?workspace-adapter-no-highlight-test'
  );
  const calls = [];
  const cell = {
    timeframe: '15',
    chart: {
      getVisibleRange: () => ({ from: 0, to: 1000 }),
      setVisibleRange: (range) => calls.push({ kind: 'range', range }),
      renderer: {
        supportsExternalCrosshair: false,
      },
    },
    focus: () => calls.push({ kind: 'focus' }),
  };
  const workspace = {
    root: {},
    cell: (id) => id === 'cell-1' ? cell : undefined,
    setActiveCell: (id) => calls.push({ kind: 'active', id }),
  };
  assert.equal(focusBacktestExecution(workspace, {
    cellId: 'cell-1',
    indicatorId: 'strategy-1',
    time: 500,
    side: 'entry',
  }), true);
  assert.deepEqual(calls.map((call) => call.kind), ['active', 'range', 'focus']);
});
