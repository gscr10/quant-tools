# PineTS test suites

The package has two deliberate test modes:

```sh
npm --workspace packages/pinets run test:offline
npm --workspace packages/pinets run test:network
```

`test:offline` is deterministic and does not make exchange requests. It is
the appropriate check for local development, CI without internet access, and
the startup regression gate. `test:network` is explicit opt-in coverage for
Binance-backed behavior and may fail when the exchange, DNS, proxy, or the
machine network is unavailable.

The existing `test` script is intentionally unchanged: it remains the full
upstream-style suite and therefore retains its original live-provider
semantics. No network test is silently rewritten to use an empty response.

The network config currently isolates files that contain a direct Binance
provider call or a mixture of live and deterministic cases. Some files are
conservatively classified as network-dependent because splitting individual
tests is a follow-up task. `marketData/binance-network.test.ts` is not in that
list: its fetch calls are mocked and it is safe for the offline suite.

Future fixture work should split mixed files into deterministic tests backed by
checked-in OHLCV fixtures and a small, separately named live contract test.
Fixtures must preserve the response shape and timestamps; an empty fallback is
not an acceptable fixture substitute.
