#!/bin/bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/build/mac-screensaver/product/Signal Field.saver"
DESTINATION="$HOME/Library/Screen Savers/Signal Field.saver"
PREVIOUS_DESTINATION="$HOME/Library/Screen Savers/3D Chladni Plate.saver"
LEGACY_DESTINATION="$HOME/Library/Screen Savers/Sound Motion.saver"
WALLPAPER_INDEX="$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist"
MIGRATOR="$ROOT/.cache/MigrateScreenSaverSelection"

BUILD_PRODUCT=true
OPEN_SETTINGS=true
for argument in "$@"; do
  [[ "$argument" == "--no-build" ]] && BUILD_PRODUCT=false
  [[ "$argument" == "--no-open" ]] && OPEN_SETTINGS=false
done

if [[ "$BUILD_PRODUCT" == true ]]; then
  "$ROOT/scripts/build-mac-screensaver.sh"
fi
[[ -d "$SOURCE" ]] || { echo "Missing built screen saver: $SOURCE" >&2; exit 1; }
mkdir -p "$(dirname "$DESTINATION")"
rm -rf "$DESTINATION"
ditto "$SOURCE" "$DESTINATION"
codesign --verify --deep --strict "$DESTINATION"

mkdir -p "$ROOT/.cache"
xcrun swiftc \
  -swift-version 5 \
  -target arm64-apple-macosx13.0 \
  "$ROOT/scripts/MigrateScreenSaverSelection.swift" \
  -o "$MIGRATOR"
"$MIGRATOR" "$WALLPAPER_INDEX" "$LEGACY_DESTINATION" "$DESTINATION"
"$MIGRATOR" "$WALLPAPER_INDEX" "$PREVIOUS_DESTINATION" "$DESTINATION"
rm -rf "$PREVIOUS_DESTINATION" "$LEGACY_DESTINATION"

pkill -x ScreenSaverEngine 2>/dev/null || true
pkill -f '/ScreenSaver.framework/PlugIns/legacyScreenSaver' 2>/dev/null || true
pkill -x WallpaperAgent 2>/dev/null || true

echo "$DESTINATION"
if [[ "$OPEN_SETTINGS" == true ]]; then
  open "x-apple.systempreferences:com.apple.Wallpaper-Settings.extension"
fi
