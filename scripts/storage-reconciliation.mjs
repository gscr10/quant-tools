#!/usr/bin/env node

/**
 * Schema-aware, privacy-preserving comparison for browser storage snapshots.
 *
 * A Vela workspace and the small repositories in this project persist JSON
 * documents.  Some repository fields (`savedAt`) and runtime envelopes can
 * legitimately change while a release slot is being mounted, so comparing
 * raw localStorage bytes produces false rollback failures.  This helper keeps
 * the original byte counts/hashes for auditability and adds a canonical hash
 * that removes only documented runtime timestamps/revisions.
 *
 * Input format is the object emitted by `browser_storage_snapshot()`:
 * `{ local: {key: string}, session: {key: string} }`.  The CLI accepts either
 * JSON files or `-` for stdin and never prints stored values/scripts.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

export const STORAGE_KEYS = Object.freeze({
  workspace: 'quant-tools:workspace:v2',
  scripts: 'vela-pine:scripts:v1',
  favorites: 'vela-pine:indicator-favorites:v1',
  templates: 'vela-pine:workspace-templates:v1',
  editor: 'vela-pine:editor:v1',
  layout: 'vela-pine:layout:v1',
  backtestDock: 'quant-tools:backtest-dock:v1',
});

const VOLATILE_KEYS = new Set([
  'savedAt',
  'revision',
  'snapshotRevision',
  'runtimeRevision',
  'runId',
  'generatedAt',
  'updatedAt',
  'lastUpdated',
  'persistedAt',
  // Vela's currently open panel is a runtime UI envelope. It is restored from
  // the active application layout and may be omitted during a cold reload.
  'panels',
]);

const STORAGE_SCHEMA = new Map([
  [STORAGE_KEYS.workspace, 'workspace'],
  [STORAGE_KEYS.scripts, 'scripts'],
  [STORAGE_KEYS.favorites, 'favorites'],
  [STORAGE_KEYS.templates, 'templates'],
  [STORAGE_KEYS.editor, 'editor'],
  [STORAGE_KEYS.layout, 'layout'],
  [STORAGE_KEYS.backtestDock, 'backtestDock'],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function stable(value, state, key = undefined, schema = 'unknown', depth = 0) {
  // `savedAt` belongs to the repository envelope (array item), not arbitrary
  // user payloads such as a template's nested Workspace state.  Runtime
  // revision fields are only stripped from the Vela workspace document.  This
  // narrow scope prevents the reconciliation tool from masking a real user
  // change merely because it happens to use a similarly named property.
  const repositoryTimestamp = depth === 2
    && ['scripts', 'favorites', 'templates'].includes(schema)
    && key === 'savedAt';
  const workspaceRuntime = schema === 'workspace'
    && depth === 1
    && key !== undefined
    && VOLATILE_KEYS.has(key);
  if (repositoryTimestamp || workspaceRuntime) {
    state.removed += 1;
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stable(item, state, undefined, schema, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const childKey of Object.keys(value).sort()) {
      const child = stable(value[childKey], state, childKey, schema, depth + 1);
      if (child !== undefined) out[childKey] = child;
    }
    return out;
  }
  return value;
}

function parseValue(raw) {
  if (typeof raw !== 'string') return { parsed: false, value: raw };
  try {
    return { parsed: true, value: JSON.parse(raw) };
  } catch {
    return { parsed: false, value: raw };
  }
}

/**
 * Canonicalize one key/value without exposing its contents.  `rawSha256` is
 * always the exact UTF-8 storage value; `canonicalSha256` is semantic JSON
 * identity when the value is valid JSON, otherwise it equals the raw digest.
 */
export function canonicalStorageEntry(key, raw) {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const parsed = parseValue(text);
  const state = { removed: 0 };
  const schema = STORAGE_SCHEMA.get(key) ?? 'unknown';
  const canonicalValue = parsed.parsed ? stable(parsed.value, state, undefined, schema, 0) : text;
  const canonical = parsed.parsed ? JSON.stringify(canonicalValue) : text;
  return Object.freeze({
    schema,
    present: true,
    rawBytes: byteLength(text),
    rawSha256: sha256(text),
    canonicalBytes: byteLength(canonical),
    canonicalSha256: sha256(canonical),
    parsedJson: parsed.parsed,
    volatileFieldsRemoved: state.removed,
  });
}

