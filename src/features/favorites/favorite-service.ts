import {
  scriptFavorite,
  type IndicatorFavorite,
} from '../../domain/indicators.ts';
import type { FavoriteRepository } from '../../domain/ports/favorite-repository.ts';
import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import type { ScriptRepository } from '../../domain/ports/script-repository.ts';

type FavoriteListener = () => void;

export class FavoriteService implements FavoriteServicePort {
  private readonly listeners = new Set<FavoriteListener>();
  private readonly favorites: FavoriteRepository;
  private readonly scripts: ScriptRepository;

  constructor(
    favorites: FavoriteRepository,
    scripts: ScriptRepository,
  ) {
    this.favorites = favorites;
    this.scripts = scripts;
  }

  list(): IndicatorFavorite[] {
    return this.favorites.list();
  }

  has(favorite: IndicatorFavorite): boolean {
    return this.list().some((item) => item.key === favorite.key);
  }

  set(favorite: IndicatorFavorite, enabled: boolean): void {
    this.apply(favorite, enabled);
    this.emit();
  }

  private apply(favorite: IndicatorFavorite, enabled: boolean): void {
    this.favorites.set(favorite, enabled);

    if (favorite.kind === 'script') {
      this.scripts.list()
        .filter((script) => script.script === favorite.script)
        .forEach((script) => {
          if (Boolean(script.favorite) !== enabled) this.scripts.toggleFavorite(script.name);
        });
    }
  }

  toggle(favorite: IndicatorFavorite): boolean {
    const enabled = !this.has(favorite);
    this.set(favorite, enabled);
    return enabled;
  }

  syncSavedScript(name: string, script: string, previousScript?: string): void {
    const enabled = this.scripts.isFavorite(name);
    if (previousScript && previousScript !== script) {
      this.apply(scriptFavorite(name, previousScript), false);
    }
    this.apply(scriptFavorite(name, script), enabled);
    this.emit();
  }

  reconcileLegacyScripts(): void {
    let changed = false;
    this.scripts.list().forEach((script) => {
      const favorite = scriptFavorite(script.name, script.script);
      const indicatorStarred = this.has(favorite);
      if (script.favorite && !indicatorStarred) {
        this.favorites.set(favorite, true);
        changed = true;
      } else if (!script.favorite && indicatorStarred) {
        this.scripts.toggleFavorite(script.name);
        changed = true;
      }
    });
    if (changed) this.emit();
  }

  subscribe(listener: FavoriteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.listeners.clear();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
