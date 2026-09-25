import { registerStatePersistence } from '@luxalgo/vela/plugin';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { isRecord } from '../../shared/guards.ts';

export const EXTERNAL_INDICATORS_KEY = 'quant-tools.external-indicators';

export type PersistedExternalIndicator = {
  name: string;
  script: string;
  language?: string;
  id?: string;
  hidden?: boolean;
  inputs?: Record<string, string | number | boolean>;
  props?: Record<string, string | number | boolean>;
};

function parseInputRecord(value: unknown): Record<string, string | number | boolean> | null {
  if (!isRecord(value)) return null;
  const parsed: Record<string, string | number | boolean> = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === 'string' || typeof entry === 'boolean') parsed[key] = entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) parsed[key] = entry;
  });
  return parsed;
}

export function parsePersistedExternalIndicators(value: unknown): PersistedExternalIndicator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || typeof item.script !== 'string' || !item.script.trim()) return [];
    const inputs = parseInputRecord(item.inputs);
    const props = parseInputRecord(item.props);
    return [{
      name,
      script: item.script,
      ...(typeof item.language === 'string' && item.language.trim() ? { language: item.language } : {}),
      ...(typeof item.id === 'string' && item.id.trim() ? { id: item.id } : {}),
      ...(typeof item.hidden === 'boolean' ? { hidden: item.hidden } : {}),
      ...(inputs ? { inputs } : {}),
      ...(props ? { props } : {}),
    }];
  });
}

export function registerExternalIndicatorPersistence(
  getWorkspace: () => VelaWorkspace | null,
): () => void {
  return registerStatePersistence({
    key: EXTERNAL_INDICATORS_KEY,
    scope: 'cell',
    serialize: (context) => {
      const cell = getWorkspace()?.cell(context.cellId);
      if (!cell) return [];
      return cell.instances.flatMap((instance) => {
        if (!instance.external) return [];
        return [{
          name: instance.entry.name,
          script: instance.entry.script,
          ...(instance.entry.language ? { language: instance.entry.language } : {}),
          ...(instance.id ? { id: instance.id } : {}),
          ...(instance.handle ? { hidden: !instance.handle.visible } : {}),
          ...(instance.values?.inputs ? { inputs: instance.values.inputs } : {}),
          ...(instance.values?.props ? { props: instance.values.props } : {}),
        }];
      });
    },
    restore: (payload, context) => {
      parsePersistedExternalIndicators(payload).forEach((entry) => context.addIndicator(entry));
    },
  });
}
