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
  // Accessing the browser property itself can throw in restricted contexts.
  // Resolve lazily so constructing the workspace remains safe even there.
  const backend = (): Storage | undefined => {
    try { return storage ?? globalThis.localStorage; } catch { return undefined; }
  };
  // Failed writes must remain visible within this workspace, including removals.
  const pending = new Map<string, string | null>();
  const write = (key: string, value: string | null): void => {
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
        try { raw = backend()?.getItem(key) ?? null; } catch { return null; }
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
