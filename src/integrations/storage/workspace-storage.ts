interface WorkspaceStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
}

export const WORKSPACE_HISTORY_BARS = 2000;

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
    if (!isRecord(state) || !Number.isFinite(minimumBars) || minimumBars <= 0) return raw;
    let changed = false;
    const upgrade = (entry: unknown): void => {
      if (!isRecord(entry)) return;
      const bars = entry.bars;
      if (bars === undefined || (typeof bars === 'number' && Number.isFinite(bars) && bars < minimumBars)) {
        entry.bars = Math.floor(minimumBars);
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
  const backend = storage ?? window.localStorage;
  return {
    get(key) {
      const raw = backend.getItem(key);
      if (raw === null) return null;
      const migrated = migrateWorkspaceState(raw, minimumBars);
      if (migrated !== raw) {
        try { backend.setItem(key, migrated); } catch { /* Vela still has the in-memory state. */ }
      }
      return migrated;
    },
    set(key, value) { backend.setItem(key, value); },
    remove(key) { backend.removeItem(key); },
  };
}
