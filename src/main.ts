import { Vela } from '@luxalgo/vela';
import type { EngineContextSnapshot, IndicatorHandle, ScriptRun } from '@luxalgo/vela';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';
import './style.css';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState, StateEffect, StateField, Prec } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { setIcon, icon } from './icons';
import { BASIC_SAMPLES } from './samples';
import { LIBRARY } from './scripts/library';
import {
  listScripts,
  saveScript,
  deleteScript,
  renameScript,
  toggleFavorite,
  isFavorite,
  loadEditorSnapshot,
  saveEditorSnapshot,
  loadLayout,
  saveLayout,
} from './storage';

const setRunErrorLine = StateEffect.define<number | null>();

const runErrorLine = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setRunErrorLine)) value = e.value;
    return value;
  },
});

const runErrorHighlight = EditorView.decorations.compute([runErrorLine], (state) => {
  const line = state.field(runErrorLine);
  if (line == null) return Decoration.none;
  if (line < 1 || line > state.doc.lines) return Decoration.none;
  const l = state.doc.line(line);
  return Decoration.set([Decoration.line({ class: 'cm-run-error' }).range(l.from)]);
});

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const outputEl = document.querySelector<HTMLDivElement>('#output')!;
const logsCountEl = document.querySelector<HTMLSpanElement>('#logs-count')!;
const logsToggleBtn = document.querySelector<HTMLButtonElement>('#logs-toggle')!;
const logsPanelEl = document.querySelector<HTMLElement>('#logs-panel')!;
const runBtn = document.querySelector<HTMLButtonElement>('#run')!;
const undoBtn = document.querySelector<HTMLButtonElement>('#undo')!;
const redoBtn = document.querySelector<HTMLButtonElement>('#redo')!;
const bookmarkBtn = document.querySelector<HTMLButtonElement>('#bookmark')!;
const cameraBtn = document.querySelector<HTMLButtonElement>('#camera')!;
const saveBtn = document.querySelector<HTMLButtonElement>('#save')!;
const saveAsBtn = document.querySelector<HTMLButtonElement>('#save-as')!;
const favoriteBtn = document.querySelector<HTMLButtonElement>('#favorite')!;
const panelToggleBtn = document.querySelector<HTMLButtonElement>('#panel-toggle')!;
const panelCloseBtn = document.querySelector<HTMLButtonElement>('#panel-close')!;
const pinePanel = document.querySelector<HTMLElement>('#editor-panel')!;
const panelResize = document.querySelector<HTMLDivElement>('#panel-resize')!;
const symbolBtn = document.querySelector<HTMLButtonElement>('#symbol-btn')!;
const symbolMenuEl = document.querySelector<HTMLDivElement>('#symbol-menu')!;
const tfBtn = document.querySelector<HTMLButtonElement>('#tf-btn')!;
const tfLabelEl = document.querySelector<HTMLSpanElement>('#tf-label')!;
const tfMenuEl = document.querySelector<HTMLDivElement>('#tf-menu')!;
const marketStateEl = document.querySelector<HTMLSpanElement>('#market-state')!;
const clockEl = document.querySelector<HTMLSpanElement>('#clock')!;
const scriptNameEl = document.querySelector<HTMLSpanElement>('#script-name')!;
const scriptMenuBtn = document.querySelector<HTMLButtonElement>('#script-menu-btn')!;
const scriptMenuEl = document.querySelector<HTMLDivElement>('#script-menu')!;
const indDialogBtn = document.querySelector<HTMLButtonElement>('#ind-dialog-btn')!;
const indDialog = document.querySelector<HTMLDivElement>('#ind-dialog')!;
const indDialogCloseBtn = document.querySelector<HTMLButtonElement>('#ind-dialog-close')!;
const indCatsEl = document.querySelector<HTMLDivElement>('#ind-cats')!;
const indItemsEl = document.querySelector<HTMLDivElement>('#ind-items')!;
const indSearchInput = document.querySelector<HTMLInputElement>('#ind-search')!;
const saveModal = document.querySelector<HTMLDivElement>('#save-modal')!;
const saveModalTitle = document.querySelector<HTMLSpanElement>('#save-modal-title')!;
const saveModalCloseBtn = document.querySelector<HTMLButtonElement>('#save-modal-close')!;
const saveNameInput = document.querySelector<HTMLInputElement>('#save-name')!;
const saveOkBtn = document.querySelector<HTMLButtonElement>('#save-ok')!;
const saveCancelBtn = document.querySelector<HTMLButtonElement>('#save-cancel')!;

