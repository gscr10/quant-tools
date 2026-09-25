import { Dialog, iconEl } from '@luxalgo/vela/ui';
import {
  nativeFavorite,
  scriptFavorite,
  type IndicatorFavorite,
  type WorkspaceIndicatorItem,
} from '../../domain/indicators.ts';
import type { FavoriteServicePort } from '../../domain/ports/favorite-service.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';
import type { WorkspacePort } from '../../domain/ports/workspace-port.ts';
import { formatTime, makeButton } from '../../shared/dom.ts';
import { OverlayManager } from '../../shared/overlays.ts';
import { setIcon } from '../../icons.ts';
import { openNativeIndicatorInfo } from './native-indicator-info.vela.ts';

type IndicatorManagerRow = {
  name: string;
  meta?: string;
  favorite: IndicatorFavorite;
  code:
    | { kind: 'native'; nativeType: string }
    | { kind: 'script'; script: string; savedName?: string };
  add?: () => void;
  remove?: () => void;
  removeSaved?: () => void;
};

type IndicatorManagerSection = {
  id: 'on-chart' | 'favorites' | 'built-ins' | 'personal';
  title: string;
  rows: IndicatorManagerRow[];
  empty: string;
};

export interface IndicatorManagerActions {
  openScript(name: string, script: string, savedName?: string): void;
  openNewScript(): void;
  onScriptDeleted(name: string): void;
}

export class IndicatorManagerDialog {
  private readonly dialog: Dialog;
  private readonly search: HTMLInputElement;
  private readonly navigation: HTMLElement;
  private readonly list: HTMLElement;
  private renderedRows: IndicatorManagerRow[] = [];
  private activeSectionId: IndicatorManagerSection['id'] = 'on-chart';

  constructor(
    private readonly workspace: WorkspacePort,
    private readonly scripts: ScriptServicePort,
    private readonly favorites: FavoriteServicePort,
    private readonly overlays: OverlayManager,
    private readonly actions: IndicatorManagerActions,
  ) {
    const doc = workspace.root.ownerDocument;
    this.search = doc.createElement('input');
    this.search.className = 'quant-indicator-search';
    this.search.placeholder = 'Search indicators…';
    this.search.spellcheck = false;
    this.search.setAttribute('aria-label', 'Search indicators');

    const searchRow = doc.createElement('div');
    searchRow.className = 'quant-indicator-search-row';
    searchRow.append(iconEl('search', doc), this.search);

    this.list = doc.createElement('div');
    this.list.className = 'quant-indicator-list';
    this.list.addEventListener('click', (event) => this.onListClick(event));

    this.navigation = doc.createElement('nav');
    this.navigation.className = 'quant-indicator-navigation';
    this.navigation.setAttribute('aria-label', 'Indicator categories');
    this.navigation.addEventListener('click', (event) => this.onNavigationClick(event));

    const body = doc.createElement('div');
    body.className = 'quant-indicator-body';
    body.append(this.navigation, this.list);

    const content = doc.createElement('div');
    content.className = 'quant-indicator-manager';
    content.addEventListener('keydown', (event) => event.stopPropagation());
    content.append(searchRow, body);

    this.dialog = new Dialog({
      title: 'Indicators',
      host: workspace.root,
      draggable: true,
      closeOnInteractOutside: true,
      closeOnBackdrop: true,
      className: 'quant-indicator-dialog',
      content,
      initialFocusEl: () => this.search,
      onOpenChange: (open) => {
        if (!open) return;
        this.activeSectionId = 'on-chart';
        this.search.value = '';
        this.refresh();
        if (!this.search.closest('[data-layout="mobile"]')) {
          setTimeout(() => this.search.focus(), 0);
        }
      },
    });
    this.search.addEventListener('input', () => this.refresh());
  }

  open(): void {
    this.overlays.closePopover();
    this.workspace.closeChartDialogs();
    this.favorites.reconcileLegacyScripts();
    this.dialog.show();
  }

  sync(): void {
    if (this.dialog.open) this.refresh();
  }

  destroy(): void {
    this.dialog.destroy();
  }

