import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';
import type { WorkspacePort } from '../../domain/ports/workspace-port.ts';
import type { OverlayManager } from '../../shared/overlays.ts';
import type {
  IndicatorManagerActions,
  IndicatorManagerDialog,
} from './indicator-manager.vela.ts';

export interface LazyIndicatorManager {
  open(): void;
  sync(): void;
  destroy(): void;
}

interface Dependencies {
  workspace: WorkspacePort;
  scripts: ScriptServicePort;
  favorites: FavoriteServicePort;
  overlays: OverlayManager;
  actions: IndicatorManagerActions;
}

/**
 * The indicator catalog is an interaction-only feature. Keep its dialog and
 * list-building code out of the startup chunk, while preserving the existing
 * synchronous contribution contract. Multiple clicks share one import and a
 * destroy during the import window cannot mount a dialog into a torn-down
 * workspace.
 */
export function createLazyIndicatorManager(dependencies: Dependencies): LazyIndicatorManager {
  let disposed = false;
  let manager: IndicatorManagerDialog | null = null;
  let loading: Promise<void> | null = null;
  let openRequested = false;

  const load = (): Promise<void> => {
    if (loading) return loading;
    dependencies.workspace.toast('Loading indicators…', 'info');
    loading = import('./indicator-manager.vela.ts')
      .then(({ IndicatorManagerDialog: Dialog }) => {
        if (disposed) return;
        manager = new Dialog(
          dependencies.workspace,
          dependencies.scripts,
          dependencies.favorites,
          dependencies.overlays,
          dependencies.actions,
        );
        if (openRequested && !disposed) manager.open();
        openRequested = false;
      })
      .catch((error) => {
        // Allow a later click to retry a transient chunk/load failure. The
        // existing toolbar remains usable even if this optional feature fails.
        loading = null;
        openRequested = false;
        if (!disposed) dependencies.workspace.toast('Indicators failed to load. Try again.', 'error');
        console.warn('[quant-tools] Indicator manager lazy load failed', error);
      });
    return loading;
  };

  return {
    open(): void {
      if (disposed) return;
      if (manager) {
        manager.open();
        return;
      }
      openRequested = true;
      void load();
    },
    sync(): void {
      manager?.sync();
    },
    destroy(): void {
      if (disposed) return;
      disposed = true;
      openRequested = false;
      manager?.destroy();
      manager = null;
    },
  };
}
