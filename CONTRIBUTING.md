# Contributing to ProtVista

Thank you for your interest in contributing to ProtVista! This document provides guidelines for contributing to the project.

ProtVista is maintained as open-source research software and is part of an ongoing sustainability effort supported through the Research Software Maintenance Fund (RSMF).

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

All repository interactions and project events are expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting Started

### Prerequisites

- Node.js (version specified in `.nvmrc` or `package.json`)
- Yarn v1

### Development Setup

1. Create a fork and clone it to your local machine:

   ```bash
   git clone https://github.com/YOUR-USERNAME/protvista.git
   cd protvista
   ```

2. Install dependencies:

   ```bash
   yarn install
   ```

3. Run the development server (serves the demo at a local URL):

   ```bash
   yarn start
   ```

4. Run the tests:

   ```bash
   yarn test
   ```

## Architecture Overview

ProtVista is **config-driven**. The viewer is a single custom element,
`<protvista-uniprot>`, driven by a declarative configuration document. Authors
write against a schema of high-level domain concepts (`kind: features`,
`kind: variants`, `kind: confidence-score`, …) and never name Nightingale
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
the same page. It seeds all built-ins at construction.

The validator uses the registry to close the open-string unions in the schema
(an unknown adapter fails validation with a stable, greppable message), and the
loader uses it to resolve a semantic kind into the concrete component + adapter
to mount.

**Extending the registry.** Consumers extend it at runtime through the
escape-hatch API exposed on the element (`ProtvistaRuntimeAPI`):
`registerAdapter`, `registerSemanticKind`, `registerTheme`, and
`registerComponent`. Registering a name twice throws a `RegistryCollisionError`,
so behaviour never depends on call order. The one deliberate exception is
built-in **adapters**: because an adapter names a *data format* rather than a
viewer behaviour, an adopter whose CSV has a different column layout may
register over a built-in adapter name exactly once.

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

### Branch Naming

- `feature/description` - for new features
- `fix/description` - for bug fixes
- `docs/description` - for documentation updates
- `refactor/description` - for internal improvements

### Development Workflow

1. Create a new branch from `main`.
2. Make your changes.
3. Write/update tests as needed.
4. Ensure all tests pass: `yarn test`.
5. Update documentation if applicable.
6. Commit your changes with clear, descriptive messages.

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
bundling a duplicate, while exact devDeps plus the committed `yarn.lock`
keep CI and local builds reproducible. Don't "fix" the inconsistency by
pinning runtime deps exact — that reintroduces duplicate copies in consumer
bundles. The lockfile is the source of truth for the exact versions.

### Commit Messages

- Use present tense ("Add feature" not "Added feature").
- Be descriptive but concise.
- Reference issues when applicable (e.g., "Fix #123").

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a PR against the `main` branch.
3. Fill out the PR template completely.
4. Link any related issues.
5. Address review feedback.

### PR Checklist

Before submitting, ensure:

- Code follows the project's style guidelines
- Tests pass locally
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

```bash
yarn test          # Full pipeline: lint + types + unit + browser
yarn test:unit     # Unit tests only (CI-friendly, jsdom)
yarn test:browser  # Browser component tests only
yarn test:watch    # Watch mode
yarn test:coverage # Run both test projects and write coverage to ./coverage/
```

### Writing Tests

- Write unit tests for new components/functions and, for schema work, cover each
  pipeline stage (parse, extends, validate, normalize) and both registry paths
  (built-ins and `register*` extension) independently.
- Include browser/visual tests for UI changes when possible.
- Test edge cases and error conditions — especially the stable validator error
  messages, which adopters depend on.
- Aim to maintain or improve code coverage. CI enforces a coverage floor (a
  ratchet, #162) via `test.coverage.thresholds` in `vite.config.mjs`; the
  `yarn test:coverage` step fails any PR that drops below it. When your change
  raises coverage, bump the thresholds up in the same PR so the floor ratchets
  upward. Only lower them with a justification.

## Code Style

- ESLint and Prettier are used for formatting (automated in CI).
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

Use the GitHub issue tracker and apply the appropriate labels.

## Requesting Features

For feature requests:

- Check if it already exists in the issues.
- Describe the use case and expected behavior.
- Explain why this would be valuable.
- Be open to discussion about implementation.

## Questions?

If you have questions or need help:

- Check existing issues and discussions.
- Open a new issue with the `question` label.
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
| 2026-06-26 | 15.30 - 16.30 | Planned     |
| 2026-07-31 | 10.30 - 11.30 | Planned     |
| 2026-08-28 | 15.30 - 16.30 | Planned     |
| 2026-09-25 | 10.30 - 11.30 | Planned     |
| 2026-10-30 | 15.30 - 16.30 | Planned     |
| 2026-11-27 | 10.30 - 11.30 | Planned     |
| 2026-12-18 | 15.30 - 16.30 | Planned     |
| 2027-01-29 | 10.30 - 11.30 | Planned     |

**Join via Zoom:**  
https://embl-org.zoom.us/j/95322862166?pwd=czx0CdN5eEsm6WltXVIQ7YdybaFkhM.1

No registration required — just join the call.

If you cannot attend, post questions in advance via Issues or Discussions.

Everyone is welcome, whether you're a first-time contributor or a regular collaborator.

## Licensing

ProtVista software is licensed under the MIT License.

Documentation and other written materials are licensed under Creative Commons Attribution 4.0 (CC BY 4.0), unless otherwise stated.

By contributing, you agree that your contributions will be licensed under the same licence as the relevant part of the project.

## Citation

If you use ProtVista in research outputs, please cite the project using the latest release DOI (see the repository README for citation instructions).

Thank you for contributing to ProtVista! 🎉
