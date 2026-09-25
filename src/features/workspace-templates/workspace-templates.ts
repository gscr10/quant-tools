import type { TemplateRepository } from '../../domain/ports/template-repository.ts';
import { formatTime, makeButton } from '../../shared/dom.ts';
import {
  appendPopoverItem,
  appendPopoverSeparator,
  appendPopoverTitle,
  OverlayManager,
} from '../../shared/overlays.ts';
import { openTextDialog } from '../../shared/text-dialog.ts';

export interface WorkspaceTemplateHost {
  getState(): unknown;
  applyState(state: unknown): void;
  toast(message: string, kind?: 'info' | 'success' | 'error'): void;
}

export class WorkspaceTemplatesFeature {
  constructor(
    private readonly host: WorkspaceTemplateHost,
    private readonly templates: TemplateRepository,
    private readonly overlays: OverlayManager,
  ) {}

  togglePopover(anchor: HTMLElement): void {
    if (this.overlays.isPopover('template-popover')) {
      this.overlays.closePopover();
      return;
    }
    const popover = this.overlays.showPopover(anchor, 'template-popover');
    appendPopoverTitle(popover, 'Recent templates');
    const templates = this.templates.list().slice(0, 5);
    if (templates.length === 0) {
      appendPopoverItem(this.overlays, popover, 'No templates yet', null);
    }
    templates.forEach((template) => {
      appendPopoverItem(
        this.overlays,
        popover,
        template.name,
        () => this.apply(template.name, template.state),
      );
    });
    appendPopoverSeparator(popover);
    appendPopoverItem(this.overlays, popover, 'Show all', () => this.showAllDialog());
    appendPopoverItem(this.overlays, popover, 'New template', () => this.saveCurrent());
  }

  saveCurrent(): void {
    openTextDialog(this.overlays, {
      title: 'New template',
      label: 'Template name',
      onConfirm: (name) => {
        if (!name) return '请输入模板名称';
        if (this.templates.list().some((item) => item.name === name)) {
          return `模板「${name}」已存在`;
        }
        this.templates.save(name, this.host.getState());
        this.host.toast(`Template “${name}” saved`, 'success');
        return null;
      },
    });
  }

  showAllDialog(): void {
    this.overlays.closePopover();
    const backdrop = document.createElement('div');
    backdrop.className = 'quant-dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'quant-dialog quant-template-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Indicator Templates');
    const heading = document.createElement('div');
    heading.className = 'quant-dialog-heading';
    const title = document.createElement('strong');
    title.textContent = 'Indicator Templates';
    const close = makeButton('×', 'quant-dialog-close');
    close.setAttribute('aria-label', '关闭');
    heading.append(title, close);
    const list = document.createElement('div');
    list.className = 'quant-template-list';
    dialog.append(heading, list);
    backdrop.appendChild(dialog);
    const dismiss = this.overlays.mountDialog(backdrop);

    const render = () => {
      list.replaceChildren();
      const templates = this.templates.list();
      if (templates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'quant-template-empty';
        empty.textContent = 'No templates yet';
        list.appendChild(empty);
        return;
      }
      templates.forEach((template) => {
        const row = document.createElement('div');
        row.className = 'quant-template-row';
        const info = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = template.name;
        const time = document.createElement('span');
        time.textContent = formatTime(template.savedAt);
        info.append(name, time);
        const rowActions = document.createElement('div');
        const apply = makeButton('Apply', 'quant-primary-button compact');
        const remove = makeButton('Delete', 'quant-danger-button compact');
        apply.addEventListener('click', () => {
          dismiss();
          this.apply(template.name, template.state);
        });
        remove.addEventListener('click', () => {
          this.templates.delete(template.name);
          render();
        });
        rowActions.append(apply, remove);
        row.append(info, rowActions);
        list.appendChild(row);
      });
    };
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) dismiss();
    });
    render();
  }

  private apply(name: string, state: unknown): void {
    this.host.applyState(state);
    this.host.toast(`Template “${name}” applied`, 'success');
  }
}
