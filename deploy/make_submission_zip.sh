#!/usr/bin/env bash
# Build the submission ZIP outside the repository.
#
#   deploy/make_submission_zip.sh [--dry-run] [--report FILE] [--video FILE] [--out FILE]
#
# The ZIP holds a bilharz/ folder with every file tracked by git (as it is in
# the working tree) plus the model and tile files in api/assets/ that git
# ignores, and, at its top level, the report and video if given. Virtual
# environments, node_modules, build output, api/data/ (reviews), test-data/ and
# .env files are never included. Commit first: untracked files are left out.
# --dry-run lists what would be included without writing anything.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HOME/bilharz-submission.zip"
REPORT=""
VIDEO=""
DRY_RUN=0

fail() { echo "make_submission_zip: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --report) REPORT="${2:?--report needs a file}"; shift ;;
    --video) VIDEO="${2:?--video needs a file}"; shift ;;
    --out) OUT="${2:?--out needs a file}"; shift ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

for f in "$REPORT" "$VIDEO"; do
  [ -z "$f" ] || [ -s "$f" ] || fail "not found or empty: $f"
done
command -v zip >/dev/null || fail "zip is required"
OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)" || fail "folder not found for $OUT"
OUT="$OUT_DIR/$(basename "$OUT")"
case "$OUT" in "$REPO"/*) fail "the ZIP must be written outside the repository" ;; esac

# Large files git ignores but the app needs.
ASSETS=(api/assets/detector.onnx api/assets/detector.pt api/assets/tiles.zip)
for f in "${ASSETS[@]}"; do [ -s "$REPO/$f" ] || fail "missing asset: $f"; done

# Paths that must never be included, whatever git tracks.
EXCLUDE='(^|/)(\.venv|venv|node_modules|dist|__pycache__|\.pytest_cache|test-results|playwright-report)/|^api/data/|^test-data/|(^|/)\.env($|\.)|\.(pem|key)$|(^|/)\.DS_Store$'

LIST="$(mktemp)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$LIST" "$STAGE"' EXIT

(
  cd "$REPO"
  git ls-files -z | tr '\0' '\n'
  printf '%s\n' "${ASSETS[@]}"
) | grep -Ev "$EXCLUDE" | while IFS= read -r f; do
  [ -f "$REPO/$f" ] && echo "$f"   # skip files deleted in the working tree
done | sort -u > "$LIST"

changes="$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')"
[ "$changes" = 0 ] || echo "note: $changes uncommitted or untracked paths; untracked files are not included (git status)" >&2

echo "Contents of bilharz/:"
awk -F/ '{ top = (NF > 1 ? $1 "/" : $1); n[top]++ } END { for (t in n) printf "  %-28s %d files\n", t, n[t] }' "$LIST" | sort
total=$(cd "$REPO" && tr '\n' '\0' < "$LIST" | xargs -0 stat -f %z | awk '{ s += $1 } END { print s }')
echo "  $(wc -l < "$LIST" | tr -d ' ') files, $(awk -v b="$total" 'BEGIN { printf "%.1f MB", b / 1e6 }') before compression"
echo "Largest files:"
(cd "$REPO" && tr '\n' '\0' < "$LIST" | xargs -0 stat -f '%z %N' | sort -rn | head -5 \
  | awk '{ printf "  %8.1f MB  %s\n", $1 / 1e6, $2 }')
[ -n "$REPORT" ] && echo "Top level: report $(basename "$REPORT")"
[ -n "$VIDEO" ] && echo "Top level: video $(basename "$VIDEO")"

if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run: nothing written. Would write $OUT"
  exit 0
fi

# Stage through links, so the ZIP has bilharz/... and the extra files at its top level.
ln -s "$REPO" "$STAGE/bilharz"
[ -n "$REPORT" ] && ln -s "$(cd "$(dirname "$REPORT")" && pwd)/$(basename "$REPORT")" "$STAGE/$(basename "$REPORT")"
[ -n "$VIDEO" ] && ln -s "$(cd "$(dirname "$VIDEO")" && pwd)/$(basename "$VIDEO")" "$STAGE/$(basename "$VIDEO")"
rm -f "$OUT"
(
  cd "$STAGE"
  sed 's|^|bilharz/|' "$LIST"
  [ -n "$REPORT" ] && basename "$REPORT"
  [ -n "$VIDEO" ] && basename "$VIDEO"
  true
) | (cd "$STAGE" && zip -q -X "$OUT" -@)

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1), $(zipinfo -1 "$OUT" | wc -l | tr -d ' ') entries)"
