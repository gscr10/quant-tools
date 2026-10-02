export interface QuantBuildEnvironment {
  readonly VITE_ENABLE_BACKTESTING?: string;
}

/**
 * Release kill switch for the optional Backtesting feature.
 *
 * The feature remains enabled unless an operator explicitly supplies a false
 * value.  Keeping the decision at the composition boundary means disabling a
 * faulty release never reads or rewrites a user's Workspace, scripts,
 * favorites, templates, or editor state.
 */
export function resolveBacktestFeatureEnabled(
  rawValue: string | undefined,
): boolean {
  if (rawValue === undefined) return true;
  return !['0', 'false', 'off', 'disabled'].includes(rawValue.trim().toLowerCase());
}

const buildEnvironment = (import.meta as ImportMeta & {
  readonly env?: QuantBuildEnvironment;
}).env;

export const BACKTEST_FEATURE_ENABLED = resolveBacktestFeatureEnabled(
  buildEnvironment?.VITE_ENABLE_BACKTESTING,
);
