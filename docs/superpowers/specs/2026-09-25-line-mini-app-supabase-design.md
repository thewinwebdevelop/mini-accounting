# LINE Mini App + Supabase Refactor Design

## Goal

Make the existing Sweet House accounting web app deployable as a LINE MINI App without rewriting its HTML forms and accounting workflows, while adding LINE-based authentication and preparing a safe migration from local SQLite/JSON/files to Supabase.

## Scope

This work is an incremental refactor on top of the current `local-server.mjs` and `forms/` application. The first production-capable slice establishes the authentication boundary, Supabase access boundary, deploy configuration, and migration contract. Existing local persistence remains available as a compatibility mode until the data migration is verified.

In scope:

- LINE MINI App entry and LIFF browser bootstrap.
- Server-side verification of LINE ID tokens.
- Signed, HttpOnly session cookie for same-origin requests from the existing pages.
- Application user records and roles in Supabase.
- A server-only Supabase REST client using `fetch`, with no Supabase secret in browser code.
- Authenticated `/api/auth/me` and `/api/auth/line-session` endpoints.
- Feature-flagged enforcement of authentication so existing local tests and local maintenance remain usable during migration.
- Supabase PostgreSQL schema for users, roles, document ownership/audit identity, and migration bookkeeping.
- A repeatable local-data migration contract for later document, inventory, and file migration.

Out of scope for the first slice:

- Rewriting all existing business logic into Supabase in one change.
- Replacing Google Drive/Sheets workflows.
- Redesigning every page for mobile.
- Treating a client-supplied LINE profile as authentication.
- Deploying or publishing a LINE channel from this repository.

## Architecture

The existing browser pages continue to call same-origin `/api/*` routes. A LINE MINI App bootstrap script initializes LIFF, obtains an ID token, and posts it to the backend. The backend verifies the token with LINE, resolves the application user from Supabase, and issues a signed HttpOnly session cookie. Existing browser `fetch` calls then continue to work without changing every controller at once.

The existing Node server remains the business-logic boundary. It owns PDF generation, Google integrations, lifecycle rules, and authorization decisions. Supabase is the durable cloud data layer and file store. The browser never receives the Supabase service-role key.

```text
LINE MINI App / LIFF browser
  └─ line-auth.browser.js
       └─ POST /api/auth/line-session (LINE ID token)
            └─ local-server.mjs
                 ├─ verify LINE token
                 ├─ resolve app user in Supabase
                 ├─ issue signed HttpOnly session
                 └─ existing /api/* handlers
                      ├─ current local compatibility adapter
                      └─ future Supabase data/file adapters
```

## Authentication and authorization

### Token verification

The browser sends only a LINE ID token. The server verifies it against LINE's token verification endpoint and checks the configured LINE channel/client ID, token expiry, and required subject. It does not accept a posted `userId`, display name, or picture as proof of identity.

### Session

The server signs a compact session payload with an HMAC secret held in `SWEET_HOUSE_SESSION_SECRET`. The cookie is:

- `HttpOnly`.
- `SameSite=Lax`.
- `Secure` when `NODE_ENV=production` or `SWEET_HOUSE_COOKIE_SECURE=1`.
- Expiring after `SWEET_HOUSE_SESSION_TTL_SECONDS`, defaulting to 12 hours.

Unsafe requests in enforced mode must include an allowed `Origin` matching `APP_PUBLIC_ORIGIN`; this prevents a third-party site from using the session cookie as a write primitive.

### Roles

The initial role set is `employee`, `owner`, `accounting`, and `admin`. The database stores one active role per app user for the first slice. Permission helpers are centralized so later resource-level rules can distinguish:

- employees creating and reading their own submissions;
- owners/accounting reviewing and approving;
- accounting receiving stock and syncing accounting outputs;
- admins managing users and configuration.

The first enforcement gate protects the API and exposes the authenticated user. Resource-level ownership filters are a follow-up migration task and must be completed before production access to multiple employees' sensitive documents.

### Compatibility mode

`SWEET_HOUSE_AUTH_MODE=disabled` is the default for current local tests and maintenance. `SWEET_HOUSE_AUTH_MODE=line` enables session enforcement for API routes while allowing the auth endpoints and Google/Shopee callback routes to operate as explicit exceptions. Production deployment must use `line`.

## Supabase boundary

The server uses a small REST client based on the built-in `fetch` API. This avoids adding a runtime dependency before the persistence migration is complete and keeps tests deterministic. The client requires:

- `SUPABASE_URL`.
- `SUPABASE_SERVICE_ROLE_KEY`, server-only.

The first migration creates `app_users`, `app_roles`, `app_user_roles`, and `migration_runs`. RLS is enabled on application tables. The service-role key is accepted only by backend code and never serialized to a response or served to the browser.

Future tables preserve existing document numbers and business statuses. Local numeric SQLite IDs are not exposed as cross-system identity; migration records keep source identifiers for traceability, while new cloud rows use UUIDs.

## Deployment contract

The deployed Node process must provide:

- public HTTPS endpoint;
- `APP_PUBLIC_ORIGIN` matching that endpoint;
- LINE MINI App LIFF ID for the active environment;
- `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` or the minimum token-verification configuration;
- `SWEET_HOUSE_SESSION_SECRET` with at least 32 random bytes;
- Supabase URL and server-only key;
- Google OAuth callback URL updated from localhost to the public origin;
- persistent Supabase Storage for PDFs, evidence, and product images.

The repository must not contain production secrets. `.env.example` documents names and safe placeholders only.

## Failure handling

- Missing LINE token: HTTP 401 with a stable Thai error code.
- Invalid/expired LINE token: HTTP 401 without echoing the token or provider response.
- Missing or inactive app user: HTTP 403 with an onboarding-required code.
- Missing auth configuration in `line` mode: HTTP 503 with an operator-safe message.
- Supabase outage while creating a session: HTTP 503; do not issue a session.
- Malformed or tampered cookie: treat as unauthenticated and clear it.
- Migration failure: record a failed migration run and never mark a source record migrated.

## Testing

Tests must cover token verification, channel/expiry checks, session signing and tamper rejection, cookie flags, role resolution, Supabase request headers, auth route behavior, auth-mode compatibility, and SQL schema constraints. Existing tests remain the regression suite; the pre-existing Shopee schema assertion failure is recorded separately until that user change is reconciled.

## Success criteria

1. A real LINE ID token can be exchanged for a session through `/api/auth/line-session` without trusting client profile data.
2. `/api/auth/me` returns the resolved app user and role, and rejects missing/tampered sessions.
3. `SWEET_HOUSE_AUTH_MODE=line` protects existing API calls while `disabled` preserves current local behavior.
4. Supabase schema and server client are present, tested, and secret-safe.
5. Existing document, inventory, PDF, and Google integration tests retain their current behavior except for the already-known Shopee baseline failure.
6. A later migration can move data and files incrementally without changing document numbers or accounting history.
