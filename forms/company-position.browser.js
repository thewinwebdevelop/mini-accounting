(function () {
  function sortPositions(positions) {
    return (Array.isArray(positions) ? positions : [])
      .filter((position) => position && position.status === "active" && String(position.label || "").trim())
      .sort((left, right) => (
        Number(left.sort_order ?? left.sortOrder ?? 0) - Number(right.sort_order ?? right.sortOrder ?? 0)
        || String(left.label).localeCompare(String(right.label))
        || String(left.id || "").localeCompare(String(right.id || ""))
      ));
  }

  function useManualFallback(select, selected) {
    const input = document.createElement("input");
    input.type = "text";
    input.id = select.id;
    input.name = select.name;
    input.placeholder = "เช่น ผู้จัดการ";
    input.value = selected;
    input.setAttribute("aria-label", select.getAttribute?.("aria-label") || "แผนก/ตำแหน่ง");

    const host = select.parentNode;
    if (host?.classList?.contains("searchable-select")) {
      host.hidden = true;
      host.parentNode?.append(input);
    } else {
      select.hidden = true;
      host?.append(input);
    }
    select.id = `${select.id}Master`;
    select.name = "";
    return input;
  }

  async function loadInto(select, { selectedValue } = {}) {
    if (!select || String(select.tagName || "").toUpperCase() !== "SELECT") return;
    const selected = String(selectedValue ?? select.value ?? "");
    const existingOptions = Array.from(select.querySelectorAll?.("option") || []);
    const placeholder = existingOptions.find((option) => option.value === "") || existingOptions[0];
    const placeholderText = placeholder?.textContent || select.dataset.placeholder || "เลือกแผนก/ตำแหน่ง";
    let positions = [];

    try {
      const response = await fetch("/api/company-positions");
      if (!response.ok) throw new Error("company positions unavailable");
      const result = await response.json();
      positions = sortPositions(result?.positions);
    } catch {
      positions = [];
    }

    if (!positions.length) {
      useManualFallback(select, selected);
      return;
    }

    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholderText;
    empty.disabled = true;
    empty.selected = !selected;
    select.append(empty);

    positions.forEach((position) => {
      const option = document.createElement("option");
      option.value = position.label;
      option.textContent = position.label;
      option.selected = position.label === selected;
      select.append(option);
    });

    if (selected && !positions.some((position) => position.label === selected)) {
      const legacy = document.createElement("option");
      legacy.value = selected;
      legacy.textContent = selected;
      legacy.selected = true;
      select.append(legacy);
    }
    select.value = selected;
    window.SearchableSelect?.enhance(select);
  }

  window.SweetHouseCompanyPositions = { loadInto };
}());
