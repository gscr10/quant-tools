---
layout: default
title: Technical Analysis
parent: API Coverage
---

## Technical Analysis

### Moving Averages

| Function      | Status | Description                              |
| ------------- | ------ | ---------------------------------------- |
| `ta.vwap`     | ✅     | Volume Weighted Average Price (variable) |
| `ta.alma()`   | ✅     | Arnaud Legoux Moving Average             |
| `ta.ema()`    | ✅     | Exponential Moving Average               |
| `ta.hma()`    | ✅     | Hull Moving Average                      |
| `ta.linreg()` | ✅     | Linear Regression                        |
| `ta.rma()`    | ✅     | Rolling/Running Moving Average           |
| `ta.sma()`    | ✅     | Simple Moving Average                    |
| `ta.swma()`   | ✅     | Symmetrically Weighted Moving Average    |
| `ta.vwap()`   | ✅     | Volume Weighted Average Price (function) |
| `ta.vwma()`   | ✅     | Volume Weighted Moving Average           |
| `ta.wma()`    | ✅     | Weighted Moving Average                  |

### Oscillators & Momentum

| Function      | Status | Description                           |
| ------------- | ------ | ------------------------------------- |
| `ta.cci()`    | ✅     | Commodity Channel Index               |
| `ta.change()` | ✅     | Price Change                          |
| `ta.cmo()`    | ✅     | Chande Momentum Oscillator            |
| `ta.cog()`    | ✅     | Center of Gravity                     |
| `ta.macd()`   | ✅     | Moving Average Convergence Divergence |
| `ta.mfi()`    | ✅     | Money Flow Index                      |
| `ta.mom()`    | ✅     | Momentum                              |
| `ta.roc()`    | ✅     | Rate of Change                        |
| `ta.rsi()`    | ✅     | Relative Strength Index               |
| `ta.stoch()`  | ✅     | Stochastic Oscillator                 |
| `ta.tsi()`    | ✅     | True Strength Index                   |
| `ta.wpr()`    | ✅     | Williams %R                           |

### Volatility & Range

| Function        | Status | Description             |
| --------------- | ------ | ----------------------- |
| `ta.tr`         | ✅     | True Range (variable)   |
| `ta.atr()`      | ✅     | Average True Range      |
| `ta.bb()`       | ✅     | Bollinger Bands         |
| `ta.bbw()`      | ✅     | Bollinger Bands Width   |
| `ta.dev()`      | ✅     | Mean Absolute Deviation |
| `ta.kc()`       | ✅     | Keltner Channels        |
| `ta.kcw()`      | ✅     | Keltner Channels Width  |
| `ta.range()`    | ✅     | Range                   |
| `ta.stdev()`    | ✅     | Standard Deviation      |
| `ta.tr()`       | ✅     | True Range (function)   |
| `ta.variance()` | ✅     | Variance                |

### Volume Indicators

| Function     | Status | Description                                            |
| ------------ | ------ | ------------------------------------------------------ |
| `ta.accdist` | ✅     | Accumulation/Distribution (variable)                   |
| `ta.iii`     | ✅     | Intraday Intensity Index (variable)                    |
| `ta.nvi`     | ✅     | Negative Volume Index (variable)                       |
| `ta.obv`     | ✅     | On-Balance Volume (variable)                           |
| `ta.pvi`     | ✅     | Positive Volume Index (variable)                       |
| `ta.pvt`     | ✅     | Price-Volume Trend (variable)                          |
| `ta.wad`     | ✅     | Williams Accumulation/Distribution (variable)          |
| `ta.wvad`    | ✅     | Williams Variable Accumulation/Distribution (variable) |

### Utility Functions

| Function         | Status | Description              |
| ---------------- | ------ | ------------------------ |
| `ta.barssince()` | ✅     | Bars Since Condition     |
| `ta.cum()`       | ✅     | Cumulative Sum           |
| `ta.rci()`       | ✅     | Rank Correlation Index   |
| `ta.valuewhen()` | ✅     | Value When Condition Met |

### Statistical Functions

| Function                               | Status | Description               |
| -------------------------------------- | ------ | ------------------------- |
| `ta.correlation()`                     | ✅     | Correlation Coefficient   |
| `ta.highest()`                         | ✅     | Highest Value             |
| `ta.highestbars()`                     | ✅     | Bars Since Highest        |
| `ta.lowest()`                          | ✅     | Lowest Value              |
| `ta.lowestbars()`                      | ✅     | Bars Since Lowest         |
| `ta.max()`                             | ✅     | Maximum Value             |
| `ta.median()`                          | ✅     | Median Value              |
| `ta.min()`                             | ✅     | Minimum Value             |
| `ta.mode()`                            | ✅     | Mode Value                |
| `ta.percentile_linear_interpolation()` | ✅     | Percentile (Linear)       |
| `ta.percentile_nearest_rank()`         | ✅     | Percentile (Nearest Rank) |
| `ta.percentrank()`                     | ✅     | Percentile Rank           |

### Trend Analysis

| Function          | Status | Description                        |
| ----------------- | ------ | ---------------------------------- |
| `ta.cross()`      | ✅     | Cross Detection (either direction) |
| `ta.crossover()`  | ✅     | Crossover Detection                |
| `ta.crossunder()` | ✅     | Crossunder Detection               |
| `ta.dmi()`        | ✅     | Directional Movement Index         |
| `ta.falling()`    | ✅     | Falling Trend Detection            |
| `ta.rising()`     | ✅     | Rising Trend Detection             |
| `ta.sar()`        | ✅     | Parabolic SAR                      |
| `ta.supertrend()` | ✅     | SuperTrend Indicator               |

### Support & Resistance

| Function                  | Status | Description          |
| ------------------------- | ------ | -------------------- |
| `ta.pivot_point_levels()` | ✅     | Pivot Point Levels   |
| `ta.pivothigh()`          | ✅     | Pivot High Detection |
| `ta.pivotlow()`           | ✅     | Pivot Low Detection  |
