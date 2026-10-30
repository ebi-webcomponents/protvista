#!/usr/bin/env python3
"""Unit tests for palette_audit.py.

Run:  python3 scripts/accessibility/test_palette_audit.py
CI runs this file (`pnpm test:palettes`, in .github/workflows/test-and-deploy.yml).

No network required. The source-reading tests run against the checked-out
tree, so they fail if a palette moves and the audit can no longer find it.
`TestDocs` fails when docs/accessibility-audit.md or the docs site's
accessibility page quote a figure the script no longer computes: update the
docs (and the findings they describe) in the same change.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import palette_audit as pa  # noqa: E402


def run_main(argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        status = pa.main(argv)
    return status, out.getvalue(), err.getvalue()


_RESULTS = None


def results():
    """`--json` output, computed once for the whole run."""
    global _RESULTS
    if _RESULTS is None:
        status, out, _ = run_main(["--json"])
        _RESULTS = (status, json.loads(out))
    return _RESULTS[1]


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

    def test_named_colours(self):
        self.assertEqual(pa.rgb_to_hex(pa.hex_to_rgb("darkgrey")), "#a9a9a9")
        self.assertEqual(pa.rgb_to_hex(pa.hex_to_rgb("red")), "#ff0000")


class TestNightingaleLookup(unittest.TestCase):
    def test_keys_are_case_folded_and_later_keys_win(self):
        table = pa.nightingale_scale_lookup("H:0.1,h:0.7,P:1")
        self.assertEqual(table, {"H": 0.7, "P": 1.0})

    def test_type_resolution_falls_back_like_nightingale(self):
        vocab, names = pa.vocabulary(), pa.vocabulary_names()
        self.assertEqual(pa.nightingale_type("epitope", vocab, names), vocab["EPITOPE"])
        # By name ("mutagenesis site"), then the black-rectangle fallback.
        self.assertEqual(pa.nightingale_type("Mutagenesis site", vocab, names), vocab["MUTAGEN"])
        self.assertEqual(pa.nightingale_type("MUTAGENESIS", vocab, names), ("black", "rectangle"))


class TestColouredSequenceFindings(unittest.TestCase):
    """The logic behind the AlphaMissense "drawn in the wrong colour" finding."""

    STOPS = [(0.0, "#000000"), (1.0, "#ffffff")]

    def test_case_collision_is_flagged(self):
        codes = pa.coloured_sequence_codes("H:0.1,h:0.7", self.STOPS, [("H", 0.0, 0.2), ("h", 0.6, 1.0)])
        self.assertEqual(codes["H"]["intended"], pa.ramp_at(self.STOPS, 0.1))
        self.assertEqual(codes["H"]["drawn"], pa.ramp_at(self.STOPS, 0.7))
        self.assertEqual(pa.wrong_codes(codes), ["H"])
        self.assertEqual(pa.class_clashes(codes), [["H", "h", pa.ramp_at(self.STOPS, 0.7)]])

    def test_distinct_letters_are_not_flagged(self):
        codes = pa.coloured_sequence_codes("B:0.1,P:0.9", self.STOPS, [("B", 0.0, 0.2), ("P", 0.8, 1.0)])
        self.assertEqual(pa.wrong_codes(codes), [])
        self.assertEqual(pa.class_clashes(codes), [])


class TestSourcesAgree(unittest.TestCase):
    def test_case_is_ignored(self):
        self.assertTrue(pa.sources_agree(["#ff7d45", "#0053D6"], ["#FF7D45", "#0053d6"], ["#ff7d45", "#0053d6"]))

    def test_one_changed_colour_disagrees(self):
        self.assertFalse(pa.sources_agree(["#ff7d45"], ["#ff7d46"], ["#ff7d45"]))

    def test_missing_colour_disagrees(self):
        self.assertFalse(pa.sources_agree([None], [None], [None]))


class TestOpacityCheck(unittest.TestCase):
    VARIATION = "nightingale-variation-canvas"
    TRACK = "nightingale-track-canvas"

    def fake_root(self, bundles):
        root = tempfile.mkdtemp()
        for pkg, text in bundles.items():
            d = os.path.join(root, "node_modules", "@nightingale-elements", pkg, "dist")
            os.makedirs(d)
            with open(os.path.join(d, "index.js"), "w", encoding="utf-8") as fh:
                fh.write(text)
        return root

    def test_matching_bundles_are_confirmed(self):
        root = self.fake_root({
            self.VARIATION: "r.globalAlpha=.6;for(const t of l){}",
            self.TRACK: "h.globalAlpha=null!==(l=this.data[n].opacity)&&void 0!==l?l:.9;",
        })
        self.assertEqual({k: v["status"] for k, v in pa.nightingale_alphas(root).items()},
                         {self.VARIATION: "ok", self.TRACK: "ok"})

    def test_changed_opacity_is_a_mismatch(self):
        root = self.fake_root({
            self.VARIATION: "r.globalAlpha=.5;for(const t of l){}",
            # An unrelated `:.9` must not pass for the feature opacity.
            self.TRACK: "var o={a:.9};h.globalAlpha=null!==(l=this.data[n].opacity)&&void 0!==l?l:.5;",
        })
        alphas = pa.nightingale_alphas(root)
        self.assertEqual(alphas[self.VARIATION]["status"], "mismatch")
        self.assertEqual(alphas[self.VARIATION]["found"], 0.5)
        self.assertEqual(alphas[self.TRACK]["status"], "mismatch")

    def test_unrecognised_bundle_is_not_found(self):
        root = self.fake_root({self.VARIATION: "ctx.globalAlpha=x", self.TRACK: "var o={a:.9}"})
        statuses = {v["status"] for v in pa.nightingale_alphas(root).values()}
        self.assertEqual(statuses, {"not found"})

    def test_missing_bundles_are_reported_not_failed(self):
        statuses = {v["status"] for v in pa.nightingale_alphas(tempfile.mkdtemp()).values()}
        self.assertEqual(statuses, {"not installed"})

    def test_main_fails_when_opacity_cannot_be_confirmed(self):
        bad = {self.VARIATION: {"assumed": 0.6, "found": 0.5, "status": "mismatch", "text": "0.6 (draws at 0.5)"}}
        with mock.patch.object(pa, "nightingale_alphas", return_value=bad):
            status, _, err = run_main([])
        self.assertEqual(status, 1)
        self.assertIn("could not be confirmed", err)

    @unittest.skipUnless(os.path.isdir(os.path.join(pa.ROOT, "node_modules", "@nightingale-elements")),
                         "node_modules not installed")
    def test_installed_bundles_draw_at_the_assumed_opacity(self):
        self.assertEqual({v["status"] for v in pa.nightingale_alphas().values()}, {"ok"})


class TestInterProColours(unittest.TestCase):
    def test_colour_hash_matches_the_library(self):
        # Expected values printed by color-hash 2.0.2 in Node with the
        # adapter's options (hash 'bkdr', saturation and lightness [0.65, 0.35, 0.5]).
        opts = pa.interpro_hash_options()
        expected = {
            "ipr002223": "#2dd24b", "abc": "#783a3d", "x" * 40: "#e06cac", "41000fp": "#2dd248",
            "3222002rpi": "#1f9376", "ipr000001": "#4059bf", "cd22607": "#d2592d",
        }
        for text, colour in expected.items():
            self.assertEqual(pa.colour_hash(text, opts["saturation"], opts["lightness"]), colour, text)

    def test_space_size(self):
        # 359 hues x 3 saturations x 3 lightnesses, all distinct (also what
        # 200 000 random strings give in Node).
        self.assertEqual(len(pa.interpro_space()), 3231)


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

    def test_linegraph_colours(self):
        self.assertEqual(pa.linegraph_colours("variant-counts"),
                         {"variant": "darkgrey", "disease causing variant": "red"})
        self.assertEqual(pa.linegraph_colours("rna-editing-counts"), {"missense": "darkgrey"})

    def test_fixture_types(self):
        self.assertEqual(pa.fixture_types("epitopes"), ["EPITOPE"])
        self.assertEqual(pa.fixture_types("mutagenesis"), ["MUTAGENESIS"])

    def test_vocabulary_and_rows(self):
        vocab = pa.vocabulary()
        self.assertEqual(len(vocab), 45)
        rows = {r["id"]: r for r in pa.default_rows()}
        self.assertEqual(rows["SITES"]["label"], "Sites")
        marks, _ = pa.row_marks(rows["SITES"], vocab, pa.ptm_exchange_colours())
        self.assertEqual(len(marks), 7)

    def test_markdown_runs(self):
        status, out, _ = run_main([])
        self.assertEqual(status, 0)
        self.assertIn("Variant consequence", out)


class TestHeadlineFindings(unittest.TestCase):
    """The report's main findings, read from the --json output. When one of
    these changes on purpose, update docs/accessibility-audit.md and
    docs/src/content/docs/accessibility.md too."""

    def test_json_exits_cleanly(self):
        results()
        self.assertEqual(_RESULTS[0], 0)

    def test_alphamissense_codes_drawn_wrong(self):
        seq = results()["alphamissense_coloured_sequence"]
        self.assertEqual(seq["wrong"], ["H", "L", "p"])
        self.assertEqual([c[:2] for c in seq["clashes"]], [["H", "h"], ["L", "l"]])
        self.assertEqual(seq["no_score"], "transparent")

    def test_alphafold_sources_agree(self):
        self.assertTrue(results()["alphafold"]["sources_agree"])

    def test_alphamissense_legend_differs_from_model(self):
        # The structure legend is darker than the 3D model for every class
        # (accessibility.md, "The AlphaMissense legend"; audit issue G).
        for name, swatch, model, d, l_swatch, l_model in results()["alphamissense_legend_vs_model"]:
            self.assertGreaterEqual(d, pa.HARD, name)
            self.assertLess(l_swatch, l_model, name)

    def test_feature_colours_below_3_to_1(self):
        low = results()["feature_low_contrast"]
        self.assertEqual((len(low["specified"]), len(low["drawn"]), low["total"]), (12, 14, 45))


class TestDocs(unittest.TestCase):
    def test_docs_quote_current_figures(self):
        n, failures = pa.check_docs(results())
        self.assertGreater(n, 50)
        self.assertEqual(failures, [], "\n" + "\n".join(failures))

    def test_a_stale_figure_is_caught(self):
        audit = pa.read(pa.AUDIT_DOC)
        self.assertIn("**1.48:1**", audit)
        _, failures = pa.check_docs(results(), {pa.AUDIT_DOC: audit.replace("**1.48:1**", "**1.49:1**")})
        self.assertTrue(any("`#c2e066` |" in f for f in failures), failures)

    def test_a_changed_source_colour_is_caught(self):
        # As if UPNonDiseaseColor became dark green: the docs still say 1.48:1.
        changed = json.loads(json.dumps(results()))
        benign = next(k for k in changed["variants"]["colours"] if k.startswith("benign"))
        changed["variants"]["colours"][benign].update(hex="#1b5e20", drawn="#769e79", drawn_contrast=3.03)
        _, failures = pa.check_docs(changed)
        self.assertTrue(failures)


if __name__ == "__main__":
    unittest.main()
