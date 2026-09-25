import type { IndicatorFavorite } from '../../domain/indicators.ts';
import type { FavoriteRepository } from '../../domain/ports/favorite-repository.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { INDICATOR_FAVORITES_KEY } from './keys.ts';

export type { IndicatorFavorite } from '../../domain/indicators.ts';

function asIndicatorFavorite(value: unknown): IndicatorFavorite | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
    ? value.savedAt
    : 0;
  if (!key || !name) return null;
  if (value.kind === 'native' && typeof value.nativeType === 'string' && value.nativeType.trim()) {
    return { key, name, savedAt, kind: 'native', nativeType: value.nativeType.trim() };
  }
  if (value.kind === 'script' && typeof value.script === 'string' && value.script.trim()) {
    return {
      key,
      name,
      savedAt,
      kind: 'script',
      script: value.script,
      ...(typeof value.language === 'string' && value.language.trim()
        ? { language: value.language.trim() }
        : {}),
    };
  }
  return null;
}

export function listIndicatorFavorites(): IndicatorFavorite[] {
  const value = readJson(INDICATOR_FAVORITES_KEY);
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  return value.flatMap((item) => {
    const favorite = asIndicatorFavorite(item);
    if (!favorite || keys.has(favorite.key)) return [];
    keys.add(favorite.key);
    return [favorite];
  });
}

export function setIndicatorFavorite(
  favorite: IndicatorFavorite,
  enabled: boolean,
): IndicatorFavorite[] {
  const normalized = asIndicatorFavorite(favorite);
  if (!normalized) return listIndicatorFavorites();
  const current = listIndicatorFavorites();
  const rest = current.filter((item) => item.key !== normalized.key);
  const next = enabled ? [{ ...normalized, savedAt: Date.now() }, ...rest] : rest;
  writeJson(INDICATOR_FAVORITES_KEY, next);
  return next;
}

export function toggleIndicatorFavorite(favorite: IndicatorFavorite): IndicatorFavorite[] {
  const normalized = asIndicatorFavorite(favorite);
  if (!normalized) return listIndicatorFavorites();
  const enabled = !listIndicatorFavorites().some((item) => item.key === normalized.key);
  return setIndicatorFavorite(normalized, enabled);
}

export const browserFavoriteRepository: FavoriteRepository = {
  list: listIndicatorFavorites,
  set: setIndicatorFavorite,
};
