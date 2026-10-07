#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || process.argv[index + 1] === undefined) return fallback;
  return process.argv[index + 1];
}

const url = option('--url', 'http://127.0.0.1:5173/');
const timeoutMs = Math.max(1, Number(option('--timeout-ms', '90000')) || 90000);
const intervalMs = Math.max(1, Number(option('--interval-ms', '250')) || 250);
const expectedStatus = Math.floor(Number(option('--status', '200')) || 200);
const deadline = Date.now() + timeoutMs;
let lastFailure = 'no response';
let lastObservedStatus = null;

while (Date.now() < deadline) {
  const controller = new AbortController();
  const requestTimeout = setTimeout(() => controller.abort(), Math.min(2_000, Math.max(1, deadline - Date.now())));
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    lastObservedStatus = response.status;
    if (response.status === expectedStatus) {
      process.stdout.write(JSON.stringify({ ok: true, url, status: response.status }) + '\n');
      process.exit(0);
    }
    lastFailure = `HTTP ${response.status}`;
  } catch (error) {
    lastFailure = error?.name === 'AbortError' ? 'request timeout' : String(error?.message ?? error);
  } finally {
    clearTimeout(requestTimeout);
  }
  await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
}

// A final attempt may exhaust the remaining deadline after earlier attempts
// reached the server. Preserve both facts: a request timeout does not erase
// the last HTTP response, and that response must not conceal the timeout.
const lastResponse = lastObservedStatus === null ? 'none' : `HTTP ${lastObservedStatus}`;
process.stderr.write(`Timed out waiting for ${url} (expected HTTP ${expectedStatus}; last observed response: ${lastResponse}; last failure: ${lastFailure})\n`);
process.exit(1);
