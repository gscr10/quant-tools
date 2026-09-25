import type {
  NativeIndicatorIdentity,
  WorkspaceIndicatorItem,
} from '../indicators.ts';

export interface WorkspacePort {
  readonly root: HTMLElement;
  getState(): unknown;
  applyState(state: unknown): void;
  openPanel(id: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'error'): void;
  downloadScreenshot(): void;
  closeChartDialogs(): void;
  addScriptIndicator(name: string, script: string, language?: string): void;
  addNativeIndicator(nativeType: string): void;
  getOnChartIndicators(): WorkspaceIndicatorItem[];
  getBuiltInIndicators(): WorkspaceIndicatorItem[];
  resolveNativeIndicator(id: string, title: string): NativeIndicatorIdentity | undefined;
}
