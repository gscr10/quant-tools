/**
 * Lightweight Bar Magnifier request helpers.
 *
 * Keep these helpers independent from `runtime.ts`: the public worker-engine
 * entry imports them on the host side, while runtime.ts imports PineTS and the
 * complete execution bridge. Pulling runtime.ts into that entry duplicates the
 * whole PineTS implementation outside the inlined Worker and breaks the
 * worker bundle budget.
 */
interface BarMagnifierRequestLike {
    readonly barMagnifier?: {
        readonly requested?: unknown;
    };
    readonly props?: Record<string, unknown>;
    readonly prepared?: {
        readonly props?: readonly { readonly key?: unknown; readonly defval?: unknown }[];
    };
}

/** Return whether a request explicitly asks for lower-timeframe execution. */
export function barMagnifierRequested(request: BarMagnifierRequestLike): boolean {
    const explicit = request.barMagnifier?.requested;
    if (typeof explicit === 'boolean') return explicit;
    const override = request.props?.use_bar_magnifier;
    if (typeof override === 'boolean') return override;
    return request.prepared?.props?.find((schema) => schema.key === 'use_bar_magnifier')?.defval === true;
}

/**
 * Freeze the host cutoff before a request crosses into the Worker realm.
 * Generic typing preserves the caller's request extension without importing
 * the full PineTS runtime into this package entry.
 */
export function materializeBarMagnifierRequest<T extends BarMagnifierRequestLike>(request: T): T {
    if (!barMagnifierRequested(request) || request.barMagnifier !== undefined) return request;
    return {
        ...request,
        barMagnifier: { requested: true, asOf: Date.now() },
    };
}
