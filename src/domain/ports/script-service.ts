import type { SavedScript } from '../scripts.ts';

export interface ScriptServicePort {
  list(): SavedScript[];
  get(name: string): SavedScript | undefined;
  isFavorite(name: string): boolean;
  save(name: string, source: string): void;
  rename(oldName: string, newName: string, source: string): void;
  delete(name: string): void;
  toggleFavorite(name: string): boolean;
  subscribe(listener: () => void): () => void;
}
