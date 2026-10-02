import { registerWidgetAction } from '@luxalgo/vela/plugin';
import { BUILD_COMMIT } from '../../config/build-version.ts';

export function registerWorkspaceContributions(downloadScreenshot: () => void): () => void {
  const disposers = [
    registerWidgetAction({
      id: 'quant-build-version',
      target: 'topbar',
      label: BUILD_COMMIT,
      align: 'right',
      order: -100,
      // The commit label is intentionally informational. Keeping it as a
      // widget action lets Vela place it in the same stable topbar cluster as
      // the native panel and screenshot tools.
      run: () => {},
    }),
    registerWidgetAction({
      id: 'screenshot',
      target: 'topbar',
      label: 'Screenshot',
      icon: 'quant-camera',
      iconOnly: true,
      run: downloadScreenshot,
    }),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
