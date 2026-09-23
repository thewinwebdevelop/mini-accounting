(function attachVendorPicker(global) {
  "use strict";

  const clean = (value) => String(value ?? "").trim();
  const defaultMap = {
    name: ["vendorName", "payeeName", "paymentTargetName"],
    taxId: ["vendorTaxId", "payeeTaxId", "paymentTargetTaxId"],
    address: ["vendorAddress", "payeeAddress", "paymentAddress"],
    contactName: ["vendorContactName", "payeeContactName", "paymentContactName"],
    phone: ["vendorPhone", "payeePhone", "paymentPhone"],
    email: ["vendorEmail", "payeeEmail", "paymentEmail"],
    bankName: ["vendorBankName", "bankName", "paymentBankName"],
    accountNo: ["vendorAccountNo", "accountNo", "paymentAccountNo"],
    paymentChannel: ["vendorPaymentChannel", "paymentChannel"],
    paymentReference: ["vendorPaymentReference", "paymentReference"],
    defaultBusinessPurpose: ["vendorDefaultBusinessPurpose", "defaultBusinessPurpose"],
  };

  function field(form, name) {
    return form?.elements?.[name] || form?.querySelector?.(`[name="${name}"]`);
  }

  function vendorLabel(vendor) {
    const name = clean(vendor?.name) || "ไม่ระบุชื่อ";
    return vendor?.taxId ? `${name} (${vendor.taxId})` : name;
  }

  function applyVendorToForm(form, vendor, mapping = {}) {
    if (!form || !vendor) return;
    const map = { ...defaultMap, ...mapping };
    Object.entries(map).forEach(([key, names]) => {
      const candidates = Array.isArray(names) ? names : [names];
      const input = candidates.map((name) => field(form, name)).find(Boolean);
      if (input && Object.prototype.hasOwnProperty.call(vendor, key)) input.value = vendor[key] ?? "";
    });
    form.dataset.vendorId = clean(vendor.id);
    form.dataset.vendorSnapshot = JSON.stringify(vendor);
  }

  function clearVendorSelection(select, form) {
    if (select) select.value = "";
    if (form) {
      delete form.dataset.vendorId;
      delete form.dataset.vendorSnapshot;
    }
  }

  async function loadVendorOptions(select, options = {}) {
    if (!select) return [];
    const fetchImpl = options.fetchImpl || global.fetch;
    const endpoint = options.endpoint || "/api/vendors";
    try {
      const response = await fetchImpl(endpoint);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดรายชื่อผู้ขายไม่สำเร็จ");
      const vendors = (Array.isArray(result) ? result : result.vendors || [])
        .filter((vendor) => vendor && vendor.status === "active");
      const makeOption = (text, value) => global.Option
        ? new global.Option(text, value)
        : Object.assign(global.document.createElement("option"), { textContent: text, value });
      select.replaceChildren(makeOption("กรอกเอง / ไม่ใช้ preset", ""));
      vendors.forEach((vendor) => select.appendChild(makeOption(vendorLabel(vendor), vendor.id)));
      return vendors;
    } catch (error) {
      const fallback = global.Option ? new global.Option("กรอกเอง / ไม่ใช้ preset", "") : Object.assign(global.document.createElement("option"), { textContent: "กรอกเอง / ไม่ใช้ preset", value: "" });
      select.replaceChildren(fallback);
      options.onError?.(error);
      return [];
    }
  }

  function candidateFromForm(form, mapping = {}) {
    const map = { ...defaultMap, ...mapping };
    return Object.fromEntries(Object.entries(map).map(([key, names]) => {
      const candidates = Array.isArray(names) ? names : [names];
      const input = candidates.map((name) => field(form, name)).find(Boolean);
      return [key, clean(input?.value)];
    }));
  }

  async function saveVendorPresetIfRequested(options = {}) {
    const { form, checkbox, mapping = {}, fetchImpl = global.fetch, confirmImpl = global.confirm } = options;
    if (!checkbox?.checked || !form || clean(form.dataset.vendorId)) return null;
    const candidate = options.candidate || candidateFromForm(form, mapping);
    if (!candidate.name) return null;
    const post = async (body) => {
      const response = await fetchImpl("/api/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      return { response, result };
    };
    let matchResult = null;
    try {
      const params = global.URLSearchParams
        ? new global.URLSearchParams(Object.entries(candidate).filter(([, value]) => value))
        : Object.entries(candidate).filter(([, value]) => value).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
      const matchResponse = await fetchImpl(`/api/vendors/matches?${params}`);
      if (matchResponse.ok) matchResult = await matchResponse.json();
    } catch {
      // Preset saving remains best effort; the document can still be saved.
    }
    const duplicateIds = matchResult?.matches?.map((match) => match.id).filter(Boolean) || [];
    let { response, result } = await post(duplicateIds.length ? {
      ...candidate,
      expectedMatchIds: duplicateIds,
      expectedCandidateFingerprint: matchResult.candidateFingerprint,
    } : candidate);
    if (response.status === 409 && result.candidateFingerprint && Array.isArray(result.matches)) {
      const ids = result.matches.map((match) => match.id).filter(Boolean);
      const confirmText = "พบผู้ขายข้อมูลใกล้เคียง ต้องการบันทึกซ้ำหรือไม่?";
      if (!confirmImpl?.(confirmText)) return null;
      ({ response, result } = await post({ ...candidate, confirmDuplicate: true, expectedMatchIds: ids, expectedCandidateFingerprint: result.candidateFingerprint }));
    }
    if (!response.ok) throw new Error(result.error || "บันทึกผู้ขายไม่สำเร็จ");
    const vendor = result.vendor || result;
    applyVendorToForm(form, vendor, mapping);
    return vendor;
  }

  function create(options = {}) {
    const form = options.form;
    const select = options.select;
    let vendors = [];
    const state = { get vendors() { return vendors; } };
    const load = async () => { vendors = await loadVendorOptions(select, options); return vendors; };
    select?.addEventListener("change", () => {
      const vendor = vendors.find((item) => item.id === select.value);
      if (vendor) applyVendorToForm(form, vendor, options.mapping);
      else clearVendorSelection(select, form);
      options.onChange?.(vendor || null);
    });
    return { state, load, applyVendorToForm: (vendor) => applyVendorToForm(form, vendor, options.mapping), clearVendorSelection: () => clearVendorSelection(select, form), saveVendorPresetIfRequested: () => saveVendorPresetIfRequested(options) };
  }

  global.SharedVendorPicker = { loadVendorOptions, applyVendorToForm, clearVendorSelection, saveVendorPresetIfRequested, create, candidateFromForm };
}(window));
