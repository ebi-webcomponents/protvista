#!/usr/bin/env bash
# Sync the safe subset of `main` into `next`.
# See docs/sync-from-main.md for policy, especially the "permanently-skipped"
# list and the per-path "never from main" rules.

set -e

# Commits we will never cherry-pick. Add to this list when a main commit is
# determined to be incompatible with next's architecture.
SKIP_SHAS=(
  4bab442  # Revert of config-approach. Would destroy next.
  1e316fb  # Picked manually as 6915a53/378269a; patch-id differs so git cherry won't detect it.
)

is_skipped() {
  local sha=$1
  for skip in "${SKIP_SHAS[@]}"; do
    if [[ "$sha" == "$skip"* ]]; then return 0; fi
  done
  return 1
}

current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" != "next" ]]; then
  echo "Refusing to run: must be on 'next' branch (currently on '$current_branch')"
  exit 1
fi

if [[ -n $(git status --porcelain) ]]; then
  echo "Refusing to run: working tree is not clean"
  exit 1
fi

echo "Fetching origin..."
git fetch origin --quiet

echo
echo "Commits in main not yet in next (oldest first, '+' = unpicked):"
echo

# git cherry uses patch-id matching to detect already-picked commits.
# We additionally walk the chronological list to keep order stable.
mapfile -t commits < <(git log --reverse --no-merges --format='%H %s' next..origin/main)

candidates=()
for line in "${commits[@]}"; do
  sha=${line%% *}
  short=${sha:0:7}
  subject=${line#* }

  if is_skipped "$short"; then
    printf "  SKIP    %s  %s\n" "$short" "$subject"
    continue
  fi

  # Has this patch already landed on next under a different SHA?
  if git cherry next origin/main | grep -q "^- $sha"; then
    printf "  picked  %s  %s\n" "$short" "$subject"
    continue
  fi

  printf "  PICK?   %s  %s\n" "$short" "$subject"
  candidates+=("$sha")
done

echo
if [[ ${#candidates[@]} -eq 0 ]]; then
  echo "Nothing to pick. next is in sync with main (modulo skipped commits)."
  exit 0
fi

echo "${#candidates[@]} candidate(s) above. To pick them all in order:"
echo
echo "  git cherry-pick ${candidates[*]}"
echo
echo "Pick interactively (recommended) so you can resolve conflicts one at a time."
echo "On conflict in a path listed under 'never from main' in docs/sync-from-main.md,"
echo "use \`git checkout --ours <path>\` and re-apply the intent manually if needed."
