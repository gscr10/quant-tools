import type {
  BacktestReport,
  BacktestSettingValue,
  BacktestSimulationChange,
  BacktestTrade,
} from '../features/backtesting/backtest-types.ts';
import { createBacktestWorkbench, type BacktestWorkbench } from '../features/backtesting/backtest-workbench.ts';
import { BacktestController } from './backtest-controller.ts';
import {
  VelaBacktestControlAdapter,
  VelaBacktestResultsAdapter,
} from '../integrations/vela/backtest-adapter.ts';
import type { BacktestControlPort } from '../integrations/vela/backtest-adapter.ts';
import type { BacktestAdapterKey } from '../integrations/vela/backtest-adapter-types.ts';
import type { QuantWorkspace } from '../integrations/vela/create-workspace.ts';
import type { BacktestPreferencesRepository } from '../domain/ports/backtest-preferences.ts';
import { diffBacktestSettingValues, resolveBacktestSettingValues } from '../domain/backtest-settings.ts';

/**
 * The app-level composition boundary for backtesting.
 *
 * This module intentionally owns no report calculations and no DOM details
 * beyond the host element.  It wires the public Vela adapter to the
 * application controller and keeps teardown order explicit so a pending
 * context()/trades() promise can never update a destroyed workspace.
 */
export interface BacktestFeature {
  readonly controller: BacktestController;
  readonly control: BacktestControlPort;
  readonly workbench: BacktestWorkbench;
  destroy(): void;
}

export interface BacktestFeatureOptions {
  readonly host: HTMLElement;
  readonly onDiagnostic?: (message: string, error?: unknown) => void;
  readonly isFavorite?: (key: BacktestAdapterKey) => boolean;
  /** Return the persisted state when the host handled the toggle. */
  readonly onToggleFavorite?: (report: BacktestReport) => boolean | void;
  readonly onSimulationChange?: (
    report: BacktestReport,
    change: BacktestSimulationChange,
  ) => void;
  readonly onTradeLocate?: (
    report: BacktestReport,
    trade: BacktestTrade,
    side: 'entry' | 'exit',
  ) => void;
  /** Independent UI preference store; it must never receive reports/results. */
  readonly dockPreferences?: BacktestPreferencesRepository;
}

