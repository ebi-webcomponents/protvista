#!/usr/bin/env python3
"""Unit tests for the simplified ProtVista ecosystem tooling.

Run:  python3 scripts/test_ecosystem_tools.py     (or: python3 -m unittest, from this dir)

No network required.
"""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import protvista_ecosystem as eco                  # noqa: E402
import npm_downloads as npm                         # noqa: E402
import protvista_citation_count as cite             # noqa: E402


SAMPLE_MD = """# ProtVista adoption & ecosystem

intro paragraph

## Ecosystem entities

| Project / repo | Type | Evidence | Since | Until | Status | Last activity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Foo (`acme/foo`) | package consumer | https://github.com/acme/foo | 2024-01-01 (dep added) | — | active | 2026-01-01 | a note |
| GlyGen (`glygener/glygen-frontend`) | package consumer | https://www.glygen.org | 2021 (paper) | — | active | — | CDN deployment |
| Pharos (`ncats/protvista-viewer`) | fork | https://github.com/ncats/protvista-viewer | — (repo created) | — | dormant | 2024-08-01 | verified |
| ProKinO | ProtVista-type viewer | https://pubmed.ncbi.nlm.nih.gov/38077442/ | — (UI mention) | — | — | — | no public repo |

_trailing prose, out of the table._
"""


class TestTableParsing(unittest.TestCase):
    def setUp(self):
        self.rows = eco.parse_table(SAMPLE_MD)

    def test_row_count_and_cells(self):
        self.assertEqual(len(self.rows), 4)
        self.assertEqual(self.rows[0]["type"], "package consumer")
        self.assertEqual(self.rows[2]["type"], "fork")

    def test_known_repos(self):
        known = eco.known_repos(self.rows)
        self.assertEqual(known,
                         {"acme/foo", "glygener/glygen-frontend", "ncats/protvista-viewer"})
        self.assertNotIn("prokino", known)           # no repo for ProKinO

    def test_tracked_dependents_excludes_cdn_and_nonconsumers(self):
        tracked = eco.tracked_dependents(self.rows)
        self.assertEqual(tracked, {"acme/foo"})       # GlyGen (CDN evidence) + Pharos (fork) excluded


class TestRepoExtraction(unittest.TestCase):
    def test_github_repo(self):
        self.assertEqual(eco.github_repo("see https://github.com/a/b for more"), "a/b")
        self.assertEqual(eco.github_repo("https://github.com/a/b.git"), "a/b")
        self.assertIsNone(eco.github_repo("https://example.org/a/b"))

    def test_any_repo_backtick_fallback(self):
        self.assertEqual(eco.any_repo("Foo (`acme/foo`)"), "acme/foo")
        self.assertIsNone(eco.any_repo("ProKinO"))


class TestKeyVerification(unittest.TestCase):
    def test_exact_key_accepted(self):
        self.assertTrue(eco.package_declared(
            '{"dependencies": {"protvista-uniprot": "^2.0.0"}}', "protvista-uniprot"))

    def test_lookalike_rejected(self):
        self.assertFalse(eco.package_declared(
            '{"dependencies": {"protvista-uniprot-entry-adapter": "^1.0.0"}}', "protvista-uniprot"))
        self.assertFalse(eco.package_declared('{"name": "protvista-uniprot-x"}', "protvista-uniprot"))


class TestAppendAndDedup(unittest.TestCase):
    def test_build_row_archived(self):
        row = eco.build_row("new/repo", "package.json",
                            {"archived": True, "created_at": "2018-03-04T00:00:00Z",
                             "pushed_at": "2025-01-01T00:00:00Z"}, "2026-06-22")
        self.assertTrue(row.startswith(
            "| `new/repo` | package consumer | https://github.com/new/repo | "
            "2018-03-04 (repo created) | — | archived |"))
        self.assertIn("auto-discovered 2026-06-22 (`package.json`); verify", row)

    def test_build_row_unknown_created(self):
        row = eco.build_row("new/repo", "package.json", {}, "2026-06-22")
        self.assertIn("| — (repo created) | — |", row)         # Since placeholder, Until ongoing

    def test_insert_before_trailing_prose_and_dedups(self):
        row = eco.build_row("new/repo", "package.json", {}, "2026-06-22")
        md2 = eco.insert_rows(SAMPLE_MD, [row])
        self.assertIn("new/repo", md2)
        self.assertLess(md2.index("new/repo"), md2.index("trailing prose"))   # inside the table
        self.assertGreater(md2.index("new/repo"), md2.index("acme/foo"))      # after existing rows
        # a repo already present is now found by dedup on re-parse
        self.assertIn("new/repo", eco.known_repos(eco.parse_table(md2)))


