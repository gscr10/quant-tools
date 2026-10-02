import { defineConfig } from 'vite';

export default defineConfig({
  // Only the root application is a dependency-scan entry. The workspace also
  // contains a Vela-PineTS playground with its own inline-worker plugin; it is
  // intentionally not part of the production app dependency graph.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    allowedHosts: ['.monkeycode-ai.online'],
  },
});
