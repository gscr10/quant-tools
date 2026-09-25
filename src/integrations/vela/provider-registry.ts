import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';

export function createWorkspaceProviders() {
  return {
    binance: () => new BinanceProvider(),
    hyperliquid: () => new HyperliquidProvider(),
  };
}
