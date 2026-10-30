#!/usr/bin/env python3
"""Unit tests for palette_audit.py.

Run:  python3 scripts/accessibility/test_palette_audit.py

No network required. The source-reading tests run against the checked-out
tree, so they fail loudly if a palette moves and the audit can no longer
find it.
"""
import contextlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette_audit as pa  # noqa: E402


class TestColourMaths(unittest.TestCase):
    def test_reference_values(self):
        # Sharma et al. (2005) CIEDE2000 pairs and WCAG contrast anchors.
        pa.self_test()

    def test_identity_and_symmetry(self):
        for v in pa.VISIONS:
            self.assertAlmostEqual(pa.de("#990000", "#990000", v), 0.0)
            self.assertAlmostEqual(pa.de("#990000", "#99cc00", v), pa.de("#99cc00", "#990000", v))

    def test_greys_are_unchanged_by_simulation(self):
        for v in pa.VISIONS:
            self.assertEqual(pa.simulate("#808080", v), "#808080")

    def test_over_white(self):
        self.assertEqual(pa.over_white("#000000", 0.6), "#666666")
        self.assertEqual(pa.over_white("#ffffff", 0.3), "#ffffff")

    def test_ramp_interpolates_and_clamps(self):
        stops = [(0.0, "#000000"), (1.0, "#ffffff")]
        self.assertEqual(pa.ramp_at(stops, 0.5), "#808080")
        self.assertEqual(pa.ramp_at(stops, -1), "#000000")
        self.assertEqual(pa.ramp_at(stops, 2), "#ffffff")


class TestNightingaleLookup(unittest.TestCase):
    def test_keys_are_case_folded_and_later_keys_win(self):
        table = pa.nightingale_scale_lookup("H:0.1,h:0.7,P:1")
        self.assertEqual(table, {"H": 0.7, "P": 1.0})


class TestSources(unittest.TestCase):
    def test_variant_colours(self):
        self.assertEqual(len(pa.variant_colours()), 4)

    def test_themes(self):
        for name in ("alphafold-ramp", "alphamissense-ramp"):
            attrs = pa.theme_attrs(name)
            self.assertTrue(attrs["scale"] and attrs["colorRange"])
        self.assertEqual(len(pa.registry_theme("ALPHAFOLD_RAMP")), 4)
        self.assertEqual(len(pa.registry_theme("ALPHAMISSENSE_RAMP")), 3)

    def test_alphamissense_buckets(self):
        self.assertEqual([c for c, _, _ in pa.am_buckets()], list("HVLAlhpP"))

    def test_structure_legend(self):
        self.assertEqual(len(pa.structure_legend()), 7)

    def test_vocabulary_and_rows(self):
        vocab = pa.vocabulary()
        self.assertEqual(len(vocab), 45)
        rows = {r["id"]: r for r in pa.default_rows()}
        marks, _ = pa.row_marks(rows["SITES"], vocab, pa.ptm_exchange_colours())
        self.assertEqual(len(marks), 7)

    def test_markdown_runs(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(pa.main([]), 0)
        self.assertIn("Variant consequence", out.getvalue())


if __name__ == "__main__":
    unittest.main()
