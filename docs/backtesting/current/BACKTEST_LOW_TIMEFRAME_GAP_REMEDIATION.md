# Low timeframe history continuity remediation

Status (2026-10-07): **PASS for the explicitly scoped P1 contract** under
[DATA-11](BACKTEST_REQUIREMENTS_STATUS.md). Real Vela browser runs with
controlled data now cover ordinary timeframe switches, gap errors, Retry and
both engines' ledger readiness. Narrow viewports, venue-specific monthly
history and high-precision recovery have fresh evidence. Actual pointer/
wheel boundary-triggered pagination and Retry also pass dedicated browser
checks. The current production E2E and complete local non-regression gate
cover their recorded gesture, histogram and runtime changes. Representative
network recovery now also passes: both real engines retained a stable ledger
through a 45-second CONNECT transport blackhole and resumed on fresh live
candles in about 2.57 seconds. This supplements the separate two-hour Binance
and Hyperliquid runs. It does not certify every network or all ENGINE-03
combinations; later changes must preserve this contract. Full application
longevity and reference UI parity remain separate. The real-exchange probe verifies painted
charts before destroying the workspace.

## Why this is a real issue

Vela 0.7.7 converts a rejected ranged provider request to an empty array. Its
`CachingDataFeed` then advances the history cursor by one 10,000-bar page and
can mark the requested range as covered. At 1m this can hide roughly seven days
of candles after one transient request failure. A provider page can also be
valid JSON while missing candles in the middle, leaving a smaller visible gap.

Both cases can change indicator values and strategy fills, so this is a data
integrity issue rather than a chart-only rendering issue.

## Application boundary changes

- `provider-history.ts` retries each history request three times with a small
  bounded backoff. A failed request does not become a successful empty page.
- `history-continuity.ts` checks Binance/Hyperliquid continuous market routes at
  minute, hour, day, week and venue-specific month intervals. Registered
  Binance/Hyperliquid routes include 2h/4h and calendar/native month repair;
  the generic custom/session helper keeps its separate calendar contract.
  Binance uses UTC
  calendar months; Hyperliquid's native `1M` is epoch-aligned fixed 30-day bins,
  as confirmed by actual public responses. The guarded provider carries this
  calendar identity through page repair and shared-cache validation. Missing
  ranges are fetched and merged by open time, with at most eight repair ranges
  per check and 1,000 missing bars per range. Binance February/year boundaries
  use calendar arithmetic; Hyperliquid keeps its native bin spacing. Oversized/unfilled gaps
  raise `HistoryGapError`; repair transport failures retain their identity.
  Neither path silently certifies sparse data or creates candles. The rules
  inspect internal gaps only, without inventing prelisting history. Custom
  session providers retain their separate calendar contract.
- `provider-progressive.ts` also checks the join between otherwise valid
  pages before publishing combined history. A failure leaves the confirmed
  recent prefix and an explicit error. Repaired results respect the original
  request limit.
- `history-resilience.ts` patches the Vela 0.7.7 cache feed at the application
  boundary. A failed large-history page is retried at the same cursor. If it
  remains unavailable, the guarded provider's final rejection escapes before
  the requested range can be merged or marked covered. The patch uses the
  registry's guarded provider directly to bypass `safeBars`' error-to-empty
  conversion. Confirmed empty history remains a distinct listing boundary.
  A non-progressing page retries at the same cursor and ultimately rejects.
  A count-satisfied tail never claims an earlier requested `from` as covered.
  Confirmed empty windows use a request-scoped boundary sentinel rather than a
  feed/key marker, so an overlapping empty load cannot clear or replace a
  successful load for the same series.
- Cache reads and writes also validate continuous series. Old discontinuous
  cached islands are invalidated only for the affected series, including its
  coverage watermark; unrelated symbols/timeframes/cells remain cached. Tests
  prove actual network-loader re-entry and subsequent healthy cache hits.
- The history patch is installed before a workspace creates its market feeds
  without rewriting installed files. It overrides the internal
  `CachingDataFeed.fetchRange`, wraps `load/loadRange/loadProgressive`, and
  relies on registry and BarStore internals. A Vela upgrade requires cache-key,
  failure-propagation, invalidation and coverage contract checks; this is not a
  public-API-only integration. Separately, the viewport compatibility patch
  below DOES modify the pinned installed Vela ESM artifact during build.
- This guarantee applies to the guarded Binance/Hyperliquid providers created
  by the application. An external host that registers an unguarded custom
  provider still owns its transport-error and session-calendar contract;
  DATA-11 does not certify that extension path or infer continuous trading
  from an empty response.
