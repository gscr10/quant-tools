import type { IndicatorFavorite } from '../indicators.ts';

export interface FavoriteRepository {
  list(): IndicatorFavorite[];
  set(favorite: IndicatorFavorite, enabled: boolean): IndicatorFavorite[];
}
