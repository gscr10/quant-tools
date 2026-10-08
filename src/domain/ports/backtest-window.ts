/** Provider-neutral user-selected strategy calculation window. */
export type BacktestWindowPreset = 'default' | '1M' | '3M' | '6M' | '1Y' | 'custom';

export interface BacktestWindowSelection {
  readonly preset: BacktestWindowPreset;
  readonly from?: number | null;
  readonly to?: number | null;
}

export interface BacktestResolvedWindow extends BacktestWindowSelection {
  readonly from: number | null;
  readonly to: number | null;
  readonly label: string;
}
