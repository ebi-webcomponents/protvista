#!/usr/bin/env node
/**
 * Roll bench/results/* into a single bench/results/summary.md table.
 *
 * Reads:
 *   - bench/results/bundle-size.json      (from bench:bundle)
 *   - bench/results/lighthouse/manifest.json + report JSONs (from bench:lighthouse)
 *
 * Each numeric cell shows `median (min–max)` across all N runs LHCI did,
 * so a wide range is a hint that the median for that scenario is less
 * trustworthy and may need re-running on a quieter machine.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const resultsDir = join(root, 'bench/results');
const lhDir = join(resultsDir, 'lighthouse');

const lines = [];
const kb = (b) => (b / 1024).toFixed(1) + ' KB';

// Tag the snapshot with the commit when available — `bench/baselines/`
// files in particular need this to be traceable back to a specific tree.
const shortSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
})();

lines.push('# Bench results');
lines.push('');
lines.push(`Captured: ${new Date().toISOString()}`);
if (shortSha) lines.push(`Commit: \`${shortSha}\``);
lines.push('');
lines.push('Numeric cells show `median (min–max)`.');
lines.push('');

// Reduce a numeric series to {min, median, max}. Returns nulls when
// there are no numeric samples (e.g., a metric was missing in every run).
const stats = (values) => {
  const cleaned = values.filter(
    (v) => typeof v === 'number' && !Number.isNaN(v)
  );
  if (cleaned.length === 0) return { min: null, median: null, max: null };
  const sorted = [...cleaned].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
  };
};

// Format a {min, median, max} cell. Unit is picked once from the median
// so all three numbers share it — keeps cells visually balanced.
const cellMs = (s) => {
  if (s.median == null) return '—';
  const useS = s.median >= 1000;
  const f = (n) => (useS ? (n / 1000).toFixed(1) : n.toFixed(0));
  const unit = useS ? 's' : 'ms';
  return `${f(s.median)} ${unit} (${f(s.min)}–${f(s.max)})`;
};
const cellInt = (s) =>
  s.median == null
    ? '—'
    : `${s.median.toFixed(0)} (${s.min.toFixed(0)}–${s.max.toFixed(0)})`;
const cellFixed = (s, n) =>
  s.median == null
    ? '—'
    : `${s.median.toFixed(n)} (${s.min.toFixed(n)}–${s.max.toFixed(n)})`;

const manifestPath = join(lhDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Group every run by URL — we need all of them, not just the
  // representative, to compute the range.
  const byUrl = new Map();
  for (const run of manifest) {
    if (!byUrl.has(run.url)) byUrl.set(run.url, []);
    byUrl.get(run.url).push(JSON.parse(readFileSync(run.jsonPath, 'utf8')));
  }

  const rows = [...byUrl].map(([url, reports]) => {
    const u = new URL(url);
    return {
      scenario: u.search.replace(/^\?/, '') || u.pathname,
      reports,
    };
  });

  const numRuns = rows[0]?.reports.length ?? 0;
  lines.push(`## Lighthouse (${numRuns} runs)`);
  lines.push('');
  lines.push('| Scenario | Perf | LCP | TBT | CLS | Speed Index |');
  lines.push('|---|---|---|---|---|---|');
  for (const { scenario, reports } of rows) {
    const score = stats(
      reports.map((r) => r.categories.performance.score * 100)
    );
    const lcp = stats(
      reports.map((r) => r.audits['largest-contentful-paint'].numericValue)
    );
    const tbt = stats(
      reports.map((r) => r.audits['total-blocking-time'].numericValue)
    );
    const cls = stats(
      reports.map((r) => r.audits['cumulative-layout-shift'].numericValue)
    );
    const si = stats(
      reports.map((r) => r.audits['speed-index'].numericValue)
    );
    lines.push(
      `| \`${scenario}\` | ${cellInt(score)} | ${cellMs(lcp)} | ${cellMs(tbt)} | ${cellFixed(cls, 2)} | ${cellMs(si)} |`
    );
  }
  lines.push('');

  // Custom milestones — emitted by bench/instrument.js, captured by
  // Lighthouse's user-timings audit.
  const protvistaTimings = (report) =>
    (report.audits['user-timings']?.details?.items ?? []).filter(
      (it) => it.timingType === 'Measure' && it.name?.startsWith('protvista:')
    );
  const durations = (reports, name) =>
    reports.map(
      (r) => protvistaTimings(r).find((t) => t.name === name)?.duration
    );

  const anyTimings = rows.some(({ reports }) =>
    reports.some((r) => protvistaTimings(r).length > 0)
  );
  if (anyTimings) {
    lines.push(`### Custom milestones (${numRuns} runs)`);
    lines.push('');
    lines.push('| Scenario | fetch-and-parse | render | total |');
    lines.push('|---|---|---|---|');
    for (const { scenario, reports } of rows) {
      const fp = stats(durations(reports, 'protvista:fetch-and-parse'));
      const rd = stats(durations(reports, 'protvista:render'));
      const tt = stats(durations(reports, 'protvista:total'));
      lines.push(
        `| \`${scenario}\` | ${cellMs(fp)} | ${cellMs(rd)} | ${cellMs(tt)} |`
      );
    }
    lines.push('');
  }
}

const bundlePath = join(resultsDir, 'bundle-size.json');
if (existsSync(bundlePath)) {
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  lines.push('## Bundle size (library, `dist/`)');
  lines.push('');
  lines.push('| Total raw | Total gzip | Files |');
  lines.push('|---|---|---|');
  lines.push(
    `| ${kb(bundle.total.raw)} | ${kb(bundle.total.gzip)} | ${bundle.files.length} |`
  );
  lines.push('');
}

const out = join(resultsDir, 'summary.md');
writeFileSync(out, lines.join('\n'));
console.log(`summary: ${out}`);