const SYMBOLS = ['BTC', 'ETH'] as const;
const TIMEFRAMES = [
  { vela: '1', label: '1m' },
  { vela: '5', label: '5m' },
  { vela: '15', label: '15m' },
  { vela: '30', label: '30m' },
  { vela: '60', label: '1h' },
  { vela: '240', label: '4h' },
  { vela: 'D', label: '1D' },
  { vela: 'W', label: '1W' },
  { vela: 'M', label: '1M' },
] as const;

let symbol: (typeof SYMBOLS)[number] = 'BTC';
let timeframe = '60';

const chart = new Vela('#chart', {
  symbol: `hyperliquid:${symbol}`,
  timeframe,
  live: true,
  theme: 'dark',
}).registerEngine('pine', new PineWorkerEngine());

chart.data.registerProvider('hyperliquid', new HyperliquidProvider());

const NEW_TEMPLATE = `//@version=6
indicator("My Indicator", overlay=true)

plot(ta.ema(close, 14), "EMA 14", color.orange)
`;

const restoredSnapshot = loadEditorSnapshot();
const initialDoc = restoredSnapshot?.script ?? BASIC_SAMPLES[0].script;
const initialName = restoredSnapshot?.name ?? null;

const bound = new WeakSet<IndicatorHandle>();
const instanceSources = new Map<string, string>();

function fmt(v: number | null): string {
  if (v == null) return 'na';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(4);
}

let logsTotal = 0;

function log(level: 'ok' | 'err' | 'info', text: string) {
  logsTotal++;
  logsCountEl.textContent = `(${logsTotal})`;
  const row = document.createElement('div');
  row.className = `row ${level}`;
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = text;
  row.append(time, body);
  outputEl.appendChild(row);
  while (outputEl.childElementCount > 120) outputEl.firstElementChild!.remove();
  outputEl.scrollTop = outputEl.scrollHeight;
}

function setStatus(cls: 'pending' | 'ok' | 'err', text: string) {
  statusEl.className = `status ${cls}`;
  statusEl.textContent = text;
}

function parseLine(error: Error): number | null {
  const m = /\b(?:line|Ln)\s*#?(\d+)/i.exec(error.message);
  return m ? Number(m[1]) : null;
}

function highlightErrorLine(error: Error | null) {
  const line = error ? parseLine(error) : null;
  view.dispatch({ effects: setRunErrorLine.of(line) });
}

function showFailure(error: Error, context: EngineContextSnapshot | null) {
  setStatus('err', '脚本失败');
  log('err', error.message);
  if (context) {
    log('info', `context: phase=${context.phase} barIndex=${context.barIndex} title=${context.meta?.title ?? '—'}`);
  }
  highlightErrorLine(error);
}

function bindHandle(h: IndicatorHandle) {
  if (bound.has(h)) return;
  bound.add(h);
  h.on('ready', () => {
    setStatus('ok', `${chart.indicators().length} 个指标运行中`);
    log('ok', `ready · ${h.title}`);
    persistLayout();
  });
  h.on('error', ({ error }) => showFailure(error, null));
}

function persistLayout() {
  const items = chart.indicators()
    .filter((h) => h.source != null)
    .map((h) => ({
      source: h.source as string,
      visible: h.visible,
      savedName: instanceSources.get(h.id) ?? null,
    }));
  saveLayout(items);
}

function findHandle(id: string): IndicatorHandle | null {
  return chart.indicators().find((h) => h.id === id) ?? null;
}

let runChain: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>) {
  runChain = runChain.then(fn, fn);
}

let lastRunHandleId: string | null = null;

async function addIndicator(source: string, savedName: string | null) {
  const result = await chart.runIndicator(source);
  if (result.ok && result.handle) {
    bindHandle(result.handle);
    if (savedName) instanceSources.set(result.handle.id, savedName);
    else lastRunHandleId = result.handle.id;
    log('ok', `已添加指标 · ${result.handle.title} (id=${result.handle.id})`);
    refreshList();
    highlightErrorLine(null);
  } else {
    showFailure(result.error ?? new Error('unknown error'), result.context);
  }
}