- Hyperliquid monthly count requests are clamped to epoch zero when their
  calculated start would be negative, preventing the exchange's HTTP 422
  response for a 2,000-bar default window.

## Unified timeframe-switch loading policy

The missing-bar fix is paired with an application-level loading rule so a
period switch does not amplify the failure surface:

- every ordinary symbol/timeframe/session switch requests the newest
  `WORKSPACE_HISTORY_BARS` (currently 2,000) bars and frames `ALL` over that
  newly loaded window;
- the rule applies uniformly to `1m`, `5m`, intraday, daily, weekly and monthly
  periods, including multi-cell sync and direct public `chart.setMarket` calls;
- an explicit range preset or a depth-only request remains a deliberate request
  for more history and may paginate;
- a user-selected larger fetch depth remains a persisted preference for a later
  cold start, but an ordinary period switch still begins at the safe 2,000-bar
  window;
- inline/offline data is preserved verbatim; the policy never truncates a host
  supplied fixture;
- no candle is synthesized. Unresolved parent-history gaps expose a recoverable
  error and cannot publish ready, `history.complete=true` or Simulation. Both
  real engines now have direct browser evidence for this contract, including
  a visible Try again click followed by full ledger recovery. Child-data-only
  high-precision gaps have separate fallback/recovery evidence; fallback must
  never disguise missing parent candles.

The [Vela viewport compatibility patch](../../forks/vela-viewport.md) lowers
the absolute candle-spacing floor for exactly Vela 0.7.7, guarded by complete
input/output SHA-256 and the fork-build lock/fingerprint. This lets narrow cells
frame all 2,000 bars while preserving the native data-dependent zoom bound.
User navigation is retained on later resize; merely fitting loaded data does
not request deeper history. A dependency upgrade must revalidate this patch.

The 2,000 count is a default target, not proof that a venue has that much
history. Short listing history and genuine calendar gaps must remain explicit;
they must not trigger infinite fetching or invented candles.

This separates default depth from the viewport's previous time span. Thus
`1h → 1m` and every other period switch begin with 2,000 newest bars, while a
user’s subsequent pan/zoom/deep-history action remains able to load older pages.

## Deliberate gesture pagination

`history-gesture-policy.ts` connects native older-history pointer dragging,
horizontal wheel input and zoom-out bursts to the public depth-only request.
Each burst adds at most 2,000 candles, with debounce, one pending request and
generation/destruction guards. Completion does not recursively request more
history. ALL fitting, resize, linked viewport changes, drawing placement and
price-axis input do not independently request pages. Genesis and failed history
stop further gesture fetching; an actual Viewer Retry can recover the failed
window before pagination resumes.

`online-history-reload.ts` marks only the application's explicit online Retry,
scoped to its chart. A plain caller-supplied `data:[]` stays an inline/offline
exception; empty array shape is not evidence of online intent.

The full retry-then-paginate sequence also exposed an unrelated failure in
`createTradeAnalysisHistogram`: nearly equal floating-point P&Ls could produce
an enormous zero-anchored bucket allocation and leave the report in computing.
Allocation is now bounded to 256 bins; ordinary reference bucket boundaries
remain covered by tests. This change is included in the current production
E2E and local final-gate runs. The selected Provider long-run and transport
fault checks are now recorded under REL-01; full application longevity still
belongs to REL-06 and is not implied by this data-integrity closure.

## Verification covered locally

The latest calendar/cache/provider targeted run passed **78/78**. This is a
different selection from the earlier same-count history/readiness/switch run:

```bash
node --test \
  tests/history-continuity.test.mjs \
  tests/history-cache-recovery.test.mjs \
  tests/provider-progressive.test.mjs \
  src/integrations/vela/provider-history.test.mjs \
  src/integrations/vela/history-resilience.test.mjs \
  tests/timeframe-switch-policy.test.mjs
```

The same run includes the overlapping empty/successful `loadRange` regression:
the empty request returns no bars and remains retryable, while the concurrent
successful request retains the complete 2,000-bar window.

Fresh real-component browser tests (controlled provider data):

- `python3 tests/e2e_timeframe_switch.py`: Chromium **51/51**, Firefox **50/50**;
  actual menu, keyboard and mobile entries, both directions, overlapping
  requests, four cells, 12,500-bar extension, 6,000-bar preference restoration,
  old-default migration and finite listing history. Narrow 655 px / 326 px
  plots and 320/480/390 resize show 2,000 loaded AND visible. Wheel/pan/date
  focus work; Chromium also verifies native pinch. Zero page errors. These
  gestures alone do not prove deep-history fetching beyond the left boundary;
  the dedicated test below now covers that separate requirement.
