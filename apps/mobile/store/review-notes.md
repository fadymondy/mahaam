# Review notes

Paste the English block into App Store Connect → App Review Information → Notes, and into
Play Console → App access. Fill in the two demo accounts first (below).

---

Mahaam is a work tool for teams and their customers: project management, issue tracking and time
tracking. Everything happens inside a *workspace* that a company creates, and people join it by
invitation. What a person sees depends on their role in the workspace: staff get projects, issues,
time and the inbox; customers get a portal with their requests, updates and invoices.

To review both experiences, please sign in with these accounts. Two-step verification is off on both.

1. Staff (workspace admin): `<reviewer email>` / `<password>`
   Projects → open a project → tap an issue → start the timer. My work, Time (timesheet), Inbox and
   Search are the other tabs.
2. Customer: `<customer email>` / `<password>`
   Portal → a project → a request; Requests; Invoices; Updates.

Other things you may want to check:
- Create account: Sign in → "Create account". A new account verifies its email with a code. It
  can then create its own workspace ("Create a workspace") or wait for an invitation.
- Sign in with Apple, Google and GitHub are under the email form on both the sign-in and the
  "Create account" screen. On iPhone, "Continue with Apple" is Apple's native button, shown first
  and the same size as the others; Google and GitHub open in the system browser
  (ASWebAuthenticationSession), never in an in-app web view. On Android, Apple, Google and GitHub
  all open in the system browser (Custom Tabs).
- An account made with Apple, Google or GitHub has no password: to delete it (or other sensitive
  changes) the app emails a 6-digit code to the account's address instead.
- Account deletion: profile (the gear at the top of any tab) → Delete account. Deletion is
  immediate for sign-in and completes after 14 days. Signing in again within 14 days cancels it.
  For an account that used Sign in with Apple, deleting it also revokes the app's Sign in with
  Apple authorization (Apple's token revocation endpoint).
- There are no purchases in the app. Workspaces are billed on the web by their owners, and the app
  does not link to billing.
- Camera and photos are only used to attach images to issues and requests. Face ID is only used to
  unlock the app, and only if the person turns it on.

Support: info@3x1.io · https://console.mahaam.app/en/support

---

## Before submitting (owner)

The buttons only show what the server has configured (GET /api/auth/methods):

- Apple on iPhone needs nothing on the server (bundle id `com.fadymondy.mahaam`). Apple on Android
  and the web needs `APPLE_SERVICES_ID`; revocation on deletion needs `APPLE_TEAM_ID`,
  `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` (see `.env.example`). Without the key, say nothing about
  revocation above (delete the last sentence of the deletion bullet).
- Google and GitHub need `OAUTH_GOOGLE_*` / `OAUTH_GITHUB_*`. If they are off, Apple is the only
  provider button on iPhone and none shows on Android — update the bullet above to match.

## The demo accounts (owner, on production)

Create them by hand; nothing in the repo creates accounts on production.

1. On https://console.mahaam.app/en/register, create the staff account (e.g.
   `appreview@mahaam.app`), verify its email, and create a workspace "Mahaam Demo".
2. Add a few projects with issues across the columns, some time entries, and a project avatar or two.
3. Invite a second address (e.g. `appreview-customer@mahaam.app`) as a **customer**. Accept the
   invitation, then file a request or two from the portal. Issue an invoice from tracked time.
4. Keep two-step verification **off** on both, use long random passwords, and put the credentials
   only in App Store Connect and Play Console (never in git or on an issue).
5. After approval, rotate the passwords or keep the accounts for future reviews.