function runCurrent(source: string | null = null, savedName: string | null = null) {
  enqueue(async () => {
    await addIndicator(source ?? view.state.doc.toString(), savedName);
  });
}

function syncInstances(name: string, doc: string) {
  const ids = [...instanceSources.entries()]
    .filter(([, n]) => n === name)
    .map(([id]) => id);
  let updated = 0;
  ids.forEach((id) => {
    const h = findHandle(id);
    if (h) {
      h.updateCode(doc);
      updated++;
    }
  });
  if (updated > 0) log('info', `已同步更新图上 ${updated} 个「${name}」实例`);
}

function refreshList() {
  const count = chart.indicators().length;
  setStatus(count > 0 ? 'ok' : 'pending', count > 0 ? `${count} 个指标在图` : '图表为空');
  renderFavoriteBtn();
}

function startNew() {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: NEW_TEMPLATE } });
  highlightErrorLine(null);
  currentName = null;
  savedContent = NEW_TEMPLATE;
  lastRunHandleId = null;
  renderScriptBar();
  persistEditorNow();
  refreshList();
  log('info', '新建脚本草稿，点 Run 上图为一个新指标');
}

const runKeymap = Prec.high(
  keymap.of([
    {
      key: 'Mod-Enter',
      preventDefault: true,
      run: () => {
        runCurrent();
        return true;
      },
    },
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        saveFlow();
        return true;
      },
    },
  ]),
);

function syncUndoButtons() {
  undoBtn.disabled = undoDepth(view.state) === 0;
  redoBtn.disabled = redoDepth(view.state) === 0;
}

const view = new EditorView({
  parent: document.querySelector<HTMLDivElement>('#editor')!,
  state: EditorState.create({
    doc: initialDoc,
    extensions: [
      basicSetup,
      javascript(),
      runErrorLine,
      runErrorHighlight,
      runKeymap,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          renderScriptBar();
          persistEditor();
        }
        syncUndoButtons();
      }),
    ],
  }),
});

let currentName: string | null = initialName;
let savedContent: string | null = initialDoc;

function extractTitle(source: string): string {
  const m = /(?:indicator|strategy|library)\s*\(\s*["']([^"']+)["']/.exec(source);
  return m?.[1] ?? '未命名脚本';
}

function renderScriptBar() {
  const dirty = view.state.doc.toString() !== savedContent;
  scriptNameEl.textContent = `${currentName ?? '未命名脚本'}${dirty ? ' *' : ''}`;
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function persistEditorNow() {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  saveEditorSnapshot({ script: view.state.doc.toString(), name: currentName });
}

function persistEditor() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(persistEditorNow, 300);
}

function loadScript(name: string, script: string, savedName: string | null = null, autoRun = true) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: script } });
  highlightErrorLine(null);
  currentName = savedName;
  savedContent = script;
  lastRunHandleId = null;
  renderScriptBar();
  renderFavoriteBtn();
  persistEditorNow();
  if (savedName) log('info', `已打开「${savedName}」`);
  else log('info', `加载「${name}」`);
  if (autoRun) runCurrent(script, savedName);
}

type SaveModalMode = 'save' | 'saveAs' | 'rename';
let saveModalMode: SaveModalMode = 'save';

function openSaveModal(m: SaveModalMode, prefill: string) {
  saveModalMode = m;
  saveModalTitle.textContent =
    m === 'save' ? '保存脚本' : m === 'saveAs' ? '另存为副本' : '重命名脚本';
  saveNameInput.value = prefill;
  saveModal.hidden = false;
  saveNameInput.focus();
  saveNameInput.select();
}

function closeSaveModal() {
  saveModal.hidden = true;
}

function confirmSaveModal() {
  const name = saveNameInput.value.trim();
  if (!name) {
    saveNameInput.focus();
    return;
  }
  const doc = view.state.doc.toString();
  if (saveModalMode === 'rename' && currentName) {
    const oldName = currentName;
    renameScript(oldName, name);
    for (const [id, n] of instanceSources) {
      if (n === oldName) instanceSources.set(id, name);
    }
    currentName = name;
    log('ok', `已重命名「${oldName}」→「${name}」`);
  } else {
    saveScript(name, doc);
    currentName = name;
    if (lastRunHandleId && findHandle(lastRunHandleId)) {
      instanceSources.set(lastRunHandleId, name);
      lastRunHandleId = null;
    }
    log('ok', `已保存脚本「${name}」（localStorage，共 ${listScripts().length} 个）`);
  }
  savedContent = doc;
  closeSaveModal();
  renderScriptBar();
  renderFavoriteBtn();
  persistEditorNow();
  syncInstances(name, doc);
}

