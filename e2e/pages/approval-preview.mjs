import { expect } from "@playwright/test";

export async function checkApprovalPreview(page, documentNo, { failFirst = false, auditPacket = false } = {}) {
  const summary = page.getByRole("tab", { name: "ข้อมูลสรุป" });
  const pdf = page.getByRole("tab", { name: "PDF ฉบับเต็ม" });
  const canvas = page.locator("#reviewPdf canvas");
  await expect(summary).toHaveAttribute("aria-selected", "true");
  await expect(canvas).toBeHidden();
  await expect(page.locator("#workflowReviewConfirm")).toBeEnabled();
  if (failFirst) await page.route("**/*/pdf/*.pdf*", route => route.fulfill({ status: 503 }), { times: 1 });
  await pdf.click();
  if (failFirst) {
    await expect(page.locator("#reviewPdf")).toContainText("โหลด PDF ไม่สำเร็จ");
    await expect(page.locator("#workflowReviewConfirm")).toBeEnabled();
    await page.getByRole("button", { name: "ลองโหลด PDF อีกครั้ง" }).click();
  }
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-label", "หน้า 1");
  const url = await page.getByRole("link", { name: "เปิด PDF เต็มจอ" }).getAttribute("href");
  expect(decodeURIComponent(url)).toContain(documentNo);
  if (auditPacket) expect(decodeURIComponent(url)).toContain("audit-packet.pdf");
  if (auditPacket) {
    await page.getByRole("button", { name: "หน้าถัดไป" }).click();
    await expect(canvas).toHaveAttribute("aria-label", "หน้า 2");
  }
  await summary.click();
  await expect(page.locator("#reviewSummary")).toContainText(documentNo);
}
