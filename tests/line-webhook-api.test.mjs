import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", chunk => {
      const match = chunk.toString().match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`local server exited with ${code}`)));
  });
}

function signedBody(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

test("LINE webhook verifies signatures and accepts the platform empty-event probe", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-webhook-api-"));
  const secret = "test-channel-secret";
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir, LINE_CHANNEL_SECRET: secret, SWEET_HOUSE_AUTH_MODE: "disabled" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(child);
    const page = await fetch(`http://localhost:${port}/line-intake?intakeId=test`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /ตรวจสอบไฟล์จาก LINE/);
    const body = JSON.stringify({ destination: "Ubot", events: [] });
    const invalid = await fetch(`http://localhost:${port}/api/webhooks/line`, { method: "POST", body, headers: { "content-type": "application/json", "x-line-signature": "bad" } });
    assert.equal(invalid.status, 401);
    const valid = await fetch(`http://localhost:${port}/api/webhooks/line`, { method: "POST", body, headers: { "content-type": "application/json", "x-line-signature": signedBody(body, secret) } });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true, accepted: [], skipped: [] });
  } finally {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
