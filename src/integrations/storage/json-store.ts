const memoryStore = new Map<string, string>();

export function readJson(key: string): unknown {
  try {
    const raw = memoryStore.get(key) ?? localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(key, serialized);
    memoryStore.delete(key);
  } catch {
    // Storage may be full or unavailable. Keep the current session usable.
    memoryStore.set(key, serialized);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
