#!/usr/bin/env bash
#
# Release the `next` branch (v5 beta) to npm's `beta` dist-tag.
#
# Automates the "Releasing next" steps in RELEASING.md:
#
#   1. preflight  — on `next`, clean, level with origin/next, release notes
#                   written and carrying the funding acknowledgement, version
#                   not already published or tagged, and (unless
#                   --prepare-only) npm and gh are logged in
#   2. prepare    — bump package.json, repin every jsDelivr reference and
#                   banner version, date the CHANGELOG's Unreleased heading
#   3. verify     — pnpm test && pnpm validate
#   4. commit     — "Release <version>"
#   5. publish    — after a confirmation prompt: push next, npm publish, tag,
#                   push the tag, create the GitHub prerelease from
#                   RELEASE_NOTES.md (which fires publish-starter-kit.yml),
#                   then purge jsDelivr for the new pins
#
# Usage (from anywhere in the repo):
#   pnpm release:next                  # 5.0.0-beta.N -> 5.0.0-beta.N+1
#   pnpm release:next 5.0.0-beta.7     # an explicit version
#   pnpm release:next --prepare-only   # stop after the commit; nothing leaves
#                                      # this machine
#
# Re-running after a failed publish step is safe: when HEAD is already the
# "Release <version>" commit, steps 2-4 are skipped, and each publish step is
# skipped if it already happened.
#
# Or invoke directly: ./scripts/release-next.sh

set -euo pipefail

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" || exit 2

BLUE=$'\033[1;34m'; GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
banner() { printf '\n%s==> %s%s\n' "$BLUE" "$1" "$OFF"; }
info() { printf '  %s\n' "$1"; }
die() { printf '%sError:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

PACKAGE=protvista-uniprot
BRANCH=next
REMOTE=origin
# Named explicitly: this clone has two remotes for the same repository, and
# gh would otherwise stop to ask which one to use.
GH_REPO=ebi-webcomponents/protvista
NOTES=RELEASE_NOTES.md
NOTES_TEMPLATE=scripts/release-notes-template.md

# The grant's Outputs Management Plan (section 7) requires this on every
# release, word for word. The template carries it and preflight refuses notes
# without it. src/__spec__/funding-acknowledgement.spec.ts fails if this copy,
# the template's or any other drifts, and runs this script with stub git, npm
# and gh to check that preflight refuses notes without it.
FUNDING_ACK='This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.'

# Every file that names the current version as a pin or a banner. Kept to an
# explicit list on purpose: other files mention past versions legitimately
# (CHANGELOG headings, the webinar video attached to the v5.0.0-beta.2
# release, specs/), and a repo-wide replace would rewrite them.
PINNED_FILES=(
  README.md
  starter-kit/index.html
  starter-kit/README.md
  starter-kit/recipes/extend-uniprot.yaml
  docs/src/content/docs/tutorial.md
  docs/src/content/docs/embed.md
  docs/src/content/docs/configure.md
)

PREPARE_ONLY=0
NEW_VERSION=
for arg in "$@"; do
  case "$arg" in
    --prepare-only) PREPARE_ONLY=1 ;;
    -h|--help) sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $arg" ;;
    *) [ -z "$NEW_VERSION" ] || die "more than one version given"; NEW_VERSION=$arg ;;
  esac
done

OLD_VERSION=$(node -p 'require("./package.json").version')

# ---- 1. preflight ----------------------------------------------------------
banner "Preflight"

[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] \
  || die "releases are cut from '$BRANCH'; you are on '$(git rev-parse --abbrev-ref HEAD)'."
[ -z "$(git status --porcelain)" ] \
  || die "the working tree has uncommitted changes. Commit or stash them first."

git fetch --quiet "$REMOTE" "$BRANCH"
BEHIND=$(git rev-list --count "HEAD..$REMOTE/$BRANCH")
[ "$BEHIND" = 0 ] || die "'$BRANCH' is $BEHIND commit(s) behind $REMOTE/$BRANCH. Pull first."

# Resuming: HEAD is already this script's release commit.
RESUMING=0
if [[ "$(git log -1 --format=%s)" =~ ^Release\ (.+)$ ]] \
   && [ "${BASH_REMATCH[1]}" = "$OLD_VERSION" ] \
   && [ -z "$NEW_VERSION" -o "$NEW_VERSION" = "$OLD_VERSION" ]; then
  RESUMING=1
  NEW_VERSION=$OLD_VERSION
  info "HEAD is already 'Release $NEW_VERSION'; resuming at the publish step."
fi

if [ -z "$NEW_VERSION" ]; then
  [[ "$OLD_VERSION" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-beta\.([0-9]+)$ ]] \
    || die "can't work out the next beta after '$OLD_VERSION'; pass the version explicitly."
  NEW_VERSION="${BASH_REMATCH[1]}-beta.$((BASH_REMATCH[2] + 1))"
fi
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$ ]] \
  || die "'$NEW_VERSION' is not a prerelease version; this script only publishes betas from '$BRANCH'."
TAG="v$NEW_VERSION"
info "version: $OLD_VERSION -> $NEW_VERSION"

if [ "$RESUMING" = 0 ]; then
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists."
  [ -n "$(npm view "$PACKAGE@$NEW_VERSION" version 2>/dev/null)" ] \
    && die "$PACKAGE@$NEW_VERSION is already on npm."
  grep -q '^## Unreleased$' CHANGELOG.md \
    || die "CHANGELOG.md has no '## Unreleased' heading to date."
