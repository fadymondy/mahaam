# CircleXO hub integration

Mahaam can run as an app on the CircleXO hub: hub sign-in next to Mahaam's own login, hub orgs
mapped to workspaces, hub-governed limits and billing for those workspaces, and hub-issued tokens
on the MCP endpoint. **All of it is off unless `CIRCLEXO_ISSUER` is set.** With it unset nothing
changes: the routes below (except the config probe) do not exist and no table is read.

Code: `internal/circlexo` (service, SSO, sync, webhooks, entitlements overlay), `internal/mcp/hub.go`
(federated MCP), `internal/limits/overlay.go`, wiring in `internal/server/circlexo.go`. Tests:
`internal/server/circlexo_test.go` (against the SDK's `circlexotest` hub), run by `make test-e2e`.

## Configuration

Names only; values live in the vault. See `.env.example`.

| Variable | Purpose |
| --- | --- |
| `CIRCLEXO_ISSUER` | The hub's base URL. Turns the integration on. |
| `CIRCLEXO_API_URL` | The hub's app API, when not the issuer. |
| `CIRCLEXO_APP_ID` | Mahaam's app id at the hub (also the token audience). |
| `CIRCLEXO_CLIENT_ID` | OIDC client id. |
| `CIRCLEXO_CLIENT_SECRET` or `CIRCLEXO_PRIVATE_KEY` + `CIRCLEXO_KEY_ID` | Client authentication (one of the two). |
| `CIRCLEXO_APP_KEY` | App API key: entitlements, tenants, org members. |
| `CIRCLEXO_WEBHOOK_SECRET` | Signing secret (`whsec_...`) for webhooks and provision/deprovision calls. Required. |
| `CIRCLEXO_SESSION_KEY` | Seals the sign-in state cookie. Empty: derived from `MAHAAM_SECRET_KEY`. |
| `CIRCLEXO_REDIRECT_URL` | Optional. Default `WEB_URL` (else `APP_URL`) + `/auth/circlexo/callback`. |
| `CIRCLEXO_BILLING_URL` | Optional. Hub billing page; `{slug}` is the org slug. Default `<issuer>/orgs/{slug}/billing`. |

A half-set or invalid configuration is logged at error level at boot and leaves the integration
disabled; Mahaam still starts.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /auth/circlexo/login` | public | Start sign-in (OIDC authorization code + PKCE). `?return_to=/local/path`. |
| `GET /auth/circlexo/callback` | public | Finish sign-in. Failures go to `/login?circlexo_error=<code>`. |
| `GET /auth/circlexo/logout` | public | Clear Mahaam's session cookie, then the hub's end-session. |
| `GET /sso/circlexo?org=<slug>` | public | The app launch URL the hub dashboard links to. |
| `POST /api/circlexo/events` | webhook signature | Hub webhooks (below). |
| `POST /api/circlexo/provision` | webhook signature | Create or return the workspace for an org (idempotent). |
| `POST /api/circlexo/deprovision` | webhook signature | Mark the org's link inactive. |
| `GET /api/circlexo/config` | public | `{"enabled": bool}`: the web login page shows the button only when true. Always mounted. |
| `/.well-known/oauth-protected-resource` | public | Existing; lists the hub issuer too when enabled. |
| `POST /api/mcp` | token | Existing; also accepts hub-issued access tokens. |

The provision and deprovision request/response shape (`{org_id, slug, name, locale}` in,
`{product_tenant_id, slug}` out, signed like a webhook) was designed by Mahaam: no hub code calls
those URLs yet. Confirm it against the hub before relying on it; the webhooks below are the
contractual path and do the same work.

Webhooks handled: `org.app_installed`, `org.app_removed`, `member.added`, `member.role_changed`,
`member.removed`, `session.revoked`, `entitlement.changed`, and any `subscription.*` (invalidate the
entitlement cache; `subscription.*` is not in the hub's event catalogue yet). Signatures are
verified (`webhook-id`, `webhook-timestamp`, `webhook-signature`), replays are dropped by id, and
a bad or missing signature is a 401 before anything runs.

## Tables (owner pool only, no RLS, no app-role grant)

`internal/db/schema/circlexo.sql`, plus the workspace FK in `internal/db/post/19o_circlexo.sql`.

- `circlexo_user_links`: hub subject to Mahaam user. Unique both ways (one subject per user, one user per subject).
- `circlexo_org_links`: hub org to workspace, with `status` `active` or `inactive`. Unique both ways.
- `circlexo_sessions`: hub session id, user and JWT `iat`, for `session.revoked`.
- `circlexo_webhook_events`: processed event ids.

## Mapping rules

**Sign-in.** In order: a linked subject signs in as its user; otherwise the hub must vouch for the
email (`email_verified`), or it is refused; a Mahaam account with that email is linked only if it
is usable (passwordless, or an address Mahaam itself verified), otherwise refused, so nobody can
register a stranger's address and inherit their hub sign-in; otherwise a passwordless account is
created and linked. Suspended or deleted accounts are refused. The session is Mahaam's normal
one, so every existing login method keeps working (dual login).

**Landing.** After sign-in the user lands in the workspace mapped to the token's org (or the org
named by the launch URL), added with their hub role. If the hub confirms the org has the app but
the install webhook has not arrived, the workspace is provisioned on the spot.

**Org to workspace.** One active workspace per org. Provision is idempotent: the same org returns
the same workspace, reactivating an inactive link. It reads the org and members from the hub,
creates the workspace and syncs members, then calls `ConfirmTenant` so the hub marks the install
active.

**Roles.** Hub `owner` maps to `owner`, `admin` to `admin`, anything else to `member`. A hub
`member` never demotes a Mahaam-only role (manager, client), and only lowers an owner or admin to
member. The last owner is never demoted or removed by the hub. `member.removed` suspends the
membership; it does not delete it. Removing the app marks the link inactive and deletes nothing:
the workspace, members and data stay, and it goes back to Mahaam's own plan logic.

## Entitlements and billing

For workspaces with an **active** link, `projects` and `members` (limits) and `client_portal`
(flag) come from the hub through the SDK cache; other plan features keep coming from Mahaam.
Fail-closed with a read-only grace: if the hub is unreachable, the last known answer is used for
the SDK's grace window with adds refused (`402 plan_read_only`, reads still work); past the window,
or when the hub has no entitlements for the org, the limits are zero. `entitlement.changed` and
`subscription.*` drop the cache. Unlinked workspaces are never touched.

Billing for a linked workspace is the hub's: `GET /api/w/billing` returns `hub_linked` and
`hub_billing_url`, checkout and portal return that URL, and the plan page shows "Manage billing in
CircleXO". Polar stays for unlinked workspaces and the Polar usage push skips linked ones. The
hub usage reporter is not wired because Mahaam's manifest declares no metered feature.

## Federated MCP

`/api/mcp` verifies a hub token against the hub's JWKS with audience = the app id, then maps the
subject through `circlexo_user_links` and the org through `circlexo_org_links` (active only), and
re-reads the workspace role on every call. An unlinked user, an unknown or deinstalled org, a
non-member, a token with no org or a service token is refused. `mgy_`/`mga_` tokens are unchanged.

Scopes: hub gateway scopes (`openid`, `org`, ...) do not describe tools, so a token naming Mahaam
scopes (`tasks:write`) gets exactly those; a token carrying an `act` chain (exchanged by the hub's
gateway for an agent) gets the working set in `hubAgentScopes`; any other hub token gets reads.
Everything is narrowed by the user's workspace role. The `act` chain is recorded on activity
entries as `changes.hub_actors`.

## Known limits

- Mahaam's 2FA is not asked for on hub sign-in: the hub is the identity provider and owns second factors.
- Mahaam's session is a stateless JWT, so logout ends it in this browser only. `session.revoked`
  works by remembering (user, `iat`) of hub-born sessions; two sessions of one user minted in the
  same second share an `iat`, so revoking one ends both. Password sessions are unaffected.
- No per-effect hub scopes exist for MCP tools; the mapping above stands in for them.
- The SDK's test hub omits `email_verified` from ID tokens and fixes org name/slug, so the e2e
  round trip only proves the unverified refusal; the linking matrix is tested by calling
  `FinishLogin` directly.

## SDK dependency

`github.com/circlexo/circlexo-go` is a private module. `go get` could not fetch it without
credentials, so `go.mod` has `replace github.com/circlexo/circlexo-go => ../circlexo-go`, a sibling
checkout. **That replace cannot work in `Dockerfile.api` or CI** (the path is outside the build
context). Before merging: remove the replace, `go get github.com/circlexo/circlexo-go@<version>`,
set `GOPRIVATE=github.com/circlexo/*`, and give the Docker build and the CI job a read token for
the private repo (owner action: create `CIRCLEXO_GO_TOKEN`, pass it as a build secret, and use it
in a `git config url.<...>.insteadOf` rewrite; do not bake it into an image layer).

## Owner cut-over checklist

1. Remove the `replace`, pin the SDK version, and add the private-module token to the Dockerfile and CI (above).
2. Register Mahaam at the hub; note the app id, client credentials, app key and webhook secret.
3. Register the redirect URI (`<WEB_URL>/auth/circlexo/callback`), the post-logout URI (`<WEB_URL>/login`), the launch URL (`<WEB_URL>/sso/circlexo`), the webhook URL (`<API>/api/circlexo/events`) and the provision/deprovision URLs.
4. Set the `CIRCLEXO_*` variables from `.env.example` in the environment (not the repo).
5. Run the migration (`make migrate` / `cmd/migrate`): creates the four tables and the FK.
6. Make sure `web` proxies `/auth/circlexo/*` and `/sso/circlexo` to the API (already in `web/next.config.mjs`).
7. Set `CIRCLEXO_ISSUER` last and restart: the login button appears and the routes mount. Check the boot log for "circlexo: hub integration enabled".
8. Install the app on a test org and confirm: a workspace appears, members sync, the hub shows the tenant active, limits and the billing link follow the hub plan.
