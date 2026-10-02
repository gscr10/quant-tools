import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PineEngine } from '../src/pinets/PineEngine';
import { pineContextSelect } from '../src/pinets/reportSeries';
import type { PineContextSnapshot } from '../src/pinets/contextSnapshot';
import type { ExecutionHandlers, ExecutionRequest, OHLCV } from '@luxalgo/vela/plugin';
import fixture from './fixtures/btcusdt-1h-deterministic.json';
import registryBaseline from './fixtures/btcusdt-1h-registry-baseline.json';

const source = readFileSync(new URL('./fixtures/btcusdt-1h-deterministic.pine', import.meta.url), 'utf8');
const bars = fixture.bars as OHLCV[];
const expectedFixtureSha256 = '29b1d15777827e46b47a7386aa368f0389252b16565f58b3b19805c363e39cd1';
const expectedReportSha256 = '5fb737328cc2efe83c5e4c9f2a036c4beb40e0f5a18f29e9658be15068c5aeae';

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('timed out waiting for PineTS fixture run');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

interface CanonicalTrade {
    id: string;
    side: string;
    qty: number;
    entry: { id: string; time: number; price: number };
    entryBarIndex?: number;
    exit?: { id: string; time: number; price: number };
    exitBarIndex?: number;
    open: boolean;
    pnl?: number;
    commission?: number;
    maxDrawdown?: number;
    maxRunup?: number;
}

type FixtureTrade = NonNullable<PineContextSnapshot['trades']>[number] & {
    entryBarIndex?: number;
    exitBarIndex?: number;
};

type FixtureStrategy = NonNullable<PineContextSnapshot['strategy']> & {
    reportRunId?: string;
    reportSnapshotRevision?: number;
};

interface RunSnapshot {
    trades: CanonicalTrade[];
    strategy: Record<string, unknown>;
    reportSeries: PineContextSnapshot['reportSeries'];
    runIdentity: { runId: string; snapshotRevision: number };
}

function canonicalTrade(trade: NonNullable<PineContextSnapshot['trades']>[number]): CanonicalTrade {
    const extended = trade as FixtureTrade;
    return {
        id: trade.id,
        side: trade.side,
        qty: trade.qty,
        entry: { id: trade.entry.id, time: trade.entry.time, price: trade.entry.price },
        ...(extended.entryBarIndex === undefined ? {} : { entryBarIndex: extended.entryBarIndex }),
        ...(trade.exit ? { exit: { id: trade.exit.id, time: trade.exit.time, price: trade.exit.price } } : {}),
        ...(extended.exitBarIndex === undefined ? {} : { exitBarIndex: extended.exitBarIndex }),
        open: trade.open,
        ...(trade.pnl === undefined ? {} : { pnl: trade.pnl }),
        ...(trade.commission === undefined ? {} : { commission: trade.commission }),
        ...(trade.maxDrawdown === undefined ? {} : { maxDrawdown: trade.maxDrawdown }),
        ...(trade.maxRunup === undefined ? {} : { maxRunup: trade.maxRunup }),
    };
}

async function runFixture(instanceId: string): Promise<RunSnapshot> {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, instanceId);
    const models: unknown[] = [];
    const errors: Error[] = [];
    const handlers: ExecutionHandlers = {
        onModel: (model) => models.push(model),
        onError: (error) => errors.push(error),
    };
    const request: ExecutionRequest = {
        prepared,
        market: { symbol: fixture.symbol, timeframe: '60' },
        bars: bars.map((bar) => ({ ...bar })),
        inputs: {},
        props: {},
        mode: 'static',
    };
    const session = engine.execute(request, handlers);
    await waitFor(() => models.length > 0 || errors.length > 0);
    expect(errors).toEqual([]);
    const context = await session.getContext?.(pineContextSelect('strategy', 'trades', 'reportSeries')) as PineContextSnapshot;
    session.stop();
    expect(context?.strategy).toBeTruthy();
    const strategy = context.strategy as FixtureStrategy;
    const reportSeries = context.reportSeries;
    expect(reportSeries?.runId).toBe(strategy.reportRunId);
    expect(reportSeries?.snapshotRevision).toBe(strategy.reportSnapshotRevision);
    expect(reportSeries?.runId).toMatch(/^pine-report:/);
    const stableStrategy = Object.fromEntries(
        Object.entries(strategy).filter(([key]) => key !== 'reportRunId' && key !== 'reportSnapshotRevision'),
    );
    const stableReportSeries = reportSeries ? { ...reportSeries, runId: '<run>' } : undefined;
    return {
        trades: (context.trades ?? []).map(canonicalTrade),
        strategy: stableStrategy,
        reportSeries: stableReportSeries,
        runIdentity: { runId: reportSeries!.runId, snapshotRevision: reportSeries!.snapshotRevision },
    };
}

