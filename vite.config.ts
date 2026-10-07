import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Keep the shell entrypoint revalidatable while allowing content-addressed
 * assets to remain cached across a same-slot rollback.  This is deliberately
 * installed for Vite's production preview too: otherwise the local release
 * smoke tests exercise a mock server with a cache contract that the actual
 * preview server does not provide.
 */
function releaseCacheHeaders() {
  return {
    name: 'quant-release-cache-headers',
    configurePreviewServer(server: {
      middlewares: {
        use: (handler: (request: { url?: string }, response: { headersSent?: boolean; setHeader: (name: string, value: string) => void }, next: () => void) => void) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?', 1)[0];
        const policy = pathname === '/' || pathname.endsWith('.html') || pathname === ''
          ? 'no-cache, no-store, must-revalidate'
          : /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.[^/]+$/.test(pathname)
            ? 'public, max-age=31536000, immutable'
            : undefined;
        if (policy) {
          // Vite's static middleware writes its own Cache-Control header after
          // this middleware runs. Intercept only that one header so all other
          // response behavior remains owned by Vite.
          const setHeader = response.setHeader.bind(response);
          response.setHeader = (name, value) => setHeader(name, name.toLowerCase() === 'cache-control' ? policy : value);
        }
        next();
      });
    },
  };
}

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
  plugins: [releaseCacheHeaders()],
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
    // Local DOM captures are evidence, not app entries. Writing them while a
    // browser is open must not trigger Vite's HTML full-page reloads.
    watch: { ignored: ['**/audit-evidence/**'] },
  },
});
