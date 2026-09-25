# LINE Mini App + Supabase Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deployable LINE MINI App authentication boundary and Supabase foundation while preserving the existing accounting workflows during incremental migration.

**Architecture:** Keep the current Node HTTP server and browser pages as the application boundary. Bootstrap LINE LIFF once per page/session, verify the LINE ID token server-side, resolve users through Supabase, and issue a signed HttpOnly cookie so existing same-origin API calls continue to work. Keep local persistence behind a compatibility flag until each domain is migrated.

**Tech Stack:** Node.js built-ins, CommonJS logic modules, `node:test`, vanilla HTML/JavaScript, Supabase PostgreSQL/REST/Storage, LINE LIFF/MINI App.

**Spec:** `docs/superpowers/specs/2026-09-25-line-mini-app-supabase-design.md`

## Global Constraints

- `SWEET_HOUSE_AUTH_MODE=disabled` remains the default for local compatibility; production must use `line`.
- The browser sends LINE ID tokens only; the server verifies them and never authenticates a client-supplied profile.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never appear in browser code, JSON responses, logs, or committed files.
- Existing document numbers, lifecycle statuses, PDF behavior, and Google Drive/Sheets flows remain compatible during migration.
- No source record is marked migrated until its database/file write and verification both succeed.
- The pre-existing `shopee_oauth_states` schema-test mismatch is not part of this branch's LINE work.

## Review Focus

- Invalid, expired, wrong-channel, or replayed LINE tokens must not create a session.
- A tampered, malformed, expired, or algorithm-confused cookie must be rejected and cleared.
- An inactive or missing app user must receive onboarding/forbidden behavior, not an implicit employee role.
- Auth mode disabled must not break the current local test harness; auth mode line must not allow unauthenticated API access.
- Supabase failures and missing secrets must fail closed without leaking provider responses or service credentials.

---

### Task 1: Supabase schema and server-only REST boundary

**Files:**
- Create: `supabase/migrations/20260925_001_line_auth.sql`
- Create: `forms/supabase.logic.js`
- Create: `tests/supabase.logic.test.mjs`
- Create: `.env.example`

**Interfaces:**
- Produces `createSupabaseAdminClient({ url, serviceRoleKey, fetchImpl })`, `supabaseRequest(client, path, options)`, and `assertSupabaseConfiguration(env)` for later auth code.
- Produces tables `app_roles`, `app_users`, `app_user_roles`, and `migration_runs` for the auth repository.

- [ ] **Step 1: Write the failing tests**

```js
test("supabaseRequest sends the server key and returns the first row", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ id: "u-1" }]), { status: 200 });
    },
  });
  const row = await supabaseRequest(client, "/rest/v1/app_users?line_user_id=eq%U-1", {
    headers: { Prefer: "return=representation" },
  });
  assert.deepEqual(row, [{ id: "u-1" }]);
  assert.equal(calls[0].options.headers.apikey, "server-secret");
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-secret");
});

test("supabaseRequest redacts provider response details on error", async () => {
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async () => new Response("secret database detail", { status: 500 }),
  });
  await assert.rejects(() => supabaseRequest(client, "/rest/v1/app_users"), error => {
    assert.equal(error.code, "SUPABASE_REQUEST_FAILED");
    assert.doesNotMatch(error.message, /secret database detail/);
    return true;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/supabase.logic.test.mjs`
Expected: FAIL because `forms/supabase.logic.js` does not exist.

- [ ] **Step 3: Add the minimal client and migration**

Implement `createSupabaseAdminClient` with normalized URL and server-only headers. Implement `supabaseRequest` using `fetchImpl`, JSON parsing, stable error codes, and no provider-body echo. Add SQL that creates the four tables, seeds the four roles, enables RLS, and revokes public access; only the backend service role is used in this first slice.

- [ ] **Step 4: Run focused and schema-text tests**

Run: `node --test tests/supabase.logic.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925_001_line_auth.sql forms/supabase.logic.js tests/supabase.logic.test.mjs .env.example
git commit -m "feat: add supabase server boundary for line auth"
```

