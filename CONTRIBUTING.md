# Contributing to ProtVista

Thank you for your interest in contributing to ProtVista! This document provides guidelines for contributing to the project.

ProtVista is maintained as open-source research software and is part of an ongoing sustainability effort supported through the Research Software Maintenance Fund (RSMF).

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

All repository interactions and project events are expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Which branch?

- **`main`** is the default branch and the v5 line. **All work starts from
  `main` and goes back into `main`.** The documentation site and the examples
  in this repository describe `main`.
- **`v4`** holds the 4.x line, which is frozen: it takes no changes.

## Getting Started

### Prerequisites

- **Git.** On Windows, [Git for Windows](https://git-scm.com/download/win)
  (which also gives you Git Bash).
- **Node.js 24**, the version in `.nvmrc` and the one CI uses. With
  [nvm](https://github.com/nvm-sh/nvm), `nvm install` and `nvm use` in the
  repository pick it up.
- **pnpm**, at the version pinned by the `packageManager` field in
  `package.json`. `corepack enable pnpm` installs exactly that version. If
  corepack fails with a signature or key error, update it with
  `npm install -g corepack@latest` and try again. Installing pnpm with
  `npm install -g pnpm` also works: pnpm switches itself to the pinned version.

#### On Windows

Every command in this guide works in PowerShell or Command Prompt. A few
Windows-specific notes:

- **Install Node 24** with the v24 Windows installer from
  [nodejs.org](https://nodejs.org/en/download), or with
  [nvm-windows](https://github.com/coreybutler/nvm-windows):
  `nvm install 24`, then `nvm use 24` (nvm-windows does not read `.nvmrc`).
  Check that `node --version` prints `v24`.
- **pnpm:** run `corepack enable pnpm` from a terminal opened with **Run as
  administrator**, or skip corepack and run `npm install -g pnpm`.
- **"Running scripts is disabled on this system"** in PowerShell: run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then reopen the
  terminal.
- **Clone to a short path outside OneDrive**, such as `C:\dev\protvista`.
  OneDrive syncing `node_modules` is slow and can lock files mid-install.
- **One command per line.** Windows PowerShell 5.1 (the default
  `powershell.exe`) does not understand `&&`, so this guide puts each command
  on its own line.
- **Line endings are handled for you.** `.gitattributes` checks every text file
  out with LF endings, whatever your Git `core.autocrlf` setting, so the tests
  that compare files byte for byte pass on Windows too. If your editor asks,
  keep LF (`.editorconfig` tells most editors to). **Cloned before
  7 October 2026?** Your files may still have Windows line endings: delete the
  clone and clone again.
- **package.json scripts run the same as on macOS and Linux:** pnpm runs them
  in its own POSIX-style shell (`shellEmulator` in `pnpm-workspace.yaml`). The
  exceptions are the maintainer-only `./scripts/*.sh` tools (`pnpm validate`,
  `pnpm release`, `pnpm cdn:clear`): run them from Git Bash or WSL as
  `bash scripts/<name>.sh`.
- WSL2 also works. Clone inside the Linux file system (`~/…`), not under
  `/mnt/c`, and follow the Linux instructions.

## Contributing via a fork

You don't need write access to the repository: fork it, work in your fork, and
open a pull request back.

1. **Fork.** On
   [github.com/ebi-webcomponents/protvista](https://github.com/ebi-webcomponents/protvista),
   click **Fork**. Leaving "Copy the `main` branch only" ticked is fine.

2. **Clone your fork, and add the original repository as `upstream`:**

   ```bash
   git clone https://github.com/YOUR-USERNAME/protvista.git
   cd protvista
   git remote add upstream https://github.com/ebi-webcomponents/protvista.git
   git fetch upstream
   ```

   **Forked before the 5.0.0 release (November 2026)?** Your fork's `main` is
   the old 4.x line and its `next` is the old v5 line. Work from
   `upstream/main` as below, and don't merge your fork's old `main` into
   anything.

3. **Set up and check that everything works** (see
   [Development setup](#development-setup)):

   ```bash
   pnpm install
   pnpm exec playwright install chromium
   pnpm test:unit
   ```

4. **Make a branch for each change, from the latest `upstream/main`.** Name it
   after the issue, e.g. `issue-305-alphamissense-csv`:

   ```bash
   git fetch upstream
   git switch -c issue-305-alphamissense-csv upstream/main
   ```

   Don't commit to your fork's `main`; keep it as a plain copy of upstream.

5. **Commit, then push the branch to your fork:**

   ```bash
   git push -u origin issue-305-alphamissense-csv
   ```

6. **Open the pull request against `main`.** GitHub offers a *Compare & pull
   request* button after the push. On the form, check that it says **base
   repository: `ebi-webcomponents/protvista`** and **base: `main`**. Fill in
   the template, link the issue
   (`Fixes #305`), and leave **Allow edits by maintainers** ticked.

7. **Your first PR may show "Approval required".** GitHub can hold a
   first-time contributor's workflows until a maintainer approves them; if
   yours are held, the checks start once one of us approves. Run the tests
   locally in the meantime.

8. **Keep the PR up to date** when `main` moves on:

   ```bash
   git fetch upstream
   git rebase upstream/main
   git push --force-with-lease
   ```

   (Merging `upstream/main` into your branch instead is fine too.) If
   `CHANGELOG.md` conflicts, keep both entries.

### Development setup

From the root of your clone:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test:unit
pnpm start
```

- `pnpm install` installs dependencies from the lockfile.
- `pnpm exec playwright install chromium` downloads the headless Chromium the
  browser tests run in. Run it once, and again whenever the `playwright`
  version in `package.json` changes. On Linux add `--with-deps` to pull in the
  system libraries it needs. See
  [Browser tests need a Playwright browser](#browser-tests-need-a-playwright-browser).
- `pnpm test:unit` runs the unit tests: the quickest way to confirm your setup
  works. `pnpm test` runs everything (lint, types, unit and browser tests).
- `pnpm start` starts the docs site with the playground at
  <http://localhost:4321/protvista/> and
  <http://localhost:4321/protvista/playground/>, reloading as you edit.

## Hackathon participants

Welcome! For the ProtVista hackathon (7–9 October 2026):

- **Use `main`.** Fork and branch as described in
  [Contributing via a fork](#contributing-via-a-fork), and open pull requests
  against `main`.
- **Pick an issue.** Issues labelled
  [`good first issue`](https://github.com/ebi-webcomponents/protvista/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  are sized for the event and say which files to look at. Comment on the issue
  to say you are taking it, so two teams don't work on the same one.
- **No coding needed for some projects.** You can bring your own data with the
  [Starter Kit](https://github.com/ebi-webcomponents/protvista-starter-kit) or
  the [playground](https://ebi-webcomponents.github.io/protvista/playground/),
  and documentation fixes are contributions too. If something in the docs
  confused you, that's worth an issue or a PR.
- **Start with `pnpm test:unit`.** It is quick and needs no browser.
- **Adding a new kind of track?** Add it as a built-in renderer
  (`RENDERABLE_COMPONENTS` in `src/built-in-components.ts` plus a case in
  `getTrack()`), not through `registerComponent`: components registered at
  runtime are not drawn yet (see [the registry](#the-registry)).
- **CI checks coverage.** A PR that lowers test coverage below the floor fails
  CI. If you're unsure how to test your change, ask a mentor to pair with you.
- **Your first PR's checks may wait for approval** (see step 7 above); a mentor
  will approve them.
- **Getting help:** ask in the hackathon's chat or help-desk channel. After the
  event, use [office hours](#office-hours) or open an issue.
- The [Code of Conduct](./CODE_OF_CONDUCT.md) applies to the event and to the
  repository.

## Architecture Overview

ProtVista is **config-driven**. The viewer is a single custom element,
`<protvista-uniprot>`, driven by a declarative configuration document. Authors
write against a schema of high-level domain concepts (`kind: features`,
`kind: variants`, `kind: alphafold-confidence`, …) and never name Nightingale
components or data adapters directly. The runtime resolves those concepts into
concrete components and adapters for them.

Understanding two pieces — the **registry** and the **config pipeline** — is
enough to contribute to most of the codebase. Both live under
[`src/schema/`](./src/schema).

> The normative schema reference (every config field, with worked examples and
> edge-case semantics) is [`specs/config-approach.md`](./specs/config-approach.md).
> A higher-level design walkthrough lives in
> [`docs/architecture.md`](./docs/architecture.md). This section is a
> contributor's map, not a substitute for either.

### The registry

The registry ([`src/schema/registry.ts`](./src/schema/registry.ts)) is the
single source of truth for every name a config can reference. It has four
buckets:

| Bucket             | What it maps                                  | Built-ins defined in                       |
| ------------------ | --------------------------------------------- | ------------------------------------------ |
| **Semantic kinds** | `kind` → `(component, adapter, rendering)`    | `registry.ts` (`BUILTIN_SEMANTIC_KINDS`)   |
| **Adapters**       | adapter name → `AdapterFunction`              | [`src/schema/adapters`](./src/schema/adapters) (`BUILTIN_ADAPTERS`) |
| **Themes**         | theme name → colour-scale `ColorStop[]`       | `registry.ts` (`BUILTIN_THEMES`)           |
| **Components**     | tag name → custom-element constructor         | [`src/built-in-components.ts`](./src/built-in-components.ts) |

`createRegistry()` is a factory, not a module singleton — each viewer instance
holds its own registry, so custom registrations never leak between viewers on
the same page. It seeds the built-in kinds, adapters and themes at
construction; the element seeds the built-in components into its registry
through `registerBuiltinComponents()` in `src/built-in-components.ts`.

The validator uses the registry to close the open-string unions in the schema
(an unknown adapter fails validation with a stable, greppable message), and the
loader uses it to resolve a semantic kind into the concrete component + adapter
to mount.

**Extending the registry.** Consumers extend it at runtime through the
escape-hatch API exposed on the element (`ProtvistaRuntimeAPI`):
`registerAdapter`, `registerSemanticKind`, `registerTheme`, and
`registerComponent`. Registering a name twice throws a `RegistryCollisionError`,
so behaviour never depends on call order. The one deliberate exception is
built-in **adapters**: because an adapter names a *data source* rather than a
viewer behaviour, an adopter reading a different feed may register over a
built-in adapter name (such as `uniprot-features-json`) exactly once.

One limitation: a component added with `registerComponent` is defined and
validated but **not yet drawn**. Its track stays empty and the viewer reports
an `unrendered-component` warning, because `getTrack()` only renders the
built-in components. To add a new kind of track renderer, add it as a built-in
(below) rather than registering it at runtime.

To add a **new built-in**, add an entry to the relevant table
(`BUILTIN_SEMANTIC_KINDS` / `BUILTIN_THEMES` in `registry.ts`,
`BUILTIN_ADAPTERS` in `src/schema/adapters`, or `RENDERABLE_COMPONENTS` in
`src/built-in-components.ts`) — the factory wiring needs no change.

### The config pipeline

`loadConfig()` ([`src/schema/load.ts`](./src/schema/load.ts)) orchestrates the
stages that turn author input (a JSON string, a YAML string, or an
already-parsed object) into the `NormalizedConfig` shape the element mounts
directly:

```
author input → parse → extends → validate → normalize
```

| Stage         | Module                                     | Responsibility                                                                 |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| **parse**     | [`parse.ts`](./src/schema/parse.ts)        | JSON/YAML → plain JS value. Format is auto-detected from content; `js-yaml` is lazy-loaded so JSON-only adopters never download it. |
| **extends**   | [`extends.ts`](./src/schema/extends.ts)    | Resolve and merge an `extends` chain (`sources`, `defaults`, `theme`, `rows`, `tracks`, `rendering`), child-wins. |
| **validate**  | [`validate.ts`](./src/schema/validate.ts)  | Structural pass (Ajv against `schema.json`, draft 2020-12) then a semantic pass (closed-set checks against the registry). Returns issues; never throws. |
| **normalize** | [`normalize.ts`](./src/schema/normalize.ts)| Expand shorthands, resolve semantic kinds via the registry, cascade rendering inheritance, apply id→label fallbacks, detect duplicate ids. |

Each stage is a standalone module so editor tooling, linters, and CI can run
the validator without paying for the YAML parser or committing to the normalize
step. When touching a stage, keep this separation intact and preserve the stable
error messages (adopters grep their logs for strings like `"Unknown adapter"`).

## Making Changes

### Branch naming

Name a branch after what it does, in kebab-case. When there is an issue, lead
with its number: `issue-305-alphamissense-csv`, `issue-322-events-page`.
Otherwise a short description is fine: `error-badge-popover`,
`playground-fasta-file`.

### Development Workflow

1. Create a new branch from `upstream/main` (see
   [Contributing via a fork](#contributing-via-a-fork)).
2. Make your changes.
3. Write/update tests as needed.
4. Run the tests: `pnpm test:unit` while you work, and the full `pnpm test`
   (or `pnpm test:coverage`, which is what CI gates on) before you push.
5. Update documentation if applicable.
6. Add an entry to `CHANGELOG.md` (see [Changelog](#changelog)).
7. Commit your changes with clear, descriptive messages.

### Import extensions

Relative imports in `src` carry the **emitted** extension:

```ts
import { fetchAll } from './utils/index.js'; // not './utils'
import ProtvistaUniprot from './protvista-uniprot.js'; // not './protvista-uniprot'
```

`.js` is correct even though the file is `.ts` — it names the file the
declaration will point at. `vite-plugin-dts` copies specifiers into the
emitted `.d.ts` verbatim, and an extensionless one does not resolve for
consumers using Node's ESM rules (`moduleResolution: "node16"`/`"nodenext"`),
which silently degrades their types.

The rule is about emitted declarations, so it applies to `src` only —
`docs/` and `bench/` are not published and need not follow it.

`moduleResolution` here is `"bundler"`, which tolerates both forms, so the
compiler will not catch a missing extension — `src/__spec__/package-contract.spec.ts`
does. Switching to `"NodeNext"` to enforce it at compile time is not
currently possible: several `@nightingale-elements` packages declare
`"type": "module"` while using extensionless relative imports in their own
`.d.ts`, so their type exports disappear under Node ESM resolution.

### Dependency versions

Runtime `dependencies` use caret ranges (`^1.2.3`); `devDependencies` are
pinned to exact versions. The asymmetry is deliberate: caret ranges let a
consumer's package manager dedupe our runtime deps (`lit`, `ajv`, the
`@nightingale-elements/*` packages) against their own copy instead of
bundling a duplicate, while exact devDeps plus the committed `pnpm-lock.yaml`
keep CI and local builds reproducible. Don't "fix" the inconsistency by
pinning runtime deps exact — that reintroduces duplicate copies in consumer
bundles. The lockfile is the source of truth for the exact versions.

### Generated files

A few committed files are generated from the code, and a spec fails if they
drift. If you change the source, regenerate and commit the result:

| If you changed… | Run | Which regenerates |
| --- | --- | --- |
| `src/schema/schema.json` | `pnpm schema:sync` | `public/schema/v1/config.schema.json` |
| `src/schema/adapters/adapter-reference.ts`, `src/schema/adapters/render-adapter-reference.ts` or a built-in adapter | `pnpm adapters:sync` | `docs/src/content/docs/adapter-reference.md` and `public/schema/v1/feature-record.schema.json` |
| The feature type or shape vocabulary (`src/schema/feature-vocabulary.ts`, `src/schema/render-feature-vocabulary.ts`, or a Nightingale upgrade) | `pnpm vocabulary:sync` | `docs/src/content/docs/type-and-shape-vocabulary.md` |

The failing spec names the command to run.

### Changelog

Add an entry for any change a user of the viewer or a config author would
notice, under `## Unreleased` at the top of `CHANGELOG.md`. Follow the existing
entries: a `### Added: …`, `### Changed: …` or `### Fixed: …` heading that
says what changed in plain words, then a short paragraph. Internal refactors
and test-only changes don't need one.

### Commit Messages

- Use present tense ("Add feature" not "Added feature").
- Be descriptive but concise.
- Reference issues when applicable (e.g., "Fix #123").

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a PR against **`ebi-webcomponents/protvista`, base `main`**.
3. Fill out the PR template completely.
4. Link any related issues (`Fixes #123`).
5. Address review feedback.

On a first PR from a fork, the checks wait for a maintainer to approve the
workflow run (GitHub's rule for first-time contributors). That's expected.

### PR Checklist

Before submitting, ensure:

- The PR targets `main`
- Code follows the project's style guidelines
- Tests pass locally
- `CHANGELOG.md` has an entry under `## Unreleased`, if users would notice the change
- New tests added for new functionality (where appropriate)
- Documentation updated if needed
- No console errors or warnings
- Screenshots included for visual changes

## Testing

Tests run under [Vitest](https://vitest.dev/), split into two projects: a
`unit` project (`jsdom` DOM environment) and a `browser` project (real-browser
component tests). Vitest globals are off — import `describe`, `it`, `expect`,
`vi`, … explicitly from `'vitest'`.

### Running Tests

| Command | What it runs |
| --- | --- |
| `pnpm test` | Full pipeline: lint + types + unit + browser |
| `pnpm test:unit` | Unit tests only (jsdom; no browser needed) |
| `pnpm test:browser` | Browser component tests only |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Both test projects, with coverage written to `./coverage/`; this is the gate CI enforces |

To run one spec file, pass its path:
`pnpm exec vitest run --project unit src/schema/__spec__/validate.spec.ts`.

### Browser tests need a Playwright browser

The `browser` project (`pnpm test:browser`, and therefore `pnpm test` and
`pnpm test:coverage`) runs in a real headless Chromium driven by
[Playwright](https://playwright.dev/). `pnpm install` fetches the Playwright
*library* but not the browser binary, so run this once after cloning:

```bash
pnpm exec playwright install chromium
```

Every Playwright release pins a new Chromium build, so **re-run it whenever the
`playwright` version in `package.json` changes** (e.g. after pulling a
dependency bump). The symptom of a missing or stale binary is
`pnpm test:browser` failing at startup with:

```
Error: browserType.launch: Executable doesn't exist at …/ms-playwright/chromium_headless_shell-NNNN/…
Looks like Playwright was just installed or updated.
```

`chromium` is sufficient — the tests only use Chromium's headless shell. Plain
`pnpm exec playwright install` also works but downloads Firefox and WebKit too.
CI does this itself (`.github/workflows/test-and-deploy.yml`, with
`--with-deps` to pull in the Linux system libraries), so no `postinstall` hook
is needed and none is configured.

### Writing Tests

- Write unit tests for new components/functions and, for schema work, cover each
  pipeline stage (parse, extends, validate, normalize) and both registry paths
  (built-ins and `register*` extension) independently.
- Include browser/visual tests for UI changes when possible.
- Test edge cases and error conditions — especially the stable validator error
  messages, which adopters depend on.
- Aim to maintain or improve code coverage. CI enforces a coverage floor (a
  ratchet, #162) via `test.coverage.thresholds` in `vite.config.mjs`; the
  `pnpm test:coverage` step fails any PR that drops below it. When your change
  raises coverage, bump the thresholds up in the same PR so the floor ratchets
  upward. Only lower them with a justification.

## Code Style

- ESLint runs in CI (`pnpm test:lint`). Prettier is not checked in CI, but
  please format the files you touch with it: `pnpm exec prettier --write
  <files>` (the settings are in `.prettierrc`).
- Follow TypeScript best practices.
- Write clear, self-documenting code.
- Add JSDoc comments for public APIs where appropriate.

## Reporting Bugs

When reporting bugs, please include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Browser/environment details
- Screenshots or recordings if applicable

Use the [GitHub issue tracker](https://github.com/ebi-webcomponents/protvista/issues/new/choose);
the issue forms ask for these details and add a label for you.

## Requesting Features

For feature requests:

- Check if it already exists in the issues.
- Describe the use case and expected behavior.
- Explain why this would be valuable.
- Be open to discussion about implementation.

## Questions?

If you have questions or need help:

- Check existing issues.
- Open a new issue and say it is a question.
- Reach out to the maintainers.
- Attend our monthly office hours (details below).

## Office Hours

We host monthly virtual office hours to:

- Answer questions about contributing
- Help with development setup
- Discuss roadmap and sustainability planning
- Provide guidance on pull requests and reviews

Note that office hours are not recorded.

### Provisional Schedule (GMT/BST)

| Date       | Time          | Status      |
| ---------- | ------------- | ----------- |
| 2026-02-27 | 15.30 - 16.30 | ✅ Complete |
| 2026-03-27 | 10.30 - 11.30 | ✅ Complete |
| 2026-04-24 | 15.30 - 16.30 | ✅ Complete |
| 2026-05-29 | 10.30 - 11.30 | ✅ Complete |
| 2026-06-26 | 15.30 - 16.30 | ✅ Complete |
| 2026-07-31 | 10.30 - 11.30 | ✅ Complete |
| 2026-08-28 | 15.30 - 16.30 | ✅ Complete |
| 2026-09-25 | 10.30 - 11.30 | ✅ Complete |
| 2026-10-30 | 15.30 - 16.30 | Planned     |
| 2026-11-27 | 10.30 - 11.30 | Planned     |
| 2026-12-18 | 15.30 - 16.30 | Planned     |
| 2027-01-29 | 10.30 - 11.30 | Planned     |

**Join via Zoom:**  
https://embl-org.zoom.us/j/95322862166?pwd=czx0CdN5eEsm6WltXVIQ7YdybaFkhM.1

No registration required — just join the call.

If you cannot attend, post questions in advance as an issue.

Everyone is welcome, whether you're a first-time contributor or a regular collaborator.

## Licensing

ProtVista software is licensed under the MIT License.

Documentation and other written materials are licensed under Creative Commons Attribution 4.0 (CC BY 4.0), unless otherwise stated.

By contributing, you agree that your contributions will be licensed under the same licence as the relevant part of the project.

## Citation

If you use ProtVista in research outputs, please cite it as described in the [README](./README.md#citation) (also available from GitHub's **Cite this repository** button, via `CITATION.cff`).

Thank you for contributing to ProtVista! 🎉
