import { expect, it } from 'vitest';
import { batchPineSettings, updatePineSettings } from '../src/pinets/settingsBatch';
import { PineEngine } from '../src/pinets/PineEngine';

it('merges only explicit settings transactions, snapshots patches, and drops a failed transaction', () => {
    const calls: unknown[] = [];
    const key = {};
    const commit = (inputs: unknown, props: unknown): void => { calls.push([inputs, props]); };
    batchPineSettings(() => {
        const values = { length: 11 };
        updatePineSettings(key, values, undefined, commit);
        values.length = 900;
        updatePineSettings(key, { length: 12 }, { precision: 3 }, commit);
        expect(calls).toHaveLength(0);
    });
    expect(calls).toEqual([[{ length: 12 }, { precision: 3 }]]);
    expect(() => batchPineSettings(() => {
        updatePineSettings(key, { length: 99 }, undefined, commit);
        throw new Error('failed');
    })).toThrow('failed');
    expect(calls).toHaveLength(1);
    updatePineSettings(key, { length: 13 }, undefined, commit);
    expect(calls).toHaveLength(2);
});

it('nested scopes share the outer commit and separate sessions never share patches', () => {
    const a = {}, b = {};
    const calls: unknown[] = [];
    const commit = (inputs: unknown, props: unknown): void => { calls.push([inputs, props]); };
    batchPineSettings(() => {
        updatePineSettings(a, { length: 1 }, undefined, commit);
        batchPineSettings(() => {
            updatePineSettings(a, { length: 2 }, { precision: 3 }, commit);
            updatePineSettings(b, { length: 99 }, undefined, commit);
        });
        expect(calls).toHaveLength(0);
    });
    expect(calls).toEqual([[{ length: 2 }, { precision: 3 }], [{ length: 99 }, undefined]]);
});

for (const mode of ['static', 'live'] as const) {
    it(`in-process ${mode} commits inputs + props in one run with the final values`, async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare('//@version=6\nstrategy("Batch",initial_capital=10000)\nlength=input.int(10,"Length")\nplot(length)', 'settings-batch');
        const models: unknown[] = [];
        const errors: Error[] = [];
        const session = engine.execute({ prepared, market: { symbol: 'TEST', timeframe: '60' },
            mode, inputs: {}, bars: Array.from({ length: 5 }, (_, i) => ({
                time: 1700000000000 + i * 3600000, open: 100, high: 101, low: 99, close: 100, volume: 1,
            })) }, { onModel: m => models.push(m), onError: e => errors.push(e) });
        const wait = async (count: number): Promise<void> => {
            for (let i = 0; i < 100 && models.length < count; i++) await new Promise(r => setTimeout(r, 20));
            expect(models).toHaveLength(count);
        };
        try {
            await wait(1);
            batchPineSettings(() => {
                session.update({ length: 11 });
                session.update({ length: 11 }, { initial_capital: 12345 });
            });
            await wait(2);
            await new Promise(r => setTimeout(r, 100));
            expect(models).toHaveLength(2);
            expect(models[1]).toMatchObject({ inputValues: { length: 11 } });
            expect(errors).toEqual([]);
            const snapshot = await session.getContext?.(['strategy']);
            expect(snapshot?.strategy?.initialCapital).toBe(12345);
        } finally { session.stop(); }
    });
}
