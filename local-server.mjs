import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  buildGoogleOAuthUrl,
  exchangeGoogleOAuthCode,
  getGoogleDriveStatus,
  saveGoogleDriveConfig,
} = require("./forms/google-drive.logic.js");
const {
  getCompanySettings,
  saveCompanySettings,
} = require("./forms/company-settings.logic.js");
const {
  approveSubstituteReceipt,
  getNextExpenseRequestInfo,
  getNextSubstituteReceiptInfo,
  getExpenseDraft,
  getExpenseRequestFile,
  getSubstituteReceiptDraft,
  getSubstituteReceiptFile,
  getSubmittedSubstituteReceipt,
  listExpenseDrafts,
  listExpenseRequests,
  listSubstituteReceipts,
  parseMultipartForm,
  saveExpenseDraft,
  saveExpenseSubmission,
  saveSubstituteReceiptDraft,
  saveSubstituteReceiptSubmission,
  receiveSubstituteReceiptStock,
  getSubmittedExpenseRequest,
  syncExpenseRequestToDrive,
  syncSubstituteReceiptToDrive,
} = require("./forms/local-server.logic.js");
const {
  createProductCategory,
  createProduct,
  createPurchaseInMovement,
  createStockSku,
  getStockCard,
  listInventoryBalances,
  listProductCategories,
  listProducts,
  listStockSkus,
  updateProductCategory,
  updateProduct,
  updateStockSku,
} = require("./forms/inventory.logic.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = __dirname;
const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || appDir;
const formsDir = path.join(appDir, "forms");
const port = Number(process.env.PORT || 8787);
const maxBodyBytes = 80 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function safeStaticPath(urlPath) {
  const routeMap = {
    "/": "/index.html",
    "/expense-request": "/expense-request.html",
    "/expense-request/": "/expense-request.html",
    "/expense-requests": "/expense-requests.html",
    "/expense-requests/": "/expense-requests.html",
    "/substitute-receipt": "/substitute-receipt.html",
    "/substitute-receipt/": "/substitute-receipt.html",
    "/substitute-receipts": "/substitute-receipts.html",
    "/substitute-receipts/": "/substitute-receipts.html",
    "/google-drive": "/google-drive.html",
    "/google-drive/": "/google-drive.html",
    "/company-settings": "/company-settings.html",
    "/company-settings/": "/company-settings.html",
    "/inventory": "/inventory.html",
    "/inventory/": "/inventory.html",
    "/inventory-settings": "/inventory-settings.html",
    "/inventory-settings/": "/inventory-settings.html",
  };
  const requestedPath = routeMap[urlPath] || urlPath;
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(formsDir, normalized);
  if (!absolutePath.startsWith(formsDir)) return null;
  return absolutePath;
}

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBodyBytes) {
      throw new Error("Uploaded files are larger than the local limit");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function getOAuthRedirectUri(request) {
  const host = request.headers.host || `localhost:${port}`;
  return `http://${host}/api/google-drive/oauth2callback`;
}

function parseExpenseRequestFileRoute(urlPath) {
  const prefix = "/api/expense-requests/";
  const marker = "/files/";
  if (!urlPath.startsWith(prefix)) return null;

  const remainder = urlPath.slice(prefix.length);
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex === -1) return null;

  const fileRoute = remainder.slice(markerIndex + marker.length);
  const sectionEnd = fileRoute.indexOf("/");
  if (sectionEnd === -1) return null;

  return {
    requestNo: decodeURIComponent(remainder.slice(0, markerIndex)),
    section: decodeURIComponent(fileRoute.slice(0, sectionEnd)),
    fileName: decodeURIComponent(fileRoute.slice(sectionEnd + 1)),
  };
}