### Task 2: LINE token verification and application user repository

**Files:**
- Create: `forms/line-auth.logic.js`
- Create: `tests/line-auth.logic.test.mjs`
- Modify: `forms/supabase.logic.js`

**Interfaces:**
- Consumes `createSupabaseAdminClient` and `supabaseRequest` from Task 1.
- Produces `verifyLineIdToken({ idToken, channelId, fetchImpl, now })` and `resolveLineAppUser({ client, lineProfile, now })`.

- [ ] **Step 1: Write failing tests**

```js
test("verifyLineIdToken accepts a valid LINE token response", async () => {
  const profile = await verifyLineIdToken({
    idToken: "id-token",
    channelId: "channel-1",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.line.me/oauth2/v2.1/verify");
      assert.equal(options.method, "POST");
      assert.match(String(options.body), /id_token=id-token/);
      return new Response(JSON.stringify({
        iss: "https://access.line.me",
        sub: "U123",
        aud: "channel-1",
        exp: 4102444800,
        iat: 4102441200,
        name: "ผู้ใช้ทดสอบ",
        picture: "https://example.com/p.png",
      }), { status: 200 });
    },
    now: () => 4102440000,
  });
  assert.deepEqual(profile, { lineUserId: "U123", displayName: "ผู้ใช้ทดสอบ", pictureUrl: "https://example.com/p.png" });
});

test("verifyLineIdToken rejects a wrong audience and expired token", async () => {
  await assert.rejects(() => verifyLineIdToken({
    idToken: "id-token",
    channelId: "channel-1",
    fetchImpl: async () => new Response(JSON.stringify({ sub: "U123", aud: "wrong", exp: 1 }), { status: 200 }),
    now: () => 100,
  }), error => error.code === "LINE_TOKEN_INVALID");
});
```

- [ ] **Step 2: Run the focused test and confirm the missing implementation failure**

Run: `node --test tests/line-auth.logic.test.mjs`
Expected: FAIL because the verifier and repository do not exist.

- [ ] **Step 3: Implement the verifier and user upsert/read contract**

