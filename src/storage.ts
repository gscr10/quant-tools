const SCRIPTS_KEY = 'vela-pine:scripts:v1';
const EDITOR_KEY = 'vela-pine:editor:v1';
const LAYOUT_KEY = 'vela-pine:layout:v1';

export interface SavedScript {
  name: string;
  script: string;
  savedAt: number;
  favorite?: boolean;
}

export interface EditorSnapshot {
  script: string;
  name: string | null;
}

export interface LayoutItem {
  source: string;
  visible: boolean;
  savedName?: string | null;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: keep in-memory behavior
  }
}

export function listScripts(): SavedScript[] {
  return read<SavedScript[]>(SCRIPTS_KEY) ?? [];
}

export function saveScript(name: string, script: string): SavedScript[] {
  const prev = listScripts().find((s) => s.name === name);
  const all = listScripts().filter((s) => s.name !== name);
  all.unshift({ name, script, savedAt: Date.now(), favorite: prev?.favorite });
  write(SCRIPTS_KEY, all);
  return all;
}

export function deleteScript(name: string): SavedScript[] {
  const all = listScripts().filter((s) => s.name !== name);
  write(SCRIPTS_KEY, all);
  return all;
}

export function renameScript(oldName: string, newName: string): SavedScript[] {
  const all = listScripts();
  const target = all.find((s) => s.name === oldName);
  if (!target) return all;
  const rest = all.filter((s) => s.name !== oldName && s.name !== newName);
  rest.unshift({ ...target, name: newName });
  write(SCRIPTS_KEY, rest);
  return rest;
}

export function toggleFavorite(name: string): SavedScript[] {
  const all = listScripts().map((s) =>
    s.name === name ? { ...s, favorite: !s.favorite } : s,
  );
  write(SCRIPTS_KEY, all);
  return all;
}

export function isFavorite(name: string): boolean {
  return listScripts().some((s) => s.name === name && s.favorite);
}

export function loadEditorSnapshot(): EditorSnapshot | null {
  return read<EditorSnapshot>(EDITOR_KEY);
}

export function saveEditorSnapshot(snapshot: EditorSnapshot) {
  write(EDITOR_KEY, snapshot);
}

export function loadLayout(): LayoutItem[] {
  return read<LayoutItem[]>(LAYOUT_KEY) ?? [];
}

export function saveLayout(items: LayoutItem[]) {
  write(LAYOUT_KEY, items);
}
