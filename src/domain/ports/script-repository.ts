import type { SavedScript } from '../scripts.ts';

export interface ScriptRepository {
  list(): SavedScript[];
  save(name: string, script: string): SavedScript[];
  delete(name: string): SavedScript[];
  rename(oldName: string, newName: string, script?: string): SavedScript[];
  toggleFavorite(name: string): SavedScript[];
  isFavorite(name: string): boolean;
}
