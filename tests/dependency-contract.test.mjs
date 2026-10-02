import test from 'node:test';
import assert from 'node:assert/strict';

test('G4a workspace dependency baseline is exact and singleton-resolved', async () => {
  const { checkDependencyContract } = await import('../scripts/check-dependency-contract.mjs');
  const result = await checkDependencyContract();
  assert.equal(result.mode, 'workspace-baseline');
  assert.deepEqual(
    result.packages.map(({ name, version, mode }) => ({ name, version, mode })),
    [
      { name: '@luxalgo/vela', version: '0.7.7', mode: 'registry' },
      { name: '@luxalgo/vela-pinets', version: '0.2.13', mode: 'workspace' },
      { name: 'pinets', version: '0.9.34', mode: 'workspace' },
    ],
  );
  assert.equal(result.builds.pinets.upstreamSha, 'beacd587e83aa7ee061023f8cea66b2e887d5676');
  assert.equal(result.builds.bridge.embeddedPinetsSha, result.builds.pinets.upstreamSha);
  assert.equal(result.builds.bridge.embeddedPinetsFingerprint, result.builds.pinets.buildFingerprint);
  assert.match(result.builds.executionFingerprint, /@luxalgo\/vela-pinets@0\.2\.13/);
  assert.match(result.builds.executionFingerprint, /pinets@0\.9\.34/);
  assert.match(result.builds.sentinel, /vela-pinets-local-build-v1\|pinets-local-build-v1/);
});
