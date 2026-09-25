import { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { IndicatorHandle, Vela } from '@luxalgo/vela';
import {
  getNativeIndicator,
  registerLegendAction,
  registerSidePanel,
  registerStatePersistence,
  registerWidgetAction,
} from '@luxalgo/vela/plugin';
import { Dialog, iconEl, registerIcon, svg16 } from '@luxalgo/vela/ui';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { icon, setIcon } from './icons';
import { BASIC_SAMPLES } from './samples';
import { LIBRARY } from './scripts/library';
import {
  deleteScript,
  deleteWorkspaceTemplate,
  isFavorite,
  listIndicatorFavorites,
  listScripts,
  listWorkspaceTemplates,
  loadEditorSnapshot,
  renameScript,
  saveEditorSnapshot,
  saveScript,
  saveWorkspaceTemplate,
  toggleFavorite,
  toggleIndicatorFavorite,
  type IndicatorFavorite,
} from './storage';
import './style.css';

const WORKSPACE_STORAGE_KEY = 'quant-tools:workspace:v2';
const EXTERNAL_INDICATORS_KEY = 'quant-tools.external-indicators';
const PLATFORM_INDICATORS = [
  ...BASIC_SAMPLES.map((entry) => ({
    name: entry.name,
    script: entry.script,
    language: 'pine',
    enabled: false,
    category: 'Examples',
  })),
  ...LIBRARY.map((entry) => ({
    name: entry.name,
    script: entry.script,
    language: 'pine',
    enabled: false,
    category: 'LuxAlgo',
  })),
];

let workspace: VelaWorkspace;
let editorPanel: PineEditorController | null = null;
let indicatorManager: IndicatorManagerDialog | null = null;
let openPopover: HTMLElement | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function extractTitle(source: string): string {
  const match = /(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/.exec(source);
  return match?.[1] ?? 'Untitled indicator';
}

function sourceKey(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function nativeFavorite(name: string, nativeType: string): IndicatorFavorite {
  return {
    key: `native:${nativeType}`,
    kind: 'native',
    name,
    nativeType,
    savedAt: Date.now(),
  };
}

function scriptFavorite(name: string, script: string, language = 'pine'): IndicatorFavorite {
  return {
    key: `script:${sourceKey(script)}`,
    kind: 'script',
    name,
    script,
    language,
    savedAt: Date.now(),
  };
}

function hasIndicatorFavorite(favorite: IndicatorFavorite): boolean {
  return listIndicatorFavorites().some((item) => item.key === favorite.key);
}

function setIndicatorFavorite(favorite: IndicatorFavorite, enabled: boolean) {
  const existing = listIndicatorFavorites().find((item) => item.key === favorite.key);
  if (existing) toggleIndicatorFavorite(existing);
  if (enabled) toggleIndicatorFavorite({ ...favorite, savedAt: Date.now() });
  if (favorite.kind === 'script') {
    listScripts()
      .filter((script) => script.script === favorite.script)
      .forEach((script) => {
        if (Boolean(script.favorite) !== enabled) toggleFavorite(script.name);
      });
  }
}

function syncSavedScriptFavorite(name: string, script: string, previousScript?: string) {
  const enabled = isFavorite(name);
  if (previousScript && previousScript !== script) {
    setIndicatorFavorite(scriptFavorite(name, previousScript), false);
  }
  setIndicatorFavorite(scriptFavorite(name, script), enabled);
  indicatorManager?.sync();
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function makeButton(label: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function closeActivePopover() {
  openPopover?.remove();
  openPopover = null;
  favoriteAnchor()?.setAttribute('aria-expanded', 'false');
}

function showPopover(anchor: HTMLElement, className: string): HTMLElement {
  closeActivePopover();
  const popover = document.createElement('div');
  popover.className = `quant-popover ${className}`;
  popover.setAttribute('role', 'menu');
  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  const width = className.includes('template') ? 230 : 260;
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  openPopover = popover;
  return popover;
}

function appendPopoverTitle(popover: HTMLElement, text: string) {
  const title = document.createElement('div');
  title.className = 'quant-popover-title';
  title.textContent = text;
  popover.appendChild(title);
}

function appendPopoverItem(
  popover: HTMLElement,
  label: string,
  action: (() => void) | null,
  hint?: string,
) {
  const button = makeButton('', 'quant-popover-item');
  button.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.textContent = label;
  button.appendChild(text);
  if (hint) {
    const secondary = document.createElement('span');
    secondary.className = 'quant-popover-hint';
    secondary.textContent = hint;
    button.appendChild(secondary);
  }
  if (action) {
    button.addEventListener('click', () => {
      closeActivePopover();
      action();
    });
  } else {
    button.disabled = true;
  }
  popover.appendChild(button);
}

function appendPopoverSeparator(popover: HTMLElement) {
  const separator = document.createElement('div');
  separator.className = 'quant-popover-separator';
  popover.appendChild(separator);
}

function favoriteAnchor(): HTMLElement | null {
  return document.getElementById('vela-action-quant-favorites');
}

function templateAnchor(): HTMLElement | null {
  return document.getElementById('vela-action-quant-templates');
}

function addFavoriteToActiveChart(favorite: IndicatorFavorite) {
  if (favorite.kind === 'native') {
    workspace.context().addNativeIndicator(favorite.nativeType);
  } else {
    workspace.context().addIndicator({
      name: favorite.name,
      script: favorite.script,
      language: favorite.language ?? 'pine',
    });
  }
}

function openScriptInEditor(name: string, script: string, savedName?: string) {
  workspace.context().togglePanel('quant-pine-editor', true);
  requestAnimationFrame(() => {
    if (savedName) editorPanel?.openSavedScript(savedName, script);
    else editorPanel?.openIndicatorSource(name, script);
  });
}

function formatNativeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function openNativeIndicatorInfo(name: string, nativeType: string) {
  closeActivePopover();
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
  document.body.appendChild(backdrop);

  const dismiss = () => backdrop.remove();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
  });
  requestAnimationFrame(() => close.focus());
}

function toggleFavoriteIndicatorsPopover() {
  const anchor = favoriteAnchor();
  if (!anchor) return;
  if (openPopover?.classList.contains('favorite-indicators-popover')) {
    closeActivePopover();
    return;
  }
  const popover = showPopover(anchor, 'favorite-indicators-popover');
  anchor.setAttribute('aria-expanded', 'true');
  appendPopoverTitle(popover, 'Favorite indicators');
  const favorites = listIndicatorFavorites();
  if (favorites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'quant-popover-empty';
    empty.textContent = 'No favorites yet — star any indicator.';
    popover.appendChild(empty);
    return;
  }
  favorites.forEach((favorite) => {
    appendPopoverItem(
      popover,
      favorite.name,
      () => addFavoriteToActiveChart(favorite),
    );
  });
}

type TextDialogOptions = {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => string | null;
};

function openTextDialog(options: TextDialogOptions) {
  closeActivePopover();
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
  document.body.appendChild(backdrop);

  const dismiss = () => backdrop.remove();
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
}

function saveCurrentWorkspaceAsTemplate() {
  openTextDialog({
    title: 'New template',
    label: 'Template name',
    onConfirm: (name) => {
      if (!name) return '请输入模板名称';
      if (listWorkspaceTemplates().some((item) => item.name === name)) {
        return `模板「${name}」已存在`;
      }
      saveWorkspaceTemplate(name, workspace.getState());
      workspace.context().toast(`Template “${name}” saved`, 'success');
      return null;
    },
  });
}

function applyWorkspaceTemplate(name: string, state: unknown) {
  workspace.applyState(state);
  workspace.context().toast(`Template “${name}” applied`, 'success');
}

function showAllTemplatesDialog() {
  closeActivePopover();
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
  document.body.appendChild(backdrop);

  const render = () => {
    list.replaceChildren();
    const templates = listWorkspaceTemplates();
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
        backdrop.remove();
        applyWorkspaceTemplate(template.name, template.state);
      });
      remove.addEventListener('click', () => {
        deleteWorkspaceTemplate(template.name);
        render();
      });
      rowActions.append(apply, remove);
      row.append(info, rowActions);
      list.appendChild(row);
    });
  };
  close.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  render();
}

