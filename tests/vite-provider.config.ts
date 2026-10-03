import { defineConfig } from 'vite';

/** Provider smoke is a one-shot real-network page; HMR must not reload it
 * while fork outputs or source maps are refreshed in the same workspace. */
const withoutDevClient = {
  name: 'quant-provider-without-vite-dev-client',
  enforce: 'post' as const,
  transformIndexHtml(html: string) {
    return html.replace(/\s*<script type="module" src="\/?@vite\/client"><\/script>\s*/g, '\n');
  },
};

export default defineConfig({
  plugins: [withoutDevClient],
  server: {
    hmr: false,
  },
});
