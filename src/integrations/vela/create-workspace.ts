import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PLATFORM_INDICATORS } from '../../config/platform-indicators.ts';
import { WORKSPACE_DEFAULTS, WORKSPACE_TOPBAR } from '../../config/workspace-options.ts';
import { createPineEngine } from '../pinets/create-engine.ts';
import { createWorkspaceProviders } from './provider-registry.ts';

export const WORKSPACE_STORAGE_KEY = 'quant-tools:workspace:v2';
export type QuantWorkspace = VelaWorkspace;

export function createWorkspace(container: HTMLElement | string): VelaWorkspace {
  return new VelaWorkspace(container, {
    ...WORKSPACE_DEFAULTS,
    providers: createWorkspaceProviders(),
    engines: { pine: createPineEngine },
    indicators: PLATFORM_INDICATORS,
    topbar: WORKSPACE_TOPBAR,
    drawingToolbar: true,
    persist: WORKSPACE_STORAGE_KEY,
    autofocus: true,
  });
}
