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
                                    grouped as src/default-config.yaml groups them.
                                    Tracks with no type filter (epitopes, antigens,
                                    large-scale mutagenesis) take their types from
                                    the recorded P05067 responses in
                                    scripts/screenshots/fixtures/, resolved the way
                                    Nightingale does (type key, then type name,
                                    else black).
  * InterPro representative domains -- one colour per entry from `color-hash`
                                    (src/schema/adapters/interpro-adapter.ts): the
                                    whole space of colours it can give, and the
                                    colours of the P05067 fixture's domains
  * variant-count line graph     -- src/schema/adapters/variation-graph-adapter.ts
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
    python3 scripts/accessibility/palette_audit.py --check    # do the docs still match?

Exit status: 1 when an installed Nightingale bundle does not draw at the
opacity assumed below (every "as drawn" figure would be wrong), or, with
--check, when a figure quoted in docs/accessibility-audit.md or on the docs
site's accessibility page no longer matches what the script computes.
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

# The CSS named colours the default palettes use.
NAMED = {
    "black": "#000000", "white": "#ffffff", "transparent": None, "red": "#ff0000",
    "darkgrey": "#a9a9a9", "darkgray": "#a9a9a9", "gray": "#808080", "grey": "#808080",
}

# Recorded API responses the screenshot tool replays (one accession, P05067).
FIXTURES = os.path.join("scripts", "screenshots", "fixtures")

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
        m = re.match(r"^    label: (.+?)\s*$", line)
        if m and rows and track is None:
            label = re.sub(r"\{%[^%]*%\}", "", m.group(1).strip("'\""))
            rows[-1]["label"] = label.strip()
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