function saveFlow() {
  if (!currentName) {
    openSaveModal('save', extractTitle(view.state.doc.toString()));
    return;
  }
  const doc = view.state.doc.toString();
  saveScript(currentName, doc);
  savedContent = doc;
  renderScriptBar();
  renderFavoriteBtn();
  persistEditorNow();
  log('ok', `已保存「${currentName}」`);
  syncInstances(currentName, doc);
}

function saveAsFlow() {
  openSaveModal('saveAs', currentName ? `${currentName} copy` : extractTitle(view.state.doc.toString()));
}

function renameFlow() {
  if (currentName) openSaveModal('rename', currentName);
  else openSaveModal('saveAs', extractTitle(view.state.doc.toString()));
}

function renderFavoriteBtn() {
  const active = currentName != null && isFavorite(currentName);
  favoriteBtn.classList.toggle('active', active);
  setIcon(favoriteBtn, active ? 'star-filled' : 'star', 14);
  favoriteBtn.title = active ? `取消收藏「${currentName}」` : '收藏当前脚本';
}

function injectIcons() {
  setIcon(undoBtn, 'undo-2', 14);
  setIcon(redoBtn, 'redo-2', 14);
  setIcon(bookmarkBtn, 'bookmark', 14);
  setIcon(cameraBtn, 'camera', 14);
  setIcon(panelToggleBtn, 'code-xml', 14);
  setIcon(saveBtn, 'save', 14);
  setIcon(saveAsBtn, 'copy', 14);
  setIcon(panelCloseBtn, 'x', 14);
  setIcon(indDialogCloseBtn, 'x', 14);
  setIcon(saveModalCloseBtn, 'x', 14);
  document.querySelector('.ind-icon')?.replaceWith(icon('chart-line', 14));
  document.querySelector('.run-icon')?.replaceWith(icon('play', 12));
  renderFavoriteBtn();
  syncUndoButtons();
}

undoBtn.addEventListener('click', () => undo(view));
redoBtn.addEventListener('click', () => redo(view));
bookmarkBtn.addEventListener('click', () => openIndDialog('favorites'));
cameraBtn.addEventListener('click', () => {
  const url = chart.renderer.screenshot();
  if (!url) {
    log('info', '图表尚未就绪，无法截图');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `${symbol}-${tfLabel(timeframe)}-${Date.now()}.png`;
  a.click();
  log('ok', '已导出图表截图 PNG');
});

favoriteBtn.addEventListener('click', () => {
  if (!currentName) {
    log('info', '先保存脚本（Ctrl+S）才能收藏');
    return;
  }
  toggleFavorite(currentName);
  renderFavoriteBtn();
  log('ok', isFavorite(currentName) ? `已收藏「${currentName}」` : `已取消收藏「${currentName}」`);
});

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function closeScriptMenu() {
  scriptMenuEl.hidden = true;
}

function menuNote(text: string) {
  const el = document.createElement('div');
  el.className = 'menu-note';
  el.textContent = text;
  return el;
}

function menuGroupLabel(text: string) {
  const el = document.createElement('div');
  el.className = 'menu-group-label';
  el.textContent = text;
  return el;
}

function menuItem(label: string, hint: string | null, action: () => void) {
  const btn = document.createElement('button');
  btn.className = 'menu-item';
  const l = document.createElement('span');
  l.textContent = label;
  btn.appendChild(l);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'menu-hint';
    h.textContent = hint;
    btn.appendChild(h);
  }
  btn.addEventListener('click', () => {
    closeScriptMenu();
    action();
  });
  return btn;
}

