#!/usr/bin/env bash
# Publish a built game as game.zip (index.html at the zip root) on a GitHub Release, marked latest, so
# LocalArcade installs it as a download instead of building it from source.
#
#   release.sh <dist-folder>
#
# Env: GH_TOKEN (needs contents: write), GH_REPO (owner/name), GITHUB_SHA, VERSION (from check.mjs,
# <package.json version>+<short commit>), TITLE (optional), KEEP (build releases to keep, default 5, 0 keeps all).
# The tag is v<version>-<short commit>, so it changes on every build: LocalArcade compares the latest tag to
# spot updates. Failing to publish fails the job; failing to remove old releases only warns.
set -uo pipefail

fail() {
  echo "::error::$1"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "❌ $1" >> "$GITHUB_STEP_SUMMARY"
  exit 1
}

dist="${1:-}"
[ -n "${VERSION:-}" ] || fail "No VERSION, so nothing was published."
[ -f "$dist/index.html" ] || fail "No index.html in '$dist', so nothing was published."
sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
tag="v${VERSION//+/-}"
keep="${KEEP:-5}"
tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/release.XXXXXX")" || fail "Couldn't make a temp folder, so nothing was published."
zip="$tmp/game.zip"

(cd "$dist" && zip -qrX "$zip" .) || fail "Couldn't zip $dist, so nothing was published."
mb=$(awk -v b="$(wc -c < "$zip")" 'BEGIN { printf "%.1f", b / 1048576 }')

if gh release view "$tag" >/dev/null 2>&1; then
  # A re-run of the same commit: swap in the new zip.
  out=$( { gh release upload "$tag" "$zip" --clobber && gh release edit "$tag" --latest; } 2>&1 ); rc=$?
else
  notes="Web build of ${sha:0:7} for [LocalArcade](https://github.com/largo-labs/localarcade): \`game.zip\` holds \`index.html\` at its root. Built, checked and smoke-tested by [itch-publish](https://github.com/largo-labs/itch-publish)."
  out=$(gh release create "$tag" "$zip" --target "$sha" --title "${TITLE:+$TITLE }$VERSION" --notes "$notes" --latest 2>&1); rc=$?
fi
if [ "$rc" -ne 0 ]; then
  echo "$out"
  if grep -qiE 'not accessible by integration|HTTP 403' <<< "$out"; then
    fail "Not published: the workflow token can't write releases. Add 'permissions: contents: write' to the workflow (see the itch-publish README)."
  fi
  fail "Not published: gh failed (see the log above)."
fi

echo "✓ Released $tag (game.zip, $mb MB)"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "tag=$tag" >> "$GITHUB_OUTPUT"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "### Released [$tag](https://github.com/${GH_REPO:-}/releases/tag/$tag) (game.zip, $mb MB) for LocalArcade" >> "$GITHUB_STEP_SUMMARY"

# Keep the newest $keep build releases (tags shaped v<version>-<7-char sha>). Hand-made releases are left alone.
if [[ "$keep" =~ ^[0-9]+$ ]] && [ "$keep" -gt 0 ]; then
  old=$(gh release list --limit 100 --exclude-drafts --json tagName,createdAt \
    --jq "[.[] | select(.tagName | test(\"^v.+-[0-9a-f]{7}\$\"))] | sort_by(.createdAt) | reverse | .[$keep:] | .[].tagName") \
    || { echo "::warning::Couldn't list releases, so old ones were kept."; exit 0; }
  for t in $old; do
    gh release delete "$t" --yes --cleanup-tag && echo "  removed old release $t" || echo "::warning::Couldn't remove old release $t"
  done
fi
exit 0
