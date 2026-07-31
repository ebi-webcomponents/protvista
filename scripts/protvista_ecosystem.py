#!/usr/bin/env python3
"""
protvista_ecosystem.py — keep the curated ProtVista ecosystem table fresh.

The source of truth is a single hand/LLM-curated Markdown table,
docs/program/ecosystem.md. This script does the one thing that benefits from
automation: periodically search public GitHub for repositories that declare
`protvista-uniprot` in a package.json, and:

  * APPEND a stub row for any repo that genuinely declares the dependency and is
    not already in the table (verified by fetching the raw package.json — so
    code-search look-alikes like `protvista-uniprot-entry-adapter` are rejected),
  * PRINT (does not edit) any package-consumer row already in the table whose repo
    no longer appears in the search, so you can mark it removed.

You then review `git diff docs/program/ecosystem.md`, fill in Project / Type /
dates for the new rows, and curate. Re-running with no real-world change makes no
diff (dedup is on the repo). Everything else in the table — forks, ProtVista-type
viewers, deployments, commercial/private, citations — stays human-curated.

Requirements: `gh` (authenticated; `gh auth status`) and Python 3 stdlib only.

Usage:
    python3 scripts/protvista_ecosystem.py            # search, append new, flag fell-out
    python3 scripts/protvista_ecosystem.py --dry-run  # show what would change, write nothing
"""

import argparse
import base64
import binascii
import datetime as dt
import json
import os
import re
import subprocess
from typing import Dict, List, Optional, Set, Tuple

PACKAGE = "protvista-uniprot"                         # what we search for
EXCLUDE = {"piwvh/dependabot-emse"}                   # known false positives (scraped datasets)
SEARCH_LIMIT = 100                                    # gh code-search caps at 100
ACTIVE_DAYS = 365                                     # pushed within this many days -> "active"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ECOSYSTEM_MD = os.path.join(REPO_ROOT, "docs", "program", "ecosystem.md")
TABLE_HEADER = "| Project / repo |"


