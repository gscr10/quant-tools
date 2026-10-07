#!/usr/bin/env node
/** Offline replay of archived engine inputs; never imports a candle generator.
 *
 * node tests/replay_engine_archive.mjs --archive <results.json>
 *   [--metadata <legacy-request-metadata.json>] --output audit-evidence/<new-run>
 *
 * Old browser archives did not retain the complete execution request. A legacy
 * metadata supplement is mandatory and its notes survive in the replay bundle; a
 * successful arithmetic replay must not erase that original provenance gap.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value) => JSON.stringify(value, null, 2) + '\n';
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateMetadata(metadata, archiveHash) {
  assert.equal(metadata?.schemaVersion, 1, 'metadata schemaVersion must be 1');
  assert.equal(metadata.archiveSha256, archiveHash, 'metadata belongs to another archive');
  const request = metadata.request;
  assert.ok(isRecord(request), 'missing explicit request metadata');
  assert.equal(request.mode, 'static', 'this verifier only supports static offline replay');
  assert.equal(request.historyState, 'complete', 'history completion must be explicit');
  assert.ok(isRecord(request.market) && request.market.symbol && request.market.timeframe,
    'market symbol/timeframe must be explicit');
  assert.ok(Object.hasOwn(request.market, 'symbolInfo'), 'symbolInfo presence/absence must be explicit');
  assert.ok(request.market.symbolInfo === null || isRecord(request.market.symbolInfo), 'invalid symbolInfo');
  assert.ok(request.market.chartStyle, 'chartStyle must be explicit');
  assert.ok(isRecord(request.inputs) && isRecord(request.props), 'input/prop overrides must be explicit');
  assert.ok(Object.hasOwn(request, 'visibleRange'), 'visibleRange presence/absence must be explicit');
  assert.ok(Number.isSafeInteger(request.barMagnifier?.asOf) && request.barMagnifier.asOf > 0,
    'asOf must be a fixed epoch; wall-clock fallback is forbidden');
  assert.equal(request.barMagnifier.requested, true, 'these cases require requested high precision');
  assert.ok(request.barMagnifier.lowerTimeframe, 'lower timeframe must be explicit');
  assert.ok(Array.isArray(metadata.missingFromOriginalArchive), 'original metadata gaps must be disclosed');
  assert.ok(isRecord(metadata.reconstruction), 'metadata provenance must be disclosed');
  for (const field of metadata.missingFromOriginalArchive) {
    assert.ok(typeof metadata.reconstruction[field] === 'string' && metadata.reconstruction[field].length > 0,
      `missing reconstruction explanation: ${field}`);
  }
  assert.ok(Array.isArray(metadata.selections) && metadata.selections.length > 0, 'missing selected archive cases');
  return request;
}

export function validateRunIdentity(raw) {
  const strategy = raw?.strategy;
  assert.ok(strategy?.reportRunId, 'strategy run identity missing');
  assert.ok(Number.isSafeInteger(strategy.reportSnapshotRevision), 'strategy revision missing');
  for (const key of ['auditLedger', 'reportSeries']) {
    assert.equal(raw[key]?.runId, strategy.reportRunId, `${key} run identity mismatch`);
    assert.equal(raw[key]?.snapshotRevision, strategy.reportSnapshotRevision, `${key} revision mismatch`);
    assert.equal(raw[key]?.barIndex, raw.barIndex, `${key} bar boundary mismatch`);
  }
}

/** Restore exactly recorded field absence; null is never silently a fallback. */
export function archivedRequest(item, legacyRequest) {
  const captured = item.actual?.executionRequests;
  if (!captured) {
    assert.ok(legacyRequest, 'legacy archive needs explicit metadata supplement');
    const request = structuredClone(legacyRequest);
    if (request.market.symbolInfo === null) delete request.market.symbolInfo;
    if (request.visibleRange === null) delete request.visibleRange;
    return { request, exact: false };
  }
  assert.equal(captured.length, 1, 'multiple executions require an explicit update timeline; unsupported by this finite replay');
  const envelope = captured[0];
  assert.equal(envelope.schemaVersion, 1, 'unknown execute request archive schema');
  const request = structuredClone(envelope.request);
  for (const field of ['market.symbol', 'market.timeframe', 'market.symbolInfo', 'market.chartStyle',
    'mode', 'historyState', 'inputs', 'props', 'visibleRange', 'barMagnifier']) {
    const state = envelope.presence?.[field];
    assert.ok(['absent', 'undefined', 'value'].includes(state), `missing captured presence: ${field}`);
    const parts = field.split('.'); const key = parts.pop();
    const object = parts.length ? request[parts[0]] : request;
    if (state === 'absent') delete object[key];
    else if (state === 'undefined') object[key] = undefined;
  }
  assert.equal(request.mode, 'static', 'replay supports only static runs');
  assert.ok(request.historyState === undefined || request.historyState === 'complete', 'backfill timeline not archived');
  assert.ok(request.market?.symbol && request.market.timeframe, 'captured market missing');
  assert.ok(Number.isSafeInteger(request.barMagnifier?.asOf), 'captured fixed asOf missing');
  assert.equal(envelope.prepared?.source, item.inputs.source, 'prepared Pine differs from archived Pine');
  assert.deepEqual(request.bars, item.inputs.parents, 'effective execute bars differ from archived parent input');
  return { request, exact: true, presence: envelope.presence, callbacks: envelope.callbacks };
}

