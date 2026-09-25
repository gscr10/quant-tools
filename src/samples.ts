export interface Sample {
  name: string;
  script: string;
}

export const BASIC_SAMPLES: Sample[] = [
  {
    name: 'EMA 20 + Bands (overlay)',
    script: `//@version=6
indicator("EMA 20 + Bands", overlay=true)

len = input.int(20, "Length")
basis = ta.ema(close, len)
dev = ta.stdev(close, len) * 2

plot(basis, "EMA", color.orange)
plot(basis + dev, "Upper", color.teal)
plot(basis - dev, "Lower", color.teal)
`,
  },
  {
    name: 'MACD (separate pane)',
    script: `//@version=6
indicator("MACD", overlay=false)

[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)

plot(macdLine, "MACD", color.blue)
plot(signalLine, "Signal", color.orange)
plot(hist, "Histogram", color.gray, style=plot.style_histogram)
`,
  },
  {
    name: 'SMA Cross (strategy)',
    script: `//@version=6
strategy("SMA Cross", overlay=true)

fastLen = input.int(9, "Fast Length")
slowLen = input.int(21, "Slow Length")
fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)

plot(fast, "Fast", color.aqua)
plot(slow, "Slow", color.fuchsia)
`,
  },
  {
    name: 'Broken script (error demo)',
    script: `//@version=6
indicator("Broken on purpose", overlay=true)

plot(ta.ema(close, undefinedLength), "EMA", color.orange)
`,
  },
];
