import test from 'node:test';
import assert from 'node:assert/strict';
import { historyGaps, HistoryGapError, repairHistoryGaps } from '../src/integrations/vela/history-continuity.ts';
import { guardProviderHistory, subscribeProviderHistoryRequests } from '../src/integrations/vela/provider-history.ts';
import { enableProviderProgressiveHistory, subscribeProgressiveHistoryRequests } from '../src/integrations/vela/provider-progressive.ts';

const row = time => ({time, open: 10, high: 12, low: 9, close: 11, volume: 1});
const at = (year, month) => Date.UTC(year, month - 1, 1);

for (const [timeframe, step] of [['1', 60_000], ['5', 300_000], ['120', 7_200_000],
  ['4h', 14_400_000], ['D', 86_400_000], ['W', 604_800_000]]) {
  test(`continuous venue ${timeframe} repairs a missing candle and preserves the caller limit`, async () => {
    const first = Date.UTC(2024, 0, 1), all = [row(first), row(first + step), row(first + 2 * step)];
    const calls = [];
    const provider = guardProviderHistory({getBars: async (_s, _tf, range) => {
      calls.push(range);
      return range.from === first + step ? [all[1]] : [all[0], all[2]];
    }}, 'binance');
    const actual = await provider.getBars('BTCUSDT', timeframe, {limit: 2});
    assert.deepEqual(actual, all.slice(1));
    assert.deepEqual(calls[1], {from: first + step, to: first + step, limit: 1});
  });
}

test('calendar month continuity handles leap February, year rollover and Pine minute casing', async () => {
  assert.deepEqual(historyGaps([row(at(2023,12)), row(at(2024,1)), row(at(2024,2)), row(at(2024,3))], 'M'), []);
  const sparse = [row(at(2024,1)), row(at(2024,3))];
  assert.deepEqual(historyGaps(sparse, '1M'), [{from: at(2024,2), to: at(2024,2), missing: 1}]);
  assert.deepEqual(historyGaps([row(0), row(120_000)], '1m'), [{from: 60_000,to: 60_000,missing: 1}]);
  const actual = await repairHistoryGaps(sparse,'M', async range => {
    assert.deepEqual(range,{from:at(2024,2),to:at(2024,2),limit:1});
    return [row(at(2024,2))];
  });
  assert.deepEqual(actual,[row(at(2024,1)),row(at(2024,2)),row(at(2024,3))]);
});

test('Hyperliquid native months use 30-day periods across February, without changing Binance calendar months', async () => {
  // Actual Hyperliquid 1M uses epoch-aligned 30-day bins, not month starts.
  const start = Date.UTC(2026, 0, 7), month = 30 * 86_400_000;
  const all = Array.from({length:4},(_,i)=>row(start+i*month));
  let calls=0;
  const provider=guardProviderHistory({getBars:async()=>{calls++;return all;}},'hyperliquid');
  assert.deepEqual(await provider.getBars('BTC','M',{limit:4}),all);
  assert.equal(calls,1,'a native continuous 30-day series needs no speculative repair');
  const calendar=[row(at(2026,1)),row(at(2026,2)),row(at(2026,3))];
  assert.deepEqual(await guardProviderHistory({getBars:async()=>calendar},'binance')
    .getBars('BTCUSDT','M',{limit:3}),calendar);
});

test('Hyperliquid monthly repair requests the missing native bin and rejects genuinely missing history', async () => {
  const start=Date.UTC(2026,0,7), month=30*86_400_000;
  const all=[row(start),row(start+month),row(start+2*month)];
  let recovered=true;
  const calls=[];
  const provider=guardProviderHistory({getBars:async(_s,_tf,range)=>{
    calls.push(range);
    return range.from===all[1].time ? recovered ? [all[1]]:[] : [all[0],all[2]];
  }},'hyperliquid');
  assert.deepEqual(await provider.getBars('BTC','M',{limit:3}),all);
  assert.deepEqual(calls[1],{from:all[1].time,to:all[1].time,limit:1});
  recovered=false;
  await assert.rejects(provider.getBars('BTC','M',{limit:3}),HistoryGapError);
});

test('an unresolved gap is explicit failure, observed before the provider rejects, and can recover', async () => {
  let repaired = false;
  const provider = guardProviderHistory({getBars: async (_s,_tf,range) =>
    range.from === 60_000 ? repaired ? [row(60_000)] : [] : [row(0),row(120_000)]}, 'hyperliquid');
  const requests=[];const stop=subscribeProviderHistoryRequests(provider,r=>requests.push(r));
  try {
    await assert.rejects(provider.getBars('BTC','1',{limit:3}), HistoryGapError);
    assert.equal((await requests[0].result).error.name,'HistoryGapError');
    repaired=true;
    assert.deepEqual(await provider.getBars('BTC','1',{limit:3}), [row(0),row(60_000),row(120_000)]);
    assert.equal((await requests[1].result).error,null);
  } finally {stop();}
});

test('gap repair HTTP failure is not silently downgraded to sparse data', async () => {
  const failure = new Error('HTTP 503');
  const provider = guardProviderHistory({getBars: async (_s,_tf,range) => {
    if(range.from !== undefined) throw failure;
    return [row(0),row(120_000)];
  }},'binance');
  await assert.rejects(provider.getBars('BTCUSDT','1',{limit:3}),error=>error===failure);
});

test('more than eight gaps and a gap over 1000 bars stop with bounded work', async () => {
  let requests=0;
  await assert.rejects(repairHistoryGaps(Array.from({length:11},(_,i)=>row(i*120_000)),'1',async range=>{
    requests++; return [row(range.from)];
  }),HistoryGapError);
  assert.equal(requests,8);
  requests=0;
  await assert.rejects(repairHistoryGaps([row(0),row(1002*60_000)],'1',async()=>{requests++;return [];}),HistoryGapError);
  assert.equal(requests,0);
});

test('short listing history and a genuine empty market do not fabricate 2000 bars', async () => {
  let calls=0;
  const provider=guardProviderHistory({getBars:async()=>{calls++;return [row(at(2024,1)),row(at(2024,2))];}},'binance');
  assert.equal((await provider.getBars('BTC','M',{limit:2000})).length,2);
  assert.equal(calls,1);
  assert.deepEqual(await guardProviderHistory({getBars:async()=>[]},'binance').getBars('BTC','1',{limit:2000}),[]);
});

for(const recover of [true,false]) test(`progressive page-junction gap ${recover?'repairs before publish':'fails retaining only confirmed prefix'}`,async()=>{
  const all=Array.from({length:2001},(_,i)=>row(i*60_000));
  const provider=enableProviderProgressiveHistory(guardProviderHistory({getBars:async(_s,_tf,range)=>{
    if(range.from===1000*60_000)return recover?[all[1000]]:[];
    if(range.to===undefined)return all.slice(1001);
    return all.slice(0,1000);
  }},'binance'));
  const events=[],batches=[];const stop=subscribeProgressiveHistoryRequests(provider,r=>events.push(r));
  try{
    const actual=await provider.getBarsProgressive('BTCUSDT','1',{limit:2000},rows=>batches.push(rows));
    const outcome=await events[0].result;
    if(recover){assert.deepEqual(actual,all.slice(1));assert.equal(outcome.error,null);assert.deepEqual(historyGaps(actual,'1'),[]);}
    else{assert.deepEqual(actual,all.slice(1001));assert.equal(outcome.error.name,'HistoryGapError');assert.equal(batches.length,1);}
  }finally{stop();}
});
