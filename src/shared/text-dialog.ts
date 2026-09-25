import { makeButton } from './dom.ts';
import { OverlayManager } from './overlays.ts';

export type TextDialogOptions = {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => string | null;
};

export function openTextDialog(
  overlays: OverlayManager,
  options: TextDialogOptions,
): () => void {
  overlays.closePopover();
  const backdrop = document.createElement('div');
  backdrop.className = 'quant-dialog-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'quant-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', options.title);

  const heading = document.createElement('div');
  heading.className = 'quant-dialog-heading';
  const title = document.createElement('strong');
  title.textContent = options.title;
  const close = makeButton('×', 'quant-dialog-close');
  close.setAttribute('aria-label', '关闭');
  heading.append(title, close);

  const label = document.createElement('label');
  label.className = 'quant-field-label';
  label.textContent = options.label;
  const input = document.createElement('input');
  input.className = 'quant-field-input';
  input.value = options.initialValue ?? '';
  input.maxLength = 80;
  label.appendChild(input);
  const error = document.createElement('div');
  error.className = 'quant-field-error';

  const actions = document.createElement('div');
  actions.className = 'quant-dialog-actions';
  const cancel = makeButton('取消', 'quant-secondary-button');
  const confirm = makeButton(options.confirmLabel ?? '保存', 'quant-primary-button');
  actions.append(cancel, confirm);
  dialog.append(heading, label, error, actions);
  backdrop.appendChild(dialog);
  const dismiss = overlays.mountDialog(backdrop);

  const submit = () => {
    const value = input.value.trim();
    const message = options.onConfirm(value);
    if (message) {
      error.textContent = message;
      input.focus();
      return;
    }
    dismiss();
  };
  close.addEventListener('click', dismiss);
  cancel.addEventListener('click', dismiss);
  confirm.addEventListener('click', submit);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });
  input.addEventListener('input', () => { error.textContent = ''; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
    if (event.key === 'Escape') dismiss();
  });
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return dismiss;
}
