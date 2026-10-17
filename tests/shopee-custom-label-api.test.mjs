import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { signSession } from "../forms/session.logic.js";

const FIXTURE = join(process.cwd(), "tests", "fixtures", "shopee-custom-label-sample.pdf");

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/Expense request (?:local web|Cloud Run) app: http:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${output}`)));
  });
}

async function spawnServer(rootDir, env = {}) {
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_ALLOW_NETWORK: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, baseUrl: await waitForServer(child) };
}

async function jsonResponse(response) {
  const body = await response.json();
  return { response, body };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildMappings(job) {
  const mappings = {};
  for (const page of job.pages || []) {
    for (const item of page.items || []) {
      mappings[item.mappingKey] = {
        productName: item.productName,
        optionName: item.optionName,
        bundle: [
          { sku: "TOP-BLUE", quantity: 1 },
          { sku: "SKIRT-LACE", quantity: 1 },
        ],
      };
    }
  }
  return mappings;
}

async function uploadFixture(baseUrl, fileBytes = null, headers = {}) {
  const body = new FormData();
  body.append(
    "file",
    new Blob([fileBytes || await readFile(FIXTURE)], { type: "application/pdf" }),
    "shopee-labels.pdf",
  );
  return jsonResponse(await fetch(`${baseUrl}/api/shopee/custom-labels`, { method: "POST", headers, body }));
}

async function startSupabaseMappingFake() {
  const requests = [];
  const rows = new Map();
  const state = { failRead: false, failWrite: false };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const body = Buffer.concat(await Array.fromAsync(request));
    requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/rest/v1/shopee_custom_label_mappings") {
      if ((request.method === "GET" && state.failRead) || (request.method === "POST" && state.failWrite)) {
        response.writeHead(503);
        response.end(JSON.stringify({ message: "mapping database unavailable" }));
        return;
      }
      if (request.method === "POST") {
        for (const row of JSON.parse(body.toString("utf8"))) {
          const key = `${row.product_name_key}::${row.option_name_key}`;
          rows.set(key, { id: rows.size + 1, ...row });
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify([...rows.values()]));
        return;
      }
      const afterId = Number((url.searchParams.get("id") || "gt.0").slice(3));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([...rows.values()].filter(row => row.id > afterId)));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/storage/v1/object/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}`, requests, rows, state };
}

function cloudHeaders(baseUrl, secret) {
  const token = signSession({ exp: Math.floor(Date.now() / 1000) + 3600, role: "owner", userId: "test-owner" }, secret);
  return { cookie: `sweet_house_session=${token}`, origin: baseUrl };
}

