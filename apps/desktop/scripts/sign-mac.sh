#!/bin/sh
# Signs release/mac-arm64/Mahaam.app inside-out with a Developer ID identity given by its SHA-1
# hash (`security find-identity -v -p codesigning`). For keychains holding two certificates with the
# same name, where electron-builder's name-based signing fails as "ambiguous":
#   npx electron-builder --dir --mac --arm64 -c.mac.target=dir -c.mac.identity=null
#   scripts/sign-mac.sh <hash>
set -eu
ID="$1"
APP="${2:-release/mac-arm64/Mahaam.app}"
ENT=build/entitlements.mac.plist
sign() { codesign --force --timestamp --options runtime --entitlements "$ENT" --sign "$ID" "$1" 2>&1 | grep -v "replacing existing" || true; }
find "$APP/Contents/Frameworks" -type f -not -path "$APP/Contents/Frameworks/*.app/*" | while read -r f; do
  if file "$f" | grep -q Mach-O; then sign "$f"; fi
done
for fw in "$APP"/Contents/Frameworks/*.framework; do sign "$fw"; done
for h in "$APP"/Contents/Frameworks/*.app; do sign "$h"; done
sign "$APP"
codesign --verify --deep --strict "$APP" && echo "signed: $APP"
