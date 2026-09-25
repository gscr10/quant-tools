import type { LayoutItem } from '../../domain/layout.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { LEGACY_LAYOUT_KEY } from './keys.ts';

export type { LayoutItem } from '../../domain/layout.ts';

/** @deprecated Kept only for compatibility with existing locally saved state. */
export function loadLayout(): LayoutItem[] {
  const value = readJson(LEGACY_LAYOUT_KEY);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.source !== 'string' || !item.source.trim()) return [];
    return [{
      source: item.source,
      visible: item.visible !== false,
      savedName: typeof item.savedName === 'string' && item.savedName.trim()
        ? item.savedName.trim()
        : null,
    }];
  });
}

/** @deprecated Kept only for compatibility with existing locally saved state. */
export function saveLayout(items: LayoutItem[]): void {
  writeJson(LEGACY_LAYOUT_KEY, items);
}
