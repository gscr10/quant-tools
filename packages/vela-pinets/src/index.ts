// The PineTS engine addon for Vela: Pine Script execution through Vela's public
// `ScriptingEngine` port — in-process (`PineEngine`) or off the main thread
// (`PineWorkerEngine`, its worker source inlined at build time). A host registers
// one per chart: `chart.registerEngine('pine', new PineEngine())`, or the widget's
// `engines: { pine: () => new PineWorkerEngine() }`.
export { PineEngine } from './pinets/PineEngine';
export { batchPineSettings } from './pinets/settingsBatch';
export type { PineEngineOptions } from './pinets/PineEngine';
export type {
    PropsVisibility,
    PropsFilter,
    PineBarMagnifierOptions,
    PineExecutionRequest,
    LowerTimeframeFetchCacheOptions,
} from './pinets/runtime';
export { LowerTimeframeFetchCache } from './pinets/runtime';
/** Canonical TradingView Bar Magnifier parent→child mapping used by both engines. */
export { barMagnifierTimeframe } from './pinets/runtime';
export {
    AUDIT_LEDGER_CONTEXT_KEY,
    AUDIT_LEDGER_SCHEMA_VERSION,
    REPORT_SERIES_CONTEXT_KEY,
    REPORT_TAIL_CONTEXT_KEY,
    pineContextSelect,
} from './pinets/reportSeries';
export type {
    StrategyAuditCategory,
    StrategyAuditFillEvent,
    StrategyAuditLedgerSnapshot,
    StrategyAuditOrderEvent,
    StrategyAuditOrderKind,
    StrategyAuditOrderType,
    PineReportContextKey,
    PineReportIdentity,
    StrategyReportPoint,
    StrategyReportSeriesSnapshot,
} from './pinets/reportSeries';
export {
    validateAuditLedgerSnapshot,
} from './pinets/contextSnapshot';
export type { PineContextSnapshot } from './pinets/contextSnapshot';
export type { StrategyReportState } from './pinets/strategyState';
export { PineWorkerEngine } from './pinets-worker/PineWorkerEngine';
export type { PineWorkerOptions } from './pinets-worker/PineWorkerEngine';
export {
    PINE_EXECUTION_BUILD_INFO,
    EMBEDDED_PINE_TS_BUILD_INFO,
    VELA_PINETS_BUILD_INFO,
    executionProvenance,
    hasCurrentBuildSentinel,
} from './build-info';
export type {
    PineExecutionBuildInfo,
    PineExecutionKind,
    PineExecutionProvenance,
    PineTsBuildInfoLike,
    VelaPinetsBuildInfo,
} from './build-info';
