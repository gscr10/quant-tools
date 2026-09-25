import { getNativeIndicator } from '@luxalgo/vela/plugin';
import { makeButton } from '../../shared/dom.ts';
import { OverlayManager } from '../../shared/overlays.ts';

function formatNativeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function openNativeIndicatorInfo(
  overlays: OverlayManager,
  name: string,
  nativeType: string,
): void {
  overlays.closePopover();
  const descriptor = getNativeIndicator(nativeType);
  const defaults = descriptor?.defaultInputs() ?? {};
  const inputs = descriptor?.inputsSchema() ?? [];
  const lines = [
    '// Vela native indicator',
    `// Name: ${descriptor?.title ?? name}`,
    `// Type: ${nativeType}`,
    `// Pane: ${descriptor?.paneHint ?? 'unknown'}`,
    `// Overlay: ${descriptor?.overlay ?? 'unknown'}`,
    '',
    '// Native indicators run inside @luxalgo/vela and do not expose editable Pine source.',
    '// The locally installed component provides the following input contract:',
    ...(inputs.length > 0
      ? inputs.map((input) => `${input.key} = ${formatNativeValue(defaults[input.key])}`)
      : ['// No configurable inputs.']),
  ];

  const backdrop = document.createElement('div');
  backdrop.className = 'quant-dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'quant-dialog quant-source-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `${name} implementation`);

  const heading = document.createElement('div');
  heading.className = 'quant-dialog-heading';
  const title = document.createElement('strong');
  title.textContent = `${name} · implementation`;
  const close = makeButton('×', 'quant-dialog-close');
  close.setAttribute('aria-label', 'Close');
  heading.append(title, close);

  const notice = document.createElement('p');
  notice.className = 'quant-source-notice';
  notice.textContent = 'This is a Vela built-in. It has no editable Pine source; its local implementation contract is shown below.';
  const code = document.createElement('pre');
  code.className = 'quant-source-code';
  code.textContent = lines.join('\n');
  dialog.append(heading, notice, code);
  backdrop.appendChild(dialog);
  const dismiss = overlays.mountDialog(backdrop);

  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
  });
  requestAnimationFrame(() => close.focus());
}
