# Code size and complexity since the Q1 baseline

This report answers the Q3 roadmap item _"Measure and report the reduction in codebase complexity using standard auditing tools, comparing against the Q1 baseline"_ ([issue #381](https://github.com/ebi-webcomponents/protvista/issues/381)). Q1 recorded performance, bundle size and test coverage but no complexity figures, so both points are measured here with the same tool.

- **Q1 baseline:** `9615385` (20 April 2026), `main` after the testing-baseline merge (PR #130). This is the reference point of the [architecture audit](../architecture-audit.md).
- **Now:** `next` at `09f1832` (30 October 2026), the merge of the complexity refactor PR #407.
- **Before PR #407:** `17a2ea0`, the first parent of `09f1832`, used only for the section on that PR.

## Summary

- **The library is larger and more complex in total, because it does much more.** It grew from 5,359 to 27,755 lines and its total cyclomatic complexity from 831 to 3,843. Of the increase, 2,200 points are in 63 new modules that implement grant deliverables: the config schema and validator, the file-format adapters, error reporting, customize mode, declarative tooltips and theming. A further 900 points were added to the host element, `src/protvista-uniprot.ts`.
- **Code that existed in Q1 and is still in use changed little.** The ported adapters, the structure viewer, the datatable, the filter config and the utilities went from 481 to 556 (+16%).
- **Complexity went down where the roadmap asked for it.** The imperative tooltip layer (731 lines, complexity 163, including two of the six largest Q1 functions) is gone. The 912-line hardcoded TypeScript config is now a 22-line re-export, and the configuration is a YAML document checked against the published schema. Of the 10 Q1 functions over complexity 10, 5 are now removed or at 10 or below, 1 was moved into another function (24 → 22), and 4 remain above 10.
- **Complexity went up in the host element.** `src/protvista-uniprot.ts` grew from 782 to 6,076 lines and from 187 to 1,087 complexity points. It holds 28% of the library's complexity and 18 of its 53 functions over 10.
- **Per function, the code is slightly more complex than in Q1.** The mean is 3.07 (Q1: 2.72), the median 2 (Q1: 1), and 4.2% of functions are over 10 (Q1: 3.3%). The largest function is smaller than in Q1 (24 against 31), but 6 functions are over 20 (Q1: 3).
- **PR #407 left the total unchanged (+4) and broke up the worst functions.** The maximum fell from 46 to 24, functions over 20 from 17 to 6, and functions over 10 from 65 to 53.

We do not report a fall in total complexity, because there was none. The fair measures of "reduction" are the legacy code removed and the Q1 hotspots resolved, set against growth that comes from new features.

## Method

**Tool.** ESLint's core [`complexity`](https://eslint.org/docs/latest/rules/complexity) rule, which reports the cyclomatic complexity of every function, run with a dedicated flat config (`scripts/complexity/eslint.complexity.config.mjs`: classic variant, `max: 0` so every function is reported, inline `eslint-disable` comments ignored). A function scores 1 plus 1 for each branch: `if`, `?:`, loops, `case`, `catch`, `&&`, `||`, `??`, `?.` and default parameter values. ESLint also scores each class-field initialiser as a function (63 of the 1,250 functions on `next`, 15 of 305 at Q1; most score 1). The figures include them.

**Versions.** Node v24.22.2, ESLint 10.11.0, `@typescript-eslint/parser` 8.71.0, TypeScript 6.0.3. ESLint, the parser and TypeScript are pinned to exact versions in `package.json` and `pnpm-lock.yaml`, and the script prints them in its header. Both commits are measured with the toolchain of the current checkout: the script extracts the commit's `src/` with `git archive` and lints that copy. The baseline's own lockfile is never installed, so a change in how ESLint counts between versions cannot affect the comparison. A later upgrade could still change the figures, so `scripts/complexity/measure.spec.mjs`, part of `pnpm test:unit` in CI, re-measures the three commits used here and fails if any figure in the Totals, By area, PR #407 or "Most complex functions on `next`" tables no longer matches. The same spec checks the score of each counted construct and the settings of the ESLint config, and the script stops with an error if ESLint did not score every function in a file.

**Scope.** Every `.ts` file under `src/`, excluding tests (`__spec__`, `__tests__`, `__browser__`, `__fixtures__`, `__mocks__`, `*.spec.ts`, `*.test.ts`). The playground (`src/playground/`) did not exist in Q1 and is not part of the shipped library, so it is reported separately and kept out of the library totals.

**Lines.** _Lines_ is the newline count of each file, the same as `wc -l`. _Code lines_ are lines that hold at least one token; _comment lines_ hold only comments; blank lines are in neither.

**Areas.** Each file is assigned to one area by path, first match wins, using the same rules for both commits:

| Area                          | Files                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| playground                    | `src/playground/`                                                                                                                                   |
| tooltips                      | `src/tooltips/`                                                                                                                                     |
| styles                        | `src/styles/`                                                                                                                                       |
| loader and adapters           | `src/adapters/` (Q1), `src/schema/adapters/`, `src/load-data.ts`, `src/feature-source.ts`, `src/schema/fetch-text.ts`, `src/schema/file-formats.ts` |
| schema, config and validation | the rest of `src/schema/`, `src/config.ts`                                                                                                          |
| element                       | `src/protvista-uniprot.ts` and the modules split out of it: `src/renderer/`, `src/errors/`, `src/layout.ts`, `src/layout-persistence.ts`            |
| other                         | everything else: the structure viewer, the datatable, `filter-config.ts`, `utils/`, entry points and type declarations                              |

**Commands.** From a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm metrics:complexity 9615385 --files   # Q1 baseline
pnpm metrics:complexity 09f1832 --files   # next
pnpm metrics:complexity 17a2ea0 --files   # next just before PR #407
```

Each run prints the totals, the per-area table, the 15 most complex library functions (`--top N` for more), the 5 most complex playground functions and, with `--files`, one row per file. `--list <path substring>` prints every function in matching files, and `--json <file>` writes all files and functions for diffing two runs. For the current checkout, the same per-function scores are available from the ESLint CLI with `pnpm exec eslint --no-config-lookup -c scripts/complexity/eslint.complexity.config.mjs -f json src` (this includes test files).

The line totals can be checked without Node:

```sh
# library, excluding tests and the playground: 5,359 at Q1, 27,755 on next
git grep -c '' 9615385 -- 'src/*.ts' ':(exclude,glob)src/**/__*__/**' ':(exclude)*.spec.ts' ':(exclude)*.test.ts' ':(exclude)src/playground/*' | awk -F: '{s+=$NF} END {print s}'
git grep -c '' 09f1832 -- 'src/*.ts' ':(exclude,glob)src/**/__*__/**' ':(exclude)*.spec.ts' ':(exclude)*.test.ts' ':(exclude)src/playground/*' | awk -F: '{s+=$NF} END {print s}'
# the hardcoded config and its replacement: 912, 22 and 524 lines
git show 9615385:src/config.ts | wc -l
git show 09f1832:src/config.ts | wc -l
git show 09f1832:src/default-config.yaml | wc -l
```

## Results

### Totals

| Library (excluding tests and playground) | Q1 `9615385` | `next` `09f1832` |
| ---------------------------------------- | -----------: | ---------------: |
| Files                                    |           33 |               90 |
| Lines                                    |        5,359 |           27,755 |
| Code lines                               |        4,863 |           16,464 |
| Comment lines                            |          111 |            9,629 |
| Functions                                |          305 |            1,250 |
| Total complexity                         |          831 |            3,843 |
| Mean complexity per function             |         2.72 |             3.07 |
| Median                                   |            1 |                2 |
| Maximum                                  |           31 |               24 |
| Functions over 10                        |    10 (3.3%) |        53 (4.2%) |
| Functions over 20                        |            3 |                6 |

The playground on `next` adds 11 files, 4,371 lines, 242 functions and 829 complexity points (maximum 26, 17 functions over 10, 1 over 20).

Comment lines rose from 111 to 9,629. They add to the length of the files but not to their complexity.

### By area

| Area                          | Q1 lines | Q1 complexity | Q1 max | `next` lines | `next` complexity | `next` max | `next` functions over 10 |
| ----------------------------- | -------: | ------------: | -----: | -----------: | ----------------: | ---------: | -----------------------: |
| element                       |      782 |           187 |     31 |        8,518 |             1,460 |         21 |                       21 |
| loader and adapters           |    1,136 |           148 |      8 |        5,785 |               774 |         24 |                       11 |
| schema, config and validation |      912 |             0 |      0 |        6,878 |               777 |         23 |                       13 |
| tooltips                      |      731 |           163 |     28 |        1,598 |               242 |         15 |                        2 |
| styles                        |      120 |             0 |      0 |        2,325 |               138 |         16 |                        2 |
| other                         |    1,678 |           333 |     24 |        2,651 |               452 |         22 |                        4 |
| **library total**             |    5,359 |           831 |     31 |       27,755 |             3,843 |         24 |                       53 |
| playground                    |        — |             — |      — |        4,371 |               829 |         26 |                       17 |

In Q1 the element area was the one file `src/protvista-uniprot.ts`. On `next` that file alone has 6,076 lines, 344 functions and 1,087 complexity points; the modules split out of it (`renderer/`, `errors/`, `layout.ts`, `layout-persistence.ts`) have the other 373.

### Growth against change to existing code

Matching files by path (Q1 `src/adapters/` moved to `src/schema/adapters/` with the same file names) separates the change to code that existed in Q1 from new code:

| Part of the library                                                                                                                                  | Lines          | Complexity  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------- |
| Removed: the six imperative tooltip builders in `src/tooltips/`                                                                                      | 731 → 0        | 163 → 0     |
| Replaced by data: `src/config.ts`                                                                                                                    | 912 → 22       | 0 → 0       |
| Kept from Q1: the 15 adapter files, structure viewer, datatable, filter config, `utils/`, two style files, entry point, type declarations (25 files) | 2,934 → 3,617  | 481 → 556   |
| Host element `src/protvista-uniprot.ts`                                                                                                              | 782 → 6,076    | 187 → 1,087 |
| New modules (63 files)                                                                                                                               | 0 → 18,040     | 0 → 2,200   |
| **Library total**                                                                                                                                    | 5,359 → 27,755 | 831 → 3,843 |

The new modules by area: schema, config and validation 777 (18 files), loader and adapters 609 (16), element modules 373 (10), tooltips 242 (4), styles 137 (7), other 62 (8). The largest are `src/schema/validate.ts` (310), `src/tooltips/resolve.ts` (205), `src/load-data.ts` (154), `src/styles/color.ts` (113) and `src/schema/normalize.ts` (110).

Within the kept files, most of the +75 is in the structure viewer (139 → 191), whose request URLs became configurable (audit item A1) and which now reloads when they change.

### Most complex functions at Q1

These are all 10 functions over 10 at the baseline, and what became of them.

|  Q1 | Function                                                  | Q1 location                              | On `next`                                                                                    |
| --: | --------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
|  31 | `ProtvistaUniprot.getTrack`                               | `src/protvista-uniprot.ts:674`           | 5; the template moved to `trackTemplate` (10) in `src/renderer/track-template.ts` by PR #407 |
|  28 | `formatTooltip`                                           | `src/tooltips/feature-tooltip.ts:167`    | Removed with the imperative tooltips                                                         |
|  24 | `ProtvistaUniprotStructure.connectedCallback`             | `src/protvista-uniprot-structure.ts:493` | 1; the work moved to `ProtvistaUniprotStructure.load` (22)                                   |
|  20 | `ProtvistaUniprot._loadDataInComponents` forEach callback | `src/protvista-uniprot.ts:243`           | 11                                                                                           |
|  17 | `ProtvistaUniprot.render` inner map callback              | `src/protvista-uniprot.ts:478`           | Removed; `ProtvistaUniprot.render` itself went from 10 to 21                                 |
|  15 | `formatTooltip` (variation)                               | `src/tooltips/variation-tooltip.ts:89`   | Removed with the imperative tooltips                                                         |
|  13 | `process3DBeaconsData`                                    | `src/protvista-uniprot-structure.ts:233` | 13                                                                                           |
|  13 | `ProtvistaUniprotStructure.render`                        | `src/protvista-uniprot-structure.ts:704` | 15                                                                                           |
|  12 | `ProtvistaUniprot._loadData` map callback                 | `src/protvista-uniprot.ts:170`           | Removed; `ProtvistaUniprot._loadData` is 9                                                   |
|  11 | `ProtvistaUniprotDatatable.willUpdate`                    | `src/protvista-uniprot-datatable.ts:176` | 11                                                                                           |

### Most complex functions on `next`

| Complexity | Function                                  | Location                                 |
| ---------: | ----------------------------------------- | ---------------------------------------- |
|         24 | `loadProtvistaData`                       | `src/load-data.ts:548`                   |
|         23 | `expandDescriptor`                        | `src/schema/normalize.ts:654`            |
|         22 | `ProtvistaUniprotStructure.load`          | `src/protvista-uniprot-structure.ts:668` |
|         21 | `ProtvistaUniprot._init`                  | `src/protvista-uniprot.ts:2718`          |
|         21 | `ProtvistaUniprot.render`                 | `src/protvista-uniprot.ts:4965`          |
|         21 | `normalizeTrack`                          | `src/schema/normalize.ts:482`            |
|         20 | `ProtvistaUniprot._reportSequenceFailure` | `src/protvista-uniprot.ts:3376`          |
|         20 | `variation`                               | `src/schema/adapters/variation.ts:82`    |
|         19 | `ProtvistaUniprot._renderGroupBlock`      | `src/protvista-uniprot.ts:4176`          |
|         17 | `ProtvistaUniprot._originOf`              | `src/protvista-uniprot.ts:3777`          |
|         17 | `ProtvistaUniprot._renderViewerNotes`     | `src/protvista-uniprot.ts:5485`          |
|         16 | `ProtvistaUniprot._setHeatmapData`        | `src/protvista-uniprot.ts:2347`          |
|         16 | `ProtvistaUniprot._describeFetchError`    | `src/protvista-uniprot.ts:3677`          |
|         16 | `ProtvistaUniprot.renderErrorPanel`       | `src/protvista-uniprot.ts:5135`          |
|         16 | `bed`                                     | `src/schema/adapters/bed.ts:81`          |
|         16 | `parseCieFunc`                            | `src/styles/color.ts:281`                |

The most complex playground functions are `loadFile` (26, `src/playground/index.ts:603`), the `visit` helper of `findLocalReferences` (20) and `localDataDiagnostics` (20), both in `src/playground/local-files.ts`.

## Interpretation

### Where complexity went down

- **Imperative tooltips replaced by data.** The six Q1 tooltip builders concatenated HTML by hand and embedded UniProt-specific lookup tables (audit items A9 and A10). They are gone, with 731 lines and 163 complexity points, including the second- and sixth-largest Q1 functions. The declarative resolver that replaced them (`src/tooltips/`, 242 points) is larger in total, because it serves any configuration rather than six fixed track types, but its largest function is 15 against 28.
- **Hardcoded config replaced by data.** The 912-line `src/config.ts`, which defined every group, track and EBI URL in TypeScript (audit item A2), is now a 22-line re-export. The default configuration is `src/default-config.yaml` (524 lines), validated against the published JSON schema. The complexity metric gives no credit for this, because the old file had no functions; the gain is that changing a track is now an edit to data, not to code.
- **Q1 hotspots.** Of the 10 Q1 functions over 10, four were removed, `getTrack` fell from 31 to 5, and the `_loadDataInComponents` callback from 20 to 11. The structure viewer's `connectedCallback` (24) now only calls `load()`, which has 22: the work moved rather than shrank.
- **The worst functions on `next` are smaller than the worst in Q1.** The maximum is 24 (Q1: 31), after PR #407 (below).

### Where complexity went up

- **The host element.** `src/protvista-uniprot.ts` is nearly eight times its Q1 length and has nearly six times the complexity. It took on the error and notice interface, customize mode and configuration wiring as private methods of one class, instead of delegating them to modules the way `src/errors/` and `src/layout.ts` already do. It holds 28% of the library's complexity, 18 of the 53 functions over 10 and 2 of the 6 over 20.
- **Configuration handling.** Validation, normalisation and loading of configurations are new and necessarily branchy: each authoring check that produces a clear error message is a decision point. `src/schema/validate.ts` (310) is the largest file by total complexity, and `src/schema/normalize.ts` has two of the six functions over 20.
- **Per-function figures are a little worse than in Q1.** The mean rose from 2.72 to 3.07 and the share of functions over 10 from 3.3% to 4.2%. ESLint scores every `?.`, `??` and default parameter as a branch, and with `strictNullChecks` off in `tsconfig.json` the compiler cannot show which of these defensive checks are needed.

Total complexity could not have stayed flat while delivering a config schema and validator, bring-your-own-data file formats, user-facing error reporting and customize mode. What could have been avoided is the concentration in the host element. The follow-ups below address it.

## Effect of PR #407

PR #407 (`complexity-improvements`) split the largest functions into smaller, separately tested helpers. Measured on its first parent `17a2ea0` and on the merge `09f1832`:

| Library                               | `17a2ea0` | `09f1832` |
| ------------------------------------- | --------: | --------: |
| Total complexity                      |     3,839 |     3,843 |
| Functions                             |     1,186 |     1,250 |
| Mean                                  |      3.24 |      3.07 |
| Maximum                               |        46 |        24 |
| Functions over 10                     |        65 |        53 |
| Functions over 20                     |        17 |         6 |
| `src/protvista-uniprot.ts` lines      |     6,348 |     6,076 |
| `src/protvista-uniprot.ts` complexity |     1,169 |     1,087 |

It brought 11 functions from over 20 to 10 or below: `featuresJson` 46 → 5, `_collectTrackErrors` 40 → 5, `updated` 34 → 7, `getTrack` 34 → 5, the per-track loader callback in `loadProtvistaData` 33 → 8, `checkKindReadsFileFormat` 31 → 6, `_loadData` 30 → 9, `rowsToFeatureRecords` 29 → 8, `_report` 27 → 10, `checkTrack` 27 → 7 and `decodeLayout` 23 → 5. The total did not fall because the branching moved into new helpers and modules (`src/errors/track-outcomes.ts` +43, `src/errors/notices.ts` +30, `src/schema/adapters/feature-fields.ts` +29, `src/renderer/track-template.ts` +13, `src/schema/validate.ts` +11) rather than being deleted. The gain is that no single function is as hard to read or test as before.

## Follow-ups

In order of the share of complexity they address:

1. **Split `src/protvista-uniprot.ts`.** Move the error and notice interface (`_reportSequenceFailure` 20, `_originOf` 17, `_renderViewerNotes` 17, `_describeFetchError` 16, `renderErrorPanel` 16), customize mode and configuration wiring (`_init` 21) into Lit reactive controllers or plain modules, and the row and group rendering (`render` 21, `_renderGroupBlock` 19) into `src/renderer/`. This will not lower the total but will turn one 6,076-line file into reviewable units.
2. **Stage `loadProtvistaData`** (24, `src/load-data.ts`) as explicit steps: substitute variables, fetch, decode, filter, resolve tooltips, assign.
3. **Break up `expandDescriptor` (23) and `normalizeTrack` (21)** in `src/schema/normalize.ts`, for example as an ordered list of precedence rules.
4. **Split the structure viewer's `load`** (22): URL resolution, AlphaFold isoform matching and result assembly. This finishes the Q1 `connectedCallback` hotspot.
5. **Simplify the file decoders.** Give the `variation` adapter (20, `src/schema/adapters/variation.ts`) one check function per field, and let the `bed` (16) and `linegraph` (15) decoders reuse `checkSpan` and the other helpers in `src/schema/adapters/feature-fields.ts`, as `features-json.ts` and `dsv.ts` do since PR #407.
6. **Finish the remaining Q1 hotspots:** structure `render` (15), `process3DBeaconsData` (13), datatable `willUpdate` (11) and the `_loadDataInComponents` callback (11).
7. **Stop new hotspots appearing.** Add the `complexity` rule to `eslint.config.mjs` for production files with a threshold of 20, suppress the existing offenders with ESLint's bulk suppressions, and lower the threshold as they are fixed. Re-run `pnpm metrics:complexity` for the Q4 and final reports and keep the output with the report.
8. **Turn on `strictNullChecks`** (Year 2), then remove the optional chaining and nullish fallbacks the compiler shows are not needed. This is the only follow-up likely to lower the total rather than move it.
