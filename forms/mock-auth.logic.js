const VALID_ROLES = new Set(["employee", "owner", "accounting", "admin"]);
const { normalizeProfileInput } = require("./user-profile.logic.js");

function mockAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function trimmedEnv(env, key) {
  return typeof env?.[key] === "string" ? env[key].trim() : "";
}

function parseMockAuthConfig(env = process.env) {
  const mode = trimmedEnv(env, "SWEET_HOUSE_AUTH_MODE").toLowerCase();
  if (mode !== "mock") return { enabled: false };

  const nodeEnv = trimmedEnv(env, "NODE_ENV").toLowerCase();
  const cloudRun = /^(1|true|yes)$/i.test(trimmedEnv(env, "CLOUD_RUN"));
  const allowNetwork = /^(1|true|yes)$/i.test(trimmedEnv(env, "SWEET_HOUSE_ALLOW_NETWORK"));
  if (nodeEnv === "production" || cloudRun || allowNetwork) {
    throw mockAuthError("MOCK_AUTH_FORBIDDEN", "Mock auth is only available on a local loopback server");
  }

  const userId = trimmedEnv(env, "SWEET_HOUSE_MOCK_USER_ID");
  const role = trimmedEnv(env, "SWEET_HOUSE_MOCK_ROLE").toLowerCase();
  if (!userId || !role) {
    throw mockAuthError("MOCK_AUTH_CONFIG_MISSING", "Mock auth fixture user and role are required");
  }
  if (!VALID_ROLES.has(role)) {
    throw mockAuthError("MOCK_AUTH_CONFIG_INVALID", "Mock auth role is invalid");
  }

  return {
    enabled: true,
    userId,
    role,
    lineUserId: trimmedEnv(env, "SWEET_HOUSE_MOCK_LINE_USER_ID") || "U_LOCAL_MOCK_USER",
    displayName: trimmedEnv(env, "SWEET_HOUSE_MOCK_DISPLAY_NAME") || "Local Mock User",
    pictureUrl: trimmedEnv(env, "SWEET_HOUSE_MOCK_PICTURE_URL"),
    firstName: trimmedEnv(env, "SWEET_HOUSE_MOCK_FIRST_NAME") || "Local",
    lastName: trimmedEnv(env, "SWEET_HOUSE_MOCK_LAST_NAME") || "Mock User",
    companyPositionId: trimmedEnv(env, "SWEET_HOUSE_MOCK_POSITION_ID") || "mock-owner",
  };
}

function buildMockSessionUser(config) {
  return {
    id: config.userId,
    lineUserId: config.lineUserId,
    displayName: config.displayName,
    pictureUrl: config.pictureUrl,
    status: "active",
    role: config.role,
  };
}

function buildMockProfileStore(config) {
  const positions = [
    { id: "mock-owner", code: "owner", label: "เจ้าของบริษัท", status: "active", sortOrder: 10 },
    { id: "mock-marketing", code: "marketing", label: "marketing", status: "active", sortOrder: 20 },
  ];
  const selectedPosition = positions.some(position => position.id === config.companyPositionId)
    ? config.companyPositionId
    : positions[0].id;
  let profile = {
    firstName: config.firstName,
    lastName: config.lastName,
    companyPositionId: selectedPosition,
    companyPositionLabel: positions.find(position => position.id === selectedPosition).label,
    displayName: config.displayName,
    pictureUrl: config.pictureUrl,
  };

  return {
    getProfile(userId) {
      if (String(userId || "") !== config.userId) return null;
      return { ...profile };
    },
    listPositions() {
      return positions.map(position => ({ ...position }));
    },
    updateProfile(userId, input) {
      if (String(userId || "") !== config.userId) return null;
      const normalized = normalizeProfileInput(input);
      const position = positions.find(candidate => candidate.id === normalized.companyPositionId);
      if (!position || position.status !== "active") {
        const error = new Error("Selected company position is not active");
        error.code = "PROFILE_POSITION_INVALID";
        throw error;
      }
      profile = {
        ...profile,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        companyPositionId: position.id,
        companyPositionLabel: position.label,
      };
      return { ...profile };
    },
  };
}

module.exports = {
  buildMockSessionUser,
  buildMockProfileStore,
  parseMockAuthConfig,
};
