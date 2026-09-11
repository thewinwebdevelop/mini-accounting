import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import serverLogic from "../forms/local-server.logic.js";

const { saveExpenseSubmission, startWorkflowTransaction, saveSubstituteReceiptSubmission } = serverLogic;

// Read paths (forms/local-server.logic.js) now query the documents index
// (forms/document-index.logic.js) instead of walking documents/ on every
// request. The dangerous failure mode this opens up: an existing
// installation that already has real accounting documents on disk, but
// whose sqlite database file is missing, fresh, or predates the index (the
// index table is created lazily by ensureDocumentIndexSchema, so a brand
// new/empty database has zero rows in `documents` even though real
// documents already exist on disk) -- the moment reads trust the index,
// that installation's documents would silently vanish from every list/
// detail page. local-server.mjs's startup hook (rebuildDocumentIndexOnStartup)
// exists specifically to prevent that: it unconditionally rebuilds the
// index from disk before the server starts accepting connections. This test
// proves that end to end over the real HTTP server, not just by calling
// rebuildDocumentIndex directly.
async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("local server did not start"));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("Expense request local web app")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`local server exited early with code ${code}`));
    });
  });
}

async function requestJson(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `HTTP ${response.status}`);
  return body;
}

async function stopServer(child) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

test("an installation with real documents on disk but a wiped/never-built index is not empty after the server starts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-index-startup-"));
  const port = 19277;
  const baseUrl = `http://localhost:${port}`;

  try {
    // Create real documents the normal way -- this also writes them
    // through into the index, exactly like a running server would.
    const request = await saveExpenseSubmission({
      rootDir,
      payload: {
        accountingMonth: "2026-09",
        requestTitle: "ค่าน้ำก่อนดัชนีหาย",
        requestType: "reimbursement",
        requesterName: "คุณทดสอบ",
        expenseLines: [],
      },
    });

    const txn = await startWorkflowTransaction({
      rootDir,
      templateId: "stock_no_tax_invoice_company_bank",
      accountingMonth: "2026-09",
      title: "ธุรกรรมก่อนดัชนีหาย",
    });

    // Now simulate exactly the dangerous scenario: the sqlite database file
    // (which holds the documents index alongside inventory data -- see
    // forms/inventory-db.logic.js) is gone, as it would be for a brand-new
    // empty database file, or one that predates the index feature. The
    // documents on disk above are completely untouched.
    await unlink(join(rootDir, "data", "sweet-house.sqlite"));

    const child = spawn(process.execPath, ["local-server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        SWEET_HOUSE_ROOT_DIR: rootDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await waitForServer(child);

      const { requests } = await requestJson(baseUrl, "/api/expense-requests");
      assert.equal(
        requests.some((record) => record.requestNo === request.requestNo),
        true,
        "the expense request created before the database was wiped must still be listed after startup",
      );

      const { transactions } = await requestJson(baseUrl, "/api/workflow-transactions");
      assert.equal(
        transactions.some((record) => record.transactionNo === txn.transactionNo),
        true,
        "the workflow transaction created before the database was wiped must still be listed after startup",
      );

      const detail = await requestJson(baseUrl, `/api/expense-requests/${encodeURIComponent(request.requestNo)}`);
      assert.equal(detail.requestNo, request.requestNo);
    } finally {
      await stopServer(child);
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
