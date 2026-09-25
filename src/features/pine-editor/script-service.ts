import { scriptFavorite } from '../../domain/indicators.ts';
import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import type { ScriptRepository } from '../../domain/ports/script-repository.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';
import type { SavedScript } from '../../domain/scripts.ts';

type ScriptListener = () => void;

export class ScriptService implements ScriptServicePort {
  private readonly listeners = new Set<ScriptListener>();
  private readonly repository: ScriptRepository;
  private readonly favorites: FavoriteServicePort;

  constructor(
    repository: ScriptRepository,
    favorites: FavoriteServicePort,
  ) {
    this.repository = repository;
    this.favorites = favorites;
  }

  list(): SavedScript[] {
    return this.repository.list();
  }

  get(name: string): SavedScript | undefined {
    return this.list().find((script) => script.name === name);
  }

  isFavorite(name: string): boolean {
    return this.repository.isFavorite(name);
  }

  save(name: string, source: string): void {
    const previous = this.get(name)?.script;
    this.repository.save(name, source);
    if (previous != null) this.favorites.syncSavedScript(name, source, previous);
    this.emit();
  }

  rename(oldName: string, newName: string, source: string): void {
    const previous = this.get(oldName)?.script;
    this.repository.rename(oldName, newName, source);
    this.favorites.syncSavedScript(newName, source, previous);
    this.emit();
  }

  delete(name: string): void {
    const saved = this.get(name);
    this.repository.delete(name);
    if (saved) this.favorites.set(scriptFavorite(saved.name, saved.script), false);
    this.emit();
  }

  toggleFavorite(name: string): boolean {
    const saved = this.get(name);
    const scripts = this.repository.toggleFavorite(name);
    const enabled = scripts.some((script) => script.name === name && script.favorite);
    if (saved) this.favorites.set(scriptFavorite(saved.name, saved.script), enabled);
    this.emit();
    return enabled;
  }

  subscribe(listener: ScriptListener): () => void {
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