function comparable(raw) {
  validateRunIdentity(raw);
  const strategy = { ...raw.strategy };
  delete strategy.reportRunId;
  return {
    strategy, trades: raw.trades,
    auditLedger: { ...raw.auditLedger, runId: '<verified-run>' },
    reportSeries: { ...raw.reportSeries, runId: '<verified-run>' },
    executionPrecision: raw.executionPrecision, warnings: raw.warnings,
  };
}

export function compareArchivedSnapshot(expected, actual) {
  const differences = [];
  let fields = 0;
  const walk = (left, right, location) => {
    if (typeof left === 'number' && typeof right === 'number') {
      fields++;
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 1e-9) {
        differences.push({ path: location, expected: left, actual: right });
      }
    } else if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) differences.push({ path: location + '.length', expected: left.length, actual: right.length });
      for (let i = 0; i < Math.max(left.length, right.length); i++) walk(left[i], right[i], `${location}[${i}]`);
    } else if (isRecord(left) && isRecord(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], `${location}.${key}`);
    } else {
      fields++;
      if (left !== right) differences.push({ path: location, expected: left ?? null, actual: right ?? null });
    }
  };
  walk(comparable(expected), comparable(actual), 'context');
  return { fields, differences, pass: differences.length === 0, absoluteNumericTolerance: 1e-9,
    normalizedFields: ['strategy.reportRunId', 'auditLedger.runId', 'reportSeries.runId'],
    note: 'Run identity consistency is validated before replacing only per-execution run IDs. Event, order, parent and trade IDs are compared unchanged.' };
}

function assertArchivedInput(item) {
  const { source, parents, children, parameters } = item.inputs ?? {};
  assert.ok(typeof source === 'string' && source.length > 0, 'archived Pine source missing');
  assert.ok(Array.isArray(parents) && parents.length > 0 && Array.isArray(children) && children.length > 0,
    'archived parent/child candles missing');
  assert.ok(isRecord(parameters), 'archived parameter evidence missing');
  for (const series of [parents, children]) {
    for (const [index, bar] of series.entries()) {
      for (const key of ['time', 'open', 'high', 'low', 'close', 'volume']) assert.ok(Number.isFinite(bar[key]), `invalid candle ${index}.${key}`);
      assert.ok(index === 0 || series[index - 1].time < bar.time, 'candles must already be sorted and unique');
    }
  }
  assert.equal(item.magnified, true, 'selected archive is not a high-precision case');
  assert.ok(item.actual?.raw, 'archived expected context missing');
}

