#!/usr/bin/env python3
"""Colour-vision audit of ProtVista's default data palettes (issue #382).

Reads every default data palette from the checked-out source, so the figures
always describe the tree the script runs in:

  * variant consequence colours  -- `scaleColors` in src/filter-config.ts
  * AlphaFold pLDDT              -- `alphafold-ramp` in src/renderer/render-helpers.ts,
                                    the registry theme and the structure-panel legend
  * AlphaMissense                -- `alphamissense-ramp` (scale + color-range) in
                                    render-helpers.ts, the adapter's score buckets,
                                    the registry theme and the structure-panel legend
  * feature-type colours         -- the generated table in
                                    docs/src/content/docs/type-and-shape-vocabulary.md,
                                    grouped as src/default-config.yaml groups them
  * PTMeXchange confidence and isoform colours (adapters)

Method
  * Colour-vision deficiency: Machado, Oliveira & Fernandes (2009) at severity
    1.0 (protanopia, deuteranopia, tritanopia), applied in linear sRGB.
  * Colour difference: CIEDE2000 (Sharma, Wu & Dalal 2005), CIELAB, D65.
  * Contrast: WCAG 2.x contrast ratio against the default surface, #ffffff.
  * "As drawn": Nightingale paints variant dots at 60 % opacity and feature
    shapes at 90 % opacity on a canvas, so those colours are also blended
    over white (source-over, in sRGB, as browsers composite) before measuring.

Standard library only; no network.

Run (from the repository root):
    python3 scripts/accessibility/palette_audit.py            # Markdown to stdout
    python3 scripts/accessibility/palette_audit.py --json     # JSON to stdout
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WHITE = "#ffffff"
VISIONS = ("normal", "protan", "deutan", "tritan")

# Working thresholds for small marks on white (this audit's own, not a standard).
INDISTINGUISHABLE = 5.0
HARD = 10.0

# Opacity Nightingale draws with (checked against node_modules by `nightingale_alphas`).
VARIANT_ALPHA = 0.6
FEATURE_ALPHA = 0.9

NAMED = {"black": "#000000", "white": "#ffffff", "transparent": None}

# ─────────────────────────────── colour maths ───────────────────────────────


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = NAMED.get(h.strip().lower(), h).strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{round(max(0.0, min(1.0, c)) * 255):02x}" for c in rgb)


def to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def from_linear(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def rel_luminance(rgb) -> float:
    r, g, b = (to_linear(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str = WHITE) -> float:
    la, lb = rel_luminance(hex_to_rgb(a)), rel_luminance(hex_to_rgb(b))
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def over_white(h: str, alpha: float) -> str:
    """Source-over composite of `h` at `alpha` on white, in sRGB (as canvas does)."""
    return rgb_to_hex(tuple(alpha * c + (1 - alpha) * 1.0 for c in hex_to_rgb(h)))


def rgb_to_lab(rgb) -> tuple[float, float, float]:
    r, g, b = (to_linear(c) for c in rgb)
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29

    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def ciede2000(lab1, lab2) -> float:
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if C1p else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if C2p else 0.0
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0:
        dhp = 0.0
    else:
        dhp = h2p - h1p
        if dhp > 180:
            dhp -= 360
        elif dhp < -180:
            dhp += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2)
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hbp = (h1p + h2p + 360) / 2
    else:
        hbp = (h1p + h2p - 360) / 2
    T = (
        1
        - 0.17 * math.cos(math.radians(hbp - 30))
        + 0.24 * math.cos(math.radians(2 * hbp))
        + 0.32 * math.cos(math.radians(3 * hbp + 6))
        - 0.20 * math.cos(math.radians(4 * hbp - 63))
    )
    dtheta = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp**7 / (Cbp**7 + 25**7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dtheta)) * Rc
    return math.sqrt(
        (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
    )


# Machado et al. 2009, severity 1.0; applied to linear RGB.
MACHADO = {
    "protan": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deutan": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritan": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}


def simulate(h: str, vision: str) -> str:
    if vision == "normal":
        return rgb_to_hex(hex_to_rgb(h))
    m = MACHADO[vision]
    lin = [to_linear(c) for c in hex_to_rgb(h)]
    return rgb_to_hex(tuple(from_linear(sum(m[i][j] * lin[j] for j in range(3))) for i in range(3)))


def lab(h: str, vision: str = "normal"):
    return rgb_to_lab(hex_to_rgb(simulate(h, vision)))


def de(h1: str, h2: str, vision: str = "normal") -> float:
    return ciede2000(lab(h1, vision), lab(h2, vision))


def hue(h: str, vision: str = "normal") -> float:
    _, a, b = lab(h, vision)
    return math.degrees(math.atan2(b, a)) % 360


def ramp_at(stops: list[tuple[float, str]], t: float) -> str:
    """d3.scaleLinear with d3.interpolateRgb (gamma 1, sRGB); clamps at the ends."""
    if t <= stops[0][0]:
        return stops[0][1]
    for (v0, c0), (v1, c1) in zip(stops, stops[1:]):
        if t <= v1:
            u = (t - v0) / (v1 - v0) if v1 > v0 else 0.0
            a, b = hex_to_rgb(c0), hex_to_rgb(c1)
            return rgb_to_hex(tuple(x + (y - x) * u for x, y in zip(a, b)))
    return stops[-1][1]


def self_test() -> None:
    """Sharma et al. (2005) CIEDE2000 reference pairs and WCAG anchors."""
    cases = [
        ((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425),
        ((50, 3.1571, -77.2803), (50, 0, -82.7485), 2.8615),
        ((50, -1.3802, -84.2814), (50, 0, -82.7485), 1.0000),
        ((50, 2.5, 0), (50, 0, -2.5), 4.3065),
        ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
        ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082),
    ]
    for l1, l2, want in cases:
        got = ciede2000(l1, l2)
        assert abs(got - want) < 1e-4, (l1, l2, got, want)
    assert abs(contrast("#767676") - 4.54) < 0.01
    assert abs(contrast("#000000") - 21.0) < 1e-9


# ─────────────────────────── reading the sources ───────────────────────────


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def color_range(s: str) -> list[tuple[float, str]]:
    out = []
    for pair in s.split(","):
        color, value = pair.rsplit(":", 1)
        out.append((float(value), color.strip()))
    return out


def theme_attrs(name: str) -> dict[str, str]:
    """`scale` and `colorRange` strings of a built-in theme in render-helpers.ts."""
    src = read("src/renderer/render-helpers.ts")
    m = re.search(r"'" + re.escape(name) + r"':\s*\{(.*?)\n  \}", src, re.S)
    if not m:
        raise SystemExit(f"theme {name!r} not found in render-helpers.ts")
    body = m.group(1)

    def field(key: str) -> str:
        fm = re.search(key + r":\s*((?:'[^']*'\s*)+)", body)
        if not fm:
            raise SystemExit(f"{key} not found for {name!r}")
        return "".join(re.findall(r"'([^']*)'", fm.group(1)))

    return {"scale": field("scale"), "colorRange": field("colorRange")}


def registry_theme(const: str) -> list[tuple[float, str, str]]:
    src = read("src/schema/registry.ts")
    m = re.search(r"const " + const + r"[^=]*=\s*\[(.*?)\];", src, re.S)
    if not m:
        raise SystemExit(f"{const} not found in registry.ts")
    return [
        (float(v), c, label)
        for v, c, label in re.findall(
            r"value:\s*([\d.]+),\s*color:\s*'([^']+)',\s*label:\s*'([^']+)'", m.group(1)
        )
    ]


def structure_legend() -> dict[str, str]:
    src = read("src/protvista-uniprot-structure.ts")
    out = {}
    for name, r, g, b in re.findall(
        r"\.af-legend--([\w-]+)\s*\{\s*background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)", src
    ):
        out[name] = "#%02x%02x%02x" % (int(r), int(g), int(b))
    return out


def variant_colours() -> dict[str, str]:
    src = read("src/filter-config.ts")
    m = re.search(r"const scaleColors = \{(.*?)\};", src, re.S)
    if not m:
        raise SystemExit("scaleColors not found in filter-config.ts")
    found = dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{3,6})'", m.group(1)))
    roles = {
        "UPDiseaseColor": "pathogenic",
        "UPNonDiseaseColor": "benign",
        "predictedColor": "predicted",
        "othersColor": "uncertain / other",
    }
    return {f"{roles[k]} (`{k}`)": v for k, v in found.items()}


def am_buckets() -> list[tuple[str, float, float]]:
    """(code, min, max) from the AlphaMissense pathogenicity adapter."""
    src = read("src/schema/adapters/alphamissense-pathogenicity-adapter.ts")
    consts = {k: float(v) for k, v in re.findall(r"const (\w+) = ([\d.]+);", src)}
    return [
        (code, consts[lo], consts[hi])
        for lo, hi, code in re.findall(r"\{ min: (\w+), max: (\w+), code: '(.)' \}", src)
    ]


def nightingale_scale_lookup(scale: str) -> dict[str, float]:
    """How nightingale-colored-sequence 5.11 reads `scale`: keys are upper-cased
    on parse (a later key overwrites an earlier one), and each residue character
    is upper-cased on lookup. Confirmed in Chromium by
    src/__browser__/score-colours.browser.spec.ts."""
    table: dict[str, float] = {}
    for block in scale.split(","):
        k, v = block.split(":")
        table[k.upper()] = float(v)
    return table


def ptm_exchange_colours() -> dict[str, str]:
    src = read("src/schema/adapters/ptm-exchange-adapter.ts")
    m = re.search(r"enum ConfidenceScoreColors \{(.*?)\}", src, re.S)
    out = dict(re.findall(r"(\w+) = '(#[0-9a-fA-F]{6})'", m.group(1))) if m else {}
    if "|| 'black'" in src:
        out["no score"] = "black"
    return out


def isoform_colours() -> dict[str, str]:
    src = read("src/schema/adapters/uniprot-isoforms-adapter.ts")
    return {
        "canonical": re.search(r"CANONICAL_COLOR = '([^']+)'", src).group(1),
        "isoform": re.search(r"ISOFORM_COLOR = '([^']+)'", src).group(1),
    }


def vocabulary() -> dict[str, tuple[str, str]]:
    """TYPE -> (colour, shape) from the generated vocabulary page."""
    src = read("docs/src/content/docs/type-and-shape-vocabulary.md")
    out = {}
    for t, shape, colour in re.findall(
        r"^\| `([A-Z_]+)` \|[^|]*\|[^|]*\| `(\w+)` \| <span[^>]*background:([^\"]+)\"",
        src,
        re.M,
    ):
        out[t] = (colour.strip(), shape)
    return out


def default_rows() -> list[dict]:
    """Rows of src/default-config.yaml with each track's kind, filter and data key."""
    rows: list[dict] = []
    track: dict | None = None
    for line in read("src/default-config.yaml").splitlines():
        m = re.match(r"^  - id: '?([^']+?)'?\s*$", line)
        if m:
            rows.append({"id": m.group(1), "tracks": []})
            track = None
            continue
        m = re.match(r"^      - id: '?([^']+?)'?\s*$", line)
        if m and rows:
            track = {"id": m.group(1)}
            rows[-1]["tracks"].append(track)
            continue
        m = re.match(r"^        (kind|filter|data): (\S+)\s*$", line)
        if m and track is not None:
            track[m.group(1)] = m.group(2)
    return rows


