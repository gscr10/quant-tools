import type { IndicatorFavorite } from '../domain/indicators.ts';
import type { WorkspacePort } from '../domain/ports/workspace-port.ts';
import { FavoriteIndicatorsPopover } from '../features/favorites/favorite-indicators-popover.ts';
import { FavoriteService } from '../features/favorites/favorite-service.ts';
import {
  registerIndicatorContributions,
} from '../features/indicators/indicator-contributions.vela.ts';
import { IndicatorManagerDialog } from '../features/indicators/indicator-manager.vela.ts';
import { openNativeIndicatorInfo } from '../features/indicators/native-indicator-info.vela.ts';
import { PineEditorController } from '../features/pine-editor/pine-editor-controller.ts';
import { registerPineEditorContribution } from '../features/pine-editor/pine-editor-contribution.vela.ts';
import { ScriptService } from '../features/pine-editor/script-service.ts';
import { registerTemplateContribution } from '../features/workspace-templates/template-contribution.vela.ts';
import { WorkspaceTemplatesFeature } from '../features/workspace-templates/workspace-templates.ts';
import { browserEditorRepository } from '../integrations/storage/editor-repository.ts';
import { browserFavoriteRepository } from '../integrations/storage/favorite-repository.ts';
import { browserScriptRepository } from '../integrations/storage/script-repository.ts';
import { browserTemplateRepository } from '../integrations/storage/template-repository.ts';
import {
  createWorkspace,
  type QuantWorkspace,
} from '../integrations/vela/create-workspace.ts';
import { registerExternalIndicatorPersistence } from '../integrations/vela/external-indicator-persistence.ts';
import { registerWorkspaceContributions } from '../integrations/vela/workspace-contributions.ts';
import { bindWorkspaceEvents } from '../integrations/vela/workspace-events.ts';
import { VelaWorkspaceAdapter } from '../integrations/vela/workspace-adapter.ts';
import { OverlayManager } from '../shared/overlays.ts';
import { DisposerStack } from './lifecycle.ts';
import { registerAppIcons } from './register-icons.vela.ts';

export interface QuantApp {
  readonly workspace: WorkspacePort;
  destroy(): void;
}

