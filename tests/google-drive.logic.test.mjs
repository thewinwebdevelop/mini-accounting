import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import googleDrive from "../forms/google-drive.logic.js";

const {
  buildGoogleOAuthUrl,
  exchangeGoogleOAuthCode,
  getGoogleDriveStatus,
  saveGoogleDriveConfig,
  uploadFilesToGoogleDrive,
  uploadFolderToGoogleDrive,
} = googleDrive;

test("saveGoogleDriveConfig stores local OAuth settings without marking the app authenticated", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));

  try {
    const saved = await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
    });

    assert.equal(saved.configured, true);
    assert.equal(saved.authenticated, false);
    assert.equal(saved.clientId, "client-id.apps.googleusercontent.com");
    assert.equal(saved.clientSecret, undefined);

    const status = await getGoogleDriveStatus(rootDir);
    assert.equal(status.configured, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.clientId, "client-id.apps.googleusercontent.com");
    assert.equal(status.clientSecretSaved, true);
    assert.equal(status.driveBasePath, "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("saveGoogleDriveConfig keeps the existing secret when updating the base path", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));

  try {
    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
    });

    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชีใหม่",
    });

    const config = JSON.parse(await readFile(join(rootDir, "config", "google-drive-config.json"), "utf8"));
    assert.equal(config.clientSecret, "client-secret");
    assert.equal(config.driveBasePath, "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชีใหม่");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("buildGoogleOAuthUrl creates a consent URL for the local callback", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));

  try {
    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
    });

    const authUrl = new URL(await buildGoogleOAuthUrl({
      rootDir,
      redirectUri: "http://localhost:8787/api/google-drive/oauth2callback",
      state: "state-123",
    }));

    assert.equal(authUrl.origin + authUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(authUrl.searchParams.get("client_id"), "client-id.apps.googleusercontent.com");
    assert.equal(authUrl.searchParams.get("redirect_uri"), "http://localhost:8787/api/google-drive/oauth2callback");
    assert.equal(authUrl.searchParams.get("response_type"), "code");
    assert.deepEqual(authUrl.searchParams.get("scope").split(/\s+/).sort(), [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/spreadsheets",
    ].sort());
    assert.equal(authUrl.searchParams.get("access_type"), "offline");
    assert.equal(authUrl.searchParams.get("prompt"), "consent");
    assert.equal(authUrl.searchParams.get("state"), "state-123");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("exchangeGoogleOAuthCode stores access and refresh tokens from Google", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));
  const calls = [];

  try {
    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
    });

    const token = await exchangeGoogleOAuthCode({
      rootDir,
      code: "auth-code",
      redirectUri: "http://localhost:8787/api/google-drive/oauth2callback",
      nowMs: () => 1_800_000,
      fetchImpl: async (url, options) => {
        calls.push({ url, body: String(options.body) });
        return {
          ok: true,
          json: async () => ({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/drive.file",
            token_type: "Bearer",
          }),
        };
      },
    });

    assert.equal(token.authenticated, true);
    assert.equal(token.expiresAt, 1_800_000 + 3_600_000);
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
    assert.match(calls[0].body, /grant_type=authorization_code/);
    assert.match(calls[0].body, /code=auth-code/);

    const savedToken = JSON.parse(await readFile(join(rootDir, "config", "google-drive-token.json"), "utf8"));
    assert.equal(savedToken.access_token, "access-token");
    assert.equal(savedToken.refresh_token, "refresh-token");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("uploadFolderToGoogleDrive creates Drive folders and uploads local files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));
  const folderPath = "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001_ค่าส่ง";
  const absoluteFolderPath = join(rootDir, folderPath);
  const calls = [];
  let folderId = 1;
  let fileId = 100;

  try {
    await mkdir(join(absoluteFolderPath, "pdf"), { recursive: true });
    await mkdir(join(absoluteFolderPath, "raw"), { recursive: true });
    await writeFile(join(absoluteFolderPath, "pdf", "01_ใบเบิกจ่าย.pdf"), "%PDF-test");
    await writeFile(join(absoluteFolderPath, "raw", "A1_receipt_001.jpg"), "jpg-test");

    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
    });
    await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    }));

    const result = await uploadFolderToGoogleDrive({
      rootDir,
      folderPath,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, method: options.method || "GET", body: options.body });
        if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) {
          return { ok: true, json: async () => ({ files: [] }) };
        }
        if (String(url) === "https://www.googleapis.com/drive/v3/files") {
          const id = `folder-${folderId++}`;
          return {
            ok: true,
            json: async () => ({
              id,
              webViewLink: `https://drive.google.com/drive/folders/${id}`,
            }),
          };
        }
        if (String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) {
          return {
            ok: true,
            headers: { get: (name) => name.toLowerCase() === "location" ? `https://upload.example/${fileId++}` : null },
          };
        }
        if (String(url).startsWith("https://upload.example/")) {
          return { ok: true, json: async () => ({ id: `file-${fileId}`, webViewLink: "https://drive.google.com/file" }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    assert.equal(result.syncStatus, "synced");
    assert.equal(result.uploadedFileCount, 2);
    assert.equal(result.driveFolderId, "folder-6");
    assert.equal(result.driveFolderUrl, "https://drive.google.com/drive/folders/folder-6");
    assert.ok(calls.some((call) => call.method === "PUT" && String(call.url).startsWith("https://upload.example/")));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("uploadFilesToGoogleDrive uploads a manifest into a shared remote folder and preserves raw subfolders", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-manifest-"));
  const sourceDir = join(rootDir, "source");
  const calls = [];
  const createdFolderNames = [];
  const uploadNames = [];
  let nextFolderId = 1;
  let nextFileId = 100;

  try {
    await mkdir(join(sourceDir, "raw"), { recursive: true });
    const rawPath = join(sourceDir, "raw", "PO-2026-09-0001__evidence.jpg");
    const pdfPath = join(sourceDir, "PO-2026-09-0001__purchase-order.pdf");
    await writeFile(rawPath, "raw");
    await writeFile(pdfPath, "%PDF-test");
    await saveGoogleDriveConfig({
      rootDir,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
    });
    await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    }));

    const result = await uploadFilesToGoogleDrive({
      rootDir,
      drivePath: "2026/09/ใบสั่งซื้อ",
      files: [
        { absolutePath: rawPath, relativePath: "raw/PO-2026-09-0001__evidence.jpg" },
        { absolutePath: pdfPath, relativePath: "PO-2026-09-0001__purchase-order.pdf" },
      ],
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) {
          return { ok: true, json: async () => ({ files: [] }) };
        }
        if (String(url) === "https://www.googleapis.com/drive/v3/files") {
          const body = JSON.parse(options.body);
          createdFolderNames.push(body.name);
          const id = `folder-${nextFolderId++}`;
          return { ok: true, json: async () => ({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` }) };
        }
        if (String(url).startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) {
          uploadNames.push(JSON.parse(options.body).name);
          const id = nextFileId++;
          return { ok: true, headers: { get: () => `https://upload.example/${id}` } };
        }
        if (String(url).startsWith("https://upload.example/")) {
          return { ok: true, json: async () => ({ id: `file-${nextFileId}` }) };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    assert.equal(result.syncStatus, "synced");
    assert.equal(result.layoutVersion, 2);
    assert.equal(result.drivePath, "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี/2026/09/ใบสั่งซื้อ");
    assert.equal(result.uploadedFileCount, 2);
    assert.deepEqual(createdFolderNames, ["หจก.สวีทเฮาส์ เดซี่", "เอกสารบัญชี", "2026", "09", "ใบสั่งซื้อ", "raw"]);
    assert.deepEqual(uploadNames, ["PO-2026-09-0001__purchase-order.pdf", "PO-2026-09-0001__evidence.jpg"]);
    assert.ok(calls.some((call) => call.options.method === "PUT"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("uploadFilesToGoogleDrive replaces an existing file with the same name in the same remote folder", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-replace-"));
  const sourcePath = join(rootDir, "PO-2026-09-0001.pdf");
  const folderIds = new Map();
  const files = new Map();
  let nextId = 1;
  let patchCount = 0;
  try {
    await writeFile(sourcePath, "%PDF-test");
    await saveGoogleDriveConfig({ rootDir, clientId: "client-id", clientSecret: "client-secret" });
    await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expiresAt: Date.now() + 3_600_000 }));
    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        const query = new URL(target).searchParams.get("q");
        const name = query.match(/name = '([^']+)'/)?.[1] || "";
        if (query.includes("mimeType = 'application/vnd.google-apps.folder'")) {
          const id = folderIds.get(name);
          return { ok: true, json: async () => ({ files: id ? [{ id, webViewLink: `https://drive.google.com/drive/folders/${id}` }] : [] }) };
        }
        const id = files.get(name);
        return { ok: true, json: async () => ({ files: id ? [{ id, name }] : [] }) };
      }
      if (target === "https://www.googleapis.com/drive/v3/files") {
        const body = JSON.parse(options.body);
        const id = `folder-${nextId++}`;
        folderIds.set(body.name, id);
        return { ok: true, json: async () => ({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` }) };
      }
      if (target.startsWith("https://www.googleapis.com/upload/drive/v3/files/")) {
        patchCount += 1;
        return { ok: true, headers: { get: () => "https://upload.example/replace" } };
      }
      if (target.startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
        const body = JSON.parse(options.body);
        files.set(body.name, `file-${nextId++}`);
        return { ok: true, headers: { get: () => "https://upload.example/create" } };
      }
      if (target.startsWith("https://upload.example/")) return { ok: true, json: async () => ({ id: "file" }) };
      throw new Error(`Unexpected URL: ${target}`);
    };
    const manifest = [{ absolutePath: sourcePath, relativePath: "PO-2026-09-0001.pdf" }];
    await uploadFilesToGoogleDrive({ rootDir, drivePath: "2026/09/ใบสั่งซื้อ", files: manifest, fetchImpl });
    await uploadFilesToGoogleDrive({ rootDir, drivePath: "2026/09/ใบสั่งซื้อ", files: manifest, fetchImpl });
    assert.equal(patchCount, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// The workflow Drive sync's "already synced" handling rests on this: the
// uploader reuses Drive *folders* (ensureDrivePath looks each one up before
// creating it) but never looks for an existing *file* -- every call opens a
// fresh upload session per local file, so uploading the same folder twice
// puts every file in Drive twice.
test("uploadFolderToGoogleDrive reuses folders but is not idempotent for files: a second upload of the same folder creates every file again", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-drive-"));
  const folderPath = "documents/2026/09/purchase_order/PO-2026-09-0001_ทดสอบ";
  const absoluteFolderPath = join(rootDir, folderPath);
  const folders = new Map();
  const folderQueries = [];
  const uploadSessions = [];
  let nextId = 1;

  try {
    await mkdir(join(absoluteFolderPath, "pdf"), { recursive: true });
    await writeFile(join(absoluteFolderPath, "pdf", "PO-2026-09-0001.pdf"), "%PDF-test");
    await saveGoogleDriveConfig({ rootDir, clientId: "client-id.apps.googleusercontent.com", clientSecret: "client-secret" });
    await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
    }));

    // A fake Drive that remembers the folders it has created, so a lookup
    // for an existing folder finds it the way the real API would.
    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        const query = new URL(target).searchParams.get("q");
        folderQueries.push(query);
        const [, parentId, name] = query.match(/^'(.+?)' in parents and name = '(.+?)'/);
        const id = folders.get(`${parentId}/${name}`);
        return { ok: true, json: async () => ({ files: id ? [{ id, webViewLink: `https://drive.google.com/drive/folders/${id}` }] : [] }) };
      }
      if (target === "https://www.googleapis.com/drive/v3/files") {
        const body = JSON.parse(options.body);
        const id = `folder-${nextId++}`;
        folders.set(`${body.parents[0]}/${body.name}`, id);
        return { ok: true, json: async () => ({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` }) };
      }
      if (target.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")) {
        uploadSessions.push(JSON.parse(options.body).name);
        const sessionId = nextId++;
        return { ok: true, headers: { get: (header) => (header.toLowerCase() === "location" ? `https://upload.example/${sessionId}` : null) } };
      }
      if (target.startsWith("https://upload.example/")) {
        return { ok: true, json: async () => ({ id: `file-${nextId++}` }) };
      }
      throw new Error(`Unexpected URL: ${target}`);
    };

    const first = await uploadFolderToGoogleDrive({ rootDir, folderPath, fetchImpl });
    const foldersAfterFirst = folders.size;
    const second = await uploadFolderToGoogleDrive({ rootDir, folderPath, fetchImpl });

    assert.equal(second.driveFolderId, first.driveFolderId, "the document's Drive folder is found and reused, not created twice");
    assert.equal(folders.size, foldersAfterFirst, "no folder is created on the second upload");
    assert.deepEqual(uploadSessions, ["PO-2026-09-0001.pdf", "PO-2026-09-0001.pdf"], "the same file is uploaded again on the second call");
    assert.ok(
      folderQueries.every((query) => query.includes("mimeType = 'application/vnd.google-apps.folder'")),
      "the uploader only ever looks up folders, never an existing file",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
