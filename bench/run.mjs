#!/usr/bin/env node
/**
 * One-shot driver: bundle size, then Lighthouse, then summary.
 * Equivalent to `pnpm bench:bundle && pnpm bench:lighthouse && pnpm bench:summary`,
 * but keeps the orchestration in one place so CI can call a single script.
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

console.log('▶ bundle size');
run('pnpm bench:bundle');

console.log('▶ lighthouse');
run('pnpm bench:lighthouse');

console.log('▶ summary');
run('pnpm bench:summary');

console.log('\n✔ done — see bench/results/summary.md');
