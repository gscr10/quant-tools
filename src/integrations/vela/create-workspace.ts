import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PLATFORM_INDICATORS } from '../../config/platform-indicators.ts';
import { WORKSPACE_DEFAULTS, WORKSPACE_TOPBAR } from '../../config/workspace-options.ts';
import { createPineEngineRegistry } from '../pinets/create-engine.ts';
import { createWorkspaceProviders } from './provider-registry.ts';
import { observeWorkspaceHistory } from './workspace-history-observer.ts';
import { installVelaHistoryResilience } from './history-resilience.ts';
import { installDefaultTimeframeSwitchPolicy } from './timeframe-switch-policy.ts';
import { installDateRangePolicy } from './range-switch-policy.ts';
import { createMigratingWorkspaceStorage, WORKSPACE_HISTORY_BARS } from '../storage/workspace-storage.ts';

export const WORKSPACE_STORAGE_KEY = 'quant-tools:workspace:v2';
export type QuantWorkspace = VelaWorkspace;

export function createWorkspace(container: HTMLElement | string): VelaWorkspace {
  const pineEngines = createPineEngineRegistry();
  let workspace: VelaWorkspace | undefined;
  let destroyed = false;
  let detachOnlineRetry = (): void => {};
  let detachHistoryObserver = (): void => {};
  let detachTimeframePolicy = (): void => {};
  let detachDateRangePolicy = (): void => {};
  try {
    // Vela 0.7.7 converts a failed ranged provider page into an empty array;
    // install the bounded integration patch before any workspace feed exists so
    // a transient 1m/5m page failure cannot be marked as permanently covered.
    installVelaHistoryResilience();
    const providers = createWorkspaceProviders({
      onIndexRecovered: (kind, provider) => {
        if (destroyed || !workspace) return;
        const data = workspace.chart.data;
        // Recovery belongs only to the instance that produced the fallback.
        // If a host has replaced that venue meanwhile, a late response must
        // not reinstall the stale provider.
        if (data.providerInstance(kind) !== provider) return;
        // Vela snapshots listSymbols() once per registration.  Re-registering
        // through its public control surface rebuilds that snapshot from the
        // complete index now cached by the guarded provider, and refreshes the
        // shared workspace feed used by every cell and the symbol picker.
        data.registerProvider(kind, provider);
      },
    });
    workspace = new VelaWorkspace(container, {
      ...WORKSPACE_DEFAULTS,
      providers,
      engines: { pine: pineEngines.create },
      indicators: PLATFORM_INDICATORS,
      topbar: WORKSPACE_TOPBAR,
      storage: createMigratingWorkspaceStorage(undefined, WORKSPACE_HISTORY_BARS),
      drawingToolbar: true,
      persist: WORKSPACE_STORAGE_KEY,
      autofocus: true,
    });
    // Install before the history observer so both wrappers see the normalized
    // identity switch. Every ordinary timeframe/symbol change starts from the
    // newest default depth; explicit range presets and depth-only backfills are
    // left untouched for the user's deliberate deep-history requests.
    detachTimeframePolicy = installDefaultTimeframeSwitchPolicy(workspace, WORKSPACE_HISTORY_BARS);
    // The native bottom chips pair each date range with a finer timeframe. The
    // app keeps the user's topbar resolution stable and expands only history
    // when that date window needs more bars.
    detachDateRangePolicy = installDateRangePolicy(workspace);
    detachHistoryObserver = observeWorkspaceHistory(workspace);

    // A bounded first attempt plus one background retry keeps startup finite.
    // If both happened during a real connection outage, the browser's next
    // online transition is an explicit, lifecycle-owned chance to recover.
    // Healthy providers answer from the guard's complete in-memory index, so
    // this does not create duplicate exchange traffic for them.
    const retryProviderIndexes = (): void => {
      if (destroyed || !workspace) return;
      const data = workspace.chart.data;
      for (const kind of ['binance', 'hyperliquid'] as const) {
        try {
          const attempt = data.providerInstance(kind)?.listSymbols?.();
          void Promise.resolve(attempt).catch(() => {});
        } catch {
          // A recovery probe is best effort and must stay outside app errors.
        }
      }
    };
    const hostWindow = workspace.root.ownerDocument.defaultView;
    hostWindow?.addEventListener('online', retryProviderIndexes);
    detachOnlineRetry = () => hostWindow?.removeEventListener('online', retryProviderIndexes);

    // Vela's public destroy() stops each chart session but intentionally does
    // not own the lifetime of a pluggable engine instance.  Wrap the public
    // method at this integration boundary so callers that destroy a workspace
    // directly get the same worker cleanup as createApp().
    const destroy = workspace.destroy.bind(workspace);
    workspace.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        try { detachOnlineRetry(); }
        finally {
          try { detachHistoryObserver(); }
          finally {
            try { detachDateRangePolicy(); }
            finally {
              try { detachTimeframePolicy(); }
              finally { destroy(); }
            }
          }
        }
      } finally {
        pineEngines.dispose();
      }
    };
    return workspace;
  } catch (error) {
    detachHistoryObserver();
    detachDateRangePolicy();
    detachTimeframePolicy();
    pineEngines.dispose();
    throw error;
  }
}