function toggleTemplatesPopover() {
  const anchor = templateAnchor();
  if (!anchor) return;
  if (openPopover?.classList.contains('template-popover')) {
    closeActivePopover();
    return;
  }
  const popover = showPopover(anchor, 'template-popover');
  appendPopoverTitle(popover, 'Recent templates');
  const templates = listWorkspaceTemplates().slice(0, 5);
  if (templates.length === 0) appendPopoverItem(popover, 'No templates yet', null);
  templates.forEach((template) => {
    appendPopoverItem(popover, template.name, () => applyWorkspaceTemplate(template.name, template.state));
  });
  appendPopoverSeparator(popover);
  appendPopoverItem(popover, 'Show all', showAllTemplatesDialog);
  appendPopoverItem(popover, 'New template', saveCurrentWorkspaceAsTemplate);
}

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

registerWidgetAction({
  id: 'indicators',
  target: 'topbar',
  label: 'Indicators',
  icon: 'indicators',
  align: 'left',
  run: () => indicatorManager?.open(),
});

registerWidgetAction({
  id: 'quant-favorites',
  target: 'topbar',
  label: 'Favorite indicators',
  icon: 'quant-favorite-caret',
  iconOnly: true,
  align: 'left',
  run: toggleFavoriteIndicatorsPopover,
});

