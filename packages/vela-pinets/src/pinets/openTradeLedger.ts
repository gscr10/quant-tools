import { asNumber, asString } from './PineRun';

export function openTradeLedger(raw: unknown): unknown[] {
    if (raw === null || typeof raw !== 'object') return [];
    const strategy = raw as Record<string, unknown>;
    if (!Array.isArray(strategy._ledger_entries)) {
        return Array.isArray(strategy.opentrades) ? strategy.opentrades : [];
    }
    const positionDirection = Math.sign(asNumber(strategy.position_size) ?? 0);
    const closedIds = new Set((Array.isArray(strategy.closedtrades) ? strategy.closedtrades : []).flatMap((value: unknown) => {
        if (value === null || typeof value !== 'object') return [];
        const id = asString((value as Record<string, unknown>).id);
        return id === undefined ? [] : [id];
    }));
    return strategy._ledger_entries.flatMap((value: unknown, index: number) => {
        if (value === null || typeof value !== 'object') return [];
        const entry = value as Record<string, unknown>;
        const quantity = asNumber(entry.qty);
        const price = asNumber(entry.entry_price);
        const time = asNumber(entry.entry_time);
        const entryId = asString(entry.entry_id);
        const direction = asNumber(entry.direction) ?? positionDirection;
        if (quantity === undefined || quantity <= 0 || price === undefined || time === undefined
            || entryId === undefined || (direction !== 1 && direction !== -1)) return [];
        const id = asString(entry.id) ?? `ledger_${entryId}_${time}_${index}`;
        return [{
            id: closedIds.has(id) ? `open_${id}` : id,
            entry_id: entryId,
            entry_price: price,
            entry_time: time,
            entry_bar_index: asNumber(entry.entry_bar_index),
            entry_comment: asString(entry.entry_comment),
            size: quantity * direction,
            commission: asNumber(entry.commission),
            max_drawdown: asNumber(entry.max_drawdown),
            max_runup: asNumber(entry.max_runup),
            status: 'open',
        }];
    });
}
