import { createApp, type QuantApp } from '../../src/app/create-app.ts';
import '../../src/style.css';

// This host exercises the real composition root, including real Worker and
// charts. Its explicit accept boundary allows Vite to exercise hot disposal;
// the ordinary application entry instead uses a full reload for TS changes.
const state = ((window as any).__runtimeLifecycle ??= {
  mounts: 0, destroys: 0, hotDisposals: 0, app: null,
});
let app: QuantApp | null = null;
state.mount = () => {
  if (app) throw new Error('Application already mounted');
  app = createApp('#workspace');
  state.app = app;
  state.mounts += 1;
};
state.destroy = () => {
  if (!app) return;
  const current = app;
  app = null;
  state.app = null;
  current.destroy();
  state.destroys += 1;
};
state.addStrategy = () => {
  if (!app) throw new Error('Application is not mounted');
  if (app.workspace.getOnChartIndicators().some((item) => item.name === 'Lifecycle audit')) return;
  app.workspace.addScriptIndicator('Lifecycle audit', `//@version=6
strategy("Lifecycle audit", overlay=true, initial_capital=10000)
if bar_index % 20 == 0
    strategy.entry("L", strategy.long)
if bar_index % 20 == 10
    strategy.close("L")
`);
};
state.mount();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    state.hotDisposals += 1;
    state.destroy();
  });
}
