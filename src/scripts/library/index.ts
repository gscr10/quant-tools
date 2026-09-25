// Library scripts retain the license declared in each source file.
import lib_ind_amd_poc_trade_setup from './ind_amd-poc-trade-setup.pine?raw';
import lib_ind_average_daily_range from './ind_average-daily-range.pine?raw';
import lib_ind_elder_safezone_stop from './ind_elder-safezone-stop.pine?raw';
import lib_ind_gator_oscillator from './ind_gator-oscillator.pine?raw';
import lib_ind_higher_timeframe_stochastic_buckets from './ind_higher-timeframe-stochastic-buckets.pine?raw';
import lib_ind_line_break from './ind_line-break.pine?raw';
import lib_ind_parabolic_phase from './ind_parabolic-phase.pine?raw';
import lib_ind_rsi_regime_filter from './ind_rsi-regime-filter.pine?raw';
import lib_ind_structure_trend_dashboard from './ind_structure-trend-dashboard.pine?raw';
import lib_ind_the_range_indicator from './ind_the-range-indicator.pine?raw';
import lib_ind_truncation from './ind_truncation.pine?raw';
import lib_ind_universal_signal_backtester from './ind_universal-signal-backtester.pine?raw';
import lib_ind_value_area_reversion_signals from './ind_value-area-reversion-signals.pine?raw';
import lib_ind_volatility_signature_plot from './ind_volatility-signature-plot.pine?raw';
import lib_ind_volumetric_order_flow_structure from './ind_volumetric-order-flow-structure.pine?raw';

export interface LibraryEntry {
  name: string;
  overlay: boolean;
  script: string;
}

export const LIBRARY: LibraryEntry[] = [
  { name: 'AMD POC Trade Setup', overlay: true, script: lib_ind_amd_poc_trade_setup },
  { name: 'Average Daily Range', overlay: true, script: lib_ind_average_daily_range },
  { name: 'Elder SafeZone Stop', overlay: true, script: lib_ind_elder_safezone_stop },
  { name: 'Gator Oscillator', overlay: false, script: lib_ind_gator_oscillator },
  { name: 'Higher Timeframe Stochastic Buckets', overlay: true, script: lib_ind_higher_timeframe_stochastic_buckets },
  { name: 'Line Break', overlay: true, script: lib_ind_line_break },
  { name: 'Parabolic Phase', overlay: true, script: lib_ind_parabolic_phase },
  { name: 'RSI Regime Filter', overlay: true, script: lib_ind_rsi_regime_filter },
  { name: 'Structure & Trend Dashboard', overlay: true, script: lib_ind_structure_trend_dashboard },
  { name: 'The Range Indicator', overlay: false, script: lib_ind_the_range_indicator },
  { name: 'Truncation', overlay: true, script: lib_ind_truncation },
  { name: 'Universal Signal Backtester', overlay: true, script: lib_ind_universal_signal_backtester },
  { name: 'Value Area Reversion Signals', overlay: true, script: lib_ind_value_area_reversion_signals },
  { name: 'Volatility Signature Plot', overlay: false, script: lib_ind_volatility_signature_plot },
  { name: 'Volumetric Order Flow Structure', overlay: true, script: lib_ind_volumetric_order_flow_structure },
];
