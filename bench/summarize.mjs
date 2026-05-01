#!/usr/bin/env node
/**
 * Roll bench/results/* into a single bench/results/summary.md table.
 *
 * Reads:
 *   - bench/results/bundle-size.json      (from bench:bundle)
 *   - bench/results/lighthouse/manifest.json + report JSONs (from bench:lighthouse)
 *
 * For Lighthouse we use LHCI's own "representative run" — it's the median
 * of numberOfRuns by performance score, which smooths out single-run noise.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const resultsDir = join(root, 'bench/results');
const lhDir = join(resultsDir, 'lighthouse');

const lines = [];
const kb = (b) => (b / 1024).toFixed(1) + ' KB';

lines.push('# Bench results');
lines.push('');
lines.push(`Captured: ${new Date().toISOString()}`);
lines.push('');

const bundlePath = join(resultsDir, 'bundle-size.json');
if (existsSync(bundlePath)) {
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  lines.push('## Bundle size (library, `dist/`)');
  lines.push('');
  lines.push(`Commit: \`${bundle.shortSha}\``);
  lines.push('');
  lines.push('| Total raw | Total gzip | Files |');
  lines.push('|---|---|---|');
  lines.push(
    `| ${kb(bundle.total.raw)} | ${kb(bundle.total.gzip)} | ${bundle.files.length} |`
  );
  lines.push('');
}

const manifestPath = join(lhDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // LHCI marks one run per URL as `isRepresentativeRun: true` (the median).
  const representatives = manifest.filter((r) => r.isRepresentativeRun);

  // Hydrate each representative report once and cache; we read it twice
  // (Lighthouse metrics + custom timings).
  const rows = representatives.map((run) => {
    const report = JSON.parse(readFileSync(run.jsonPath, 'utf8'));
    const url = new URL(run.url);
    return {
      scenario: url.search.replace(/^\?/, '') || url.pathname,
      report,
    };
  });

  lines.push('## Lighthouse (median of N runs)');
  lines.push('');
  lines.push('| Scenario | Perf | LCP | TBT | CLS | Speed Index |');
  lines.push('|---|---|---|---|---|---|');
  for (const { scenario, report } of rows) {
    const a = report.audits;
    const score = (report.categories.performance.score * 100).toFixed(0);
    lines.push(
      `| \`${scenario}\` | ${score} | ${a['largest-contentful-paint'].displayValue} | ` +
        `${a['total-blocking-time'].displayValue} | ${a['cumulative-layout-shift'].displayValue} | ` +
        `${a['speed-index'].displayValue} |`
    );
  }
  lines.push('');

  // Custom milestones — emitted by bench/instrument.js, captured by
  // Lighthouse's user-timings audit. Only renders if at least one row
  // has timings (e.g., URL didn't include &bench=1).
  const protvistaTimings = (report) =>
    (report.audits['user-timings']?.details?.items ?? []).filter(
      (it) => it.timingType === 'Measure' && it.name?.startsWith('protvista:')
    );
  const anyTimings = rows.some(
    ({ report }) => protvistaTimings(report).length > 0
  );
  if (anyTimings) {
    const fmt = (ms) => (ms == null ? '—' : `${ms.toFixed(0)} ms`);
    const pick = (items, name) =>
      items.find((it) => it.name === name)?.duration;
    lines.push('### Custom milestones (median run)');
    lines.push('');
    lines.push('| Scenario | fetch-and-parse | render | total |');
    lines.push('|---|---|---|---|');
    for (const { scenario, report } of rows) {
      const items = protvistaTimings(report);
      lines.push(
        `| \`${scenario}\` | ${fmt(pick(items, 'protvista:fetch-and-parse'))} | ` +
          `${fmt(pick(items, 'protvista:render'))} | ${fmt(pick(items, 'protvista:total'))} |`
      );
    }
    lines.push('');
  }
}

const out = join(resultsDir, 'summary.md');
writeFileSync(out, lines.join('\n'));
console.log(`summary: ${out}`);
