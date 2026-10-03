import { registerSidePanel } from '@luxalgo/vela/plugin';

/** The side-panel contract kept deliberately structural so CodeMirror can be
 * loaded only when the user opens Pine Editor. */
export interface PineEditorController {
  destroy(): void;
  openSavedScript(name: string, source: string): void;
  openIndicatorSource(name: string, source: string): void;
  openNewScript(): void;
  detachDeletedScript(name: string): void;
  log(level: 'info' | 'ok' | 'error', message: string): void;
  reportError(error: Error, source?: string): void;
}

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
