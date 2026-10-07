# Vela 0.7.7 viewport compatibility

The application pins `@luxalgo/vela` to registry version `0.7.7`. It does not
vendor the entire Vela package. One installation-local patch is required to
frame all 2,000 default candles after a timeframe switch on a narrow cell.

Vela's public `setVisibleRange` and all native wheel, pinch, keyboard and
animation paths use an absolute minimum bar spacing of `0.5` CSS px. A mobile
plot 326 px wide could therefore show only 653 of the 2,000 loaded candles.
The public `series.spacing` style setting is not an appropriate substitute:
changing it would change the user's chart style and persisted workspace.

[`ensure-vela-viewport.mjs`](../../scripts/ensure-vela-viewport.mjs) changes only
`MIN_BAR_SPACING = 0.5` to `MIN_BAR_SPACING = 1e-6` in the reviewed ESM chunk.
The existing dynamic minimum based on `barCount + ZOOM_OUT_MARGIN_BARS`, maximum
zoom, and bounded panning remain intact. No candle is removed, interpolated or
resampled. This is an explicit internal compatibility patch, not public API use.

The script accepts only Vela `0.7.7` and exact complete-file SHA-256 inputs:

| Artifact | SHA-256 |
| --- | --- |
| Original `dist/chunk-RVQWJOEE.js` | `9fc236010d69a7def77993d59eb44ee6611538789e58ca33404623a4f9a31eac` |
| Reviewed patched output | `d7cb041243163b876a4468eb39513d864dfa8a9de16fe1439190ac7b2981e111` |

Unknown versions, modified files and symlinked targets fail without patching.
The patch is atomic and idempotent. `--check-only` never applies it or writes
Vite cache metadata. A first successful application invalidates generated Vite
dependency metadata so the next development server uses the corrected chunk.
Restart any already-running development server after initially applying it.

`ensure-fork-build.mjs` applies/verifies it under the existing build lock before
checking the fork cache. The script and patched chunk are fingerprint inputs.
Normal `npm ci` followed by `npm run build`, `npm run dev` or `npm test` therefore
reproduces the patch; `npm run dev:fast` rejects missing/stale setup. Installed
dependencies and generated bundles remain ignored by Git.

At the application boundary, an ordinary switch uses the newest 2,000 bars and
frames `ALL`. That view stays fitted when its cell resizes until user pan/zoom
or an explicit range/depth request takes ownership. Cold/restored initial views
and inline-data depth are preserved. The behavior is exercised by
[`e2e_timeframe_switch.py`](../../tests/e2e_timeframe_switch.py); patch safety and
unsupported upgrade behavior are covered by
[`vela-viewport-patch.test.mjs`](../../tests/vela-viewport-patch.test.mjs).

Before a future Vela upgrade, inspect the new renderer's public spacing controls
and remove this patch if upstream supports the requirement. Otherwise review
the new source and update both exact hashes after full viewport/interaction
regression. Never widen the version check or accept arbitrary content.
