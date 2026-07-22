#!/usr/bin/env bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.pages}"

if [[ "$OUT" == "$ROOT" || "$OUT" == "/" || -z "$OUT" ]]; then
  echo "Refusing to replace unsafe Pages output path: $OUT" >&2
  exit 1
fi

rm -rf -- "$OUT"
mkdir -p "$OUT"
cp "$ROOT/index.html" "$OUT/index.html"
cp -R "$ROOT/app" "$OUT/app"
cp -R "$ROOT/website" "$OUT/website"
cp "$ROOT/LICENSE" "$OUT/LICENSE"
cp "$ROOT/ASSET_LICENSE.md" "$OUT/ASSET_LICENSE.md"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$OUT/THIRD_PARTY_NOTICES.md"
cp "$ROOT/UPSTREAM_NOTICE.md" "$OUT/UPSTREAM_NOTICE.md"
cp "$ROOT/MODIFICATIONS.md" "$OUT/MODIFICATIONS.md"
cp -R "$ROOT/LICENSES" "$OUT/LICENSES"
mkdir -p "$OUT/desktop/assets"
cp "$ROOT/desktop/assets/signal-field-icon.png" "$OUT/desktop/assets/signal-field-icon.png"
find "$OUT" \( -name .DS_Store -o -name '._*' \) -delete

printf 'Built GitHub Pages artifact: %s\n' "$OUT"
