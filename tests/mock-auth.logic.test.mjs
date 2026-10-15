import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMockSessionUser,
  buildMockProfileStore,
  parseMockAuthConfig,
} from "../forms/mock-auth.logic.js";

test("mock auth requires an explicit fixture user and valid local-only role", () => {
  assert.throws(
    () => parseMockAuthConfig({ SWEET_HOUSE_AUTH_MODE: "mock", NODE_ENV: "production" }),
    error => error.code === "MOCK_AUTH_FORBIDDEN",
  );
  assert.throws(
    () => parseMockAuthConfig({ SWEET_HOUSE_AUTH_MODE: "mock", NODE_ENV: "development" }),
    error => error.code === "MOCK_AUTH_CONFIG_MISSING",
  );
  assert.throws(
    () => parseMockAuthConfig({
      SWEET_HOUSE_AUTH_MODE: "mock",
      NODE_ENV: "development",
      SWEET_HOUSE_MOCK_USER_ID: "fixture-user",
      SWEET_HOUSE_MOCK_ROLE: "superuser",
    }),
    error => error.code === "MOCK_AUTH_CONFIG_INVALID",
  );
});

test("mock auth builds a server-owned session user from environment config", () => {
  const config = parseMockAuthConfig({
    SWEET_HOUSE_AUTH_MODE: "mock",
    NODE_ENV: "development",
    SWEET_HOUSE_MOCK_USER_ID: "fixture-user",
    SWEET_HOUSE_MOCK_ROLE: "owner",
    SWEET_HOUSE_MOCK_DISPLAY_NAME: "ผู้ทดสอบ Local",
    SWEET_HOUSE_MOCK_LINE_USER_ID: "U_LOCAL_FIXTURE",
  });

  assert.deepEqual(buildMockSessionUser(config), {
    id: "fixture-user",
    lineUserId: "U_LOCAL_FIXTURE",
    displayName: "ผู้ทดสอบ Local",
    pictureUrl: "",
    status: "active",
    role: "owner",
  });
});

test("mock auth provides an in-memory profile and company-position master for local UI testing", () => {
  const config = parseMockAuthConfig({
    SWEET_HOUSE_AUTH_MODE: "mock",
    NODE_ENV: "development",
    SWEET_HOUSE_MOCK_USER_ID: "fixture-user",
    SWEET_HOUSE_MOCK_ROLE: "owner",
    SWEET_HOUSE_MOCK_DISPLAY_NAME: "ผู้ทดสอบ Local",
    SWEET_HOUSE_MOCK_FIRST_NAME: "ชื่อเดิม",
    SWEET_HOUSE_MOCK_LAST_NAME: "นามสกุลเดิม",
    SWEET_HOUSE_MOCK_POSITION_ID: "mock-owner",
  });
  const store = buildMockProfileStore(config);

  assert.deepEqual(store.listPositions().map(position => position.id), ["mock-owner", "mock-marketing"]);
  assert.deepEqual(store.getProfile("fixture-user"), {
    firstName: "ชื่อเดิม",
    lastName: "นามสกุลเดิม",
    companyPositionId: "mock-owner",
    companyPositionLabel: "เจ้าของบริษัท",
    displayName: "ผู้ทดสอบ Local",
    pictureUrl: "",
  });
  assert.equal(store.updateProfile("fixture-user", {
    firstName: "ชื่อใหม่",
    lastName: "นามสกุลใหม่",
    companyPositionId: "mock-marketing",
  }).companyPositionLabel, "marketing");
});
