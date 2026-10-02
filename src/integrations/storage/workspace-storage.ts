import { WORKSPACE_HISTORY_BARS } from '../../config/workspace-options.ts';
export { WORKSPACE_HISTORY_BARS } from '../../config/workspace-options.ts';

interface WorkspaceStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Upgrade persisted chart seeds without discarding the user's workspace.
 * Renderer options also contain a `bars` object, so this intentionally only
 * touches the known chart/cell market records rather than recursively editing
 * every property in the document.
 */
export function migrateWorkspaceState(raw: string, minimumBars = WORKSPACE_HISTORY_BARS): string {
  try {
    const state: unknown = JSON.parse(raw);
    // This function is called at a runtime persistence boundary.  Keep the
    // migration a no-op for an unusable threshold rather than writing an
    // invalid (for example, zero or fractional) history budget back to the
    // user's document.
    const targetBars = Number.isFinite(minimumBars) && minimumBars > 0
      ? Math.floor(minimumBars)
      : 0;
    if (!isRecord(state) || targetBars <= 0) return raw;
    let changed = false;
    const upgrade = (entry: unknown): void => {
      if (!isRecord(entry)) return;
      const bars = entry.bars;
      // Vela drops malformed persisted fields, which would otherwise make an
      // old document fall back to its generic default instead of the current
      // 2000-bar policy.  Repair the chart/cell field here, while deliberately
      // leaving rendererConfig.bars (a color object) untouched.
      const validBars = typeof bars === 'number' && Number.isFinite(bars) && bars > 0;
      if (!validBars || bars < targetBars) {
        entry.bars = targetBars;
        changed = true;
      }
    };
    if (Array.isArray(state.charts)) state.charts.forEach(upgrade);
    if (isRecord(state.cells)) Object.values(state.cells).forEach(upgrade);
    return changed ? JSON.stringify(state) : raw;
  } catch {
    return raw;
  }
}

/** Storage adapter that migrates old Vela workspace snapshots on first read. */
export function createMigratingWorkspaceStorage(
  storage?: Storage,
  minimumBars = WORKSPACE_HISTORY_BARS,
): WorkspaceStorage {
  // Accessing the browser property itself can throw in restricted contexts.
  // Resolve lazily so constructing the workspace remains safe even there.
  const backend = (): Storage | undefined => {
    try { return storage ?? globalThis.localStorage; } catch { return undefined; }
  };
  // Failed writes must remain visible within this workspace, including removals.
  const pending = new Map<string, string | null>();
  const write = (key: string, value: string | null): void => {
    // Vela's storage contract is string|null at runtime too.  A malformed
    // host call must not poison the pending fallback with an object/number
    // that would later escape through get().
    if (value !== null && typeof value !== 'string') return;
    pending.set(key, value);
    try {
      const target = backend();
      if (!target) return;
      if (value === null) target.removeItem(key);
      else target.setItem(key, value);
      pending.delete(key);
    } catch { /* Keep a session-local fallback; never clear user storage. */ }
  };
  return {
    get(key) {
      let raw: string | null;
      if (pending.has(key)) raw = pending.get(key) ?? null;
      else {
        try {
          const value = backend()?.getItem(key) ?? null;
          raw = typeof value === 'string' || value === null ? value : null;
        } catch { return null; }
      }
      if (raw === null) return null;
      const migrated = migrateWorkspaceState(raw, minimumBars);
      if (migrated !== raw) write(key, migrated);
      return migrated;
    },
    set(key, value) { write(key, value); },
    remove(key) { write(key, null); },
  };
}