registerWidgetAction({
  id: 'quant-templates',
  target: 'topbar',
  label: 'Indicator Templates',
  icon: 'quant-template',
  iconOnly: true,
  align: 'left',
  run: toggleTemplatesPopover,
});

registerWidgetAction({
  id: 'screenshot',
  target: 'topbar',
  label: 'Screenshot',
  icon: 'quant-camera',
  iconOnly: true,
  run: () => workspace.downloadScreenshot(),
});

registerLegendAction({
  id: 'quant-favorite-indicator',
  icon: 'quant-star',
  tooltip: 'Add or remove favorite',
  order: -20,
  run: (context, indicator) => {
    if (indicator.source) {
      const favorite = scriptFavorite(indicator.title, indicator.source);
      const existed = hasIndicatorFavorite(favorite);
      setIndicatorFavorite(favorite, !existed);
      indicatorManager?.sync();
      context.toast(existed ? 'Removed from favorites' : 'Added to favorites', 'success');
      return;
    }
    const nativeType = workspace.active.chart.indicators()
      .find((handle) => handle.id === indicator.id)?.nativeType;
    const native = nativeType
      ? workspace.active.nativeCatalog.find((item) => item.type === nativeType)
      : workspace.active.nativeCatalog.find((item) => item.title === indicator.title);
    if (!native) {
      context.toast('This indicator cannot be favorited', 'error');
      return;
    }
    const favorite = nativeFavorite(native.title, native.type);
    const existed = hasIndicatorFavorite(favorite);
    setIndicatorFavorite(favorite, !existed);
    indicatorManager?.sync();
    context.toast(existed ? 'Removed from favorites' : 'Added to favorites', 'success');
  },
});

registerLegendAction({
  id: 'quant-open-indicator-code',
  icon: 'quant-code',
  tooltip: 'Open indicator code',
  order: -19,
  run: (_context, indicator) => {
    if (indicator.source) {
      const savedName = listScripts().find((script) => script.script === indicator.source)?.name;
      openScriptInEditor(indicator.title, indicator.source, savedName);
      return;
    }
    const nativeType = workspace.active.chart.indicators()
      .find((handle) => handle.id === indicator.id)?.nativeType;
    if (nativeType) {
      openNativeIndicatorInfo(indicator.title, nativeType);
    }
  },
});

type PersistedExternalIndicator = {
  name: string;
  script: string;
  language?: string;
  id?: string;
  hidden?: boolean;
  inputs?: Record<string, string | number | boolean>;
  props?: Record<string, string | number | boolean>;
};

function parsePersistedExternalIndicators(value: unknown): PersistedExternalIndicator[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || typeof item.script !== 'string' || !item.script.trim()) return [];
    return [{
      name,
      script: item.script,
      ...(typeof item.language === 'string' && item.language.trim() ? { language: item.language } : {}),
      ...(typeof item.id === 'string' && item.id.trim() ? { id: item.id } : {}),
      ...(typeof item.hidden === 'boolean' ? { hidden: item.hidden } : {}),
      ...(isRecord(item.inputs) ? { inputs: item.inputs as Record<string, string | number | boolean> } : {}),
      ...(isRecord(item.props) ? { props: item.props as Record<string, string | number | boolean> } : {}),
    }];
  });
}

registerStatePersistence({
  key: EXTERNAL_INDICATORS_KEY,
  scope: 'cell',
  serialize: (context) => {
    const cell = workspace?.cell(context.cellId);
    if (!cell) return [];
    return cell.instances.flatMap((instance) => {
      if (!instance.external) return [];
      return [{
        name: instance.entry.name,
        script: instance.entry.script,
        ...(instance.entry.language ? { language: instance.entry.language } : {}),
        ...(instance.id ? { id: instance.id } : {}),
        ...(instance.handle ? { hidden: !instance.handle.visible } : {}),
        ...(instance.values?.inputs ? { inputs: instance.values.inputs } : {}),
        ...(instance.values?.props ? { props: instance.values.props } : {}),
      }];
    });
  },
  restore: (payload, context) => {
    parsePersistedExternalIndicators(payload).forEach((entry) => context.addIndicator(entry));
  },
});

const setRunErrorLine = StateEffect.define<number | null>();
const runErrorLine = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRunErrorLine)) value = effect.value;
    }
    return value;
  },
});
const runErrorHighlight = EditorView.decorations.compute([runErrorLine], (state) => {
  const line = state.field(runErrorLine);
  if (line == null || line < 1 || line > state.doc.lines) return Decoration.none;
  const target = state.doc.line(line);
  return Decoration.set([Decoration.line({ class: 'cm-run-error' }).range(target.from)]);
});

