#!/usr/bin/env python3
"""Maintain a committed monthly npm-downloads time series for protvista-uniprot.

Writes/updates docs/program/npm_downloads.csv (columns: month,package,downloads),
one row per calendar month since 2025-01. The CSV is an append-only cache: completed
months are written once and kept; each run only re-fetches the current month and the
previous one (so a month first recorded while still in progress is corrected once it
completes) plus any months missing from the file.

Data source: npm public downloads API (https://api.npmjs.org/downloads). No API key;
standard library only.

------------------------------------------------------------------------------
CAVEAT — read before quoting these numbers
------------------------------------------------------------------------------
npm download counts are raw HTTP fetch events, NOT distinct users and NOT a measure
of adoption. They are inflated by CI/CD, Docker builds, npm mirrors and registry
replication, and are dominated by the primary consumer (UniProt's own builds). CDN
usage (unpkg/jsDelivr) and cached installs are NOT counted. Treat the series as a
BASELINE TREND to watch over time, never as a per-period adoption headline.
The package is being renamed protvista-uniprot -> protvista in v5, so the series
will eventually split across two names.
------------------------------------------------------------------------------

Usage:
    python3 scripts/npm_downloads.py
    python3 scripts/npm_downloads.py --since 2025-01
"""

import argparse
import calendar
import csv
import datetime as dt
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

PACKAGE = "protvista-uniprot"
DEFAULT_SINCE = "2025-01"
API = "https://api.npmjs.org/downloads/range"
_DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "program")
CSV_PATH = os.path.join(_DOCS, "npm_downloads.csv")
CAVEAT = ("# npm downloads for protvista-uniprot. Raw HTTP fetch events — inflated by CI/mirror/bot "
          "traffic and dominated by UniProt's builds; a baseline trend, NOT an adoption count.")


def fetch_range(package: str, start: str, end: str) -> Optional[int]:
    """Total downloads for `package` over [start, end] (inclusive), or None on no data."""
    pkg_path = urllib.parse.quote(package, safe="@")
    url = f"{API}/{start}:{end}/{pkg_path}"
    req = urllib.request.Request(url, headers={"User-Agent": "protvista-metrics"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return sum(d["downloads"] for d in (data.get("downloads") or []))


# --------------------------------------------------------------------------- #
# Pure month/CSV helpers (unit-tested, no network)
# --------------------------------------------------------------------------- #
def months(start_ym: str, today: dt.date) -> List[str]:
    """'YYYY-MM' from start_ym up to and including today's month."""
    y, m = (int(x) for x in start_ym.split("-"))
    out = []
    while (y, m) <= (today.year, today.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def prev_ym(ym: str) -> str:
    y, m = (int(x) for x in ym.split("-"))
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def month_bounds(ym: str, today: dt.date) -> Tuple[str, str]:
    """(start, end) ISO dates for month `ym`; end is clamped to today (partial month)."""
    y, m = (int(x) for x in ym.split("-"))
    last = dt.date(y, m, calendar.monthrange(y, m)[1])
    return f"{y:04d}-{m:02d}-01", min(last, today).isoformat()


def read_csv(path: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    if not os.path.exists(path):
        return out
    with open(path, newline="") as f:
        for row in csv.reader(line for line in f if not line.startswith("#")):
            if len(row) >= 3 and row[0] != "month":
                try:
                    out[row[0]] = int(row[2])
                except ValueError:
                    pass
    return out


def merge_months(wanted: List[str], existing: Dict[str, int], refresh: set,
                 fetch) -> Tuple[Dict[str, int], int]:
    """Keep cached completed months; (re)fetch missing months + those in `refresh`.

    `fetch(ym) -> Optional[int]`. Returns (data, n_fetched)."""
    data: Dict[str, int] = {}
    fetched = 0
    for ym in wanted:
        if ym in existing and ym not in refresh:
            data[ym] = existing[ym]
            continue
        got = fetch(ym)
        data[ym] = got if got is not None else existing.get(ym, 0)
        fetched += 1
    return data, fetched


def write_csv(path: str, data: Dict[str, int]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"                                   # write-then-rename = atomic
    with open(tmp, "w", newline="") as f:
        f.write(CAVEAT + "\n")
        w = csv.writer(f)
        w.writerow(["month", "package", "downloads"])
        for ym in sorted(data):
            w.writerow([ym, PACKAGE, data[ym]])
    os.replace(tmp, path)


def main() -> None:
    ap = argparse.ArgumentParser(description="Update the monthly npm-downloads CSV for protvista-uniprot.")
    ap.add_argument("--since", default=DEFAULT_SINCE, help="first month, YYYY-MM (default 2025-01)")
    args = ap.parse_args()

    today = dt.date.today()
    cur = today.strftime("%Y-%m")
    refresh = {cur, prev_ym(cur)}                    # correct partial->complete transitions
    existing = read_csv(CSV_PATH)

    def fetch(ym: str) -> Optional[int]:
        start, end = month_bounds(ym, today)
        return fetch_range(PACKAGE, start, end)

    data, fetched = merge_months(months(args.since, today), existing, refresh, fetch)
    write_csv(CSV_PATH, data)

    print(f"Saved {CSV_PATH}: {len(data)} months "
          f"({fetched} fetched, {len(data) - fetched} cached).")
    if data:
        last = sorted(data)[-1]
        print(f"Latest: {last} = {data[last]:,} (current month is partial).")
    print("NB: baseline trend only — inflated by CI/mirror/bot traffic, UniProt-dominated.")


if __name__ == "__main__":
    main()
