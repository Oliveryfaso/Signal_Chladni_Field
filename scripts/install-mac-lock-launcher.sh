#!/bin/bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/build/mac-lock-launcher/Signal Field Lock.app"
DESTINATION="/Applications/Signal Field Lock.app"
COLLIDING_DESTINATION="/Applications/Signal Field.app"
PREVIOUS_DESTINATION="/Applications/3D Chladni Plate.app"
LEGACY_DESTINATION="/Applications/Sound Motion Lock.app"

"$ROOT/scripts/build-mac-lock-launcher.sh"
pkill -x "Sound Motion Lock" 2>/dev/null || true
pkill -x "3D Chladni Plate" 2>/dev/null || true
pkill -x "Signal Field Lock" 2>/dev/null || true
rm -rf "$DESTINATION"
ditto "$SOURCE" "$DESTINATION"
codesign --verify --deep --strict "$DESTINATION"
rm -rf "$PREVIOUS_DESTINATION" "$LEGACY_DESTINATION"

if [[ -d "$COLLIDING_DESTINATION" ]] && \
   [[ "$(plutil -extract CFBundleIdentifier raw -o - "$COLLIDING_DESTINATION/Contents/Info.plist" 2>/dev/null || true)" == "com.signalfield.visualizer.lock" ]]; then
  rm -rf "$COLLIDING_DESTINATION"
fi

echo "$DESTINATION"
