import type {
  AddIndicatorOptions,
  ContextSelect,
  EngineContextSnapshot,
  InputSchema,
  InputValue,
  IndicatorHandle,
  ScriptRunResult,
  StrategyTrade,
} from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { batchPineSettings } from '@luxalgo/vela-pinets/audit';
import {
  BACKTEST_CONTEXT_SELECT,
  type BacktestAdapterKey,
} from './backtest-adapter-types.ts';
import type {
  BacktestSettingSchema,
  BacktestSettingsSnapshot,
  BacktestSettingValue,
} from '../../domain/ports/backtest-settings.ts';

/** Narrow control port used by Backtest Settings/Inputs and chart actions. */
export interface BacktestControlPort {
  getHandle(key: BacktestAdapterKey): IndicatorHandle | undefined;
  /** Read the live Inputs/Properties schema and values for a script indicator. */
  readSettings(key: BacktestAdapterKey): BacktestSettingsSnapshot | null;
  readContext(
    key: BacktestAdapterKey,
    select?: ContextSelect,
  ): Promise<EngineContextSnapshot | null>;
  readTrades(key: BacktestAdapterKey): Promise<readonly StrategyTrade[]>;
  setInputs(key: BacktestAdapterKey, values: Record<string, number | string | boolean>): boolean;
  setProps(key: BacktestAdapterKey, values: Record<string, number | string | boolean>): boolean;
  applySettings(key: BacktestAdapterKey, inputs: Record<string, number | string | boolean>, props: Record<string, number | string | boolean>): boolean;
  updateCode(key: BacktestAdapterKey, source: string): boolean;
  setVisible(key: BacktestAdapterKey, visible: boolean): boolean;
  remove(key: BacktestAdapterKey): boolean;
  runScript(
    cellId: string,
    source: string,
    options?: AddIndicatorOptions,
  ): Promise<ScriptRunResult | null>;
}

/**
 * Public-API-only command adapter. It intentionally resolves the live chart and
 * handle for every call so cell layout changes and in-place code updates cannot
 * leave a stale object reference in a Backtest panel.
 */
export class VelaBacktestControlAdapter implements BacktestControlPort {
  private readonly workspace: VelaWorkspace;

  private markStateDirty(key: BacktestAdapterKey): void {
    try {
      if (this.workspace.active?.id === key.cellId) this.workspace.context().stateChanged();
    } catch {
      // Persistence is best effort; the engine update itself already succeeded.
    }
  }

  constructor(workspace: VelaWorkspace) {
    this.workspace = workspace;
  }

  getHandle(key: BacktestAdapterKey): IndicatorHandle | undefined {
    try {
      return this.workspace.cell(key.cellId)?.chart.indicators()
        .find((handle) => handle.id === key.indicatorId);
    } catch {
      // Control calls are optional UI enhancements; a torn-down/replaced cell
      // must not make a settings action escape into the Workspace event loop.
      return undefined;
    }
  }

  readSettings(key: BacktestAdapterKey): BacktestSettingsSnapshot | null {
    try {
      const handle = this.getHandle(key);
      // Native studies have their own renderer settings and do not expose a
      // Pine input/props schema. Keeping them out here avoids a misleading
      // empty strategy dialog in the backtest surface.
      if (!handle || handle.nativeType) return null;
      return {
        key: { cellId: key.cellId, indicatorId: key.indicatorId },
        title: handle.title,
        ...(handle.source ? { source: handle.source } : {}),
        visible: handle.visible,
        inputs: handle.inputs.map(toSettingSchema),
        props: handle.props.map(toSettingSchema),
        inputValues: copyValues(handle.inputValues()),
        propValues: copyValues(handle.propValues()),
      };
    } catch {
      return null;
    }
  }