async function replay(PineEngine, item, request) {
  assertArchivedInput(item);
  const engine = new PineEngine();
  const prepared = await engine.prepare(item.inputs.source, `archive-${item.scenario}`);
  const market = { ...request.market };
  const pending = Promise.withResolvers();
  let session;
  const warnings = [];
  const fetchCalls = [];
  const timer = setTimeout(() => pending.reject(new Error('offline replay exceeded 15 seconds')), 15000);
  try {
    session = engine.execute({
      ...request, market, prepared, bars: structuredClone(item.inputs.parents),
      barMagnifier: { ...request.barMagnifier },
      fetchSeries: async (symbol, timeframe, range) => {
        fetchCalls.push({ symbol, timeframe, range });
        assert.equal(symbol, market.symbol, 'unarchived secondary symbol');
        assert.equal(timeframe, item.actual.raw.executionPrecision.lowerTimeframe, 'unarchived secondary timeframe');
        // Filter only the saved rows; never construct missing candles or call
        // the original browser probe's data factory.
        let rows = item.inputs.children.filter((bar) => (range.from == null || bar.time >= range.from)
          && (range.to == null || bar.time <= range.to));
        if (range.limit != null) rows = rows.slice(-range.limit);
        return structuredClone(rows);
      },
    }, { onModel() {}, onDone: pending.resolve, onError: pending.reject, onWarning: (warning) => warnings.push(warning) });
    await pending.promise;
    const raw = await session.getContext(['strategy', 'trades', 'reportSeries', 'auditLedger']);
    validateRunIdentity(raw);
    assert.equal(raw.executionPrecision?.applied, true, 'replay silently lost high precision');
    assert.equal(raw.executionPrecision?.coverage, 1, 'archived child coverage no longer complete');
    const comparison = compareArchivedSnapshot(item.actual.raw, raw);
    const created = new Set(raw.auditLedger.orderEvents.filter((event) => event.kind === 'created').map((event) => event.orderId));
    for (const event of [...raw.auditLedger.orderEvents, ...raw.auditLedger.fillEvents]) {
      for (const parent of event.parentOrderIds ?? []) assert.ok(created.has(parent), `dangling audit parent ${parent}`);
    }
    const uncoveredTradeExitIds = [...new Set(raw.trades.map((trade) => trade.exit?.id).filter(Boolean))]
      .filter((id) => !raw.auditLedger.fillEvents.some((fill) => fill.sourceOrderId === id));
    return { scenario: item.scenario, archivedEngine: item.engine, executionEngine: 'PineEngine',
      sourceSha256: sha(item.inputs.source), parentsSha256: sha(JSON.stringify(item.inputs.parents)),
      childrenSha256: sha(JSON.stringify(item.inputs.children)), parameters: item.inputs.parameters,
      comparison, raw, warnings, fetchCalls, uncoveredTradeExitIds,
      note: 'Missing margin-call audit fill coverage is reported separately; matching an archive does not prove a complete order/fill event ledger.' };
  } finally {
    clearTimeout(timer);
    session?.stop();
    engine.terminate?.();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(['--archive', '--metadata', '--output'].includes(argv[i]) && argv[i + 1], 'Expected --archive, --metadata and --output paths');
    args[argv[i].slice(2)] = path.resolve(argv[i + 1]);
  }
  assert.ok(args.archive && args.output, 'Required: --archive --output; legacy archives also require --metadata');
  assert.ok(args.output.startsWith(path.join(ROOT, 'audit-evidence') + path.sep), 'Replay output must stay in ignored audit-evidence');
  const archiveBytes = await readFile(args.archive);
  const metadataBytes = args.metadata ? await readFile(args.metadata) : null;
  const archiveHash = sha(archiveBytes);
  const archive = JSON.parse(archiveBytes);
  const metadata = metadataBytes ? JSON.parse(metadataBytes) : null;
  const legacyRequest = metadata ? validateMetadata(metadata, archiveHash) : undefined;
  const selections = metadata?.selections ?? [
    { engine: 'PineEngine', scenario: 'margin-risk', magnified: true },
    { engine: 'PineEngine', scenario: 'position-cap', magnified: true },
  ];
  const selected = selections.map((selection) => {
    const matches = archive.cases.filter((item) => item.engine === selection.engine
      && item.scenario === selection.scenario && item.magnified === selection.magnified);
    assert.equal(matches.length, 1, 'case selection must resolve exactly once');
    return matches[0];
  });
  const requests = selected.map((item) => archivedRequest(item, legacyRequest));
  const buildCheck = spawnSync(process.execPath, ['scripts/ensure-fork-build.mjs', '--check-only'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(buildCheck.status, 0, `build outputs must be fresh before replay: ${buildCheck.stdout}${buildCheck.stderr}`);
  await mkdir(args.output, { recursive: true });
  assert.equal((await readdir(args.output)).length, 0, 'Use a new output directory; prior evidence must not be overwritten');
  const enginePath = path.join(ROOT, 'packages/vela-pinets/dist/index.js');
  const engineHash = sha(await readFile(enginePath));
  const pinetsPath = path.join(ROOT, 'packages/pinets/dist/pinets.min.es.js');
  const pinetsHash = sha(await readFile(pinetsPath));
  const networkAttempts = [];
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function () {
    networkAttempts.push('net.Socket.connect');
    throw new Error('Network is forbidden during offline archive replay');
  };
  const cases = [];
  try {
    const { PineEngine } = await import(pathToFileURL(enginePath));
    for (let i = 0; i < selected.length; i++) {
      cases.push({ ...await replay(PineEngine, selected[i], requests[i].request),
        requestMetadataSource: requests[i].exact ? 'captured-execute-request' : 'explicit-legacy-reconstruction',
        capturedPresence: requests[i].presence });
    }
  } finally { Socket.prototype.connect = originalConnect; }
  assert.equal(sha(await readFile(args.archive)), archiveHash, 'input archive changed during replay');
  assert.equal(sha(await readFile(enginePath)), engineHash, 'bridge artifact changed during replay');
  assert.equal(sha(await readFile(pinetsPath)), pinetsHash, 'engine artifact changed during replay');
  const summary = {
    pass: cases.every((item) => item.comparison.pass) && networkAttempts.length === 0,
    archivedInputPath: path.relative(ROOT, args.archive), archiveSha256: archiveHash,
    metadataSha256: metadataBytes ? sha(metadataBytes) : null, probeSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    engineArtifactSha256: engineHash, pinetsArtifactSha256: pinetsHash,
    currentBuildCheck: buildCheck.stdout.trim(), networkAttempts,
    originalArchiveSelfContained: requests.every((item) => item.exact),
    missingFromOriginalArchive: metadata?.missingFromOriginalArchive ?? [],
    reconstruction: metadata?.reconstruction ?? {}, cases,
    limits: ['In-process offline replay; original browser Worker evidence remains separate.',
      'Only archived candles and Pine source are used. New archives replay captured request metadata; legacy gaps require a disclosed supplement.',
      'Per-run report IDs may change; trade/order/parent relations and all curve points are compared unchanged.'],
  };
  await writeFile(path.join(args.output, 'results.json'), jsonBytes(summary));
  // A self-contained finite replay package, retaining original expected output
  // and the explicit metadata supplement for a subsequent disconnected run.
  const replayArchive = jsonBytes({ cases: selected.map((item) => ({
    engine: item.engine, scenario: item.scenario, magnified: item.magnified,
    inputs: item.inputs, actual: { raw: item.actual.raw, ...(item.actual.executionRequests ? { executionRequests: item.actual.executionRequests } : {}) },
  })), origin: { path: path.relative(ROOT, args.archive), sha256: archiveHash } });
  await writeFile(path.join(args.output, 'replay-input.json'), replayArchive);
  if (metadata) await writeFile(path.join(args.output, 'request-metadata.json'), jsonBytes({ ...metadata, archiveSha256: sha(replayArchive) }));
  const manifest = {};
  for (const name of await readdir(args.output)) manifest[name] = sha(await readFile(path.join(args.output, name)));
  await writeFile(path.join(args.output, 'SHA256.json'), jsonBytes(manifest));
  console.log(JSON.stringify({ pass: summary.pass, networkAttempts: networkAttempts.length,
    originalArchiveSelfContained: summary.originalArchiveSelfContained,
    cases: cases.map((item) => ({ scenario: item.scenario, fields: item.comparison.fields,
      differences: item.comparison.differences, uncoveredTradeExitIds: item.uncoveredTradeExitIds })) }, null, 2));
  return summary.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((status) => { process.exitCode = status; }, (error) => { console.error(error); process.exitCode = 1; });
}
