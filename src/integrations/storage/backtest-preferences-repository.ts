import type {
  BacktestDockPreferences,
  BacktestPreferencesRepository,
} from '../../domain/ports/backtest-preferences.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { BACKTEST_DOCK_PREFERENCES_KEY } from './keys.ts';

const VERSION = 1 as const;

function asDockPreferences(value: unknown): BacktestDockPreferences | null {
  if (!isRecord(value) || value.version !== VERSION) return null;
  if (typeof value.height !== 'number' || !Number.isFinite(value.height)) return null;
  if (value.height <= 0 || typeof value.collapsed !== 'boolean') return null;
  return Object.freeze({
    version: VERSION,
    height: value.height,
    collapsed: value.collapsed,
  });
}

/** Load only the independent Dock UI preference. Invalid/old values are ignored. */
export function loadBacktestDockPreferences(): BacktestDockPreferences | null {
  return asDockPreferences(readJson(BACKTEST_DOCK_PREFERENCES_KEY));
}

/**
 * Save only validated Dock UI state. The Workbench clamps the height against
 * its current viewport/options before calling this repository; this boundary
 * still rejects malformed values so a bad caller cannot poison the key.
 */
export function saveBacktestDockPreferences(preferences: BacktestDockPreferences): void {
  const normalized = asDockPreferences(preferences);
  if (!normalized) return;
  writeJson(BACKTEST_DOCK_PREFERENCES_KEY, normalized);
}

export const browserBacktestPreferencesRepository: BacktestPreferencesRepository = {
  loadDock: loadBacktestDockPreferences,
  saveDock: saveBacktestDockPreferences,
};

