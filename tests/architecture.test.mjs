import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));

class MemoryStorage {
  #values;

  constructor(values = {}) {
    this.#values = new Map(Object.entries(values));
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}

test('main remains a composition entry without Vela or feature logic', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /createApp\('#workspace'\)/);
  assert.match(source, /import\.meta\.hot\.dispose/);
  assert.doesNotMatch(source, /@luxalgo\/vela/);
  assert.ok(source.split('\n').length <= 12);
});

test('workspace defaults, toolbar composition, providers, and dependency versions stay frozen', async () => {
  const { WORKSPACE_DEFAULTS, WORKSPACE_TOPBAR } = await import(
    '../src/config/workspace-options.ts'
  );
  assert.deepEqual(WORKSPACE_DEFAULTS, {
    layout: '1',
    symbol: 'BTCUSDT',
    timeframe: '15',
    live: true,
    theme: 'dark',
    timezone: 'Etc/UTC',
    defaultLanguage: 'pine',
  });
  assert.deepEqual(WORKSPACE_TOPBAR, {
    left: [
      'symbol',
      'timeframes',
      'style',
      'layout',
      'indicators',
      'quant-favorites',
      'quant-templates',
      'undo-redo',
    ],
    right: ['panels', 'screenshot'],
  });

  const { createWorkspaceProviders } = await import(
    '../src/integrations/vela/provider-registry.ts'
  );
  const providers = createWorkspaceProviders();
  assert.deepEqual(Object.keys(providers), ['binance', 'hyperliquid']);
  assert.equal(providers.binance().constructor.name, 'BinanceProvider');
  assert.equal(providers.hyperliquid().constructor.name, 'HyperliquidProvider');

  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dependencies['@luxalgo/vela'], '^0.7.7');
  assert.equal(manifest.dependencies['@luxalgo/vela-pinets'], '^0.2.13');
  assert.equal(manifest.dependencies.pinets, '^0.9.34');
});

