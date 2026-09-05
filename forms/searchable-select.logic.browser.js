(function () {
  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function filterOptions(select, term) {
    const query = normalize(term);
    [...select.options].forEach((item) => {
      const isPlaceholder = item.value === "";
      const matches = !query || normalize(item.textContent).includes(query);
      item.hidden = !isPlaceholder && !matches;
    });
  }

  function enhance(select) {
    if (!select || select.dataset.searchableEnhanced === "true") return;
    select.dataset.searchableEnhanced = "true";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "select-search";
    search.placeholder = select.dataset.searchPlaceholder || "ค้นหาใน dropdown";
    search.setAttribute("aria-label", search.placeholder);
    select.before(search);

    search.addEventListener("input", () => filterOptions(select, search.value));
    select.addEventListener("change", () => {
      search.value = "";
      filterOptions(select, "");
    });

    new MutationObserver(() => filterOptions(select, search.value)).observe(select, {
      childList: true,
      subtree: true,
    });
  }

  function enhanceAll(root = document) {
    if (root.matches?.("select[data-searchable]")) enhance(root);
    root.querySelectorAll?.("select[data-searchable]").forEach(enhance);
  }

  window.SearchableSelect = { enhance, enhanceAll };
  window.addEventListener("DOMContentLoaded", () => {
    enhanceAll();
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceAll(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
}());
