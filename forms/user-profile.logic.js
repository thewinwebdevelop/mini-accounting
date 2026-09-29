const PROFILE_FIELDS = new Set(["firstName", "lastName", "companyPositionId"]);

function profileValidationError(message) {
  const error = new Error(message);
  error.code = "PROFILE_VALIDATION_FAILED";
  return error;
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProfileInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const firstName = trimmedString(source.firstName);
  const lastName = trimmedString(source.lastName);

  if (!firstName) throw profileValidationError("First name is required");
  if (!lastName) throw profileValidationError("Last name is required");
  if (firstName.length > 100) throw profileValidationError("First name is too long");
  if (lastName.length > 100) throw profileValidationError("Last name is too long");

  const companyPositionId = trimmedString(source.companyPositionId);
  return {
    firstName,
    lastName,
    companyPositionId: companyPositionId || null,
  };
}

function mapProfileRow(row) {
  const source = row && typeof row === "object" ? row : {};
  const position = Array.isArray(source.company_positions)
    ? source.company_positions[0]
    : source.company_positions;
  return {
    firstName: trimmedString(source.first_name),
    lastName: trimmedString(source.last_name),
    companyPositionId: source.company_position_id || null,
    companyPositionLabel: trimmedString(position?.label || source.company_position_label),
    displayName: trimmedString(source.display_name),
    pictureUrl: trimmedString(source.picture_url),
  };
}

function formatProfileName(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  return [trimmedString(source.firstName), trimmedString(source.lastName)]
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  PROFILE_FIELDS,
  normalizeProfileInput,
  mapProfileRow,
  formatProfileName,
};