def row_marks(row: dict, vocab: dict, ptm: dict) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Distinct (colour, shape) marks a collapsed row's aggregate track can draw."""
    marks: dict[str, tuple[str, str]] = {}
    skipped: list[str] = []
    for t in row["tracks"]:
        kind, flt = t.get("kind"), t.get("filter")
        if kind in ("features", "peptides", "structure-coverage") and flt:
            key = flt.upper()
            if key in vocab:
                marks[key] = vocab[key]
            else:
                skipped.append(f"{t['id']} (type {flt} not in vocabulary)")
        elif kind == "peptides":
            for key in ("UNIQUE", "NON_UNIQUE"):
                marks[key] = vocab[key]
        elif kind == "structure-coverage":
            marks["PDBE_COVER"] = vocab["PDBE_COVER"]
        elif kind == "peptides-ptm":
            for name, colour in ptm.items():
                marks[f"MOD_RES_LS {name}"] = (colour, "triangle")
        elif kind == "features":
            skipped.append(f"{t['id']} (no filter: types come from the `{t.get('data')}` source)")
        elif kind == "interpro-features":
            skipped.append(f"{t['id']} (one colour per InterPro entry, from a hash)")
    return marks, skipped


def nightingale_alphas() -> dict[str, str]:
    """Confirm the opacities above against the installed Nightingale bundles."""
    checks = {
        "nightingale-variation-canvas": ("globalAlpha=.6", VARIANT_ALPHA),
        "nightingale-track-canvas": (":.9", FEATURE_ALPHA),
    }
    out = {}
    for pkg, (needle, alpha) in checks.items():
        path = os.path.join(ROOT, "node_modules", "@nightingale-elements", pkg, "dist", "index.js")
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            ok = needle in text and ("globalAlpha" in text)
            out[pkg] = f"{alpha} (found `{needle}` in the installed bundle)" if ok else f"{alpha} (NOT found in bundle)"
        except OSError:
            out[pkg] = f"{alpha} (node_modules not installed; not re-checked)"
    return out


