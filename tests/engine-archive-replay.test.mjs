import assert from 'node:assert/strict';
import test from 'node:test';
import { archivedRequest, compareArchivedSnapshot, validateMetadata, validateRunIdentity } from './replay_engine_archive.mjs';

const metadata = () => ({
  schemaVersion: 1, archiveSha256: 'sealed-input', selections: [{ scenario: 'archived-case' }],
  request: { mode: 'static', historyState: 'complete',
    market: { symbol: 'BTC', timeframe: '60', chartStyle: 'candles', symbolInfo: null },
    inputs: {}, props: {}, visibleRange: null,
    barMagnifier: { requested: true, lowerTimeframe: '10', asOf: 1704078000000 } },
  missingFromOriginalArchive: ['asOf'], reconstruction: { asOf: 'Explicit archival source constant.' },
});

const snapshot = (runId) => ({
  barIndex: 1,
  strategy: { reportRunId: runId, reportSnapshotRevision: 1, netPnl: -2 },
  trades: [{ id: 'trade_1', qty: 2, commission: 2 }],
  auditLedger: { runId, snapshotRevision: 1, barIndex: 1,
    orderEvents: [{ orderId: 'exit-1', parentOrderIds: ['entry-1'] }], fillEvents: [] },
  reportSeries: { runId, snapshotRevision: 1, barIndex: 1, points: [{ equity: 998 }] },
  executionPrecision: { requested: true, applied: true, coverage: 1 }, warnings: [],
});

test('archive replay refuses missing or undocumented execution metadata', () => {
  assert.ok(validateMetadata(metadata(), 'sealed-input'));
  const noAsOf = metadata(); delete noAsOf.request.barMagnifier.asOf;
  assert.throws(() => validateMetadata(noAsOf, 'sealed-input'), /asOf/);
  const noInfo = metadata(); delete noInfo.request.market.symbolInfo;
  assert.throws(() => validateMetadata(noInfo, 'sealed-input'), /symbolInfo/);
  const unaccounted = metadata(); unaccounted.reconstruction = {};
  assert.throws(() => validateMetadata(unaccounted, 'sealed-input'), /reconstruction explanation/);
  assert.throws(() => validateMetadata(metadata(), 'different-input'), /another archive/);
});

test('archive replay allows a fresh run ID only after matching all envelope identities', () => {
  const first = snapshot('archived-run'); const second = snapshot('new-run');
  assert.equal(compareArchivedSnapshot(first, second).pass, true);
  second.auditLedger.runId = 'older-run';
  assert.throws(() => validateRunIdentity(second), /run identity mismatch/);
});

test('archive replay catches fees, audit parent relationships, curve and precision drift', () => {
  const first = snapshot('archive'); const second = snapshot('replay');
  second.trades[0].commission = 3;
  second.auditLedger.orderEvents[0].parentOrderIds = ['wrong-entry'];
  second.reportSeries.points[0].equity = 997;
  second.executionPrecision.applied = false;
  const comparison = compareArchivedSnapshot(first, second);
  assert.equal(comparison.pass, false);
  assert.deepEqual(comparison.differences.map((item) => item.path), [
    'context.trades[0].commission', 'context.auditLedger.orderEvents[0].parentOrderIds[0]',
    'context.reportSeries.points[0].equity', 'context.executionPrecision.applied',
  ]);
});

test('new archive replays captured absence, metadata and candles without reconstructing defaults', () => {
  const request = metadata().request;
  request.bars = [{ time: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 }];
  request.props = null;
  request.visibleRange = null;
  request.historyState = null;
  request.market.symbolInfo = null;
  request.barMagnifier = { asOf: 1704078000000 };
  const presence = Object.fromEntries(['market.symbol', 'market.timeframe', 'market.symbolInfo', 'market.chartStyle',
    'mode', 'historyState', 'inputs', 'props', 'visibleRange', 'barMagnifier'].map((key) => [key, 'value']));
  Object.assign(presence, { 'market.symbolInfo': 'undefined', historyState: 'absent', props: 'absent', visibleRange: 'undefined' });
  const item = { inputs: { source: 'strategy("archive")', parents: request.bars },
    actual: { executionRequests: [{ schemaVersion: 1, request, presence,
      prepared: { source: 'strategy("archive")' }, callbacks: { getBars: true, fetchSeries: true } }] } };
  const resolved = archivedRequest(item);
  assert.equal(resolved.exact, true);
  assert.equal(Object.hasOwn(resolved.request, 'props'), false);
  assert.equal(Object.hasOwn(resolved.request, 'historyState'), false);
  assert.equal(Object.hasOwn(resolved.request, 'visibleRange'), true);
  assert.equal(resolved.request.visibleRange, undefined);
  assert.equal(resolved.request.market.symbolInfo, undefined);
  assert.equal(resolved.request.barMagnifier.requested, undefined, 'source declares precision; do not add an override');
  assert.throws(() => archivedRequest({ inputs: item.inputs, actual: {} }), /explicit metadata supplement/);
  const ambiguous = structuredClone(item);
  ambiguous.actual.executionRequests.push(ambiguous.actual.executionRequests[0]);
  assert.throws(() => archivedRequest(ambiguous), /update timeline/);
});
