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
- Sign in with Apple, Google or GitHub are on the sign-in screen. Google and GitHub open in the
  system browser.
- Account deletion: profile (the gear at the top of any tab) → Delete account. Deletion is
  immediate for sign-in and completes after 14 days. Signing in again within 14 days cancels it.
- There are no purchases in the app. Workspaces are billed on the web by their owners, and the app
  does not link to billing.
- Camera and photos are only used to attach images to issues and requests. Face ID is only used to
  unlock the app, and only if the person turns it on.

Support: info@3x1.io · https://console.mahaam.app/en/support

---

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
