import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getAppUserProfile,
  updateAppUserProfile,
  listCompanyPositions,
} = require("../forms/user-profile.server.logic.js");

function createRecorder(responses) {
  const calls = [];
  return {
    calls,
    request: async (_client, path, options = {}) => {
      calls.push({ path, options });
      const response = responses.find(item => item.match(path, options));
      if (!response) throw new Error(`Unexpected Supabase request: ${options.method || "GET"} ${path}`);
      if (response.error) throw response.error;
      return response.value;
    },
  };
}

function profileRow(overrides = {}) {
  return {
    user_id: "session-user",
    first_name: "ชื่อ",
    last_name: "นามสกุล",
    company_position_id: "position-1",
    app_users: { display_name: "LINE user", picture_url: "https://example.com/p.png" },
    company_positions: { id: "position-1", label: "การตลาด", status: "active" },
    ...overrides,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function startUpstream({ profileFailure = false } = {}) {
  const patchBodies = [];
  let profileUpdated = false;
  let shouldFailProfile = profileFailure;
  const upstream = createServer(async (request, response) => {
    if (request.url === "/oauth2/v2.1/verify") {
      await readBody(request);
      const now = Math.floor(Date.now() / 1000);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        iss: "https://access.line.me", sub: "U123", aud: "channel-1", exp: now + 3600, iat: now - 10,
        name: "ผู้ใช้จริง", picture: "https://example.com/p.png",
      }));
      return;
    }
    if (request.url.startsWith("/rest/v1/app_users")) {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.method === "POST"
        ? [{ id: "user-1", line_user_id: "U123", status: "active" }]
        : [{ id: "user-1", line_user_id: "U123", display_name: "ผู้ใช้จริง", picture_url: "https://example.com/p.png", status: "active", app_user_roles: [{ role_code: "employee" }] }]));
      return;
    }
    if (request.url.startsWith("/rest/v1/app_user_profiles")) {
      if (shouldFailProfile) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "provider failure" }));
        return;
      }
      const body = await readBody(request);
      if (request.method === "PATCH") {
        patchBodies.push({ url: request.url, body: JSON.parse(body) });
        profileUpdated = true;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{
        user_id: "user-1", first_name: profileUpdated ? "ใหม่" : "ชื่อ", last_name: profileUpdated ? "ผู้ใช้" : "นามสกุล",
        company_position_id: "position-1", app_users: { display_name: "ผู้ใช้จริง", picture_url: "https://example.com/p.png" },
        company_positions: { id: "position-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sort_order: 10 },
      }]));
      return;
    }
    if (request.url.startsWith("/rest/v1/company_positions")) {
      await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url.includes("id=eq.position-1")
        ? [{ id: "position-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sort_order: 10 }]
        : [{ id: "position-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sort_order: 10 }, { id: "position-old", code: "old", label: "เก่า", status: "inactive", sort_order: 5 }]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  return { server: upstream, url: `http://127.0.0.1:${upstream.address().port}`, patchBodies, setProfileFailure: value => { shouldFailProfile = value; } };
}

async function startApp(env) {
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: process.cwd(), env: { ...process.env, ...env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const wait = new Promise((resolve, reject) => {
    const onData = chunk => {
      const text = chunk.toString(); output.push(text);
      const match = text.match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", chunk => output.push(chunk.toString()));
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`server exited ${code}: ${output.join("")}`)));
  });
  const baseUrl = await Promise.race([wait, new Promise((_, reject) => setTimeout(() => reject(new Error(`server timeout: ${output.join("")}`)), 5000))]);
  return { child, baseUrl };
}

async function stopApp(child) {
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}

async function login(app) {
  const response = await fetch(`${app.baseUrl}/api/auth/line-session`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "valid-token" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

function appEnv(rootDir, upstream) {
  return {
    SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_AUTH_MODE: "line", LINE_CHANNEL_ID: "channel-1",
    LINE_VERIFY_URL: `${upstream.url}/oauth2/v2.1/verify`, SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key", SWEET_HOUSE_SESSION_SECRET: "x".repeat(32),
  };
}

test("reads a profile by session user id", async () => {
  const recorder = createRecorder([
    {
      match: path => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("user_id=eq.session-user"),
      value: [profileRow()],
    },
  ]);

  const profile = await getAppUserProfile({
    client: { marker: "admin" },
    userId: "session-user",
    request: recorder.request,
  });

  assert.deepEqual(profile, {
    firstName: "ชื่อ",
    lastName: "นามสกุล",
    companyPositionId: "position-1",
    companyPositionLabel: "การตลาด",
    displayName: "LINE user",
    pictureUrl: "https://example.com/p.png",
  });
  assert.equal(recorder.calls.length, 1);
  assert.match(recorder.calls[0].path, /select=/);
  assert.match(recorder.calls[0].path, /company_positions/);
});

test("updates only the allowlisted profile fields", async () => {
  const recorder = createRecorder([
    {
      match: path => path.startsWith("/rest/v1/company_positions?") && path.includes("id=eq.position-1"),
      value: [{ id: "position-1", label: "การตลาด", status: "active" }],
    },
    {
      match: (path, options) => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("user_id=eq.session-user") && options.method === "PATCH",
      value: [profileRow()],
    },
    {
      match: path => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("user_id=eq.session-user") && !path.includes("select=first_name"),
      value: [profileRow({ first_name: "ใหม่", last_name: "ชื่อ" })],
    },
  ]);

  const profile = await updateAppUserProfile({
    client: { marker: "admin" },
    userId: "session-user",
    input: {
      firstName: " ใหม่ ",
      lastName: " ชื่อ ",
      companyPositionId: "position-1",
      userId: "attacker-user",
      role: "admin",
      status: "active",
      displayName: "attacker",
      provider: "line",
    },
    request: recorder.request,
  });

  const patchCall = recorder.calls.find(call => call.options.method === "PATCH");
  assert.deepEqual(patchCall.options.body, {
    first_name: "ใหม่",
    last_name: "ชื่อ",
    company_position_id: "position-1",
  });
  assert.match(patchCall.path, /user_id=eq.session-user/);
  assert.doesNotMatch(patchCall.path, /attacker-user/);
  assert.deepEqual(profile, {
    firstName: "ใหม่",
    lastName: "ชื่อ",
    companyPositionId: "position-1",
    companyPositionLabel: "การตลาด",
    displayName: "LINE user",
    pictureUrl: "https://example.com/p.png",
  });
});

test("inserts an absent profile row for the authenticated session user", async () => {
  const recorder = createRecorder([
    {
      match: path => path.startsWith("/rest/v1/company_positions?") && path.includes("id=eq.position-1"),
      value: [{ id: "position-1", label: "การตลาด", status: "active" }],
    },
    {
      match: (path, options) => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("user_id=eq.session-user") && options.method === "PATCH",
      value: [],
    },
    {
      match: (path, options) => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("on_conflict=user_id") && options.method === "POST",
      value: [profileRow({ first_name: "ใหม่", last_name: "ผู้ใช้" })],
    },
    {
      match: path => path.startsWith("/rest/v1/app_user_profiles?") && path.includes("user_id=eq.session-user") && path.includes("select="),
      value: [profileRow({ first_name: "ใหม่", last_name: "ผู้ใช้" })],
    },
  ]);

  const profile = await updateAppUserProfile({
    client: { marker: "admin" },
    userId: "session-user",
    input: {
      firstName: "ใหม่",
      lastName: "ผู้ใช้",
      companyPositionId: "position-1",
      userId: "attacker-user",
      role: "admin",
    },
    request: recorder.request,
  });

  const insertCall = recorder.calls.find(call => call.options.method === "POST");
  assert.equal(insertCall.path, "/rest/v1/app_user_profiles?on_conflict=user_id");
  assert.deepEqual(insertCall.options.body, {
    user_id: "session-user",
    first_name: "ใหม่",
    last_name: "ผู้ใช้",
    company_position_id: "position-1",
  });
  assert.deepEqual(profile, {
    firstName: "ใหม่",
    lastName: "ผู้ใช้",
    companyPositionId: "position-1",
    companyPositionLabel: "การตลาด",
    displayName: "LINE user",
    pictureUrl: "https://example.com/p.png",
  });
});

test("rejects a blank or inactive company position", async () => {
  const recorder = createRecorder([
    {
      match: path => path.includes("id=eq.position-inactive"),
      value: [{ id: "position-inactive", label: "เก่า", status: "inactive" }],
    },
  ]);

  await assert.rejects(
    () => updateAppUserProfile({
      client: {}, userId: "session-user", input: { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionId: "position-inactive" }, request: recorder.request,
    }),
    error => error.code === "PROFILE_POSITION_INVALID" && error.statusCode === 400,
  );

  await assert.rejects(
    () => updateAppUserProfile({
      client: {}, userId: "session-user", input: { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionId: "" }, request: recorder.request,
    }),
    error => error.code === "PROFILE_POSITION_INVALID" && error.statusCode === 400,
  );
});

test("returns a stable profile with the selected position label", async () => {
  const recorder = createRecorder([
    {
      match: path => path.startsWith("/rest/v1/app_user_profiles?"),
      value: [profileRow({ company_position_id: "position-old", company_positions: { id: "position-old", label: "ตำแหน่งเดิม", status: "inactive" } })],
    },
  ]);

  const profile = await getAppUserProfile({ client: {}, userId: "session-user", request: recorder.request });
  assert.equal(profile.companyPositionId, "position-old");
  assert.equal(profile.companyPositionLabel, "ตำแหน่งเดิม");
  assert.equal(profile.displayName, "LINE user");
});

test("lists active company positions only", async () => {
  const recorder = createRecorder([
    {
      match: path => path.startsWith("/rest/v1/company_positions?") && path.includes("status=eq.active"),
      value: [
        { id: "p-2", code: "marketing", label: "การตลาด", status: "active", sort_order: 20 },
        { id: "p-old", code: "old", label: "เก่า", status: "inactive", sort_order: 1 },
        { id: "p-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sort_order: 10 },
      ],
    },
  ]);

  assert.deepEqual(await listCompanyPositions({ client: {}, request: recorder.request }), [
    { id: "p-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sortOrder: 10 },
    { id: "p-2", code: "marketing", label: "การตลาด", status: "active", sortOrder: 20 },
  ]);
});

test("profile and position routes require an authenticated session", { concurrency: false }, async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-profile-api-"));
  const upstream = await startUpstream();
  const app = await startApp(appEnv(rootDir, upstream));
  try {
    const profile = await fetch(`${app.baseUrl}/api/auth/profile`);
    const positions = await fetch(`${app.baseUrl}/api/company-positions`);
    assert.equal(profile.status, 401);
    assert.equal(positions.status, 401);
  } finally {
    await stopApp(app.child); await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});

test("authenticated profile routes read, update, and list active positions", { concurrency: false }, async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-profile-api-"));
  const upstream = await startUpstream();
  const app = await startApp(appEnv(rootDir, upstream));
  try {
    const cookie = await login(app);
    const profile = await fetch(`${app.baseUrl}/api/auth/profile`, { headers: { cookie } });
    const profileBody = await profile.text();
    assert.equal(profile.status, 200, profileBody);
    assert.deepEqual(JSON.parse(profileBody), { profile: { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionId: "position-1", companyPositionLabel: "เจ้าของบริษัท", displayName: "ผู้ใช้จริง", pictureUrl: "https://example.com/p.png" } });
    const positions = await fetch(`${app.baseUrl}/api/company-positions`, { headers: { cookie } });
    const positionsBody = await positions.text();
    assert.equal(positions.status, 200, positionsBody);
    assert.deepEqual(JSON.parse(positionsBody).positions, [{ id: "position-1", code: "owner", label: "เจ้าของบริษัท", status: "active", sortOrder: 10 }]);
    const update = await fetch(`${app.baseUrl}/api/auth/profile`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "ใหม่", lastName: "ผู้ใช้", companyPositionId: "position-1", userId: "attacker-user", role: "admin", status: "active" }),
    });
    const updateBody = await update.text();
    assert.equal(update.status, 200, updateBody);
    assert.equal(JSON.parse(updateBody).profile.firstName, "ใหม่");
    assert.deepEqual(upstream.patchBodies, [{ url: "/rest/v1/app_user_profiles?user_id=eq.user-1", body: { first_name: "ใหม่", last_name: "ผู้ใช้", company_position_id: "position-1" } }]);
  } finally {
    await stopApp(app.child); await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});

test("profile routes reject invalid payloads and map provider failures", { concurrency: false }, async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-profile-api-"));
  const upstream = await startUpstream();
  const app = await startApp(appEnv(rootDir, upstream));
  try {
    const cookie = await login(app);
    const invalid = await fetch(`${app.baseUrl}/api/auth/profile`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ firstName: "", lastName: "ผู้ใช้", companyPositionId: "position-1" }),
    });
    assert.equal(invalid.status, 400);
    upstream.setProfileFailure(true);
    const failureCookie = await login(app);
    const response = await fetch(`${app.baseUrl}/api/auth/profile`, { headers: { cookie: failureCookie } });
    assert.equal(response.status, 503);
  } finally {
    await stopApp(app.child); await new Promise(resolve => upstream.server.close(resolve)); await rm(rootDir, { recursive: true, force: true });
  }
});
