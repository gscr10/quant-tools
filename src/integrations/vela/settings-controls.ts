import { eventDismissedPopover, openSelectList, Popover, buildColorPicker, splitColor, combineColor } from '@luxalgo/vela/ui';
import { DARK_THEME } from '@luxalgo/vela';
import type { SettingsControlsPort } from '../../shared/settings-controls.ts';

/** Only the composition layer knows that Settings uses Vela's public UI kit. */
export const velaSettingsControls: SettingsControlsPort = {
  dismissedPopover: eventDismissedPopover,
  openSelect: openSelectList,
  openContent(trigger, content, placement) {
    const popover = new Popover({
      trigger, content, host: placement.host, boundary: placement.boundary,
      position: 'fixed', gap: 6, align: 'start', onClose: placement.onClose,
    });
    popover.show();
    return { el: popover.el, trigger, destroy: () => popover.destroy(), reposition: () => popover.reposition() };
  },
  colorPicker(value, host, onChange) {
    const style = getComputedStyle(host);
    const property = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const theme = {
      ...DARK_THEME,
      background: property('--quant-backtest-bg', DARK_THEME.background),
      textColor: property('--quant-backtest-fg', DARK_THEME.textColor),
      borderColor: property('--quant-backtest-border', DARK_THEME.borderColor),
    };
    const root = host.ownerDocument.createElement('div');
    let current = value;
    const render = (focusOpacity = false) => {
      const picker = buildColorPicker(current, theme, (next) => {
        current = next;
        onChange(next);
        decorate();
        // Custom colors append recent swatches after their change callback.
        queueMicrotask(decorate);
      }, { commit: 'release' });
      const track = picker.lastElementChild?.firstElementChild as HTMLElement;
      const decorate = () => {
        picker.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
          button.setAttribute('aria-label', `Color ${button.dataset.c ?? button.style.background}`);
        });
        picker.querySelector('input[type="color"]')?.setAttribute('aria-label', 'Custom color');
        track.setAttribute('aria-valuenow', String(Math.round(splitColor(current).alpha * 100)));
      };
      track.tabIndex = 0; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Opacity');
      track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
      track.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const color = splitColor(current);
        const direction = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1;
        const alpha = event.key === 'Home' ? 0 : event.key === 'End' ? 1
          : Math.max(0, Math.min(1, color.alpha + direction * (event.key.startsWith('Page') ? .1 : .01)));
        current = combineColor(color.hex6, alpha); onChange(current); render(true);
      });
      decorate(); root.replaceChildren(picker);
      if (focusOpacity) track.focus();
    };
    render(); return root;
  },
};
