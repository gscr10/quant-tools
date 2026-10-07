import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config.ts';

// An isolated production graph built with the application config. Test entry
// points are never added to the ordinary deployment build.
const root = resolve(import.meta.dirname, '..');
export default mergeConfig(appConfig, defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        performance: resolve(root, 'tests/fixtures/backtest-performance.html'),
        simulation: resolve(root, 'tests/fixtures/backtest-simulation.html'),
      },
    },
  },
}));