  async readContext(
    key: BacktestAdapterKey,
    select: ContextSelect = BACKTEST_CONTEXT_SELECT,
  ): Promise<EngineContextSnapshot | null> {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType) return null;
      return await handle.context(select);
    } catch {
      return null;
    }
  }

  async readTrades(key: BacktestAdapterKey): Promise<readonly StrategyTrade[]> {
    const context = await this.readContext(key, ['trades']);
    return context?.trades ?? [];
  }

  setInputs(
    key: BacktestAdapterKey,
    values: Record<string, number | string | boolean>,
  ): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType) return false;
      handle.setInputs(values);
      this.markStateDirty(key);
      return true;
    } catch {
      return false;
    }
  }

  setProps(
    key: BacktestAdapterKey,
    values: Record<string, number | string | boolean>,
  ): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType) return false;
      handle.setProps(values);
      restartPrecisionSession(handle, values);
      this.markStateDirty(key);
      return true;
    } catch {
      return false;
    }
  }

  applySettings(
    key: BacktestAdapterKey,
    inputs: Record<string, number | string | boolean>,
    props: Record<string, number | string | boolean>,
  ): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType) return false;
      batchPineSettings(() => {
        if (Object.keys(inputs).length) handle.setInputs(inputs);
        if (Object.keys(props).length) handle.setProps(props);
      });
      restartPrecisionSession(handle, props);
      this.markStateDirty(key);
      return true;
    } catch {
      return false;
    }
  }

  updateCode(key: BacktestAdapterKey, source: string): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType || !source.trim()) return false;
      handle.updateCode(source);
      return true;
    } catch {
      return false;
    }
  }

  setVisible(key: BacktestAdapterKey, visible: boolean): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle || handle.nativeType) return false;
      handle.setVisible(visible);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: BacktestAdapterKey): boolean {
    try {
      const handle = this.getHandle(key);
      if (!handle) return false;
      handle.remove();
      return true;
    } catch {
      return false;
    }
  }

  async runScript(
    cellId: string,
    source: string,
    options?: AddIndicatorOptions,
  ): Promise<ScriptRunResult | null> {
    try {
      const chart = this.workspace.cell(cellId)?.chart;
      if (!chart || !source.trim()) return null;
      return await chart.runScript(source, options);
    } catch {
      return null;
    }
  }
}

/**
 * Vela's public `setProps` updates an existing live session in place. Toggling
 * Bar Magnifier changes the required execution mode, so restart the visible
 * script once after the property write; the engine then selects its static
 * lower-timeframe path. Hidden scripts have no session and are left alone.
 */
function restartPrecisionSession(
  handle: IndicatorHandle,
  values: Record<string, number | string | boolean>,
): void {
  if (!Object.prototype.hasOwnProperty.call(values, 'use_bar_magnifier')) return;
  if (values.use_bar_magnifier !== true && values.use_bar_magnifier !== false) return;
  if (handle.visible !== true || typeof handle.setVisible !== 'function') return;
  handle.setVisible(false);
  handle.setVisible(true);
}

function toSettingSchema(schema: InputSchema): BacktestSettingSchema {
  return {
    key: schema.key,
    title: schema.title,
    type: schema.type,
    defval: schema.defval,
    ...(schema.min === undefined ? {} : { min: schema.min }),
    ...(schema.max === undefined ? {} : { max: schema.max }),
    ...(schema.step === undefined ? {} : { step: schema.step }),
    ...(schema.options === undefined ? {} : { options: [...schema.options] }),
    ...(schema.group === undefined ? {} : { group: schema.group }),
    ...(schema.inline === undefined ? {} : { inline: schema.inline }),
    ...(schema.tab === undefined ? {} : { tab: schema.tab }),
    ...(schema.when === undefined ? {} : { when: schema.when }),
    ...(schema.tooltip === undefined ? {} : { tooltip: schema.tooltip }),
  };
}

function copyValues(values: Record<string, InputValue>): Readonly<Record<string, BacktestSettingValue>> {
  return Object.freeze({ ...values });
}