function parseSubstituteReceiptFileRoute(urlPath) {
  const prefix = "/api/substitute-receipts/";
  const marker = "/files/";
  if (!urlPath.startsWith(prefix)) return null;

  const remainder = urlPath.slice(prefix.length);
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex === -1) return null;

  const fileRoute = remainder.slice(markerIndex + marker.length);
  const sectionEnd = fileRoute.indexOf("/");
  if (sectionEnd === -1) return null;

  return {
    receiptNo: decodeURIComponent(remainder.slice(0, markerIndex)),
    section: decodeURIComponent(fileRoute.slice(0, sectionEnd)),
    fileName: decodeURIComponent(fileRoute.slice(sectionEnd + 1)),
  };
}

async function handleExpenseSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveExpenseSubmission({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save expense request",
    });
  }
}

async function handleSubstituteReceiptSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveSubstituteReceiptSubmission({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save substitute receipt",
    });
  }
}

async function handleSubstituteReceiptDraftSave(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveSubstituteReceiptDraft({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save substitute receipt draft",
    });
  }
}

async function handleSubstituteReceiptApprove(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await approveSubstituteReceipt({
      rootDir,
      receiptNo,
      approvedBy: payload.approvedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot approve substitute receipt",
    });
  }
}

async function handleSubstituteReceiptReceiveStock(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await receiveSubstituteReceiptStock({
      rootDir,
      receiptNo,
      receivedDate: payload.receivedDate,
      receivedBy: payload.receivedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot receive substitute receipt stock",
    });
  }
}

async function handleExpenseDriveSync(requestNo, response) {
  try {
    const result = await syncExpenseRequestToDrive({
      rootDir,
      requestNo,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot sync expense request to Google Drive",
    });
  }
}

async function handleSubstituteReceiptDriveSync(receiptNo, response) {
  try {
    const result = await syncSubstituteReceiptToDrive({
      rootDir,
      receiptNo,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot sync substitute receipt to Google Drive",
    });
  }
}

async function handleExpenseRequestFile(fileRoute, response) {
  try {
    const file = await getExpenseRequestFile({
      rootDir,
      requestNo: fileRoute.requestNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot open expense request file",
    });
  }
}

async function handleSubstituteReceiptFile(fileRoute, response) {
  try {
    const file = await getSubstituteReceiptFile({
      rootDir,
      receiptNo: fileRoute.receiptNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot open substitute receipt file",
    });
  }
}

async function handleGoogleDriveStatus(response) {
  try {
    sendJson(response, 200, await getGoogleDriveStatus(rootDir));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot read Google Drive status",
    });
  }
}

async function handleCompanySettingsGet(response) {
  try {
    sendJson(response, 200, await getCompanySettings(rootDir));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot read company settings",
    });
  }
}

async function handleCompanySettingsSave(request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await saveCompanySettings({
      rootDir,
      legalName: payload.legalName,
      taxId: payload.taxId,
      branch: payload.branch,
      address: payload.address,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save company settings",
    });
  }
}

async function handleGoogleDriveConfig(request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await saveGoogleDriveConfig({
      rootDir,
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
      driveBasePath: payload.driveBasePath,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save Google Drive config",
    });
  }
}

async function handleGoogleDriveLogin(request, response) {
  try {
    const authUrl = await buildGoogleOAuthUrl({
      rootDir,
      redirectUri: getOAuthRedirectUri(request),
      state: "sweet-house-google-drive",
    });
    redirect(response, authUrl);
  } catch (error) {
    redirect(response, `/google-drive?error=${encodeURIComponent(error.message || "Cannot start Google login")}`);
  }
}

async function handleGoogleDriveCallback(request, response, url) {
  try {
    if (url.searchParams.get("error")) {
      throw new Error(url.searchParams.get("error"));
    }
    await exchangeGoogleOAuthCode({
      rootDir,
      code: url.searchParams.get("code"),
      redirectUri: getOAuthRedirectUri(request),
    });
    redirect(response, "/google-drive?auth=success");
  } catch (error) {
    redirect(response, `/google-drive?error=${encodeURIComponent(error.message || "Google login failed")}`);
  }
}

async function handleDraftSave(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveExpenseDraft({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save draft",
    });
  }
}

