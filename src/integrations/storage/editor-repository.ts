import type { EditorRepository } from '../../domain/ports/editor-repository.ts';
import type { EditorSnapshot } from '../../domain/scripts.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { EDITOR_KEY } from './keys.ts';

export type { EditorSnapshot } from '../../domain/scripts.ts';

export function loadEditorSnapshot(): EditorSnapshot | null {
  const value = readJson(EDITOR_KEY);
  if (!isRecord(value) || typeof value.script !== 'string') return null;
  if (value.name != null && typeof value.name !== 'string') return null;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;
  return { script: value.script, name };
}

export function saveEditorSnapshot(snapshot: EditorSnapshot): void {
  writeJson(EDITOR_KEY, snapshot);
}

export const browserEditorRepository: EditorRepository = {
  load: loadEditorSnapshot,
  save: saveEditorSnapshot,
};
