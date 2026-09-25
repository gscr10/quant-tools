import {
  registerLegendAction,
  registerWidgetAction,
} from '@luxalgo/vela/plugin';
import {
  nativeFavorite,
  scriptFavorite,
  type NativeIndicatorIdentity,
} from '../../domain/indicators.ts';
import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';

export interface IndicatorContributionActions {
  openManager(): void;
  toggleFavorites(): void;
  openScript(name: string, script: string, savedName?: string): void;
  openNativeInfo(name: string, nativeType: string): void;
  resolveNativeIndicator(id: string, title: string): NativeIndicatorIdentity | undefined;
  syncManager(): void;
}

export function registerIndicatorContributions(
  favorites: FavoriteServicePort,
  scripts: ScriptServicePort,
  actions: IndicatorContributionActions,
): () => void {
  const disposers = [
    registerWidgetAction({
      id: 'indicators',
      target: 'topbar',
      label: 'Indicators',
      icon: 'indicators',
      align: 'left',
      run: () => actions.openManager(),
    }),
    registerWidgetAction({
      id: 'quant-favorites',
      target: 'topbar',
      label: 'Favorite indicators',
      icon: 'quant-favorite-caret',
      iconOnly: true,
      align: 'left',
      run: () => actions.toggleFavorites(),
    }),
    registerLegendAction({
      id: 'quant-favorite-indicator',
      icon: 'quant-star',
      tooltip: 'Add or remove favorite',
      order: -20,
      run: (context, indicator) => {
        if (indicator.source) {
          const favorite = scriptFavorite(indicator.title, indicator.source);
          const enabled = favorites.toggle(favorite);
          actions.syncManager();
          context.toast(enabled ? 'Added to favorites' : 'Removed from favorites', 'success');
          return;
        }
        const native = actions.resolveNativeIndicator(indicator.id, indicator.title);
        if (!native) {
          context.toast('This indicator cannot be favorited', 'error');
          return;
        }
        const enabled = favorites.toggle(nativeFavorite(native.title, native.type));
        actions.syncManager();
        context.toast(enabled ? 'Added to favorites' : 'Removed from favorites', 'success');
      },
    }),
    registerLegendAction({
      id: 'quant-open-indicator-code',
      icon: 'quant-code',
      tooltip: 'Open indicator code',
      order: -19,
      run: (_context, indicator) => {
        if (indicator.source) {
          const savedName = scripts.list().find((script) => script.script === indicator.source)?.name;
          actions.openScript(indicator.title, indicator.source, savedName);
          return;
        }
        const native = actions.resolveNativeIndicator(indicator.id, indicator.title);
        if (native) {
          actions.openNativeInfo(indicator.title, native.type);
        }
      },
    }),
  ];

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    while (disposers.length > 0) disposers.pop()?.();
  };
}
