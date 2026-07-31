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

3. Run the development server:

   ```bash
   yarn start
   ```

4. Run tests:

   ```bash
   yarn test
   ```

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

### Running Tests

```bash
yarn test          # Run all tests
yarn test:watch    # Run tests in watch mode
yarn test:coverage # Generate coverage report
```

### Writing Tests

- Write unit tests for new components/functions.
- Include visual regression tests for UI changes when possible.
- Test edge cases and error conditions.
- Aim to maintain or improve code coverage.

## Hooks and feedback loop

The repository ships local git hooks that mirror the checks CI runs, so failures show up before you push rather than after. The hooks install automatically when you run `yarn install` (via the `prepare` script in `package.json`); no separate setup step is required.

There are three tiers, ordered from fast to thorough:

| Tier       | When it runs       | What it does                                                                                           |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Pre-commit | Every `git commit` | `lint-staged` — ESLint `--fix` and Prettier `--write` on staged files only. Sub-second on small diffs. |
| Pre-push   | Every `git push`   | `yarn test` — lint, type check, and unit tests across the whole tree. The same checks CI runs.         |
| CI         | Every push and PR  | The pre-push checks plus a coverage threshold check (`yarn test:coverage`).                            |

The hooks are not gatekeepers — CI is. If a hook is incorrectly blocking a legitimate push (mid-rebase, work-in-progress on a side branch, etc.), use `git push --no-verify` to bypass. CI will still run the full set when the change reaches a PR.

If a hook is gating a legitimate change for an unclear reason, run the underlying command directly to see the full output: `yarn lint-staged` for pre-commit, `yarn test` for pre-push. The hooks themselves are short shell scripts in `.husky/` — open them if you need to inspect what's running.

Coverage thresholds live in `vite.config.mjs` under `test.coverage.thresholds`. They follow a ratchet pattern: thresholds are seeded at the current baseline so coverage can only go up. If a refactor genuinely needs to drop coverage (e.g., removing tested code), update the thresholds in the same change.

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
| 2026-06-26 | 15.30 - 16.30 | ✅ Complete |
| 2026-07-31 | 10.30 - 11.30 | ✅ Complete |
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
