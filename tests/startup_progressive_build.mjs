/** Test-only production build: one artifact, one runtime progressive toggle. */
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = process.argv[2];
if (!output) throw new Error('Pass an isolated output directory');
const root = process.cwd();
const expected = "if (kind === 'binance') enableProviderProgressiveHistory(guarded);";
const replacement = "if (kind === 'binance' && !(globalThis as any).__STARTUP_DISABLE_PROGRESSIVE__) enableProviderProgressiveHistory(guarded);";
const registry = resolve(root, 'src/integrations/vela/provider-registry.ts');
const entry = resolve(root, 'src/main.ts');
const inputs = Object.fromEntries([registry, entry].map(path => [path,
  createHash('sha256').update(readFileSync(path)).digest('hex')]));
let registryTransforms = 0, entryTransforms = 0;
await build({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  build: { outDir: resolve(output), emptyOutDir: true },
  plugins: [{
    name: 'startup-progressive-benchmark-only', enforce: 'pre',
    transform(source, id) {
      if (id === registry) {
        if (source.split(expected).length !== 2) throw new Error('Progressive enable seam changed');
        registryTransforms++;
        return { code: source.replace(expected, replacement), map: null };
      }
      if (id === entry) {
        entryTransforms++;
        return { code: source + '\nglobalThis.__startup.attach(app);\n', map: null };
      }
    },
  }],
});
if (registryTransforms !== 1 || entryTransforms !== 1) throw new Error('Expected both test transforms exactly once');
for (const [path, hash] of Object.entries(inputs)) {
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw new Error('Source changed during benchmark build');
}
writeFileSync(resolve(output, 'benchmark-build.json'), JSON.stringify({
  purpose: 'Controlled progressive-only ABBA benchmark; never deploy this artifact',
  inputs, registryTransforms, entryTransforms, expected, replacement,
  baseline: '__STARTUP_DISABLE_PROGRESSIVE__ = true',
  optimized: '__STARTUP_DISABLE_PROGRESSIVE__ = false',
}, null, 2));