  private sections(): IndicatorManagerSection[] {
    const scripts = this.scripts.list();
    const toRow = (item: WorkspaceIndicatorItem): IndicatorManagerRow => {
      if (item.source.kind === 'native') {
        return {
          name: item.name,
          meta: item.beta ? 'Beta' : undefined,
          favorite: nativeFavorite(item.name, item.source.nativeType),
          code: { kind: 'native', nativeType: item.source.nativeType },
          add: item.add,
          remove: item.remove,
        };
      }
      const source = item.source;
      return {
        name: item.name,
        meta: item.beta ? 'Beta' : undefined,
        favorite: scriptFavorite(item.name, source.script, source.language),
        code: {
          kind: 'script',
          script: source.script,
          savedName: scripts.find((script) => script.script === source.script)?.name,
        },
        add: item.add,
        remove: item.remove,
      };
    };
    const onChart = this.workspace.getOnChartIndicators().map(toRow);

    const favorites = this.favorites.list().map((favorite): IndicatorManagerRow => {
      const savedName = favorite.kind === 'script'
        ? scripts.find((script) => script.script === favorite.script)?.name
        : undefined;
      return {
        name: favorite.name,
        favorite,
        code: favorite.kind === 'native'
          ? { kind: 'native', nativeType: favorite.nativeType }
          : { kind: 'script', script: favorite.script, savedName },
        add: () => this.addFavoriteToActiveChart(favorite),
      };
    });

    const builtIns = this.workspace.getBuiltInIndicators().map(toRow);

    const personal = scripts.map((script): IndicatorManagerRow => ({
      name: script.name,
      meta: formatTime(script.savedAt),
      favorite: scriptFavorite(script.name, script.script),
      code: { kind: 'script', script: script.script, savedName: script.name },
      add: () => this.workspace.addScriptIndicator(script.name, script.script),
      removeSaved: () => this.deletePersonalScript(script.name),
    }));

    return [
      { id: 'on-chart', title: 'On chart', rows: onChart, empty: 'No indicators on this chart.' },
      { id: 'favorites', title: 'Favorites', rows: favorites, empty: 'Star an indicator to keep it here.' },
      { id: 'personal', title: 'My indicators', rows: personal, empty: 'Save a Pine script to manage it here.' },
      { id: 'built-ins', title: 'Built-ins', rows: builtIns, empty: 'No built-in indicators available.' },
    ];
  }

  private refresh(): void {
    const query = this.search.value.trim().toLocaleLowerCase();
    this.renderedRows = [];
    this.list.replaceChildren();
    const sections = this.sections();
    this.renderNavigation(sections);
    const active = sections.find((section) => section.id === this.activeSectionId) ?? sections[0];
    const rows = active.rows.filter((row) => !query || row.name.toLocaleLowerCase().includes(query));
    this.renderSection(active, rows, Boolean(query));
  }

  private renderNavigation(sections: IndicatorManagerSection[]): void {
    const doc = this.navigation.ownerDocument;
    this.navigation.replaceChildren();
    const icons: Record<IndicatorManagerSection['id'], string> = {
      'on-chart': 'chart-line',
      favorites: 'star-filled',
      personal: 'code-xml',
      'built-ins': 'bookmark',
    };
    sections.forEach((section) => {
      const button = makeButton('', 'quant-indicator-category');
      button.dataset.section = section.id;
      button.classList.toggle('active', section.id === this.activeSectionId);
      button.setAttribute('aria-current', section.id === this.activeSectionId ? 'page' : 'false');
      const categoryIcon = doc.createElement('span');
      categoryIcon.className = 'quant-indicator-category-icon';
      setIcon(categoryIcon, icons[section.id], 15);
      const label = doc.createElement('span');
      label.className = 'quant-indicator-category-label';
      label.textContent = section.title;
      const count = doc.createElement('span');
      count.className = 'quant-indicator-category-count';
      count.textContent = String(section.rows.length);
      button.append(categoryIcon, label, count);
      this.navigation.appendChild(button);
    });
  }

  private renderSection(
    section: IndicatorManagerSection,
    rows: IndicatorManagerRow[],
    searching: boolean,
  ): void {
    const doc = this.list.ownerDocument;
    const heading = doc.createElement('div');
    heading.className = 'quant-indicator-list-heading';
    const title = doc.createElement('strong');
    title.textContent = section.title;
    const count = doc.createElement('span');
    count.textContent = String(rows.length);
    heading.append(title, count);
    this.list.appendChild(heading);

    if (rows.length === 0) {
      const empty = doc.createElement('div');
      empty.className = searching ? 'quant-indicator-global-empty' : 'quant-indicator-empty';
      empty.textContent = searching ? 'No indicators match your search.' : section.empty;
      this.list.appendChild(empty);
      if (section.id === 'personal' && !searching) {
        const create = makeButton('Create in Pine editor', 'quant-indicator-create');
        create.addEventListener('click', () => this.openNewPersonalScript());
        this.list.appendChild(create);
      }
    } else {
      rows.forEach((row) => this.list.appendChild(this.renderRow(row)));
    }
  }

