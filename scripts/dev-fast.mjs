#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';

const forwarded = process.argv.slice(2);
const checkOnly = forwarded.includes('--check-only');
const viteArgs = forwarded.filter(argument => argument !== '--check-only');

const verification = spawnSync(process.execPath, ['scripts/ensure-fork-build.mjs', '--check-only'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (verification.error) {
  process.stderr.write(`${verification.error.message}\n`);
  process.exit(1);
}
if (verification.status !== 0) process.exit(verification.status ?? 1);
if (checkOnly) process.exit(0);

const command = process.platform === 'win32' ? 'vite.cmd' : 'vite';
const child = spawn(command, viteArgs, { cwd: process.cwd(), stdio: 'inherit' });
const forwardSignal = signal => child.kill(signal);
process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));
child.once('error', error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
