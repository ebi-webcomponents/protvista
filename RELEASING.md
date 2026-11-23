# Releasing

ProtVista releases from **`main`**, with `pnpm release <version>`.

- A stable version (`5.0.1`, `5.1.0`) publishes to the npm **`latest`** dist-tag, the default `npm install protvista-uniprot`, and also moves **`beta`** to it, so `@beta` never trails `latest`.
- A pre-release (`5.1.0-beta.1`) publishes to **`beta`** only.

The script picks the tag from the version and always passes it to `npm publish` explicitly. package.json carries no `publishConfig.tag`, so **never run a bare `npm publish`**: it would put whatever version is in package.json on `latest`.

Publish from a machine with npm auth (`npm login`) — the sandbox/CI GitHub credentials do **not** cover npm. Always use **`npm publish`**, never `pnpm publish`: pnpm applies its own git checks and republish rules on top of npm's, and `test:pack` already packs with npm (`--pack npm`), so publishing with npm keeps the tarball that was validated identical to the one that ships.

## 4.x is frozen

4.9.6 is the last 4.x release. The 4.x line is kept, read-only, on the [`v4`](https://github.com/ebi-webcomponents/protvista/tree/v4) branch, and stays installable as `protvista-uniprot@4` or through the `legacy-v4` dist-tag. There are no more 4.x releases, so nothing here covers releasing one. `v4`'s package.json still sets `"publishConfig": { "tag": "legacy-v4" }`, so a publish from it by mistake cannot take `latest` back.

## Funding acknowledgement

The grant's Outputs Management Plan (section 7) requires every output to carry
this acknowledgement, word for word. Every GitHub release counts:

> This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.

Start the release notes from
[`scripts/release-notes-template.md`](./scripts/release-notes-template.md),
which ends with a **Funding** section holding the text, and keep that section
as it is. `pnpm release` refuses notes that lack it. A line break inside
the sentence is fine; any other change is not.
`src/__spec__/funding-acknowledgement.spec.ts` fails if the template, the
release script, this file, the README, the docs site footer or any other copy
drifts from the text above. The npm package page shows the README, which
carries it under **Funding**.

## Cutting a release

Write `RELEASE_NOTES.md` (git-ignored) from
[`scripts/release-notes-template.md`](./scripts/release-notes-template.md),
keeping its **Funding** section, then run:

```bash
git checkout main && git pull
pnpm release 5.0.1                 # a stable version: latest (and beta)
pnpm release 5.1.0-beta.1          # a pre-release: beta only
pnpm release                       # after a beta: 5.1.0-beta.N -> 5.1.0-beta.N+1
```

`scripts/release.sh` does every step below. It checks the branch, the
working tree, the release notes and your npm and GitHub logins first. If
`RELEASE_NOTES.md` is missing it copies the template there and stops; it also
stops if the notes are still the unedited template or lack the funding
acknowledgement. It then
bumps and repins, dates the CHANGELOG's `## Unreleased` heading, runs
`pnpm test && pnpm validate` and commits `Release <version>`. Nothing leaves
your machine until it asks you to confirm the publish. `--prepare-only` stops
after the commit. If a publish step fails, fix the cause and run it again: it
resumes from the release commit and skips whatever already happened.

Run it in a terminal: if your npm account uses two-factor authentication,
`npm publish` and `npm dist-tag add` each ask for a one-time password.

The manual steps, for reference:

```bash
git checkout main && git pull
# 1. Bump package.json version, then repin every jsDelivr @version reference
#    (PINNED_FILES in scripts/release.sh lists them).
# 2. Write RELEASE_NOTES.md from scripts/release-notes-template.md, keeping
#    its Funding section (see "Funding acknowledgement" above).
pnpm test && pnpm validate                  # the pin specs fail loudly on any missed reference
git commit -am "Release X.Y.Z" && git push
npm publish --tag latest                    # prepack builds; prepublishOnly runs test:pack. ALWAYS pass --tag (beta for a pre-release)
npm dist-tag add protvista-uniprot@X.Y.Z beta   # stable releases only
npm dist-tag ls protvista-uniprot           # latest: X.Y.Z, beta: X.Y.Z
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --latest --title vX.Y.Z --notes-file RELEASE_NOTES.md   # --prerelease instead of --latest for a beta
```

Notes:

- **Do not use `npm publish --dry-run`.** It exports `npm_config_dry_run`, which leaks into the `npm pack` that `attw` runs inside `prepublishOnly` and makes it fail on a missing tarball. To rehearse, run `pnpm test:pack` (no dry-run wrapper) instead.
- The jsDelivr CDN pins are enforced by `starter-kit.spec.ts` and `schema-publishing.spec.ts`; a stale pin fails `pnpm test`. Leave alone: `src/styles/css-prefix.ts` (keyed to the `5.0.0` line, not to each release) and the bare `@4.9.x` mentions in docs prose (they name the last 4.x release).
- The docs site deploys from `main` on every push, so it can be ahead of npm between releases. The README says so.
- Cutting the GitHub release fires `publish-starter-kit.yml`, which mirrors `starter-kit/` to the template repo. If the kit carries a `protvista:unpublished` notice, the workflow strips it once the pinned version is live on npm; it polls the registry for up to 15 minutes, because the release can land before the npm publish is visible (5.0.0-beta.3 shipped its banner that way). After a release, check the [template repo](https://github.com/ebi-webcomponents/protvista-starter-kit) shows no "does not work yet" notice. If it does, open that release's run under **Actions → Publish starter kit** and choose **Re-run all jobs**.
