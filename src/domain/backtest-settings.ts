import type {
  BacktestSettingSchema,
  BacktestSettingValue,
} from './ports/backtest-settings.ts';

/**
 * Build the smallest settings patch accepted by Vela's batch setters.
 *
 * Property values are override-only in Vela, so an absent current/draft key
 * means the schema default.  Resolving both sides through the schema keeps a
 * source-declared `use_bar_magnifier` value truthful and prevents an unchanged
 * tab from starting a second strategy run when the other tab is committed.
 */
export function diffBacktestSettingValues(
  schemas: readonly BacktestSettingSchema[],
  current: Readonly<Record<string, BacktestSettingValue>>,
  draft: Readonly<Record<string, BacktestSettingValue>>,
): Record<string, BacktestSettingValue> {
  const patch: Record<string, BacktestSettingValue> = {};
  for (const schema of schemas) {
    const currentValue = current[schema.key] ?? schema.defval;
    const draftValue = draft[schema.key] ?? schema.defval;
    if (!Object.is(currentValue, draftValue)) patch[schema.key] = draftValue;
  }
  return patch;
}

/**
 * Validate a draft against the same schema/visibility rules used by the
 * strategy settings form.
 *
 * This lives in the DOM-free domain boundary so it can be exercised in node
 * tests and reused by non-browser hosts. Conditionally hidden controls remain
 * draft state, but do not block the current submission. Numeric `step` is
 * checked explicitly instead of relying only on native HTML validity.
 */
export function validateBacktestSettingsDraft(
  snapshot: BacktestSettingsSnapshotLike,
  inputs: Readonly<Record<string, BacktestSettingValue>>,
  props: Readonly<Record<string, BacktestSettingValue>>,
): string | null {
  const sections = [
    { schemas: snapshot.inputs, draft: inputs },
    { schemas: snapshot.props, draft: props },
  ];
  for (const { schemas, draft } of sections) {
    const values = resolveBacktestSettingValues(schemas, draft);
    for (const schema of schemas) {
      if (!isVisibleForValues(schema, values)) continue;
      const value = values[schema.key] ?? schema.defval;
      if (isNumericSetting(schema.type)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return `${schema.title} must be a valid number.`;
        }
        // Pine/Vela integer inputs are discrete even when a producer omits
        // an explicit `step`.  Relying on the browser's `step` attribute is
        // insufficient because non-browser callers (and programmatic
        // drafts) can still submit fractional values.  Reject them at the
        // domain boundary so an invalid draft cannot trigger a strategy run.
        if (schema.type === 'int' && !Number.isInteger(value)) {
          return `${schema.title} must be a whole number.`;
        }
        if (schema.min !== undefined && value < schema.min) {
          return `${schema.title} must be at least ${schema.min}.`;
        }
        if (schema.max !== undefined && value > schema.max) {
          return `${schema.title} must be at most ${schema.max}.`;
        }
        if (schema.step !== undefined && schema.step > 0) {
          const base = schema.min ?? (typeof schema.defval === 'number' ? schema.defval : 0);
          const quotient = (value - base) / schema.step;
          const tolerance = Number.EPSILON
            * Math.max(1, Math.abs(value), Math.abs(base), Math.abs(schema.step))
            * 32;
          if (Math.abs(quotient - Math.round(quotient)) > tolerance) {
            return `${schema.title} must use increments of ${schema.step}.`;
          }
        }
      }
      if (schema.type === 'bool' && typeof value !== 'boolean') {
        return `${schema.title} must be true or false.`;
      }
      if (!isNumericSetting(schema.type) && schema.type !== 'bool' && typeof value !== 'string') {
        return `${schema.title} must be text.`;
      }
      // Vela serializes numeric option labels as strings, while Pine inputs
      // retain their numeric type. Compare within that type without turning
      // the value sent to the engine into a string.
      if (schema.options && schema.options.length > 0
        && !schema.options.some((option) => isNumericSetting(schema.type)
          ? typeof value === 'number' && Number(option) === value
          : option === value)) {
        return `${schema.title} has an invalid option.`;
      }
    }
  }
  return null;
}

/** Inputs and declaration properties have independent namespaces and defaults. */
export function resolveBacktestSettingValues(
  schemas: readonly BacktestSettingSchema[],
  draft: Readonly<Record<string, BacktestSettingValue>>,
): Record<string, BacktestSettingValue> {
  return Object.fromEntries(schemas.map((schema) => [
    schema.key, draft[schema.key] ?? schema.defval,
  ]));
}

/** Keep the validator independent from the larger UI snapshot type. */
interface BacktestSettingsSnapshotLike {
  readonly inputs: readonly BacktestSettingSchema[];
  readonly props: readonly BacktestSettingSchema[];
}

function isNumericSetting(type: BacktestSettingSchema['type']): boolean {
  return type === 'int' || type === 'float' || type === 'price' || type === 'time';
}

function isVisibleForValues(
  schema: BacktestSettingSchema,
  values: Readonly<Record<string, BacktestSettingValue>>,
): boolean {
  const when = schema.when;
  if (!when) return true;
  const conditions = Array.isArray(when) ? when : [when];
  return conditions.every((condition) => {
    const current = values[condition.key];
    if (condition.anyOf) {
      return condition.anyOf.some((candidate: BacktestSettingValue) => candidate === current);
    }
    return condition.equals === undefined || condition.equals === current;
  });
}