fi

if [ ! -e "$NOTES" ]; then
  cp "$NOTES_TEMPLATE" "$NOTES"
  die "$NOTES was missing, so it has been started from $NOTES_TEMPLATE. Write the release notes in it (it is git-ignored), then run again."
fi
[ -s "$NOTES" ] || die "$NOTES is empty. Write the release notes first (it is git-ignored)."
cmp -s "$NOTES" "$NOTES_TEMPLATE" \
  && die "$NOTES is still the unedited template. Write the release notes first."
# Runs of whitespace are folded to one space, so a wrapped line still matches.
# A here-string, not a pipe: under pipefail, grep -q quitting early could fail
# the check with tr's SIGPIPE.
grep -qF "$FUNDING_ACK" <<< "$(tr -s '[:space:]' ' ' < "$NOTES")" \
  || die "$NOTES must carry the funding acknowledgement word for word (it is in $NOTES_TEMPLATE):
  $FUNDING_ACK"
info "release notes: $NOTES ($(wc -l < "$NOTES" | tr -d ' ') lines)"

if [ "$PREPARE_ONLY" = 0 ]; then
  NPM_USER=$(npm whoami 2>/dev/null) || die "not logged in to npm. Run 'npm login' first."
  info "npm user: $NPM_USER"
  gh auth status >/dev/null 2>&1 || die "not logged in to GitHub. Run 'gh auth login' first."
  info "gh: logged in"
fi

# ---- 2-4. prepare, verify, commit -------------------------------------------
if [ "$RESUMING" = 0 ]; then
  banner "Prepare $NEW_VERSION"

  npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
  info "package.json"

  for f in "${PINNED_FILES[@]}"; do
    grep -qF "$OLD_VERSION" "$f" || die "$f does not mention $OLD_VERSION; update PINNED_FILES in $0."
    perl -pi -e "s/\Q$OLD_VERSION\E/$NEW_VERSION/g" "$f"
    info "$f"
  done

  TODAY=$(date +%Y-%m-%d)
  perl -pi -e "s/^## Unreleased\$/## $NEW_VERSION — $TODAY/" CHANGELOG.md
  info "CHANGELOG.md: ## $NEW_VERSION — $TODAY"

  banner "Verify (pnpm test && pnpm validate)"
  pnpm test || die "pnpm test failed. Fix it, or 'git checkout .' to undo the bump."
  pnpm validate || die "pnpm validate failed. Fix it, or 'git checkout .' to undo the bump."

  banner "Commit"
  git add package.json CHANGELOG.md "${PINNED_FILES[@]}"
  [ -z "$(git diff --name-only)" ] \
    || die "the checks changed other tracked files; review 'git status' before releasing."
  git commit --quiet -m "Release $NEW_VERSION"
  info "$(git log -1 --format='%h %s')"
fi

if [ "$PREPARE_ONLY" = 1 ]; then
  printf '\n%sPrepared %s.%s Nothing has been pushed or published.\n' "$GREEN" "$NEW_VERSION" "$OFF"
  printf 'Run %spnpm release:next%s again to publish it.\n' "$BLUE" "$OFF"
  exit 0
fi

# ---- 5. publish ---------------------------------------------------------------
banner "Publish"
cat <<EOF
  This will, irreversibly:
    - push '$BRANCH' to $REMOTE
    - npm publish $PACKAGE@$NEW_VERSION (dist-tag: beta)
    - push tag $TAG and create the GitHub prerelease from $NOTES,
      which mirrors starter-kit/ to the template repo
EOF
read -r -p "  Publish $NEW_VERSION? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "  Stopped. The release commit is local; run again to publish."; exit 1; }

git push --quiet "$REMOTE" "$BRANCH"
info "pushed $BRANCH"

if [ -n "$(npm view "$PACKAGE@$NEW_VERSION" version 2>/dev/null)" ]; then
  info "$PACKAGE@$NEW_VERSION is already on npm; skipping npm publish"
else
  # npm, not pnpm: see RELEASING.md. prepack builds; prepublishOnly runs test:pack.
  npm publish
fi
npm dist-tag ls "$PACKAGE" | sed 's/^/  /'

if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
  info "tag $TAG is already on $REMOTE"
else
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    [ "$(git rev-parse "$TAG^{commit}")" = "$(git rev-parse HEAD)" ] \
      || die "local tag $TAG does not point at the release commit."
  else
    git tag "$TAG"
  fi
  git push --quiet "$REMOTE" "refs/tags/$TAG"
  info "pushed tag $TAG"
fi

if gh release view "$TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  info "GitHub release $TAG already exists"
else
  gh release create "$TAG" --repo "$GH_REPO" --verify-tag --prerelease --title "$TAG" --notes-file "$NOTES"
fi

# jsDelivr may have cached a 404 for the new pins if anything requested them
# before the publish. A failed purge is not a failed release.
curl -fsS -X POST https://purge.jsdelivr.net \
  -H 'content-type: application/json' \
  -d "{\"path\":[\"/npm/$PACKAGE@$NEW_VERSION/dist/protvista-uniprot.mjs\",\"/npm/$PACKAGE@$NEW_VERSION/dist/default-config.yaml\"]}" \
  >/dev/null && info "purged jsDelivr for $NEW_VERSION" \
  || info "${DIM}jsDelivr purge failed; ignore unless the starter kit shows 'Could not load the viewer'${OFF}"

printf '\n%sReleased %s.%s\n' "$GREEN" "$NEW_VERSION" "$OFF"
