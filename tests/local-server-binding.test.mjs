import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import test from "node:test";

// local-server.mjs used to call server.listen(port, ...) with no host, which
// makes Node bind every network interface. On a shared office/cafe wifi that
// means anyone else on the network can open the accounting app -- there is no
// authentication anywhere in it. These tests pin the fix: loopback-only by
// default, all-interfaces only behind an explicit opt-in env var, with a
// clear Thai warning printed when that opt-in is used.

async function waitForServerPort(child, extraPatterns = []) {
  return new Promise((resolve, reject) => {
    let out = "";
    const timeout = setTimeout(() => {
      reject(new Error(`local server did not start. stdout so far: ${out}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      out += text;
      const match = text.match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve({ port: Number(match[1]), stdout: () => out });
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`local server exited early with code ${code}. stdout: ${out}`));
    });
  });
}

function spawnLocalServer(rootDir, extraEnv = {}) {
  const env = { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir };
  delete env.SWEET_HOUSE_ALLOW_NETWORK;
  Object.assign(env, extraEnv);
  return spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

function firstExternalIPv4() {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

function tryConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish({ connected: true }));
    socket.once("timeout", () => finish({ connected: false, reason: "timeout" }));
    socket.once("error", (error) => finish({ connected: false, reason: error.code || error.message }));
  });
}

test("local server binds loopback only by default (no network opt-in)", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-bind-default-"));
  const child = spawnLocalServer(rootDir);

  try {
    const { port, stdout } = await waitForServerPort(child);

    const loopback = await tryConnect("127.0.0.1", port);
    assert.equal(loopback.connected, true, "loopback connection should succeed by default");

    const externalIp = firstExternalIPv4();
    if (externalIp) {
      const external = await tryConnect(externalIp, port);
      assert.equal(
        external.connected,
        false,
        `connecting to this machine's LAN address (${externalIp}) should be refused when the server is loopback-only`,
      );
    }

    assert.doesNotMatch(
      stdout(),
      /เข้าถึงจากเครือข่าย/,
      "no network-exposure warning should be printed when the opt-in is not set",
    );
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("local server binds all interfaces and prints a Thai warning under SWEET_HOUSE_ALLOW_NETWORK=1", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-bind-network-"));
  const child = spawnLocalServer(rootDir, { SWEET_HOUSE_ALLOW_NETWORK: "1" });

  try {
    const { port, stdout } = await waitForServerPort(child);

    const loopback = await tryConnect("127.0.0.1", port);
    assert.equal(loopback.connected, true, "loopback connection should still work under the opt-in");

    const externalIp = firstExternalIPv4();
    if (externalIp) {
      const external = await tryConnect(externalIp, port);
      assert.equal(
        external.connected,
        true,
        `connecting to this machine's LAN address (${externalIp}) should succeed when SWEET_HOUSE_ALLOW_NETWORK=1`,
      );
    }

    const text = stdout();
    assert.match(text, /เข้าถึงจากเครือข่าย/, "should warn (in Thai) that the server is reachable from the network");
    assert.match(text, /ไม่มี.*ยืนยันตัวตน|ไม่มีระบบยืนยันตัวตน/, "should mention there is no authentication");
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("SWEET_HOUSE_ALLOW_NETWORK with a falsy value keeps loopback-only binding", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-bind-falsy-"));
  const child = spawnLocalServer(rootDir, { SWEET_HOUSE_ALLOW_NETWORK: "0" });

  try {
    const { port, stdout } = await waitForServerPort(child);

    const externalIp = firstExternalIPv4();
    if (externalIp) {
      const external = await tryConnect(externalIp, port);
      assert.equal(external.connected, false, "SWEET_HOUSE_ALLOW_NETWORK=0 must not open the server to the network");
    }
    assert.doesNotMatch(stdout(), /เข้าถึงจากเครือข่าย/);
  } finally {
    await stopServer(child);
    await rm(rootDir, { recursive: true, force: true });
  }
});