async function handleDraftList(response) {
  try {
    const result = await listExpenseDrafts(rootDir);
    sendJson(response, 200, { drafts: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list drafts",
    });
  }
}

async function handleExpenseRequestList(response) {
  try {
    const result = await listExpenseRequests(rootDir);
    sendJson(response, 200, { requests: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list expense requests",
    });
  }
}

async function handleSubstituteReceiptList(response) {
  try {
    const result = await listSubstituteReceipts(rootDir);
    sendJson(response, 200, { receipts: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list substitute receipts",
    });
  }
}

async function handleSubmittedExpenseRequestGet(requestNo, response) {
  try {
    const result = await getSubmittedExpenseRequest(rootDir, requestNo);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load expense request",
    });
  }
}

async function handleSubmittedSubstituteReceiptGet(receiptNo, response) {
  try {
    const result = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load substitute receipt",
    });
  }
}

async function handleDraftGet(draftId, response) {
  try {
    const result = await getExpenseDraft(rootDir, draftId);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load draft",
    });
  }
}

async function handleSubstituteReceiptDraftGet(draftId, response) {
  try {
    const result = await getSubstituteReceiptDraft(rootDir, draftId);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load substitute receipt draft",
    });
  }
}

async function handleNextExpenseRequest(url, response) {
  try {
    const accountingMonth = url.searchParams.get("accountingMonth");
    const result = await getNextExpenseRequestInfo(rootDir, accountingMonth);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot calculate next request number",
    });
  }
}

async function handleNextSubstituteReceipt(url, response) {
  try {
    const accountingMonth = url.searchParams.get("accountingMonth");
    const result = await getNextSubstituteReceiptInfo(rootDir, accountingMonth);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot calculate next substitute receipt number",
    });
  }
}

