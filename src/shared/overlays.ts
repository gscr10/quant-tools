import { makeButton } from './dom.ts';

export class OverlayManager {
  private activePopover: HTMLElement | null = null;
  private activeAnchor: HTMLElement | null = null;
  private readonly dialogs = new Set<HTMLElement>();

  get popover(): HTMLElement | null {
    return this.activePopover;
  }

  isPopover(className: string): boolean {
    return this.activePopover?.classList.contains(className) ?? false;
  }

  showPopover(anchor: HTMLElement, className: string): HTMLElement {
    this.closePopover();
    const doc = anchor.ownerDocument;
    const view = doc.defaultView ?? window;
    const popover = doc.createElement('div');
    popover.className = `quant-popover ${className}`;
    popover.setAttribute('role', 'menu');
    doc.body.appendChild(popover);
    const rect = anchor.getBoundingClientRect();
    const width = className.includes('template') ? 230 : 260;
    const left = Math.min(rect.left, view.innerWidth - width - 8);
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    anchor.setAttribute('aria-expanded', 'true');
    this.activePopover = popover;
    this.activeAnchor = anchor;
    return popover;
  }

  closePopover(): void {
    this.activePopover?.remove();
    this.activeAnchor?.setAttribute('aria-expanded', 'false');
    this.activePopover = null;
    this.activeAnchor = null;
  }

  mountDialog(backdrop: HTMLElement): () => void {
    backdrop.ownerDocument.body.appendChild(backdrop);
    this.dialogs.add(backdrop);
    let dismissed = false;
    return () => {
      if (dismissed) return;
      dismissed = true;
      this.dialogs.delete(backdrop);
      backdrop.remove();
    };
  }

  containsPopoverTarget(target: Node, anchors: Array<HTMLElement | null>): boolean {
    return Boolean(
      this.activePopover?.contains(target)
      || anchors.some((anchor) => anchor?.contains(target)),
    );
  }

  destroy(): void {
    this.closePopover();
    this.dialogs.forEach((dialog) => dialog.remove());
    this.dialogs.clear();
  }
}

export function appendPopoverTitle(popover: HTMLElement, text: string): void {
  const title = popover.ownerDocument.createElement('div');
  title.className = 'quant-popover-title';
  title.textContent = text;
  popover.appendChild(title);
}

export function appendPopoverItem(
  overlays: OverlayManager,
  popover: HTMLElement,
  label: string,
  action: (() => void) | null,
  hint?: string,
): void {
  const button = makeButton('', 'quant-popover-item');
  button.setAttribute('role', 'menuitem');
  const text = popover.ownerDocument.createElement('span');
  text.textContent = label;
  button.appendChild(text);
  if (hint) {
    const secondary = popover.ownerDocument.createElement('span');
    secondary.className = 'quant-popover-hint';
    secondary.textContent = hint;
    button.appendChild(secondary);
  }
  if (action) {
    button.addEventListener('click', () => {
      overlays.closePopover();
      action();
    });
  } else {
    button.disabled = true;
  }
  popover.appendChild(button);
}

export function appendPopoverSeparator(popover: HTMLElement): void {
  const separator = popover.ownerDocument.createElement('div');
  separator.className = 'quant-popover-separator';
  popover.appendChild(separator);
}
