# Chrome Web Store / Edge Add-ons listing

Everything the submission forms ask for, kept in the repo so it can be reviewed and corrected
like anything else rather than living only in a web form. Copy it into the dashboards at upload
time.

Written against `manifest.json` and the code as they actually are — every claim below was checked,
not remembered. If you change the permissions, change this file in the same commit, because a
listing that overstates what an extension does is how a review gets rejected and a listing that
understates it is how one gets pulled.

---

## Identity

| field | value |
| --- | --- |
| Name | Mahaam |
| Category | Workflow & Planning |
| Language | English (primary), Arabic |
| Homepage | https://mahaam.app |
| Support | https://mahaam.app/support |
| Privacy policy | https://mahaam.app/en/legal/privacy (the extension section; `PRIVACY.md` has the detail) |

## Short description (132 char max)

**English** — 118 characters:

```
Track time, see what's next, and file an issue about the page you're on — without leaving the tab.
```

**Arabic**:

```
تتبّع وقتك، واعرف مهمتك التالية، وأبلغ عن مشكلة في الصفحة التي تتصفّحها — دون مغادرة التبويب.
```

## Full description

```
Mahaam is project management and time tracking. This extension puts the part you reach for most
often one click away.

• Start and stop your timer from the toolbar. The badge shows how long it has been running, and
  the timer stays in step with the Mahaam web app and the desktop tray in real time — start it in
  one, and the others catch up within a second.

• See what's next. Your assigned work, in the order you should work it, with a one-click start.

• File an issue about the page you're on. Right-click anywhere — or select some text first — and
  the page URL, your selection and a screenshot of what you were looking at come along with it.
  You see the screenshot before anything is sent, and one click removes it.

• Log time against the page you're on, for the work you just did on it.

• Works in English and Arabic, light and dark, and follows your system theme.

You need a Mahaam account. The extension talks only to your own Mahaam server — mahaam.app, or
your self-hosted install if you have one.

WHAT IT DOES NOT DO
It does not track your browsing. It does not inject anything into web pages. It cannot read the
text or the contents of the pages you visit.

The only things it ever sends about a page are the URL, the text you selected, and — when you pick
"File an issue for this page" — one screenshot of what was on screen at that moment, which you see
and can remove before it is sent. Nothing at all is sent while you simply browse.
```

**Arabic** — translate at upload; the "WHAT IT DOES NOT DO" section is the part that matters most
and must not be softened in translation.

---

## Permission justifications

Reviewers read these closely. Each is written against the line of code that needs it.

| permission | why | reviewer note |
| --- | --- | --- |
| `storage` | Keeps the API URL, the signed-in email and the chosen workspace, so the popup does not ask again on every open. | The credential is **not** kept here. It lives in `chrome.storage.session`, which is memory-only and cleared when the browser closes. |
| `alarms` | One alarm a minute refreshes the running timer so the toolbar badge is correct while the popup is shut. | Without it the badge would only update while the popup is open, which defeats the point of a badge. |
| `contextMenus` | Adds "File an issue for this page" and "Log time on this page" to the right-click menu. | The menu item is the whole page-capture feature. |
| `activeTab` | Takes one screenshot of the visible tab when the user picks "File an issue for this page", so the report shows what they were looking at. | Granted by the browser **only for that click**, on **only that tab**, and it lapses immediately. It is not requested at install and browsing never triggers it. The user sees the screenshot before sending and can remove it. No screenshot is taken for "Log time". |
| `optional_host_permissions`: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Reaching the user's own Mahaam server. | **Optional and requested at sign-in for one origin only** — the host the user typed. Mahaam is self-hostable, so the manifest cannot name the host in advance. Localhost is there for people running Mahaam on their own machine. |

Three things worth stating plainly in the review notes, because they are unusual in a good way:

- **No `tabs`, no `scripting`, and no content scripts.** The extension cannot read the text, DOM or
  form fields of any page. The URL and selection come from the context-menu event, which Chrome
  hands over precisely because the user chose the menu item. `activeTab` is requested, and is used
  for exactly one thing: a single screenshot of the visible tab at the moment the user asks to file
  an issue about it.
- **No broad host permission is granted at install.** The `https://*/*` pattern is *optional* and
  narrowed to a single origin at the moment of sign-in (`ext.ts` → `chrome.permissions.request`).
- **No remote code.** The CSP is `script-src 'self'`; everything ships in the package.

## Review notes (paste into "Notes for reviewers")

```
Sign-in is required to see anything beyond the sign-in form. A test account is available on
request — please ask and we will send credentials rather than post them here.

The extension talks to one origin: the Mahaam server the user names at sign-in. The default,
console.mahaam.app, is the only host granted at install; any other origin is requested at sign-in.

"Continue with Mahaam in this browser" signs in accounts that use Google or GitHub (they have no
password): the popup asks the Mahaam server for a revocable token, and the request carries the
session the user already has on that site. The extension has no cookies permission and never reads
a cookie itself.

There are no content scripts. "File an issue for this page" uses the contextMenus event, which
carries the page URL and the user's text selection, plus chrome.tabs.captureVisibleTab under the
activeTab grant that click provides — one screenshot of the visible area, shown to the user before
sending and removable. The page DOM and its text are never read.
```

---

## Screenshots (1280×800 or 640×400, 5 max)

The e2e run already produces two of these: `apps/extension/e2e-shots/`. Capture the rest the same
way so they show real data rather than a mock.

1. **Popup, timer running** — badge visible in the toolbar. (`ext-running.png`)
2. **Popup, "Next up"** — a few assigned tasks with start buttons.
3. **Right-click menu** on an ordinary page, showing both Mahaam items.
4. **Page card** after choosing "File an issue for this page". (`ext-page.png`)
5. **Arabic, dark** — the same popup, to show RTL is first-class and not an afterthought.

Use the local stack (`apps/extension` e2e against a seeded workspace) rather than production, so
no real customer data appears in a public listing.

## Before uploading

- [ ] Version bumped in **both** `manifest.json` and `package.json` — they must agree,
      and the store rejects a re-upload of an existing version.
- [ ] `npm run build` with `MAHAAM_API_URL` unset, so the default production host is compiled in.
- [ ] Icons present in `dist/icons/` — they are generated by `scripts/icons.mjs` at build time and
      are gitignored, so a packaged zip built without running the build step will be missing them.
- [ ] Privacy policy live at the URL above (`web/content/legal.ts`, with the draft notice removed after review).
- [ ] Data-use disclosures in the dashboard match `PRIVACY.md`.

## Still blocked

Uploading needs a Chrome Web Store developer account (one-off 5 USD) and an Edge Partner Center
account. Neither exists yet, and I cannot create them.
