// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Build provenance for the local PineTS fork.
 *
 * Keep this value in source (rather than deriving it from git at runtime): the
 * same bytes must be embedded in browser and Worker bundles and remain stable
 * in an offline/fresh checkout. The machine-readable companion JSON is checked
 * by the application dependency contract.
 */
export interface PineTsBuildInfo {
    readonly schemaVersion: 1;
    readonly packageName: 'pinets';
    readonly packageVersion: '0.9.34';
    readonly upstreamSha: string;
    readonly localPatchRevision: string;
    readonly reportSchemaVersion: number;
    readonly sentinel: string;
    readonly buildFingerprint: string;
}

const upstreamSha = 'beacd587e83aa7ee061023f8cea66b2e887d5676';
const localPatchRevision = 'quant-tools-g8.1';
const reportSchemaVersion = 4;
const sentinel = 'pinets-local-build-v1';

export const PINE_TS_BUILD_INFO: PineTsBuildInfo = Object.freeze({
    schemaVersion: 1,
    packageName: 'pinets',
    packageVersion: '0.9.34',
    upstreamSha,
    localPatchRevision,
    reportSchemaVersion,
    sentinel,
    buildFingerprint: `pinets@0.9.34|upstream=${upstreamSha}|patch=${localPatchRevision}|schema=${reportSchemaVersion}`,
});

/** Alias with the package's conventional spelling. */
export const PINETS_BUILD_INFO = PINE_TS_BUILD_INFO;
export const PINE_TS_BUILD_SENTINEL = sentinel;
