# Test coverage since the Q1 baseline

This report answers the Q3 roadmap item _"Report test coverage progress against the Q1 baseline"_ ([issue #384](https://github.com/ebi-webcomponents/protvista/issues/384)). The roadmap sets three targets: every adapter has unit tests, config validation and loading are tested, and CI is set up so that no integration-breaking change can be merged without a test failing.

- **Q1 baseline:** `9615385` (20 April 2026), `main` after the testing-baseline merge (PR #130). The figures are the ones recorded in the README at that commit.
- **Now:** `next` at `2d58072` (30 October 2026), the merge of PR #411.

## Summary

- **Tests grew from 29 in 3 spec files to 3,101 in 149 spec files.** 2,869 tests in 122 files run in jsdom (the `unit` project) and 232 tests in 27 files run in headless Chromium (the `browser` project, added after Q1).
- **Coverage rose from about 10% to about 95%.** Across both projects, as CI measures it, statements went from 10.33% to 95.36%, branches from 5.99% to 90.47%, functions from 13.19% to 96.23% and lines from 9.66% to 96.64%.
- **Every adapter has its own unit tests.** All 13 built-in adapters have a spec. The last six gained theirs on 30 October 2026 (#304, #305 and #383, all closed).
- **Config validation and loading are tested.** The validator, normaliser, `extends` resolution, config loader and data loader each have dedicated specs and 86% or more branch coverage.
- **CI runs every check on every push and pull request, but a failing run blocks a merge only if the branch requires the checks.** That is a GitHub setting, not part of the repository, and this report has not confirmed it for `next` or `main` (see [What the gates do not cover](#what-the-gates-do-not-cover)). The coverage floors are also 15 to 18 points below today's figures.

| Target                                       | Status         |
| -------------------------------------------- | -------------- |
| Every adapter has unit tests                 | **Met**        |
| Config validation and loading are tested     | **Met**        |
| No integration-breaking change can be merged | **Partly met** |

## Method

**Tool.** Vitest 5.0.3 with `@vitest/coverage-v8` 5.0.3, Node v24.22.2, using the coverage settings in `vite.config.mjs`. Coverage counts every `.ts` file under `src/` (83 files), not only the files tests import, and excludes tests, type-only files, static lookup tables, style strings and three playground files that only wire up the DOM and CodeMirror. The Q1 baseline used the same `src/**/*.ts` denominator with the equivalent exclusions, under Vitest 4.1.4 and the `unit` (jsdom) suite only.

**Projects.** `vite.config.mjs` defines two Vitest projects. `unit` runs `src/**/*.spec.ts` and `scripts/**/*.spec.mjs` in jsdom. `browser` runs `src/**/__browser__/*.browser.spec.ts` in headless Chromium through Playwright. Both stub the Nightingale track components (`src/__spec__/nightingale-mocks.ts`); six browser spec files load the real components for what they test.

**Skipped tests.** The 14 skipped tests check a built `dist/` (`src/__spec__/package-contract.spec.ts`), a built `site/` (`src/__spec__/funding-acknowledgement.spec.ts`) or a `.zenodo.json` that does not exist yet. The test job builds neither, so CI's build job runs the first two against its own build (see [CI gates](#ci-gates)).

**Commands.** From a checkout of `2d58072`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once, for the browser project

# Each project on its own.
pnpm exec vitest run --coverage --project unit --maxWorkers=3 \
  --coverage.reporter=text-summary --coverage.reporter=json-summary \
  --coverage.reportsDirectory=/tmp/coverage-unit
pnpm exec vitest run --coverage --project browser --maxWorkers=1 \
  --coverage.reporter=text-summary --coverage.reporter=json-summary \
  --coverage.reportsDirectory=/tmp/coverage-browser

# Both projects together: the CI coverage gate.
pnpm test:coverage --maxWorkers=2
```

The `--maxWorkers` options only limit parallelism to fit the memory of the machine used here. CI runs `pnpm test:coverage` without them. The coverage floors in `vite.config.mjs` apply to every run, so the browser-only run ends with "does not meet global threshold" errors. This is expected: the floors are meant for the combined figure.

The per-file figures quoted below are from `/tmp/coverage-unit/coverage-summary.json`.

The Q1 figures and file counts can be checked without Node:

```sh
git show 9615385:README.md | sed -n 116,125p                                 # the recorded baseline
git ls-tree -r --name-only 9615385 -- src | grep -c '\.spec\.ts$'            # 4 spec files at Q1
git ls-tree -r --name-only 2d58072 -- src scripts | grep -cE '\.spec\.(ts|mjs)$'   # 149 now
git ls-tree -r --name-only 2d58072 -- src | grep -c '\.browser\.spec\.ts$'   # 27 of them browser specs
```

**A note on the Q1 count.** The README at `9615385` records 29 tests in 3 spec files. The tree at that commit holds 4 spec files. `filter-config.spec.ts`, `protvista-uniprot-datatable.spec.ts` and `structure-adapter.spec.ts` contain 5, 22 and 2 tests, which is 29. The fourth, `src/utils/__spec__/security.spec.ts` (31 tests, added on 16 April 2026), does not appear to be in the recorded figures. This report quotes the baseline as recorded and does not re-run it.

## Results

### Q1 and now

| Measure    | Q1 `9615385` (unit only) | `next` `2d58072`, both projects (CI gate) |
| ---------- | -----------------------: | ----------------------------------------: |
| Spec files |                        3 |                                       149 |
| Tests      |                       29 |          3,101 (3,087 passed, 14 skipped) |
| Statements |                   10.33% |                                    95.36% |
| Branches   |                    5.99% |                                    90.47% |
| Functions  |                   13.19% |                                    96.23% |
| Lines      |                    9.66% |                                    96.64% |

### By project

| `next` `2d58072` | Spec files | Tests                            | Statements             | Branches               | Functions              | Lines                  |
| ---------------- | ---------: | -------------------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| `unit` (jsdom)   |        122 | 2,869 (2,855 passed, 14 skipped) | 89.29% (5,636 / 6,312) | 86.88% (4,139 / 4,764) | 90.49% (1,199 / 1,325) | 90.18% (5,001 / 5,545) |
| `browser`        |         27 | 232 (all passed)                 | 69.60% (4,397 / 6,317) | 60.78% (2,896 / 4,764) | 70.85% (941 / 1,328)   | 72.27% (4,009 / 5,547) |
| Both (CI gate)   |        149 | 3,101 (3,087 passed, 14 skipped) | 95.36%                 | 90.47%                 | 96.23%                 | 96.64%                 |

Six of the 122 `unit` spec files test build and reporting scripts under `scripts/`. Their code is outside the coverage denominator, which counts `src/` only. The two runs count slightly different totals (for example 6,317 statements in the `browser` run against 6,312 in the `unit` run). Each row is reported as measured. `pnpm test:coverage` prints percentages only.

The file with the lowest combined coverage is the structure viewer, `src/protvista-uniprot-structure.ts`: 69.9% statements, 68.15% branches, 55% functions and 68.75% lines. It is the only file below all four floors.

### Adapters

`BUILTIN_ADAPTERS` in `src/schema/adapters/index.ts` is the registry of built-in adapters: both the config validator and the data loader resolve adapter names through it. Coverage is from the whole `unit` suite, not only the adapter's own spec.

| Adapter                           | Module                                   | Own spec                                              | Statements | Branches | Gap issue               |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------- | ---------: | -------: | ----------------------- |
| `uniprot-features-json`           | `feature-adapter.ts`                     | yes: `__tests__/domain-adapters.spec.ts`              |       100% |   83.33% | none                    |
| `interpro-entries-json`           | `interpro-adapter.ts`                    | yes: `__tests__/domain-adapters.spec.ts`              |     90.90% |   62.50% | none                    |
| `uniprot-proteomics-json`         | `proteomics-adapter.ts`                  | yes: `__tests__/proteomics-adapters.spec.ts`          |       100% |     100% | none                    |
| `uniprot-proteomics-ptm-json`     | `ptm-exchange-adapter.ts`                | yes: `__tests__/proteomics-adapters.spec.ts`          |     92.68% |   81.81% | none                    |
| `uniprot-proteins-pdb-json`       | `structure-adapter.ts`                   | yes: `__tests__/structure-adapter.spec.ts` ¹          |     92.50% |   85.00% | none                    |
| `uniprot-variation-json`          | `variation-adapter.ts`                   | yes: `__tests__/domain-adapters.spec.ts`              |     92.30% |   85.71% | none                    |
| `uniprot-variation-counts-json`   | `variation-graph-adapter.ts`             | yes: `__spec__/variation-graph-adapter.spec.ts`       |       100% |     100% | #304, closed by PR #398 |
| `uniprot-rna-editing-json`        | `rna-editing-adapter.ts`                 | yes: `__tests__/rna-editing-adapter.spec.ts`          |       100% |     100% | #383, closed by PR #397 |
| `uniprot-rna-editing-counts-json` | `rna-editing-graph-adapter.ts`           | yes: `__spec__/rna-editing-graph-adapter.spec.ts`     |       100% |   91.66% | #304, closed by PR #398 |
| `alphafold-prediction-json`       | `alphafold-confidence-adapter.ts`        | yes: `__tests__/alphafold-confidence-adapter.spec.ts` |       100% |     100% | #383, closed by PR #397 |
| `alphamissense-average-csv`       | `alphamissense-pathogenicity-adapter.ts` | yes: `__spec__/alphamissense-csv.spec.ts`             |     96.77% |   87.50% | #305, closed by PR #399 |
| `alphamissense-full-csv`          | `alphamissense-heatmap-adapter.ts`       | yes: `__spec__/alphamissense-csv.spec.ts`             |     88.88% |   62.50% | #305, closed by PR #399 |
| `uniprot-isoforms-json`           | `uniprot-isoforms-adapter.ts`            | yes: `__tests__/uniprot-isoforms-adapter.spec.ts`     |       100% |     100% | none                    |

Paths are relative to `src/schema/adapters/`. Before #304, #305 and #383, six adapters had no spec of their own. #383 describes them as "only exercised through the mocked `src/__spec__/load-data-baseline.spec.ts`", but that spec replaces every adapter with a stub, so it does not run their code. Any coverage they had came from specs that load configs with the real adapters, such as `src/__spec__/golden-resolution.spec.ts` and `src/__spec__/examples.spec.ts`. All three issues were closed on 30 October 2026.

¹ The spec tests the two helpers that do the work, `getAllFeatureStructures` and `mergeOverlappingIntervals`. The exported adapter, a 9-line wrapper around them, has no direct test. It runs in specs that load configs with the real adapters, such as `src/__spec__/golden-resolution.spec.ts`. (`load-data-baseline.spec.ts` replaces it with a stub, so it does not run there.)

Authors' own files (CSV, TSV, JSON, BED) are not named adapters. A track's `kind` and the source's format select a decoder, which `runPipeline` (`pipeline.ts`) runs. The decoders are tested too. Paths that do not start with `src/` are relative to `src/schema/adapters/`.

| Decoder                | Spec                                                                          | Statements | Branches |
| ---------------------- | ----------------------------------------------------------------------------- | ---------: | -------: |
| `bed.ts`               | `src/schema/__spec__/bed.spec.ts`                                             |       100% |     100% |
| `dsv.ts` (CSV and TSV) | `src/schema/__spec__/features-dsv.spec.ts`, `__spec__/delimiter-hint.spec.ts` |     98.15% |   92.23% |
| `features-json.ts`     | `src/schema/__spec__/features-json.spec.ts`                                   |       100% |     100% |
| `linegraph.ts`         | `__spec__/linegraph.spec.ts`, `__spec__/linegraph-dsv.spec.ts`                |     96.72% |   91.52% |
| `variation.ts`         | `__spec__/variation.spec.ts`                                                  |     88.40% |   78.26% |
| `pipeline.ts`          | `__spec__/pipeline-coordinates.spec.ts`, `__spec__/delimiter-hint.spec.ts`    |     90.90% |   94.82% |

### Config validation and loading

| Module                    | What it does                                        | Spec                                                                            | Statements | Branches |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ---------: | -------: |
| `src/schema/parse.ts`     | reads YAML or JSON into a config                    | `load.spec.ts` (through `loadConfig`), `src/__spec__/golden-resolution.spec.ts` |       100% |   89.47% |
| `src/schema/extends.ts`   | resolves `extends:` chains                          | `extends.spec.ts`                                                               |     95.28% |   86.13% |
| `src/schema/validate.ts`  | checks a config against the schema and the registry | `validate.spec.ts`                                                              |     96.41% |   93.89% |
| `src/schema/normalize.ts` | expands shorthand into the full form                | `normalize.spec.ts`                                                             |       100% |   97.14% |
| `src/schema/load.ts`      | parse, extend, validate and normalise in one call   | `load.spec.ts`                                                                  |     95.94% |   91.95% |
| `src/schema/registry.ts`  | built-in and registered adapters, kinds and themes  | `registry.spec.ts` and two `registry-*` specs                                   |     98.14% |   96.29% |
| `src/load-data.ts`        | fetches and decodes each track's data               | nine `src/__spec__/load-data-*.spec.ts` files                                   |     98.78% |   93.87% |

Spec names without a directory are under `src/schema/__spec__/`. Beyond these unit specs, `src/__spec__/examples.spec.ts` loads, validates, decodes and mounts every config under `examples/`, and `src/__spec__/starter-kit.spec.ts` does the same for the Starter Kit, so a change that breaks a shipped config fails a test.

## CI gates

`.github/workflows/test-and-deploy.yml` runs on every push to any branch and on every pull request. Runs for a first-time contributor's fork wait for a maintainer's approval.

| Gate                        | Job and command                                                                                                                     | What it blocks                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint                        | Test: `pnpm test:lint`                                                                                                              | An ESLint error in `src/**/*.ts`, `bench/`, `scripts/conservation/` or `scripts/complexity/`. Other Node scripts are not linted (#316, open).                                                                                                                                                                             |
| Types                       | Test: `pnpm test:types` (`tsc`)                                                                                                     | A type error. `strictNullChecks` is off in `tsconfig.json`, so possible `null` and `undefined` values are not checked.                                                                                                                                                                                                    |
| Unit tests                  | Test: `pnpm test:unit`                                                                                                              | A failing jsdom test. These include specs that keep the docs, examples, Starter Kit and complexity report in step with the code.                                                                                                                                                                                          |
| Palette audit               | Test: `pnpm test:palettes`                                                                                                          | A colour figure in the accessibility audit that no longer matches the palettes in `src/` or the installed Nightingale bundles (#382).                                                                                                                                                                                     |
| Browser and axe tests       | Test: `pnpm test:coverage`                                                                                                          | A failing Chromium test, including an axe accessibility violation in the 8 browser spec files that run axe. There is no separate `pnpm test:browser` step: the coverage step runs the browser project.                                                                                                                    |
| Coverage floors and ratchet | Test: `pnpm test:coverage`                                                                                                          | Combined coverage below 80% statements, 74% branches, 78% functions or 81% lines (`test.coverage.thresholds` in `vite.config.mjs`). The floors are global, not per file. #162 specified the ratchet and #222 wired it into CI (PR #224, July 2026). It is raised by hand and was last raised on 24 July 2026 (`5e1279b`). |
| Windows                     | Test (Windows): `pnpm test:lint`, `pnpm test:types`, `pnpm test:unit` on `windows-latest`                                           | A change that breaks lint, types or unit tests on Windows (path separators, line endings, `cmd.exe` quoting). The browser suite and coverage run on Linux only. The build job does not wait for this job.                                                                                                                 |
| Package checks              | Build: `pnpm test:pack` (build, `publint --strict`, `attw`), then `src/__spec__/package-contract.spec.ts` against the built `dist/` | A broken exports map, package `type` or emitted declarations, as a consumer would resolve them from the published tarball, and `package.json` entry points that do not exist in `dist/`.                                                                                                                                  |
| Docs build and link check   | Build: `pnpm site:build`, then `src/__spec__/funding-acknowledgement.spec.ts` against `site/`                                       | A docs site that does not build, a broken internal link or `#anchor` (`starlight-links-validator`), and a page without the funding acknowledgement in its footer. Runs on every push and pull request; only a push to `next` deploys.                                                                                     |

The build job waits for the test job. If a test fails, the package checks and the docs build do not run and show as skipped.

Three other workflows do not gate a merge. `screenshots.yml` compares the documentation screenshots on pull requests that touch `src/`, `scripts/screenshots/` or `docs/src/`: drift is only a warning, and the job fails only when a screenshot cannot be taken. `sample-data-drift.yml` is scheduled weekly (schedules run from the default branch, `main`) and reports when the live APIs that the example data comes from have changed. `publish-starter-kit.yml` runs the unit tests before it publishes the Starter Kit on a release.

### What the gates do not cover

- **The workflows alone do not stop a merge.** A failing check blocks a merge only when a branch protection rule or ruleset on the target branch requires that check. These settings are kept in GitHub, not in the repository. On 31 October 2026 neither `next` nor `main` had one: the GitHub API reported `"protected": false` with required status checks off for both (`gh api repos/ebi-webcomponents/protvista/branches/next`, and the same for `main`), and no ruleset applies to either (`gh api repos/ebi-webcomponents/protvista/rules/branches/next`, and `main`, both return `[]`). So anyone with write access can merge a pull request whose checks failed, or push straight to either branch.
- **The floors leave a lot of room.** Today's figures are 15.36 (statements), 16.47 (branches), 18.23 (functions) and 15.64 (lines) points above the floors. A change could remove a large share of tests, or add a large untested module, and still pass.
- **Most tests stub Nightingale.** Both projects replace the Nightingale track components with empty elements. Six browser spec files load the real ones for what they check, for example `score-colours.browser.spec.ts` for the colours of the score tracks. A change in how Nightingale draws a track would pass the other tests. The AlphaMissense colour defect was found by the accessibility audit (#382, PR #410), not by a failing test. That spec now records it.

## Targets

| Target                                                                                   | Status         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every adapter has unit tests                                                             | **Met**        | All 13 registered adapters and all 5 file decoders have their own spec ([Adapters](#adapters)). The six gaps were closed by #304, #305 and #383.                                                                                                                                                                                                                                                                                                                                                                                           |
| Config validation and loading are tested                                                 | **Met**        | Dedicated specs for parsing, `extends`, validation, normalisation, loading and the registry, each with 86% or more branch coverage; every example config and the Starter Kit are loaded and mounted in tests ([Config validation and loading](#config-validation-and-loading)).                                                                                                                                                                                                                                                            |
| CI is set up so that no integration-breaking change can be merged without a test failing | **Partly met** | Lint, types, unit, browser and axe tests, the coverage floors, a Windows job, the package checks and the docs build all run on every push and pull request, and each fails the run. But the floors are 15 to 18 points below today's figures, and most tests stub Nightingale. A failing run also blocks a merge only if `next` and `main` require the checks, which this report has not confirmed ([What the gates do not cover](#what-the-gates-do-not-cover)). The first two gaps make this target partly met whatever that setting is. |

## Follow-ups

Recommendations for the maintainers to decide:

1. **Require the checks before merging.** Add a branch protection rule or ruleset for `next` and `main` that requires the "Test", "Test (Windows)" and "Build" checks to pass and blocks direct pushes. Without it, the gates report a breaking change but do not prevent its merge. Follow-ups 2 and 4 close the other two gaps.
2. **Raise the coverage floors** to about 1 point below today's figures (for example 94 / 89 / 95 / 95), as the ratchet intends, and raise them again in each pull request that improves coverage.
3. **Test the structure viewer.** `src/protvista-uniprot-structure.ts` is the least covered file (55% of functions). The open issues #311 (accessible states and an axe test for the structure panel) and #323 (stale structures after an accession change) are natural places to add them.
4. **Run more browser specs against the real Nightingale components**, starting with each track type in the default config, so that an upgrade that changes what is drawn fails a test.
5. **Lint every Node script** (#316) and **add a contrast regression test for the default colour tokens** (#315).
6. **Re-run this report for Q4** with the commands above, on the `next` tip at that time.
