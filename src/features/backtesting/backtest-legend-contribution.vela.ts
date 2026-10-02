import { registerLegendCallout, type WidgetContext } from '@luxalgo/vela/plugin';

interface BacktestLegendWorkspace {
  refreshActions(): void;
  cells(): ReadonlyArray<{ id: string; chart: unknown }>;
}

/** Minimal application seam keeps the Vela contribution out of app composition. */
interface BacktestLegendFeature {
  readonly controller: {
    setActive(key: { cellId: string; indicatorId: string }): void;
    getReport(key: { cellId: string; indicatorId: string }): unknown;
  };
  readonly workbench: {
    openViewer(): void;
  };
}

const STRATEGY_DECLARATION = /^\s*strategy\s*\(/im;

/**
 * Install the strategy legend callout used by the reference Quant workspace.
 *
 * The callout intentionally stays at the Vela contribution boundary: it does
 * not own a report, subscribe to a worker, or calculate anything.  When the
 * user presses "Show backtest" it resolves the chart cell and indicator id,
 * selects the already accepted Controller report, and asks the existing
 * Workbench to open its Viewer.
 */
export function registerBacktestLegendContribution(
  workspace: BacktestLegendWorkspace,
  getFeature: () => BacktestLegendFeature | null,
): () => void {
  const dispose = registerLegendCallout({
    id: 'quant-strategy-backtest',
    order: -10,
    callout: (indicator) => {
      if (!indicator.source || !STRATEGY_DECLARATION.test(indicator.source)) return null;
      return {
        icon: 'quant-strategy',
        background: 'rgba(56, 189, 248, 0.28)',
        color: '#38bdf8',
        tooltip: 'Strategy',
        content: {
          title: 'Strategy',
          items: [
            {
              type: 'text',
              text: 'This script is a strategy — it can open trades and produce a backtest.',
            },
            {
              type: 'button',
              label: 'Show backtest',
              primary: true,
              run: (context, row) => openBacktest(context, row.id, workspace, getFeature),
            },
          ],
        },
      };
    },
  });

  // Contributions are registered after the Vela workspace has been created so
  // the feature can be wired without a global mutable report store.  Vela's
  // refresh seam re-projects the live legend rows on every cell.
  workspace.refreshActions();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    dispose();
    workspace.refreshActions();
  };
}

function openBacktest(
  context: WidgetContext,
  indicatorId: string,
  workspace: BacktestLegendWorkspace,
  getFeature: () => BacktestLegendFeature | null,
): void {
  const feature = getFeature();
  if (!feature) {
    context.toast('Backtesting is unavailable', 'error');
    return;
  }

  const cell = workspace.cells().find((candidate) => candidate.chart === context.chart);
  if (!cell) {
    context.toast('Unable to locate this strategy chart', 'error');
    return;
  }

  const key = { cellId: cell.id, indicatorId };
  feature.controller.setActive(key);
  if (!feature.controller.getReport(key)) {
    context.toast('Backtest is still computing', 'info');
    return;
  }
  feature.workbench.openViewer();
}
