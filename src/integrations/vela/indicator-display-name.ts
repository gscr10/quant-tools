import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { extractPineTitle } from '../../domain/pine-source.ts';

/** Resolve the same name as On chart, including user-assigned library names. */
export function resolveScriptIndicatorName(
  workspace: Pick<VelaWorkspace, 'cells'>,
  id: string,
  title: string,
  source: string,
): string {
  for (const cell of workspace.cells()) {
    const instance = cell.instances.find((item) =>
      item.handle?.id === id && item.entry.script === source);
    // Vela's onChartRows() projects this entry.name. The handle title can
    // remain "Indicator" even after the visible legend has its real title.
    if (instance?.entry.name.trim()) return instance.entry.name;
  }
  // Raw chart additions do not have a Workspace instance. Keep their explicit
  // engine title, or use the existing Pine declaration fallback.
  return title.trim() && title !== 'Indicator' ? title : extractPineTitle(source);
}
