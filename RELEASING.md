# Releasing

ProtVista ships from two branches, and their release processes are **not** the same — read the table before you publish.

- **`main`** — the 4.x line. Until 5.0.0 ships it publishes to the npm **`latest`** dist-tag (the default `npm install protvista-uniprot`). **From 5.0.0 on it publishes to the `v4` dist-tag** and must never touch `latest` again (see [After 5.0.0: keeping 4.x off `latest`](#after-500-keeping-4x-off-latest)).
- **`next`** — the v5 line. Pre-releases (`5.0.0-beta.N`) publish to the **`beta`** dist-tag; stable releases (`5.0.0`, `5.0.1`, …) publish to **`latest`**. `pnpm release:next` picks the tag from the version and always passes it to `npm publish` explicitly. package.json carries no `publishConfig.tag`, so **never run a bare `npm publish` on `next`**: it would put whatever version is in package.json on `latest`.

Publish from a machine with npm auth (`npm login`) — the sandbox/CI GitHub credentials do **not** cover npm. Always use **`npm publish`**, never `pnpm publish`: pnpm applies its own git checks and republish rules on top of npm's, and `test:pack` already packs with npm (`--pack npm`), so publishing with npm keeps the tarball that was validated identical to the one that ships.

## Differences at a glance

| | `main` (4.x) | `next` (v5 beta) |
| --- | --- | --- |
| npm dist-tag | `latest` until 5.0.0, then `v4` | `beta` for `-beta.N`, `latest` for stable (passed by the script) |
| Version | `4.9.x` semver | `5.0.0-beta.N`, then `5.x.y` |
| Package manager | **yarn** (`yarn.lock`) | **pnpm** (`packageManager`) |
| Build on publish | **manual** — `yarn build` first (no `prepack`) | automatic (`prepack: pnpm build`) |
| Pre-publish gate | **none** — run `yarn test` yourself | `prepublishOnly: pnpm test:pack` |
| Files to bump | `package.json` only | `package.json` **+** the version pins (see below) |
| GitHub release | optional | cut `vX.Y.Z[-beta.N]` (prerelease for a beta) — fires `publish-starter-kit.yml` |
| Funding acknowledgement in the release notes | check it yourself (below) | checked by `pnpm release:next` |
| Stakes | high until 5.0.0 (the default install) | low for betas; high from 5.0.0 (the default install) |

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

## Releasing `main` (4.x)

Before 5.0.0 ships, this publishes to `latest`. After it, change the `npm publish` line to `npm publish --tag v4` and expect `v4: 4.9.4` from `npm dist-tag ls`; see [After 5.0.0](#after-500-keeping-4x-off-latest).

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

## Releasing `next` (v5)

Write `RELEASE_NOTES.md` (git-ignored) from
[`scripts/release-notes-template.md`](./scripts/release-notes-template.md),
keeping its **Funding** section, then run:

```bash
git checkout next && git pull
pnpm release:next                  # 5.0.0-beta.N -> 5.0.0-beta.N+1, or pass a version
pnpm release:next 5.0.0            # a stable version: publishes to latest
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
npm publish --tag beta                      # prepack builds; prepublishOnly runs test:pack. ALWAYS pass --tag
npm dist-tag ls protvista-uniprot           # beta: 5.0.0-beta.N, latest: 4.9.x
git commit -am "Release X.Y.Z-beta.N" && git push
git tag vX.Y.Z-beta.N && git push origin vX.Y.Z-beta.N
gh release create vX.Y.Z-beta.N --verify-tag --prerelease --title vX.Y.Z-beta.N --notes-file RELEASE_NOTES.md
```

## Releasing 5.0.0 (the first stable v5)

5.0.0 moves `latest` from 4.x to v5, so every plain `npm install protvista-uniprot` and every unpinned `@latest` CDN URL gets a breaking change. Do it in this order.

1. **Protect 4.x first, on `main`.** Add `"publishConfig": { "tag": "v4" }` to `main`'s package.json and merge it, so a later 4.x patch cannot move `latest` back (see [below](#after-500-keeping-4x-off-latest)). Then point the new tag at the current 4.x release: `npm dist-tag add protvista-uniprot@4.9.x v4` (use the exact version).
2. **Merge the stable-release docs into `next`.** Merge the pull request that removes `publishConfig.tag` and rewrites the README banner, the docs' "beta" wording and this file. `release-next.sh` refuses a stable version while `publishConfig.tag` is set or the README still says "v5 is a beta pre-release". Run the next step straight after the merge: the docs site deploys from `next`, so it calls v5 the stable release from that moment.
3. **Write `RELEASE_NOTES.md`** from the template, keeping the Funding section. For 5.0.0, summarise the whole v5 line (the CHANGELOG's beta sections) and say how to stay on 4.x (`npm install protvista-uniprot@4`).
4. **Run `pnpm release:next 5.0.0`.** On top of the beta steps, it publishes with `--tag latest`, points `beta` at 5.0.0 as well (so `@beta` never trails `latest`), and creates the GitHub release as a full release marked latest, not a prerelease.
5. **Check:** `npm dist-tag ls protvista-uniprot` should show `latest: 5.0.0`, `beta: 5.0.0`, `v4: 4.9.x`. Check the [template repo](https://github.com/ebi-webcomponents/protvista-starter-kit) too, as for a beta.
6. **Decide the branches.** `main` is still the repository's default branch and the 4.x line. Most visitors land on the default branch, so consider making `next` the default branch (or merging it into `main` and moving 4.x to a `v4` branch). That is a repository-settings change, and `screenshots.yml` and `publish-starter-kit.yml` comment on default-branch behaviour, so check them when you do it.

## After 5.0.0: keeping 4.x off `latest`

npm puts every publish on `latest` unless told otherwise, and `main` has no publish script. Once 5.0.0 is out, a plain `npm publish` of a 4.x patch would make `npm install protvista-uniprot` resolve to 4.x again. `main`'s package.json therefore needs `"publishConfig": { "tag": "v4" }`, which step 1 above adds. Users who want 4.x install `protvista-uniprot@4` (the semver range), which works with or without the dist-tag.

Notes for `next`:

- **Do not use `npm publish --dry-run` here.** It exports `npm_config_dry_run`, which leaks into the `npm pack` that `attw` runs inside `prepublishOnly` and makes it fail on a missing tarball. To rehearse, run `pnpm test:pack` (no dry-run wrapper) instead.
- The jsDelivr CDN pins are enforced by `starter-kit.spec.ts` and `schema-publishing.spec.ts`; a stale pin fails `pnpm test`. Leave alone: `src/styles/css-prefix.ts` (keyed to the `5.0.0` base line, not the `-beta.N` suffix) and the bare `@4.9.x` mentions in docs prose (they name the published stable release).
- Cutting the GitHub release fires `publish-starter-kit.yml`, which mirrors `starter-kit/` to the template repo. If the kit carries a `protvista:unpublished` notice, the workflow strips it once the pinned version is live on npm; it polls the registry for up to 15 minutes, because the release can land before the npm publish is visible (5.0.0-beta.3 shipped its banner that way). After a release, check the [template repo](https://github.com/ebi-webcomponents/protvista-starter-kit) shows no "does not work yet" notice. If it does, open that release's run under **Actions → Publish starter kit** and choose **Re-run all jobs**: the npm check passes the second time. (The **Run workflow** button only appears once this workflow file is on the default branch, `main`.)
