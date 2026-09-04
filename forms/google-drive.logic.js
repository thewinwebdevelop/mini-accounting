const { mkdir, readdir, readFile, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const driveFolderMimeType = "application/vnd.google-apps.folder";
const driveScopes = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];
const driveScope = driveScopes.join(" ");
const defaultDriveBasePath = "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี";

function getConfigDir(rootDir) {
  return path.join(rootDir, "config");
}

function getConfigPath(rootDir) {
  return path.join(getConfigDir(rootDir), "google-drive-config.json");
}

function getTokenPath(rootDir) {
  return path.join(getConfigDir(rootDir), "google-drive-token.json");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeDrivePath(value = "") {
  return String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function splitDrivePath(value = "") {
  return normalizeDrivePath(value).split("/").map((part) => part.trim()).filter(Boolean);
}

function escapeDriveQueryValue(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".csv": "text/csv",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
  }[ext] || "application/octet-stream";
}

async function saveGoogleDriveConfig({ rootDir, clientId, clientSecret, driveBasePath = defaultDriveBasePath }) {
  if (!String(clientId || "").trim()) throw new Error("Missing Google OAuth Client ID");
  const existingConfig = await getGoogleDriveConfig(rootDir);
  const savedClientSecret = String(clientSecret || "").trim() || existingConfig?.clientSecret || "";
  if (!savedClientSecret) throw new Error("Missing Google OAuth Client Secret");

  const config = {
    clientId: String(clientId).trim(),
    clientSecret: savedClientSecret,
    driveBasePath: normalizeDrivePath(driveBasePath) || defaultDriveBasePath,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getConfigPath(rootDir), config);
  const token = await readJsonIfExists(getTokenPath(rootDir));

  return {
    configured: true,
    authenticated: Boolean(token?.refresh_token),
    clientId: config.clientId,
    clientSecretSaved: true,
    driveBasePath: config.driveBasePath,
  };
}

async function getGoogleDriveConfig(rootDir) {
  return readJsonIfExists(getConfigPath(rootDir));
}

async function getGoogleDriveToken(rootDir) {
  return readJsonIfExists(getTokenPath(rootDir));
}

async function getGoogleDriveStatus(rootDir) {
  const config = await getGoogleDriveConfig(rootDir);
  const token = await getGoogleDriveToken(rootDir);

  return {
    configured: Boolean(config?.clientId && config?.clientSecret),
    authenticated: Boolean(token?.refresh_token),
    clientId: config?.clientId || "",
    clientSecretSaved: Boolean(config?.clientSecret),
    driveBasePath: config?.driveBasePath || defaultDriveBasePath,
    scope: token?.scope || "",
    tokenExpiresAt: token?.expiresAt || 0,
  };
}

async function buildGoogleOAuthUrl({ rootDir, redirectUri, state = "" }) {
  const config = await getGoogleDriveConfig(rootDir);
  if (!config?.clientId || !config?.clientSecret) {
    throw new Error("Google Drive is not configured");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", driveScope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

async function fetchJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Google API request failed: ${response.status}`);
  }
  return data;
}

async function exchangeGoogleOAuthCode({
  rootDir,
  code,
  redirectUri,
  fetchImpl = fetch,
  nowMs = () => Date.now(),
}) {
  if (!code) throw new Error("Missing Google OAuth code");
  const config = await getGoogleDriveConfig(rootDir);
  if (!config?.clientId || !config?.clientSecret) {
    throw new Error("Google Drive is not configured");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const token = await fetchJson(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const savedToken = {
    ...token,
    expiresAt: nowMs() + Number(token.expires_in || 0) * 1000,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getTokenPath(rootDir), savedToken);

  return {
    authenticated: true,
    expiresAt: savedToken.expiresAt,
    scope: savedToken.scope || driveScope,
  };
}

async function getValidAccessToken({ rootDir, fetchImpl = fetch, nowMs = () => Date.now() }) {
  const config = await getGoogleDriveConfig(rootDir);
  const token = await getGoogleDriveToken(rootDir);
  if (!config?.clientId || !config?.clientSecret) {
    throw new Error("Google Drive is not configured");
  }
  if (!token?.refresh_token) {
    throw new Error("Google Drive is not authenticated. Open /google-drive and login first.");
  }
  if (token.access_token && Number(token.expiresAt || 0) > nowMs() + 60_000) {
    return token.access_token;
  }

  const refreshed = await fetchJson(fetchImpl, "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });
  const savedToken = {
    ...token,
    ...refreshed,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expiresAt: nowMs() + Number(refreshed.expires_in || 0) * 1000,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(getTokenPath(rootDir), savedToken);
  return savedToken.access_token;
}

async function driveFetchJson({ accessToken, fetchImpl = fetch, url, options = {} }) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    ...(options.headers || {}),
  };
  return fetchJson(fetchImpl, url, { ...options, headers });
}

async function findDriveFolder({ accessToken, fetchImpl, name, parentId }) {
  const query = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    `mimeType = '${driveFolderMimeType}'`,
    "trashed = false",
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,webViewLink)");
  url.searchParams.set("pageSize", "1");
  const data = await driveFetchJson({ accessToken, fetchImpl, url: url.toString() });
  return data.files?.[0] || null;
}

async function createDriveFolder({ accessToken, fetchImpl, name, parentId }) {
  return driveFetchJson({
    accessToken,
    fetchImpl,
    url: "https://www.googleapis.com/drive/v3/files",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: driveFolderMimeType,
        parents: [parentId],
      }),
    },
  });
}

async function ensureDrivePath({ accessToken, fetchImpl = fetch, pathParts, startParentId = "root" }) {
  let parentId = startParentId;
  let folder = null;

  for (const name of pathParts) {
    folder = await findDriveFolder({ accessToken, fetchImpl, name, parentId });
    if (!folder) {
      folder = await createDriveFolder({ accessToken, fetchImpl, name, parentId });
    }
    parentId = folder.id;
  }

  return folder || { id: startParentId, webViewLink: "https://drive.google.com/drive/my-drive" };
}

async function collectFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, baseDir));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      absolutePath,
      relativePath: path.relative(baseDir, absolutePath),
      name: entry.name,
    });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function uploadFileToDrive({ accessToken, fetchImpl = fetch, file, parentId }) {
  const fileStat = await stat(file.absolutePath);
  const mimeType = getMimeType(file.absolutePath);
  const session = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mimeType,
      "x-upload-content-length": String(fileStat.size),
    },
    body: JSON.stringify({
      name: file.name,
      parents: [parentId],
    }),
  });
  if (!session.ok) {
    const error = typeof session.text === "function" ? await session.text().catch(() => "") : "";
    throw new Error(error || `Cannot create Drive upload session: ${session.status}`);
  }
  const uploadUrl = session.headers?.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return an upload URL");

  const fileBuffer = await readFile(file.absolutePath);
  const upload = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": mimeType,
      "content-length": String(fileBuffer.length),
    },
    body: fileBuffer,
  });
  const data = await upload.json().catch(() => ({}));
  if (!upload.ok) {
    throw new Error(data.error?.message || data.error || `Cannot upload ${file.relativePath}`);
  }
  return data;
}

async function uploadFolderToGoogleDrive({ rootDir, folderPath, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const config = await getGoogleDriveConfig(rootDir);
  const accessToken = await getValidAccessToken({ rootDir, fetchImpl });
  const absoluteFolderPath = path.join(rootDir, folderPath);
  const relativeDrivePath = normalizeDrivePath(folderPath).replace(/^documents\//, "");
  const rootPathParts = [
    ...splitDrivePath(config?.driveBasePath || defaultDriveBasePath),
    ...splitDrivePath(relativeDrivePath),
  ];
  const rootFolder = await ensureDrivePath({ accessToken, fetchImpl, pathParts: rootPathParts });
  const files = await collectFiles(absoluteFolderPath);
  const directoryCache = new Map([["", rootFolder.id]]);
  let uploadedFileCount = 0;

  for (const file of files) {
    const dirname = path.dirname(file.relativePath) === "." ? "" : normalizeDrivePath(path.dirname(file.relativePath));
    if (!directoryCache.has(dirname)) {
      const folder = await ensureDrivePath({
        accessToken,
        fetchImpl,
        pathParts: splitDrivePath(dirname),
        startParentId: rootFolder.id,
      });
      directoryCache.set(dirname, folder.id);
    }
    await uploadFileToDrive({
      accessToken,
      fetchImpl,
      file,
      parentId: directoryCache.get(dirname),
    });
    uploadedFileCount += 1;
  }

  return {
    syncStatus: "synced",
    driveFolderId: rootFolder.id,
    driveFolderUrl: rootFolder.webViewLink || `https://drive.google.com/drive/folders/${rootFolder.id}`,
    drivePath: rootPathParts.join("/"),
    uploadedFileCount,
    syncedAt: now(),
  };
}

module.exports = {
  buildGoogleOAuthUrl,
  exchangeGoogleOAuthCode,
  driveFetchJson,
  ensureDrivePath,
  getGoogleDriveConfig,
  getValidAccessToken,
  getGoogleDriveStatus,
  normalizeDrivePath,
  saveGoogleDriveConfig,
  splitDrivePath,
  uploadFolderToGoogleDrive,
};
