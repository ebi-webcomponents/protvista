#!/usr/bin/env bash
#
# Thorough packaging / ESM validation for protvista-uniprot.
#
# Runs the full gauntlet the CI "build" job runs, plus extra tarball,
# sourcemap and dependency-hygiene checks that neither the test suite nor
# publint/attw cover. Every step is reported PASS/FAIL and the script exits
# non-zero if anything failed, so it is safe to wire into a pre-publish hook.
#
# Usage (from anywhere in the repo):
#   yarn validate                 # full run (installs, builds, checks)
#   SKIP_INSTALL=1 yarn validate  # reuse existing node_modules
#   RUN_BROWSER=1  yarn validate  # also run the Playwright browser suite
#
# Or invoke directly: ./scripts/validate-package.sh

set -uo pipefail

# Resolve to the repo root so the relative paths below work no matter where
# the script is invoked from (yarn, a subdirectory, an absolute path).
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" || exit 2

# ---- pretty output + result tracking -------------------------------------
BLUE=$'\033[1;34m'; GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
FAILED=0
declare -a RESULTS=()

banner() { printf '\n%s==> %s%s\n' "$BLUE" "$1" "$OFF"; }
record() { # record <PASS|FAIL> <name>
  if [ "$1" = PASS ]; then RESULTS+=("${GREEN}PASS${OFF}  $2")
  else RESULTS+=("${RED}FAIL${OFF}  $2"); FAILED=1; fi
}
run() { # run <name> <command...>
  banner "$1"
  if "${@:2}"; then record PASS "$1"; else record FAIL "$1"; fi
}
skip() { RESULTS+=("${DIM}SKIP  $1${OFF}"); printf '%s(skipped: %s)%s\n' "$DIM" "$1" "$OFF"; }

# ---- 0. environment sanity ----------------------------------------------
banner "Environment"
command -v node >/dev/null || { echo "node not found"; exit 2; }
command -v yarn >/dev/null || { echo "yarn not found"; exit 2; }
node -v; yarn -v
[ -f package.json ] || { echo "no package.json at the resolved root"; exit 2; }

# ---- 1. install (frozen lockfile — reproducibility gate) -----------------
if [ "${SKIP_INSTALL:-0}" = 1 ]; then
  skip "Install (SKIP_INSTALL=1)"
else
  run "Install (frozen lockfile)" yarn install --frozen-lockfile
fi

# ---- 2. static checks ----------------------------------------------------
run "Lint"               yarn test:lint
run "Type-check (tsc)"   yarn test:types      # compiles the .js-extension churn
run "Unit tests"         yarn test:unit       # incl. package-contract source + purity checks

# ---- 3. build (prerequisite for every dist/-based check below) -----------
run "Build (vite)"       yarn build

BUILT=1
if [ ! -f dist/protvista-uniprot.mjs ]; then
  echo "${RED}dist/protvista-uniprot.mjs missing — build failed; skipping dist checks${OFF}"
  BUILT=0
fi

# ---- 4. consumer-facing package checks (publint + attw) ------------------
# Mirrors `yarn test:pack`. attw --pack runs `npm pack`, which rebuilds via
# the prepack hook — that is the real tarball a consumer would resolve.
if [ "$BUILT" = 1 ]; then
  run "publint --strict"        npx --no-install publint --strict
  run "arethetypeswrong (attw)" npx --no-install attw --pack . --ignore-rules cjs-resolves-to-esm
else
  skip "publint --strict"; skip "arethetypeswrong (attw)"
fi

# ---- 5. packaging-contract spec against the built dist/ ------------------
# These assertions skip unless a build exists (see the describe.skipIf in the
# spec), so the unit run above did not exercise them — run them here.
if [ "$BUILT" = 1 ]; then
  run "Contract spec vs dist/" \
    yarn vitest run --project unit src/__spec__/package-contract.spec.ts
else
  skip "Contract spec vs dist/"
fi

