# Releasing the Mahaam tray

## What is wired, and what is not

The build config is now correct: entitlements, a notarisation hook and a publish target all
exist, and `npx electron-builder --dir --win` produces a working unpacked app on a machine with
no certificates at all.

What is missing is the certificates, and they are the long-lead item — days to weeks, not
minutes. Nothing below can be hurried at the end of a release.

## The trap this replaced

`mac.hardenedRuntime: true` was set with **no entitlements, no notarize step and no identity**.
That combination builds cleanly and then either fails notarisation or ships an app that will not
launch on anyone else's Mac. It looked configured. It could not produce a distributable build.

If you change the signing config, prefer a failure at build time over a config that looks right.

## macOS

**Certificate:** a *Developer ID Application* certificate, from an Apple Developer Program
membership (99 USD/year). Not a "Mac App Store" certificate — that is a different one and will
not sign a directly-distributed app. Install it in the keychain of the build machine;
electron-builder finds it there.

**Notarisation** needs three environment variables, checked by `scripts/notarize.cjs`:

| variable | where it comes from |
| --- | --- |
| `APPLE_ID` | the Apple ID that owns the membership |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | developer.apple.com → Membership, a 10-character id |

Without them the hook prints a loud SKIPPED block naming what is missing and the build is left
unsigned. That is deliberate: a quiet skip is how an unnotarised build reaches a release page and
gets refused by Gatekeeper on every Mac but the one that made it.

`entitlements.mac.plist` is intentionally minimal — `allow-jit` because V8 cannot start without
it under the hardened runtime, and `network.client` for the main process. The entitlements people
copy in out of habit (`allow-unsigned-executable-memory`, `disable-library-validation`) are
absent, and adding one should require a reason written down here.

## Windows

**Certificate:** an OV or EV code-signing certificate. EV is worth the extra cost only because
SmartScreen reputation starts from zero with OV, and an unsigned or freshly-OV-signed installer
shows users a scary warning for the first few hundred downloads.

Point electron-builder at it with `CSC_LINK` (path or base64 of the .pfx) and `CSC_KEY_PASSWORD`.
Do not put either in `package.json`.

## Linux

Nothing to sign. AppImage and deb build as-is.

## Auto-update

`src/main/updates.ts`, using electron-updater against the GitHub releases of `fadymondy/mahaam`.

Three behaviours chosen on purpose:

- **Off unless packaged.** electron-updater cannot install an update whose signature does not
  match the running app, so an unsigned local build could never update itself — checking anyway
  would log an error every six hours and teach everyone to ignore the log.
- **Nothing downloads without asking.** The user gets a dialog naming the version.
- **Nothing installs until quit.** A tray timer that restarts itself mid-session loses whatever
  the person was typing, and "it vanished" is worse than being one version behind.

Set `MAHAAM_NO_UPDATES=1` to silence it in a packaged build under test.

## Release checklist

- [ ] Version bumped in `apps/tray/package.json`.
- [ ] `npm run build && npx electron-builder --publish always` on a machine with the certificates.
- [ ] macOS: confirm the notarize hook printed `[notarize] done`, not `SKIPPED`.
- [ ] Verify on a machine that has never run the app — this is the only check that catches a
      signing problem, because the build machine will happily run its own unsigned output.
- [ ] Confirm the previous version offers the update and installs it on quit.
