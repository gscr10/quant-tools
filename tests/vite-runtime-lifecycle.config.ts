import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import config from '../vite.config.ts';

const root = resolve(import.meta.dirname, '..');
const changes = new Map([
  ['host', 'tests/fixtures/runtime-lifecycle.ts'],
  ['css', 'src/style.css'],
  ['main', 'src/main.ts'],
]);

export default mergeConfig(config, defineConfig({
  plugins: [{
    name: 'runtime-lifecycle-change-trigger',
    configureServer(server) {
      // Emit the same event as a saved file, without changing a user's source.
      // The endpoint exists only in this dev test config, never in a build.
      server.middlewares.use('/__runtime_lifecycle_change', (req, res) => {
        const key = new URL(req.url ?? '', 'http://localhost').searchParams.get('kind');
        const path = key && changes.get(key);
        if (req.method !== 'POST' || !path) {
          res.statusCode = 400;
          res.end('unsupported lifecycle change');
          return;
        }
        server.watcher.emit('change', resolve(root, path));
        res.statusCode = 202;
        res.end('change emitted');
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        lifecycle: resolve(root, 'tests/fixtures/runtime-lifecycle.html'),
      },
    },
  },
}));
