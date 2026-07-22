#!/usr/bin/env bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist/release}"

if [[ "$OUT" != /* ]]; then
  OUT="$ROOT/$OUT"
fi
if [[ -z "$OUT" || "$OUT" == "/" || "$OUT" == "$ROOT" ]]; then
  echo "Refusing to replace unsafe release output path: $OUT" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ARTIFACTS="$STAGE/artifacts"
mkdir -p "$ARTIFACTS"

npm run build:pages
WEB_STAGE="$STAGE/Signal-Field-Web"
ditto "$ROOT/.pages" "$WEB_STAGE"
ditto -c -k --norsrc --keepParent "$WEB_STAGE" "$ARTIFACTS/Signal-Field-Web.zip"

"$ROOT/node_modules/.bin/electron-builder" \
  --mac \
  --arm64 \
  --dir \
  --publish never \
  --config.mac.identity=null
MAC_APP="$ROOT/dist/mac-arm64/Signal Field.app"
[[ -d "$MAC_APP" ]] || { echo "Missing packaged Mac app: $MAC_APP" >&2; exit 1; }
ditto -c -k --sequesterRsrc --keepParent "$MAC_APP" "$ARTIFACTS/Signal-Field-Mac-Apple-Silicon.zip"

npm run build:screensaver:mac
npm run build:lock:mac
SAVER="$ROOT/build/mac-screensaver/product/Signal Field.saver"
LOCK_APP="$ROOT/build/mac-lock-launcher/Signal Field Lock.app"
[[ -d "$SAVER" ]] || { echo "Missing Mac screen saver: $SAVER" >&2; exit 1; }
[[ -d "$LOCK_APP" ]] || { echo "Missing Mac lock launcher: $LOCK_APP" >&2; exit 1; }

SAVER_STAGE="$STAGE/Signal-Field-Mac-Screen-Saver"
mkdir -p "$SAVER_STAGE"
ditto "$SAVER" "$SAVER_STAGE/Signal Field.saver"
ditto "$LOCK_APP" "$SAVER_STAGE/Signal Field Lock.app"
cp "$ROOT/LICENSE" "$SAVER_STAGE/LICENSE"
cp "$ROOT/ASSET_LICENSE.md" "$SAVER_STAGE/ASSET_LICENSE.md"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$SAVER_STAGE/THIRD_PARTY_NOTICES.md"
cp "$ROOT/UPSTREAM_NOTICE.md" "$SAVER_STAGE/UPSTREAM_NOTICE.md"
cp "$ROOT/MODIFICATIONS.md" "$SAVER_STAGE/MODIFICATIONS.md"
printf '%s\n' \
  'Signal Field screen saver / lock animation' \
  '' \
  '1. Double-click "Signal Field.saver" and confirm installation.' \
  '2. Open System Settings > Wallpaper > Screen Saver and select Signal Field.' \
  '3. Use "Signal Field Lock.app" to preview settings, randomize the pattern, and start the lock animation.' \
  '' \
  'These preview builds are ad-hoc signed but not Apple-notarized. If macOS blocks a launch,' \
  'use System Settings > Privacy & Security > Open Anyway after confirming this download came' \
  'from this Signal Field project release.' \
  > "$SAVER_STAGE/INSTALL.txt"
ditto -c -k --sequesterRsrc --keepParent "$SAVER_STAGE" "$ARTIFACTS/Signal-Field-Mac-Screen-Saver.zip"

rm -rf "$OUT"
mkdir -p "$OUT"
ditto "$ARTIFACTS" "$OUT"
(
  cd "$OUT"
  shasum -a 256 ./*.zip > SHA256SUMS.txt
)

for archive in "$OUT"/*.zip; do
  unzip -tq "$archive" >/dev/null
done

printf 'Built release artifacts:\n'
find "$OUT" -maxdepth 1 -type f -print | sort
