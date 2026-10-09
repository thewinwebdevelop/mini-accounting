import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { VendorMasterPage } from "../pages/vendor-master.page.mjs";

test("requires duplicate confirmation, supports deactivate/reactivate, and preserves document snapshot", async ({ authenticatedPage }) => {
  const vendors = new VendorMasterPage(authenticatedPage);
  await vendors.open();
  const name = `E2E Vendor ${Date.now()}`;
  const taxId = `010555${String(Date.now()).slice(-7)}`;
  const created = await vendors.create({ name, taxId });
  await vendors.expectVisible(name);
  const duplicate = await vendors.expectDuplicateConfirmation({ name: `${name} copy`, taxId });
  expect(duplicate.confirmationMessage).toContain("พบผู้ขายที่อาจซ้ำ");
  expect(duplicate.confirmationMessage).toContain(name);
  expect(duplicate.confirmationMessage).toContain(taxId);
  expect(duplicate.vendor).toMatchObject({ name: `${name} copy`, taxId });
  await vendors.deactivate(created.id);
  await vendors.reload();
  await vendors.expectStatus(created.id, "inactive");
  await vendors.reactivate(created.id);
  await vendors.reload();
  await vendors.expectStatus(created.id, "active");
  const snapshot = await vendors.createExpenseSnapshot({ vendorId: created.id, name });
  expect(snapshot).toMatchObject({ vendorId: created.id });
  expect(snapshot.vendorSnapshot).toMatchObject({ name, taxId });
  await vendors.deactivate(created.id);
  expect((await vendors.get(snapshot.requestNo)).vendorSnapshot).toMatchObject({ name, taxId });
});
