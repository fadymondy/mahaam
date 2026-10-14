# Mahaam — store kit (App Store + Google Play)

Everything the two stores ask for that is not code, in one place. The listing text is in `en/` and
`ar/` (one file per field, plus `listing.json`), checked against the stores' length limits.

| | |
|---|---|
| App name | Mahaam · مهام |
| Bundle id / package | `com.fadymondy.mahaam` |
| Apple team | JW9HJH86GC |
| Category | Business (primary) · Productivity (secondary) |
| Price | Free (no in-app purchases; plans are sold on the web and never linked from the app) |
| Privacy policy | https://console.mahaam.app/en/legal/privacy (ar: `/ar/legal/privacy`) |
| Terms (EULA) | https://console.mahaam.app/en/legal/terms |
| Support URL | https://console.mahaam.app/en/support |
| Marketing URL | https://mahaam.app |
| Account deletion URL (Play) | https://console.mahaam.app/en/delete-account |
| Contact | info@3x1.io |

- `review-notes.md`: what to paste into App Review / Play review notes, and the demo accounts.
- `privacy.md`: Apple's App Privacy answers and Google Play's Data safety answers. They match the
  app's privacy manifest (`app.config.ts` → `ios.privacyManifests`).
- `age-rating.md`: the questionnaire answers.
- `screenshots.md`: the sizes each store needs and which screens to shoot.

## In the app (done)

- Sign in, create an account (name + email + password, terms accepted), email verification by code.
- Two-step verification: set up (authenticator + recovery codes), sign in with a code or a
  recovery code, turn off (a recovery code works for a lost phone), new recovery codes.
- Forgot password → code by email → new password.
- Sign in with Apple (iOS, native) and Google/GitHub in the system browser (never a web view).
  Accounts made that way confirm sensitive changes with an emailed code, since they have no password.
- Profile: name, photo, time zone; change email (code); change password; language and theme;
  Face ID / fingerprint unlock; signed-in devices (sign any out); help and support; legal links.
- Delete account in the app (Apple 5.1.1(v)): password or emailed code, plus 2FA if on. There's a
  14-day grace period, during which signing in cancels it.
- A new account with no workspace can reach the profile (and delete itself), and can create a workspace.
- Permissions: camera and photos (attachments), Face ID, notifications. No microphone, no
  tracking, no ads.

## Before submitting (owner)

1. **Legal pages:** `web/content/legal.ts` has `LEGAL_REVIEWED = false`, so the pages show a
   "draft" banner. Have them reviewed, name the legal entity, then flip it.
   While you're there, align the policy with the app as it ships (`web/lang/legal.en.json`):
   - it says the app sends a push token (it doesn't yet);
   - it says Firebase Analytics or Crashlytics may be used (neither is installed).
   Store reviewers compare the policy with `privacy.md`.
2. **Apple developer portal:**
   - Enable *Sign in with Apple* on the App ID `com.fadymondy.mahaam` and regenerate the profiles.
   - Register the sending domain under *Sign in with Apple for Email Communication* (otherwise
     codes never reach private-relay addresses).
3. **App Store Connect:** create the app record, then fill in:
   - the listing (`en/`, `ar/`) and the App Privacy answers (`privacy.md`);
   - the age rating (`age-rating.md`) and the review notes plus demo accounts (`review-notes.md`);
   - the export compliance answer: uses only exempt encryption, since `ITSAppUsesNonExemptEncryption`
     is already false.
4. **Google Play Console:** create the app, then fill in:
   - the listing, the Data safety form (`privacy.md`) and the content rating;
   - the account deletion URL, target audience (18+ / business), and ads (none).
5. **Demo accounts:** create them by hand on the production web console, as described in
   `review-notes.md`. Nothing creates them automatically.
6. **Push notifications:** Firebase config for `com.fadymondy.mahaam`
   (`google-services.json`, `GoogleService-Info.plist`) and the APNs key. The files in
   `apps/mobile/secrets/` are for the retired `.team` / `.client` apps. Until then the app sends
   only local reminders, which is what the privacy answers say.
7. **Builds and upload:**
   - `eas.json` → `submit.production` needs the App Store Connect app id and a Play service account.
   - Or add store workflows to `codemagic.yaml`, which today only ships OTA updates.
   - Fill the Patch OTA keys (`plugins/with-app-updates.js`) before the first store build.
8. **Screenshots:** see `screenshots.md`.
