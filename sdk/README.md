# Mahaam Feedback SDKs

These are thin, dependency-light helpers for the Mahaam Feedback widget (`{BASE}/embed/v1.js`) and the public intake (`POST {BASE}/api/feedback/embed`).

| Stack | Package | Path |
|---|---|---|
| Laravel 10–12 (PHP ≥ 8.1) | `mahaam/feedback` | [laravel/](laravel/) |
| Node ≥ 18, Express, React, Next.js | `@mahaam/feedback` (+ `/react`) | [node/](node/) |
| Go (stdlib `net/http`) | `github.com/fadymondy/mahaam/sdk/go` | [go/](go/) |
| Python (Django, Flask, plain) | `mahaam-feedback` | [python/](python/) |

Every package provides:

- A script-tag helper that renders the HTML-escaped `<script src="{BASE}/embed/v1.js" data-key="pfk_..." data-locale="en|ar" defer></script>`.
- `report(title, body, type, priority, extra)`, which posts a server-side issue and returns its key (e.g. `MG-12`).
- An optional exception hook that reports unhandled errors as `bug`/`high`.

Configuration:

| Env var | Meaning |
|---|---|
| `MAHAAM_FEEDBACK_KEY` | Project public key `pfk_...` (Mahaam → project Settings → Feedback widget). Empty disables everything. |
| `MAHAAM_URL` | Mahaam base URL. Default: `https://console.mahaam.app` |
| `MAHAAM_APP_URL` | A URL on one of the key's **allowed origins**. Server-side calls send no `Origin` header, so this is sent as `page_url` and the intake checks it against the allowlist. |

Intake responses: `201 {"key":"MG-12"}`; `403` bad key or origin; `422` missing title; `429` rate limited.

To have an AI coding agent install the right SDK, paste [AGENT.md](AGENT.md) into it.
