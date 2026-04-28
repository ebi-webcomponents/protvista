# Performance benchmarks

1. **Library bundle size** — raw + gzipped bytes from `yarn build`'s `dist/` output. Catches accidental dependency bloat in shippable code.
2. **Lighthouse CI** — runs the demo (`yarn build:demo`, served by `vite preview`) against a fixed list of UniProt accessions. Captures LCP, TBT, CLS, Speed Index, and the overall Performance score.
3. **Custom milestones** — `bench/instrument.js` observes the host's DOM to mark `script-start`, `data-loaded` (loader removed), `first-render` (manager inserted), and `tracks-settled` (no subtree mutations for 250 ms — same quiescence pattern Playwright's `networkidle` uses). Lighthouse's user-timings audit captures these automatically, so they appear next to the headline metrics in `summary.md`.

`fetch-and-parse` (script-start → data-loaded) and `render` (data-loaded → tracks-settled) are the per-stage breakdowns; `total` is the end-to-end. The `render` measure includes a constant ~250 ms quiescence gap, which cancels out in before/after comparisons.

The custom layer is purely external: it only loads when the URL has `?bench=1`, observes the rendered DOM, and adds **zero changes to `src/`**. If you need finer-grained timings (e.g., per-track or per-adapter cost) later, add `performance.mark()` calls inside `src/` — but the milestones above usually suffice for spotting regressions in a refactor.

## Run

```bash
yarn bench
```

This builds, measures, and writes:

- `bench/results/bundle-size.json` — file-by-file sizes plus totals
- `bench/results/lighthouse/` — raw LHCI reports + `manifest.json`
- `bench/results/summary.md` — top-line markdown table

`bench/results/` is gitignored. Only `bench/baselines/` is tracked.

You can also run each layer on its own:

```bash
yarn bench:bundle      # library only
yarn bench:lighthouse  # demo only
yarn bench:summary     # re-render summary.md from existing results
```

## Capturing a baseline

Lighthouse numbers are sensitive to machine state. To make a snapshot worth committing:

- Run on a quiet machine, plugged in, no other heavy apps.
- Same Chrome version on every run (LHCI uses the system Chrome).
- 5 runs per URL by default; LHCI picks the representative (median) run.

To pin a snapshot to a known commit:

```bash
yarn bench
SHA=$(git rev-parse --short HEAD)
cp bench/results/summary.md bench/baselines/summary-${SHA}.md
cp bench/results/bundle-size.json bench/baselines/bundle-size-${SHA}.json
git add bench/baselines/summary-${SHA}.md bench/baselines/bundle-size-${SHA}.json
git commit -m "Benchmarks: baseline at ${SHA}"
```

To capture a baseline against an **older** commit (e.g., `main` immediately before a merge), use a worktree so your working checkout stays untouched:

```bash
git worktree add ../protvista-baseline <commit-sha>
cd ../protvista-baseline
yarn install --frozen-lockfile
yarn bench
# copy the snapshot back into the main checkout's bench/baselines/
```

## Comparing

Eyeballing two `summary.md` tables is enough most of the time. For a stricter check, LHCI's own diff works against the raw reports — see `lhci compare` docs.

Treat any single-metric delta under ~5% as noise unless it's consistent across all scenarios.

## Editing scenarios

Scenarios are defined in `bench/lighthouserc.cjs` under `ci.collect.url`. Each query string is a UniProt accession — `index.html` reads `?accession=` and renders that protein. Add or remove URLs there.

## Files

| File               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `lighthouserc.cjs` | LHCI config: scenarios, run count, throttling preset  |
| `bundle-size.mjs`  | Walks `dist/`, writes raw + gzip sizes per file       |
| `instrument.js`    | Browser-side marks; loaded only on `?bench=1`         |
| `summarize.mjs`    | Reads results, writes `summary.md`                    |
| `run.mjs`          | One-shot driver (`yarn bench`)                        |
| `baselines/`       | Committed snapshots — reference points for comparison |
| `results/`         | Gitignored — output of the latest run                 |
