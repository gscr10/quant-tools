import type { IndicatorFavorite } from '../indicators.ts';

export interface FavoriteServicePort {
  list(): IndicatorFavorite[];
  has(favorite: IndicatorFavorite): boolean;
  set(favorite: IndicatorFavorite, enabled: boolean): void;
  toggle(favorite: IndicatorFavorite): boolean;
  syncSavedScript(name: string, script: string, previousScript?: string): void;
  reconcileLegacyScripts(): void;
  subscribe(listener: () => void): () => void;
}
