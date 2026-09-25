import { registerIcon, svg16 } from '@luxalgo/vela/ui';

export function registerAppIcons(): void {
  registerIcon('quant-favorite-caret', svg16('<path d="M3.5 6 8 10.5 12.5 6"/>'));
  registerIcon(
    'quant-template',
    svg16('<path d="M3.6 1.8h8.8v12.4L8 11.1l-4.4 3.1Z" stroke-linecap="round" stroke-linejoin="round"/>'),
  );
  registerIcon(
    'quant-code',
    svg16('<path d="m5.5 4.5-4 3.5 4 3.5M10.5 4.5l4 3.5-4 3.5"/>'),
  );
  registerIcon(
    'quant-star',
    svg16('<path d="m8 1.6 1.8 3.7 4.1.6-3 2.9.7 4.1L8 11l-3.6 1.9.7-4.1-3-2.9 4.1-.6Z"/>'),
  );
  registerIcon(
    'quant-camera',
    svg16('<path d="M5.5 4 6.5 2.5h3L10.5 4h3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><circle cx="8" cy="8.5" r="2.6"/>'),
  );
}
