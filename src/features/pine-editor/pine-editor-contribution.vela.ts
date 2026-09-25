import { registerSidePanel } from '@luxalgo/vela/plugin';
import type { PineEditorController } from './pine-editor-controller.ts';

export function registerPineEditorContribution(
  mount: (body: HTMLElement, headerSlot: HTMLElement) => PineEditorController,
  unmount: (controller: PineEditorController) => void,
): () => void {
  return registerSidePanel({
    id: 'quant-pine-editor',
    title: 'Pine editor',
    icon: 'quant-code',
    order: 20,
    width: 600,
    minWidth: 380,
    maxWidth: 960,
    resizable: true,
    mount: (_context, body, header) => {
      header.setTitle('');
      const controller = mount(body, header.slot);
      return {
        destroy: () => {
          controller.destroy();
          unmount(controller);
        },
      };
    },
  });
}
