// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

export interface VelaPinetsBuildInfo {
    readonly schemaVersion: 1;
    readonly packageName: '@luxalgo/vela-pinets';
    readonly packageVersion: '0.2.13';
    readonly upstreamSha: string;
    readonly localPatchRevision: string;
    readonly bridgeSha: string;
    readonly embeddedPinetsSha: string;
    readonly embeddedPinetsFingerprint: string;
    readonly reportSchemaVersion: number;
    readonly sentinel: string;
    readonly buildFingerprint: string;
}

const upstreamSha = 'a2a2097be8f30b4b596b13212ed4608c36c2ea26';
const localPatchRevision = 'quant-tools-g8.1';
const reportSchemaVersion = 4;
const sentinel = 'vela-pinets-local-build-v1';

/**
 * This literal is deliberately owned by the bridge build. The Worker bundles
 * this value along with PineTS, so a stale `pinets` dist cannot make the test
 * suite report the source tree's newer identity. The root dependency contract
 * verifies it against `packages/pinets/fork-build-info.json` before release.
 */
export const EMBEDDED_PINE_TS_BUILD_INFO: PineTsBuildInfoLike = Object.freeze({
    schemaVersion: 1,
    packageName: 'pinets',
    packageVersion: '0.9.34',
    upstreamSha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
    localPatchRevision: 'quant-tools-g8.1',
    reportSchemaVersion: 4,
    sentinel: 'pinets-local-build-v1',
    buildFingerprint: 'pinets@0.9.34|upstream=beacd587e83aa7ee061023f8cea66b2e887d5676|patch=quant-tools-g8.1|schema=4',
});

/** Metadata for the bridge and the exact PineTS build bundled into it. */
export const VELA_PINETS_BUILD_INFO: VelaPinetsBuildInfo = Object.freeze({
    schemaVersion: 1,
    packageName: '@luxalgo/vela-pinets',
    packageVersion: '0.2.13',
    upstreamSha,
    localPatchRevision,
    bridgeSha: upstreamSha,
    embeddedPinetsSha: EMBEDDED_PINE_TS_BUILD_INFO.upstreamSha,
    embeddedPinetsFingerprint: EMBEDDED_PINE_TS_BUILD_INFO.buildFingerprint,
    reportSchemaVersion,
    sentinel,
    buildFingerprint: `@luxalgo/vela-pinets@0.2.13|upstream=${upstreamSha}|patch=${localPatchRevision}|pinets=${EMBEDDED_PINE_TS_BUILD_INFO.upstreamSha}|schema=${reportSchemaVersion}`,
});

export interface PineExecutionBuildInfo {
    readonly engine: PineTsBuildInfoLike;
    readonly bridge: VelaPinetsBuildInfo;
    readonly buildFingerprint: string;
    readonly sentinel: string;
}

/** The subset of PineTS metadata copied into a structured-clone-safe token. */
export interface PineTsBuildInfoLike {
    readonly schemaVersion: number;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly upstreamSha: string;
    readonly localPatchRevision: string;
    readonly reportSchemaVersion: number;
    readonly sentinel: string;
    readonly buildFingerprint: string;
}

export const PINE_EXECUTION_BUILD_INFO: PineExecutionBuildInfo = Object.freeze({
    engine: EMBEDDED_PINE_TS_BUILD_INFO,
    bridge: VELA_PINETS_BUILD_INFO,
    buildFingerprint: `${VELA_PINETS_BUILD_INFO.buildFingerprint}|engine=${EMBEDDED_PINE_TS_BUILD_INFO.buildFingerprint}`,
    sentinel: `${sentinel}|${EMBEDDED_PINE_TS_BUILD_INFO.sentinel}`,
});

export type PineExecutionKind = 'in-process' | 'worker';

export interface PineExecutionProvenance {
    readonly execution: PineExecutionKind;
    readonly engine: PineTsBuildInfoLike;
    readonly bridge: VelaPinetsBuildInfo;
    readonly buildFingerprint: string;
    readonly workerFingerprint?: string;
    readonly sentinel: string;
}

/** Provenance attached to a context snapshot without changing business values. */
export function executionProvenance(kind: PineExecutionKind): PineExecutionProvenance {
    return Object.freeze({
        execution: kind,
        engine: PINE_EXECUTION_BUILD_INFO.engine,
        bridge: PINE_EXECUTION_BUILD_INFO.bridge,
        buildFingerprint: PINE_EXECUTION_BUILD_INFO.buildFingerprint,
        ...(kind === 'worker'
            ? { workerFingerprint: `${PINE_EXECUTION_BUILD_INFO.buildFingerprint}|execution=worker` }
            : {}),
        sentinel: PINE_EXECUTION_BUILD_INFO.sentinel,
    });
}

/**
 * Validate a prepared token before it crosses an execution boundary. A missing
 * or stale token means an old Worker/dist was used; silently running it would
 * make reports impossible to reconcile with the checked-in fork sources.
 */
export function hasCurrentBuildSentinel(token: unknown): boolean {
    if (!token || typeof token !== 'object') return false;
    const build = (token as { build?: Partial<PineExecutionBuildInfo> }).build;
    return build?.sentinel === PINE_EXECUTION_BUILD_INFO.sentinel
        && build?.buildFingerprint === PINE_EXECUTION_BUILD_INFO.buildFingerprint
        && build?.engine?.upstreamSha === EMBEDDED_PINE_TS_BUILD_INFO.upstreamSha
        && build?.bridge?.embeddedPinetsSha === EMBEDDED_PINE_TS_BUILD_INFO.upstreamSha;
}
