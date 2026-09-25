import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function page(name) {
  return readFile(join(process.cwd(), "forms", name), "utf8");
}

test("Shopee connection page is separate and exposes auth and sync actions", async () => {
  const html = await page("shopee-connection.html");
  assert.match(html, /id="shopeeConnectButton"/);
  assert.match(html, /id="syncShopeeOrdersButton"/);
  assert.match(html, /shopee-connection\.logic\.browser\.js/);
  assert.match(html, /href="\/shopee-orders"/);
});

test("Shopee orders page is separate from manual mapping and shipment", async () => {
  const html = await page("shopee-orders.html");
  assert.match(html, /id="shopeeOrderRows"/);
  assert.match(html, /id="openShopeeMappingButton"/);
  assert.match(html, /shopee-orders\.logic\.browser\.js/);
  assert.doesNotMatch(html, /data-shopee-mapping/);
  assert.doesNotMatch(html, /id="prepareShopeeShipmentButton"/);
});

test("Shopee mapping page contains only mapping controls and shipment link", async () => {
  const html = await page("shopee-mapping.html");
  assert.match(html, /data-shopee-mapping/);
  assert.match(html, /id="continueToShopeeShipmentButton"/);
  assert.match(html, /shopee-mapping\.logic\.browser\.js/);
  assert.doesNotMatch(html, /id="shopeeOrderRows"/);
});

test("Shopee shipment page contains batch arrange and label actions", async () => {
  const html = await page("shopee-shipment.html");
  assert.match(html, /id="prepareShopeeShipmentButton"/);
  assert.match(html, /id="arrangeShopeeShipmentButton"/);
  assert.match(html, /id="overlayShopeeLabelsButton"/);
  assert.match(html, /id="printShopeeLabelsButton"/);
  assert.match(html, /shopee-shipment\.logic\.browser\.js/);
  assert.doesNotMatch(html, /id="shopeeConnectButton"/);
});
