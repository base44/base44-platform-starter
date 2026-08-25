# Per-user Base44 identity: service principals and minted tokens

How your platform acts on Base44 *as each of your own users*. This is step 2 of the
[README](../README.md) walkthrough, in full.

Reference implementation: `src/lib/base44Link.ts` (the only module that reads or writes tokens) and
`src/app/api/base44/link/route.ts` (the three-action route in front of it).

---

## The problem

Your product has users. Those users build Base44 apps through your UI. Who owns the apps?

**One shared API key** is the tempting answer and the wrong one:

- every app ever built belongs to a single account, so "show me my apps" is impossible;
- there's no offboarding — you can't remove one user's access without breaking everyone's;
- one leaked key is the whole platform.

**Real Base44 accounts per user** (SSO-provisioning each user's actual email as a workspace member,
then minting for it) works, but produces login-capable accounts for people who never asked for one,
and a key that can both provision and mint those is an impersonate-anyone primitive.

**Service principals** are the middle path, and what this repo uses.

## What a service principal is

A workspace-owned robot identity, one per end user, that can never log in:

- no password;
- no SSO external id, so no login path can resolve it;
- a synthetic, non-routable address — `{slug}-{hash}@{workspaceId}.svc.base44.invalid`. RFC 2606
  reserves `.invalid`, so it can never receive mail;
- addressed by an **opaque `service_external_id` that you choose**;
- default role `editor`, clamped by the workspace to the vendable ceiling.

Everything below follows from "it's a robot, not a person."

---

## Choosing the external id

```ts
// src/lib/base44Link.ts
export function principalId(email: string): string {
  const digest = createHash("sha256").update(`${orgId()}:${email.toLowerCase()}`).digest("hex");
  return `sunny-${digest.slice(0, 32)}`;
}
```

Three properties, each load-bearing:

**Deterministic, not random.** The id is your only handle on the principal that owns a user's apps.
If it were random and stored only on the link row, disconnecting (which deletes the row) and
reconnecting would provision a *second* principal — and strand the first one's apps under an
identity nothing points at any more. Recomputing from the email means reconnect always lands on the
same principal.

**Not the email.** Base44 builds the principal's address out of this value. Passing a real address
is exactly the impersonation surface the synthetic design removes, and it would publish every one of
your users' email addresses in the workspace member list.

**Unsalted.** This is an identifier, not a credential — knowing it buys nothing without a workspace
key, and a secret salt would be one more thing whose loss orphans every principal. The workspace id
is in the hash so the same person in a different workspace is a different principal.

The same reasoning applies to `display_name`: it reaches the workspace member list, so keep the real
address out of it. The workspace admin sees an opaque robot; the id ↔ person mapping lives in your
database, which is where it belongs.

---

## The endpoints

All three take the workspace API key in `Authorization` **bare — no `Bearer` prefix**. That's the
format Base44's workspace-key auth accepts; `Bearer` is for the *minted* tokens.

### Provision

```http
POST {BASE44_PLATFORM_HOST}/api/service/users
Authorization: {BASE44_PROVISION_KEY}
Content-Type: application/json

{ "service_external_id": "sunny-9f2c…", "display_name": "Sunny user 9f2c…" }
```

```json
{
  "service_external_id": "sunny-9f2c…",
  "user_id": "…",
  "email": "sunny-9f2c…@{workspaceId}.svc.base44.invalid",
  "role": "editor",
  "created": true
}
```

Scope: `service_users:provision`. Idempotent on `(workspace, service_external_id)` — an existing
principal returns `created: false`, so calling it on every Connect is safe.

Send **no `role`**: the endpoint defaults to `editor` and clamps anything above the vendable ceiling
anyway, so naming it adds a field you can get wrong for no capability you don't already have.

| Status | Meaning | What to do |
| --- | --- | --- |
| `403` | The workspace isn't enabled for this (an enterprise capability plus a launch allowlist) | Surface it as configuration, not a user error |
| `409` | Something already occupies the synthetic address | **Refuse.** The address is workspace-namespaced and non-routable, so a pre-existing occupant with no membership is an anomaly, not an account to adopt |
| `2xx` with a non-`.invalid` address | Upstream handed you a *real* account | Refuse. Assert the domain before you mint — otherwise you're about to vend a token that acts as a human |

### Mint

```http
POST {BASE44_PLATFORM_HOST}/api/service/user-tokens
Authorization: {BASE44_SVC_KEY}
Content-Type: application/json

{ "service_external_id": "sunny-9f2c…" }
```

```json
{ "access_token": "…", "refresh_token": "…", "expires_in": 3600 }
```

Scope: `user_tokens:mint`. No OAuth dance — no redirect, no consent screen, no PKCE.

- The body carries **only** the external id. There's no `scope` field: the endpoint pins
  `apps:read apps:write offline` itself, because REST enforces no scopes and a narrower string would
  advertise a boundary it can't honour.
- The workspace comes from the **key**, never the request. That's the cross-tenant guarantee: there
  is nothing in the request that could point at another workspace.
