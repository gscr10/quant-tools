/** Isolated eager/lazy resource experiment; never writes shared dist or source. */
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [output, variant] = process.argv.slice(2);
if (!output || !['eager', 'lazy'].includes(variant)) throw new Error('Expected isolated outDir and eager|lazy');
const root = process.cwd();
const entry = resolve(root, 'src/main.ts');
const worker = resolve(root, 'src/integrations/vela/lazy-worker-engine.ts');
const editor = resolve(root, 'src/features/pine-editor/lazy-pine-editor.ts');
const inputs = Object.fromEntries([entry, worker, editor].map(path => [path,
  createHash('sha256').update(readFileSync(path)).digest('hex')]));
const transforms = [];
await build({
  root, configFile: resolve(root, 'vite.config.ts'),
  build: { outDir: resolve(output), emptyOutDir: true },
  plugins: [{ name: 'startup-resource-counterfactual-only', enforce: 'pre',
    transform(source, id) {
      if (id === entry) {
        transforms.push({ id, purpose: 'common App observation hook' });
        return { code: source + '\nglobalThis.__startup.attach(app);\n', map: null };
      }
      if (variant !== 'eager') return;
      if (id === worker) {
        const before = "const loadWorkerEngine: PineWorkerEngineLoader = () => import('@luxalgo/vela-pinets/worker-engine');";
        const after = 'const loadWorkerEngine: PineWorkerEngineLoader = () => Promise.resolve({ PineWorkerEngine: BenchmarkEagerWorker });';
        if (source.split(before).length !== 2) throw new Error('Worker lazy seam changed');
        transforms.push({ id, before, after });
        return { code: "import { PineWorkerEngine as BenchmarkEagerWorker } from '@luxalgo/vela-pinets/worker-engine';\n" + source.replace(before, after), map: null };
      }
      if (id === editor) {
        const before = "void import('./pine-editor-controller.ts').then(({ PineEditorController: Controller }) => {";
        const after = 'void Promise.resolve({ PineEditorController: BenchmarkEagerEditor }).then(({ PineEditorController: Controller }) => {';
        if (source.split(before).length !== 2) throw new Error('Editor lazy seam changed');
        transforms.push({ id, before, after });
        return { code: "import { PineEditorController as BenchmarkEagerEditor } from './pine-editor-controller.ts';\n" + source.replace(before, after), map: null };
      }
    },
  }],
});
if (transforms.length !== (variant === 'eager' ? 3 : 1)) throw new Error('Missing or repeated build transform');
for (const [path, hash] of Object.entries(inputs)) {
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw new Error('Source changed during resource build');
}
writeFileSync(resolve(output, 'benchmark-build.json'), JSON.stringify({
  purpose: 'Resource-size counterfactual only; never deploy', variant, inputs, transforms,
  behavior: 'Same lazy wrappers and runtime behavior; eager variant changes only implementation module imports from dynamic to static',
}, null, 2));
