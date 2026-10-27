#!/usr/bin/env bash
# Assemble the Hugging Face Space from this repository.
#
#   deploy/build_space.sh [SPACE_DIR]
#
# SPACE_DIR is a clone of the Space repository (default: $BILHARZ_SPACE_DIR, or
# ~/bilharz-space). The script replaces only the paths it manages (listed in
# MANAGED below) and never touches .git or anything else in the Space. It does
# not commit or push. Safe to run repeatedly.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPACE="${1:-${BILHARZ_SPACE_DIR:-$HOME/bilharz-space}}"
PYTHON="${PYTHON:-$REPO/api/.venv/bin/python}"

fail() { echo "build_space: $*" >&2; exit 1; }

# --- Checks before touching anything ------------------------------------------
[ -d "$SPACE" ] || fail "Space directory not found: $SPACE (clone the Space first)"
SPACE="$(cd "$SPACE" && pwd)"
[ -d "$SPACE/.git" ] || fail "$SPACE is not a git clone of the Space (no .git)"
[ "$SPACE" != "$REPO" ] || fail "the Space directory must not be this repository"

ASSETS=(
  "api/assets/detector.pt"
  "api/assets/detector.onnx"
  "api/assets/tiles.zip"
  "api/assets/tiles_manifest.json"
  "api/assets/triage_config.json"
  "results/patient_scores.npz"
)
missing=()
for f in "${ASSETS[@]}"; do [ -s "$REPO/$f" ] || missing+=("$f"); done
[ ${#missing[@]} -eq 0 ] || fail "missing assets: ${missing[*]}"

command -v npm >/dev/null || fail "npm is required to build the frontend"
command -v rsync >/dev/null || fail "rsync is required"
"$PYTHON" -c "import numpy" 2>/dev/null \
  || fail "$PYTHON cannot import numpy (set PYTHON, or create api/.venv as in api/README.md)"

# --- Build the frontend --------------------------------------------------------
echo "• Building the frontend"
(cd "$REPO/frontend" && npm ci --no-audit --no-fund && npm run build)
[ -f "$REPO/frontend/dist/index.html" ] || fail "frontend build produced no dist/index.html"

# --- Replace the managed paths -------------------------------------------------
MANAGED=(app.py server.py requirements.txt README.md .gitattributes .gitignore bilharz assets static)
for p in "${MANAGED[@]}"; do rm -rf "${SPACE:?}/$p"; done

echo "• Copying the backend and the Space entry point"
rsync -a --exclude '__pycache__' --exclude '*.pyc' "$REPO/api/bilharz/" "$SPACE/bilharz/"
cp "$REPO/api/server.py" "$SPACE/server.py"
cp "$REPO/deploy/space/app.py" "$SPACE/app.py"
cp "$REPO/deploy/space/requirements.txt" "$SPACE/requirements.txt"
cp "$REPO/deploy/space/README.md" "$SPACE/README.md"

echo "• Copying the assets"
mkdir -p "$SPACE/assets"
for f in detector.pt detector.onnx tiles.zip tiles_manifest.json triage_config.json; do
  cp "$REPO/api/assets/$f" "$SPACE/assets/$f"
done
# The stored scores without the ground truth: the Space repository is public,
# and the app never needs the labels (y) or egg counts (eggs).
"$PYTHON" - "$REPO/results/patient_scores.npz" "$SPACE/assets/patient_scores.npz" <<'PY'
import sys
import numpy as np

source, target = sys.argv[1], sys.argv[2]
with np.load(source) as z:
    kept = {k: z[k] for k in ("S", "samples", "frames")}
np.savez_compressed(target, **kept)
with np.load(target) as z:
    assert sorted(z.files) == ["S", "frames", "samples"], z.files
PY

echo "• Copying the built site to static/"
rsync -a "$REPO/frontend/dist/" "$SPACE/static/"

cat > "$SPACE/.gitattributes" <<'EOF'
# Large binary files go through Git LFS (written by deploy/build_space.sh).
*.pt filter=lfs diff=lfs merge=lfs -text
*.onnx filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
*.npz filter=lfs diff=lfs merge=lfs -text
EOF

cat > "$SPACE/.gitignore" <<'EOF'
# Written by deploy/build_space.sh
data/
__pycache__/
*.pyc
.venv/
.env
EOF

echo "• Done. Space assembled in $SPACE:"
(cd "$SPACE" && du -sh "${MANAGED[@]}" 2>/dev/null | sed 's/^/    /')
echo "  Review with: git -C \"$SPACE\" status"