- `python3 tests/e2e_history_gestures.py`: Chromium **26/26** and Firefox
  **26/26**, each across both real engines. Trusted pointer/wheel input extends
  the actual bars from 2,000 to 4,000. A persistent gap, visible Viewer Retry and
  another gesture recover to 6,000; a normal timeframe switch returns to 2,000.
  Held bursts, late requests, rapid switching, genesis, multiple cells,
  destruction, drawing and price-axis isolation pass. Provider requests, OHLC,
  continuity, history identity and report readiness are checked, with zero page
  errors, unexpected external requests or snapshot-mapping diagnostics. Policy,
  adapter, controller and histogram regressions pass **104/104**. These runs use
  controlled exchange data and are not physical-device or production evidence.
- `python3 tests/e2e_history_continuity.py`: **6/6**, two real engines times
  prefix/older/junction failures. Actual Viewer Retry restores 2,000 bars and
  20 trades; damaged data never exposes ready/Simulation or complete history.

- `python3 tests/e2e_precision_continuity.py`: **12/12**, two real engines
  across repaired/persistent/HTTP 503/empty/short-tail child feeds and parent
  gaps. The independent four-trade expectation is +20 on default OHLC and -20
  with complete children. Incomplete-child cache recovery was fixed: a failed
  precision validation invalidates only the exact request it consumed, so a
  late run cannot remove a newer successful window. Settings toggles and
  parent-history Try again now recover immediately. The current Vela-PineTS
  suite is **310/310**; 305/305 is the earlier precision-only batch.

Cold/restored views initially show roughly 201 bars; this remains separate
from ordinary-switch ALL framing and is not a new mandate to overwrite saved
viewports. Full-window framing does not mean every candle is distinguishable
when multiple candles occupy a physical pixel.

Current real public API checks (`tests/e2e_history_real.py`, explicit browser
proxy, no OHLC interception) cover 16 windows: 15 continuous data results and
one correct rejection of an actual Hyperliquid historical monthly gap. The
2021-07-02 missing bin was independently requested and returned HTTP 200 `[]`.
Recent 24 monthly bins are continuous. Binance returned 478 weekly / 111 monthly
rows and Hyperliquid 371 weekly rows; the 2,000 target never invents older data.
The corrected probe keeps the workspace alive through all assertions and
screenshots. Binance 1m/5m/2h each have 2,000 raw AND visible bars; its monthly
chart has all 111 available bars. OHLC, monotonicity, continuity, visible range
and Canvas paint pass for all four charts. Thirty-five public responses are
HTTP 200; page errors and request failures are zero, and destruction leaves
zero canvases. Evidence is in `2026-10-07-history-real-rendered/`; the earlier
post-destruction images are not used as rendering evidence.

The earlier root 577/578 run exposed an HTTP readiness diagnostic race. It was
fixed by retaining HTTP status separately from transport timeout; focused
tests passed **4/4**, followed by the then-current **600/600** root suite.
The current root suite is **616/616**, and the main development/production
E2E, TypeScript and build results are recorded with their scope in BUILD-01.
Later changes still require the affected non-regression checks.

The previous Chromium run through the configured local proxy loaded Binance Spot
`binance:BTCUSDT` at 1m and 5m over two pages each (2,000 rows per timeframe):
both sequences had zero time-step gaps and no page errors. A controlled 503 on
the 1m middle page was followed by a request with the identical `endTime`, and
the chart still completed. This check is kept separate from Hyperliquid, which
is used for provider/live validation and is not a substitute for the Binance
Spot canonical source. It predates the new cache and strict continuity changes
and cannot stand in for current-patch online verification.

Latest evidence stays in ignored `audit-evidence/` directories
`2026-10-07-timeframe-switch-full-viewport/`, `2026-10-07-history-continuity/`,
`2026-10-07-precision-continuity/`, `2026-10-07-history-real-calendar/` and
`2026-10-07-history-real-rendered/`; the latest native navigation evidence is
in `2026-10-07-history-gestures/`. Reproducible tests remain in `tests/`.
The scoped network recovery, local production two-hour resource run and
finite matching contract have since passed under REL-01/06 and ENGINE-03.
Full reference UI comparison, the remaining runtime-performance cases under
PERF-01 and real assistive-device checks remain open. These separate tasks do
not reopen the accepted DATA-11 contract. The local production and
non-regression gates for the gesture/histogram changes are shared with those
requirements rather than duplicated or silently broadened.