class TestFellOut(unittest.TestCase):
    """Fell-out = tracked github dependents no longer in the search hit set."""
    def setUp(self):
        self.tracked = eco.tracked_dependents(eco.parse_table(SAMPLE_MD))   # {acme/foo}

    def test_fell_out_when_absent(self):
        hit_repos = set()                             # search returned nothing
        self.assertEqual(sorted(r for r in self.tracked if r not in hit_repos), ["acme/foo"])

    def test_not_fell_out_when_present(self):
        hit_repos = {"acme/foo"}
        self.assertEqual([r for r in self.tracked if r not in hit_repos], [])


class TestBackfill(unittest.TestCase):
    """--backfill-dates fills only '—' Since cells of rows with a github repo."""
    def test_fills_dash_github_rows_only(self):
        created = {"ncats/protvista-viewer": "2019-05-02"}
        md2, filled = eco.backfill_since(SAMPLE_MD, lambda r: created.get(r))
        self.assertEqual(filled, ["ncats/protvista-viewer"])
        self.assertIn("2019-05-02 (repo created)", md2)        # the '—' github row filled
        self.assertIn("2024-01-01 (dep added)", md2)           # a dated row is untouched
        self.assertIn("— (UI mention)", md2)                   # a no-repo '—' row is skipped

    def test_no_created_date_leaves_row_unchanged(self):
        md2, filled = eco.backfill_since(SAMPLE_MD, lambda r: None)
        self.assertEqual(filled, [])
        self.assertIn("— (repo created)", md2)


class TestNpmMonths(unittest.TestCase):
    today = dt.date(2026, 6, 22)

    def test_months_range(self):
        ms = npm.months("2025-01", self.today)
        self.assertEqual(ms[0], "2025-01")
        self.assertEqual(ms[-1], "2026-06")
        self.assertEqual(len(ms), 18)

    def test_prev_ym_year_wrap(self):
        self.assertEqual(npm.prev_ym("2026-01"), "2025-12")
        self.assertEqual(npm.prev_ym("2026-06"), "2026-05")

    def test_month_bounds_clamped_to_today(self):
        self.assertEqual(npm.month_bounds("2026-02", self.today), ("2026-02-01", "2026-02-28"))
        self.assertEqual(npm.month_bounds("2026-06", self.today), ("2026-06-01", "2026-06-22"))


class TestNpmMerge(unittest.TestCase):
    def test_caches_completed_refetches_current_prev_and_missing(self):
        today = dt.date(2026, 6, 22)
        wanted = npm.months("2025-01", today)
        existing = {m: 100 for m in wanted if m not in ("2026-06", "2026-05", "2025-03")}
        refresh = {"2026-06", npm.prev_ym("2026-06")}     # current + previous
        calls = []

        def fetch(ym):
            calls.append(ym)
            return 999

        data, fetched = npm.merge_months(wanted, existing, refresh, fetch)
        self.assertEqual(sorted(calls), ["2025-03", "2026-05", "2026-06"])   # missing + refresh
        self.assertEqual(fetched, 3)
        self.assertEqual(data["2025-01"], 100)        # completed month kept
        self.assertEqual(data["2026-06"], 999)        # current re-fetched
        self.assertEqual(data["2025-03"], 999)        # missing fetched

    def test_csv_roundtrip_skips_comment_and_header(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = os.path.join(d, "npm_downloads.csv")
            npm.write_csv(tmp, {"2025-01": 100, "2025-02": 150})
            self.assertEqual(npm.read_csv(tmp), {"2025-01": 100, "2025-02": 150})
            with open(tmp) as f:
                first = f.readline()
            self.assertTrue(first.startswith("#"))    # caveat travels with the file


class TestCitationFormat(unittest.TestCase):
    def test_author_formatting(self):
        self.assertEqual(cite.format_author_string([]), "Unknown Author")
        self.assertEqual(cite.format_author_string(["A"]), "A")
        self.assertEqual(cite.format_author_string(["A", "B"]), "A & B")
        self.assertEqual(cite.format_author_string(["A", "B", "C"]), "A, B, & C")
        self.assertEqual(cite.format_author_string(list("ABCDEFG")), "A et al.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
