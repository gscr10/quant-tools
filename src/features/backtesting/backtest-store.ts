import { backtestKeyId, type BacktestKey, type BacktestReport as DomainBacktestReport } from '../../domain/backtesting.ts';
import type { BacktestReport as UiBacktestReport } from './backtest-types.ts';

/** A report pair kept by the application layer.  The UI never needs to know
 * which provider produced the domain report, but selectors occasionally need
 * the normalized domain object for metrics/simulation. */
export interface BacktestStoreEntry {
  readonly key: BacktestKey;
  readonly epoch: number;
  /** Event revision used for stale ordering; may exceed domain revision for an
   * error overlay that preserves a previous last-good domain report. */
  readonly revision: number;
  readonly domain: DomainBacktestReport;
  readonly report: UiBacktestReport;
}

export type BacktestStoreEvent =
  | { readonly type: 'upsert'; readonly entry: BacktestStoreEntry }
  | { readonly type: 'remove'; readonly key: BacktestKey }
  | { readonly type: 'active'; readonly key: BacktestKey | null; readonly report: UiBacktestReport | null };

export type BacktestStoreListener = (event: BacktestStoreEvent) => void;
export type BacktestStoreReportListener = (report: UiBacktestReport | null) => void;

export interface BacktestStoreOptions {
  readonly onDiagnostic?: (message: string, error?: unknown) => void;
}

const NOOP = () => undefined;

/**
 * Small, provider-neutral report store.
 *
 * It owns neither Vela nor a results adapter.  That deliberate ownership
 * boundary makes it safe to use in fixtures and lets a controller decide when
 * an adapter should be destroyed.  Revisions/epochs are checked here as a
 * final guard against an old asynchronous snapshot replacing a newer one.
 */
export class BacktestStore {
  private readonly entries = new Map<string, BacktestStoreEntry>();
  private readonly listeners = new Set<BacktestStoreListener>();
  private readonly activeListeners = new Set<BacktestStoreReportListener>();
  private readonly onDiagnostic?: (message: string, error?: unknown) => void;
  private activeKey: BacktestKey | null = null;
  /** The chart cell selected by the workspace, even when it has no strategy. */
  private selectedCellId: string | null = null;
  private destroyed = false;

