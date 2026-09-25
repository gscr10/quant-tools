import type { ScriptRepository } from '../../domain/ports/script-repository.ts';
import type { SavedScript } from '../../domain/scripts.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { SCRIPTS_KEY } from './keys.ts';

export type { SavedScript } from '../../domain/scripts.ts';

function asSavedScript(value: unknown): SavedScript | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || typeof value.script !== 'string') return null;
  return {
    name,
    script: value.script,
    savedAt: typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : 0,
    ...(typeof value.favorite === 'boolean' ? { favorite: value.favorite } : {}),
  };
}

export function listScripts(): SavedScript[] {
  const value = readJson(SCRIPTS_KEY);
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  return value.flatMap((item) => {
    const script = asSavedScript(item);
    if (!script || names.has(script.name)) return [];
    names.add(script.name);
    return [script];
  });
}

export function saveScript(name: string, script: string): SavedScript[] {
  const scripts = listScripts();
  const previous = scripts.find((item) => item.name === name);
  const rest = scripts.filter((item) => item.name !== name);
  rest.unshift({
    name,
    script,
    savedAt: Date.now(),
    ...(previous?.favorite != null ? { favorite: previous.favorite } : {}),
  });
  writeJson(SCRIPTS_KEY, rest);
  return rest;
}

export function deleteScript(name: string): SavedScript[] {
  const next = listScripts().filter((item) => item.name !== name);
  writeJson(SCRIPTS_KEY, next);
  return next;
}

export function renameScript(oldName: string, newName: string, script?: string): SavedScript[] {
  const scripts = listScripts();
  const target = scripts.find((item) => item.name === oldName);
  if (!target) return scripts;
  const rest = scripts.filter((item) => item.name !== oldName && item.name !== newName);
  rest.unshift({
    ...target,
    name: newName,
    script: script ?? target.script,
    savedAt: Date.now(),
  });
  writeJson(SCRIPTS_KEY, rest);
  return rest;
}

export function toggleFavorite(name: string): SavedScript[] {
  const next = listScripts().map((item) =>
    item.name === name ? { ...item, favorite: !item.favorite } : item,
  );
  writeJson(SCRIPTS_KEY, next);
  return next;
}

export function isFavorite(name: string): boolean {
  return listScripts().some((item) => item.name === name && item.favorite);
}

export const browserScriptRepository: ScriptRepository = {
  list: listScripts,
  save: saveScript,
  delete: deleteScript,
  rename: renameScript,
  toggleFavorite,
  isFavorite,
};
