import { describe, expect, it } from 'vitest';
import { processStrategyOrders } from '../../../src/namespaces/strategy/utils';

describe('ledger MFE/MAE projection', () => {
  it('updates each accounting entry once when physical and ledger books coexist', () => {
    const strategy: any = {
      opentrades: [{ size: 1, entry_price: 100, max_runup: 0, max_drawdown: 0 }],
      closedtrades: [], pending_orders: [],
      _ledger_entries: [{ id: 'a', entry_id: 'A', qty: 1, direction: 1, entry_price: 100,
        entry_time: 1, entry_bar_index: 0, commission: 0, max_runup: 0, max_drawdown: 0 }],
      position_size: 1, position_avg_price: 100, netprofit: 0, grossprofit: 0, grossloss: 0,
      wintrades: 0, losstrades: 0, eventrades: 0, wintrades_total_profit: 0, losstrades_total_loss: 0,
      openprofit: 0, equity: 1000, initial_capital: 1000,
      config: { commission_type: 'percent', commission_value: 0, pyramiding: 1 },
    };
    processStrategyOrders({ strategy, pine: { syminfo: { pointvalue: 1 } }, idx: 1,
      data: { open: [100], high: [110], low: [90], close: [100], openTime: [2] } }, 'open');
    expect(strategy._ledger_entries[0].max_runup).toBe(10);
    expect(strategy._ledger_entries[0].max_drawdown).toBe(10);
  });
});