const NEW_SCRIPT = `//@version=6
indicator("My Indicator", overlay=true)

plot(ta.ema(close, 14), "EMA 14", color.orange)
`;

class PineEditorController {
  private readonly view: EditorView;
  private readonly logs: HTMLElement;
  private readonly logsCount: HTMLElement;
  private readonly scriptName: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly favoriteButton: HTMLButtonElement;
  private currentName: string | null;
  private draftTitle: string | null = null;
  private savedContent: string | null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private logCount = 0;
  private readonly closeMenuOnDocumentClick: (event: MouseEvent) => void;

  constructor(body: HTMLElement, headerSlot: HTMLElement) {
    body.classList.add('quant-pine-body');
    headerSlot.classList.add('quant-pine-header-slot');

    const snapshot = loadEditorSnapshot();
    const saved = snapshot?.name
      ? listScripts().find((script) => script.name === snapshot.name) ?? null
      : null;
    const initialDoc = snapshot?.script ?? BASIC_SAMPLES[0].script;
    this.currentName = saved?.name ?? null;
    this.savedContent = saved?.script ?? (snapshot?.name ? null : initialDoc);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'quant-script-title-wrap';
    const titleButton = makeButton('', 'quant-script-title');
    this.scriptName = document.createElement('span');
    const caret = document.createElement('span');
    caret.textContent = '▾';
    caret.className = 'quant-caret';
    titleButton.append(this.scriptName, caret);
    this.menu = document.createElement('div');
    this.menu.className = 'quant-script-menu';
    this.menu.hidden = true;
    titleWrap.append(titleButton, this.menu);

    const save = makeButton('', 'quant-editor-icon');
    save.title = '保存脚本 (Ctrl+S)';
    save.setAttribute('aria-label', save.title);
    setIcon(save, 'save', 15);
    const saveAs = makeButton('', 'quant-editor-icon');
    saveAs.title = '另存为副本';
    saveAs.setAttribute('aria-label', saveAs.title);
    setIcon(saveAs, 'copy', 15);
    this.favoriteButton = makeButton('', 'quant-editor-icon');
    this.favoriteButton.setAttribute('aria-label', '收藏当前脚本');
    const run = makeButton('', 'quant-run-button');
    run.append(icon('play', 12), document.createTextNode('Run'));

    headerSlot.append(titleWrap, save, saveAs, this.favoriteButton, run);

    const editorHost = document.createElement('div');
    editorHost.className = 'quant-editor-host';
    const logsPanel = document.createElement('div');
    logsPanel.className = 'quant-logs-panel';
    const logsHeading = document.createElement('div');
    logsHeading.className = 'quant-logs-heading';
    const logsToggle = makeButton('', 'quant-logs-toggle');
    logsToggle.append(document.createTextNode('Logs '));
    this.logsCount = document.createElement('span');
    this.logsCount.textContent = '(0)';
    logsToggle.appendChild(this.logsCount);
    const language = document.createElement('span');
    language.className = 'quant-language-badge';
    language.textContent = 'Pine v6';
    logsHeading.append(logsToggle, language);
    this.logs = document.createElement('div');
    this.logs.className = 'quant-logs';
    logsPanel.append(logsHeading, this.logs);
    body.append(editorHost, logsPanel);

    const editorKeymap = Prec.high(keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        stopPropagation: true,
        run: () => { this.run(); return true; },
      },
      {
        key: 'Mod-s',
        preventDefault: true,
        stopPropagation: true,
        run: () => { this.save(); return true; },
      },
    ]));
    this.view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          javascript(),
          runErrorLine,
          runErrorHighlight,
          editorKeymap,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.renderTitle();
              this.persistSoon();
            }
          }),
        ],
      }),
    });

    titleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.menu.hidden) this.renderMenu();
      this.menu.hidden = !this.menu.hidden;
    });
    save.addEventListener('click', () => this.save());
    saveAs.addEventListener('click', () => this.saveAs());
    this.favoriteButton.addEventListener('click', () => this.toggleCurrentFavorite());
    run.addEventListener('click', () => this.run());
    logsToggle.addEventListener('click', () => logsPanel.classList.toggle('collapsed'));
    this.closeMenuOnDocumentClick = (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node)) this.menu.hidden = true;
    };
    document.addEventListener('click', this.closeMenuOnDocumentClick);
    this.renderTitle();
    this.renderFavorite();
  }

  destroy() {
    document.removeEventListener('click', this.closeMenuOnDocumentClick);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.view.destroy();
    if (editorPanel === this) editorPanel = null;
  }

  openSavedScript(name: string, source: string) {
    this.replaceDocument(source, name, null);
    this.view.focus();
  }

  openIndicatorSource(name: string, source: string) {
    this.replaceDocument(source, null, name);
    this.view.focus();
  }

  openNewScript() {
    this.replaceDocument(NEW_SCRIPT, null, null);
    this.view.focus();
  }

  detachDeletedScript(name: string) {
    if (this.currentName !== name) return;
    this.currentName = null;
    this.draftTitle = name;
    this.savedContent = null;
    this.persistNow();
    this.renderTitle();
    this.renderFavorite();
    this.log('info', `已删除保存的脚本「${name}」，编辑区内容保留为草稿`);
  }

  log(level: 'info' | 'ok' | 'error', message: string) {
    this.logCount++;
    this.logsCount.textContent = `(${this.logCount})`;
    const row = document.createElement('div');
    row.className = `quant-log-row ${level}`;
    const time = document.createElement('span');
    time.className = 'quant-log-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const text = document.createElement('span');
    text.textContent = message;
    row.append(time, text);
    this.logs.appendChild(row);
    while (this.logs.childElementCount > 150) this.logs.firstElementChild?.remove();
    this.logs.scrollTop = this.logs.scrollHeight;
  }

  reportError(error: Error, source?: string) {
    this.log('error', error.message);
    if (source && source !== this.view.state.doc.toString()) return;
    const match = /\b(?:line|Ln)\s*#?(\d+)/i.exec(error.message);
    this.view.dispatch({ effects: setRunErrorLine.of(match ? Number(match[1]) : null) });
  }

  private renderTitle() {
    const dirty = this.view.state.doc.toString() !== this.savedContent;
    this.scriptName.textContent = `${this.currentName ?? this.draftTitle ?? '未命名脚本'}${dirty ? ' *' : ''}`;
  }

  private renderFavorite() {
    const active = this.currentName != null && isFavorite(this.currentName);
    this.favoriteButton.classList.toggle('active', active);
    setIcon(this.favoriteButton, active ? 'star-filled' : 'star', 15);
    this.favoriteButton.title = active ? '取消收藏当前脚本' : '收藏当前脚本';
  }

  private persistNow() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    saveEditorSnapshot({ script: this.view.state.doc.toString(), name: this.currentName });
  }

  private persistSoon() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.persistNow(), 250);
  }

  private replaceDocument(source: string, name: string | null, draftTitle: string | null = null) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source } });
    this.view.dispatch({ effects: setRunErrorLine.of(null) });
    this.currentName = name;
    this.draftTitle = draftTitle;
    this.savedContent = source;
    this.renderTitle();
    this.renderFavorite();
    this.persistNow();
  }

  private run() {
    const source = this.view.state.doc.toString();
    try {
      workspace.context().addIndicator({ name: extractTitle(source), script: source, language: 'pine' });
      this.view.dispatch({ effects: setRunErrorLine.of(null) });
      this.log('info', `已提交运行 · ${extractTitle(source)}`);
    } catch (reason) {
      this.reportError(reason instanceof Error ? reason : new Error(String(reason)), source);
    }
  }

  private save() {
    const source = this.view.state.doc.toString();
    if (!this.currentName) {
      this.openSaveDialog('保存脚本', this.draftTitle ?? extractTitle(source), false);
      return;
    }
    const previous = listScripts().find((script) => script.name === this.currentName)?.script;
    saveScript(this.currentName, source);
    syncSavedScriptFavorite(this.currentName, source, previous);
    this.savedContent = source;
    this.persistNow();
    this.renderTitle();
    this.renderFavorite();
    this.log('ok', `已保存「${this.currentName}」`);
  }

  private saveAs() {
    const suggestion = this.currentName
      ? `${this.currentName} copy`
      : this.draftTitle ?? extractTitle(this.view.state.doc.toString());
    this.openSaveDialog('另存为副本', suggestion, false);
  }

  private openSaveDialog(title: string, initialValue: string, rename: boolean) {
    openTextDialog({
      title,
      label: '脚本名称',
      initialValue,
      onConfirm: (name) => {
        if (!name) return '请输入脚本名称';
        const duplicate = listScripts().some((script) => script.name === name);
        if (duplicate && !(rename && name === this.currentName)) return `脚本「${name}」已存在`;
        const source = this.view.state.doc.toString();
        if (rename && this.currentName) {
          const oldName = this.currentName;
          const previous = listScripts().find((script) => script.name === oldName)?.script;
          renameScript(oldName, name, source);
          syncSavedScriptFavorite(name, source, previous);
          this.log('ok', `已重命名「${oldName}」→「${name}」`);
        } else {
          saveScript(name, source);
          indicatorManager?.sync();
          this.log('ok', `已保存脚本「${name}」`);
        }
        this.currentName = name;
        this.draftTitle = null;
        this.savedContent = source;
        this.persistNow();
        this.renderTitle();
        this.renderFavorite();
        return null;
      },
    });
  }

  private toggleCurrentFavorite() {
    if (!this.currentName) {
      this.log('info', '请先保存脚本，再收藏');
      return;
    }
    const saved = listScripts().find((script) => script.name === this.currentName);
    const scripts = toggleFavorite(this.currentName);
    const enabled = scripts.some((script) => script.name === this.currentName && script.favorite);
    if (saved) setIndicatorFavorite(scriptFavorite(saved.name, saved.script), enabled);
    indicatorManager?.sync();
    this.renderFavorite();
    this.log('ok', isFavorite(this.currentName) ? `已收藏「${this.currentName}」` : `已取消收藏「${this.currentName}」`);
  }

  private renderMenu() {
    this.menu.replaceChildren();
    const addSection = (title: string) => {
      const heading = document.createElement('div');
      heading.className = 'quant-script-menu-heading';
      heading.textContent = title;
      this.menu.appendChild(heading);
    };
    const addItem = (label: string, action: () => void, hint?: string) => {
      const button = makeButton('', 'quant-script-menu-item');
      const text = document.createElement('span');
      text.textContent = label;
      button.appendChild(text);
      if (hint) {
        const secondary = document.createElement('span');
        secondary.textContent = hint;
        button.appendChild(secondary);
      }
      button.addEventListener('click', () => {
        this.menu.hidden = true;
        action();
      });
      this.menu.appendChild(button);
    };
    const separator = () => {
      const element = document.createElement('div');
      element.className = 'quant-script-menu-separator';
      this.menu.appendChild(element);
    };

    addSection('FAVORITE SCRIPTS');
    const favorites = listScripts().filter((script) => script.favorite);
    if (favorites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quant-script-menu-empty';
      empty.textContent = '还没有收藏的脚本';
      this.menu.appendChild(empty);
    } else {
      favorites.forEach((script) => addItem(
        script.name,
        () => this.replaceDocument(script.script, script.name),
        formatTime(script.savedAt),
      ));
    }
    separator();
    addSection('RECENT SCRIPTS');
    const recent = listScripts().slice(0, 6);
    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quant-script-menu-empty';
      empty.textContent = '还没有保存的脚本';
      this.menu.appendChild(empty);
    } else {
      recent.forEach((script) => addItem(
        script.name,
        () => this.replaceDocument(script.script, script.name),
        formatTime(script.savedAt),
      ));
    }
    separator();
    addItem('保存脚本', () => this.save(), 'Ctrl+S');
    addItem('另存为副本', () => this.saveAs());
    addItem(this.currentName ? '重命名脚本' : '保存为新脚本', () => {
      this.openSaveDialog(
        this.currentName ? '重命名脚本' : '保存为新脚本',
        this.currentName ?? this.draftTitle ?? extractTitle(this.view.state.doc.toString()),
        this.currentName != null,
      );
    });
    if (this.currentName) {
      addItem('删除当前脚本', () => {
        const deletedName = this.currentName;
        if (!deletedName) return;
        const saved = listScripts().find((script) => script.name === deletedName);
        deleteScript(deletedName);
        if (saved) setIndicatorFavorite(scriptFavorite(saved.name, saved.script), false);
        this.currentName = null;
        this.draftTitle = deletedName;
        this.savedContent = null;
        this.persistNow();
        this.renderTitle();
        this.renderFavorite();
        this.log('info', `已删除保存的脚本「${deletedName}」，编辑区内容保留为草稿`);
        indicatorManager?.sync();
      });
    }
    addItem('+ 新建脚本', () => this.replaceDocument(NEW_SCRIPT, null, null));
  }
}

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

