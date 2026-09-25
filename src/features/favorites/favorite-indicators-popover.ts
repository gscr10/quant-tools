import type { IndicatorFavorite } from '../../domain/indicators.ts';
import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import {
  appendPopoverItem,
  appendPopoverTitle,
  OverlayManager,
} from '../../shared/overlays.ts';

export class FavoriteIndicatorsPopover {
  constructor(
    private readonly favorites: FavoriteServicePort,
    private readonly overlays: OverlayManager,
    private readonly addToChart: (favorite: IndicatorFavorite) => void,
  ) {}

  toggle(anchor: HTMLElement): void {
    if (this.overlays.isPopover('favorite-indicators-popover')) {
      this.overlays.closePopover();
      return;
    }
    const popover = this.overlays.showPopover(anchor, 'favorite-indicators-popover');
    appendPopoverTitle(popover, 'Favorite indicators');
    const favorites = this.favorites.list();
    if (favorites.length === 0) {
      const empty = popover.ownerDocument.createElement('div');
      empty.className = 'quant-popover-empty';
      empty.textContent = 'No favorites yet — star any indicator.';
      popover.appendChild(empty);
      return;
    }
    favorites.forEach((favorite) => {
      appendPopoverItem(
        this.overlays,
        popover,
        favorite.name,
        () => this.addToChart(favorite),
      );
    });
  }
}
