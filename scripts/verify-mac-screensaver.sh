#!/bin/bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAVER="$ROOT/build/mac-screensaver/product/Signal Field.saver"
PROBE="$ROOT/.cache/ScreenSaverProbe"

if [[ "${1:-}" != "--no-build" ]]; then
  "$ROOT/scripts/build-mac-screensaver.sh"
fi
[[ -d "$SAVER" ]] || { echo "Missing built screen saver: $SAVER" >&2; exit 1; }

[[ "$(plutil -extract NSPrincipalClass raw -o - "$SAVER/Contents/Info.plist")" == "SoundMotionScreenSaverView" ]]
[[ "$(plutil -extract CFBundlePackageType raw -o - "$SAVER/Contents/Info.plist")" == "BNDL" ]]
[[ "$(plutil -extract CFBundleDisplayName raw -o - "$SAVER/Contents/Info.plist")" == "Signal Field" ]]
[[ -f "$SAVER/Contents/Resources/en.lproj/Localizable.strings" ]]
[[ -f "$SAVER/Contents/Resources/zh-Hans.lproj/Localizable.strings" ]]
file "$SAVER/Contents/MacOS/Signal Field" | grep -q "universal binary"
lipo -archs "$SAVER/Contents/MacOS/Signal Field" | grep -q "x86_64 arm64\|arm64 x86_64"
codesign --verify --deep --strict "$SAVER"
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p)); if(m.version!==3||m.strideBytes!==12||m.patternCount<=8) process.exit(1)' "$SAVER/Contents/Resources/metadata.json"

xcrun swiftc \
  -swift-version 5 \
  -target arm64-apple-macosx13.0 \
  -framework AppKit \
  -framework ScreenSaver \
  "$ROOT/scripts/ScreenSaverProbe.swift" \
  -o "$PROBE"
"$PROBE" "$SAVER"

echo "macOS screen saver verification passed: $SAVER"
