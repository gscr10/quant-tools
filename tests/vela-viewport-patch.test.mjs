import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ensureVelaViewport, VELA_VIEWPORT_PATCH } from '../scripts/ensure-vela-viewport.mjs';

const installed = readFileSync(new URL('../'+VELA_VIEWPORT_PATCH.file,import.meta.url),'utf8');
const original = installed.replace(VELA_VIEWPORT_PATCH.replacement,VELA_VIEWPORT_PATCH.original);
assert.equal(createHash('sha256').update(original).digest('hex'),VELA_VIEWPORT_PATCH.originalSha256);

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'quant-vela-viewport-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,VELA_VIEWPORT_PATCH.file);
  const manifest=join(root,'node_modules/@luxalgo/vela/package.json');
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(manifest,JSON.stringify({name:'@luxalgo/vela',version:'0.7.7'}));
  writeFileSync(target,original);
  return {root,target,manifest};
}

test('pinned viewport patch is exact and idempotent; re-check leaves timestamps unchanged',t=>{
  const {root,target}=fixture(t);
  assert.equal(ensureVelaViewport({root}).status,'applied');
  assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'),VELA_VIEWPORT_PATCH.patchedSha256);
  const mtime=statSync(target).mtimeMs;
  assert.equal(ensureVelaViewport({root}).status,'verified');
  assert.equal(ensureVelaViewport({root,checkOnly:true}).status,'verified');
  assert.equal(statSync(target).mtimeMs,mtime);
});

test('check-only rejects a missing patch without writing the package or Vite cache',t=>{
  const {root,target}=fixture(t);
  const metadata=join(root,'node_modules/.vite/deps/_metadata.json');
  mkdirSync(dirname(metadata),{recursive:true});writeFileSync(metadata,'existing cache');
  assert.throws(()=>ensureVelaViewport({root,checkOnly:true}),/patch is missing/);
  assert.equal(readFileSync(target,'utf8'),original);
  assert.equal(readFileSync(metadata,'utf8'),'existing cache');
  ensureVelaViewport({root});
  assert.throws(()=>statSync(metadata),{code:'ENOENT'});
});

test('unknown versions and altered package contents are rejected without mutation',t=>{
  const {root,target,manifest}=fixture(t);
  writeFileSync(manifest,JSON.stringify({name:'@luxalgo/vela',version:'0.7.8'}));
  assert.throws(()=>ensureVelaViewport({root}),/unsupported dependency/);
  assert.equal(readFileSync(target,'utf8'),original);
  writeFileSync(manifest,JSON.stringify({name:'@luxalgo/vela',version:'0.7.7'}));
  writeFileSync(target,original+'\n// unexpected modification');
  assert.throws(()=>ensureVelaViewport({root}),/unknown installed content/);
  assert.equal(readFileSync(target,'utf8'),original+'\n// unexpected modification');
});

test('patch rejects a symlink rather than modifying an external target',t=>{
  const {root,target}=fixture(t);
  const external=join(root,'external.js');
  writeFileSync(external,original);rmSync(target);symlinkSync(external,target);
  assert.throws(()=>ensureVelaViewport({root}),/symbolic link/);
  assert.equal(readFileSync(external,'utf8'),original);
});

test('changed absolute floor retains native fit-to-data, maximum zoom, and pan limits',()=>{
  const patched=original.replace(VELA_VIEWPORT_PATCH.original,VELA_VIEWPORT_PATCH.replacement);
  // The reviewed change must not replace clampViewport or the n + margin
  // constraint with an unlimited zoom-out path.
  assert.equal(patched.split(VELA_VIEWPORT_PATCH.replacement).length,2);
  assert.ok(patched.includes('W / ((n + ZOOM_OUT_MARGIN_BARS) * scale)'));
  assert.ok(patched.includes('Math.min(MAX_BAR_SPACING, W / (minVisible * scale))'));
  assert.ok(patched.includes('Math.max(minRo, Math.min(maxRo, rightOffset))'));
});
