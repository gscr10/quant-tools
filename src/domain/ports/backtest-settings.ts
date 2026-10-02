/**
 * Renderer-neutral strategy settings contracts.
 *
 * Vela exposes the same primitive input vocabulary for Pine scripts and for
 * declaration properties.  Keeping this small DTO in the domain layer lets
 * the backtest UI consume settings without importing Vela (or PineTS), while
 * the integration adapter remains responsible for mapping Vela's schemas.
 */

export type BacktestSettingValue = number | string | boolean;

export type BacktestSettingType =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'source'
  | 'color'
  | 'price'
  | 'time'
  | 'session'
  | 'timeframe'
  | 'symbol'
  | 'text_area';

export interface BacktestSettingCondition {
  readonly key: string;
  readonly equals?: BacktestSettingValue;
  readonly anyOf?: readonly BacktestSettingValue[];
}
export type BacktestSettingWhen =
  | BacktestSettingCondition
  | readonly BacktestSettingCondition[];

/** One field rendered by the Inputs or Properties tab. */
export interface BacktestSettingSchema {
  readonly key: string;
  readonly title: string;
  readonly type: BacktestSettingType;
  readonly defval: BacktestSettingValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly group?: string;
  readonly inline?: string;
  readonly tab?: string;
  readonly when?: BacktestSettingWhen;
  readonly tooltip?: string;
}

export interface BacktestSettingsKey {
  readonly cellId: string;
  readonly indicatorId: string;
}

/**
 * A point-in-time settings snapshot. Values are copies so a form can be edited
 * locally and only committed after the user presses Apply.
 */
export interface BacktestSettingsSnapshot {
  readonly key: BacktestSettingsKey;
  readonly title: string;
  readonly source?: string;
  readonly visible: boolean;
  readonly inputs: readonly BacktestSettingSchema[];
  readonly props: readonly BacktestSettingSchema[];
  readonly inputValues: Readonly<Record<string, BacktestSettingValue>>;
  readonly propValues: Readonly<Record<string, BacktestSettingValue>>;
}
