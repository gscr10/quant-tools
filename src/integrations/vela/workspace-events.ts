import type { IndicatorHandle, Vela } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { extractPineTitle } from '../../domain/pine-source.ts';

export interface WorkspaceEventSink {
  syncIndicators(): void;
  logEditor(level: 'info' | 'ok' | 'error', message: string): void;
  reportEditorError(error: Error, source?: string): void;
}

type BoundChart = {
  chart: Vela;
  dispose(): void;
};

export function bindWorkspaceEvents(
  workspace: VelaWorkspace,
  sink: WorkspaceEventSink,
): () => void {
  const workspaceDisposers: Array<() => void> = [];
  const charts = new Map<string, BoundChart>();

  const bindChart = (cellId: string, chart: Vela) => {
    const current = charts.get(cellId);
    if (current?.chart === chart) return;
    current?.dispose();

    const chartDisposers: Array<() => void> = [];
    const handles = new WeakSet<IndicatorHandle>();
    const bindHandle = (handle: IndicatorHandle) => {
      if (handles.has(handle)) return;
      handles.add(handle);
      chartDisposers.push(handle.on('ready', () => {
        const title = handle.title && handle.title !== 'Indicator'
          ? handle.title
          : extractPineTitle(handle.source ?? '');
        sink.logEditor('ok', `ready · ${title}`);
      }));
      chartDisposers.push(handle.on('error', ({ error }) => {
        sink.reportEditorError(error, handle.source);
      }));
    };

    chart.indicators().forEach(bindHandle);
    chartDisposers.push(chart.on('indicator:added', ({ id }) => {
      const handle = chart.indicators().find((item) => item.id === id);
      if (handle) bindHandle(handle);
    }));
    charts.set(cellId, {
      chart,
      dispose: () => {
        while (chartDisposers.length > 0) chartDisposers.pop()?.();
      },
    });
  };

  workspace.cells().forEach((cell) => bindChart(cell.id, cell.chart));
  workspaceDisposers.push(workspace.on('cell:created', ({ id }) => {
    const cell = workspace.cell(id);
    if (cell) bindChart(id, cell.chart);
    sink.syncIndicators();
  }));
  workspaceDisposers.push(workspace.on('cell:destroyed', ({ id }) => {
    charts.get(id)?.dispose();
    charts.delete(id);
    sink.syncIndicators();
  }));
  workspaceDisposers.push(workspace.on('cell:active', () => sink.syncIndicators()));
  workspaceDisposers.push(workspace.on('state:changed', () => sink.syncIndicators()));
  workspaceDisposers.push(workspace.on('script:run', (run) => {
    if (run.cause === 'tick' || run.cause === 'viewport') return;
    sink.logEditor('info', `script:run · ${run.title} · ${run.cell} · ${run.cause}`);
  }));

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    while (workspaceDisposers.length > 0) workspaceDisposers.pop()?.();
    charts.forEach((bound) => bound.dispose());
    charts.clear();
  };
}
