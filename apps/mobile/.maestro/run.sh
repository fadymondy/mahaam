#!/bin/sh
# Fresh-install smoke run on one simulator: reinstall the dev build, point it at Metro, run a flow.
#   .maestro/run.sh <simulator-udid> [flow.yaml]   (Metro on :8081, local API on :8120)
set -e
D=${1:?simulator udid}
FLOW=${2:-.maestro/team-smoke.yaml}
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/MahaamTeam-*/Build/Products/Debug-iphonesimulator/MahaamTeam.app | head -1)
xcrun simctl terminate "$D" com.fadymondy.mahaam.team 2>/dev/null || true
xcrun simctl uninstall "$D" com.fadymondy.mahaam.team
# The Keychain (our session) outlives an uninstall on the simulator; a fresh run needs neither.
xcrun simctl keychain "$D" reset
xcrun simctl install "$D" "$APP"
# Skip the dev menu's onboarding sheet, which otherwise covers the first screen.
xcrun simctl spawn "$D" defaults write com.fadymondy.mahaam.team EXDevMenuIsOnboardingFinished -bool YES
xcrun simctl spawn "$D" defaults write com.fadymondy.mahaam.team EXDevMenuShowsAtLaunch -bool NO
xcrun simctl launch "$D" com.fadymondy.mahaam.team --initialUrl http://127.0.0.1:8081
~/.maestro/bin/maestro --device "$D" test "$FLOW"
