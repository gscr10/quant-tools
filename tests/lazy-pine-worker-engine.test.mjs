import test from 'node:test';
import assert from 'node:assert/strict';
import { LazyPineWorkerEngine } from '../src/integrations/vela/lazy-worker-engine.ts';
import { createPineEngineRegistry } from '../src/integrations/pinets/create-engine.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function moduleFixture() {
  const instances = [];
  class PineWorkerEngine {
    language = 'pine';
    capabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    calls = [];
    terminated = 0;
    constructor() { instances.push(this); }
    prepare(source, instanceId) {
      this.calls.push(['prepare', source, instanceId]);
      return Promise.resolve({ source, instanceId });
    }
    execute(request, handlers) {
      this.calls.push(['execute', request, handlers]);
      return this.session;
    }
    terminate() { this.terminated++; }
    session = { stop() {}, update() {}, setVisibleRange() {}, notifyBars() {} };
  }
  return { module: { PineWorkerEngine }, instances };
}

test('lazy Pine engine factory is synchronous and does not load Worker bytes before prepare', () => {
  let imports = 0;
  const engine = new LazyPineWorkerEngine(() => { imports++; throw new Error('unexpected import'); });
  assert.equal(engine.language, 'pine');
  assert.deepEqual(engine.capabilities, { streaming: true, visibleRange: true, inputs: true, props: true });
  assert.match(engine.buildFingerprint, /pinets/);
  assert.equal(imports, 0);
  engine.dispose();
  assert.equal(imports, 0);
});

test('concurrent prepare imports once per Cell and delegates exact source/session objects', async () => {
  const fixture = moduleFixture();
  const pending = deferred();
  let imports = 0;
  const engine = new LazyPineWorkerEngine(() => { imports++; return pending.promise; });
  const a = engine.prepare('source-a', 'a');
  const b = engine.prepare('source-b', 'b');
  await flush();
  assert.equal(imports, 1);
  pending.resolve(fixture.module);
  assert.deepEqual(await Promise.all([a, b]), [{ source: 'source-a', instanceId: 'a' }, { source: 'source-b', instanceId: 'b' }]);
  assert.equal(fixture.instances.length, 1);
  const request = { prepared: {}, historyState: 'backfill', mode: 'live' };
  const handlers = { onModel() {} };
  assert.equal(engine.execute(request, handlers), fixture.instances[0].session);
  assert.deepEqual(fixture.instances[0].calls[2], ['execute', request, handlers]);
  engine.dispose();
  engine.dispose();
  assert.equal(fixture.instances[0].terminated, 1);
});

test('failed module load rejects prepare and a subsequent prepare retries', async () => {
  const fixture = moduleFixture();
  let attempts = 0;
  const engine = new LazyPineWorkerEngine(() => ++attempts === 1
    ? Promise.reject(new Error('chunk download failed')) : Promise.resolve(fixture.module));
  await assert.rejects(engine.prepare('a', 'a'), /chunk download failed/);
  assert.deepEqual(await engine.prepare('b', 'b'), { source: 'b', instanceId: 'b' });
  assert.equal(attempts, 2);
  engine.dispose();
});

test('dispose immediately rejects pending prepare and a late import cannot construct a Worker', async () => {
  const fixture = moduleFixture();
  const pending = deferred();
  const engine = new LazyPineWorkerEngine(() => pending.promise);
  const prepared = engine.prepare('a', 'a');
  const rejected = assert.rejects(prepared, /cancelled/);
  await flush();
  engine.dispose();
  await rejected;
  pending.resolve(fixture.module);
  await flush();
  assert.equal(fixture.instances.length, 0);
  await assert.rejects(engine.prepare('b', 'b'), /disposed/);
});

test('terminate restarts cleanly; stale failed import cannot clear the new in-flight attempt', async () => {
  const fixture = moduleFixture();
  const old = deferred();
  const current = deferred();
  let attempts = 0;
  const engine = new LazyPineWorkerEngine(() => ++attempts === 1 ? old.promise : current.promise);
  const first = engine.prepare('a', 'a');
  const rejected = assert.rejects(first, /cancelled/);
  await flush();
  engine.terminate();
  await rejected;
  const second = engine.prepare('b', 'b');
  await flush();
  old.reject(new Error('old network failure'));
  await flush();
  const third = engine.prepare('c', 'c');
  await flush();
  assert.equal(attempts, 2);
  current.resolve(fixture.module);
  await Promise.all([second, third]);
  assert.equal(fixture.instances.length, 1);
  engine.dispose();
});

test('two Cell engines share no mutable instance and dispose independently', async () => {
  const fixture = moduleFixture();
  const a = new LazyPineWorkerEngine(() => Promise.resolve(fixture.module));
  const b = new LazyPineWorkerEngine(() => Promise.resolve(fixture.module));
  await Promise.all([a.prepare('a', 'a'), b.prepare('b', 'b')]);
  assert.equal(fixture.instances.length, 2);
  a.dispose();
  assert.equal(fixture.instances[0].terminated, 1);
  assert.equal(fixture.instances[1].terminated, 0);
  await b.prepare('c', 'c');
  b.dispose();
});

test('execute before prepare reports error, stays inert and never starts loading', async () => {
  let imports = 0;
  const engine = new LazyPineWorkerEngine(() => { imports++; return Promise.reject(new Error()); });
  const errors = [];
  const session = engine.execute({}, { onError: (error) => errors.push(error.message) });
  assert.deepEqual(errors, ['Pine engine is not prepared']);
  assert.equal(await session.getContext(), null);
  session.stop(); session.update({}); session.notifyBars('complete'); session.setVisibleRange({});
  assert.equal(imports, 0);
  engine.dispose();
});

test('registry disposal prevents lazy engines held by late callers from resurrecting Workers', async () => {
  const registry = createPineEngineRegistry();
  const engine = registry.create();
  registry.dispose();
  registry.dispose();
  assert.throws(() => registry.create(), /disposed/);
  await assert.rejects(engine.prepare('a', 'a'), /disposed/);
});
