# Releasing

ProtVista ships from two branches, and their release processes are **not** the same — read the table before you publish.

- **`main`** — the stable 4.x line. Publishes to the npm **`latest`** dist-tag (the default `npm install protvista-uniprot`), so every existing user gets it. Higher stakes; test thoroughly.
- **`next`** — the v5 line. Publishes to the **`beta`** dist-tag (opt-in via `@beta`); `latest` stays on 4.x.

Publish from a machine with npm auth (`npm login`) — the sandbox/CI GitHub credentials do **not** cover npm. Always use **`npm publish`**, never `pnpm publish`: pnpm applies its own git checks and republish rules on top of npm's, and `test:pack` already packs with npm (`--pack npm`), so publishing with npm keeps the tarball that was validated identical to the one that ships.

## Differences at a glance

| | `main` (4.x) | `next` (v5 beta) |
| --- | --- | --- |
| npm dist-tag | `latest` | `beta` (`publishConfig.tag`) |
| Version | `4.9.x` semver | `5.0.0-beta.N` |
| Package manager | **yarn** (`yarn.lock`) | **pnpm** (`packageManager`) |
| Build on publish | **manual** — `yarn build` first (no `prepack`) | automatic (`prepack: pnpm build`) |
| Pre-publish gate | **none** — run `yarn test` yourself | `prepublishOnly: pnpm test:pack` |
| Files to bump | `package.json` only | `package.json` **+** the version pins (see below) |
| GitHub release | optional | cut `vX.Y.Z-beta.N` — fires `publish-starter-kit.yml` |
| Funding acknowledgement in the release notes | check it yourself (below) | checked by `pnpm release:next` |
| Stakes | high — the default install | low — opt-in testers |

## Funding acknowledgement

The grant's Outputs Management Plan (section 7) requires every output to carry
this acknowledgement, word for word. Every GitHub release counts, on either
branch:

> This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.

Start the release notes from
[`scripts/release-notes-template.md`](./scripts/release-notes-template.md),
which ends with a **Funding** section holding the text, and keep that section
as it is. `pnpm release:next` refuses notes that lack it. A line break inside
the sentence is fine; any other change is not.
`src/__spec__/funding-acknowledgement.spec.ts` fails if the template, the
release script, this file, the README, the docs site footer or any other copy
drifts from the text above. The npm package page shows the README, which
carries it on both branches under **Funding**.

## Releasing `main` (stable 4.x → `latest`)

```bash
git checkout main && git pull
npm login                                   # if not already authed
rm -rf node_modules dist && yarn install --frozen-lockfile
yarn test                                   # no publish gate on main — run it yourself
npm version patch                           # e.g. 4.9.3 -> 4.9.4; commits + tags v4.9.4
yarn build                                  # REQUIRED — main has no prepack
npm publish --dry-run                       # inspect the tarball (safe on main — no re-pack lifecycle)
npm publish                                 # -> latest (main has no publishConfig.tag)
npm dist-tag ls protvista-uniprot           # expect latest: 4.9.4
git push --follow-tags                      # push the bump commit + the tag
```

Use `npm version minor` instead of `patch` if the release includes a feature. Cutting a GitHub release for the tag is optional (4.x historically didn't).

If you do cut one, nothing on `main` checks its notes, so check them yourself. `main` has no copy of the template: take it from `next`, write the notes, confirm the acknowledgement is there, then create the release:

```bash
git fetch origin next
git show origin/next:scripts/release-notes-template.md > RELEASE_NOTES.md   # then write the notes
tr -s '[:space:]' ' ' < RELEASE_NOTES.md \
  | grep -qF 'This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.' \
  && echo 'acknowledgement present' || echo 'MISSING: add the Funding section'
gh release create v4.9.4 --verify-tag --title v4.9.4 --notes-file RELEASE_NOTES.md
rm RELEASE_NOTES.md                         # main does not git-ignore it; never commit it
```

## Releasing `next` (v5 beta → `beta`)

Write `RELEASE_NOTES.md` (git-ignored) from
[`scripts/release-notes-template.md`](./scripts/release-notes-template.md),
keeping its **Funding** section, then run:

```bash
git checkout next && git pull
pnpm release:next                  # 5.0.0-beta.N -> 5.0.0-beta.N+1, or pass a version
```

`scripts/release-next.sh` does every step below. It checks the branch, the
working tree, the release notes and your npm and GitHub logins first. If
`RELEASE_NOTES.md` is missing it copies the template there and stops; it also
stops if the notes are still the unedited template or lack the funding
acknowledgement. It then
bumps and repins, dates the CHANGELOG's `## Unreleased` heading, runs
`pnpm test && pnpm validate` and commits `Release <version>`. Nothing leaves
your machine until it asks you to confirm the publish. `--prepare-only` stops
after the commit. If a publish step fails, fix the cause and run it again: it
resumes from the release commit and skips whatever already happened.

The manual steps, for reference:

```bash
git checkout next && git pull
# 1. Bump package.json version, then repin every jsDelivr @version reference:
#      starter-kit/index.html, starter-kit/README.md,
#      starter-kit/recipes/extend-uniprot.yaml,
#      docs/src/content/docs/{tutorial,embed,configure}.md
#    and the banner version strings in README.md + starter-kit notices.
# 2. Write RELEASE_NOTES.md from scripts/release-notes-template.md, keeping
#    its Funding section (see "Funding acknowledgement" above).
pnpm test && pnpm validate                  # the pin specs fail loudly on any missed reference
npm publish                                 # prepack builds; prepublishOnly runs test:pack; -> beta
npm dist-tag ls protvista-uniprot           # beta: 5.0.0-beta.N, latest: 4.9.x
git commit -am "Release X.Y.Z-beta.N" && git push
git tag vX.Y.Z-beta.N && git push origin vX.Y.Z-beta.N
gh release create vX.Y.Z-beta.N --verify-tag --prerelease --title vX.Y.Z-beta.N --notes-file RELEASE_NOTES.md
```

Notes for `next`:

- **Do not use `npm publish --dry-run` here.** It exports `npm_config_dry_run`, which leaks into the `npm pack` that `attw` runs inside `prepublishOnly` and makes it fail on a missing tarball. To rehearse, run `pnpm test:pack` (no dry-run wrapper) instead.
- The jsDelivr CDN pins are enforced by `starter-kit.spec.ts` and `schema-publishing.spec.ts`; a stale pin fails `pnpm test`. Leave alone: `src/styles/css-prefix.ts` (keyed to the `5.0.0` base line, not the `-beta.N` suffix) and the bare `@4.9.x` mentions in docs prose (they name the published stable release).
- Cutting the GitHub release fires `publish-starter-kit.yml`, which mirrors `starter-kit/` to the template repo. If the kit carries a `protvista:unpublished` notice, the workflow strips it once the pinned version is live on npm; it polls the registry for up to 15 minutes, because the release can land before the npm publish is visible (5.0.0-beta.3 shipped its banner that way). After a release, check the [template repo](https://github.com/ebi-webcomponents/protvista-starter-kit) shows no "does not work yet" notice. If it does, open that release's run under **Actions → Publish starter kit** and choose **Re-run all jobs**: the npm check passes the second time. (The **Run workflow** button only appears once this workflow file is on the default branch, `main`.)
