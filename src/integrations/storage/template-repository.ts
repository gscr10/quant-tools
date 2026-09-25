import type { TemplateRepository } from '../../domain/ports/template-repository.ts';
import type { WorkspaceTemplate } from '../../domain/templates.ts';
import { isRecord, readJson, writeJson } from './json-store.ts';
import { WORKSPACE_TEMPLATES_KEY } from './keys.ts';

export type { WorkspaceTemplate } from '../../domain/templates.ts';

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
  const value = readJson(WORKSPACE_TEMPLATES_KEY);
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
  writeJson(WORKSPACE_TEMPLATES_KEY, next);
  return next;
}

export function deleteWorkspaceTemplate(name: string): WorkspaceTemplate[] {
  const next = listWorkspaceTemplates().filter((item) => item.name !== name);
  writeJson(WORKSPACE_TEMPLATES_KEY, next);
  return next;
}

export const browserTemplateRepository: TemplateRepository = {
  list: listWorkspaceTemplates,
  save: saveWorkspaceTemplate,
  delete: deleteWorkspaceTemplate,
};
