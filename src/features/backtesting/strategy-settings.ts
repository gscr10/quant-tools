import type {
  BacktestSettingSchema,
  BacktestSettingType,
  BacktestSettingValue,
  BacktestSettingsSnapshot,
} from '../../domain/ports/backtest-settings.ts';
import { resolveBacktestSettingValues, validateBacktestSettingsDraft } from '../../domain/backtest-settings.ts';
import type { SettingsControlsPort, SettingsSelectPopover } from '../../shared/settings-controls.ts';
import { temporalField } from './settings-temporal.ts';

export interface StrategySettingsPanelOptions {
  /** Optional host UI kit. A standalone renderer retains native form controls. */
  controls?: SettingsControlsPort;
  /** Commit both tabs in one execution; a failed host setter may mutate state. */
  onApply: (
    snapshot: BacktestSettingsSnapshot,
    inputs: Record<string, BacktestSettingValue>,
    props: Record<string, BacktestSettingValue>,
  ) => boolean | Promise<boolean>;
  /** Read host state after a rejected commit; never reuse the optimistic draft. */
  onReadAfterFailure?: (snapshot: BacktestSettingsSnapshot) => BacktestSettingsSnapshot | null;
  onClose?: () => void;
}

function create<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function actionButton(
  doc: Document,
  label: string,
  className: string,
): HTMLButtonElement {
  const node = create(doc, 'button', className);
  node.type = 'button';
  node.textContent = label;
  return node;
}

function chevron(doc: Document, up = false): HTMLElement {
  const wrapper = create(doc, 'span', 'quant-backtest-settings-control-icon');
  wrapper.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', up ? 'M3.5 10 8 5.5 12.5 10' : 'M3.5 6 8 10.5 12.5 6');
  svg.append(path);wrapper.append(svg);
  return wrapper;
}

function cloneValues(values: Readonly<Record<string, BacktestSettingValue>>): Record<string, BacktestSettingValue> {
  return { ...values };
}

/** Settings DTOs contain only records, arrays and primitive field values. */
function sameSettingsData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameSettingsData(value, right[index]));
  }
  const previous = left as Record<string, unknown>;
  const next = right as Record<string, unknown>;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length
    && keys.every((key) => Object.hasOwn(next, key) && sameSettingsData(previous[key], next[key]));
}

function valueFor(
  schema: BacktestSettingSchema,
  values: Readonly<Record<string, BacktestSettingValue>>,
): BacktestSettingValue {
  return values[schema.key] ?? schema.defval;
}

function isVisible(
  schema: BacktestSettingSchema,
  values: Readonly<Record<string, BacktestSettingValue>>,
): boolean {
  const when = schema.when;
  if (!when) return true;
  const conditions = Array.isArray(when) ? when : [when];
  return conditions.every((condition) => {
    const current = values[condition.key];
    if (condition.anyOf) return condition.anyOf.some((candidate: BacktestSettingValue) => candidate === current);
    return condition.equals === undefined || condition.equals === current;
  });
}

const BAR_MAGNIFIER_PROP = 'use_bar_magnifier';
const SOURCE_OPTIONS = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume', 'hlcc4'];
const TIMEFRAME_OPTIONS = [
  ['', 'Chart'], ['1', '1 minute'], ['3', '3 minutes'], ['5', '5 minutes'],
  ['15', '15 minutes'], ['30', '30 minutes'], ['45', '45 minutes'],
  ['60', '1 hour'], ['120', '2 hours'], ['180', '3 hours'], ['240', '4 hours'],
  ['D', '1 day'], ['W', '1 week'], ['M', '1 month'],
] as const;

// A document has one active settings modal. Opening another workspace's
// settings dismisses the previous surface before acquiring its background.
// Simultaneous independently trapped modals would inert each other's hosts.
const activeSettingsModal = new WeakMap<Document, StrategySettingsPanel>();
const modalInertOwners = new WeakMap<HTMLElement, { count: number; previous: boolean }>();

function isBacktestPrecision(schema: BacktestSettingSchema): boolean {
  return schema.key === BAR_MAGNIFIER_PROP && schema.type === 'bool';
}

/**
 * Inputs/Properties dialog scoped to the selected strategy. Settings remain
 * renderer-neutral DTOs and commit through BacktestControlPort; dropdown
 * presentation uses Vela's public UI kit to match the chart's own controls.
 */
export class StrategySettingsPanel {
  readonly element: HTMLElement;

  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panel: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly status: HTMLElement;
  private readonly applyButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly options: StrategySettingsPanelOptions;
  private snapshot: BacktestSettingsSnapshot | null = null;
  private inputs: Record<string, BacktestSettingValue> = {};
  private props: Record<string, BacktestSettingValue> = {};
  private activeTab: 'inputs' | 'properties' = 'inputs';
  private dirty = false;
  private busy = false;
  // A delayed apply belongs to the dialog session that submitted it, not a
  // strategy opened later while that request was still in flight.
  private session = 0;
  private errorMessage = '';
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;
  private readonly inertElements = new Set<HTMLElement>();
  private modalObserver: MutationObserver | null = null;
  private layoutObserver: ResizeObserver | null = null;
  private layoutFrame: number | null = null;
  private selectPopover: SettingsSelectPopover | null = null;
  private controlCleanups: Array<() => void> = [];
  private offset = { x: 0, y: 0 };
  private appliedOffset = { x: 0, y: 0 };
  private drag: { pointer: number; x: number; y: number; offsetX: number; offsetY: number } | null = null;
  private readonly constrainFocus = (event: FocusEvent): void => {
    if (this.isOpen && event.target instanceof Node && !this.element.contains(event.target)) {
      this.focusableElements()[0]?.focus();
    }
  };

