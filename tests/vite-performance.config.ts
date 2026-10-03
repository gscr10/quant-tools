import { defineConfig } from 'vite';

/**
 * Vite 8 still injects its client module when `server.hmr` is false.  That
 * setting disables update handling on the server, but the injected client
 * would nevertheless open a WebSocket in a browser.  Performance and
 * cross-browser fixture gates are intentionally stable, one-shot pages, so
 * strip the client tag after Vite's own HTML transform as well.
 */
const withoutDevClient = {
    name: 'quant-without-vite-dev-client',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
        return html.replace(
            /\s*<script type="module" src="\/?@vite\/client"><\/script>\s*/g,
            '\n',
        );
    },
};

/**
 * The feature stylesheet is imported by the fixture's TypeScript modules.
 * Vite's dev CSS transform always imports `/@vite/client` (even with HMR
 * disabled), so serve this one self-contained stylesheet as a tiny JS module
 * that injects a regular `<style>` element instead.
 */
const withoutCssClient = {
    name: 'quant-without-vite-css-client',
    enforce: 'post' as const,
    transform(code: string, id: string) {
        if (id.split('?')[0].endsWith('/src/features/backtesting/backtest.css')) {
            // At this point Vite's CSS plugin has emitted a JS wrapper whose
            // `__vite__css` initializer is a JSON string literal. Reuse that
            // literal but replace the dev runtime with a plain style tag.
            const cssLiteral = code.match(
                /const __vite__css = ("(?:\\.|[^"\\])*")\s*(?:;|\n)/,
            )?.[1];
            if (!cssLiteral) return undefined;
            return {
                code: [
                    `const css = ${cssLiteral};`,
                    "if (typeof document !== 'undefined' && !document.querySelector('style[data-quant-backtest-css]')) {",
                    "  const style = document.createElement('style');",
                    "  style.dataset.quantBacktestCss = 'true';",
                    "  style.textContent = css;",
                    "  document.head.appendChild(style);",
                    '}',
                    'export default css;',
                ].join('\n'),
                map: null,
            };
        }
        return undefined;
    },
};

/**
 * The performance fixture is intentionally served without HMR.  The gate may
 * run beside the fork build, whose generated sources change while Chromium
 * is measuring a page; a hot update would reload the fixture and temporarily
 * remove its `window.__backtestPerformance` harness midway through a case.
 */
export default defineConfig({
    plugins: [withoutCssClient, withoutDevClient],
    // These fixtures are one-shot regression pages. Automatic dependency
    // discovery can invalidate an optimized module while the first browser
    // request is already in flight, yielding a transient 504 (Outdated
    // Optimize Dep) on a clean hosted runner. Let Vite transform the source
    // graph directly instead of racing the optimizer cache.
    optimizeDeps: {
        noDiscovery: true,
    },
    server: {
        allowedHosts: ['.monkeycode-ai.online'],
        hmr: false,
    },
});