# ---- 6. tarball contents -------------------------------------------------
# What `npm publish` would actually ship. Reads the current dist/ without a
# rebuild (--ignore-scripts). Asserts files:["dist"] holds in practice: no
# src, one declaration tree, no test declarations, real entry + types.
check_tarball() {
  npm pack --dry-run --json --ignore-scripts 2>/dev/null | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const files = (Array.isArray(data) ? data[0].files : data.files).map((f) => f.path);
    const problems = [];
    // npm always ships these root files regardless of `files`.
    const rootOK = /^(package\.json|README|LICEN[SC]E|CHANGELOG|CHANGES|HISTORY|NOTICE)/i;

    const strays = files.filter((p) => !p.startsWith("dist/") && !rootOK.test(p));
    if (strays.length) problems.push("ships files outside dist/: " + strays.join(", "));

    const src = files.filter((p) => p.startsWith("src/"));
    if (src.length) problems.push("ships src/: " + src.slice(0, 5).join(", "));

    const strayDts = files.filter((p) => p.endsWith(".d.ts") && !p.startsWith("dist/types/"));
    if (strayDts.length) problems.push("declarations outside dist/types/: " + strayDts.join(", "));

    const testDts = files.filter((p) => /__(spec|tests|browser)__/.test(p));
    if (testDts.length) problems.push("ships test files: " + testDts.join(", "));

    for (const need of ["dist/protvista-uniprot.mjs", "dist/types/index.d.ts"]) {
      if (!files.includes(need)) problems.push("missing " + need);
    }

    if (problems.length) { console.error(problems.map((p) => "  - " + p).join("\n")); process.exit(1); }
    console.log("  " + files.length + " files, all under dist/ (+ root meta); one declaration tree; no tests");
  '
}
if [ "$BUILT" = 1 ]; then run "Tarball contents" check_tarball; else skip "Tarball contents"; fi

# ---- 7. sourcemaps are self-contained ------------------------------------
# `files:["dist"]` drops src/, but the maps must still resolve. Rollup embeds
# sourcesContent by default; assert it stayed that way (guards a future
# sourcemapExcludeSources regression that would ship dangling maps).
check_sourcemaps() {
  node -e '
    const fs = require("fs"), path = require("path");
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const maps = walk("dist").filter((f) => f.endsWith(".map"));
    if (!maps.length) {
      console.log("  no .map files shipped (nothing to check)");
    } else {
      const bad = maps.filter((m) => {
        const j = JSON.parse(fs.readFileSync(m, "utf8"));
        const sc = j.sourcesContent;
        return !Array.isArray(sc) || sc.length !== (j.sources || []).length || sc.some((s) => s == null || s === "");
      });
      if (bad.length) { console.error("  maps without embedded sources:\n" + bad.map((b) => "    " + b).join("\n")); process.exit(1); }
      console.log("  " + maps.length + " map(s), all embed full sourcesContent");
    }
  '
}
if [ "$BUILT" = 1 ]; then run "Sourcemap self-containment" check_sourcemaps; else skip "Sourcemap self-containment"; fi

# ---- 8. dependency hygiene ----------------------------------------------
# The removed deps must leave no residual imports, and js-yaml must resolve to
# a real 4.x (the branch moved off the patched 5.x).
check_no_dead_deps() {
  local hits
  hits=$(grep -rnE "from '(lodash|core-js)|import '(lodash|core-js)|require\('(lodash|core-js)" src 2>/dev/null || true)
  if [ -n "$hits" ]; then echo "  residual imports:"; echo "$hits" | sed 's/^/    /'; return 1; fi
  echo "  no lodash / core-js imports in src"
}
check_jsyaml_major() {
  node -e '
    const v = require("js-yaml/package.json").version;
    if (!/^4\./.test(v)) { console.error("  js-yaml resolved to " + v + " (expected 4.x)"); process.exit(1); }
    console.log("  js-yaml " + v + " (4.x, as pinned)");
  '
}
run "No dead-dep imports (lodash/core-js)" check_no_dead_deps
if [ "${SKIP_INSTALL:-0}" = 1 ] || [ -d node_modules/js-yaml ]; then
  run "js-yaml major is 4.x" check_jsyaml_major
else
  skip "js-yaml major is 4.x"
fi

# ---- 9. browser suite (opt-in — heavy, needs Playwright) -----------------
if [ "${RUN_BROWSER:-0}" = 1 ]; then
  run "Browser tests" yarn test:browser
else
  skip "Browser tests (set RUN_BROWSER=1 to include)"
fi

# ---- summary -------------------------------------------------------------
printf '\n%s──────────── summary ────────────%s\n' "$BLUE" "$OFF"
for r in "${RESULTS[@]}"; do printf '  %b\n' "$r"; done
if [ "$FAILED" = 0 ]; then
  printf '\n%sAll checks passed.%s\n' "$GREEN" "$OFF"; exit 0
else
  printf '\n%sOne or more checks failed.%s\n' "$RED" "$OFF"; exit 1
fi
