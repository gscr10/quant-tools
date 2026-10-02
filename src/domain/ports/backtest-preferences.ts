/**
 * Versioned, UI-only preferences for the Backtest Dock.
 *
 * This contract deliberately contains no report, trade, strategy or Workspace
 * state.  It is safe to persist independently from the Vela workspace schema
 * and can be discarded without affecting a user's chart or scripts.
 */
export interface BacktestDockPreferences {
  readonly version: 1;
  /** Last expanded Dock height in CSS pixels. */
  readonly height: number;
  /** Whether the Dock was explicitly collapsed by the user. */
  readonly collapsed: boolean;
}

export interface BacktestPreferencesRepository {
  loadDock(): BacktestDockPreferences | null;
  saveDock(preferences: BacktestDockPreferences): void;
}
