import type { EditorRepository } from '../../domain/ports/editor-repository.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';
import type { OverlayManager } from '../../shared/overlays.ts';
import type { PineEditorHost } from './pine-editor-controller.ts';
import type { PineEditorController } from './pine-editor-contribution.vela.ts';

type Action = (controller: PineEditorController) => void;

interface LazyDependencies {
  scripts: ScriptServicePort;
  editorRepository: EditorRepository;
  overlays: OverlayManager;
  host: PineEditorHost;
}

/**
 * CodeMirror is a sizeable optional feature. Keep the public editor contract
 * synchronous for Vela, while the implementation is imported only after the
 * side panel is actually mounted. Actions issued during the import window are
 * replayed in order; destroy cancels both the replay and the late mount.
 */
export function createLazyPineEditorController(
  body: HTMLElement,
  headerSlot: HTMLElement,
  dependencies: LazyDependencies,
): PineEditorController {
  let disposed = false;
  let inner: PineEditorController | null = null;
  let loadStarted = false;
  const pending: Action[] = [];
  const visibilityRoot = body.parentElement ?? body;
  body.classList.add('quant-pine-body-loading');
  body.setAttribute('role', 'status');
  body.setAttribute('aria-live', 'polite');
  body.textContent = 'Loading Pine editor…';

  const load = (): void => {
    if (disposed || loadStarted) return;
    loadStarted = true;
    void import('./pine-editor-controller.ts').then(({ PineEditorController: Controller }) => {
      if (disposed) return;
      body.replaceChildren();
      body.classList.remove('quant-pine-body-loading');
      body.removeAttribute('role');
      body.removeAttribute('aria-live');
      inner = new Controller(
        body,
        headerSlot,
        dependencies.scripts,
        dependencies.editorRepository,
        dependencies.overlays,
        dependencies.host,
      );
      for (const action of pending.splice(0)) action(inner);
    }).catch((error) => {
      if (disposed) return;
      loadStarted = false;
      body.classList.remove('quant-pine-body-loading');
      body.setAttribute('role', 'alert');
      body.setAttribute('aria-live', 'assertive');
      body.textContent = 'Pine editor failed to load. Close and reopen the panel to retry.';
      console.warn('[quant-tools] Pine editor lazy load failed', error);
      pending.length = 0;
    });
  };

  const panelIsVisible = (): boolean => {
    if (!body.isConnected) return false;
    const style = window.getComputedStyle(body);
    return style.display !== 'none' && style.visibility !== 'hidden'
      && body.getClientRects().length > 0;
  };
  const visibilityObserver = new MutationObserver(() => {
    if (panelIsVisible()) load();
  });
  visibilityObserver.observe(visibilityRoot, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'],
    subtree: true,
  });
  // If Vela mounts an already-visible panel, do not wait for an attribute
  // mutation; hidden panels still remain outside the initial module graph.
  queueMicrotask(() => { if (panelIsVisible()) load(); });

  const enqueue = (action: Action, start = false): void => {
    if (disposed) return;
    if (start) load();
    if (inner) action(inner);
    else pending.push(action);
  };

  return {
    destroy(): void {
      if (disposed) return;
      disposed = true;
      visibilityObserver.disconnect();
      pending.length = 0;
      // If the chunk already resolved, destroy the concrete controller now;
      // if it has not, the import callback observes `disposed` and never
      // mounts one. Capturing before clearing prevents a late `then()` from
      // losing the live CodeMirror instance and leaking its listeners.
      const controller = inner;
      inner = null;
      controller?.destroy();
    },
    openSavedScript(name, source): void {
      enqueue(controller => controller.openSavedScript(name, source), true);
    },
    openIndicatorSource(name, source): void {
      enqueue(controller => controller.openIndicatorSource(name, source), true);
    },
    openNewScript(): void {
      enqueue(controller => controller.openNewScript(), true);
    },
    detachDeletedScript(name): void {
      enqueue(controller => controller.detachDeletedScript(name));
    },
    log(level, message): void {
      enqueue(controller => controller.log(level, message));
    },
    reportError(error, source): void {
      enqueue(controller => controller.reportError(error, source));
    },
  };
}
