# Mahaam browser extension — privacy

*The public policy is `https://mahaam.app/en/legal/privacy` (text in `web/lang/legal.{en,ar}.json`),
whose extension section agrees with this file; link that from both store listings. This file is the
extension's detail, kept in the repo so it changes in the same commit as the behaviour it
describes.*

---

## The short version

The Mahaam extension does not read the pages you visit and does not track your browsing. It talks
to one server — your own Mahaam — and only about things you explicitly do.

## What is stored on your device

| what | where | why |
| --- | --- | --- |
| Your Mahaam server address, your email, your selected workspace | `chrome.storage.local` | So the popup does not ask again every time you open it. None of it can sign anyone in. |
| Your access token | `chrome.storage.session` | To prove who you are to your Mahaam server. **Memory only** — it is never written to disk and is gone when you close the browser, so you sign in again next time. |

**Your password is never stored**, anywhere, at any point. Signing in exchanges it immediately for
a revocable access token scoped to this browser, and the password is discarded. You can revoke
that token from your Mahaam account at any time, which is the point of doing it this way.

## What is sent, and when

Only to the Mahaam server you signed in to. Nothing is sent anywhere else, and there are no
analytics, no telemetry and no third-party services of any kind in this extension.

| action | what is sent |
| --- | --- |
| Opening the popup | A request for your running timer and your assigned work. |
| Starting or stopping a timer | The timer change, and the task if you picked one. |
| **"File an issue for this page"** | The page's URL, its title, the text you had selected, **and a screenshot of the visible tab** — and only when you choose that menu item. The screenshot is shown to you first and can be removed with one click before anything is sent. |
| **"Log time on this page"** | The URL, title and selection, attached to a time entry. **No screenshot** — a time entry has nowhere to put one, so none is taken. |

That is the complete list. The page URL leaves your browser **only** when you deliberately choose
one of those two menu items. Browsing normally sends nothing.

## What the extension cannot do

These are structural, not promises — they follow from what the extension asks for:

- **It cannot read page content, except the one screenshot you ask for.** There are no content
  scripts, and it does not request `tabs` or `scripting`, so it cannot read the text, the DOM or
  the form fields of any page. It does request `activeTab`, which the browser grants *only for the
  tab you were on, and only for the moment you clicked "File an issue for this page"* — long
  enough to take one picture of the visible area. The grant is gone immediately afterwards, and
  browsing normally never triggers it.
- **It cannot reach arbitrary sites.** The only host permission is for your own Mahaam server,
  requested when you sign in and narrowed to that one origin.
- **It cannot run code from the internet.** Its content-security policy allows scripts only from
  the extension package.

## Site-usage tracking

Mahaam has considered a feature that would record which sites you spend time on, to attribute time
automatically. **It is not in this extension.** If it is ever built it will be opt-in, off by
default, and described here before it ships — and the permissions the extension requests would
have to change, which the browser would tell you about.

## Data we hold

Issues you file and time you log are stored in your Mahaam workspace, under your workspace's own
retention and access rules, the same as if you had created them in the web app. The extension adds
no separate store and no separate copy.

## Deleting your data

Signing out revokes the access token on the server and clears everything the extension kept
locally. Removing the extension clears the local side too. Issues and time entries already filed
live in your workspace — delete them there, as you would any other.

## Contact

info@3x1.io