  constructor(doc: Document, options: StrategySettingsPanelOptions) {
    this.options = options;
    this.element = create(doc, 'section', 'quant-backtest-settings');
    // These controls use the English reference labels and native sans-serif
    // metrics, independently of the application's document language.
    this.element.lang = 'en';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    // The full-screen backdrop blocks pointer interaction; keyboard and
    // accessibility semantics must enforce the same modal boundary.
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Strategy settings');
    this.element.tabIndex = -1;

    // The backdrop is a pointer hit target, not a second close control. A
    // button here is exposed by browser accessibility trees even with
    // `tabindex=-1`, so VoiceOver announces a duplicate "Close strategy
    // settings" action before the real dialog close button. Keep it purely
    // presentational and leave the labelled header button as the only modal
    // close action in the accessibility tree.
    const backdrop = create(doc, 'div', 'quant-backtest-settings-backdrop');
    backdrop.setAttribute('aria-hidden', 'true');
    let dismissedSelect = false;
    backdrop.addEventListener('pointerdown', (event) => { dismissedSelect = this.options.controls?.dismissedPopover(event) ?? false; });
    backdrop.addEventListener('click', () => {
      if (!dismissedSelect) this.close();
      dismissedSelect = false;
    });

    const dialog = create(doc, 'div', 'quant-backtest-settings-dialog');
    this.dialog = dialog;
    const header = create(doc, 'header', 'quant-backtest-settings-header');
    this.wireDrag(header);
    const heading = create(doc, 'div', 'quant-backtest-settings-heading');
    this.title = create(doc, 'h2');
    this.subtitle = create(doc, 'span');
    heading.append(this.title, this.subtitle);
    this.closeButton = actionButton(doc, '', 'quant-backtest-settings-close');
    const closeIcon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('viewBox', '0 0 16 16');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeIcon.classList.add('quant-backtest-icon');
    const closePath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('d', 'm3.8 3.8 8.4 8.4M12.2 3.8l-8.4 8.4');
    closeIcon.appendChild(closePath);
    this.closeButton.appendChild(closeIcon);
    this.closeButton.setAttribute('aria-label', 'Close strategy settings');
    this.closeButton.addEventListener('click', () => this.close());
    header.append(heading, this.closeButton);

    const tabList = create(doc, 'div', 'quant-backtest-settings-tabs');
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Strategy settings sections');
    tabList.setAttribute('aria-orientation', 'horizontal');
    this.tabs.push(
      this.makeTab(doc, tabList, 'inputs', 'Inputs'),
      this.makeTab(doc, tabList, 'properties', 'Properties'),
    );

    // A form cannot take the tabpanel role. Keep native submit behavior inside
    // a labelled panel shared by the two tabs.
    this.panel = create(doc, 'div', 'quant-backtest-settings-form');
    this.panel.id = 'quant-backtest-settings-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.panel.tabIndex = 0;
    this.form = create(doc, 'form');
    this.panel.append(this.form);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.commit();
    });
    this.form.addEventListener('change', (event) => this.onFieldChange(event));

    const footer = create(doc, 'footer', 'quant-backtest-settings-footer');
    this.status = create(doc, 'p', 'quant-backtest-settings-status');
    this.status.setAttribute('role', 'status');
    const actions = create(doc, 'div', 'quant-backtest-settings-actions');
    this.resetButton = actionButton(doc, 'Reset defaults', 'quant-backtest-button');
    this.resetButton.addEventListener('click', () => this.resetDefaults());
    this.cancelButton = actionButton(doc, 'Cancel', 'quant-backtest-button');
    this.cancelButton.addEventListener('click', () => this.close());
    this.applyButton = actionButton(doc, 'Ok', 'quant-backtest-button quant-backtest-button-primary');
    this.applyButton.addEventListener('click', () => void this.commit());
    actions.append(this.resetButton, this.cancelButton, this.applyButton);
    footer.append(this.status, actions);

    dialog.append(header, tabList, this.panel, footer);
    this.element.append(backdrop, dialog);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (this.selectPopover) this.closeSelect();
        else this.close();
      } else if (event.key === 'Tab') {
        // Own the complete traversal, not only its endpoints. WebKit's
        // default keyboard-access mode skips native buttons, so its actual
        // last Tab stop can differ from this list and escape to browser chrome.
        event.preventDefault();
        event.stopPropagation();
        const fields = this.focusableElements();
        const index = fields.indexOf(doc.activeElement as HTMLElement);
        const next = index < 0
          ? (event.shiftKey ? fields.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + fields.length) % fields.length;
        (fields[next] ?? this.element).focus();
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  get currentKey(): BacktestSettingsSnapshot['key'] | null {
    return this.snapshot?.key ?? null;
  }

  open(snapshot: BacktestSettingsSnapshot, invokingElement?: HTMLElement | null): void {
    if (this.destroyed) return;
    const doc = this.element.ownerDocument;
    const previous = activeSettingsModal.get(doc);
    if (previous && previous !== this) previous.close();
    activeSettingsModal.set(doc, this);
    if (!this.isOpen) {
      const active = this.element.ownerDocument.activeElement;
      this.returnFocus = invokingElement?.isConnected
        ? invokingElement
        : active instanceof HTMLElement ? active : null;
    }
    const session = ++this.session;
    this.snapshot = snapshot;
    this.inputs = cloneValues(snapshot.inputValues);
    this.props = cloneValues(snapshot.propValues);
    this.activeTab = snapshot.inputs.length > 0 ? 'inputs' : 'properties';
    this.dirty = false;
    this.busy = false;
    this.errorMessage = '';
    this.offset = { x: 0, y: 0 };
    this.appliedOffset = { x: 0, y: 0 };
    this.dialog.style.transform = '';
    this.element.hidden = false;
    this.activateModal();
    this.observeLayout();
    this.render();
    queueMicrotask(() => {
      if (!this.destroyed && this.isOpen && this.session === session) (this.firstField() ?? this.closeButton).focus();
    });
  }

  /** Refresh values after a successful run without replacing an in-progress edit. */
  update(snapshot: BacktestSettingsSnapshot | null): void {
    if (!snapshot) {
      this.close();
      return;
    }
    if (!this.snapshot || this.snapshot.key.cellId !== snapshot.key.cellId
      || this.snapshot.key.indicatorId !== snapshot.key.indicatorId) {
      if (this.isOpen) this.open(snapshot);
      return;
    }
    const changed = !sameSettingsData(this.snapshot, snapshot);
    const structureChanged = this.snapshot.title !== snapshot.title
      || this.snapshot.source !== snapshot.source
      || !sameSettingsData(this.snapshot.inputs, snapshot.inputs)
      || !sameSettingsData(this.snapshot.props, snapshot.props);
    this.snapshot = snapshot;
    if (!this.dirty && changed) {
      this.inputs = cloneValues(snapshot.inputValues);
      this.props = cloneValues(snapshot.propValues);
      this.render();
    } else if (this.dirty && structureChanged) {
      // A genuine schema/title change still updates the form, preserving
      // existing draft values for surviving keys and validating on Apply.
      this.render();
    }
    // A report revision alone does not change Settings. Replacing identical
    // fields here closes an open Vela dropdown and moves focus before its
    // option can be selected (e.g. a history completion between two clicks).
  }

  close(): void {
    if (this.destroyed || this.element.hidden) return;
    this.session++;
    this.element.hidden = true;
    this.busy = false;
    this.releaseModal();
    this.options.onClose?.();
    this.restoreFocus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.session++;
    this.releaseModal();
    this.restoreFocus();
    this.element.remove();
    this.snapshot = null;
  }

  private focusableElements(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')]
      .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled')
        && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0);
  }

  private activateModal(): void {
    const doc = this.element.ownerDocument;
    const isolate = () => {
      // Keep the ancestor path enabled, isolating siblings at every level.
      // This also works when the panel is nested inside a workspace cell.
      for (let branch: HTMLElement | null = this.element; branch?.parentElement; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (!(sibling instanceof HTMLElement) || sibling === branch || this.inertElements.has(sibling)) continue;
          const ownership = modalInertOwners.get(sibling) ?? { count: 0, previous: sibling.inert };
          ownership.count++;
          modalInertOwners.set(sibling, ownership);
          this.inertElements.add(sibling);
          sibling.inert = true;
        }
        if (branch.parentElement === doc.body) break;
      }
    };
    isolate();
    if (!this.modalObserver) {
      this.modalObserver = new MutationObserver(isolate);
      this.modalObserver.observe(doc.body, { childList: true, subtree: true });
      doc.addEventListener('focusin', this.constrainFocus, true);
    }
  }

  private releaseModal(): void {
    this.closeSelect();
    this.clearControls();
    this.drag = null;
    const doc = this.element.ownerDocument;
    if (activeSettingsModal.get(doc) === this) activeSettingsModal.delete(doc);
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    if (this.layoutFrame !== null) {
      this.element.ownerDocument.defaultView?.cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = null;
    }
    this.element.ownerDocument.removeEventListener('focusin', this.constrainFocus, true);
    for (const node of this.inertElements) {
      const ownership = modalInertOwners.get(node);
      if (ownership && --ownership.count === 0) {
        node.inert = ownership.previous;
        modalInertOwners.delete(node);
      }
    }
    this.inertElements.clear();
  }

  private observeLayout(): void {
    // The reference Settings dialog is centred above the summary Dock. The
    // backdrop still covers the whole Workbench so focus/pointer ownership
    // stays modal. Read only our own Dock, without private Vela geometry.
    const dock = this.element.parentElement?.querySelector<HTMLElement>('.quant-backtest-dock');
    const update = (): void => {
      if (!this.isOpen || this.destroyed) return;
      const bounds = this.element.getBoundingClientRect();
      const dockBounds = dock?.getBoundingClientRect();
      const inset = dockBounds && dockBounds.width > 0 && dockBounds.height > 0
        ? Math.min(bounds.height, Math.max(0, bounds.bottom - dockBounds.top))
        : 0;
      const value = `${inset}px`;
      if (this.element.style.getPropertyValue('--quant-backtest-settings-dock-inset') !== value) {
        this.element.style.setProperty('--quant-backtest-settings-dock-inset', value);
      }
      this.constrainDialog();
    };
    update();
    if (!this.layoutObserver && typeof ResizeObserver !== 'undefined') {
      // Updating the observed element's padding inside delivery causes a
      // ResizeObserver loop error. Coalesce layout writes into the next frame;
      // the initial open still positions synchronously above the Dock.
      this.layoutObserver = new ResizeObserver(() => {
        if (this.layoutFrame !== null || !this.isOpen) return;
        this.layoutFrame = this.element.ownerDocument.defaultView!.requestAnimationFrame(() => {
          this.layoutFrame = null;
          update();
        });
      });
      this.layoutObserver.observe(this.element);
      this.layoutObserver.observe(this.dialog);
      if (dock) this.layoutObserver.observe(dock);
    }
  }

  private wireDrag(header: HTMLElement): void {
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.element.ownerDocument.defaultView!.innerWidth <= 640
        || (event.target as Element).closest('button')) return;
      event.preventDefault();
      this.closeSelect();
      this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY,
        offsetX: this.offset.x, offsetY: this.offset.y };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      this.offset = { x: this.drag.offsetX + event.clientX - this.drag.x,
        y: this.drag.offsetY + event.clientY - this.drag.y };
      this.constrainDialog();
    });
    const stop = () => { this.drag = null; };
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
    header.addEventListener('lostpointercapture', stop);
  }

  private constrainDialog(): void {
    if (!this.isOpen) return;
    if (this.element.ownerDocument.defaultView!.innerWidth <= 640) {
      this.offset = { x: 0, y: 0 };
    } else {
      const host = this.element.getBoundingClientRect();
      // Subtract the applied translation to recover the natural position.
      // Clearing and reapplying transform would force two layout passes.
      const rect = this.dialog.getBoundingClientRect();
      const left = rect.left - this.appliedOffset.x;
      const right = rect.right - this.appliedOffset.x;
      const top = rect.top - this.appliedOffset.y;
      const bottom = rect.bottom - this.appliedOffset.y;
      const inset = Math.min(16, Math.max(0, (host.width - rect.width) / 2));
      this.offset.x = Math.min(host.right - inset - right,
        Math.max(host.left + inset - left, this.offset.x));
      this.offset.y = Math.min(Math.max(0, host.bottom - 16 - bottom),
        Math.max(Math.min(0, host.top + 16 - top), this.offset.y));
    }
    const transform = this.offset.x || this.offset.y
      ? `translate(${this.offset.x}px, ${this.offset.y}px)` : '';
    if (this.dialog.style.transform !== transform) this.dialog.style.transform = transform;
    this.appliedOffset = { ...this.offset };
  }

  private closeSelect(): void {
    this.selectPopover?.destroy();
    this.selectPopover = null;
  }

  private clearControls(): void {
    this.controlCleanups.forEach((dispose) => dispose());
    this.controlCleanups = [];
  }

  private restoreFocus(): void {
    const doc = this.element.ownerDocument;
    const active = doc.activeElement;
    // Let the workbench's onClose choose its valid chart/Dock focus target.
    if ((!active || active === doc.body || this.element.contains(active))
      && this.returnFocus?.isConnected && !this.returnFocus.closest('[inert], [hidden]')
      && !this.returnFocus.matches(':disabled')) this.returnFocus.focus();
    this.returnFocus = null;
  }

  private makeTab(
    doc: Document,
    parent: HTMLElement,
    id: 'inputs' | 'properties',
    label: string,
  ): HTMLButtonElement {
    const tab = actionButton(doc, label, 'quant-backtest-settings-tab');
    tab.dataset.settingsTab = id;
    tab.id = `quant-backtest-settings-tab-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'quant-backtest-settings-panel');
    tab.addEventListener('click', () => {
      this.activeTab = id;
      this.render();
      this.firstField()?.focus();
    });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const visibleTabs = this.tabs.filter((candidate) => !candidate.hidden);
      const currentIndex = visibleTabs.indexOf(tab);
      if (currentIndex < 0 || visibleTabs.length < 2) return;
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visibleTabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length)
            % visibleTabs.length;
      const next = visibleTabs[nextIndex];
      const nextId = next?.dataset.settingsTab as 'inputs' | 'properties' | undefined;
      if (!nextId) return;
      this.activeTab = nextId;
      this.render();
      next.focus();
    });
    parent.appendChild(tab);
    return tab;
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const active = this.element.ownerDocument.activeElement;
    const ownedFocus = this.element.contains(active);
    this.closeSelect();
    this.clearControls();
    this.title.textContent = snapshot.title;
    this.subtitle.textContent = snapshot.source ? 'Pine strategy' : 'Strategy';
    const hasProps = snapshot.props.length > 0;
    this.tabs.forEach((tab) => {
      const id = tab.dataset.settingsTab as 'inputs' | 'properties';
      const active = id === this.activeTab && (id !== 'properties' || hasProps);
      tab.hidden = id === 'properties' && !hasProps;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    if (this.activeTab === 'properties' && !hasProps) this.activeTab = 'inputs';
    this.panel.setAttribute('aria-labelledby', `quant-backtest-settings-tab-${this.activeTab}`);
    const schemas = this.activeTab === 'properties' ? snapshot.props : snapshot.inputs;
    const draft = this.activeTab === 'properties' ? this.props : this.inputs;
    this.form.replaceChildren(this.renderFields(schemas, resolveBacktestSettingValues(schemas, draft)));
    this.status.textContent = this.errorMessage || (this.busy
      ? 'Applying…'
      : this.dirty
        ? 'Unsaved changes'
        : '');
    // Keep ordinary draft/busy updates polite, but make validation and host
    // failures interruptible for screen readers.  The status node remains a
    // stable `role=status` target for existing consumers; only its politeness
    // changes with the message severity.
    this.status.setAttribute('aria-live', this.errorMessage ? 'assertive' : 'polite');
    this.status.setAttribute('aria-atomic', 'true');
    this.status.classList.toggle('error', Boolean(this.errorMessage));
    this.applyButton.disabled = this.busy;
    this.resetButton.disabled = this.busy;
    this.cancelButton.disabled = this.busy;
    this.closeButton.disabled = this.busy;
    // Replacing fields or disabling the submit button must not strand focus
    // on BODY (notably during asynchronous Apply and host-driven refreshes).
    if (this.isOpen && ownedFocus && (!active?.isConnected || active.matches(':disabled'))) {
      (this.firstField() ?? this.focusableElements()[0] ?? this.element).focus();
    }
  }

  private renderFields(
    schemas: readonly BacktestSettingSchema[],
    values: Record<string, BacktestSettingValue>,
  ): DocumentFragment {
    const fragment = this.form.ownerDocument.createDocumentFragment();
    if (schemas.length === 0) {
      const empty = create(this.form.ownerDocument, 'p', 'quant-backtest-settings-empty');
      empty.textContent = this.activeTab === 'properties'
        ? 'This strategy has no declaration properties.'
        : 'This strategy has no configurable inputs.';
      fragment.appendChild(empty);
      return fragment;
    }
    // Pine groups/inline IDs need not be adjacent in the source declaration.
    // Retain their first appearance order, as the chart's native form does.
    const groups = new Map<string, { element: HTMLElement; inline: Map<string, HTMLElement> }>();
    schemas.forEach((schema) => {
      if (!isVisible(schema, values)) return;
      const nextGroup = schema.group?.trim() || '';
      let group = groups.get(nextGroup);
      if (!group) {
        // Fieldset creates an anonymous content box even with display:contents
        // in some engines. Keep an accessible group without splitting the
        // native form's shared label/control grid into independent columns.
        const element = create(this.form.ownerDocument, 'div', 'quant-backtest-settings-group');
        if (nextGroup) {
          element.setAttribute('role', 'group');
          element.setAttribute('aria-label', nextGroup);
          const legend = create(this.form.ownerDocument, 'span', 'quant-backtest-settings-group-title');
          legend.textContent = nextGroup;
          element.appendChild(legend);
        }
        fragment.appendChild(element);
        group = { element, inline: new Map() };
        groups.set(nextGroup, group);
      }
      const inline = schema.type !== 'text_area' ? schema.inline?.trim() : '';
      let parent = group.element;
      if (inline) {
        let row = group.inline.get(inline);
        if (!row) {
          row = create(this.form.ownerDocument, 'div', 'quant-backtest-settings-inline');
          row.dataset.settingInline = inline;
          group.inline.set(inline, row);
          group.element.append(row);
        }
        parent = row;
      }
      parent.appendChild(this.renderField(schema, valueFor(schema, values)));
      if (inline && schema.tooltip) {
        // Like native Pine inline rows, the final declared tooltip describes
        // the shared row, instead of duplicating an info glyph per control.
        parent.querySelector('.quant-backtest-settings-hint')?.remove();
        parent.append(this.makeHint(schema.tooltip));
      }
    });
    if (!fragment.firstChild) {
      const empty = create(this.form.ownerDocument, 'p', 'quant-backtest-settings-empty');
      empty.textContent = 'No fields are visible for the current selections.';
      fragment.appendChild(empty);
    }
    return fragment;
  }

  private renderField(schema: BacktestSettingSchema, value: BacktestSettingValue): HTMLElement {
    const doc = this.form.ownerDocument;
    const wrapper = create(doc, 'label', 'quant-backtest-settings-field');
    wrapper.dataset.settingKey = schema.key;
    wrapper.dataset.fieldType = schema.type;
    const caption = create(doc, 'span', 'quant-backtest-settings-label');
    caption.textContent = this.activeTab === 'properties' && isBacktestPrecision(schema) ? 'Backtest precision' : schema.title;
    const control = this.makeControl(doc, schema, value);
    control.disabled = this.busy;
    let field: HTMLElement = control instanceof HTMLSelectElement ? this.enhanceSelect(control, caption.textContent)
      : control instanceof HTMLInputElement && isNumeric(schema.type) ? this.enhanceNumber(control, schema)
        : control;
    if (control instanceof HTMLInputElement && this.options.controls?.openContent) {
      if (schema.type === 'time' || schema.type === 'session') {
        field = temporalField(control, schema.title, {
          open: (trigger, content, name) => this.openContent(trigger, content, name),
          close: () => this.closeSelect(),
          choices: (trigger, values, current, pick) => this.openTimeChoices(trigger, values, current, pick),
        });
      } else if (schema.type === 'color' && this.options.controls.colorPicker) {
        field = this.enhanceColor(control, schema.title);
      }
    }
    wrapper.append(caption, field);
    if (this.activeTab === 'properties' && isBacktestPrecision(schema)) {
      // This is a presentation of Pine's real mutable property, not a second
      // UI preference. Provider limitations (including missing second bars)
      // remain visible through the report's applied-precision fallback.
      wrapper.dataset.executionPrecisionSetting = BAR_MAGNIFIER_PROP;
      wrapper.title = 'High precision requests lower-timeframe replay. The result header reports the applied mode and any provider fallback.';
    } else if (schema.tooltip) {
      wrapper.title = schema.tooltip;
      if (!schema.inline || schema.type === 'text_area') caption.append(this.makeHint(schema.tooltip));
    }
    return wrapper;
  }

  private makeHint(message: string): HTMLButtonElement {
    const button = actionButton(this.form.ownerDocument, '', 'quant-backtest-settings-hint');
    button.setAttribute('aria-label', message); button.title = message; button.disabled = this.busy;
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7.4v4.4"/><circle cx="8" cy="4.6" r="0.9" fill="currentColor" stroke="none"/></svg>';
    const show = () => {
      if (!this.options.controls?.openContent || this.selectPopover) return;
      const text = create(this.form.ownerDocument, 'div', 'quant-backtest-settings-hint-text');
      text.textContent = message;
      this.openContent(button, text, 'Input help')?.el.setAttribute('role', 'tooltip');
    };
    button.addEventListener('mouseenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('click', (event) => { event.preventDefault(); show(); });
    const hide = () => { if (this.selectPopover?.trigger === button) this.closeSelect(); };
    button.addEventListener('mouseleave', hide); button.addEventListener('blur', hide);
    return button;
  }

  private openContent(trigger: HTMLElement, content: HTMLElement, name: string): SettingsSelectPopover | null {
    if (this.busy || !this.options.controls?.openContent) return null;
    if (this.selectPopover?.trigger === trigger) { this.closeSelect(); return null; }
    this.closeSelect();
    let popover: SettingsSelectPopover;
    popover = this.options.controls.openContent(trigger, content, {
      host: this.element, boundary: this.dialog,
      onClose: () => {
        trigger.removeAttribute('aria-controls'); trigger.setAttribute('aria-expanded', 'false');
        if (this.selectPopover === popover) this.selectPopover = null;
        const active = this.element.ownerDocument.activeElement;
        if ((!active || active === this.element.ownerDocument.body || popover?.el.contains(active))
          && trigger.isConnected && this.isOpen) trigger.focus({ preventScroll: true });
      },
    });
    this.selectPopover = popover;
    popover.el.setAttribute('role', 'dialog'); popover.el.setAttribute('aria-label', name);
    popover.el.id = 'quant-settings-input-popover';
    popover.el.classList.add('quant-backtest-settings-input-popover');
    trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', popover.el.id);
    popover.reposition();
    return popover;
  }

  private openTimeChoices(trigger: HTMLElement, values: readonly string[], current: string, pick: (value: string) => void): void {
    const controls = this.options.controls;
    if (!controls || this.busy) return;
    if (this.selectPopover?.trigger === trigger) { this.closeSelect(); return; }
    this.closeSelect();
    let popover: SettingsSelectPopover;
    popover = controls.openSelect(trigger, values.map((value) => ({ value, label: value })), current, pick, {
      host: this.element, boundary: this.dialog, position: 'fixed', gap: 6,
      onClose: () => {
        trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
        if (this.selectPopover === popover) this.selectPopover = null;
      },
    });
    this.selectPopover = popover;
    popover.el.classList.add('quant-backtest-settings-select-menu');
    popover.el.id = 'quant-settings-time-options';
    popover.el.setAttribute('role', 'listbox');
    popover.el.setAttribute('aria-label', trigger.getAttribute('aria-label') ?? 'Time');
    const options = [...popover.el.querySelectorAll<HTMLButtonElement>('button')];
    options.forEach((option, index) => {
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(values[index] === current)); option.tabIndex = -1;
    });
    popover.el.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const index = options.indexOf(this.element.ownerDocument.activeElement as HTMLButtonElement);
      options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
    });
    trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', popover.el.id);
    options[Math.max(0, values.indexOf(current))]?.focus();
  }

  private enhanceColor(model: HTMLInputElement, title: string): HTMLElement {
    const doc = model.ownerDocument;
    const wrapper = create(doc, 'span', 'quant-backtest-settings-color');
    const trigger = actionButton(doc, '', 'quant-backtest-settings-color-trigger');
    trigger.disabled = model.disabled; trigger.dataset.settingControl = model.dataset.settingKey;
    trigger.setAttribute('aria-label', title); trigger.setAttribute('aria-haspopup', 'dialog');
    const swatch = create(doc, 'span');
    const paint = () => { swatch.style.background = `linear-gradient(${model.value}, ${model.value}), conic-gradient(#888 25%, #fff 0 50%, #888 0 75%, #fff 0) 0 / 8px 8px`; };
    paint(); trigger.append(swatch); model.type = 'hidden';
    trigger.addEventListener('click', () => {
      const picker = this.options.controls!.colorPicker!(model.value, this.element, (value) => {
        model.value = value; paint(); model.dispatchEvent(new Event('change', { bubbles: true }));
      });
      this.openContent(trigger, picker, `${title} color`);
    });
    wrapper.append(model, trigger); return wrapper;
  }

  private enhanceSelect(select: HTMLSelectElement, label: string): HTMLElement {
    const controls = this.options.controls;
    if (!controls) return select;
    const doc = select.ownerDocument;
    const wrapper = create(doc, 'span', 'quant-backtest-settings-select');
    // Keep the native value/change contract for forms and non-pointer hosts.
    // The visible trigger/list uses the same Vela kit as the reference site.
    select.className = 'quant-backtest-settings-select-native';
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const trigger = actionButton(doc, '', 'quant-backtest-settings-select-trigger');
    trigger.dataset.settingControl = select.dataset.settingKey;
    trigger.disabled = select.disabled;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const text = create(doc, 'span', 'quant-backtest-settings-select-label');
    const sync = () => { text.textContent = select.selectedOptions[0]?.textContent ?? select.value; };
    sync();
    select.addEventListener('change', sync);
    trigger.append(text, chevron(doc));
    const open = () => {
      if (this.selectPopover?.trigger === trigger) { this.closeSelect(); return; }
      this.closeSelect();
      const popover = controls.openSelect(trigger, [...select.options].map((option) => ({ value: option.value, label: option.text })),
        select.value, (value) => {
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          if (trigger.isConnected) trigger.focus({ preventScroll: true });
        }, {
          host: this.element, position: 'fixed', boundary: this.dialog, gap: -1,
          onClose: () => {
            trigger.setAttribute('aria-expanded', 'false');
            trigger.removeAttribute('aria-controls');
            if ((doc.activeElement === doc.body || popover.el.contains(doc.activeElement))
              && this.isOpen && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
            if (this.selectPopover === popover) this.selectPopover = null;
          },
        });
      this.selectPopover = popover;
      // The menu is portaled inside this modal and must inherit the same
      // surface tokens even when the standalone component has no Vela host.
      const style = doc.defaultView!.getComputedStyle(this.element);
      for (const token of ['bg', 'fg', 'fg-bright', 'fg-muted', 'hover', 'hover-strong']) {
        const value = style.getPropertyValue(`--quant-backtest-${token}`).trim();
        if (value) popover.el.style.setProperty(`--vela-${token}`, value);
      }
      popover.el.style.setProperty('--vela-font', '-apple-system, system-ui, "Segoe UI", sans-serif');
      popover.el.classList.add('quant-backtest-settings-select-menu');
      popover.el.setAttribute('role', 'listbox');
      popover.el.setAttribute('aria-label', label);
      popover.el.id = `quant-settings-options-${select.dataset.settingKey}`;
      trigger.setAttribute('aria-controls', popover.el.id);
      trigger.setAttribute('aria-expanded', 'true');
      const options = [...popover.el.querySelectorAll<HTMLButtonElement>('button')];
      options.forEach((option, index) => {
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(index === select.selectedIndex));
        option.tabIndex = -1;
      });
      popover.el.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') { this.closeSelect(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const current = options.indexOf(doc.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[index]?.focus();
      });
      popover.el.style.minWidth = '';
      popover.reposition();
      options[Math.max(0, select.selectedIndex)]?.focus();
    };
    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      open();
    });
    wrapper.append(select, trigger);
    return wrapper;
  }

  private enhanceNumber(input: HTMLInputElement, schema: BacktestSettingSchema): HTMLElement {
    const wrapper = create(input.ownerDocument, 'span', 'quant-backtest-settings-number');
    const steps = create(input.ownerDocument, 'span', 'quant-backtest-settings-number-steps');
    for (const direction of [1, -1]) {
      const button = actionButton(input.ownerDocument, '', 'quant-backtest-settings-number-step');
      button.tabIndex = -1;
      button.disabled = input.disabled;
      button.setAttribute('aria-label', direction === 1 ? 'Increase' : 'Decrease');
      button.append(chevron(input.ownerDocument, direction === 1));
      const apply = () => {
        if (this.busy || !input.isConnected) return;
        const value = Number(input.value);
        const next = (Number.isFinite(value) ? value : Number(schema.defval))
          + direction * (schema.step ?? (schema.type === 'int' ? 1 : 0.1));
        input.value = String(Number(next.toPrecision(14)));
        this.normalizeNumber(input, schema);
        input.focus({ preventScroll: true });
      };
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = () => { if (timer !== null) clearTimeout(timer); timer = null; };
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        apply();
        timer = setTimeout(function repeat() { apply(); timer = setTimeout(repeat, 60); }, 400);
      });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
      button.addEventListener('click', (event) => { if (event.detail === 0) apply(); });
      this.controlCleanups.push(stop);
      steps.append(button);
    }
    input.addEventListener('blur', () => this.normalizeNumber(input, schema));
    wrapper.append(input, steps);
    return wrapper;
  }

  private normalizeNumber(input: HTMLInputElement, schema: BacktestSettingSchema): void {
    if (this.busy || !input.isConnected || input.value.trim() === '') return;
    let value = Number(input.value);
    if (!Number.isFinite(value)) return;
    if (schema.type === 'int') value = Math.round(value);
    if (schema.min !== undefined) value = Math.max(schema.min, value);
    if (schema.max !== undefined) value = Math.min(schema.max, value);
    input.value = String(value);
    const draft = this.activeTab === 'properties' ? this.props : this.inputs;
    if (!Object.is(draft[schema.key] ?? schema.defval, value)) input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private makeControl(
    doc: Document,
    schema: BacktestSettingSchema,
    value: BacktestSettingValue,
  ): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    if (this.activeTab === 'properties' && isBacktestPrecision(schema)) {
      const select = create(doc, 'select');
      select.dataset.settingKey = schema.key;
      select.dataset.settingType = schema.type;
      select.setAttribute('aria-label', 'Backtest precision');
      ([
        ['false', 'Default precision'],
        ['true', 'High precision'],
      ] as const).forEach(([optionValue, label]) => {
        const option = create(doc, 'option');
        option.value = optionValue;
        option.textContent = label;
        option.selected = optionValue === String(value === true);
        select.appendChild(option);
      });
      return select;
    }
    if (schema.type === 'bool') {
      const input = create(doc, 'input');
      input.type = 'checkbox';
      input.checked = value === true;
      input.dataset.settingKey = schema.key;
      input.dataset.settingType = schema.type;
      input.className = 'quant-backtest-settings-checkbox';
      return input;
    }
    if (schema.type === 'text_area') {
      const textarea = create(doc, 'textarea');
      textarea.value = String(value);
      textarea.dataset.settingKey = schema.key;
      textarea.dataset.settingType = schema.type;
      textarea.rows = 3;
      return textarea;
    }
    if ((schema.options && schema.options.length > 0)
      || schema.type === 'source' || schema.type === 'timeframe') {
      const select = create(doc, 'select');
      select.dataset.settingKey = schema.key;
      select.dataset.settingType = schema.type;
      const options: readonly (readonly [string, string])[] = schema.options?.length
        ? schema.options.map((option) => [option, option] as const)
        : schema.type === 'source' ? SOURCE_OPTIONS.map((option) => [option, option] as const)
          : TIMEFRAME_OPTIONS;
      // Pine supports custom timeframes beyond the standard menu (e.g. 2D).
      // An existing/default value must remain representable when opening it.
      const choices = options.some(([option]) => option === String(value))
        ? options : [[String(value), String(value)] as const, ...options];
      choices.forEach(([optionValue, label]) => {
        const option = create(doc, 'option');
        option.value = optionValue;
        option.textContent = label;
        option.selected = optionValue === String(value);
        select.appendChild(option);
      });
      return select;
    }
    const input = create(doc, 'input');
    input.type = schema.type === 'color' && /^#[0-9a-f]{6}$/i.test(String(value))
      ? 'color'
      : isNumeric(schema.type) ? 'number' : 'text';
    // Keep an invalid/cleared numeric draft visually empty. The draft uses
    // NaN as an internal sentinel so Apply can reject it instead of silently
    // converting an empty field to zero.
    input.value = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
    input.dataset.settingKey = schema.key;
    input.dataset.settingType = schema.type;
    if (schema.min !== undefined) input.min = String(schema.min);
    if (schema.max !== undefined) input.max = String(schema.max);
    if (isNumeric(schema.type)) input.step = String(schema.step ?? (schema.type === 'int' ? 1 : 'any'));
    return input;
  }

  private onFieldChange(event: Event): void {
    if (this.busy) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)
      && !(target instanceof HTMLSelectElement)
      && !(target instanceof HTMLTextAreaElement)) return;
    const key = target.dataset.settingKey;
    const type = target.dataset.settingType as BacktestSettingType | undefined;
    if (!key || !type) return;
    const values = this.activeTab === 'properties' ? this.props : this.inputs;
    values[key] = readControl(target, type);
    this.dirty = true;
    this.errorMessage = '';
    this.status.classList.remove('error');
    // Re-render only when a visibility gate may depend on the edited key. This
    // keeps focus stable for ordinary fields while matching Vela's `when` UX.
    const schemas = this.snapshot
      ? this.activeTab === 'properties' ? this.snapshot.props : this.snapshot.inputs
      : undefined;
    if (schemas?.some((schema) => schema.when && referencesWhen(schema, key))) this.render();
    else this.status.textContent = 'Unsaved changes';
  }

  private resetDefaults(): void {
    if (!this.snapshot || this.busy) return;
    this.inputs = Object.fromEntries(this.snapshot.inputs.map((schema) => [schema.key, schema.defval]));
    this.props = Object.fromEntries(this.snapshot.props.map((schema) => [schema.key, schema.defval]));
    this.dirty = true;
    this.errorMessage = '';
    this.render();
    // Reset defaults is draft-only in the reference dialog. The user must
    // explicitly press Ok to submit the restored values; this also guarantees
    // that Reset never starts a strategy run or writes workspace state.
  }

  private async commit(): Promise<void> {
    if (!this.snapshot || this.busy) return;
    const validationError = this.validateDraft();
    if (validationError) {
      this.setError(validationError);
      return;
    }
    this.busy = true;
    const session = this.session;
    const isCurrent = () => !this.destroyed && this.isOpen && this.session === session;
    this.render();
    try {
      const accepted = await this.options.onApply(this.snapshot, { ...this.inputs }, { ...this.props });
      if (!isCurrent()) return;
      if (!accepted) {
        this.handleApplyFailure();
        return;
      }
      this.dirty = false;
      this.close();
    } catch {
      if (isCurrent()) this.handleApplyFailure();
    } finally {
      if (isCurrent()) {
        this.busy = false;
        this.render();
      }
    }
  }

  private handleApplyFailure(): void {
    let current: BacktestSettingsSnapshot | null = null;
    try {
      if (this.snapshot) current = this.options.onReadAfterFailure?.(this.snapshot) ?? null;
    } catch { /* A removed/unavailable host cannot provide authoritative values. */ }
    if (current && current.key.cellId === this.snapshot?.key.cellId
      && current.key.indicatorId === this.snapshot?.key.indicatorId) {
      this.snapshot = current;
      this.inputs = cloneValues(current.inputValues);
      this.props = cloneValues(current.propValues);
      this.dirty = false;
    } else current = null;
    this.setError('Unable to apply settings. Some settings may have changed. '
      + (current ? 'Current host values were reloaded. ' : 'Host values could not be reloaded. ')
      + 'The report may be out of date; apply settings successfully before using its results.');
  }

  private setError(message: string): void {
    this.errorMessage = message;
    this.status.textContent = message;
    this.status.setAttribute('aria-live', 'assertive');
    this.status.setAttribute('aria-atomic', 'true');
    this.status.classList.add('error');
  }

  private validateDraft(): string | null {
    return this.snapshot
      ? validateBacktestSettingsDraft(this.snapshot, this.inputs, this.props)
      : null;
  }

  private firstField(): HTMLElement | null {
    return this.form.querySelector<HTMLElement>(
      'input[data-setting-key]:not([disabled]):not([type="hidden"]), input[data-setting-temporal]:not([disabled]), select[data-setting-key]:not([disabled]):not([aria-hidden]), button[data-setting-control]:not([disabled]), textarea[data-setting-key]:not([disabled])',
    );
  }
}

function isNumeric(type: BacktestSettingType): boolean {
  return type === 'int' || type === 'float' || type === 'price' || type === 'time';
}

function readControl(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  type: BacktestSettingType,
): BacktestSettingValue {
  if (type === 'bool') {
    return control instanceof HTMLInputElement ? control.checked : control.value === 'true';
  }
  if (isNumeric(type)) {
    if (control.value.trim() === '') return Number.NaN;
    const value = Number(control.value);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return control.value;
}

function referencesWhen(schema: BacktestSettingSchema, key: string): boolean {
  const when = schema.when;
  if (!when) return false;
  const conditions = Array.isArray(when) ? when : [when];
  return conditions.some((condition) => condition.key === key);
}