async function transformFixture(baseUrl, jobId, action, mappings, headers) {
  return jsonResponse(await fetch(`${baseUrl}/api/shopee/custom-labels/${jobId}/${action}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ mappings }),
  }));
}

test("Cloud Run custom-label API loads and saves Supabase mappings only on Save, with operation errors on repository failure", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-cloud-api-"));
  const upstream = await startSupabaseMappingFake();
  const secret = "cloud-custom-label-session-secret-123";
  const { child, baseUrl } = await spawnServer(rootDir, {
    CLOUD_RUN: "1",
    NODE_ENV: "production",
    SUPABASE_URL: upstream.url,
    SUPABASE_SERVICE_ROLE_KEY: "server-key",
    SWEET_HOUSE_SESSION_SECRET: secret,
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:0",
  });
  const headers = cloudHeaders("http://127.0.0.1:0", secret);
  try {
    const uploaded = await uploadFixture(baseUrl, null, headers);
    assert.equal(uploaded.response.status, 200);
    assert.deepEqual(uploaded.body.job.autofillMappings, {});
    assert.ok(upstream.requests.some(call => call.method === "GET" && call.path === "/rest/v1/shopee_custom_label_mappings"));

    const mappings = buildMappings(uploaded.body.job);
    const preview = await transformFixture(baseUrl, uploaded.body.job.id, "preview", mappings, headers);
    assert.equal(preview.response.status, 200);
    assert.equal(upstream.requests.filter(call => call.method === "POST" && call.path === "/rest/v1/shopee_custom_label_mappings").length, 0);

    const saved = await transformFixture(baseUrl, uploaded.body.job.id, "save", mappings, headers);
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.job.status, "saved");
    assert.equal(upstream.requests.filter(call => call.method === "POST" && call.path === "/rest/v1/shopee_custom_label_mappings").length, 1);
    const firstKey = Object.keys(mappings)[0];
    assert.deepEqual(upstream.rows.get(firstKey).bundle, mappings[firstKey].bundle);

    const secondUpload = await uploadFixture(baseUrl, null, headers);
    assert.equal(secondUpload.response.status, 200);
    assert.deepEqual(secondUpload.body.job.autofillMappings[firstKey], mappings[firstKey].bundle);

    upstream.state.failRead = true;
    const failedUpload = await uploadFixture(baseUrl, null, headers);
    assert.equal(failedUpload.response.status, 400);
    assert.equal(failedUpload.body.code, "SUPABASE_REQUEST_FAILED");
    upstream.state.failRead = false;

    upstream.state.failWrite = true;
    const failedSave = await transformFixture(baseUrl, secondUpload.body.job.id, "save", mappings, headers);
    assert.equal(failedSave.response.status, 400);
    assert.equal(failedSave.body.code, "SUPABASE_REQUEST_FAILED");
  } finally {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    await new Promise(resolve => upstream.server.close(resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("uploaded custom-label API parses, previews without saving mappings, and saves output", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-api-"));
  const { child, baseUrl } = await spawnServer(rootDir);
  try {
    const uploaded = await uploadFixture(baseUrl);
    assert.equal(uploaded.response.status, 200);
    assert.equal(uploaded.body.job.pageCount, 19);
    assert.equal(uploaded.body.job.pages[0].orderNo, "261016RBTADAXA");
    assert.match(uploaded.body.job.sourceUrl, /\/source$/);

    const source = await fetch(`${baseUrl}${uploaded.body.job.sourceUrl}`);
    assert.equal(source.status, 200);
    assert.equal(source.headers.get("content-type"), "application/pdf");
    const sourceBytesBefore = Buffer.from(await source.arrayBuffer());
    const sourceHashBefore = sha256(sourceBytesBefore);

    const mappings = buildMappings(uploaded.body.job);
    const preview = await jsonResponse(await fetch(`${baseUrl}/api/shopee/custom-labels/${uploaded.body.job.id}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappings }),
    }));
    assert.equal(preview.response.status, 200);
    assert.match(preview.body.job.previewUrl, /\/preview-file$/);
    assert.match(preview.body.job.comparisonUrl, /\/comparison$/);
    assert.deepEqual(preview.body.job.savedMappings, {});
    const previewFile = await fetch(`${baseUrl}${preview.body.job.previewUrl}`);
    assert.equal(previewFile.status, 200);
    assert.equal(previewFile.headers.get("content-type"), "application/pdf");
    const comparison = await fetch(`${baseUrl}${preview.body.job.comparisonUrl}`);
    assert.equal(comparison.status, 200);
    assert.equal(comparison.headers.get("content-type"), "application/pdf");
    assert.match(comparison.headers.get("content-disposition") || "", /^inline;/i);

    const saved = await jsonResponse(await fetch(`${baseUrl}/api/shopee/custom-labels/${uploaded.body.job.id}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappings }),
    }));
    assert.equal(saved.response.status, 200);
    assert.match(saved.body.job.outputUrl, /\/output$/);
    assert.match(saved.body.job.comparisonUrl, /\/comparison$/);
    assert.match(saved.body.job.downloadUrl, /\/download$/);
    assert.equal(saved.body.job.status, "saved");
    assert.equal(saved.body.job.savedMappings[Object.keys(mappings)[0]].bundle[0].sku, "TOP-BLUE");
    const output = await fetch(`${baseUrl}${saved.body.job.outputUrl}`);
    assert.equal(output.status, 200);
    assert.equal(output.headers.get("content-type"), "application/pdf");
    assert.ok((await output.arrayBuffer()).byteLength > 0);
    const download = await fetch(`${baseUrl}${saved.body.job.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") || "", /^attachment;/i);
    assert.match(download.headers.get("content-disposition") || "", /filename="[^"]+\.pdf"/i);

    const sourceAfter = await fetch(`${baseUrl}${uploaded.body.job.sourceUrl}`);
    assert.equal(sha256(Buffer.from(await sourceAfter.arrayBuffer())), sourceHashBefore);
    const secondUpload = await uploadFixture(baseUrl);
    assert.equal(secondUpload.response.status, 200);
    const firstKey = Object.keys(mappings)[0];
    assert.deepEqual(secondUpload.body.job.autofillMappings[firstKey], mappings[firstKey].bundle);
    const traversal = await fetch(`${baseUrl}/api/shopee/custom-labels/${uploaded.body.job.id}/%2e%2e/source`);
    assert.equal(traversal.status, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("uploaded custom-label API rejects invalid PDF and incomplete bundle", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-custom-label-invalid-"));
  const { child, baseUrl } = await spawnServer(rootDir);
  try {
    const invalid = await uploadFixture(baseUrl, Buffer.from("not a pdf"));
    assert.equal(invalid.response.status, 400);

    const uploaded = await uploadFixture(baseUrl);
    assert.equal(uploaded.response.status, 200);
    const mappings = buildMappings(uploaded.body.job);
    mappings[Object.keys(mappings)[0]].bundle = [];
    const preview = await jsonResponse(await fetch(`${baseUrl}/api/shopee/custom-labels/${uploaded.body.job.id}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappings }),
    }));
    assert.equal(preview.response.status, 400);
    assert.match(preview.body.error, /bundle|SKU/i);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
