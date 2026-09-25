import { registerWidgetAction } from '@luxalgo/vela/plugin';

export function registerWorkspaceContributions(downloadScreenshot: () => void): () => void {
  return registerWidgetAction({
    id: 'screenshot',
    target: 'topbar',
    label: 'Screenshot',
    icon: 'quant-camera',
    iconOnly: true,
    run: downloadScreenshot,
  });
}
