# Syncing `next` from `main`

This branch (`next`) carries the configuration-driven refactor (PR #132).
`main` reverted that refactor (commit `4bab442`) and continued evolving the
legacy per-feature architecture. The two branches are therefore not safely
merge-able with `git merge` — the revert would propagate into `next` and
destroy its foundation.

We sync via **selective cherry-pick** until `next` is promoted to `main`
(target: ~Nov 2026).

## Direction of flow

- `main` → `next`: only the safe subset listed below. Driven by this script.
- `next` → `main`: never. Architectural changes do not flow back; main is
  maintenance-only until the cutover.

## Permanently-skipped commits

These will appear in `git cherry next main` forever. Do not pick:

| Commit    | Subject                                                  | Reason for skip                                              |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `4bab442` | Revert "Merge pull request #132 from …/config-approach"  | This is the revert. Picking it deletes the entire `next` foundation. |

## Paths that should never come from `main`

When a `main` commit touches any of these, evaluate whether it can be picked
in a reduced form, or skip. **Never accept main's version of these paths via
`git checkout --theirs`.**

- `src/tooltips/feature-tooltip.ts`
- `src/tooltips/interpro-tooltip.ts`
- `src/tooltips/ptm-tooltip.ts`
- `src/tooltips/rna-editing-tooltip.ts`
- `src/tooltips/structure-tooltip.ts`
- `src/tooltips/variation-tooltip.ts`
  - These per-feature tooltip files are the legacy implementation. `next`
    uses `src/tooltips/popover.ts` + `resolve.ts` + `defaults.ts` instead.
- `src/config.ts`
  - `main`'s file is a TypeScript constant; `next`'s config lives in
    `src/default-config.yaml` plus `src/schema/`.
- `src/load-data.ts`, `src/__spec__/*`, `src/schema/*`
  - These exist on `next` (from the config-approach refactor) and were
    removed by the revert on `main`. A `main` commit that reintroduces them
    would be a regression — pick only the non-conflicting parts.

## Decisions still open

None at present — every main commit through the first sync is either
picked or in `SKIP_SHAS`.

## How to run a sync

```bash
git fetch origin
git checkout next
./scripts/sync-from-main.sh
```

The script prints each candidate commit and what it would do. Picks are run
interactively so you can stop and resolve conflicts as they arise.

## First sync record (May 2026)

Picked successfully (pure additions, trivial doc merges):

- `111ab3a` Add ADVISORY_BOARD_TOR.md
- `4f8eaec` Add VIZBI poster
- `2576498` Add documents/mss-engagement.md
- `01fde16` Add documents/consumers.md
- `dce06fa` Doc rename: protvista-uniprot → protvista
- `a3fc28c` Update completed office hours

Picked (bench infrastructure, mostly clean adds):

- `61113dd` Performance: define baseline metrics and profiling workflow
  - Resolved `index.html`: kept next's structure (config-src loading
    + commented scenarios) and swapped the active element to
    `id="pv"` with the URL-param-driven accession script.
  - Took main's `yarn.lock`; needs `yarn install` to re-add next's deps.
- `89ddf8c`, `58d44a0`, `4c80b07`, `6f5c099`, `b94a940`, `f9aa513`,
  `14632a3`, `7ffe6e2`, `a160691` — bench README/baseline tweaks; all auto-merged.

Picked with manual conflict resolution:

- `1e316fb` Swap nightingale-variation for nightingale-variation-canvas.
  - Dropped `src/config.ts` and `src/tooltips/variation-tooltip.ts` (don't exist on next).
  - Kept next's `findById` helper and switch structure in `src/protvista-uniprot.ts`; applied only the package/element name swap.
  - Fixed a typo in the original commit (missing `>` on `</nightingale-variation-canvas>` close tag).
  - Kept next's README (main's edits were to legacy JSON-config docs that next no longer has).
  - Follow-up: updated next-only references the cherry-pick couldn't see — `src/schema/{registry,types,validate}.ts`, `src/__spec__/nightingale-mocks.ts`, two test fixtures, plus snapshot regen via `yarn test -u`. Spec doc `specs/config-approach.md` updated to mirror the type change. `yarn.lock` updated by `yarn install`.

- `0523050` Emit performance marks at lifecycle transitions.
  - Kept next's `loadProtvistaData()` flow and `findById` helper; layered the new public observable surface (`markOnce`/`measureOnce` helpers and the three lifecycle marks) on top.
  - The `protvista-event` dispatch (on the `hasData: false → true` transition) is wired into next's `_loadData` after the result of `loadProtvistaData()` is consumed.
  - Kept next's `installClickTooltip` block in `connectedCallback`; the cherry-pick's deletion of the legacy `'load'` listener doesn't apply on next (next doesn't have it).
  - `bench/instrument.js` deletion + `bench/lighthouserc.cjs` URL cleanup + `eslint.config.mjs` reduction all auto-merged cleanly.

- `49adc6f` and `b748c9a` Package updates.
  - Applied the package.json deltas only (dev-tooling patch bumps + variation-canvas 5.10.0 → 5.10.1); regenerated `yarn.lock` via `yarn install` instead of cherry-picking main's lock.

## Lesson: name-swap commits need a follow-up grep on next-only paths

When picking a commit that renames a component, package, or symbol, the
3-way merge only sees files present on both branches. next has its own
paths (notably `src/schema/`, `src/__spec__/`) that reference the same
names but were added post-merge-base. After applying the cherry-pick,
grep next-only paths for the old name and re-apply the swap there.

```bash
git grep -nE 'old-name([^-]|$)' src/schema/ src/__spec__/ src/tooltips/__spec__/
```

If these are missed, runtime breaks silently — e.g., the registry returns
the old component name, which the swapped switch in `src/protvista-uniprot.ts`
no longer handles, and the corresponding tracks render as nothing.
