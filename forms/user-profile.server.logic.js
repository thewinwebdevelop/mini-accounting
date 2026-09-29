const { sortCompanyPositions } = require("./company-position.logic.js");
const {
  mapProfileRow,
  normalizeProfileInput,
  formatProfileName,
} = require("./user-profile.logic.js");
const { supabaseRequest } = require("./supabase.logic.js");

const PROFILE_SELECT = [
  "user_id",
  "first_name",
  "last_name",
  "company_position_id",
  "app_users(display_name,picture_url)",
  "company_positions(id,code,label,status,sort_order)",
].join(",");

function profileError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertSessionUserId(userId) {
  const value = typeof userId === "string" ? userId.trim() : "";
  if (!value) throw profileError("PROFILE_USER_REQUIRED", "Authenticated user is required", 401);
  return value;
}

function profileRowWithIdentity(row) {
  const source = row && typeof row === "object" ? row : {};
  const identity = Array.isArray(source.app_users) ? source.app_users[0] : source.app_users;
  return mapProfileRow({
    ...source,
    display_name: source.display_name ?? identity?.display_name,
    picture_url: source.picture_url ?? identity?.picture_url,
  });
}

async function readProfileRow({ client, userId, request }) {
  const sessionUserId = assertSessionUserId(userId);
  const rows = await request(
    client,
    `/rest/v1/app_user_profiles?select=${encodeURIComponent(PROFILE_SELECT)}&user_id=eq.${encodeURIComponent(sessionUserId)}&limit=1`,
    {},
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getAppUserProfile({ client, userId, request = supabaseRequest } = {}) {
  const row = await readProfileRow({ client, userId, request });
  return profileRowWithIdentity(row);
}

async function assertActivePosition({ client, positionId, request }) {
  const rows = await request(
    client,
    `/rest/v1/company_positions?select=id,code,label,status,sort_order&id=eq.${encodeURIComponent(positionId)}&limit=1`,
    {},
  );
  const position = Array.isArray(rows) ? rows[0] : null;
  if (!position || position.status !== "active") {
    throw profileError("PROFILE_POSITION_INVALID", "Selected company position is not active");
  }
  return position;
}

async function updateAppUserProfile({ client, userId, input, request = supabaseRequest } = {}) {
  const sessionUserId = assertSessionUserId(userId);
  const normalized = normalizeProfileInput(input);
  if (!normalized.companyPositionId) {
    throw profileError("PROFILE_POSITION_INVALID", "Company position is required");
  }
  await assertActivePosition({ client, positionId: normalized.companyPositionId, request });

  await request(
    client,
    `/rest/v1/app_user_profiles?user_id=eq.${encodeURIComponent(sessionUserId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: {
        first_name: normalized.firstName,
        last_name: normalized.lastName,
        company_position_id: normalized.companyPositionId,
      },
    },
  );
  return getAppUserProfile({ client, userId: sessionUserId, request });
}

async function listCompanyPositions({ client, request = supabaseRequest } = {}) {
  const rows = await request(
    client,
    "/rest/v1/company_positions?select=id,code,label,status,sort_order&status=eq.active&order=sort_order.asc,label.asc",
    {},
  );
  return sortCompanyPositions(Array.isArray(rows) ? rows : []);
}

function profileRequesterFallback(profile) {
  return {
    requesterName: formatProfileName(profile),
    requesterRole: typeof profile?.companyPositionLabel === "string" ? profile.companyPositionLabel.trim() : "",
  };
}

module.exports = {
  getAppUserProfile,
  updateAppUserProfile,
  listCompanyPositions,
  profileRequesterFallback,
};
