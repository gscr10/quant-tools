import type { WorkerRuntimeError } from './protocol';

/**
 * The structured-clone algorithm does not provide a stable contract for Error
 * subclasses or custom fields.  Keep this envelope deliberately small and
 * primitive so it remains safe to post from a Worker and useful to hosts.
 */
export type WorkerErrorLike = {
    message?: unknown;
    name?: unknown;
    method?: unknown;
    kind?: unknown;
    code?: unknown;
    provider?: unknown;
    status?: unknown;
    timeoutMs?: unknown;
    url?: unknown;
    retryable?: unknown;
};

const MAX_TEXT = 512;
const MAX_URL = 2_048;

function text(value: unknown, max = MAX_TEXT): string | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value.slice(0, max);
}

function finite(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function errorKind(value: WorkerErrorLike): WorkerRuntimeError['kind'] {
    if (value.kind === 'pine-runtime' || value.kind === 'provider'
        || value.kind === 'worker' || value.kind === 'compile' || value.kind === 'unknown') return value.kind;
    const name = typeof value.name === 'string' ? value.name : '';
    if (name === 'PineRuntimeError' || typeof value.method === 'string') return 'pine-runtime';
    if (name.startsWith('Provider') || typeof value.provider === 'string') return 'provider';
    if (name === 'SyntaxError' || name.includes('Compile')) return 'compile';
    return undefined;
}

/** Convert arbitrary thrown values into a bounded, clone-safe envelope. */
export function serializeWorkerError(error: unknown): WorkerRuntimeError | undefined {
    if (error == null) return undefined;
    const value: WorkerErrorLike = typeof error === 'object'
        ? error
        : { message: error };
    const name = text(value.name);
    const method = text(value.method);
    const kind = errorKind(value);
    const code = text(value.code);
    const provider = text(value.provider);
    const status = finite(value.status);
    const timeoutMs = finite(value.timeoutMs);
    const url = text(value.url, MAX_URL);
    const retryable = bool(value.retryable)
        ?? (kind === 'provider'
            && (name === 'ProviderTimeoutError'
                || status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)));
    const details: WorkerRuntimeError = {
        ...(name ? { name } : {}),
        ...(method ? { method } : {}),
        ...(kind ? { kind } : {}),
        ...(code ? { code } : {}),
        ...(provider ? { provider } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(url ? { url } : {}),
        ...(retryable !== undefined ? { retryable } : {}),
    };
    return Object.keys(details).length > 0 ? details : undefined;
}

/** Extract a useful message without ever throwing while handling a bad value. */
export function errorMessage(error: unknown, fallback = 'PineTS worker failed'): string {
    if (typeof error === 'string' && error.length > 0) return error.slice(0, MAX_TEXT);
    if (error && typeof error === 'object') {
        const message = (error as WorkerErrorLike).message;
        if (typeof message === 'string' && message.length > 0) return message.slice(0, MAX_TEXT);
    }
    return fallback;
}

/** Recreate an Error carrying the validated metadata in the host realm. */
export function errorFromWorker(message: string, details?: WorkerRuntimeError): Error {
    const error = new Error(errorMessage(message));
    if (!details || typeof details !== 'object') return error;
    const safe = serializeWorkerError(details);
    if (!safe) return error;
    for (const [key, value] of Object.entries(safe)) {
        if (key === 'name') {
            error.name = String(value);
            continue;
        }
        Object.defineProperty(error, key, {
            configurable: true,
            enumerable: true,
            value,
            writable: false,
        });
    }
    return error;
}