export function createApp(container: HTMLElement | string): QuantApp {
  const lifetime = new DisposerStack();
  const overlays = new OverlayManager();
  lifetime.add(() => overlays.destroy());
  const favorites = new FavoriteService(browserFavoriteRepository, browserScriptRepository);
  lifetime.add(() => favorites.destroy());
  const scripts = new ScriptService(browserScriptRepository, favorites);
  lifetime.add(() => scripts.destroy());

  let workspaceRef: QuantWorkspace | null = null;
  let workspaceAdapter: WorkspacePort | null = null;
  let editor: PineEditorController | null = null;
  let indicatorManager: IndicatorManagerDialog | null = null;

  const getWorkspacePort = (): WorkspacePort => {
    if (!workspaceAdapter) throw new Error('Workspace adapter is not ready');
    return workspaceAdapter;
  };

  const openScript = (name: string, script: string, savedName?: string) => {
    getWorkspacePort().openPanel('quant-pine-editor');
    requestAnimationFrame(() => {
      if (savedName) editor?.openSavedScript(savedName, script);
      else editor?.openIndicatorSource(name, script);
    });
  };

  const openNewScript = () => {
    getWorkspacePort().openPanel('quant-pine-editor');
    requestAnimationFrame(() => editor?.openNewScript());
  };

  const addFavoriteToActiveChart = (favorite: IndicatorFavorite) => {
    if (favorite.kind === 'native') {
      getWorkspacePort().addNativeIndicator(favorite.nativeType);
    } else {
      getWorkspacePort().addScriptIndicator(
        favorite.name,
        favorite.script,
        favorite.language ?? 'pine',
      );
    }
  };

  const favoritePopover = new FavoriteIndicatorsPopover(
    favorites,
    overlays,
    addFavoriteToActiveChart,
  );
  const templates = new WorkspaceTemplatesFeature({
    getState: () => getWorkspacePort().getState(),
    applyState: (state) => getWorkspacePort().applyState(state),
    toast: (message, kind) => getWorkspacePort().toast(message, kind),
  }, browserTemplateRepository, overlays);

  try {
    registerAppIcons();
    lifetime.add(registerIndicatorContributions(favorites, scripts, {
      openManager: () => indicatorManager?.open(),
      toggleFavorites: () => {
        const anchor = getWorkspacePort().root.ownerDocument
          .getElementById('vela-action-quant-favorites');
        if (anchor) favoritePopover.toggle(anchor);
      },
      openScript,
      openNativeInfo: (name, nativeType) => {
        openNativeIndicatorInfo(overlays, name, nativeType);
      },
      resolveNativeIndicator: (id, title) => getWorkspacePort().resolveNativeIndicator(id, title),
      syncManager: () => indicatorManager?.sync(),
    }));
    lifetime.add(registerTemplateContribution(() => {
      const anchor = getWorkspacePort().root.ownerDocument
        .getElementById('vela-action-quant-templates');
      if (anchor) templates.togglePopover(anchor);
    }));
    lifetime.add(registerWorkspaceContributions(() => {
      getWorkspacePort().downloadScreenshot();
    }));
    lifetime.add(registerExternalIndicatorPersistence(() => workspaceRef));
    lifetime.add(registerPineEditorContribution(
      (body, headerSlot) => {
        const controller = new PineEditorController(
          body,
          headerSlot,
          scripts,
          browserEditorRepository,
          overlays,
          {
            runIndicator: (name, source) => {
              getWorkspacePort().addScriptIndicator(name, source);
            },
          },
        );
        editor = controller;
        return controller;
      },
      (controller) => {
        if (editor === controller) editor = null;
      },
    ));

    const workspace = createWorkspace(container);
    workspaceRef = workspace;
    const workspacePort = new VelaWorkspaceAdapter(workspace);
    workspaceAdapter = workspacePort;
    lifetime.add(() => {
      try {
        workspace.destroy();
      } finally {
        workspaceRef = null;
        workspaceAdapter = null;
        editor = null;
      }
    });

    indicatorManager = new IndicatorManagerDialog(
      workspacePort,
      scripts,
      favorites,
      overlays,
      {
        openScript,
        openNewScript,
        onScriptDeleted: (name) => editor?.detachDeletedScript(name),
      },
    );
    lifetime.add(() => {
      indicatorManager?.destroy();
      indicatorManager = null;
    });

    let managerSyncQueued = false;
    const scheduleManagerSync = () => {
      if (managerSyncQueued) return;
      managerSyncQueued = true;
      queueMicrotask(() => {
        managerSyncQueued = false;
        indicatorManager?.sync();
      });
    };
    lifetime.add(scripts.subscribe(scheduleManagerSync));
    lifetime.add(favorites.subscribe(scheduleManagerSync));
    lifetime.add(bindWorkspaceEvents(workspace, {
      syncIndicators: () => indicatorManager?.sync(),
      logEditor: (level, message) => editor?.log(level, message),
      reportEditorError: (error, source) => editor?.reportError(error, source),
    }));

    const doc = workspace.root.ownerDocument;
    const view = doc.defaultView ?? window;
    const favoriteAnchor = () => doc.getElementById('vela-action-quant-favorites');
    const templateAnchor = () => doc.getElementById('vela-action-quant-templates');
    const syncCustomActionA11y = () => {
      const anchor = favoriteAnchor();
      if (!anchor) return;
      anchor.setAttribute('aria-haspopup', 'menu');
      if (!anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'false');
    };
    syncCustomActionA11y();
    const actionObserver = new view.MutationObserver(syncCustomActionA11y);
    actionObserver.observe(workspace.root, { childList: true, subtree: true });

    const closePopoverOnOutsidePress = (event: PointerEvent) => {
      if (!overlays.popover) return;
      const target = event.target as Node;
      if (overlays.containsPopoverTarget(target, [favoriteAnchor(), templateAnchor()])) return;
      overlays.closePopover();
    };
    const closePopoverOnResize = () => overlays.closePopover();
    doc.addEventListener('pointerdown', closePopoverOnOutsidePress);
    view.addEventListener('resize', closePopoverOnResize);
    lifetime.add(() => {
      doc.removeEventListener('pointerdown', closePopoverOnOutsidePress);
      view.removeEventListener('resize', closePopoverOnResize);
      actionObserver.disconnect();
    });

    const chartMaximized = new URLSearchParams(view.location.search).get('chart') === 'maximized';
    if (chartMaximized) {
      doc.body.classList.add('chart-maximized');
      lifetime.add(() => doc.body.classList.remove('chart-maximized'));
    }

    return {
      workspace: workspacePort,
      destroy: () => lifetime.dispose(),
    };
  } catch (error) {
    try {
      lifetime.dispose();
    } catch (cleanupError) {
      console.error('[quant-tools] cleanup after initialization failure failed', cleanupError);
    }
    throw error;
  }
}