function storageObject(snapshot, storage) {
  const value = snapshot?.[storage];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Validate the browser snapshot envelope before comparing its contents.
 *
 * `storageObject()` intentionally treats malformed input as empty so the
 * canonicalizer can remain total, but that fallback is unsafe at the
 * reconciliation boundary: a missing/invalid storage bucket could otherwise
 * make two incomplete snapshots compare equal.  Keep the diagnostics value
 * free; the caller only needs to know which side/bucket is malformed.
 */
function snapshotIssues(snapshot, side) {
  const issues = [];
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return [{ side, reason: 'invalid-snapshot' }];
  }
  for (const storage of ['local', 'session']) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, storage)) {
      issues.push({ side, storage, reason: 'missing-storage' });
      continue;
    }
    const values = snapshot[storage];
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      issues.push({ side, storage, reason: 'invalid-storage' });
      continue;
    }
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') {
        issues.push({
          side,
          storage,
          key,
          reason: 'invalid-value',
          valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
        });
      }
    }
  }
  return issues;
}

/** Return key-sorted, value-free summaries for a browser snapshot. */
export function summarizeStorageSnapshot(snapshot) {
  const summary = {};
  for (const storage of ['local', 'session']) {
    const values = storageObject(snapshot, storage);
    summary[storage] = {};
    for (const key of Object.keys(values).sort()) {
      summary[storage][key] = canonicalStorageEntry(key, values[key]);
    }
  }
  return summary;
}

function allKeys(summary) {
  const keys = [];
  for (const storage of ['local', 'session']) {
    for (const key of Object.keys(summary[storage] ?? {})) keys.push(`${storage}:${key}`);
  }
  return keys.sort();
}

/**
 * Compare snapshots by canonical (schema-aware) identity.  The report contains
 * only hashes, byte counts and key names, never scripts or workspace values.
 */
export function reconcileStorageSnapshots(before, after) {
  const left = summarizeStorageSnapshot(before);
  const right = summarizeStorageSnapshot(after);
  const keys = [...new Set([...allKeys(left), ...allKeys(right)])].sort();
  const changed = [];
  const issues = [
    ...snapshotIssues(before, 'before'),
    ...snapshotIssues(after, 'after'),
  ];
  for (const [label, summary] of [['before', left], ['after', right]]) {
    for (const storage of ['local', 'session']) {
      for (const [key, entry] of Object.entries(summary[storage] ?? {})) {
        if (entry.schema === 'unknown') issues.push({ side: label, storage, key, reason: 'unknown-key' });
        if (!entry.parsedJson) issues.push({ side: label, storage, key, reason: 'invalid-json' });
      }
    }
  }
  for (const qualified of keys) {
    const split = qualified.indexOf(':');
    const storage = qualified.slice(0, split);
    const key = qualified.slice(split + 1);
    const a = left[storage]?.[key] ?? null;
    const b = right[storage]?.[key] ?? null;
    if (!a || !b || a.canonicalSha256 !== b.canonicalSha256) {
      changed.push({
        storage,
        key,
        before: a ? { canonicalSha256: a.canonicalSha256, rawSha256: a.rawSha256, rawBytes: a.rawBytes } : null,
        after: b ? { canonicalSha256: b.canonicalSha256, rawSha256: b.rawSha256, rawBytes: b.rawBytes } : null,
      });
    }
  }
  const volatileFieldsRemoved = [left, right]
    .flatMap((snapshot) => Object.values(snapshot).flatMap((entries) => Object.values(entries)))
    .reduce((sum, entry) => sum + Number(entry.volatileFieldsRemoved || 0), 0);
  return {
    schemaVersion: 1,
    equal: changed.length === 0 && issues.length === 0,
    comparedKeys: keys,
    changed,
    issues,
    volatileFieldsRemoved,
    before: left,
    after: right,
  };
}

async function readJson(path) {
  const raw = path === '-' ? await new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { text += chunk; });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  }) : await readFile(path, 'utf8');
  return JSON.parse(raw);
}

function option(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const beforePath = option('--before');
  const afterPath = option('--after');
  if (!beforePath || !afterPath) {
    throw new Error('usage: node scripts/storage-reconciliation.mjs --before <snapshot.json> --after <snapshot.json>');
  }
  const report = reconcileStorageSnapshots(await readJson(beforePath), await readJson(afterPath));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.equal) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('storage-reconciliation.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
