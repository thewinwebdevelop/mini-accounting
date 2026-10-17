import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("Expense request local web app")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`local server exited early with code ${code}`)); });
  });
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("Shopee OAuth callback exchanges code, stores connection, and redirects to UI", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-oauth-api-"));
  const mockShopee = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/api/v2/auth/token/get") {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.code, "auth-code");
    assert.equal(body.shop_id, "shop-1");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ response: { access_token: "access-1", refresh_token: "refresh-1", expire_in: 3600 } }));
  });
  await new Promise((resolve) => mockShopee.listen(19312, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: "19311",
      SWEET_HOUSE_ROOT_DIR: rootDir,
      SHOPEE_PARTNER_ID: "12345",
      SHOPEE_PARTNER_KEY: "secret",
      SHOPEE_API_BASE_URL: "http://127.0.0.1:19312",
      SHOPEE_APP_ORIGIN: "http://127.0.0.1:19311",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = "http://127.0.0.1:19311";
  try {
    await waitForServer(child);
    const authorized = await requestJson(baseUrl, "/api/shopee/authorize", { method: "POST", body: JSON.stringify({}) });
    assert.equal(authorized.response.status, 200);
    const authorizationUrl = new URL(authorized.body.authorizationUrl);
    assert.equal(authorizationUrl.searchParams.get("redirect"), `${baseUrl}/api/shopee/callback`);
    assert.match(authorizationUrl.searchParams.get("state"), /^[a-f0-9]{48}$/);

    const callback = await fetch(`${baseUrl}/api/shopee/callback?state=${authorizationUrl.searchParams.get("state")}&code=auth-code&shop_id=shop-1&shop_name=ร้านทดสอบ`, { redirect: "manual" });
    assert.equal(callback.status, 302);
    const location = new URL(callback.headers.get("location"));
    assert.equal(location.pathname, "/shopee-connection");
    assert.equal(location.searchParams.get("connected"), "1");
    assert.equal(location.searchParams.get("shopId"), "shop-1");

    const connection = await requestJson(baseUrl, "/api/shopee/connection?shopId=shop-1");
    assert.equal(connection.response.status, 200);
    assert.equal(connection.body.connection.shopId, "shop-1");
    assert.equal("accessToken" in connection.body.connection, false);

    const replay = await fetch(`${baseUrl}/api/shopee/callback?state=${authorizationUrl.searchParams.get("state")}&code=auth-code&shop_id=shop-1`, { redirect: "manual" });
    assert.equal(replay.status, 400);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => mockShopee.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
