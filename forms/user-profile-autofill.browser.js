(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SweetHouseUserProfileAutofill = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  function clean(value) {
    return String(value ?? "").trim();
  }

  function formatProfileName(profile) {
    return [profile?.firstName, profile?.lastName].map(clean).filter(Boolean).join(" ");
  }

  function fieldValue(field) {
    return field && typeof field.value !== "undefined" ? clean(field.value) : "";
  }

  function setPositionValue(field, value) {
    if (!field || !value) return false;
    if (String(field.tagName || "").toUpperCase() === "SELECT") {
      const options = Array.from(field.options || field.querySelectorAll?.("option") || []);
      const option = options.find((candidate) => clean(candidate.value) === value && !candidate.disabled);
      if (!option) return false;
    }
    field.value = value;
    if (typeof Event === "function" && typeof field.dispatchEvent === "function") {
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  function autofillNewDocument({ form, isNewDocument, nameField, positionField, profile } = {}) {
    if (!isNewDocument) return { status: "skipped" };
    if (!profile || typeof profile !== "object") return { status: "skipped" };

    const name = formatProfileName(profile);
    const position = clean(profile.companyPositionLabel);
    let filled = false;
    if (nameField && !fieldValue(nameField) && name) {
      nameField.value = name;
      filled = true;
    }
    if (positionField && !fieldValue(positionField) && position) {
      filled = setPositionValue(positionField, position) || filled;
    }
    return { status: filled ? "filled" : "unchanged", form };
  }

  async function loadProfile(fetchImpl = globalThis.fetch) {
    try {
      const response = await fetchImpl("/api/auth/profile", { credentials: "same-origin" });
      if (!response?.ok) throw new Error("profile unavailable");
      const result = await response.json();
      return { status: "loaded", profile: result?.profile || null };
    } catch (error) {
      return { status: "unavailable", error };
    }
  }

  return { formatProfileName, autofillNewDocument, loadProfile, fetchProfile: loadProfile };
}));
