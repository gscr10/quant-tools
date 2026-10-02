import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function resolveBuildCommit(): string {
  const fromEnvironment = process.env.VITE_COMMIT_ID?.trim();
  if (fromEnvironment) return fromEnvironment.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __QUANT_BUILD_COMMIT__: JSON.stringify(resolveBuildCommit()),
  },
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