function renderScriptMenu() {
  scriptMenuEl.innerHTML = '';
  scriptMenuEl.appendChild(menuGroupLabel('FAVORITE SCRIPTS'));
  const favs = listScripts().filter((s) => s.favorite);
  if (favs.length === 0) {
    scriptMenuEl.appendChild(menuNote('还没有收藏的脚本 — 点 ★ 收藏正在编辑的脚本'));
  } else {
    favs.forEach((s) => {
      scriptMenuEl.appendChild(
        menuItem(s.name, fmtTime(s.savedAt), () => loadScript(s.name, s.script, s.name, false)),
      );
    });
  }
  scriptMenuEl.appendChild(sepEl());
  scriptMenuEl.appendChild(menuGroupLabel('RECENT SCRIPTS'));
  const recent = listScripts().slice(0, 5);
  if (recent.length === 0) {
    scriptMenuEl.appendChild(menuNote('还没有保存的脚本'));
  } else {
    recent.forEach((s) => {
      scriptMenuEl.appendChild(
        menuItem(s.name, fmtTime(s.savedAt), () => loadScript(s.name, s.script, s.name, false)),
      );
    });
  }
  scriptMenuEl.appendChild(sepEl());
  scriptMenuEl.appendChild(menuItem('保存脚本', 'Ctrl+S', saveFlow));
  scriptMenuEl.appendChild(menuItem('另存为副本', null, saveAsFlow));
  scriptMenuEl.appendChild(menuItem(currentName ? '重命名' : '保存为新脚本', null, renameFlow));
  scriptMenuEl.appendChild(menuItem('打开脚本…', null, () => openIndDialog('personal')));
  scriptMenuEl.appendChild(sepEl());
  scriptMenuEl.appendChild(menuItem('+ 新建脚本', null, startNew));
}

function sepEl() {
  const el = document.createElement('div');
  el.className = 'menu-sep';
  return el;
}

scriptMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (scriptMenuEl.hidden) {
    renderScriptMenu();
    scriptMenuEl.hidden = false;
  } else {
    closeScriptMenu();
  }
});
document.addEventListener('click', (e) => {
  if (!scriptMenuEl.hidden && !scriptMenuEl.contains(e.target as Node)) closeScriptMenu();
});

type CatKey = 'favorites' | 'basic' | 'library' | 'personal';
let activeCat: CatKey = 'personal';

interface CatDef {
  key: CatKey;
  name: string;
}

const CAT_GROUPS: Array<{ label: string | null; items: CatDef[] }> = [
  { label: null, items: [{ key: 'favorites', name: '收藏' }] },
  {
    label: '内置',
    items: [
      { key: 'basic', name: '内置示例' },
      { key: 'library', name: 'LuxAlgo Library' },
    ],
  },
  { label: '个人', items: [{ key: 'personal', name: '我的脚本' }] },
];

interface CatEntry {
  name: string;
  script?: string;
  savedAt?: number;
  favorite?: boolean;
}

function catEntries(cat: CatKey): CatEntry[] {
  if (cat === 'favorites') return listScripts().filter((s) => s.favorite);
  if (cat === 'personal') return listScripts();
  if (cat === 'basic') return BASIC_SAMPLES.map((s) => ({ name: s.name, script: s.script }));
  return LIBRARY.map((s) => ({ name: s.name, script: s.script }));
}

function renderIndDialog() {
  indCatsEl.innerHTML = '';
  CAT_GROUPS.forEach((group) => {
    if (group.label) {
      const gl = document.createElement('div');
      gl.className = 'cat-group-label';
      gl.textContent = group.label;
      indCatsEl.appendChild(gl);
    }
    group.items.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = `cat-item${c.key === activeCat ? ' active' : ''}`;
      const label = document.createElement('span');
      label.textContent = c.name;
      const count = document.createElement('span');
      count.className = 'cat-count';
      count.textContent = String(catEntries(c.key).length);
      btn.append(label, count);
      btn.addEventListener('click', () => {
        activeCat = c.key;
        indSearchInput.value = '';
        renderIndDialog();
      });
      indCatsEl.appendChild(btn);
    });
  });

  const q = indSearchInput.value.trim().toLowerCase();
  const entries = catEntries(activeCat).filter((s) => !q || s.name.toLowerCase().includes(q));
  const isSaved = activeCat === 'personal' || activeCat === 'favorites';
  indItemsEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-empty';
    empty.textContent = activeCat === 'personal' && !q
      ? '还没有保存的脚本，在 Pine Editor 里写好后点「保存」'
      : activeCat === 'favorites' && !q
        ? '还没有收藏的脚本 — 在「我的脚本」里点条目星标收藏'
        : '没有匹配的脚本';
    indItemsEl.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'ind-item';

    if (isSaved) {
      const star = document.createElement('button');
      star.className = `item-star${entry.favorite ? ' on' : ''}`;
      star.textContent = entry.favorite ? '★' : '☆';
      star.title = entry.favorite ? '取消收藏' : '收藏';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(entry.name);
        renderIndDialog();
      });
      row.appendChild(star);
    }

    const info = document.createElement('div');
    info.className = 'saved-info';
    const name = document.createElement('span');
    name.className = 'saved-name';
    name.textContent = entry.name;
    info.appendChild(name);
    if (entry.savedAt) {
      const time = document.createElement('span');
      time.className = 'saved-time';
      time.textContent = fmtTime(entry.savedAt);
      info.appendChild(time);
    }

    const bar = document.createElement('span');
    bar.className = 'ind-actions';

    if (isSaved && entry.script) {
      const edit = document.createElement('button');
      edit.textContent = '编辑';
      edit.title = '打开到编辑器（不上图）';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        indDialog.hidden = true;
        loadScript(entry.name, entry.script!, entry.name, false);
      });
      const del = document.createElement('button');
      del.textContent = '删除';
      del.className = 'danger';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteScript(entry.name);
        renderIndDialog();
        renderFavoriteBtn();
        log('info', `已删除保存的脚本「${entry.name}」`);
      });
      bar.append(edit, del);
    }

    const add = document.createElement('button');
    add.textContent = '添加';
    add.className = 'primary small';
    add.title = '作为新指标添加到图表';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      loadScript(entry.name, entry.script!, isSaved ? entry.name : null, true);
    });
    bar.appendChild(add);

    row.addEventListener('click', () => {
      loadScript(entry.name, entry.script!, isSaved ? entry.name : null, true);
    });

    row.append(info, bar);
    indItemsEl.appendChild(row);
  });
}

