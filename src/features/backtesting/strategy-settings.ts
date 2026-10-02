import type {
  BacktestSettingSchema,
  BacktestSettingType,
  BacktestSettingValue,
  BacktestSettingsSnapshot,
} from '../../domain/ports/backtest-settings.ts';
import { resolveBacktestSettingValues, validateBacktestSettingsDraft } from '../../domain/backtest-settings.ts';

export interface StrategySettingsPanelOptions {
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

function cloneValues(values: Readonly<Record<string, BacktestSettingValue>>): Record<string, BacktestSettingValue> {
  return { ...values };
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

// A document has one active settings modal. Opening another workspace's
// settings dismisses the previous surface before acquiring its background.
// Simultaneous independently trapped modals would inert each other's hosts.
const activeSettingsModal = new WeakMap<Document, StrategySettingsPanel>();
const modalInertOwners = new WeakMap<HTMLElement, { count: number; previous: boolean }>();

function isBacktestPrecision(schema: BacktestSettingSchema): boolean {
  return schema.key === BAR_MAGNIFIER_PROP && schema.type === 'bool';
}

/**
 * Lightweight, Vela-independent Inputs/Properties dialog used by the
 * backtest surface. The chart's own settings dialog remains untouched; this
 * panel is intentionally scoped to the selected strategy and commits through
 * the BacktestControlPort supplied by the composition root.
 */
export class StrategySettingsPanel {
  readonly element: HTMLElement;

  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
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
  private readonly constrainFocus = (event: FocusEvent): void => {
    if (this.isOpen && event.target instanceof Node && !this.element.contains(event.target)) {
      this.focusableElements()[0]?.focus();
    }
  };

  constructor(doc: Document, options: StrategySettingsPanelOptions) {
    this.options = options;
    this.element = create(doc, 'section', 'quant-backtest-settings');
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    // The full-screen backdrop blocks pointer interaction; keyboard and
    // accessibility semantics must enforce the same modal boundary.
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', 'Strategy settings');
    this.element.tabIndex = -1;

    const backdrop = create(doc, 'button', 'quant-backtest-settings-backdrop');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close strategy settings');
    backdrop.addEventListener('click', () => this.close());

    const dialog = create(doc, 'div', 'quant-backtest-settings-dialog');
    const header = create(doc, 'header', 'quant-backtest-settings-header');
    const heading = create(doc, 'div', 'quant-backtest-settings-heading');
    this.title = create(doc, 'h2');
    this.subtitle = create(doc, 'span');
    heading.append(this.title, this.subtitle);
    this.closeButton = actionButton(doc, '×', 'quant-backtest-settings-close');
    this.closeButton.setAttribute('aria-label', 'Close strategy settings');
    this.closeButton.addEventListener('click', () => this.close());
    header.append(heading, this.closeButton);

    const tabList = create(doc, 'div', 'quant-backtest-settings-tabs');
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Strategy settings sections');
    this.tabs.push(
      this.makeTab(doc, tabList, 'inputs', 'Inputs'),
      this.makeTab(doc, tabList, 'properties', 'Properties'),
    );

    this.form = create(doc, 'form', 'quant-backtest-settings-form');
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

    dialog.append(header, tabList, this.form, footer);
    this.element.append(backdrop, dialog);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
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
    this.element.hidden = false;
    this.activateModal();
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
    this.snapshot = snapshot;
    if (!this.dirty) {
      this.inputs = cloneValues(snapshot.inputValues);
      this.props = cloneValues(snapshot.propValues);
      this.render();
    }
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
    const doc = this.element.ownerDocument;
    if (activeSettingsModal.get(doc) === this) activeSettingsModal.delete(doc);
    this.modalObserver?.disconnect();
    this.modalObserver = null;
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
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => {
      this.activeTab = id;
      this.render();
      this.firstField()?.focus();
    });
    parent.appendChild(tab);
    return tab;
  }

  private render(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const active = this.element.ownerDocument.activeElement;
    const ownedFocus = this.element.contains(active);
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
    const schemas = this.activeTab === 'properties' ? snapshot.props : snapshot.inputs;
    const draft = this.activeTab === 'properties' ? this.props : this.inputs;
    this.form.replaceChildren(this.renderFields(schemas, resolveBacktestSettingValues(schemas, draft)));
    this.status.textContent = this.errorMessage || (this.busy
      ? 'Applying…'
      : this.dirty
        ? 'Unsaved changes'
        : '');
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
    let groupName: string | undefined;
    let group: HTMLElement | null = null;
    schemas.forEach((schema) => {
      if (!isVisible(schema, values)) return;
      const nextGroup = schema.group?.trim() || '';
      if (nextGroup !== groupName) {
        groupName = nextGroup;
        group = create(this.form.ownerDocument, 'fieldset', 'quant-backtest-settings-group');
        if (nextGroup) {
          const legend = create(this.form.ownerDocument, 'legend');
          legend.textContent = nextGroup;
          group.appendChild(legend);
        }
        fragment.appendChild(group);
      }
      group?.appendChild(this.renderField(schema, valueFor(schema, values)));
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
    const caption = create(doc, 'span', 'quant-backtest-settings-label');
    caption.textContent = this.activeTab === 'properties' && isBacktestPrecision(schema) ? 'Backtest precision' : schema.title;
    const control = this.makeControl(doc, schema, value);
    control.disabled = this.busy;
    wrapper.append(caption, control);
    if (this.activeTab === 'properties' && isBacktestPrecision(schema)) {
      // This is a presentation of Pine's real mutable property, not a second
      // UI preference. Provider limitations (including missing second bars)
      // remain visible through the report's applied-precision fallback.
      wrapper.dataset.executionPrecisionSetting = BAR_MAGNIFIER_PROP;
      wrapper.title = 'High precision requests lower-timeframe replay. The result header reports the applied mode and any provider fallback.';
    } else if (schema.tooltip) wrapper.title = schema.tooltip;
    return wrapper;
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
    if (schema.type === 'string' && schema.options && schema.options.length > 0) {
      const select = create(doc, 'select');
      select.dataset.settingKey = schema.key;
      select.dataset.settingType = schema.type;
      schema.options.forEach((optionValue) => {
        const option = create(doc, 'option');
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = optionValue === value;
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
    this.status.classList.add('error');
  }

  private validateDraft(): string | null {
    return this.snapshot
      ? validateBacktestSettingsDraft(this.snapshot, this.inputs, this.props)
      : null;
  }

  private firstField(): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
    return this.form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input[data-setting-key]:not([disabled]), select[data-setting-key]:not([disabled]), textarea[data-setting-key]:not([disabled])',
    );
  }
}

function isNumeric(type: BacktestSettingType): boolean {
  return type === 'int' || type === 'float' || type === 'price';
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
