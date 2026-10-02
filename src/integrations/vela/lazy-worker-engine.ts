import type {
  ScriptingEngine,
  EngineCapabilities,
  PreparedScript,
  ExecutionRequest,
  ExecutionHandlers,
  ExecutionSession,
} from '@luxalgo/vela/plugin';
import { PINE_EXECUTION_BUILD_INFO } from '@luxalgo/vela-pinets/audit';

/** Structural seam allows lifecycle tests without starting a real Worker. */
export interface LoadedPineWorkerEngine extends ScriptingEngine {
  terminate(): void;
}

export type PineWorkerEngineLoader = () => Promise<{
  PineWorkerEngine: new () => LoadedPineWorkerEngine;
}>;

const loadWorkerEngine: PineWorkerEngineLoader = () => import('@luxalgo/vela-pinets/worker-engine');

/**
 * Vela's factory/execute contracts are synchronous; prepare is its supported
 * asynchronous boundary. Defer the inlined PineTS Worker bytes to that boundary
 * without changing execution, report, history, or session semantics.
 */
export class LazyPineWorkerEngine implements ScriptingEngine {
  readonly language = 'pine';
  readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
  readonly buildFingerprint = PINE_EXECUTION_BUILD_INFO.buildFingerprint;
  private engine: LoadedPineWorkerEngine | undefined;
  private loading: Promise<LoadedPineWorkerEngine> | undefined;
  private epoch = 0;
  private disposed = false;
  private readonly pending = new Set<(error: Error) => void>();
  private readonly loader: PineWorkerEngineLoader;

  constructor(loader: PineWorkerEngineLoader = loadWorkerEngine) {
    this.loader = loader;
  }

  prepare(source: string, instanceId: string): Promise<PreparedScript> {
    if (this.disposed) return Promise.reject(new Error('Pine engine has been disposed'));
    const epoch = this.epoch;
    return new Promise((resolve, reject) => {
      this.pending.add(reject);
      this.load().then((engine) => {
        if (epoch !== this.epoch || this.disposed) throw new Error('Pine engine loading cancelled');
        return engine.prepare(source, instanceId);
      }).then(resolve, reject).finally(() => this.pending.delete(reject));
    });
  }

  execute(request: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
    if (this.engine && !this.disposed) return this.engine.execute(request, handlers);
    // A failed/cancelled prepare must never silently open a new execution.
    try { handlers.onError?.(new Error('Pine engine is not prepared')); } catch { /* host callback */ }
    return {
      getContext: () => Promise.resolve(null),
      stop() {},
      update() {},
      setVisibleRange() {},
      notifyBars() {},
    };
  }

  /** Like PineWorkerEngine.terminate(), allows a later explicit prepare to restart. */
  terminate(): void {
    this.epoch += 1;
    this.loading = undefined;
    const engine = this.engine;
    this.engine = undefined;
    for (const reject of this.pending) reject(new Error('Pine engine loading cancelled'));
    this.pending.clear();
    engine?.terminate();
  }

  /** Workspace teardown is terminal, including references held by late callers. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminate();
  }

  private load(): Promise<LoadedPineWorkerEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    const loading = Promise.resolve().then(this.loader).then(({ PineWorkerEngine }) => {
      if (epoch !== this.epoch || this.disposed) throw new Error('Pine engine loading cancelled');
      const engine = new PineWorkerEngine();
      this.engine = engine;
      return engine;
    });
    this.loading = loading;
    // Release only this attempt. A late failed import must not clear a newer
    // Retry's in-flight promise; failure stays visible through prepare().
    void loading.then(
      () => { if (this.loading === loading) this.loading = undefined; },
      () => { if (this.loading === loading) this.loading = undefined; },
    );
    return loading;
  }
}