  private renderRow(row: IndicatorManagerRow): HTMLElement {
    const doc = this.list.ownerDocument;
    const rowIndex = this.renderedRows.push(row) - 1;
    const element = doc.createElement('div');
    element.className = 'quant-indicator-row';

    const main = row.add ? makeButton('', 'quant-indicator-main') : doc.createElement('div');
    main.className = 'quant-indicator-main';
    if (row.add) {
      main.dataset.action = 'add';
      main.dataset.row = String(rowIndex);
      main.title = `Add ${row.name} to chart`;
    }
    const copy = doc.createElement('span');
    copy.className = 'quant-indicator-copy';
    const name = doc.createElement('span');
    name.className = 'quant-indicator-name';
    name.textContent = row.name;
    copy.appendChild(name);
    if (row.meta) {
      const meta = doc.createElement('span');
      meta.className = 'quant-indicator-meta';
      meta.textContent = row.meta;
      copy.appendChild(meta);
    }
    main.appendChild(copy);
    element.appendChild(main);

    const actions = doc.createElement('div');
    actions.className = 'quant-indicator-actions';
    const favorite = this.actionButton(
      rowIndex,
      'favorite',
      this.favorites.has(row.favorite) ? 'Remove from favorites' : 'Add to favorites',
    );
    const starred = this.favorites.has(row.favorite);
    favorite.classList.toggle('active', starred);
    setIcon(favorite, starred ? 'star-filled' : 'star', 14);
    actions.appendChild(favorite);

    const code = this.actionButton(
      rowIndex,
      'code',
      row.code.kind === 'native' ? 'View implementation details' : 'Open in Pine editor',
    );
    setIcon(code, 'code-xml', 14);
    actions.appendChild(code);
    if (row.remove) {
      const remove = this.actionButton(rowIndex, 'remove', 'Remove from chart', true);
      remove.appendChild(iconEl('trash', doc));
      actions.appendChild(remove);
    }
    if (row.removeSaved) {
      const removeSaved = this.actionButton(rowIndex, 'delete', 'Delete saved indicator', true);
      removeSaved.appendChild(iconEl('trash', doc));
      actions.appendChild(removeSaved);
    }
    element.appendChild(actions);
    return element;
  }

  private actionButton(row: number, action: string, label: string, danger = false): HTMLButtonElement {
    const button = makeButton('', `quant-indicator-action${danger ? ' danger' : ''}`);
    button.dataset.row = String(row);
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  private onListClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLElement>('[data-action][data-row]');
    if (!button || !this.list.contains(button)) return;
    const row = this.renderedRows[Number(button.dataset.row)];
    if (!row) return;
    switch (button.dataset.action) {
      case 'add':
        row.add?.();
        break;
      case 'remove':
        row.remove?.();
        break;
      case 'favorite': {
        const enabled = this.favorites.toggle(row.favorite);
        this.workspace.toast(
          enabled ? 'Added to favorites' : 'Removed from favorites',
          'success',
        );
        break;
      }
      case 'code':
        this.openIndicatorCode(row);
        return;
      case 'delete':
        row.removeSaved?.();
        return;
    }
    this.refresh();
  }

  private onNavigationClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLElement>('[data-section]');
    if (!button || !this.navigation.contains(button)) return;
    const id = button.dataset.section as IndicatorManagerSection['id'];
    if (!['on-chart', 'favorites', 'personal', 'built-ins'].includes(id)) return;
    this.activeSectionId = id;
    this.refresh();
  }

  private openIndicatorCode(row: IndicatorManagerRow): void {
    this.dialog.hide();
    if (row.code.kind === 'native') {
      openNativeIndicatorInfo(this.overlays, row.name, row.code.nativeType);
      return;
    }
    this.actions.openScript(row.name, row.code.script, row.code.savedName);
  }

  private openNewPersonalScript(): void {
    this.dialog.hide();
    this.actions.openNewScript();
  }

  private deletePersonalScript(name: string): void {
    if (!window.confirm(`Delete saved indicator “${name}”?`)) return;
    this.scripts.delete(name);
    this.actions.onScriptDeleted(name);
    this.workspace.toast(`Deleted “${name}”`, 'success');
    this.refresh();
  }

  private addFavoriteToActiveChart(favorite: IndicatorFavorite): void {
    if (favorite.kind === 'native') {
      this.workspace.addNativeIndicator(favorite.nativeType);
    } else {
      this.workspace.addScriptIndicator(
        favorite.name,
        favorite.script,
        favorite.language ?? 'pine',
      );
    }
  }
}