# ────────────────────────────────── analysis ──────────────────────────────────


def pairwise(pal: dict[str, str], vision: str) -> list[tuple[float, str, str]]:
    out = [(de(c1, c2, vision), n1, n2) for (n1, c1), (n2, c2) in itertools.combinations(pal.items(), 2)]
    out.sort()
    return out


def band(d: float) -> str:
    if d < INDISTINGUISHABLE:
        return "indistinguishable"
    if d < HARD:
        return "hard"
    return ""


def palette_section(title: str, pal: dict[str, str], alpha: float | None, notes: list[str]) -> tuple[list[str], dict]:
    """Per-colour table plus closest pairs under each vision, measured as drawn."""
    drawn = {n: over_white(c, alpha) if alpha else rgb_to_hex(hex_to_rgb(c)) for n, c in pal.items()}
    md = [f"### {title}", ""] + notes + ([""] if notes else [])
    head = "| Role | Colour | vs white |"
    if alpha:
        head += f" Drawn at {alpha:g} opacity | Drawn vs white |"
    head += " Protan | Deutan | Tritan |"
    md += [head, "|" + "---|" * (head.count("|") - 1)]
    data = {"title": title, "alpha": alpha, "colours": {}, "closest": {}, "pairs_below_hard": {}}
    for n, c in pal.items():
        d = drawn[n]
        row = f"| {n} | `{c}` | {contrast(c):.2f}:1 |"
        if alpha:
            row += f" `{d}` | {contrast(d):.2f}:1 |"
        row += " " + " | ".join(f"`{simulate(d, v)}`" for v in VISIONS[1:]) + " |"
        md.append(row)
        data["colours"][n] = {
            "hex": c, "contrast": round(contrast(c), 2), "drawn": d,
            "drawn_contrast": round(contrast(d), 2),
            "sim": {v: simulate(d, v) for v in VISIONS[1:]},
        }
    md += ["", "| Vision | Closest pair (ΔE00) | Other pairs under 10 |", "|---|---|---|"]
    for v in VISIONS:
        pw = pairwise(drawn, v)
        d0, a, b = pw[0]
        others = [f"{x} / {y} ({d:.1f})" for d, x, y in pw[1:] if d < HARD]
        md.append(f"| {v} | {a} / {b} ({d0:.1f}) | {'; '.join(others) or '—'} |")
        data["closest"][v] = [round(d0, 1), a, b]
        data["pairs_below_hard"][v] = [[round(d, 1), x, y] for d, x, y in pw if d < HARD]
    md.append("")
    return md, data


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    args = ap.parse_args(argv)
    self_test()

    results: dict = {}
    md: list[str] = [
        "# Palette audit output",
        "",
        "Generated by `python3 scripts/accessibility/palette_audit.py`. Machado 2009 CVD "
        "simulation (severity 1.0), CIEDE2000 (ΔE00), WCAG contrast against `#ffffff`.",
        f"Working thresholds for small marks: ΔE00 < {INDISTINGUISHABLE:g} indistinguishable, "
        f"< {HARD:g} hard to tell apart (this audit's own cut-offs, not a standard).",
        "",
    ]
    alphas = nightingale_alphas()
    results["opacity"] = alphas
    md += ["Opacity used for \"as drawn\" colours:", ""]
    md += [f"- `{k}`: {v}" for k, v in alphas.items()]
    md.append("")

    # 1. Variant consequence colours.
    variants = variant_colours()
    sec, data = palette_section(
        "Variant consequence (`scaleColors`, src/filter-config.ts)", variants, VARIANT_ALPHA, []
    )
    md += sec
    results["variants"] = data
    path_c = next(c for n, c in variants.items() if n.startswith("pathogenic"))
    ben_c = next(c for n, c in variants.items() if n.startswith("benign"))
    pd, bd = over_white(path_c, VARIANT_ALPHA), over_white(ben_c, VARIANT_ALPHA)
    md += ["Hue angle (CIELAB h°) of the drawn pathogenic and benign dots, and their L*:", "",
           "| Vision | Pathogenic h° / L* | Benign h° / L* | Hue difference | ΔE00 |", "|---|---|---|---|---|"]
    hues = {}
    for v in VISIONS:
        hp, hb = hue(pd, v), hue(bd, v)
        dh = abs(hp - hb)
        dh = min(dh, 360 - dh)
        hues[v] = [round(hp), round(hb), round(dh), round(de(pd, bd, v), 1)]
        md.append(f"| {v} | {hp:.0f}° / {lab(pd, v)[0]:.0f} | {hb:.0f}° / {lab(bd, v)[0]:.0f} | {dh:.0f}° | {de(pd, bd, v):.1f} |")
    md.append("")
    results["variants"]["pathogenic_vs_benign_hue"] = hues

    # 2. AlphaFold pLDDT.
    af = theme_attrs("alphafold-ramp")
    af_stops = color_range(af["colorRange"])
    af_lookup = nightingale_scale_lookup(af["scale"])
    af_names = {"D": "very low (D, < 50)", "L": "low (L, 50–70)", "M": "confident (M, 70–90)", "H": "very high (H, > 90)"}
    af_pal = {af_names[k]: ramp_at(af_stops, af_lookup[k]) for k in ("D", "L", "M", "H")}
    sec, data = palette_section(
        "AlphaFold pLDDT (`alphafold-ramp`, as the coloured sequence draws each category)", af_pal, None, []
    )
    md += sec
    md += ["L* of each category, very low → very high: " + "; ".join(
        f"{v} {', '.join(f'{lab(c, v)[0]:.0f}' for c in af_pal.values())}" for v in VISIONS) + ".", ""]
    reg_af = registry_theme("ALPHAFOLD_RAMP")
    legend = structure_legend()
    leg_af = [legend.get(k) for k in ("very-low", "low", "confident", "very-high")]
    same = [c.lower() for c in af_pal.values()] == [c[1].lower() for c in reg_af] == [c for c in leg_af]
    md += [f"Registry theme, coloured sequence and structure legend use the same four colours: **{'yes' if same else 'no'}**.", ""]
    data["sources_agree"] = same
    results["alphafold"] = data

    # 3. AlphaMissense.
    am = theme_attrs("alphamissense-ramp")
    am_all = color_range(am["colorRange"])
    am_stops = [(v, c) for v, c in am_all if c != "transparent"]
    lookup = nightingale_scale_lookup(am["scale"])
    authored = {k: float(v) for k, v in (b.split(":") for b in am["scale"].split(","))}
    am_classes = [("likely benign", 0.0, 0.34), ("ambiguous", 0.34, 0.564), ("likely pathogenic", 0.564, 1.0)]

    def classes(lo: float, hi: float) -> str:
        return " + ".join(n for n, a, b in am_classes if lo < b and hi > a)

    md += ["### AlphaMissense: coloured sequence (`alphamissense-pathogenicity`)", "",
           "Each residue's average score is bucketed by the adapter, then coloured by the bucket "
           "letter through the theme's `scale`. Intended = the colour at the letter's own value; "
           "drawn = the colour Nightingale picks after upper-casing the letter.", "",
           "| Code | Score bucket | AlphaMissense class | Intended colour | Drawn colour | Drawn vs white |",
           "|---|---|---|---|---|---|"]
    drawn_codes = {}
    for code, lo, hi in am_buckets():
        want = ramp_at(am_stops, authored[code])
        got = ramp_at(am_stops, lookup[code.upper()])
        drawn_codes[code] = {"bucket": [lo, hi], "class": classes(lo, hi), "intended": want, "drawn": got}
        flag = "" if want == got else " **(wrong)**"
        md.append(f"| `{code}` | {lo:g}–{hi:g} | {classes(lo, hi)} | `{want}` | `{got}`{flag} | {contrast(got):.2f}:1 |")
    no_score = ramp_at(am_all, lookup["-"]) if am_all[0][1] == "transparent" else None
    md.append(f"| `-` | no score | — | transparent | {'transparent' if lookup['-'] == -1 and am_all[0][1] == 'transparent' else no_score} | 1.00:1 (nothing drawn) |")
    md.append("")
    wrong = [c for c, d in drawn_codes.items() if d["intended"] != d["drawn"]]
    md += [f"Codes drawn in another bucket's colour: {', '.join(f'`{c}`' for c in wrong) or 'none'}.", ""]
    # Same colour, different class.
    clashes = []
    for (c1, d1), (c2, d2) in itertools.combinations(drawn_codes.items(), 2):
        if d1["drawn"] == d2["drawn"] and d1["class"] != d2["class"]:
            clashes.append(f"`{c1}` ({d1['class']}) and `{c2}` ({d2['class']}) both draw `{d1['drawn']}`")
    if clashes:
        md += ["Different AlphaMissense classes drawn in the same colour:", ""] + [f"- {c}" for c in clashes] + [""]
    mid = ramp_at(am_stops, authored["A"])
    md += ["A residue with no score (transparent) against the lightest drawn colours, ΔE00 normal / protan / deutan / tritan:", ""]
    for code in ("A", "L"):
        col = drawn_codes[code]["drawn"]
        md.append(f"- white vs `{code}` drawn `{col}`: " + " / ".join(f"{de(WHITE, col, v):.1f}" for v in VISIONS))
    md.append("")
    results["alphamissense_coloured_sequence"] = {"codes": drawn_codes, "wrong": wrong, "clashes": clashes}

    # Heatmap and 3D model: the continuous ramp.
    centres = {f"{n} centre ({(a + b) / 2:.3f})": ramp_at(am_stops, (a + b) / 2) for n, a, b in am_classes}
    sec, data = palette_section(
        "AlphaMissense: heatmap and 3D model (continuous ramp, sampled at each class centre)", centres, None,
        ["The heatmap interpolates the nine stops (the transparent placeholder stop is left out); the "
         "3D model uses Nightingale's `amColorScale`, the same nine stops."],
    )
    md += sec
    adj = {v: min(de(a[1], b[1], v) for a, b in zip(am_stops, am_stops[1:])) for v in VISIONS}
    ends = {v: de(am_stops[0][1], am_stops[-1][1], v) for v in VISIONS}
    band_contrasts = [contrast(ramp_at(am_stops, 0.34 + (0.564 - 0.34) * i / 50)) for i in range(51)]
    md += [
        "| Measure | normal | protan | deutan | tritan |", "|---|---|---|---|---|",
        "| Adjacent-stop minimum ΔE00 | " + " | ".join(f"{adj[v]:.1f}" for v in VISIONS) + " |",
        "| End-to-end ΔE00 | " + " | ".join(f"{ends[v]:.1f}" for v in VISIONS) + " |",
        "",
        f"Contrast against white across the ambiguous class (0.34–0.564): {min(band_contrasts):.2f}–{max(band_contrasts):.2f}:1. "
        f"Midpoint stop `{mid}`: {contrast(mid):.2f}:1.",
        "",
    ]
    data.update({"adjacent_min": {v: round(x, 1) for v, x in adj.items()},
                 "ends": {v: round(x, 1) for v, x in ends.items()},
                 "ambiguous_contrast": [round(min(band_contrasts), 2), round(max(band_contrasts), 2)]})
    results["alphamissense_ramp"] = data

    leg_am = {"likely benign": legend.get("am-benign"), "ambiguous": legend.get("am-uncertain"),
              "likely pathogenic": legend.get("am-pathogenic")}
    md += ["### AlphaMissense: structure-panel legend against the 3D model", "",
           "| Class | Legend swatch | Model colour at class centre | ΔE00 (normal) |", "|---|---|---|---|"]
    leg_rows = []
    for (n, a, b), (_, sw) in zip(am_classes, leg_am.items()):
        model = ramp_at(am_stops, (a + b) / 2)
        leg_rows.append([n, sw, model, round(de(sw, model), 1)])
        md.append(f"| {n} | `{sw}` | `{model}` | {de(sw, model):.1f} |")
    reg_am = registry_theme("ALPHAMISSENSE_RAMP")
    md += ["", "Registry theme `alphamissense-ramp` (returned by `getTheme`, not used for drawing): "
           + ", ".join(f"`{c}` at {v:g} ({label})" for v, c, label in reg_am) + ".", ""]
    results["alphamissense_legend_vs_model"] = leg_rows
    results["alphamissense_registry"] = reg_am

    # 4. Feature-type colours by default group.
    vocab = vocabulary()
    ptm = ptm_exchange_colours()
    md += ["### Feature-type colours within each default group (collapsed aggregate track)", "",
           f"Colours as drawn at {FEATURE_ALPHA:g} opacity on white. A pair is listed when its ΔE00 is under "
           f"{HARD:g} in normal vision or under any simulation.", "",
           "| Group | Types | Closest pair, normal | Pairs under 10 (worst vision, ΔE00, shapes) | Not assessed |",
           "|---|---|---|---|---|"]
    groups = {}
    for row in default_rows():
        marks, skipped = row_marks(row, vocab, ptm)
        if not marks and not skipped:
            continue
        pal = {k: over_white(c, FEATURE_ALPHA) for k, (c, _) in marks.items()}
        worst: dict[tuple[str, str], tuple[float, str]] = {}
        for v in VISIONS:
            for d, a, b in pairwise(pal, v) if len(pal) > 1 else []:
                if d < HARD:
                    key = tuple(sorted((a, b)))
                    if key not in worst or d < worst[key][0]:
                        worst[key] = (d, v)
        closest = pairwise(pal, "normal")[0] if len(pal) > 1 else None
        one = "— (one type)" if marks else "—"
        pairs_txt = "; ".join(
            f"{a} / {b} ({v} {d:.1f}, {marks[a][1]} vs {marks[b][1]}{', same shape' if marks[a][1] == marks[b][1] else ''})"
            for (a, b), (d, v) in sorted(worst.items(), key=lambda kv: kv[1][0])
        ) or "—"
        md.append(
            f"| {row['id']} | {len(marks)} | "
            + (f"{closest[1]} / {closest[2]} ({closest[0]:.1f})" if closest else one)
            + f" | {pairs_txt} | {'; '.join(skipped) or '—'} |"
        )
        groups[row["id"]] = {
            "types": {k: {"colour": c, "shape": s} for k, (c, s) in marks.items()},
            "pairs_below_hard": [[a, b, round(d, 1), v] for (a, b), (d, v) in worst.items()],
            "skipped": skipped,
        }
    results["feature_groups"] = groups
    low = sorted((contrast(c), t) for t, (c, _) in vocab.items() if contrast(c) < 3)
    low_drawn = sorted((contrast(over_white(c, FEATURE_ALPHA)), t) for t, (c, _) in vocab.items()
                       if contrast(over_white(c, FEATURE_ALPHA)) < 3)
    md += ["", f"Feature-type colours below 3:1 against white: {len(low)} of {len(vocab)} as specified, "
           f"{len(low_drawn)} of {len(vocab)} as drawn at {FEATURE_ALPHA:g} opacity. As specified: "
           + ", ".join(f"{t} {c:.2f}:1" for c, t in low) + ". Also below 3:1 as drawn: "
           + (", ".join(f"{t} {c:.2f}:1" for c, t in low_drawn if t not in {x for _, x in low}) or "none") + ".", ""]
    results["feature_low_contrast"] = {"specified": [[t, round(c, 2)] for c, t in low],
                                       "drawn": [[t, round(c, 2)] for c, t in low_drawn], "total": len(vocab)}

    # 5. Other built-in categorical colours.
    sec, data = palette_section("PTMeXchange confidence (`MOD_RES_LS`, ptm-exchange-adapter.ts)", ptm, FEATURE_ALPHA, [])
    md += sec
    results["ptm_exchange"] = data
    sec, data = palette_section("Isoforms (uniprot-isoforms-adapter.ts; not in the default config)", isoform_colours(), FEATURE_ALPHA, [])
    md += sec
    results["isoforms"] = data

    if args.json:
        json.dump(results, sys.stdout, indent=1)
        print()
    else:
        print("\n".join(md))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
