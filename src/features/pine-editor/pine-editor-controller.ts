import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { extractPineTitle, NEW_PINE_SCRIPT } from '../../domain/pine-source.ts';
import type { EditorRepository } from '../../domain/ports/editor-repository.ts';
import type { ScriptServicePort } from '../../domain/ports/script-service.ts';
import { icon, setIcon } from '../../icons.ts';
import { BASIC_SAMPLES } from '../../samples.ts';
import { formatTime, makeButton } from '../../shared/dom.ts';
import { OverlayManager } from '../../shared/overlays.ts';
import { openTextDialog } from '../../shared/text-dialog.ts';

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

export interface PineEditorHost {
  runIndicator(name: string, source: string): void;
}

export class PineEditorController {
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
  private destroyed = false;
  private readonly closeMenuOnDocumentClick: (event: MouseEvent) => void;

  constructor(
    body: HTMLElement,
    headerSlot: HTMLElement,
    private readonly scripts: ScriptServicePort,
    private readonly editorRepository: EditorRepository,
    private readonly overlays: OverlayManager,
    private readonly host: PineEditorHost,
  ) {
    body.classList.add('quant-pine-body');
    headerSlot.classList.add('quant-pine-header-slot');

    const snapshot = this.editorRepository.load();
    const saved = snapshot?.name ? this.scripts.get(snapshot.name) ?? null : null;
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener('click', this.closeMenuOnDocumentClick);
    if (this.snapshotTimer) this.persistNow();
    this.view.destroy();
  }

  openSavedScript(name: string, source: string): void {
    this.replaceDocument(source, name, null);
    this.view.focus();
  }

  openIndicatorSource(name: string, source: string): void {
    this.replaceDocument(source, null, name);
    this.view.focus();
  }

  openNewScript(): void {
    this.replaceDocument(NEW_PINE_SCRIPT, null, null);
    this.view.focus();
  }

  detachDeletedScript(name: string): void {
    if (this.currentName !== name) return;
    this.currentName = null;
    this.draftTitle = name;
    this.savedContent = null;
    this.persistNow();
    this.renderTitle();
    this.renderFavorite();
    this.log('info', `已删除保存的脚本「${name}」，编辑区内容保留为草稿`);
  }

  log(level: 'info' | 'ok' | 'error', message: string): void {
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

  reportError(error: Error, source?: string): void {
    this.log('error', error.message);
    if (source && source !== this.view.state.doc.toString()) return;
    const match = /\b(?:line|Ln)\s*#?(\d+)/i.exec(error.message);
    this.view.dispatch({ effects: setRunErrorLine.of(match ? Number(match[1]) : null) });
  }

  private renderTitle(): void {
    const dirty = this.view.state.doc.toString() !== this.savedContent;
    this.scriptName.textContent = `${this.currentName ?? this.draftTitle ?? '未命名脚本'}${dirty ? ' *' : ''}`;
  }

  private renderFavorite(): void {
    const active = this.currentName != null && this.scripts.isFavorite(this.currentName);
    this.favoriteButton.classList.toggle('active', active);
    setIcon(this.favoriteButton, active ? 'star-filled' : 'star', 15);
    this.favoriteButton.title = active ? '取消收藏当前脚本' : '收藏当前脚本';
  }

  private persistNow(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.editorRepository.save({ script: this.view.state.doc.toString(), name: this.currentName });
  }

  private persistSoon(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.persistNow(), 250);
  }

  private replaceDocument(source: string, name: string | null, draftTitle: string | null = null): void {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: source } });
    this.view.dispatch({ effects: setRunErrorLine.of(null) });
    this.currentName = name;
    this.draftTitle = draftTitle;
    this.savedContent = source;
    this.renderTitle();
    this.renderFavorite();
    this.persistNow();
  }

  private run(): void {
    const source = this.view.state.doc.toString();
    const title = extractPineTitle(source);
    try {
      this.host.runIndicator(title, source);
      this.view.dispatch({ effects: setRunErrorLine.of(null) });
      this.log('info', `已提交运行 · ${title}`);
    } catch (reason) {
      this.reportError(reason instanceof Error ? reason : new Error(String(reason)), source);
    }
  }

  private save(): void {
    const source = this.view.state.doc.toString();
    if (!this.currentName) {
      this.openSaveDialog('保存脚本', this.draftTitle ?? extractPineTitle(source), false);
      return;
    }
    this.scripts.save(this.currentName, source);
    this.savedContent = source;
    this.persistNow();
    this.renderTitle();
    this.renderFavorite();
    this.log('ok', `已保存「${this.currentName}」`);
  }

  private saveAs(): void {
    const suggestion = this.currentName
      ? `${this.currentName} copy`
      : this.draftTitle ?? extractPineTitle(this.view.state.doc.toString());
    this.openSaveDialog('另存为副本', suggestion, false);
  }

  private openSaveDialog(title: string, initialValue: string, rename: boolean): void {
    openTextDialog(this.overlays, {
      title,
      label: '脚本名称',
      initialValue,
      onConfirm: (name) => {
        if (!name) return '请输入脚本名称';
        const duplicate = this.scripts.list().some((script) => script.name === name);
        if (duplicate && !(rename && name === this.currentName)) return `脚本「${name}」已存在`;
        const source = this.view.state.doc.toString();
        if (rename && this.currentName) {
          const oldName = this.currentName;
          this.scripts.rename(oldName, name, source);
          this.log('ok', `已重命名「${oldName}」→「${name}」`);
        } else {
          this.scripts.save(name, source);
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

  private toggleCurrentFavorite(): void {
    if (!this.currentName) {
      this.log('info', '请先保存脚本，再收藏');
      return;
    }
    this.scripts.toggleFavorite(this.currentName);
    this.renderFavorite();
    this.log(
      'ok',
      this.scripts.isFavorite(this.currentName)
        ? `已收藏「${this.currentName}」`
        : `已取消收藏「${this.currentName}」`,
    );
  }

  private renderMenu(): void {
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
    const favorites = this.scripts.list().filter((script) => script.favorite);
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
    const recent = this.scripts.list().slice(0, 6);
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
        this.currentName ?? this.draftTitle ?? extractPineTitle(this.view.state.doc.toString()),
        this.currentName != null,
      );
    });
    if (this.currentName) {
      addItem('删除当前脚本', () => {
        const deletedName = this.currentName;
        if (!deletedName) return;
        this.scripts.delete(deletedName);
        this.currentName = null;
        this.draftTitle = deletedName;
        this.savedContent = null;
        this.persistNow();
        this.renderTitle();
        this.renderFavorite();
        this.log('info', `已删除保存的脚本「${deletedName}」，编辑区内容保留为草稿`);
      });
    }
    addItem('+ 新建脚本', () => this.replaceDocument(NEW_PINE_SCRIPT, null, null));
  }
}