class IndicatorManagerDialog {
  private readonly dialog: Dialog;
  private readonly search: HTMLInputElement;
  private readonly navigation: HTMLElement;
  private readonly list: HTMLElement;
  private renderedRows: IndicatorManagerRow[] = [];
  private activeSectionId: IndicatorManagerSection['id'] = 'on-chart';

  constructor() {
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
        if (!this.search.closest('[data-layout="mobile"]')) setTimeout(() => this.search.focus(), 0);
      },
    });
    this.search.addEventListener('input', () => this.refresh());
  }

  open() {
    closeActivePopover();
    workspace.cells().forEach((cell) => cell.chart.renderer.closeDialogs());
    this.migrateLegacyScriptFavorites();
    this.dialog.show();
  }

  sync() {
    if (this.dialog.open) this.refresh();
  }

  private migrateLegacyScriptFavorites() {
    listScripts().forEach((script) => {
      const favorite = scriptFavorite(script.name, script.script);
      const indicatorStarred = hasIndicatorFavorite(favorite);
      if (script.favorite && !indicatorStarred) {
        toggleIndicatorFavorite(favorite);
      } else if (!script.favorite && indicatorStarred) {
        toggleFavorite(script.name);
      }
    });
  }

  private sections(): IndicatorManagerSection[] {
    const active = workspace.active;
    const onChartRows = active.onChartRows();
    const nativeCount = onChartRows.filter((row) => row.native).length;
    const onChart = onChartRows.flatMap((row, index): IndicatorManagerRow[] => {
      let favorite: IndicatorFavorite | null = null;
      let code: IndicatorManagerRow['code'] | null = null;
      if (row.native && row.nativeType) {
        favorite = nativeFavorite(row.name, row.nativeType);
        code = { kind: 'native', nativeType: row.nativeType };
      } else {
        const instance = active.instances[index - nativeCount];
        if (instance) {
          favorite = scriptFavorite(
            row.name,
            instance.entry.script,
            instance.entry.language ?? 'pine',
          );
          code = {
            kind: 'script',
            script: instance.entry.script,
            savedName: listScripts().find(
              (script) => script.script === instance.entry.script,
            )?.name,
          };
        }
      }
      if (!favorite || !code) return [];
      return [{
        name: row.name,
        favorite,
        code,
        remove: () => workspace.active.removeFromChart(index),
      }];
    });

    const favorites = listIndicatorFavorites().map((favorite): IndicatorManagerRow => {
      const savedName = favorite.kind === 'script'
        ? listScripts().find((script) => script.script === favorite.script)?.name
        : undefined;
      return {
        name: favorite.name,
        favorite,
        code: favorite.kind === 'native'
          ? { kind: 'native', nativeType: favorite.nativeType }
          : { kind: 'script', script: favorite.script, savedName },
        add: () => addFavoriteToActiveChart(favorite),
      };
    });

    let manifestIndex = 0;
    const builtIns = active.libraryRows().flatMap((row, libraryIndex): IndicatorManagerRow[] => {
      if (row.native && row.nativeType) {
        return [{
          name: row.name,
          meta: row.beta ? 'Beta' : undefined,
          favorite: nativeFavorite(row.name, row.nativeType),
          code: { kind: 'native', nativeType: row.nativeType },
          add: () => workspace.active.addFromLibrary(libraryIndex),
        }];
      }
      const definition = PLATFORM_INDICATORS[manifestIndex++];
      if (!definition) return [];
      return [{
        name: definition.name,
        favorite: scriptFavorite(definition.name, definition.script, definition.language),
        code: { kind: 'script', script: definition.script },
        add: () => workspace.active.addFromLibrary(libraryIndex),
      }];
    });

    const personal = listScripts().map((script): IndicatorManagerRow => ({
      name: script.name,
      meta: formatTime(script.savedAt),
      favorite: scriptFavorite(script.name, script.script),
      code: { kind: 'script', script: script.script, savedName: script.name },
      add: () => workspace.context().addIndicator({
        name: script.name,
        script: script.script,
        language: 'pine',
      }),
      removeSaved: () => this.deletePersonalScript(script.name, script.script),
    }));

    return [
      { id: 'on-chart', title: 'On chart', rows: onChart, empty: 'No indicators on this chart.' },
      { id: 'favorites', title: 'Favorites', rows: favorites, empty: 'Star an indicator to keep it here.' },
      { id: 'personal', title: 'My indicators', rows: personal, empty: 'Save a Pine script to manage it here.' },
      { id: 'built-ins', title: 'Built-ins', rows: builtIns, empty: 'No built-in indicators available.' },
    ];
  }

  private refresh() {
    const query = this.search.value.trim().toLocaleLowerCase();
    this.renderedRows = [];
    this.list.replaceChildren();
    const sections = this.sections();
    this.renderNavigation(sections);
    const active = sections.find((section) => section.id === this.activeSectionId) ?? sections[0];
    const rows = active.rows.filter((row) => !query || row.name.toLocaleLowerCase().includes(query));
    this.renderSection(active, rows, Boolean(query));
  }

  private renderNavigation(sections: IndicatorManagerSection[]) {
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

  private renderSection(section: IndicatorManagerSection, rows: IndicatorManagerRow[], searching: boolean) {
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

    const main = row.add
      ? makeButton('', 'quant-indicator-main')
      : doc.createElement('div');
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
      hasIndicatorFavorite(row.favorite) ? 'Remove from favorites' : 'Add to favorites',
    );
    const starred = hasIndicatorFavorite(row.favorite);
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

  private actionButton(row: number, action: string, label: string, danger = false) {
    const button = makeButton('', `quant-indicator-action${danger ? ' danger' : ''}`);
    button.dataset.row = String(row);
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  private onListClick(event: MouseEvent) {
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
        const enabled = !hasIndicatorFavorite(row.favorite);
        setIndicatorFavorite(row.favorite, enabled);
        workspace.context().toast(enabled ? 'Added to favorites' : 'Removed from favorites', 'success');
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

  private onNavigationClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLElement>('[data-section]');
    if (!button || !this.navigation.contains(button)) return;
    const id = button.dataset.section as IndicatorManagerSection['id'];
    if (!['on-chart', 'favorites', 'personal', 'built-ins'].includes(id)) return;
    this.activeSectionId = id;
    this.refresh();
  }

  private openIndicatorCode(row: IndicatorManagerRow) {
    this.dialog.hide();
    if (row.code.kind === 'native') {
      openNativeIndicatorInfo(row.name, row.code.nativeType);
      return;
    }
    openScriptInEditor(row.name, row.code.script, row.code.savedName);
  }

  private openNewPersonalScript() {
    this.dialog.hide();
    workspace.context().togglePanel('quant-pine-editor', true);
    requestAnimationFrame(() => editorPanel?.openNewScript());
  }

  private deletePersonalScript(name: string, script: string) {
    if (!window.confirm(`Delete saved indicator “${name}”?`)) return;
    deleteScript(name);
    setIndicatorFavorite(scriptFavorite(name, script), false);
    editorPanel?.detachDeletedScript(name);
    workspace.context().toast(`Deleted “${name}”`, 'success');
    this.refresh();
  }
}

registerSidePanel({
  id: 'quant-pine-editor',
  title: 'Pine editor',
  icon: 'quant-code',
  order: 20,
  width: 600,
  minWidth: 380,
  maxWidth: 960,
  resizable: true,
  mount: (_context, body, header) => {
    header.setTitle('');
    const controller = new PineEditorController(body, header.slot);
    editorPanel = controller;
    return { destroy: () => controller.destroy() };
  },
});

workspace = new VelaWorkspace('#workspace', {
  layout: '1',
  symbol: 'BTCUSDT',
  timeframe: '15',
  live: true,
  theme: 'dark',
  timezone: 'Etc/UTC',
  defaultLanguage: 'pine',
  providers: {
    binance: () => new BinanceProvider(),
    hyperliquid: () => new HyperliquidProvider(),
  },
  engines: { pine: () => new PineWorkerEngine() },
  indicators: PLATFORM_INDICATORS,
  topbar: {
    left: [
      'symbol',
      'timeframes',
      'style',
      'layout',
      'indicators',
      'quant-favorites',
      'quant-templates',
      'undo-redo',
    ],
    right: ['panels', 'screenshot'],
  },
  drawingToolbar: true,
  persist: WORKSPACE_STORAGE_KEY,
  autofocus: true,
});

indicatorManager = new IndicatorManagerDialog();

function syncCustomActionA11y() {
  const anchor = favoriteAnchor();
  if (!anchor) return;
  anchor.setAttribute('aria-haspopup', 'menu');
  if (!anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'false');
}

syncCustomActionA11y();
new MutationObserver(syncCustomActionA11y).observe(workspace.root, { childList: true, subtree: true });

const boundHandles = new WeakSet<IndicatorHandle>();
const boundCharts = new WeakSet<Vela>();

function bindHandle(handle: IndicatorHandle) {
  if (boundHandles.has(handle)) return;
  boundHandles.add(handle);
  handle.on('ready', () => {
    const title = handle.title && handle.title !== 'Indicator'
      ? handle.title
      : extractTitle(handle.source ?? '');
    editorPanel?.log('ok', `ready · ${title}`);
  });
  handle.on('error', ({ error }) => editorPanel?.reportError(error, handle.source));
}

function bindChart(chart: Vela) {
  if (boundCharts.has(chart)) return;
  boundCharts.add(chart);
  chart.indicators().forEach(bindHandle);
  chart.on('indicator:added', ({ id }) => {
    const handle = chart.indicators().find((item) => item.id === id);
    if (handle) bindHandle(handle);
  });
}

workspace.cells().forEach((cell) => bindChart(cell.chart));
workspace.on('cell:created', ({ id }) => {
  const cell = workspace.cell(id);
  if (cell) bindChart(cell.chart);
  indicatorManager?.sync();
});
workspace.on('cell:active', () => indicatorManager?.sync());
workspace.on('state:changed', () => indicatorManager?.sync());
workspace.on('script:run', (run) => {
  if (run.cause === 'tick' || run.cause === 'viewport') return;
  editorPanel?.log('info', `script:run · ${run.title} · ${run.cell} · ${run.cause}`);
});

document.addEventListener('pointerdown', (event) => {
  if (!openPopover) return;
  const target = event.target as Node;
  if (openPopover.contains(target) || favoriteAnchor()?.contains(target) || templateAnchor()?.contains(target)) return;
  closeActivePopover();
});
window.addEventListener('resize', closeActivePopover);

if (new URLSearchParams(window.location.search).get('chart') === 'maximized') {
  document.body.classList.add('chart-maximized');
}
