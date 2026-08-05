# Releasing

ProtVista ships from two branches, and their release processes are **not** the same — read the table before you publish.

- **`main`** — the stable 4.x line. Publishes to the npm **`latest`** dist-tag (the default `npm install protvista-uniprot`), so every existing user gets it. Higher stakes; test thoroughly.
- **`next`** — the v5 line. Publishes to the **`beta`** dist-tag (opt-in via `@beta`); `latest` stays on 4.x.

Publish from a machine with npm auth (`npm login`) — the sandbox/CI GitHub credentials do **not** cover npm. Always use **`npm publish`**, never `yarn publish` (Yarn Classic prompts for a version and mispacks).

## Differences at a glance

| | `main` (4.x) | `next` (v5 beta) |
| --- | --- | --- |
| npm dist-tag | `latest` | `beta` (`publishConfig.tag`) |
| Version | `4.9.x` semver | `5.0.0-beta.N` |
| Build on publish | **manual** — `yarn build` first (no `prepack`) | automatic (`prepack: yarn build`) |
| Pre-publish gate | **none** — run `yarn test` yourself | `prepublishOnly: yarn test:pack` |
| Files to bump | `package.json` only | `package.json` **+** the version pins (see below) |
| GitHub release | optional | cut `vX.Y.Z-beta.N` — fires `publish-starter-kit.yml` |
| Stakes | high — the default install | low — opt-in testers |

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

## Releasing `next` (v5 beta → `beta`)

```bash
git checkout next && git pull
# 1. Bump package.json version, then repin every jsDelivr @version reference:
#      starter-kit/index.html, starter-kit/README.md,
#      starter-kit/recipes/extend-uniprot.yaml,
#      docs/src/content/docs/{tutorial,embed,configure}.md
#    and the banner version strings in README.md + starter-kit notices.
yarn test && yarn validate                  # the pin specs fail loudly on any missed reference
npm publish                                 # prepack builds; prepublishOnly runs test:pack; -> beta
npm dist-tag ls protvista-uniprot           # beta: 5.0.0-beta.N, latest: 4.9.x
gh release create vX.Y.Z-beta.N --prerelease --notes-file RELEASE_NOTES.md
yarn cdn:clear                              # if jsDelivr cached a 404 for the new pin
```

Notes for `next`:

- **Do not use `npm publish --dry-run` here.** It exports `npm_config_dry_run`, which leaks into the `npm pack` that `attw` runs inside `prepublishOnly` and makes it fail on a missing tarball. To rehearse, run `yarn test:pack` (no dry-run wrapper) instead.
- The jsDelivr CDN pins are enforced by `starter-kit.spec.ts` and `schema-publishing.spec.ts`; a stale pin fails `yarn test`. Leave alone: `src/styles/css-prefix.ts` (keyed to the `5.0.0` base line, not the `-beta.N` suffix) and the bare `@4.9.x` mentions in docs prose (they name the published stable release).
- Cutting the GitHub release fires `publish-starter-kit.yml`, which mirrors `starter-kit/` to the template repo and strips its "not published yet" banner once the version is live on npm.
