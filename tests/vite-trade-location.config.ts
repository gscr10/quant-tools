import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config.ts';

/** App imports/build constants with a stable one-shot browser probe. */
export default mergeConfig(appConfig, defineConfig({
  optimizeDeps: { noDiscovery: true },
  server: { hmr: false },
  plugins: [{
    name: 'trade-location-without-dev-client',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/\s*<script type="module" src="\/?@vite\/client"><\/script>\s*/g, '\n');
    },
  }],
}));
