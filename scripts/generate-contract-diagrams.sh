#!/usr/bin/env bash
#
# Generate contract relationship diagrams for local review:
#   - Slither: per-contract call graphs + a whole-project inheritance graph
#   - sol2uml: a cleaned UML class diagram
#
# Output goes to GIT-IGNORED folders so generated artifacts are never committed:
#   contracts/diagrams/generated/   (primary)
#   docs/diagrams/generated/        (copy, for browsing alongside the docs)
#
# Local developer tool. Prereqs (install once):
#   pipx install slither-analyzer     # slither
#   brew install graphviz             # dot (renders Slither .dot files)
#   npm install -g sol2uml            # optional; falls back to `npx sol2uml`
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
OUT_PRIMARY="$CONTRACTS_DIR/diagrams/generated"
OUT_DOCS="$REPO_ROOT/docs/diagrams/generated"

# Slither names its .dot output after the target path and drops the files next
# to it (the repo root). Always clean those strays, even on failure.
trap 'rm -f "$REPO_ROOT"/contracts.*.dot' EXIT

# --- resolve tools (pipx/brew put these off the default PATH on some setups) ---
SLITHER="$(command -v slither || true)"; [ -n "$SLITHER" ] || SLITHER="$HOME/.local/bin/slither"
DOT="$(command -v dot || true)"; [ -n "$DOT" ] || DOT="/opt/homebrew/bin/dot"

[ -x "$SLITHER" ] || { echo "ERROR: slither not found. Install: pipx install slither-analyzer" >&2; exit 1; }
[ -x "$DOT" ] || { echo "ERROR: graphviz 'dot' not found. Install: brew install graphviz" >&2; exit 1; }

if command -v sol2uml >/dev/null 2>&1; then
  SOL2UML=(sol2uml)
elif [ -n "$(npm prefix -g 2>/dev/null)" ] && [ -x "$(npm prefix -g)/bin/sol2uml" ]; then
  SOL2UML=("$(npm prefix -g)/bin/sol2uml")
elif command -v npx >/dev/null 2>&1; then
  SOL2UML=(npx --yes sol2uml)
else
  SOL2UML=()
fi

echo "==> Generating contract diagrams"
rm -rf "$OUT_PRIMARY" "$OUT_DOCS"
mkdir -p "$OUT_PRIMARY/slither" "$OUT_PRIMARY/sol2uml"

# --- contract deps (Slither needs the project to compile) ---
if [ ! -d "$CONTRACTS_DIR/dependencies" ]; then
  echo "==> Installing contract deps (forge soldeer install)"
  ( cd "$CONTRACTS_DIR" && forge soldeer install >/dev/null )
fi

# --- Slither: call graphs + inheritance graph ---
echo "==> Slither: call-graph + inheritance-graph"
rm -f "$REPO_ROOT"/contracts.*.dot
( cd "$REPO_ROOT" && "$SLITHER" contracts \
    --print call-graph,inheritance-graph \
    --filter-paths "dependencies/|/test/|/script/" \
    >"$OUT_PRIMARY/slither/slither.log" 2>&1 ) \
  || { echo "ERROR: slither failed; see $OUT_PRIMARY/slither/slither.log" >&2; exit 1; }

count=0
shopt -s nullglob
for dot in "$REPO_ROOT"/contracts.*.dot; do
  name="$(basename "$dot")"; name="${name#contracts.}"; name="${name%.dot}"
  "$DOT" -Tsvg "$dot" -o "$OUT_PRIMARY/slither/$name.svg" 2>/dev/null || true
  count=$((count + 1))
done
shopt -u nullglob
echo "    rendered $count Slither graph(s) (per-contract call graphs + inheritance)"

# --- sol2uml: cleaned UML class diagram ---
if [ "${#SOL2UML[@]}" -gt 0 ]; then
  echo "==> sol2uml: UML class diagram (cleaned)"
  if "${SOL2UML[@]}" class "$CONTRACTS_DIR/src" \
      --hidePrivates --hideEnums --hideStructs --hideLibraries \
      -f svg -o "$OUT_PRIMARY/sol2uml/class.svg" >/dev/null 2>&1; then
    echo "    wrote class.svg"
  else
    echo "    (sol2uml failed; skipped — install: npm install -g sol2uml)"
  fi
else
  echo "==> sol2uml not found (npm install -g sol2uml) — skipping class diagram"
fi

# --- publish a copy next to the docs ---
mkdir -p "$OUT_DOCS"
cp -R "$OUT_PRIMARY/." "$OUT_DOCS/"

echo ""
echo "Done. Open the SVGs (both folders are git-ignored):"
echo "  $OUT_PRIMARY"
echo "  $OUT_DOCS"
