# Performance benchmarks

1. **Library bundle size** — raw + gzipped bytes from `yarn build`'s `dist/` output. Catches accidental dependency bloat in shippable code.
2. **Lighthouse CI** — runs the demo (`yarn build:demo`, served by `vite preview`) against a fixed list of UniProt accessions. Captures LCP, TBT, CLS, Speed Index, and the overall Performance score.
3. **Custom milestones** — `<protvista-uniprot>` emits three `performance.mark()` calls at lifecycle transitions (`script-start` in `connectedCallback`, `data-loaded` after fetch resolves, `first-render` after Lit commits the manager to the DOM) plus three `performance.measure()` calls between them. Lighthouse's user-timings audit captures these automatically, so they appear next to the headline metrics in `summary.md`.

`fetch-and-parse` (script-start → data-loaded), `render` (data-loaded → first-render), and `total` (script-start → first-render) are the durations surfaced in the report.

## Stability contract

The four mark/measure names — `protvista:script-start`, `protvista:data-loaded`, `protvista:first-render`, plus the three measures derived from them — are part of the component's public observable surface. **Renaming them, moving them to a different lifecycle point, or removing them is a breaking change for performance comparison.** A refactor that changes the conceptual meaning of any mark must update the corresponding baseline.

The marks fire unconditionally (every demo run, every consumer page) — they're cheap (~150 bytes shipped, no work when nobody is observing) and useful for any consumer that wants to profile.

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

Eyeballing two `summary.md` tables — current run vs. a committed baseline under `bench/baselines/` — is enough most of the time. For raw numbers, `jq` over `bench/results/lighthouse/manifest.json` pulls per-run metrics out of the latest run; `lhci open` will pop the current run's HTML reports in a browser if you want to see Lighthouse's full breakdown for one scenario.

Treat any single-metric delta under ~5% as noise unless it's consistent across all scenarios.

## Editing scenarios

Scenarios are defined in `bench/lighthouserc.cjs` under `ci.collect.url`. Each query string is a UniProt accession — `index.html` reads `?accession=` and renders that protein. Add or remove URLs there.

## Files

| File               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `lighthouserc.cjs` | LHCI config: scenarios, run count, throttling preset  |
| `bundle-size.mjs`  | Walks `dist/`, writes raw + gzip sizes per file       |
| `summarize.mjs`    | Reads results, writes `summary.md`                    |
| `run.mjs`          | One-shot driver (`yarn bench`)                        |
| `baselines/`       | Committed snapshots — reference points for comparison |
| `results/`         | Gitignored — output of the latest run                 |

The custom marks themselves live in `src/protvista-uniprot.ts`, not in this directory.