async function handleInventoryProductList(url, response) {
  try {
    sendJson(response, 200, { products: listProducts(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list products" });
  }
}

async function handleInventoryCategoryList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, { categories: listProductCategories(rootDir, { includeInactive }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list product categories" });
  }
}

async function handleInventoryCategoryCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: createProductCategory(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product category" });
  }
}

async function handleInventoryCategoryUpdate(categoryId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: updateProductCategory(rootDir, categoryId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update product category" });
  }
}

async function handleInventoryProductCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { product: createProduct(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product" });
  }
}

async function handleInventoryProductUpdate(productId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { product: updateProduct(rootDir, productId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update product" });
  }
}

async function handleInventoryStockSkuList(url, response) {
  try {
    sendJson(response, 200, { stockSkus: listStockSkus(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list stock SKUs" });
  }
}

async function handleInventoryStockSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: createStockSku(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create stock SKU" });
  }
}

async function handleInventoryStockSkuUpdate(stockSkuId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: updateStockSku(rootDir, stockSkuId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update stock SKU" });
  }
}

async function handleInventoryPurchaseIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { movement: createPurchaseInMovement(rootDir, payload), balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot receive inventory" });
  }
}

async function handleInventoryBalanceList(response) {
  try {
    sendJson(response, 200, { balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list inventory balances" });
  }
}

async function handleInventoryStockCard(url, response) {
  try {
    sendJson(response, 200, getStockCard(rootDir, url.searchParams.get("stockSkuId")));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock card" });
  }
}

async function handleStaticFile(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const absolutePath = safeStaticPath(url.pathname);
    if (!absolutePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const body = await readFile(absolutePath);
    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && request.url === "/api/inventory/products") {
    await handleInventoryProductCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/categories") {
    await handleInventoryCategoryCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/stock-skus") {
    await handleInventoryStockSkuCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/purchase-in") {
    await handleInventoryPurchaseIn(request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/products/")) {
    const productId = decodeURIComponent(url.pathname.replace("/api/inventory/products/", ""));
    await handleInventoryProductUpdate(productId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/categories/")) {
    const categoryId = decodeURIComponent(url.pathname.replace("/api/inventory/categories/", ""));
    await handleInventoryCategoryUpdate(categoryId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/stock-skus/")) {
    const stockSkuId = decodeURIComponent(url.pathname.replace("/api/inventory/stock-skus/", ""));
    await handleInventoryStockSkuUpdate(stockSkuId, request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/expense-requests") {
    await handleExpenseSubmission(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/substitute-receipts") {
    await handleSubstituteReceiptSubmission(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/substitute-receipt-drafts") {
    await handleSubstituteReceiptDraftSave(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/approve")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/approve", ""));
    await handleSubstituteReceiptApprove(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/receive-stock")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/receive-stock", ""));
    await handleSubstituteReceiptReceiveStock(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/sync-drive")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/sync-drive", ""));
    await handleSubstituteReceiptDriveSync(receiptNo, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/sync-drive")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/sync-drive", ""));
    await handleExpenseDriveSync(requestNo, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/expense-drafts") {
    await handleDraftSave(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/google-drive/config") {
    await handleGoogleDriveConfig(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/company-settings") {
    await handleCompanySettingsSave(request, response);
    return;
  }

  if (request.method === "GET") {
    if (url.pathname === "/drafts" || url.pathname === "/drafts/") {
      redirect(response, "/expense-requests?status=draft");
      return;
    }

    if (url.pathname === "/api/expense-requests/next") {
      await handleNextExpenseRequest(url, response);
      return;
    }

    if (url.pathname === "/api/substitute-receipts/next") {
      await handleNextSubstituteReceipt(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/products") {
      await handleInventoryProductList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/categories") {
      await handleInventoryCategoryList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-skus") {
      await handleInventoryStockSkuList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/balances") {
      await handleInventoryBalanceList(response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-card") {
      await handleInventoryStockCard(url, response);
      return;
    }

    if (url.pathname === "/api/expense-requests") {
      await handleExpenseRequestList(response);
      return;
    }

    if (url.pathname === "/api/substitute-receipts") {
      await handleSubstituteReceiptList(response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipts/") && !url.pathname.includes("/files/")) {
      const receiptNo = decodeURIComponent(url.pathname.replace("/api/substitute-receipts/", ""));
      await handleSubmittedSubstituteReceiptGet(receiptNo, response);
      return;
    }

    if (url.pathname.startsWith("/api/expense-requests/") && !url.pathname.includes("/files/")) {
      const requestNo = decodeURIComponent(url.pathname.replace("/api/expense-requests/", ""));
      await handleSubmittedExpenseRequestGet(requestNo, response);
      return;
    }

    const fileRoute = parseExpenseRequestFileRoute(url.pathname);
    if (fileRoute) {
      await handleExpenseRequestFile(fileRoute, response);
      return;
    }

    const substituteReceiptFileRoute = parseSubstituteReceiptFileRoute(url.pathname);
    if (substituteReceiptFileRoute) {
      await handleSubstituteReceiptFile(substituteReceiptFileRoute, response);
      return;
    }

    if (url.pathname === "/api/google-drive/status") {
      await handleGoogleDriveStatus(response);
      return;
    }

    if (url.pathname === "/api/company-settings") {
      await handleCompanySettingsGet(response);
      return;
    }

    if (url.pathname === "/api/google-drive/login") {
      await handleGoogleDriveLogin(request, response);
      return;
    }

    if (url.pathname === "/api/google-drive/oauth2callback") {
      await handleGoogleDriveCallback(request, response, url);
      return;
    }

    if (url.pathname === "/api/expense-drafts") {
      await handleDraftList(response);
      return;
    }

    if (url.pathname.startsWith("/api/expense-drafts/")) {
      const draftId = decodeURIComponent(url.pathname.replace("/api/expense-drafts/", ""));
      await handleDraftGet(draftId, response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipt-drafts/")) {
      const draftId = decodeURIComponent(url.pathname.replace("/api/substitute-receipt-drafts/", ""));
      await handleSubstituteReceiptDraftGet(draftId, response);
      return;
    }

    await handleStaticFile(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(port, () => {
  console.log(`Expense request local web app: http://localhost:${port}/`);
});
