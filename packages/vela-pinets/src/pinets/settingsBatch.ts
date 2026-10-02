import type { InputValue } from '@luxalgo/vela/plugin';

type Values = Record<string, InputValue>;
type Commit = (inputs: Values, props?: Values) => void;
interface PendingSettings { inputs: Values; props?: Values; commit: Commit }
let batch: Map<object, PendingSettings> | null = null;

/** Explicit synchronous host transaction: Vela's separate setInputs/setProps
 * APIs retain their persistence/renderer behavior, but execute only their final
 * combined settings once per session. Ordinary updates remain synchronous.
 * The callback must not await; execution is flushed before this function returns.
 * This batches execution, not arbitrary host mutations: on failure the caller
 * must report failure; Vela's already-written settings are not rolled back.
 */
export function batchPineSettings(action: () => void): void {
    if (batch) { action(); return; }
    const pending = new Map<object, PendingSettings>();
    batch = pending;
    try { action(); } finally { batch = null; }
    // A throwing callback deliberately never reaches this flush.
    for (const { inputs, props, commit } of pending.values()) commit(inputs, props);
}

/** Shared by the in-process and Worker engine; each execution owns its key. */
export function updatePineSettings(key: object, inputs: Values, props: Values | undefined, commit: Commit): void {
    if (!batch) { commit(inputs, props); return; }
    const previous = batch.get(key);
    batch.set(key, {
        inputs: { ...previous?.inputs, ...inputs },
        ...(previous?.props || props ? { props: { ...previous?.props, ...props } } : {}),
        commit,
    });
}
