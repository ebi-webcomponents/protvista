# ProtVista metrics & adoption tooling

Small, dependency-light tools that maintain ProtVista's **adoption / usage metrics**.
Three deliberately independent artifacts — a curated *entity table*, an auto
*download series*, and an ad-hoc *citation number* — kept as separate files and read
individually, never merged into one.

## Requirements

| Need | For | Notes |
| --- | --- | --- |
| `python3` (≥ 3.8) | all | standard library only |
| `gh` (authenticated) | ecosystem discovery | `gh auth status`; GitHub code search + contents |
| network | npm + citations | npm downloads API, OpenAlex API |

No `pip install` step.

## The tools

| Script | What it does | Run |
| --- | --- | --- |
| `update_metrics.sh` | runs all three of the below in sequence (continues if one fails) | `bash scripts/update_metrics.sh` |
| `protvista_ecosystem.py` | discover new `package.json` dependents → append rows to `ecosystem.md`, flag fell-out | `python3 scripts/protvista_ecosystem.py` |
| `npm_downloads.py` | update the committed monthly download CSV | `python3 scripts/npm_downloads.py` |
| `protvista_citation_count.py` | print the citing-works count (ad-hoc; writes nothing) | `python3 scripts/protvista_citation_count.py` |
| `test_ecosystem_tools.py` | unit tests (offline) | `python3 scripts/test_ecosystem_tools.py` |

## 1. The ecosystem table — `../docs/program/ecosystem.md`

A single hand/LLM-curated Markdown table: **this file is the source of truth**, and
its **git history** is the point-in-time record (no timestamped copies). Columns:
**Project / repo · Type · Evidence · Since · Until · Status · Last activity · Note**.

- **Type** — `package consumer` | `ProtVista-type viewer` | `fork` | `commercial/private` | `unclear`.
- **Evidence** — the strongest public pointer (repo / paper / live site), or
  `private — under agreement` where there is no public artifact. The Type says what
  it is, the Evidence is a checkable link, the Note carries any caveat
  (`verified: shares git history`, `appears derived; unverified`).
- **Since / Until** — when the project's ProtVista relationship began and (if it has)
  ended. Each cell names the *kind* of date because it differs by type: `(dep added)` /
  `(dep removed)` for package consumers, `(repo created)` or `(paper)` for forks &
  viewers, `(interest)` for commercial, `(paper)` / `(UI mention)` for unclear. A `—`
  in *Since* means not yet filled; a `—` in *Until* means ongoing / not applicable.

`protvista_ecosystem.py` automates only the tedious part — finding GitHub package
consumers. It searches public `package.json` files, **verifies the exact dependency
key** (so look-alikes like `protvista-uniprot-entry-adapter` are rejected), and:

- **appends** a stub row for any verified repo not already in the table (with
  *Since* pre-filled from the repo's GitHub `created_at`);
- **prints** (does not edit) any package-consumer row whose repo no longer appears
  in the search, so you can fill its *Until*.

You then **review `git diff docs/program/ecosystem.md`**, refine Project / Type /
dates, and curate. Re-running with no real change makes no diff (dedup is on the
repo). Forks, viewers, deployments, commercial/private and unclear entries are added
by hand. `--backfill-dates` fills any blank (`—`) *Since* cell of a github-repo row
from its `created_at` (handy after seeding rows without dates).

**Consent / no-PII:** never type an unconsented partner name into `ecosystem.md`. A
commercial row reads `Commercial adopter (<sector>)` until consent is recorded;
discovery only ever finds public package consumers, never commercial entries.

## 2. npm downloads — `../docs/program/npm_downloads.csv`

`npm_downloads.py` maintains a committed monthly time series for `protvista-uniprot`
since 2025 (`month,package,downloads`). It is an append-only cache: completed months
are written once and kept; each run only re-fetches the current month and the
previous one (to correct a partial→complete month) plus any months missing from the
file. **Caveat:** npm counts are raw fetch events — inflated by CI/mirror/bot traffic
and dominated by UniProt's own builds; report them as a baseline trend, never an
adoption headline (the caveat travels as a comment line in the CSV too).

## 3. Citations — print-only, not saved

`protvista_citation_count.py` prints the count of works citing the foundational
ProtVista paper (OpenAlex). It writes **nothing** to the repo — citations to a 2017
paper move too slowly to track per period, so just read off the current number when
you need it. `--as-of YYYY-MM-DD` for an as-of count, `--list` for the per-work table,
`--mailto you@example.org` for OpenAlex's faster pool.

## Refreshing the metrics

**Shortcut — run all three at once:** `bash scripts/update_metrics.sh`, then review the
`ecosystem.md` diff, curate, and commit. Or step by step:

```bash
# 1. Refresh discovered package consumers, then REVIEW and curate the diff.
python3 scripts/protvista_ecosystem.py          # (or --dry-run to preview)
git diff docs/program/ecosystem.md              # fill Project/Type/dates; mark removals
#    Add any new fork / viewer / deployment / commercial entry by hand.

# 2. Update the npm download series.
python3 scripts/npm_downloads.py

# 3. Read off the current citation number (writes nothing).
python3 scripts/protvista_citation_count.py

# 4. Commit the table + CSV.
git add docs/program/ecosystem.md docs/program/npm_downloads.csv
git commit -m "metrics: refresh"
```

Adoption figures move slowly — a stable period is a healthy, maintained baseline, not
a regression.

## Notes

- Hardcoded to `protvista-uniprot` (renamed to `protvista` in v5; the series will
  eventually split across both names).
- Out of scope: consumers of the underlying `@nightingale-elements/*` track
  components rather than ProtVista itself (e.g. InterPro).
- The two GA4 page-view scripts live in `protvista/documents/`, not here: they need
  `pandas` + `google-analytics-data` and a separate project, and query UniProt's
  private analytics.
