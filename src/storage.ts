const SCRIPTS_KEY = 'vela-pine:scripts:v1';
const EDITOR_KEY = 'vela-pine:editor:v1';
const LAYOUT_KEY = 'vela-pine:layout:v1';
const INDICATOR_FAVORITES_KEY = 'vela-pine:indicator-favorites:v1';
const WORKSPACE_TEMPLATES_KEY = 'vela-pine:workspace-templates:v1';
const memoryStore = new Map<string, string>();

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

export type IndicatorFavorite = {
  key: string;
  name: string;
  savedAt: number;
} & (
  | { kind: 'native'; nativeType: string }
  | { kind: 'script'; script: string; language?: string }
);

export interface WorkspaceTemplate {
  name: string;
  state: unknown;
  savedAt: number;
}

function read(key: string): unknown {
  try {
    const raw = memoryStore.get(key) ?? localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  try {
    localStorage.setItem(key, serialized);
    memoryStore.delete(key);
  } catch {
    // Storage may be full or unavailable. The in-memory copy keeps this session usable.
    memoryStore.set(key, serialized);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

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
  const value = read(SCRIPTS_KEY);
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
  const prev = scripts.find((s) => s.name === name);
  const all = scripts.filter((s) => s.name !== name);
  all.unshift({
    name,
    script,
    savedAt: Date.now(),
    ...(prev?.favorite != null ? { favorite: prev.favorite } : {}),
  });
  write(SCRIPTS_KEY, all);
  return all;
}

export function deleteScript(name: string): SavedScript[] {
  const all = listScripts().filter((s) => s.name !== name);
  write(SCRIPTS_KEY, all);
  return all;
}

export function renameScript(oldName: string, newName: string, script?: string): SavedScript[] {
  const all = listScripts();
  const target = all.find((s) => s.name === oldName);
  if (!target) return all;
  const rest = all.filter((s) => s.name !== oldName && s.name !== newName);
  rest.unshift({
    ...target,
    name: newName,
    script: script ?? target.script,
    savedAt: Date.now(),
  });
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
  const value = read(EDITOR_KEY);
  if (!isRecord(value) || typeof value.script !== 'string') return null;
  if (value.name != null && typeof value.name !== 'string') return null;
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;
  return { script: value.script, name };
}

export function saveEditorSnapshot(snapshot: EditorSnapshot) {
  write(EDITOR_KEY, snapshot);
}

export function loadLayout(): LayoutItem[] {
  const value = read(LAYOUT_KEY);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.source !== 'string' || !item.source.trim()) return [];
    return [{
      source: item.source,
      visible: item.visible !== false,
      savedName: typeof item.savedName === 'string' && item.savedName.trim()
        ? item.savedName.trim()
        : null,
    }];
  });
}

export function saveLayout(items: LayoutItem[]) {
  write(LAYOUT_KEY, items);
}

function asIndicatorFavorite(value: unknown): IndicatorFavorite | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === 'string' ? value.key.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
    ? value.savedAt
    : 0;
  if (!key || !name) return null;
  if (value.kind === 'native' && typeof value.nativeType === 'string' && value.nativeType.trim()) {
    return { key, name, savedAt, kind: 'native', nativeType: value.nativeType.trim() };
  }
  if (value.kind === 'script' && typeof value.script === 'string' && value.script.trim()) {
    return {
      key,
      name,
      savedAt,
      kind: 'script',
      script: value.script,
      ...(typeof value.language === 'string' && value.language.trim()
        ? { language: value.language.trim() }
        : {}),
    };
  }
  return null;
}

export function listIndicatorFavorites(): IndicatorFavorite[] {
  const value = read(INDICATOR_FAVORITES_KEY);
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  return value.flatMap((item) => {
    const favorite = asIndicatorFavorite(item);
    if (!favorite || keys.has(favorite.key)) return [];
    keys.add(favorite.key);
    return [favorite];
  });
}

export function toggleIndicatorFavorite(favorite: IndicatorFavorite): IndicatorFavorite[] {
  const normalized = asIndicatorFavorite(favorite);
  if (!normalized) return listIndicatorFavorites();
  const current = listIndicatorFavorites();
  const exists = current.some((item) => item.key === normalized.key);
  const next = exists
    ? current.filter((item) => item.key !== normalized.key)
    : [{ ...normalized, savedAt: Date.now() }, ...current];
  write(INDICATOR_FAVORITES_KEY, next);
  return next;
}

function asWorkspaceTemplate(value: unknown): WorkspaceTemplate | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || !('state' in value)) return null;
  return {
    name,
    state: value.state,
    savedAt: typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)
      ? value.savedAt
      : 0,
  };
}

export function listWorkspaceTemplates(): WorkspaceTemplate[] {
  const value = read(WORKSPACE_TEMPLATES_KEY);
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  return value.flatMap((item) => {
    const template = asWorkspaceTemplate(item);
    if (!template || names.has(template.name)) return [];
    names.add(template.name);
    return [template];
  });
}

export function saveWorkspaceTemplate(name: string, state: unknown): WorkspaceTemplate[] {
  const normalized = name.trim();
  if (!normalized) return listWorkspaceTemplates();
  const rest = listWorkspaceTemplates().filter((item) => item.name !== normalized);
  const next = [{ name: normalized, state, savedAt: Date.now() }, ...rest];
  write(WORKSPACE_TEMPLATES_KEY, next);
  return next;
}

export function deleteWorkspaceTemplate(name: string): WorkspaceTemplate[] {
  const next = listWorkspaceTemplates().filter((item) => item.name !== name);
  write(WORKSPACE_TEMPLATES_KEY, next);
  return next;
}