function openIndDialog(cat: CatKey = activeCat) {
  activeCat = cat;
  indSearchInput.value = '';
  renderIndDialog();
  indDialog.hidden = false;
}

indDialogBtn.addEventListener('click', () => openIndDialog());
indDialogCloseBtn.addEventListener('click', () => {
  indDialog.hidden = true;
});
indDialog.addEventListener('click', (e) => {
  if (e.target === indDialog) indDialog.hidden = true;
});
indSearchInput.addEventListener('input', renderIndDialog);

saveBtn.addEventListener('click', saveFlow);
saveAsBtn.addEventListener('click', saveAsFlow);
saveOkBtn.addEventListener('click', confirmSaveModal);
saveCancelBtn.addEventListener('click', closeSaveModal);
saveModalCloseBtn.addEventListener('click', closeSaveModal);
saveModal.addEventListener('click', (e) => {
  if (e.target === saveModal) closeSaveModal();
});
saveNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmSaveModal();
  if (e.key === 'Escape') closeSaveModal();
});

runBtn.addEventListener('click', () => runCurrent());

function expandPanel() {
  pinePanel.classList.remove('collapsed');
  panelToggleBtn.classList.add('active');
}

function collapsePanel() {
  pinePanel.classList.add('collapsed');
  panelToggleBtn.classList.remove('active');
}

panelCloseBtn.addEventListener('click', collapsePanel);
panelToggleBtn.addEventListener('click', () => {
  if (pinePanel.classList.contains('collapsed')) expandPanel();
  else collapsePanel();
});