# --------------------------------------------------------------------------- #
# Shell + GitHub helpers
# --------------------------------------------------------------------------- #
def sh(cmd: List[str], timeout: int = 60) -> Tuple[int, str, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           errors="replace", timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except (OSError, subprocess.SubprocessError) as e:
        return 1, "", str(e)


def search_candidates(pkg: str, limit: int) -> Tuple[List[Tuple[str, str]], int]:
    """(sorted [(repo, path)], raw_hit_count) from GitHub code search (broad)."""
    code, out, err = sh(["gh", "search", "code", f'"{pkg}"', "--filename", "package.json",
                         "--limit", str(limit), "--json", "repository,path"])
    if code != 0:
        raise SystemExit(f"gh search code failed (is gh authenticated?):\n{err.strip()}")
    items = json.loads(out or "[]")
    pairs = sorted({(it["repository"]["nameWithOwner"], it["path"]) for it in items})
    return pairs, len(items)


def verify_key(repo: str, path: str, pkg: str) -> bool:
    """True iff the repo's package.json at `path` declares `pkg` as an exact JSON key."""
    code, out, _ = sh(["gh", "api", f"repos/{repo}/contents/{path}", "--jq", ".content"])
    if code != 0 or not out.strip():
        return False
    try:
        content = base64.b64decode(out.replace("\n", "")).decode("utf-8", "replace")
    except (binascii.Error, ValueError):
        return False
    return package_declared(content, pkg)


def repo_meta(repo: str) -> Dict[str, object]:
    code, out, _ = sh(["gh", "api", f"repos/{repo}", "--jq",
                       "{archived:.archived, pushed_at:.pushed_at, created_at:.created_at}"])
    if code != 0:
        return {}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {}


def repo_created(repo: str) -> Optional[str]:
    """The repo's GitHub creation date (YYYY-MM-DD), or None."""
    code, out, _ = sh(["gh", "api", f"repos/{repo}", "--jq", ".created_at"])
    if code != 0:
        return None
    out = out.strip().strip('"')
    return out[:10] if out and out != "null" else None


# --------------------------------------------------------------------------- #
# Pure helpers (unit-tested, no network)
# --------------------------------------------------------------------------- #
def package_declared(package_json_text: str, pkg: str) -> bool:
    """Exact dependency-key match — excludes look-alikes (…-entry-adapter, …-x)."""
    return re.search('"' + re.escape(pkg) + r'"\s*:', package_json_text) is not None


def github_repo(text: str) -> Optional[str]:
    """owner/repo from a github.com URL in `text`, else None."""
    m = re.search(r"github\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)", text)
    if not m:
        return None
    repo = m.group(1).rstrip(".")
    return repo[:-4] if repo.endswith(".git") else repo


def any_repo(text: str) -> Optional[str]:
    """owner/repo from a github URL or a backtick `owner/repo` token, else None."""
    gh = github_repo(text)
    if gh:
        return gh
    m = re.search(r"`([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)`", text)
    return m.group(1) if m else None


def parse_table(md: str) -> List[Dict[str, str]]:
    """Rows of the ecosystem table as {project, type, evidence} (lowercased type)."""
    rows, in_table = [], False
    for line in md.splitlines():
        s = line.strip()
        if s.startswith(TABLE_HEADER):
            in_table = True
            continue
        if in_table:
            if not s.startswith("|"):
                break
            if set(s) <= set("|-: "):                # separator row
                continue
            cells = [c.strip() for c in s.strip("|").split("|")]
            if len(cells) >= 3:
                rows.append({"project": cells[0], "type": cells[1].lower(),
                             "evidence": cells[2]})
    return rows


def known_repos(rows: List[Dict[str, str]]) -> Set[str]:
    """Every owner/repo mentioned anywhere in the table (lowercased) — for dedup."""
    out: Set[str] = set()
    for r in rows:
        for cell in (r["project"], r["evidence"]):
            repo = any_repo(cell)
            if repo:
                out.add(repo.lower())
    return out


def tracked_dependents(rows: List[Dict[str, str]]) -> Set[str]:
    """Repos we'd expect the GitHub search to re-find: package-consumer rows whose
    Evidence is a github.com URL (i.e. previously discovered). Excludes CDN/live
    deployments like GlyGen whose evidence is a site/paper."""
    out: Set[str] = set()
    for r in rows:
        if r["type"] == "package consumer":
            repo = github_repo(r["evidence"])
            if repo:
                out.add(repo.lower())
    return out


def _age_days(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return (dt.datetime.now(dt.timezone.utc) - d).days


def build_row(repo: str, path: str, meta: Dict[str, object], today: str,
              active_days: int = ACTIVE_DAYS) -> str:
    """A ready-to-review Markdown table row for a newly discovered dependent.

    Since = the repo's GitHub creation date (run --backfill-dates later if unknown);
    Until = — (ongoing); the human can refine to the exact dep-added date if wanted."""
    created = (str(meta.get("created_at") or ""))[:10]
    since = f"{created} (repo created)" if created else "— (repo created)"
    pushed = (str(meta.get("pushed_at") or ""))[:10] or "—"
    if meta.get("archived"):
        status = "archived"
    else:
        age = _age_days(str(meta.get("pushed_at") or "") or None)
        status = "—" if age is None else ("active" if age <= active_days else "dormant")
    return (f"| `{repo}` | package consumer | https://github.com/{repo} | {since} | — | "
            f"{status} | {pushed} | auto-discovered {today} (`{path}`); verify |")


def insert_rows(md: str, new_rows: List[str]) -> str:
    """Insert rows after the last existing table row (before any trailing prose)."""
    if not new_rows:
        return md
    lines = md.splitlines()
    header = next((i for i, l in enumerate(lines) if l.strip().startswith(TABLE_HEADER)), None)
    if header is None:
        raise SystemExit(f"Could not find the ecosystem table header in {ECOSYSTEM_MD}")
    last = header
    i = header + 1
    while i < len(lines) and lines[i].strip().startswith("|"):
        last = i
        i += 1
    return "\n".join(lines[:last + 1] + new_rows + lines[last + 1:]) + "\n"


def backfill_since(md: str, fetch_created) -> Tuple[str, List[str]]:
    """Fill 'Since' cells that start with '—' for rows with a github repo.

    `fetch_created(repo) -> 'YYYY-MM-DD' | None`. Only fills (never overwrites a real
    date), and only rows whose Since (4th column) begins with '—'. Returns
    (new_md, [repos_filled])."""
    lines = md.splitlines()
    header = next((i for i, l in enumerate(lines) if l.strip().startswith(TABLE_HEADER)), None)
    if header is None:
        return md, []
    filled: List[str] = []
    i = header + 1
    while i < len(lines) and lines[i].strip().startswith("|"):
        s = lines[i].strip()
        if not (set(s) <= set("|-: ")):                  # skip the separator row
            cells = [c.strip() for c in s.strip("|").split("|")]
            if len(cells) >= 5 and cells[3].startswith("—"):
                repo = github_repo(cells[0]) or github_repo(cells[2])
                if repo:
                    created = fetch_created(repo)
                    if created:
                        cells[3] = f"{created} (repo created)"
                        lines[i] = "| " + " | ".join(cells) + " |"
                        filled.append(repo)
        i += 1
    return "\n".join(lines) + "\n", filled


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(
        description="Discover new protvista-uniprot package.json dependents and append them "
                    "to docs/program/ecosystem.md (review via git diff).")
    ap.add_argument("--limit", type=int, default=SEARCH_LIMIT, help="gh code-search limit (max 100)")
    ap.add_argument("--dry-run", action="store_true", help="print changes; write nothing")
    ap.add_argument("--backfill-dates", action="store_true",
                    help="fill empty 'Since' cells (rows starting with —, with a github repo) "
                         "from each repo's GitHub created_at, then exit")
    args = ap.parse_args()

    with open(ECOSYSTEM_MD, encoding="utf-8") as f:
        md = f.read()

    if args.backfill_dates:
        new_md, filled = backfill_since(md, repo_created)
        if filled and not args.dry_run:
            tmp = ECOSYSTEM_MD + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(new_md)
            os.replace(tmp, ECOSYSTEM_MD)
            print(f"Filled 'Since' for {len(filled)} repo(s): {', '.join(filled)}.")
            print("Review: git diff docs/program/ecosystem.md")
        elif filled:
            print(f"[dry-run] would fill 'Since' for {len(filled)}: {', '.join(filled)}")
        else:
            print("No rows needed backfilling.")
        return
    rows = parse_table(md)
    known = known_repos(rows)
    tracked = tracked_dependents(rows)

    print(f'[*] Searching GitHub for "{PACKAGE}" in package.json …')
    hits, n_hits = search_candidates(PACKAGE, args.limit)
    if n_hits >= args.limit:
        print(f"[!] Hit the {args.limit}-result code-search cap; results (and fell-out detection) "
              "may be incomplete.")
    by_repo: Dict[str, List[str]] = {}
    for repo, path in hits:
        by_repo.setdefault(repo, []).append(path)
    hit_repos = {r.lower() for r in by_repo}

    today = dt.date.today().isoformat()
    new_rows: List[str] = []
    for repo in sorted(by_repo):
        if repo in EXCLUDE or repo.lower() in known:
            continue
        path = next((p for p in by_repo[repo] if verify_key(repo, p, PACKAGE)), None)
        if not path:
            print(f"    skip (no exact key / look-alike): {repo}")
            continue
        new_rows.append(build_row(repo, path, repo_meta(repo), today))
        print(f"    + new dependent: {repo}  ({path})")

    fell_out = sorted(r for r in tracked if r not in hit_repos)
    if fell_out:
        print("\n[!] In the table but no longer found by search (verify whether the dependency "
              "was removed, then set Status):")
        for r in fell_out:
            print(f"    - {r}")

    if new_rows and not args.dry_run:
        tmp = ECOSYSTEM_MD + ".tmp"                       # write-then-rename = atomic
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(insert_rows(md, new_rows))
        os.replace(tmp, ECOSYSTEM_MD)
        print(f"\nAppended {len(new_rows)} row(s) to {ECOSYSTEM_MD}.")
        print("Review and curate: git diff docs/program/ecosystem.md")
    elif new_rows:
        print(f"\n[dry-run] would append {len(new_rows)} row(s); nothing written.")
    else:
        print("\nNo new dependents to add.")


if __name__ == "__main__":
    main()