describe('fixed Binance BTCUSDT · 1h backtest fixture', () => {
    it('pins market metadata, candle identity, and source configuration', () => {
        expect(fixture.provider).toBe('binance');
        expect(fixture.symbol).toBe('BTCUSDT');
        expect(fixture.timeframe).toBe('1h');
        expect(fixture.timezone).toBe('UTC');
        expect(fixture.locale).toBe('en-US');
        expect(fixture.strategyId).toBe('btcusdt-1h-deterministic');
        expect(fixture.parameters).toMatchObject({
            initialCapital: 100000,
            defaultQtyType: 'fixed',
            commissionType: 'percent',
            commissionValue: 0.1,
        });
        expect(fixture.parameters.orders).toHaveLength(6);
        expect(fixture.bars).toHaveLength(24);
        expect(fixture.bars[0]?.time).toBe(fixture.rangeStart);
        expect(fixture.bars.at(-1)?.closeTime).toBe(fixture.rangeEndExclusive - 1);
        expect(new Set(fixture.bars.map((bar) => bar.time)).size).toBe(fixture.bars.length);
        fixture.bars.forEach((bar, index) => {
            expect(bar.closeTime).toBe(bar.time + 3_600_000 - 1);
            if (index > 0) expect(bar.time - fixture.bars[index - 1]!.time).toBe(3_600_000);
        });
        expect(source).toContain('initial_capital=100000');
        expect(source).toContain('commission_value=0.1');
        const canonicalFixture = JSON.stringify(fixture);
        const digest = createHash('sha256').update(canonicalFixture).digest('hex');
        expect(digest).toBe(expectedFixtureSha256);
        expect(digest).toBe(registryBaseline.fixtureCanonicalSha256);
        expect(createHash('sha256').update(source).digest('hex')).toBe(registryBaseline.strategySha256);
    });

    it('repeats the same ledger, prices, P&L, summary, and report points offline', async () => {
        const first = await runFixture('btcusdt-fixture-first');
        const second = await runFixture('btcusdt-fixture-second');
        expect(first.runIdentity.runId).not.toBe(second.runIdentity.runId);
        expect(first.runIdentity.snapshotRevision).toBe(1);
        expect(second.runIdentity.snapshotRevision).toBe(1);
        expect(first).toEqual({ ...second, runIdentity: first.runIdentity });
        // This baseline was generated once with the published pinets@0.9.34
        // tarball (integrity is recorded in the fixture), then checked in so this
        // test stays offline. It is intentionally independent from the local
        // Vela-PineTS bridge's report-series implementation.
        expect(registryBaseline.engine).toBe('pinets');
        expect(registryBaseline.version).toBe('0.9.34');
        expect(registryBaseline.registryIntegrity).toMatch(/^sha512-/);
        expect(first.trades).toEqual(registryBaseline.trades);
        expect(first.strategy).toEqual(registryBaseline.summary);
        expect(createHash('sha256').update(JSON.stringify(first.reportSeries)).digest('hex')).toBe(expectedReportSha256);
        expect(first.trades.length).toBeGreaterThanOrEqual(2);
        expect(first.trades.every((trade) => trade.entry.price > 0 && trade.qty > 0)).toBe(true);
        expect(first.trades.some((trade) => trade.side === 'long')).toBe(true);
        expect(first.trades.some((trade) => trade.side === 'short')).toBe(true);
        expect(first.trades.some((trade) => trade.exit && trade.pnl !== undefined)).toBe(true);
        expect(first.strategy).toMatchObject({
            initialCapital: 100000,
            accountCurrency: 'USD',
        });
        expect(first.reportSeries?.points).toHaveLength(fixture.bars.length);
    }, 30_000);
});
