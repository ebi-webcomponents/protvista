#!/usr/bin/env bash
#
# update_metrics.sh — run all the ProtVista metrics tools in one go.
#
#   1. protvista_ecosystem.py     discover new package.json dependents -> ecosystem.md
#   2. npm_downloads.py           refresh the monthly npm download CSV
#   3. protvista_citation_count.py  print the current citation count (writes nothing)
#
# Run on a host with `gh` authenticated (`gh auth status`) and network access.
# Steps are independent: if one fails (e.g. gh not logged in), the rest still run.
#
# Usage:
#   bash scripts/update_metrics.sh
#   PYTHON=python3.12 bash scripts/update_metrics.sh   # pick a specific interpreter
#
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-python3}"
fail=0

run() {
  echo
  echo "==================================================================="
  echo "==> $1"
  echo "==================================================================="
  if ! "$PY" "$DIR/$1"; then
    echo "!! $1 failed (continuing with the rest)"
    fail=1
  fi
}

echo "ProtVista metrics refresh — $("$PY" --version 2>&1)"
run protvista_ecosystem.py
run npm_downloads.py
run protvista_citation_count.py

echo
echo "-------------------------------------------------------------------"
echo "Done. Next:"
echo "  • review & curate any new ecosystem rows:"
echo "      git diff docs/program/ecosystem.md"
echo "  • commit the table + CSV:"
echo "      git add docs/program/ecosystem.md docs/program/npm_downloads.csv && git commit"
echo "  • note the citation count printed above (it is not written to the repo)."
[ "$fail" -eq 0 ] || echo "  (some steps failed — see the output above)"
exit "$fail"