panelResize.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const onMove = (ev: MouseEvent) => {
    const w = Math.min(760, Math.max(360, window.innerWidth - ev.clientX));
    pinePanel.style.width = `${w}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});
logsToggleBtn.addEventListener('click', () => {
  logsPanelEl.classList.toggle('collapsed');
});

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

panelToggleBtn.classList.add('active');
injectIcons();

chart.on('script:run', (runInfo: ScriptRun) => {
  if (runInfo.cause === 'tick' || runInfo.cause === 'viewport') return;
  const plots = Object.entries(runInfo.plots)
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(' · ');
  const strat = runInfo.strategy
    ? ` · pos=${runInfo.strategy.position} equity=${fmt(runInfo.strategy.equity)}`
    : '';
  log('info', `script:run · ${runInfo.title} · cause=${runInfo.cause} bar=${runInfo.bar}${strat}`);
  if (plots) log('ok', `plots@bar: ${plots}`);
});

chart.on('indicator:added', ({ id }) => {
  const h = chart.indicators().find((x) => x.id === id);
  if (h) bindHandle(h);
  refreshList();
});

chart.on('indicator:removed', ({ id }) => {
  instanceSources.delete(id);
  persistLayout();
  refreshList();
});

chart.on('load:end', ({ bars }) => {
  if (bars > 0) {
    marketStateEl.textContent = `hyperliquid · ${symbol}USDT ${tfLabel(timeframe)} · live`;
    marketStateEl.classList.add('on');
  } else {
    marketStateEl.textContent = '加载失败';
    marketStateEl.classList.remove('on');
  }
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveFlow();
  }
});

window.addEventListener('resize', () => chart.resize());

function tfLabel(v: string): string {
  return TIMEFRAMES.find((t) => t.vela === v)?.label ?? v;
}

function closeMarketMenus() {
  symbolMenuEl.hidden = true;
  tfMenuEl.hidden = true;
}

function renderMarketMenus() {
  symbolMenuEl.innerHTML = '';
  (SYMBOLS as readonly string[]).forEach((s) => {
    const b = document.createElement('button');
    b.className = `menu-item pick${s === symbol ? ' active' : ''}`;
    b.textContent = `${s}USDT`;
    b.addEventListener('click', () => {
      closeMarketMenus();
      if (s === symbol) return;
      symbol = s as (typeof SYMBOLS)[number];
      renderMarket();
      void chart.setMarket({ symbol: `hyperliquid:${symbol}` });
      log('info', `切换品种 → ${symbol}USDT`);
    });
    symbolMenuEl.appendChild(b);
  });
  tfMenuEl.innerHTML = '';
  TIMEFRAMES.forEach((t) => {
    const b = document.createElement('button');
    b.className = `menu-item pick${t.vela === timeframe ? ' active' : ''}`;
    b.textContent = t.label;
    b.addEventListener('click', () => {
      closeMarketMenus();
      if (t.vela === timeframe) return;
      timeframe = t.vela;
      renderMarket();
      void chart.setMarket({ timeframe });
      log('info', `切换周期 → ${t.label}`);
    });
    tfMenuEl.appendChild(b);
  });
}

function renderMarket() {
  symbolBtn.textContent = `${symbol}USDT`;
  tfLabelEl.textContent = tfLabel(timeframe);
  renderMarketMenus();
}
renderMarket();

symbolBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const wasHidden = symbolMenuEl.hidden;
  closeMarketMenus();
  if (wasHidden) {
    symbolMenuEl.hidden = false;
  }
});
tfBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const wasHidden = tfMenuEl.hidden;
  closeMarketMenus();
  if (wasHidden) {
    tfMenuEl.hidden = false;
  }
});
document.addEventListener('click', (e) => {
  const t = e.target as Node;
  if (!symbolMenuEl.hidden && !symbolMenuEl.contains(t)) symbolMenuEl.hidden = true;
  if (!tfMenuEl.hidden && !tfMenuEl.contains(t)) tfMenuEl.hidden = true;
});

void (async () => {
  await chart.ready();
  await chart.historyComplete().catch(() => undefined);
  log('info', '图表就绪 · Hyperliquid 免认证实时数据（BTC/ETH，1m–1M）');
  const layout = loadLayout();
  if (layout.length > 0) {
    let ok = 0;
    for (const item of layout) {
      const r = await chart.runIndicator(item.source);
      if (r.ok && r.handle) {
        bindHandle(r.handle);
        if (item.savedName) instanceSources.set(r.handle.id, item.savedName);
        if (!item.visible) r.handle.setVisible(false);
        ok++;
      } else if (r.error) {
        log('err', `布局恢复跳过一个指标: ${r.error.message}`);
      }
    }
    refreshList();
    if (ok > 0) {
      log('ok', `已恢复上次的图表布局（${ok}/${layout.length} 个指标）`);
      if (restoredSnapshot) {
        renderScriptBar();
        log(
          'info',
          restoredSnapshot.name
            ? `编辑器恢复「${restoredSnapshot.name}」`
            : '编辑器恢复上次未保存的草稿',
        );
      }
      return;
    }
  }
  if (restoredSnapshot) {
    renderScriptBar();
    log(
      'info',
      restoredSnapshot.name ? `编辑器恢复「${restoredSnapshot.name}」` : '编辑器恢复上次未保存的草稿',
    );
    setStatus('pending', '点 Run 或从「指标」对话框上图');
    return;
  }
  setStatus('pending', '首次注入…');
  loadScript('EMA 20 + Bands (overlay)', BASIC_SAMPLES[0].script);
})();