- **Mint never auto-provisions.** Unknown principal → `404`.
- Tokens live ~1h. (The platform default is far longer; short is better — see
  [revocation](#revocation-and-offboarding).)
- Rate limit: ~60 mints/60s **per workspace**, shared across all your users. At one mint per active
  user per hour that's roughly 3600 concurrent users of headroom. If it ever binds, the fix is the
  refresh exchange, not a longer TTL.

### Revoke (refresh token only)

```http
POST {BASE44_PLATFORM_HOST}/oauth/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token}&client_id=svc_delegate
```

RFC 7009. Only the refresh token is revocable — the access token is a self-contained JWT and stays
valid until it expires. Best-effort: a failed revoke must not strand the user in a linked state they
can't leave.

`client_id` must be a **non-MCP** prefix. A token whose `client_id` starts with one of Base44's MCP
prefixes (`chatgpt_`, `claude_`, `cursor_`, `oauth_`) is rejected everywhere except `/mcp` — see the
`403 "scoped to MCP"` case in [base44-platform-api.md](base44-platform-api.md).

### Deprovision

```http
DELETE {BASE44_PLATFORM_HOST}/api/service/users/{service_external_id}
Authorization: {BASE44_PROVISION_KEY}
```

Scope: `service_users:provision`. Idempotent — a `404` is a no-op.

This is the real offboarding lever: the workspace grant is re-validated on **every** request, so
outstanding access tokens start failing on their next call rather than living out their hour.

It also **deletes the principal and transfers its apps to the workspace owner**. So it's an
offboarding action ("this person has left the company"), not a UI toggle ("unlink my account"). In
this repo it's exported (`deprovisionPrincipal()`) but deliberately not wired to a route.

---

## Why the two keys are worth splitting

`BASE44_SVC_KEY` (mint) sits on the hot path — every re-mint, every hour, every active user. The
provision key is used twice in an account's lifetime.

A mint-only key can vend tokens for principals that already exist but cannot *create* one, so it can
never become an impersonate-anyone primitive. And it's what makes deprovision stick: with a
provision-capable key on the hot path, a removed user presses Connect, gets re-provisioned, and the
offboarding quietly undoes itself.

`BASE44_PROVISION_KEY` defaults to `BASE44_SVC_KEY` when unset, so a single-key deployment works.
Split them when you go to production.

---

## The lifecycle

```
connect      provision (idempotent) ─► mint ─► store row {status: linked, token, expiresAt}
             ▲ order matters: mint 404s on an unknown principal and will not create one

use          expiry within 5 min?  ─► re-mint, then call
             mid-call 401?         ─► re-mint once, retry once, else 428 reauthorize_required

disconnect   revoke refresh token (best effort) ─► delete the row
             ✗ does NOT deprovision — the principal owns the user's apps

offboard     deprovisionPrincipal() ─► grant dies, outstanding tokens fail on next call
```

### Refresh: re-mint, don't exchange

Minted tokens do come with a refresh token, but this repo re-mints instead of calling
`POST /oauth/token`. You already hold a mint-capable key, so asking for a new token is strictly
simpler: no rotation to persist correctly, no way to end up holding a refresh token the server has
already revoked. Both paths re-validate the workspace grant, so deprovisioning propagates either
way; the tie goes to fewer moving parts.

### Classify failures, or you'll force mass reconnects

This is the subtlest bit of the whole flow:

| Failure | Is the grant dead? | Action |
| --- | --- | --- |
| Network error / request never completed | No | Leave the row untouched; the next call retries |
| `429` (shared per-workspace mint limiter) | No — that's *other* users' traffic | Leave the row untouched |
| `408`, `5xx` | No | Leave the row untouched |
| Other `4xx` | Yes — principal deprovisioned, role no longer vendable, key lost its scope | Downgrade to `pending`, clear tokens, show Connect |
| Missing env var | Neither — it's a deployment fault | `501 bridge_misconfigured`; never report it as an expired connection |

Downgrading on a `429` converts one busy minute into a fleet-wide forced reconnect. Reporting a
missing env var as "your connection expired" sends users into a reconnect loop that cannot succeed.

Read config **before** the try block for exactly this reason — a missing variable should propagate
as a configuration error, not get caught and mislabelled as an upstream blip.

---

## Containment rules

The rules this repo holds itself to, all asserted by `npm run base44:smoke`:

1. **One module touches tokens.** `src/lib/base44Link.ts`. The generic entity CRUD refuses the
   `Base44Link` model outright, so no API can read it by accident.
2. **No function returns a token.** `linkStatus()` returns `{linked, base44_user_email,
   organization_id}` — booleans and display fields. A token leaves the module only as the
   `Authorization` header of a server-side fetch.
3. **Everything is keyed by the session email**, taken from the session and never from the request
   body. A user cannot connect, inspect or disconnect anyone else's link.
4. **The principal id sent upstream is opaque and never an email.**
5. **The provisioned address is asserted** to be in the reserved `.invalid` domain before any token
   is minted for it.

## Notes for your own port

- The user-visible connect step takes 5–15s (two upstream calls). Don't retry it blindly; it's
  idempotent, but the latency is real — show a spinner, disable the button.
- Store the workspace id from your own config, not by decoding the token. The mint endpoint pins the
  token to that workspace anyway, and the token is opaque by contract.
- A stored row with no principal id should still recompute one (it's derived, not stored). If no
  principal was ever created, the mint 404s — which is the intended outcome: one reconnect, which
  provisions.
