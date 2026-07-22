#!/bin/bash
# Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$ROOT/build/mac-screensaver"
ASSET_ROOT="$ROOT/.cache/mac-screensaver-assets"
PRODUCT_ROOT="$BUILD_ROOT/product"
SAVER="$PRODUCT_ROOT/Signal Field.saver"
PROJECT="$ROOT/macos-screensaver/SoundMotionScreenSaver.xcodeproj"

rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT" "$ASSET_ROOT"
plutil -lint "$ROOT/macos-localization/en.lproj/Localizable.strings" "$ROOT/macos-localization/zh-Hans.lproj/Localizable.strings" >/dev/null

"$ROOT/node_modules/.bin/electron" "$ROOT/scripts/export-mac-screensaver-assets.cjs" "$ASSET_ROOT"

xcodebuild \
  -project "$PROJECT" \
  -target SoundMotionScreenSaver \
  -configuration Release \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  OBJROOT="$BUILD_ROOT/obj" \
  SYMROOT="$BUILD_ROOT/products" \
  CONFIGURATION_BUILD_DIR="$PRODUCT_ROOT" \
  build >/dev/null

mkdir -p "$SAVER/Contents/Resources"
ditto "$ASSET_ROOT/particles-msand.bin" "$SAVER/Contents/Resources/particles-msand.bin"
ditto "$ASSET_ROOT/particles-cosmic.bin" "$SAVER/Contents/Resources/particles-cosmic.bin"
ditto "$ASSET_ROOT/grain-atlas.png" "$SAVER/Contents/Resources/grain-atlas.png"
ditto "$ASSET_ROOT/metadata.json" "$SAVER/Contents/Resources/metadata.json"
ditto "$ROOT/macos-localization/en.lproj" "$SAVER/Contents/Resources/en.lproj"
ditto "$ROOT/macos-localization/zh-Hans.lproj" "$SAVER/Contents/Resources/zh-Hans.lproj"

codesign --force --deep --sign - "$SAVER" >/dev/null
codesign --verify --deep --strict "$SAVER"

echo "$SAVER"