export function mountBacktestFeature(
  workspace: QuantWorkspace,
  options: BacktestFeatureOptions,
): BacktestFeature {
  const diagnostic = options.onDiagnostic;
  const diagnose = (message: string, error?: unknown) => {
    try {
      diagnostic?.(message, error);
    } catch {
      // Diagnostics are best effort and must never break Workspace callbacks.
    }
  };
  const loadDockPreferences = () => {
    try {
      return options.dockPreferences?.loadDock() ?? null;
    } catch (error) {
      // A denied/corrupt preference store must not prevent the chart and
      // backtest feature from starting; Workbench will use its defaults.
      diagnose('backtest Dock preferences could not be restored', error);
      return null;
    }
  };
  const results = new VelaBacktestResultsAdapter(workspace, { onDiagnostic: diagnostic });
  const control = new VelaBacktestControlAdapter(workspace);
  const controller = new BacktestController(results, {
    onDiagnostic: diagnostic,
    isFavorite: options.isFavorite,
    getMarket: (key) => {
      const cell = workspace.cell(key.cellId);
      if (!cell) return undefined;
      const symbol = cell.symbol;
      const separator = symbol.indexOf(':');
      const provider = separator >= 0 ? symbol.slice(0, separator).toLowerCase() : 'binance';
      const displaySymbol = separator >= 0 ? symbol.slice(separator + 1) : symbol;
      return {
        provider,
        symbol,
        displaySymbol,
        timeframe: cell.timeframe,
        timezone: cell.displayTimezone,
      };
    },
  });

  let destroyed = false;
  const chartArea = workspace.root.querySelector<HTMLElement>('.vela-ws-main');
  const originalChartPaddingBottom = chartArea?.style.paddingBottom ?? '';
  const originalChartAriaHidden = chartArea?.getAttribute('aria-hidden') ?? null;
  const originalChartInert = chartArea?.inert ?? false;
  const view = options.host.ownerDocument.defaultView;
  const originalHostTop = options.host.style.getPropertyValue('--quant-backtest-host-top');
  const originalHostBottom = options.host.style.getPropertyValue('--quant-backtest-host-bottom');
  const preexistingWorkbenchNodes = new Set(
    [...options.host.querySelectorAll<HTMLElement>('[data-backtest-workbench="true"]')],
  );
  let workbench: BacktestWorkbench | null = null;
  let activeCellUnsubscribe: (() => void) | null = null;
  let layoutUnsubscribe: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let viewerSuppressionObserver: MutationObserver | null = null;
  let windowResizeRegistered = false;
  // Vela's focus/aria-hidden manager may restore attributes on the chart root
  // asynchronously (for example when its own popover cleanup runs after the
  // Viewer opens). Keep the application-level suppression contract stable while
  // the Viewer is open, without touching Vela's private focus state.
  const reserveChartHeight = (height: number) => {
    if (!chartArea) return;
    const safeHeight = Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
    const padding = safeHeight > 0
      ? `${safeHeight}px`
      : originalChartPaddingBottom;
    if (chartArea.style.paddingBottom !== padding) chartArea.style.paddingBottom = padding;
    const marker = String(safeHeight);
    if (chartArea.dataset.backtestReservedHeight !== marker) {
      chartArea.dataset.backtestReservedHeight = marker;
    }
  };
  const setChartSuppressed = (suppressed: boolean) => {
    if (!chartArea) return;
    if (suppressed) {
      chartArea.inert = true;
      chartArea.setAttribute('aria-hidden', 'true');
      chartArea.dataset.backtestViewerBackground = 'true';
      return;
    }
    chartArea.inert = originalChartInert;
    if (originalChartAriaHidden === null) chartArea.removeAttribute('aria-hidden');
    else chartArea.setAttribute('aria-hidden', originalChartAriaHidden);
    delete chartArea.dataset.backtestViewerBackground;
  };
  const selectLiveCell = () => {
    if (destroyed) return;
    try {
      controller.setActiveCell(workspace.active.id);
    } catch (error) {
      diagnose('backtest active-cell selection failed', error);
    }
  };

  // The public Workspace root owns a top and bottom chrome bar. Keep the
  // application-layer overlay inside the chart work area so the Dock/Viewer
  // never obscures Vela's global toolbar. The chart-area padding is a reversible
  // layout reservation; no chart state, provider, or indicator object is changed.
  const syncHostBounds = () => {
    const root = workspace.root;
    const rootRect = root.getBoundingClientRect();
    const topbar = root.querySelector<HTMLElement>('.vela-widget-topbar');
    const bottombar = root.querySelector<HTMLElement>('.vela-widget-bottombar');
    const top = topbar
      ? Math.max(0, topbar.getBoundingClientRect().bottom - rootRect.top)
      : 39;
    const bottom = bottombar
      ? Math.max(0, rootRect.bottom - bottombar.getBoundingClientRect().top)
      : 38;
    options.host.style.setProperty('--quant-backtest-host-top', `${Math.round(top)}px`);
    options.host.style.setProperty('--quant-backtest-host-bottom', `${Math.round(bottom)}px`);
  };

  /**
   * Mounting is transactional: createApp treats Backtesting as optional, so a
   * failure after one listener/observer has been installed must roll back every
   * earlier resource before the original construction error escapes.
   */
  const dispose = (rethrowCleanupError: boolean) => {
    if (destroyed) return;
    destroyed = true;
    let firstError: unknown;
    const cleanup = (label: string, action: () => void) => {
      try {
        action();
      } catch (error) {
        firstError ??= error;
        try {
          diagnostic?.(`backtest ${label} cleanup failed`, error);
        } catch {
          // Diagnostics are best effort and must not stop later cleanup.
        }
      }
    };
    cleanup('active-cell subscription', () => activeCellUnsubscribe?.());
    activeCellUnsubscribe = null;
    cleanup('layout subscription', () => layoutUnsubscribe?.());
    layoutUnsubscribe = null;
    cleanup('resize observer', () => resizeObserver?.disconnect());
    resizeObserver = null;
    cleanup('window resize listener', () => {
      if (windowResizeRegistered) view?.removeEventListener('resize', syncHostBounds);
    });
    windowResizeRegistered = false;
    cleanup('viewer suppression observer', () => viewerSuppressionObserver?.disconnect());
    viewerSuppressionObserver = null;
    cleanup('workbench', () => workbench?.destroy());
    workbench = null;
    // A Workbench constructor can fail after appending its root but before it
    // returns the instance (for example if a host DOM shim throws during the
    // initial render). Remove only nodes created by this transaction; a caller
    // that intentionally reuses a host keeps any pre-existing instance.
    cleanup('partial workbench DOM', () => {
      options.host.querySelectorAll<HTMLElement>('[data-backtest-workbench="true"]')
        .forEach((node) => {
          if (!preexistingWorkbenchNodes.has(node)) node.remove();
        });
    });
    cleanup('chart reservation', () => reserveChartHeight(0));
    cleanup('viewer chart suppression', () => setChartSuppressed(false));
    cleanup('chart reservation marker', () => {
      if (chartArea) delete chartArea.dataset.backtestReservedHeight;
    });
    cleanup('host bounds', () => {
      if (originalHostTop) {
        options.host.style.setProperty('--quant-backtest-host-top', originalHostTop);
      } else {
        options.host.style.removeProperty('--quant-backtest-host-top');
      }
      if (originalHostBottom) {
        options.host.style.setProperty('--quant-backtest-host-bottom', originalHostBottom);
      } else {
        options.host.style.removeProperty('--quant-backtest-host-bottom');
      }
    });
    cleanup('controller', () => controller.destroy());
    cleanup('results adapter', () => results.destroy());
    if (rethrowCleanupError && firstError) throw firstError;
  };

  try {
    if (chartArea && view && 'MutationObserver' in view) {
      viewerSuppressionObserver = new view.MutationObserver(() => {
        if (chartArea.dataset.backtestViewerBackground === 'true'
          && chartArea.getAttribute('aria-hidden') !== 'true') {
          chartArea.setAttribute('aria-hidden', 'true');
        }
      });
      viewerSuppressionObserver.observe(chartArea, {
        attributes: true,
        attributeFilter: ['aria-hidden', 'data-aria-hidden'],
      });
    }

    const mountedWorkbench = createBacktestWorkbench(options.host, {
      dockPreferences: loadDockPreferences(),
      getSnapshot: () => controller.getSnapshot(),
      subscribe: (listener) => controller.subscribe(listener),
      onTabChange: () => undefined,
      settings: {
        read: (report) => report.key ? control.readSettings(report.key) : null,
        apply: (
          report,
          inputs: Record<string, BacktestSettingValue>,
          props: Record<string, BacktestSettingValue>,
        ) => {
          const key = report.key;
          if (!key) return false;
          const current = control.readSettings(key);
          if (!current) return false;
          const recovering = controller.settingsNeedRecovery(key);
          const inputPatch = recovering ? resolveBacktestSettingValues(current.inputs, inputs) : diffBacktestSettingValues(
            current.inputs,
            current.inputValues,
            inputs,
          );
          const propPatch = recovering ? resolveBacktestSettingValues(current.props, props) : diffBacktestSettingValues(
            current.props,
            current.propValues,
            props,
          );
          // One Apply is one execution with both tabs' final settings. Cancel,
          // Reset and an unchanged Apply never send a Worker update.
          if (recovering) controller.beginSettingsRecovery(key, inputPatch, propPatch);
          try {
            const accepted = control.applySettings(key, inputPatch, propPatch);
            if (!accepted) controller.invalidateSettings(key);
            return accepted;
          } catch {
            controller.invalidateSettings(key);
            return false;
          }
        },
      },
      onOpenViewer: () => setChartSuppressed(true),
      onCloseViewer: () => setChartSuppressed(false),
      onResize: reserveChartHeight,
      onDockPreferencesChange: (preferences) => {
        options.dockPreferences?.saveDock(preferences);
      },
      onFocusFallback: () => workspace.cell(workspace.active.id)?.focus(),
      onToggleFavorite: (report) => {
        const desired = !report.favorite;
        const toggle = options.onToggleFavorite;
        if (!toggle) {
          if (report.key) controller.setFavorite(report.key, desired);
          return desired;
        }
        const persisted = toggle(report);
        if (report.key && typeof persisted === 'boolean') {
          controller.setFavorite(
            report.key,
            persisted,
          );
        }
        return persisted;
      },
      onSimulationChange: (change) => {
        const report = controller.getSnapshot();
        if (!report) return;
        const updated = controller.updateSimulation(change);
        options.onSimulationChange?.(updated ?? report, change);
      },
      onTradeLocate: (trade, side) => {
        const report = controller.getSnapshot();
        if (report) options.onTradeLocate?.(report, trade, side);
      },
      onRetry: () => {
        void controller.retryActive().then(selectLiveCell);
      },
    });
    workbench = mountedWorkbench;

    activeCellUnsubscribe = workspace.on('cell:active', ({ id }) => {
      // Workspace can queue an event immediately before switching again. The
      // public active identity is authoritative at delivery time.
      try {
        if (workspace.active.id === id) controller.setActiveCell(id);
      } catch (error) {
        diagnose('backtest active-cell selection failed', error);
      }
    });
    // A layout restore/maximize can replace or pool the active cell without a
    // separate user click. Re-select from the workspace's authoritative active
    // identity so a multi-cell Dock never keeps showing a background strategy.
    layoutUnsubscribe = workspace.on('layout:changed', () => {
      selectLiveCell();
    });

    syncHostBounds();
    if (view && 'ResizeObserver' in view) {
      resizeObserver = new view.ResizeObserver(syncHostBounds);
      resizeObserver.observe(workspace.root);
    }
    if (view) {
      // Mark first so a throwing host shim is still balanced by rollback.
      windowResizeRegistered = true;
      view.addEventListener('resize', syncHostBounds);
    }

    // A failed adapter must not reject application startup.  The controller
    // reports diagnostics and leaves the existing Vela Workspace usable.
    void controller.start().then(() => {
      // The active-cell event may have fired while the workspace was restoring
      // its layout, before the controller had any reports to select. Re-apply
      // the live active cell after bootstrap so a multi-cell restore cannot make
      // the first enumerated strategy appear in the Dock by accident.
      selectLiveCell();
    });

    return {
      controller,
      control,
      workbench: mountedWorkbench,
      destroy: () => dispose(true),
    };
  } catch (error) {
    // Keep the construction error primary. Cleanup errors are diagnostic-only
    // here because createApp needs the real failure reason for optional-feature
    // isolation and must never inherit a half-mounted Backtest feature.
    dispose(false);
    throw error;
  }
}

/** Creates the host without depending on Vela's private internal DOM. */
export function ensureBacktestHost(doc: Document, workspaceRoot: HTMLElement): HTMLElement {
  const existing = doc.getElementById('backtest-workbench');
  if (existing instanceof HTMLElement) return existing;
  const host = doc.createElement('div');
  host.id = 'backtest-workbench';
  host.dataset.backtestHost = 'true';
  const parent = workspaceRoot.parentElement;
  if (parent) parent.appendChild(host);
  else doc.body.appendChild(host);
  return host;
}