  constructor(options: BacktestStoreOptions = {}) {
    this.onDiagnostic = options.onDiagnostic;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  subscribe(listener: BacktestStoreListener): () => void {
    if (this.destroyed) return NOOP;
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to the currently selected report and receive an initial value. */
  subscribeActive(listener: BacktestStoreReportListener): () => void {
    if (this.destroyed) return NOOP;
    this.activeListeners.add(listener);
    this.notifyListener(listener, this.activeReport());
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeListeners.delete(listener);
    };
  }

  upsert(
    key: BacktestKey,
    domain: DomainBacktestReport,
    report: UiBacktestReport,
    epoch = 0,
    revision = domain.revision,
  ): boolean {
    if (this.destroyed) return false;
    const id = backtestKeyId(key);
    const previous = this.entries.get(id);
    // An epoch supersedes every previous revision.  Within one epoch, a lower
    // revision is stale; equal revisions are allowed because an error/ledger
    // snapshot may enrich the same run.
    if (previous && (epoch < previous.epoch
      || (epoch === previous.epoch && revision < previous.revision))) return false;
    const entry: BacktestStoreEntry = Object.freeze({
      key: Object.freeze({ cellId: key.cellId, indicatorId: key.indicatorId }),
      epoch,
      revision,
      domain,
      report,
    });
    this.entries.set(id, entry);
    this.emit({ type: 'upsert', entry });
    this.emitActiveIfAffected(key);
    return true;
  }

  remove(key: BacktestKey): boolean {
    if (this.destroyed) return false;
    const id = backtestKeyId(key);
    const existed = this.entries.delete(id);
    if (!existed) return false;
    this.emit({ type: 'remove', key: cloneKey(key) });
    if (sameKey(this.activeKey, key)) {
      // Removing the last strategy in the active cell must not make the Dock
      // jump to an unrelated cell. Keep the cell selection and wait for a
      // later strategy/snapshot in that cell before selecting another report.
      const next = this.list()
        .filter((entry) => entry.key.cellId === this.selectedCellId)
        .sort((left, right) => right.revision - left.revision)[0]?.key ?? null;
      this.activeKey = next ? cloneKey(next) : null;
      this.emit({ type: 'active', key: this.active, report: this.activeReport() });
      this.emitActive();
    }
    return true;
  }

  get(key: BacktestKey): BacktestStoreEntry | undefined {
    return this.entries.get(backtestKeyId(key));
  }

  getReport(key: BacktestKey): UiBacktestReport | null {
    return this.get(key)?.report ?? null;
  }

  list(): readonly BacktestStoreEntry[] {
    return [...this.entries.values()];
  }

  listReports(): readonly UiBacktestReport[] {
    return this.list().map((entry) => entry.report);
  }

  get active(): BacktestKey | null {
    return this.activeKey ? cloneKey(this.activeKey) : null;
  }

  /** The workspace-selected cell, even when that cell currently has no report. */
  get activeCellId(): string | null {
    return this.selectedCellId;
  }

  activeReport(): UiBacktestReport | null {
    return this.activeKey ? this.getReport(this.activeKey) : null;
  }

  setActive(key: BacktestKey | null): boolean {
    if (this.destroyed) return false;
    if (key) this.selectedCellId = key.cellId;
    const next = key && this.entries.has(backtestKeyId(key)) ? cloneKey(key) : null;
    if (sameKey(this.activeKey, next)) return false;
    this.activeKey = next;
    this.emit({ type: 'active', key: this.active, report: this.activeReport() });
    this.emitActive();
    return true;
  }

  /** Select a strategy in a cell, preferring the newest revision. */
  setActiveCell(cellId: string): boolean {
    if (this.destroyed) return false;
    this.selectedCellId = cellId;
    const candidates = this.list()
      .filter((entry) => entry.key.cellId === cellId)
      .sort((left, right) => right.revision - left.revision);
    return this.setActive(candidates[0]?.key ?? null);
  }

  /** Keep a selected key valid after a removal/layout change. */
  ensureActive(preferred?: BacktestKey): boolean {
    if (this.activeKey && this.entries.has(backtestKeyId(this.activeKey))) return false;
    if (preferred && this.entries.has(backtestKeyId(preferred))) return this.setActive(preferred);
    const cellCandidates = this.selectedCellId
      ? this.list()
        .filter((entry) => entry.key.cellId === this.selectedCellId)
        .sort((left, right) => right.revision - left.revision)
      : [];
    const next = cellCandidates[0]?.key ?? (this.selectedCellId ? null : this.entries.values().next().value?.key ?? null);
    return this.setActive(next);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.entries.clear();
    this.activeKey = null;
    this.selectedCellId = null;
    this.listeners.clear();
    this.activeListeners.clear();
  }

  private emit(event: BacktestStoreEvent): void {
    for (const listener of [...this.listeners]) this.notifyListener(listener, event);
  }

  private emitActiveIfAffected(key: BacktestKey): void {
    if (this.activeKey && sameKey(this.activeKey, key)) this.emitActive();
  }

  private emitActive(): void {
    const report = this.activeReport();
    for (const listener of [...this.activeListeners]) this.notifyListener(listener, report);
  }

  private notifyListener<T>(listener: (value: T) => void, value: T): void {
    try {
      listener(value);
    } catch (error) {
      try {
        this.onDiagnostic?.('backtest store listener failed', error);
      } catch {
        // Diagnostics are best effort and must not break other subscribers.
      }
    }
  }
}

export function createBacktestStore(options: BacktestStoreOptions = {}): BacktestStore {
  return new BacktestStore(options);
}

function cloneKey(key: BacktestKey): BacktestKey {
  return { cellId: key.cellId, indicatorId: key.indicatorId };
}

function sameKey(left: BacktestKey | null, right: BacktestKey | null): boolean {
  return left?.cellId === right?.cellId && left?.indicatorId === right?.indicatorId;
}