POST form-encoded token data to LINE's verification endpoint. Require issuer, subject, audience, expiry, and a non-future issuance time with a small clock skew. Normalize only `sub`, `name`, and `picture`. Implement `resolveLineAppUser` as an upsert/read through `app_users` and `app_user_roles`; missing users remain inactive and do not receive an implicit role.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/line-auth.logic.test.mjs tests/supabase.logic.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add forms/line-auth.logic.js forms/supabase.logic.js tests/line-auth.logic.test.mjs
git commit -m "feat: verify line identity and resolve app users"
```

### Task 3: Signed session and auth HTTP routes

**Files:**
- Create: `forms/session.logic.js`
- Create: `tests/session.logic.test.mjs`
- Create: `tests/line-auth-api.test.mjs`
- Modify: `local-server.mjs`

**Interfaces:**
- Consumes `verifyLineIdToken`, `resolveLineAppUser`, and Supabase client from Task 2.
- Produces `POST /api/auth/line-session`, `GET /api/auth/me`, and `POST /api/auth/logout`.

- [ ] **Step 1: Write failing session tests**

```js
test("signed sessions round-trip and reject tampering", () => {
  const token = signSession({ userId: "u-1", role: "employee", exp: 4102444800 }, "x".repeat(32));
  assert.deepEqual(verifySession(token, "x".repeat(32), () => 4102440000), {
    userId: "u-1", role: "employee", exp: 4102444800,
  });
  assert.throws(() => verifySession(`${token}x`, "x".repeat(32), () => 4102440000), error => error.code === "SESSION_INVALID");
});
```

```js
test("line session route sets a secure HttpOnly cookie only for an active user", async () => {
  const fixture = await startAuthFixture({ authMode: "line", activeUser: { id: "u-1", role: "employee" } });
  const response = await fetch(`${fixture.baseUrl}/api/auth/line-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: "valid-token" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/);
  await fixture.close();
});
```

- [ ] **Step 2: Run tests and confirm the expected failures**

Run: `node --test tests/session.logic.test.mjs tests/line-auth-api.test.mjs`
Expected: FAIL because the session module and auth routes do not exist.

- [ ] **Step 3: Implement signed sessions and routes**

Use HMAC-SHA256 over base64url JSON. Reject missing, malformed, expired, or tampered tokens. Parse cookies without accepting duplicate ambiguous values. Add auth route handlers before general API routes. The line-session handler verifies the ID token, resolves the app user, rejects inactive users, and sets the cookie. `me` returns only safe user fields. `logout` expires the cookie.

- [ ] **Step 4: Add feature-flagged API enforcement**

Add `SWEET_HOUSE_AUTH_MODE` parsing and a single `requireAuthenticatedRequest` gate in the server dispatch. Exempt `/api/auth/*`, Google/Shopee OAuth callback endpoints, and health/static assets. In `line` mode, return `401 { code: "AUTH_REQUIRED" }` before domain handlers. Preserve disabled-mode behavior.

- [ ] **Step 5: Run focused HTTP tests**

Run: `node --test tests/session.logic.test.mjs tests/line-auth-api.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add forms/session.logic.js tests/session.logic.test.mjs tests/line-auth-api.test.mjs local-server.mjs
git commit -m "feat: add line session authentication routes"
```

### Task 4: LINE browser bootstrap and deployment configuration

**Files:**
- Create: `forms/line-auth.browser.js`
- Create: `forms/line-auth.html`
- Create: `tests/line-auth.browser.test.mjs`
- Modify: `local-server.mjs`
- Modify: `forms/index.html`

**Interfaces:**
- Consumes `POST /api/auth/line-session`, `GET /api/auth/me`, and `POST /api/auth/logout` from Task 3.
- Produces a MINI App entry route `/line-auth` and a browser bootstrap that uses the configured LIFF ID.

- [ ] **Step 1: Write failing browser and static-route tests**

```js
test("browser bootstrap posts the LIFF ID token and exposes the authenticated user", () => {
  const source = readFileSync("forms/line-auth.browser.js", "utf8");
  assert.match(source, /liff\.getIDToken\(\)/);
  assert.match(source, /\/api\/auth\/line-session/);
  assert.match(source, /window\.SweetHouseAuth/);
});

test("line-auth page loads the LIFF SDK before the bootstrap", () => {
  const html = readFileSync("forms/line-auth.html", "utf8");
  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /line-auth\.browser\.js/);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `node --test tests/line-auth.browser.test.mjs`
Expected: FAIL because the entry page and bootstrap do not exist.

- [ ] **Step 3: Implement the browser bootstrap and entry page**

Initialize LIFF only when `LINE_LIFF_ID` is present in the entry page. In the LIFF browser, obtain the ID token and POST it to the same-origin auth route with `credentials: "same-origin"`. Display a Thai loading/error state and a link to retry; do not render the accounting menu before `/api/auth/me` succeeds. Keep a disabled-mode fallback for local browser development.

- [ ] **Step 4: Wire static routing and environment-safe configuration**

Add `/line-auth` to `safeStaticPath`. Expose only a public LIFF ID through a small server-rendered configuration value; never expose Supabase service credentials. Add `.env.example` values for `LINE_LIFF_ID`, `LINE_CHANNEL_ID`, `SWEET_HOUSE_AUTH_MODE`, `APP_PUBLIC_ORIGIN`, `SWEET_HOUSE_SESSION_SECRET`, and Supabase settings.

- [ ] **Step 5: Run browser/static tests**

Run: `node --test tests/line-auth.browser.test.mjs tests/line-auth-api.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add forms/line-auth.browser.js forms/line-auth.html forms/index.html tests/line-auth.browser.test.mjs local-server.mjs .env.example
git commit -m "feat: add line mini app browser bootstrap"
```

### Task 5: Migration contract and first Supabase data slice

**Files:**
- Create: `scripts/migrate-local-to-supabase.mjs`
- Create: `tests/migrate-local-to-supabase.test.mjs`
- Create: `docs/supabase-migration-runbook.md`
- Modify: `forms/local-server.logic.js`
- Modify: `forms/inventory-db.logic.js`

**Interfaces:**
- Consumes local JSON/SQLite records and Supabase client from Task 1.
- Produces a dry-run/apply CLI with idempotent `migration_runs` records and a first migrated slice for company settings, vendors, products, stock SKUs, and stock movements.

- [ ] **Step 1: Write failing migration tests**

```js
test("migration dry run reports deterministic counts without writing", async () => {
  const result = await planMigration({ rootDir: fixtureRoot, supabase: fakeSupabase(), now: () => "2026-09-25T00:00:00.000Z" });
  assert.deepEqual(result.counts, { companySettings: 1, vendors: 2, products: 1, stockSkus: 2, stockMovements: 3 });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.writes, 0);
});

test("apply migration is idempotent by source key", async () => {
  const supabase = fakeSupabase();
  await applyMigration({ rootDir: fixtureRoot, supabase, now: () => "2026-09-25T00:00:00.000Z" });
  await applyMigration({ rootDir: fixtureRoot, supabase, now: () => "2026-09-25T00:00:00.000Z" });
  assert.equal(supabase.inserted.filter(row => row.source_key === "stock_sku:1").length, 1);
});
```

- [ ] **Step 2: Run tests to confirm missing migration implementation**

Run: `node --test tests/migrate-local-to-supabase.test.mjs`
Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement dry-run/apply with source keys and verification**

Read local data through existing logic boundaries. Build deterministic records with source keys, use upsert semantics, record each batch in `migration_runs`, and verify counts/identities before marking a run succeeded. On any error, mark the run failed and leave source files untouched.

- [ ] **Step 4: Document backup, dry-run, apply, verify, and rollback procedure**

The runbook must include the existing backup script, required environment variables, a dry-run command, apply command, verification queries, and the cutover rule: stop writes, backup, apply, verify, then switch `DATA_BACKEND=supabase`.

- [ ] **Step 5: Run migration tests**

Run: `node --test tests/migrate-local-to-supabase.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-local-to-supabase.mjs tests/migrate-local-to-supabase.test.mjs docs/supabase-migration-runbook.md forms/local-server.logic.js forms/inventory-db.logic.js
git commit -m "feat: add idempotent local to supabase migration slice"
```

### Task 6: Full regression and deployment handoff

**Files:**
- Modify: `docs/feature-checklist.md`
- Modify: `docs/google-drive-oauth-sync.md`
- Modify: `scripts/test.sh` only if the test runner needs a new focused command

- [ ] **Step 1: Run new focused tests and record results**

Run: `node --test tests/supabase.logic.test.mjs tests/line-auth.logic.test.mjs tests/session.logic.test.mjs tests/line-auth-api.test.mjs tests/line-auth.browser.test.mjs tests/migrate-local-to-supabase.test.mjs`
Expected: all new tests pass.

- [ ] **Step 2: Run the full suite**

Run: `./scripts/test.sh`
Expected: all tests pass except the pre-existing `ensureInventorySchema creates inventory database tables` assertion unless the unrelated Shopee changes are reconciled; report the exact count and failure in the ledger.

- [ ] **Step 3: Update handoff documentation**

Document the branch, environment variables, LINE Developing/Review/Published endpoint setup, public HTTPS requirement, Supabase secret handling, auth mode switch, migration commands, and known baseline failure.

- [ ] **Step 4: Commit documentation only**

```bash
git add docs/feature-checklist.md docs/google-drive-oauth-sync.md scripts/test.sh
git commit -m "docs: add line mini app deployment handoff"
```

- [ ] **Step 5: Final verification**

Run: `git diff v.2.0.0...HEAD --stat && git status --short && git log --oneline --decorate -8`
Expected: only intentional LINE/Supabase files are committed; pre-existing Shopee working-tree edits remain uncommitted and are called out separately.
