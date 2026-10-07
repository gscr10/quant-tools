import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PLATFORM_INDICATORS } from '../../config/platform-indicators.ts';
import type {
  NativeIndicatorIdentity,
  WorkspaceIndicatorItem,
} from '../../domain/indicators.ts';
import { BACKTEST_EXECUTION_HIGHLIGHT_TYPE, type WorkspacePort } from '../../domain/ports/workspace-port.ts';
import type { BacktestExecutionFocus } from '../../domain/ports/workspace-port.ts';
import { clearBacktestExecutionFocus, focusBacktestExecution } from './backtest-chart-adapter.ts';
import { stripTransientWorkspaceIndicators } from '../storage/workspace-storage.ts';
import { resolveScriptIndicatorName } from './indicator-display-name.ts';

export class VelaWorkspaceAdapter implements WorkspacePort {
  private readonly workspace: VelaWorkspace;

  constructor(workspace: VelaWorkspace) {
    this.workspace = workspace;
  }

  dispose(): void {
    clearBacktestExecutionFocus(this.workspace);
  }

  get root(): HTMLElement {
    return this.workspace.root;
  }

  getState(): unknown {
    // Template exports use this seam; Workspace autosave uses the storage
    // boundary. Neither may persist a four-second navigation annotation.
    return JSON.parse(stripTransientWorkspaceIndicators(JSON.stringify(this.workspace.getState())));
  }

  applyState(state: unknown): void {
    this.workspace.applyState(state);
  }

  openPanel(id: string): void {
    this.workspace.context().togglePanel(id, true);
  }

  toast(message: string, kind?: 'info' | 'success' | 'error'): void {
    this.workspace.context().toast(message, kind);
  }

  downloadScreenshot(): void {
    this.workspace.downloadScreenshot();
  }

  closeChartDialogs(): void {
    this.workspace.cells().forEach((cell) => cell.chart.renderer.closeDialogs());
  }

  addScriptIndicator(name: string, script: string, language = 'pine'): void {
    this.workspace.context().addIndicator({ name, script, language });
  }

  addNativeIndicator(nativeType: string): void {
    this.workspace.context().addNativeIndicator(nativeType);
  }

  getOnChartIndicators(): WorkspaceIndicatorItem[] {
    const active = this.workspace.active;
    const rows = active.onChartRows();
    const nativeCount = rows.filter((row) => row.native).length;
    return rows.flatMap((row, index): WorkspaceIndicatorItem[] => {
      if (row.nativeType === BACKTEST_EXECUTION_HIGHLIGHT_TYPE) return [];
      if (row.native && row.nativeType) {
        return [{
          name: row.name,
          source: { kind: 'native', nativeType: row.nativeType },
          remove: () => this.workspace.active.removeFromChart(index),
        }];
      }
      const instance = active.instances[index - nativeCount];
      if (!instance) return [];
      return [{
        name: row.name,
        source: {
          kind: 'script',
          script: instance.entry.script,
          language: instance.entry.language ?? 'pine',
        },
        remove: () => this.workspace.active.removeFromChart(index),
      }];
    });
  }

  getBuiltInIndicators(): WorkspaceIndicatorItem[] {
    let manifestIndex = 0;
    return this.workspace.active.libraryRows()
      .flatMap((row, libraryIndex): WorkspaceIndicatorItem[] => {
        if (row.nativeType === BACKTEST_EXECUTION_HIGHLIGHT_TYPE) return [];
        if (row.native && row.nativeType) {
          return [{
            name: row.name,
            beta: row.beta,
            source: { kind: 'native', nativeType: row.nativeType },
            add: () => this.workspace.active.addFromLibrary(libraryIndex),
          }];
        }
        const definition = PLATFORM_INDICATORS[manifestIndex++];
        if (!definition) return [];
        return [{
          name: definition.name,
          source: {
            kind: 'script',
            script: definition.script,
            language: definition.language,
          },
          add: () => this.workspace.active.addFromLibrary(libraryIndex),
        }];
      });
  }

  resolveScriptIndicatorName(id: string, title: string, source: string): string {
    return resolveScriptIndicatorName(this.workspace, id, title, source);
  }

  resolveNativeIndicator(id: string, title: string): NativeIndicatorIdentity | undefined {
    const active = this.workspace.active;
    const nativeType = active.chart.indicators()
      .find((handle) => handle.id === id)?.nativeType;
    const native = nativeType
      ? active.nativeCatalog.find((item) => item.type === nativeType)
      : active.nativeCatalog.find((item) => item.title === title);
    return native ? { title: native.title, type: native.type } : undefined;
  }

  focusBacktestExecution(input: BacktestExecutionFocus): boolean {
    return focusBacktestExecution(this.workspace, input);
  }
}
