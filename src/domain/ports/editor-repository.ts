import type { EditorSnapshot } from '../scripts.ts';

export interface EditorRepository {
  load(): EditorSnapshot | null;
  save(snapshot: EditorSnapshot): void;
}