def row_marks(
    row: dict, vocab: dict, ptm: dict, source_types: dict[str, list[str]] | None = None,
    names: dict[str, str] | None = None,
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Distinct (colour, shape) marks a collapsed row's aggregate track can draw.

    A `features` track with no type filter draws whatever types its data
    source returns; `source_types` (data key -> types) supplies them, resolved
    with `nightingale_type`. Without it, such a track is listed as skipped."""
    marks: dict[str, tuple[str, str]] = {}
    source_types = source_types or {}
    names = names or {}
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
        elif kind == "features" and t.get("data") in source_types:
            for typ in source_types[t["data"]]:
                marks[typ.upper()] = nightingale_type(typ, vocab, names)
        elif kind == "features":
            skipped.append(f"{t['id']} (no filter: types come from the `{t.get('data')}` source)")
        elif kind == "interpro-features":
            skipped.append(f"{t['id']} (one colour per InterPro entry, from a hash)")
    return marks, skipped


# Where each Nightingale bundle sets the opacity it draws with. The pattern
# captures the value, so a changed opacity is reported as a mismatch.
ALPHA_PATTERNS = {
    # `r.globalAlpha=.6;for(const t of l){...}`: the variant-dot loop.
    "nightingale-variation-canvas": (r"\.globalAlpha=(\d*\.?\d+);for\(", VARIANT_ALPHA),
    # `h.globalAlpha=null!==(l=this.data[n].opacity)&&void 0!==l?l:.9`: a
    # feature's own opacity, else the default.
    "nightingale-track-canvas": (
        r"\.globalAlpha=null!==\((\w+)=this\.data\[\w+\]\.opacity\)&&void 0!==\1\?\1:(\d*\.?\d+)",
        FEATURE_ALPHA,
    ),
}


def nightingale_alphas(root: str | None = None) -> dict[str, dict]:
    """Read the opacities above from the installed Nightingale bundles.

    Each entry has `status`: "ok", "mismatch" (the bundle draws at another
    opacity), "not found" (the pattern no longer matches, so the opacity
    cannot be confirmed) or "not installed"; and `text` for the report.
    """
    root = root or ROOT
    out: dict[str, dict] = {}
    for pkg, (pattern, alpha) in ALPHA_PATTERNS.items():
        path = os.path.join(root, "node_modules", "@nightingale-elements", pkg, "dist", "index.js")
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            out[pkg] = {"assumed": alpha, "found": None, "status": "not installed",
                        "text": f"{alpha:g} (node_modules not installed; not re-checked)"}
            continue
        m = re.search(pattern, text)
        found = float(m.group(m.lastindex)) if m else None
        if found is None:
            status, note = "not found", "NOT found in the installed bundle"
        elif abs(found - alpha) > 1e-9:
            status, note = "mismatch", f"the installed bundle draws at {found:g}"
        else:
            status, note = "ok", "confirmed in the installed bundle"
        out[pkg] = {"assumed": alpha, "found": found, "status": status, "text": f"{alpha:g} ({note})"}
    return out


def fixture_json(url: str):
    """Body of a recorded response, looked up by URL in the fixture index."""
    index = json.loads(read(os.path.join(FIXTURES, "index.json")))
    entry = index.get(url)
    if not entry:
        raise SystemExit(f"no recorded response for {url} in {FIXTURES}/index.json")
    return json.loads(read(os.path.join(FIXTURES, entry["file"])))


def default_sources() -> dict[str, str]:
    """`sources:` URL templates of src/default-config.yaml, by data key."""
    out: dict[str, str] = {}
    inside = False
    for line in read("src/default-config.yaml").splitlines():
        if line.startswith("sources:"):
            inside = True
            continue
        if inside:
            m = re.match(r"^  (\w+): (\S+)\s*$", line)
            if m:
                out[m.group(1)] = m.group(2)
            elif line.strip() and not line.startswith(" "):
                break
    return out


def fixture_types(data_key: str, accession: str = "P05067") -> list[str]:
    """Feature types in the recorded response for one data source."""
    url = default_sources()[data_key].replace("{accession}", accession)
    body = fixture_json(url)
    return sorted({f["type"] for f in body.get("features", []) if f.get("type")})


def vocabulary_names() -> dict[str, str]:
    """TYPE -> Nightingale's type name (second column of the vocabulary page)."""
    src = read("docs/src/content/docs/type-and-shape-vocabulary.md")
    return {t: name.strip() for t, name in re.findall(r"^\| `([A-Z_]+)` \| ([^|]+) \|", src, re.M)}


def nightingale_type(t: str, vocab: dict, names: dict) -> tuple[str, str]:
    """(colour, shape) as nightingale-track 5.11 resolves a feature type: the
    upper-cased type as a key, then a type whose name matches, else a black
    rectangle (`lr` and `ar` in the bundle)."""
    if t.upper() in vocab:
        return vocab[t.upper()]
    for key, name in names.items():
        if name.upper() == t.upper() and key in vocab:
            return vocab[key]
    return ("black", "rectangle")


LINEGRAPH_ADAPTERS = {
    "variant-counts": "src/schema/adapters/variation-graph-adapter.ts",
    "rna-editing-counts": "src/schema/adapters/rna-editing-graph-adapter.ts",
}


def linegraph_colours(kind: str) -> dict[str, str]:
    """Line colours a default count graph draws (commented-out lines ignored)."""
    rel = LINEGRAPH_ADAPTERS[kind]
    src = "\n".join(line for line in read(rel).splitlines() if not line.lstrip().startswith("//"))
    found = re.findall(r"name: '([^']+)',\s*range,\s*color: '([^']+)'", src)
    if not found:
        raise SystemExit(f"line colours not found in {rel}")
    return {name: colour for name, colour in found}


def interpro_hash_options() -> dict[str, list[float]]:
    """`saturation` and `lightness` lists passed to ColorHash in the adapter."""
    src = read("src/schema/adapters/interpro-adapter.ts")
    m = re.search(r"new ColorHash\(\{(.*?)\}\)", src, re.S)
    if not m or "hash: 'bkdr'" not in m.group(1):
        raise SystemExit("ColorHash({ hash: 'bkdr', ... }) not found in interpro-adapter.ts")
    out = {}
    for key in ("saturation", "lightness"):
        km = re.search(key + r":\s*\[([^\]]*)\]", m.group(1))
        if not km:
            raise SystemExit(f"{key} not found in interpro-adapter.ts")
        out[key] = [float(x) for x in km.group(1).split(",")]
    return out


def hsl_to_hex(h: float, s: float, l: float) -> str:
    """color-hash 2.0.2's HSL2RGB followed by RGB2HEX."""
    h /= 360
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q
    out = []
    for c in (h + 1 / 3, h, h - 1 / 3):
        if c < 0:
            c += 1
        if c > 1:
            c -= 1
        if c < 1 / 6:
            c = p + (q - p) * 6 * c
        elif c < 0.5:
            c = q
        elif c < 2 / 3:
            c = p + (q - p) * 6 * (2 / 3 - c)
        else:
            c = p
        out.append(math.floor(c * 255 + 0.5))  # Math.round
    return "#" + "".join(f"{v:02x}" for v in out)


def colour_hash(text: str, saturation: list[float], lightness: list[float]) -> str:
    """color-hash 2.0.2 with `hash: 'bkdr'` (BKDRHash, then `hsl`, then `hex`),
    with the same floating-point steps as the JavaScript."""
    seed, seed2 = 131, 137
    limit = math.floor(9007199254740991 / seed2)
    h = 0
    for ch in text + "x":
        if h > limit:
            h = math.floor(h / seed2)
        h = h * seed + ord(ch)
    hue = h % 359
    h = math.ceil(h / 360)
    s = saturation[h % len(saturation)]
    h = math.ceil(h / len(saturation))
    l = lightness[h % len(lightness)]
    return hsl_to_hex(hue, s, l)


def interpro_space() -> list[str]:
    """Every colour the adapter's ColorHash can give: 359 hues by each
    saturation and lightness."""
    opts = interpro_hash_options()
    return sorted({hsl_to_hex(hh, s, l) for hh in range(359)
                   for s in opts["saturation"] for l in opts["lightness"]})


def interpro_fixture_colours(accession: str = "P05067") -> dict[str, str]:
    """Colour of each InterPro entry the adapter draws (one with a
    representative location) in the recorded response for `accession`."""
    opts = interpro_hash_options()
    url = default_sources()["interproDomains"].replace("{accession}", accession)
    out = {}
    for r in fixture_json(url).get("results", []):
        locations = r["proteins"][0].get("entry_protein_locations") or []
        if any(loc.get("representative") for loc in locations):
            acc = r["metadata"]["accession"]
            out[acc] = colour_hash(acc.lower()[::-1], opts["saturation"], opts["lightness"])
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
    if len(drawn) < 2:
        md.append("")
        return md, data
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


AM_CLASSES = [("likely benign", 0.0, 0.34), ("ambiguous", 0.34, 0.564), ("likely pathogenic", 0.564, 1.0)]

AF_NAMES = {"D": "very low (D, < 50)", "L": "low (L, 50–70)", "M": "confident (M, 70–90)", "H": "very high (H, > 90)"}


def am_class(lo: float, hi: float) -> str:
    return " + ".join(n for n, a, b in AM_CLASSES if lo < b and hi > a)


def coloured_sequence_codes(scale: str, stops: list[tuple[float, str]],
                            buckets: list[tuple[str, float, float]]) -> dict[str, dict]:
    """For each adapter bucket: the colour its letter was meant to draw (the
    letter's own value in `scale`) and the colour Nightingale draws (after it
    upper-cases keys and letters; see `nightingale_scale_lookup`)."""
    lookup = nightingale_scale_lookup(scale)
    authored = {k: float(v) for k, v in (b.split(":") for b in scale.split(","))}
    return {
        code: {"bucket": [lo, hi], "class": am_class(lo, hi),
               "intended": ramp_at(stops, authored[code]), "drawn": ramp_at(stops, lookup[code.upper()])}
        for code, lo, hi in buckets
    }


def wrong_codes(codes: dict[str, dict]) -> list[str]:
    """Codes drawn in a colour other than their own."""
    return [c for c, d in codes.items() if d["intended"] != d["drawn"]]


def class_clashes(codes: dict[str, dict]) -> list[list[str]]:
    """[code, code, colour] for codes of different classes drawn in one colour."""
    return [[c1, c2, d1["drawn"]] for (c1, d1), (c2, d2) in itertools.combinations(codes.items(), 2)
            if d1["drawn"] == d2["drawn"] and d1["class"] != d2["class"]]


def sources_agree(*palettes: list) -> bool:
    """True when every palette lists the same colours in the same order
    (hex compared case-insensitively; a missing colour never matches)."""
    norm = [[c.lower() if c else None for c in p] for p in palettes]
    return all(None not in p for p in norm) and all(p == norm[0] for p in norm)


def alphafold_palette() -> dict[str, str]:
    """The four pLDDT colours as the coloured sequence draws each category."""
    af = theme_attrs("alphafold-ramp")
    stops = color_range(af["colorRange"])
    lookup = nightingale_scale_lookup(af["scale"])
    return {AF_NAMES[k]: ramp_at(stops, lookup[k]) for k in ("D", "L", "M", "H")}


def audit() -> tuple[dict, list[str]]:
    """Compute every figure. Returns (results for --json, Markdown lines)."""
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
    md += [f"- `{k}`: {v['text']}" for k, v in alphas.items()]
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
        hues[v] = [round(hp), round(hb), round(dh), round(de(pd, bd, v), 1),
                   round(lab(pd, v)[0]), round(lab(bd, v)[0])]
        md.append(f"| {v} | {hp:.0f}° / {lab(pd, v)[0]:.0f} | {hb:.0f}° / {lab(bd, v)[0]:.0f} | {dh:.0f}° | {de(pd, bd, v):.1f} |")
    md.append("")
    results["variants"]["pathogenic_vs_benign_hue"] = hues

    # 2. AlphaFold pLDDT.
    af_pal = alphafold_palette()
    sec, data = palette_section(
        "AlphaFold pLDDT (`alphafold-ramp`, as the coloured sequence draws each category)", af_pal, None, []
    )
    md += sec
    md += ["L* of each category, very low → very high: " + "; ".join(
        f"{v} {', '.join(f'{lab(c, v)[0]:.0f}' for c in af_pal.values())}" for v in VISIONS) + ".", ""]
    data["lightness"] = {v: [round(lab(c, v)[0]) for c in af_pal.values()] for v in VISIONS}
    reg_af = registry_theme("ALPHAFOLD_RAMP")
    legend = structure_legend()
    leg_af = [legend.get(k) for k in ("very-low", "low", "confident", "very-high")]
    same = sources_agree(list(af_pal.values()), [c for _, c, _ in reg_af], leg_af)
    md += [f"Registry theme, coloured sequence and structure legend use the same four colours: **{'yes' if same else 'no'}**.", ""]
    data["sources_agree"] = same
    results["alphafold"] = data

    # 3. AlphaMissense.
    am = theme_attrs("alphamissense-ramp")
    am_all = color_range(am["colorRange"])
    am_stops = [(v, c) for v, c in am_all if c != "transparent"]
    lookup = nightingale_scale_lookup(am["scale"])

    md += ["### AlphaMissense: coloured sequence (`alphamissense-pathogenicity`)", "",
           "Each residue's average score is bucketed by the adapter, then coloured by the bucket "
           "letter through the theme's `scale`. Intended = the colour at the letter's own value; "
           "drawn = the colour Nightingale picks after upper-casing the letter.", "",
           "| Code | Score bucket | AlphaMissense class | Intended colour | Drawn colour | Drawn vs white |",
           "|---|---|---|---|---|---|"]
    drawn_codes = coloured_sequence_codes(am["scale"], am_stops, am_buckets())
    for code, d in drawn_codes.items():
        lo, hi = d["bucket"]
        flag = "" if d["intended"] == d["drawn"] else " **(wrong)**"
        md.append(f"| `{code}` | {lo:g}–{hi:g} | {d['class']} | `{d['intended']}` | `{d['drawn']}`{flag} | {contrast(d['drawn']):.2f}:1 |")
    no_score = "transparent" if lookup.get("-") == -1 and am_all[0][1] == "transparent" else ramp_at(am_all, lookup["-"])
    md.append(f"| `-` | no score | — | transparent | {no_score} | 1.00:1 (nothing drawn) |")
    md.append("")
    wrong = wrong_codes(drawn_codes)
    md += [f"Codes drawn in another bucket's colour: {', '.join(f'`{c}`' for c in wrong) or 'none'}.", ""]
    clashes = class_clashes(drawn_codes)
    if clashes:
        md += ["Different AlphaMissense classes drawn in the same colour:", ""] + [
            f"- `{c1}` ({drawn_codes[c1]['class']}) and `{c2}` ({drawn_codes[c2]['class']}) both draw `{col}`"
            for c1, c2, col in clashes] + [""]
    md += ["A residue with no score (transparent) against the lightest drawn colours, ΔE00 normal / protan / deutan / tritan:", ""]
    vs_white = {}
    for code in ("A", "L"):
        col = drawn_codes[code]["drawn"]
        vs_white[code] = [round(de(WHITE, col, v), 1) for v in VISIONS]
        md.append(f"- white vs `{code}` drawn `{col}`: " + " / ".join(f"{x:.1f}" for x in vs_white[code]))
    md.append("")
    results["alphamissense_coloured_sequence"] = {"codes": drawn_codes, "wrong": wrong, "clashes": clashes,
                                                  "no_score": no_score, "no_score_vs": vs_white}

    # Heatmap and 3D model: the continuous ramp.
    centres = {f"{n} centre ({(a + b) / 2:.3f})": ramp_at(am_stops, (a + b) / 2) for n, a, b in AM_CLASSES}
    sec, data = palette_section(
        "AlphaMissense: heatmap and 3D model (continuous ramp, sampled at each class centre)", centres, None,
        ["The heatmap interpolates the nine stops (the transparent placeholder stop is left out); the "
         "3D model uses Nightingale's `amColorScale`, the same nine stops."],
    )
    md += sec
    adj = {v: min(de(a[1], b[1], v) for a, b in zip(am_stops, am_stops[1:])) for v in VISIONS}
    ends = {v: de(am_stops[0][1], am_stops[-1][1], v) for v in VISIONS}
    band_contrasts = [contrast(ramp_at(am_stops, 0.34 + (0.564 - 0.34) * i / 50)) for i in range(51)]
    stop_contrasts = [round(contrast(c), 2) for _, c in am_stops]
    mid = ramp_at(am_stops, 0.5)
    md += [
        "| Measure | normal | protan | deutan | tritan |", "|---|---|---|---|---|",
        "| Adjacent-stop minimum ΔE00 | " + " | ".join(f"{adj[v]:.1f}" for v in VISIONS) + " |",
        "| End-to-end ΔE00 | " + " | ".join(f"{ends[v]:.1f}" for v in VISIONS) + " |",
        "",
        f"Contrast against white across the ambiguous class (0.34–0.564): {min(band_contrasts):.2f}–{max(band_contrasts):.2f}:1. "
        f"Colour at 0.5 `{mid}`: {contrast(mid):.2f}:1.",
        "",
        "Each ramp stop against white: " + ", ".join(f"`{c}` {x:.2f}:1" for (_, c), x in zip(am_stops, stop_contrasts)) + ".",
        "",
    ]
    data.update({"adjacent_min": {v: round(x, 1) for v, x in adj.items()},
                 "ends": {v: round(x, 1) for v, x in ends.items()},
                 "ambiguous_contrast": [round(min(band_contrasts), 2), round(max(band_contrasts), 2)],
                 "stop_contrasts": stop_contrasts})
    results["alphamissense_ramp"] = data

    leg_am = {"likely benign": legend.get("am-benign"), "ambiguous": legend.get("am-uncertain"),
              "likely pathogenic": legend.get("am-pathogenic")}
    md += ["### AlphaMissense: structure-panel legend against the 3D model", "",
           "| Class | Legend swatch | Model colour at class centre | ΔE00 (normal) | L* swatch / model |",
           "|---|---|---|---|---|"]
    leg_rows = []
    for (n, a, b), (_, sw) in zip(AM_CLASSES, leg_am.items()):
        model = ramp_at(am_stops, (a + b) / 2)
        leg_rows.append([n, sw, model, round(de(sw, model), 1), round(lab(sw)[0]), round(lab(model)[0])])
        md.append(f"| {n} | `{sw}` | `{model}` | {de(sw, model):.1f} | {lab(sw)[0]:.0f} / {lab(model)[0]:.0f} |")
    reg_am = registry_theme("ALPHAMISSENSE_RAMP")
    md += ["", "Registry theme `alphamissense-ramp` (returned by `getTheme`, not used for drawing): "
           + ", ".join(f"`{c}` at {v:g} ({label})" for v, c, label in reg_am) + ".", ""]
    results["alphamissense_legend_vs_model"] = leg_rows
    results["alphamissense_registry"] = reg_am

    # 4. Feature-type colours by default group.
    vocab = vocabulary()
    names = vocabulary_names()
    ptm = ptm_exchange_colours()
    rows = default_rows()
    sourced = sorted({t["data"] for r in rows for t in r["tracks"]
                      if t.get("kind") == "features" and not t.get("filter") and t.get("data")})
    source_types = {key: fixture_types(key) for key in sourced}
    md += ["### Feature-type colours within each default group (collapsed aggregate track)", "",
           f"Colours as drawn at {FEATURE_ALPHA:g} opacity on white. A pair is listed when its ΔE00 is under "
           f"{HARD:g} in normal vision or under any simulation. Tracks with no type filter draw the types "
           "their source returns; those are taken from the recorded P05067 responses: "
           + "; ".join(f"`{k}` {', '.join(v) or 'none'}" for k, v in source_types.items()) + ".", "",
           "| Group | Types | Closest pair, normal | Pairs under 10 (worst vision, ΔE00, shapes) | Not assessed |",
           "|---|---|---|---|---|"]
    groups = {}
    for row in rows:
        marks, skipped = row_marks(row, vocab, ptm, source_types, names)
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
        ordered = sorted(worst.items(), key=lambda kv: kv[1][0])
        pairs_txt = "; ".join(
            f"{a} / {b} ({v} {d:.1f}, {marks[a][1]} vs {marks[b][1]}{', same shape' if marks[a][1] == marks[b][1] else ''})"
            for (a, b), (d, v) in ordered
        ) or "—"
        md.append(
            f"| {row['id']} | {len(marks)} | "
            + (f"{closest[1]} / {closest[2]} ({closest[0]:.1f})" if closest else one)
            + f" | {pairs_txt} | {'; '.join(skipped) or '—'} |"
        )
        groups[row["id"]] = {
            "label": row.get("label", row["id"]),
            "types": {k: {"colour": c, "shape": s} for k, (c, s) in marks.items()},
            "closest_normal": [round(closest[0], 1), closest[1], closest[2]] if closest else None,
            "pairs_below_hard": [[a, b, round(d, 1), v] for (a, b), (d, v) in ordered],
            "skipped": skipped,
        }
    results["feature_groups"] = groups
    results["feature_source_types"] = source_types
    low = sorted((contrast(c), t) for t, (c, _) in vocab.items() if contrast(c) < 3)
    low_drawn = sorted((contrast(over_white(c, FEATURE_ALPHA)), t) for t, (c, _) in vocab.items()
                       if contrast(over_white(c, FEATURE_ALPHA)) < 3)
    md += ["", f"Feature-type colours below 3:1 against white: {len(low)} of {len(vocab)} as specified, "
           f"{len(low_drawn)} of {len(vocab)} as drawn at {FEATURE_ALPHA:g} opacity. As specified: "
           + ", ".join(f"{t} {c:.2f}:1" for c, t in low) + ". Also below 3:1 as drawn: "
           + (", ".join(f"{t} {c:.2f}:1" for c, t in low_drawn if t not in {x for _, x in low}) or "none") + ".", ""]
    results["feature_low_contrast"] = {"specified": [[t, round(c, 2)] for c, t in low],
                                       "drawn": [[t, round(c, 2)] for c, t in low_drawn], "total": len(vocab)}

    # 5. InterPro representative domains: a colour per entry from a hash.
    space = interpro_space()
    space_low = [c for c in space if contrast(over_white(c, FEATURE_ALPHA)) < 3]
    fixture = interpro_fixture_colours()
    opts = interpro_hash_options()
    md += ["### InterPro representative domains (`color-hash`, interpro-adapter.ts)", "",
           f"Each entry's colour is hashed from its accession: one of 359 hues, saturation "
           f"{', '.join(f'{x:g}' for x in opts['saturation'])} and lightness "
           f"{', '.join(f'{x:g}' for x in opts['lightness'])}, so {len(space)} possible colours. "
           "Nothing keeps two entries on one protein apart: they can get the same or neighbouring hues.", "",
           f"- Possible colours below 3:1 against white as drawn at {FEATURE_ALPHA:g} opacity: "
           f"{len(space_low)} of {len(space)} ({100 * len(space_low) / len(space):.0f}%).",
           f"- Entries with a representative location in the recorded P05067 response: {len(fixture)}"
           + (": " + ", ".join(f"{k} `{c}`" for k, c in fixture.items()) if fixture else "") + ".", ""]
    results["interpro"] = {"space": len(space), "below_3_drawn": len(space_low), "p05067": fixture}

    # 6. Count graphs (line colours, drawn at full opacity).
    results["linegraphs"] = {}
    for kind in LINEGRAPH_ADAPTERS:
        sec, data = palette_section(f"Count graph `{kind}` ({LINEGRAPH_ADAPTERS[kind]})", linegraph_colours(kind), None, [])
        md += sec
        results["linegraphs"][kind] = data

    # 7. Other built-in categorical colours.
    sec, data = palette_section("PTMeXchange confidence (`MOD_RES_LS`, ptm-exchange-adapter.ts)", ptm, FEATURE_ALPHA, [])
    md += sec
    results["ptm_exchange"] = data
    sec, data = palette_section("Isoforms (uniprot-isoforms-adapter.ts; not in the default config)", isoform_colours(), FEATURE_ALPHA, [])
    md += sec
    results["isoforms"] = data
    return results, md


# ───────────────────────── checking the published docs ─────────────────────────

AUDIT_DOC = "docs/accessibility-audit.md"
PAGE_DOC = "docs/src/content/docs/accessibility.md"
WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
VISION_NAMES = {"normal": "normal vision", "protan": "protanopia", "deutan": "deuteranopia", "tritan": "tritanopia"}


def word(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


def join_and(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _line(doc, section, anchor, needles=(), forbidden=()):
    return ("line", doc, section, anchor, list(needles), list(forbidden))


def _fact(text, ok):
    return ("fact", text, bool(ok))


def _simulated_pairs(data: dict) -> list[tuple[float, str, str, str]]:
    """Pairs under HARD in any simulation, as (ΔE00, a, b, vision), closest first."""
    return sorted((d, a, b, v) for v in VISIONS[1:] for d, a, b in data["pairs_below_hard"].get(v, []))


def _closest_simulated(data: dict) -> tuple[float, str, str, str]:
    return min((d, a, b, v) for v, (d, a, b) in data["closest"].items() if v != "normal")


def doc_claims(r: dict) -> list[tuple]:
    """Every figure the two published docs quote, as computed now.

    A `line` claim needs one line of the doc (inside `section`, a heading
    prefix, when given) that contains the anchor and every needle and none of
    the forbidden strings. A `fact` claim is a statement the docs make that is
    checked against the results directly."""
    A, P = AUDIT_DOC, PAGE_DOC
    SUMMARY, WCAG, ISSUES = "## Summary", "## WCAG 2.2 AA results", "## Issues to file"
    S_VAR, S_AF, S_AM = "#### Variant consequence", "#### AlphaFold confidence", "#### AlphaMissense"
    S_FEAT, S_IPR = "#### Feature-type colours", "#### InterPro representative domains"
    S_GRAPH, S_OTHER = "#### Count graphs", "#### Other built-in colours"
    c: list[tuple] = []

    # Opacity: every "as drawn" figure depends on it.
    bad = [k for k, v in r["opacity"].items() if v["status"] in ("mismatch", "not found")]
    c.append(_fact(f"Nightingale draws at the assumed opacities (failed: {', '.join(bad) or 'none'})", not bad))

    # Variants.
    V = r["variants"]["colours"]
    for role, x in V.items():
        c.append(_line(A, S_VAR, f"`{x['hex']}` | `{x['drawn']}` |", [f"{x['drawn_contrast']:.2f}:1"]))
    low_v = [(role, x) for role, x in V.items() if x["drawn_contrast"] < 3]
    c.append(_line(A, WCAG, "| 1.4.11", [f"{x['drawn_contrast']:.2f}:1" for _, x in low_v]))
    c.append(_line(A, SUMMARY, "**Low contrast.**", [f"{word(len(low_v))} of the {word(len(V))} variant colours"]))
    if low_v:
        phrase = join_and([role.split()[0] for role, _ in low_v])
        c.append(_line(P, None, phrase[0].upper() + phrase[1:] + " dots have less than 3:1"))
    pairs = _simulated_pairs(r["variants"])
    for d, a, b, v in pairs:
        c.append(_line(A, S_VAR, "**Pairs that become hard to tell apart:**", [f"under {VISION_NAMES[v]} (ΔE00 {d:.1f})"]))
        c.append(_line(A, SUMMARY, "**Colour-blind check.**", [f"(ΔE00 {d:.1f})"]))
    if not pairs:
        c.append(_line(A, S_VAR, "**Pairs that become hard to tell apart:** none"))
    hues = r["variants"]["pathogenic_vs_benign_hue"]
    for v in ("protan", "deutan"):
        hp, hb, dh, d, lp, lb = hues[v]
        c.append(_line(A, S_VAR, "**Meaning lost:**", [f"{hp}° and {hb}° under {VISION_NAMES[v]}", f"{d:.1f} {VISION_NAMES[v]}"]))
    c.append(_line(A, S_VAR, "**Meaning lost:**", [f"L* {hues['protan'][4]} against {hues['protan'][5]} under protanopia"]))
    dhs = sorted({hues[v][2] for v in ("protan", "deutan")})
    c.append(_line(A, SUMMARY, "**Colour-blind check.**", [f"({'–'.join(str(x) for x in dhs)}° apart)"]))

    # AlphaFold.
    AF = r["alphafold"]
    for name, x in AF["colours"].items():
        c.append(_line(A, S_AF, f"`{x['hex']}` |", [f"{x['contrast']:.2f}:1"]))
    c.append(_fact("AlphaFold: the coloured sequence, registry theme and structure legend use the same four colours",
                   AF["sources_agree"]))
    if not _simulated_pairs(AF):
        d, a, b, v = _closest_simulated(AF)
        c.append(_line(A, S_AF, "**Pairs that become hard to tell apart:** none", [f"under {VISION_NAMES[v]} (ΔE00 {d:.1f})"]))
    c.append(_line(A, S_AF, "**Order:**", [f"L* {', '.join(str(x) for x in AF['lightness']['normal'])} in normal vision"]))
    low_af = sorted(x["contrast"] for x in AF["colours"].values() if x["contrast"] < 3)
    n_af = len(AF["colours"])
    c.append(_line(A, WCAG, "| 1.4.11", [f"{word(len(low_af))} of {word(n_af)} AlphaFold colours ({low_af[0]:.2f}–{low_af[-1]:.2f}:1)"]
                   if low_af else []))
    c.append(_line(A, SUMMARY, "**Low contrast.**", [f"{word(len(low_af))} of the {word(n_af)} AlphaFold colours"]))
    c.append(_line(P, None, "**AlphaFold confidence.**", [f"{word(len(low_af)).capitalize()} of the {word(n_af)} colours"]))

    # AlphaMissense coloured sequence.
    S = r["alphamissense_coloured_sequence"]
    for code, x in S["codes"].items():
        wrong = code in S["wrong"]
        c.append(_line(A, S_AM, f"| `{code}` |",
                       [f"`{x['intended']}`", f"`{x['drawn']}`", f"{contrast(x['drawn']):.2f}:1"] + (["(wrong)"] if wrong else []),
                       [] if wrong else ["(wrong)"]))
    n_codes = len(S["codes"])
    c.append(_line(A, SUMMARY, "**A colour defect found by the audit.**",
                   [f"{word(len(S['wrong']))} of its {word(n_codes)} score buckets"]))
    bounds = []
    for code in S["wrong"]:
        lo, hi = S["codes"][code]["bucket"]
        bounds += [f"{hi:g}"] + ([f"{lo:g}"] if lo > 0 else [])
    c.append(_line(P, None, "**AlphaMissense average track.**",
                   [f"{word(len(S['wrong'])).capitalize()} of its {word(n_codes)} score ranges"] + bounds))
    for c1, c2, _ in S["clashes"]:
        c.append(_line(A, S_AM, "drawn in the same colour as", [f"`{c1}`", f"`{c2}`"]))
    c.append(_fact("AlphaMissense: a residue with no score draws nothing (transparent)", S["no_score"] == "transparent"))
    amb = S["no_score_vs"]["A"]
    c.append(_fact("AlphaMissense: 'no score' against the ambiguous colour is the same under every simulation",
                   len({f"{x:.1f}" for x in amb}) == 1))
    c.append(_line(A, S_AM, "transparent placeholder", [f"ΔE00 {amb[0]:.1f} against white under every simulation"]))

    # AlphaMissense ramp, legend and registry.
    R = r["alphamissense_ramp"]
    for name, x in R["colours"].items():
        c.append(_line(A, S_AM, f"`{x['hex']}` |", [f"{x['contrast']:.2f}:1"]))
    if not _simulated_pairs(R):
        d, a, b, v = _closest_simulated(R)
        c.append(_line(A, S_AM, "**Pairs that become hard to tell apart:** none between classes",
                       [f"under {VISION_NAMES[v]} (ΔE00 {d:.1f})"]))
    adj = R["adjacent_min"]
    v_min = min(VISIONS, key=lambda v: adj[v])
    c.append(_line(A, S_AM, "closest neighbouring stops", [f"ΔE00 {adj[v_min]:.1f} apart under {VISION_NAMES[v_min]}"]))
    lo, hi = R["ambiguous_contrast"]
    c.append(_line(A, S_AM, "**Contrast:**", [f"{lo:.2f}–{hi:.2f}:1"]))
    low_stops = sorted(x for x in R["stop_contrasts"] if x < 3)
    c.append(_line(A, WCAG, "| 1.4.11", [f"{word(len(low_stops))} lightest of the {word(len(R['stop_contrasts']))} "
                                         f"AlphaMissense ramp stops ({low_stops[0]:.2f}–{low_stops[-1]:.2f}:1)"]))
    c.append(_line(A, SUMMARY, "**Low contrast.**",
                   [f"{word(len(low_stops))} of the {word(len(R['stop_contrasts']))} AlphaMissense ramp stops"]))
    legend = r["alphamissense_legend_vs_model"]
    for _, sw, model, d, _, _ in legend:
        c.append(_line(A, S_AM, "**Legend and theme.**", [f"`{sw}` against `{model}`", f"{d:.1f}"]))
    c.append(_line(A, S_AM, "**Legend and theme.**", [f"`{col}`" for _, col, _ in r["alphamissense_registry"]]))
    c.append(_line(P, None, "**The AlphaMissense legend**", ["darker colours than the 3D model"]))
    c.append(_fact("AlphaMissense: every legend swatch is darker than the 3D model and at least ΔE00 "
                   f"{HARD:g} from it", all(d >= HARD and ls < lm for _, _, _, d, ls, lm in legend)))

    # Feature types.
    F = r["feature_low_contrast"]
    ns, nd, tot = len(F["specified"]), len(F["drawn"]), F["total"]
    c.append(_line(A, S_FEAT, "below 3:1 against white as specified",
                   [f"{ns} of the {tot} colours are below 3:1 against white as specified, and {nd} as drawn"]
                   + [f"{x:.2f}:1" for _, x in F["specified"][:5]]))
    c.append(_line(A, WCAG, "| 1.4.11", [f"{nd} of {tot} feature-type colours"]))
    c.append(_line(A, SUMMARY, "**Low contrast.**", [f"{nd} of the {tot} feature-type colours"]))
    c.append(_line(A, ISSUES, "**H.**", [f"the {nd} colours below 3:1"]))
    c.append(_line(P, None, "**Collapsed groups.**", [f"{nd} of the {tot} default feature colours"]))
    for gid, g in r["feature_groups"].items():
        if not g["types"]:
            continue
        if g["pairs_below_hard"]:
            c.append(_line(A, S_FEAT, f"| {g['label']} |", [f"{d:.1f}" for _, _, d, _ in g["pairs_below_hard"]]))
        else:
            c.append(_line(A, S_FEAT, g["label"], ["| None |"]))
    sites, domains = r["feature_groups"]["SITES"], r["feature_groups"]["DOMAINS"]
    c.append(_line(A, S_FEAT, "even in normal vision", [f"(ΔE00 {sites['closest_normal'][0]:.1f})"]))
    c.append(_fact("Feature types: metal binding / DNA binding (Sites) and motif / zinc finger (Domains, protanopia) "
                   "are below the hard threshold",
                   any({a, b} == {"DNA_BIND", "METAL"} for a, b, _, _ in sites["pairs_below_hard"])
                   and any({a, b} == {"MOTIF", "ZN_FING"} and v == "protan" for a, b, _, v in domains["pairs_below_hard"])))

    # InterPro.
    I = r["interpro"]
    c.append(_line(A, S_IPR, f"{I['below_3_drawn']} of the {I['space']} possible colours",
                   [f"({100 * I['below_3_drawn'] / I['space']:.0f}%)"]))
    c.append(_line(A, WCAG, "| 1.4.11", [f"{I['below_3_drawn']} of the {I['space']} possible InterPro domain colours"]))
    c.append(_line(P, None, "**InterPro domains**", ["nearly half the possible colours have less than 3:1"]))
    c.append(_fact("InterPro: 'nearly half' (40–50%) of the possible colours are below 3:1",
                   0.4 <= I["below_3_drawn"] / I["space"] < 0.5))
    c.append(_line(A, S_IPR, "P05067", [f"{len(I['p05067'])} representative" if I["p05067"] else "no representative"]))

    # Count graphs.
    for kind, g in r["linegraphs"].items():
        for name, x in g["colours"].items():
            c.append(_line(A, S_GRAPH, f"`{x['hex']}`", [f"{x['contrast']:.2f}:1"]))
            if x["contrast"] < 3:
                c.append(_line(A, WCAG, "| 1.4.11", [f"count-graph line {x['contrast']:.2f}:1"]))
                c.append(_line(P, None, "**Count graphs.**", [f"{x['contrast']:.2f}:1"]))
        if len(g["colours"]) > 1:
            d = min(x[0] for x in g["closest"].values())
            c.append(_line(A, S_GRAPH, "at least ΔE00", [f"at least ΔE00 {math.floor(d)}"]))

    # Other built-ins.
    T = r["ptm_exchange"]
    c.append(_line(A, S_OTHER, "PTMeXchange confidence",
                   [f"{name} ({x['drawn_contrast']:.2f}:1)" for name, x in T["colours"].items() if x["drawn_contrast"] < 3]
                   + [f"above ΔE00 {math.floor(_closest_simulated(T)[0])}"]))
    iso = r["isoforms"]
    c.append(_line(A, S_OTHER, "isoform colours", [f"at least ΔE00 {math.floor(min(x[0] for x in iso['closest'].values()))} apart"]))
    c.append(_fact("Isoform colours are at least 3:1 as drawn", all(x["drawn_contrast"] >= 3 for x in iso["colours"].values())))
    return c


def _section(lines: list[str], heading: str | None) -> list[str]:
    if heading is None:
        return lines
    for i, line in enumerate(lines):
        if line.startswith(heading):
            out = []
            for nxt in lines[i + 1:]:
                if nxt.startswith("#"):
                    break
                out.append(nxt)
            return out
    return []


def check_docs(results: dict, docs: dict[str, str] | None = None) -> tuple[int, list[str]]:
    """(claims checked, failures). `docs` maps a doc path to its text (read
    from the tree when omitted)."""
    docs = docs or {}
    cache: dict[str, list[str]] = {}
    failures = []
    claims = list({repr(cl): cl for cl in doc_claims(results)}.values())
    for claim in claims:
        if claim[0] == "fact":
            if not claim[2]:
                failures.append(f"no longer true: {claim[1]}")
            continue
        _, doc, section, anchor, needles, forbidden = claim
        if doc not in cache:
            cache[doc] = (docs[doc] if doc in docs else read(doc)).splitlines()
        lines = _section(cache[doc], section)
        ok = any(anchor in line and all(n in line for n in needles) and not any(f in line for f in forbidden)
                 for line in lines)
        if not ok:
            where = f"{doc}" + (f" under '{section}'" if section else "")
            want = " + ".join(repr(n) for n in [anchor] + needles)
            failures.append(f"{where}: no line with {want}" + (f" and without {forbidden!r}" if forbidden else ""))
    return len(claims), failures


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    out = ap.add_mutually_exclusive_group()
    out.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    out.add_argument("--check", action="store_true",
                     help=f"check that {AUDIT_DOC} and {PAGE_DOC} quote the current figures")
    args = ap.parse_args(argv)
    results, md = audit()

    status = 0
    bad = [f"{k}: {v['text']}" for k, v in results["opacity"].items() if v["status"] in ("mismatch", "not found")]
    if bad:
        print("palette_audit: the opacity Nightingale draws with could not be confirmed, so the "
              "'as drawn' figures may be wrong:\n  " + "\n  ".join(bad), file=sys.stderr)
        status = 1

    if args.check:
        n, failures = check_docs(results)
        for f in failures:
            print(f"palette_audit --check: {f}", file=sys.stderr)
        print(f"{n} figures checked against the docs, {len(failures)} out of date.")
        return 1 if failures else status
    if args.json:
        json.dump(results, sys.stdout, indent=1)
        print()
    else:
        print("\n".join(md))
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
