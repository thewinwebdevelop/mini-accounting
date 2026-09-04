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
    assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
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
