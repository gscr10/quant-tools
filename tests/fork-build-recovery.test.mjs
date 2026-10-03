import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { acquireBuildLock } from '../scripts/fork-build-lock.mjs';

const script = new URL('../scripts/ensure-fork-build.mjs', import.meta.url);
const outputs = [...readFileSync(script, 'utf8').split('const inputRoots')[0]
  .matchAll(/'(packages\/[^']+)'/g)].map(match => match[1]);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'quant-fork-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: { 'build:forks:run': 'node build.cjs' },
  }));
  writeFileSync(join(root, 'build.cjs'), `
    const fs = require('node:fs'), path = require('node:path');
    fs.appendFileSync('attempts', 'build\\n');
    for (const output of ${JSON.stringify(outputs)}) {
      fs.mkdirSync(path.dirname(output), {recursive:true});
      fs.writeFileSync(output, 'generated');
    }
    if (fs.existsSync('fail')) process.exit(1);
  `);
  return root;
}

test('failed fork builds cannot reuse fresh partial outputs; successful retry restores cache', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'fail'), '');
  const invoke = () => spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
  const failed = invoke();
  assert.notEqual(failed.status, 0);
  const marker = join(root, '.cache', 'quant-tools-fork-build.incomplete');
  assert.ok(existsSync(marker));
  assert.ok(outputs.every(output => existsSync(join(root, output))));
  rmSync(join(root, 'fail'));
  const retried = invoke();
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /previous build did not complete/);
  assert.equal(existsSync(marker), false);
  assert.equal(invoke().status, 0);
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\nbuild\n');
});

test('current-looking outputs still wait for the active build owner', async t => {
  const root = fixture(t);
  for (const output of outputs) {
    mkdirSync(dirname(join(root, output)), { recursive: true });
    writeFileSync(join(root, output), 'fresh but owner still active');
  }
  const release = acquireBuildLock({ root });
  t.after(release);
  const child = spawn(process.execPath, [script.pathname], { cwd: root });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  let released = false;
  child.stdout.on('data', data => {
    output += data;
    if (output.includes('waiting for its outputs')) { released = true; release(); }
  });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('lock wait probe timed out')); }, 10_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', value => { clearTimeout(timeout); resolve(value); });
  });
  assert.equal(code, 0);
  assert.equal(released, true, 'must observe active lock even with current-looking outputs');
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\n');
});

test('invalid completion manifest fails closed and triggers a rebuild', t => {
  const root = fixture(t);
  const manifest = join(root, '.cache', 'quant-tools-fork-build.complete.json');
  mkdirSync(join(root, '.cache'), { recursive: true });
  for (const output of outputs) {
    mkdirSync(dirname(join(root, output)), { recursive: true });
    writeFileSync(join(root, output), 'stale output');
  }
  writeFileSync(manifest, JSON.stringify({ schema: 999, inputFingerprint: 'bad', outputFingerprint: 'bad' }));
  const result = spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rebuilding/);
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\n');
  assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).schema, 1);
});

test('completion manifest from another toolchain fails closed', t => {
  const root = fixture(t);
  const manifest = join(root, '.cache', 'quant-tools-fork-build.complete.json');
  mkdirSync(join(root, '.cache'), { recursive: true });
  for (const output of outputs) {
    mkdirSync(dirname(join(root, output)), { recursive: true });
    writeFileSync(join(root, output), 'stale output');
  }
  writeFileSync(manifest, JSON.stringify({
    schema: 1,
    inputFingerprint: 'foreign-input',
    outputFingerprint: 'foreign-output',
    toolchainFingerprint: 'foreign-toolchain',
  }));
  const result = spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rebuilding/);
});

test('content changes invalidate the cache even when mtime is restored', t => {
  const root = fixture(t);
  const invoke = () => spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
  assert.equal(invoke().status, 0);
  const packagePath = join(root, 'package.json');
  const before = statSync(packagePath);
  writeFileSync(packagePath, JSON.stringify({
    scripts: { 'build:forks:run': 'node build.cjs' },
    contentChanged: true,
  }));
  utimesSync(packagePath, before.atime, before.mtime);
  const second = invoke();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /source or build inputs changed/);
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\nbuild\n');
});

test('check-only mode verifies current outputs without rebuilding', t => {
  const root = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  const beforeBuild = invoke('--check-only');
  assert.notEqual(beforeBuild.status, 0);
  assert.match(beforeBuild.stderr, /run npm run build:forks first/);
  assert.equal(existsSync(join(root, 'attempts')), false);

  assert.equal(invoke().status, 0);
  const checked = invoke('--check-only');
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /verified current outputs/);
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\n');
});

test('check-only mode refuses to race an active fork build', t => {
  const root = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(invoke().status, 0);
  const release = acquireBuildLock({ root });
  t.after(release);
  const checked = invoke('--check-only');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /another fork build is active/);
  assert.equal(readFileSync(join(root, 'attempts'), 'utf8'), 'build\n');
});

test('check-only mode fails closed when an output path is replaced by a directory', t => {
  const root = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(invoke().status, 0);
  rmSync(join(root, outputs[0]));
  mkdirSync(join(root, outputs[0]), { recursive: true });

  const checked = invoke('--check-only');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /current outputs are not verified/);
  assert.doesNotMatch(checked.stderr, /EISDIR|Unhandled|TypeError/);
});

test('check-only mode fails closed when an output path is replaced by a symlink', t => {
  const root = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(invoke().status, 0);
  const output = join(root, outputs[0]);
  rmSync(output);
  const external = join(root, 'external-output');
  writeFileSync(external, 'generated');
  symlinkSync(external, output);

  const checked = invoke('--check-only');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /current outputs are not verified/);
  assert.doesNotMatch(checked.stderr, /EISDIR|Unhandled|TypeError/);
});

test('input fingerprint fails closed when a build input is replaced by a symlink', t => {
  const root = fixture(t);
  const invoke = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(invoke().status, 0);
  const packagePath = join(root, 'package.json');
  const external = join(root, 'external-package.json');
  writeFileSync(external, readFileSync(packagePath));
  rmSync(packagePath);
  symlinkSync(external, packagePath);

  const checked = invoke('--check-only');
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /input path must not be a symbolic link/);
  assert.doesNotMatch(checked.stderr, /EISDIR|Unhandled|TypeError/);
});