test('legacy storage facade contains compatibility exports only', async () => {
  const source = await readFile(new URL('../src/storage.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\blocalStorage\b/);
  assert.doesNotMatch(source, /\b(?:function|class)\s+[A-Za-z_$]/);
  assert.doesNotMatch(source, /\b(?:const|let|var)\s+[A-Za-z_$]/);
});

test('TypeScript modules have no circular dependencies and keep Vela behind explicit boundaries', async () => {
  const entries = await readdir(SRC_ROOT, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
  const fileSet = new Set(files);
  const imports = new Map();
  const directVelaImports = [];
  const integrationFeatureViolations = [];
  const crossFeatureViolations = [];
  const domainBoundaryViolations = [];
  const featureIntegrationViolations = [];
  const localStorageViolations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const specs = [...source.matchAll(
      /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    )].map((match) => match[1]);
    const relativeFile = path.relative(SRC_ROOT, file);

    if (/\blocalStorage\b/.test(source)
      && !relativeFile.startsWith(`integrations${path.sep}storage${path.sep}`)) {
      localStorageViolations.push(relativeFile);
    }

    for (const spec of specs) {
      if (spec === '@luxalgo/vela' || spec.startsWith('@luxalgo/vela/')) {
        if (!relativeFile.includes(`${path.sep}integrations${path.sep}vela${path.sep}`)
          && !relativeFile.startsWith(`integrations${path.sep}vela${path.sep}`)
          && !relativeFile.endsWith('.vela.ts')) {
          directVelaImports.push(relativeFile);
        }
      }
      if (!spec.startsWith('.')) continue;
      const withoutQuery = spec.split('?')[0];
      const resolved = path.resolve(path.dirname(file), withoutQuery);
      const target = fileSet.has(resolved) ? resolved : `${resolved}.ts`;
      if (!fileSet.has(target)) continue;
      const sourceFeature = relativeFile.match(/^features[/\\]([^/\\]+)/)?.[1];
      const targetRelative = path.relative(SRC_ROOT, target);
      const targetFeature = targetRelative.match(/^features[/\\]([^/\\]+)/)?.[1];
      if (relativeFile.startsWith(`integrations${path.sep}`)
        && targetRelative.startsWith(`features${path.sep}`)) {
        integrationFeatureViolations.push(`${relativeFile} -> ${targetRelative}`);
      }
      if (sourceFeature && targetFeature && sourceFeature !== targetFeature) {
        crossFeatureViolations.push(`${relativeFile} -> ${targetRelative}`);
      }
      if (relativeFile.startsWith(`domain${path.sep}`)
        && /^(?:app|features|integrations|shared)[/\\]/.test(targetRelative)) {
        domainBoundaryViolations.push(`${relativeFile} -> ${targetRelative}`);
      }
      if (sourceFeature && targetRelative.startsWith(`integrations${path.sep}`)) {
        featureIntegrationViolations.push(`${relativeFile} -> ${targetRelative}`);
      }
      const current = imports.get(file) ?? [];
      current.push(target);
      imports.set(file, current);
    }
  }

  assert.deepEqual(directVelaImports, []);
  assert.deepEqual(integrationFeatureViolations, []);
  assert.deepEqual(crossFeatureViolations, []);
  assert.deepEqual(domainBoundaryViolations, []);
  assert.deepEqual(featureIntegrationViolations, []);
  assert.deepEqual(localStorageViolations, []);

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  const visit = (file) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      cycles.push([...stack.slice(start), file].map((item) => path.relative(SRC_ROOT, item)));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const dependency of imports.get(file) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };
  files.forEach(visit);
  assert.deepEqual(cycles, []);
});

test('extracts Pine titles without coupling to the editor', async () => {
  const { extractPineTitle, NEW_PINE_SCRIPT } = await import('../src/domain/pine-source.ts');
  assert.equal(extractPineTitle('indicator("Alpha", overlay=true)'), 'Alpha');
  assert.equal(extractPineTitle("strategy(title='Beta')"), 'Beta');
  assert.equal(extractPineTitle('library("Gamma")'), 'Gamma');
  assert.equal(extractPineTitle('indicator("  Spaced title  ")'), '  Spaced title  ');
  assert.equal(extractPineTitle('plot(close)'), 'Untitled indicator');
  assert.equal(
    NEW_PINE_SCRIPT,
    '//@version=6\nindicator("My Indicator", overlay=true)\n\n'
      + 'plot(ta.ema(close, 14), "EMA 14", color.orange)\n',
  );
});

test('disposer stack cleans up in reverse order, remains idempotent, and continues after errors', async () => {
  const { DisposerStack } = await import('../src/app/lifecycle.ts');
  const order = [];
  const stack = new DisposerStack();
  stack.add(() => order.push('first'));
  stack.add(() => {
    order.push('second');
    throw new Error('cleanup failure');
  });
  assert.throws(() => stack.dispose(), /cleanup failure/);
  assert.deepEqual(order, ['second', 'first']);
  assert.doesNotThrow(() => stack.dispose());

  const late = [];
  const disposed = new DisposerStack();
  disposed.dispose();
  disposed.add(() => late.push('now'));
  assert.deepEqual(late, ['now']);
});

test('validates external indicator state before restoring it', async () => {
  const { parsePersistedExternalIndicators } = await import(
    '../src/integrations/vela/external-indicator-persistence.ts'
  );
  const parsed = parsePersistedExternalIndicators([
    {
      name: ' Saved indicator ',
      script: 'plot(close)',
      language: 'pine',
      id: ' external-1 ',
      hidden: true,
      inputs: { length: 20, invalid: { nested: true } },
      props: { overlay: true, invalid: null },
    },
    { name: '', script: 'plot(open)' },
    { name: 'Missing source' },
    null,
  ]);

  assert.deepEqual(parsed, [{
    name: 'Saved indicator',
    script: 'plot(close)',
    language: 'pine',
    id: ' external-1 ',
    hidden: true,
    inputs: { length: 20 },
    props: { overlay: true },
  }]);
  assert.deepEqual(parsePersistedExternalIndicators({}), []);
});

test('external indicator persistence serializes and restores the addressed cell only', async () => {
  const { statePersistenceHandlers } = await import('@luxalgo/vela/plugin');
  const {
    EXTERNAL_INDICATORS_KEY,
    registerExternalIndicatorPersistence,
  } = await import('../src/integrations/vela/external-indicator-persistence.ts');
  const cells = new Map([
    ['c1', {
      instances: [{
        external: true,
        entry: { name: 'First', script: 'plot(close)', language: 'pine' },
        id: 'first-id',
        handle: { visible: true },
        values: { inputs: { length: 10 }, props: { overlay: true } },
      }],
    }],
    ['c2', {
      instances: [
        {
          external: false,
          entry: { name: 'Manifest', script: 'plot(open)', language: 'pine' },
        },
        {
          external: true,
          entry: { name: 'Second', script: 'plot(high)', language: 'pine' },
          id: 'second-id',
          handle: { visible: false },
          values: { inputs: { length: 20 }, props: { overlay: false } },
        },
      ],
    }],
  ]);
  const unregister = registerExternalIndicatorPersistence(() => ({
    cell: (id) => cells.get(id),
  }));
  try {
    const handler = statePersistenceHandlers('cell')
      .find((entry) => entry.key === EXTERNAL_INDICATORS_KEY);
    assert.ok(handler);
    assert.deepEqual(handler.serialize({ cellId: 'c2' }), [{
      name: 'Second',
      script: 'plot(high)',
      language: 'pine',
      id: 'second-id',
      hidden: true,
      inputs: { length: 20 },
      props: { overlay: false },
    }]);

    const restored = [];
    handler.restore([
      { name: ' Restored ', script: 'plot(low)', inputs: { length: 7 } },
      { name: '', script: 'invalid' },
    ], { addIndicator: (entry) => restored.push(entry) });
    assert.deepEqual(restored, [{
      name: 'Restored',
      script: 'plot(low)',
      inputs: { length: 7 },
    }]);
  } finally {
    unregister();
  }
  assert.equal(
    statePersistenceHandlers('cell').some((entry) => entry.key === EXTERNAL_INDICATORS_KEY),
    false,
  );
});

test('script and indicator favorite state stays synchronized through edits', async () => {
  globalThis.localStorage = new MemoryStorage();
  const { scriptFavorite } = await import('../src/domain/indicators.ts');
  const { FavoriteService } = await import(
    '../src/features/favorites/favorite-service.ts?test=favorite-service'
  );
  const { ScriptService } = await import(
    '../src/features/pine-editor/script-service.ts?test=script-service'
  );
  const { browserFavoriteRepository } = await import(
    '../src/integrations/storage/favorite-repository.ts?test=favorite-repository'
  );
  const { browserScriptRepository } = await import(
    '../src/integrations/storage/script-repository.ts?test=script-repository'
  );

  const favorites = new FavoriteService(browserFavoriteRepository, browserScriptRepository);
  const scripts = new ScriptService(browserScriptRepository, favorites);
  scripts.save('Alpha', 'indicator("Alpha")\nplot(close)');
  let favoriteEvents = 0;
  const unsubscribe = favorites.subscribe(() => { favoriteEvents++; });
  assert.equal(scripts.toggleFavorite('Alpha'), true);
  assert.equal(favoriteEvents, 1);
  assert.equal(favorites.list().length, 1);
  assert.equal(favorites.has(scriptFavorite('Alpha', 'indicator("Alpha")\nplot(close)')), true);

  favoriteEvents = 0;
  scripts.save('Alpha', 'indicator("Alpha")\nplot(open)');
  assert.equal(favoriteEvents, 1);
  assert.equal(favorites.list().length, 1);
  assert.equal(favorites.list()[0].script, 'indicator("Alpha")\nplot(open)');
  assert.equal(scripts.isFavorite('Alpha'), true);

  favoriteEvents = 0;
  scripts.rename('Alpha', 'Renamed', 'indicator("Alpha")\nplot(open)');
  assert.equal(favoriteEvents, 1);
  assert.equal(scripts.get('Alpha'), undefined);
  assert.equal(scripts.get('Renamed')?.favorite, true);
  assert.equal(favorites.list()[0].name, 'Renamed');

  favoriteEvents = 0;
  scripts.delete('Renamed');
  assert.equal(favoriteEvents, 1);
  assert.deepEqual(scripts.list(), []);
  assert.deepEqual(favorites.list(), []);
  unsubscribe();
});

test('favorite compatibility reconciliation preserves both legacy representations', async () => {
  const { scriptFavorite } = await import('../src/domain/indicators.ts');
  const { FavoriteService } = await import(
    '../src/features/favorites/favorite-service.ts?test=reconcile'
  );
  let scripts = [
    { name: 'Legacy starred', script: 'plot(close)', savedAt: 1, favorite: true },
    { name: 'Indicator starred', script: 'plot(open)', savedAt: 2 },
  ];
  let favorites = [scriptFavorite('Indicator starred', 'plot(open)')];
  const scriptRepository = {
    list: () => scripts.map((entry) => ({ ...entry })),
    save: () => scripts,
    delete: () => scripts,
    rename: () => scripts,
    toggleFavorite: (name) => {
      scripts = scripts.map((entry) => entry.name === name
        ? { ...entry, favorite: !entry.favorite }
        : entry);
      return scripts;
    },
    isFavorite: (name) => scripts.some((entry) => entry.name === name && entry.favorite),
  };
  const favoriteRepository = {
    list: () => favorites.map((entry) => ({ ...entry })),
    set: (favorite, enabled) => {
      favorites = favorites.filter((entry) => entry.key !== favorite.key);
      if (enabled) favorites.unshift({ ...favorite });
      return favorites;
    },
  };
  const service = new FavoriteService(favoriteRepository, scriptRepository);
  let events = 0;
  service.subscribe(() => { events++; });
  service.reconcileLegacyScripts();

  assert.equal(events, 1);
  assert.equal(scripts.every((entry) => entry.favorite === true), true);
  assert.equal(favorites.length, 2);
  assert.equal(service.has(scriptFavorite('Legacy starred', 'plot(close)')), true);
  assert.equal(service.has(scriptFavorite('Indicator starred', 'plot(open)')), true);
  service.destroy();
});
