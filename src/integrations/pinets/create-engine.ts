import { LazyPineWorkerEngine } from '../vela/lazy-worker-engine.ts';

export function createPineEngine(): LazyPineWorkerEngine {
  return new LazyPineWorkerEngine();
}

/**
 * Vela creates one scripting engine per chart cell, but its public workspace
 * destroy contract only stops the sessions owned by those cells.  Keep the
 * engine instances in a workspace-scoped registry so the composition root can
 * terminate the worker threads as well (including a worker that is idle after
 * its last indicator was removed).
 */
export interface PineEngineRegistry {
  readonly create: () => LazyPineWorkerEngine;
  dispose(): void;
}

export function createPineEngineRegistry(): PineEngineRegistry {
  const engines = new Set<LazyPineWorkerEngine>();
  let disposed = false;

  return {
    create: () => {
      if (disposed) {
        // A factory call after workspace teardown is a programming error. Do
        // not return an engine whose reusable terminate() method could spawn a
        // fresh worker on the next prepare() call.
        throw new Error('Pine engine registry has been disposed');
      }
      const engine = createPineEngine();
      engines.add(engine);
      return engine;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const engine of engines) engine.dispose();
      engines.clear();
    },
  };
}
