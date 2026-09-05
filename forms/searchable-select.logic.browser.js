(function () {
  const controllers = new WeakMap();
  let openController = null;

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function injectStyles() {
    if (document.querySelector("#searchableSelectStyles")) return;
    const style = document.createElement("style");
    style.id = "searchableSelectStyles";
    style.textContent = `
      .searchable-select {
        position: relative;
        display: grid;
        gap: 0;
        width: 100%;
      }
      .searchable-select-native {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .searchable-select-trigger {
        position: relative;
        width: 100%;
        min-height: 38px;
        padding: 8px 34px 8px 10px;
        color: var(--ink, #1f2933);
        background: #ffffff;
        border: 1px solid #bcccdc;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
        font: inherit;
      }
      .searchable-select-trigger::after {
        content: "";
        position: absolute;
        right: 12px;
        top: 50%;
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 6px solid var(--brand, #334e68);
        transform: translateY(-35%);
      }
      .searchable-select-trigger:focus {
        border-color: var(--accent, #0f766e);
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
        outline: none;
      }
      .searchable-select-trigger:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
      .searchable-select-panel {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 80;
        display: grid;
        gap: 6px;
        width: 100%;
        min-width: min(320px, calc(100vw - 32px));
        max-height: min(320px, calc(100vh - 90px));
        padding: 8px;
        background: #ffffff;
        border: 1px solid #bcccdc;
        border-radius: 8px;
        box-shadow: 0 12px 28px rgba(16, 42, 67, 0.16);
      }
      .searchable-select-panel[hidden] {
        display: none;
      }
      .searchable-select-search {
        width: 100%;
        min-height: 36px;
        padding: 7px 9px;
        color: var(--ink, #1f2933);
        background: #ffffff;
        border: 1px solid #bcccdc;
        border-radius: 6px;
        font: inherit;
      }
      .searchable-select-list {
        display: grid;
        gap: 2px;
        max-height: 232px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .searchable-select-option {
        min-height: 34px;
        padding: 7px 9px;
        color: var(--ink, #1f2933);
        background: transparent;
        border: 0;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
        font: inherit;
      }
      .searchable-select-option:hover,
      .searchable-select-option[aria-selected="true"] {
        background: var(--soft, #f5f7fa);
        color: var(--brand-strong, #102a43);
      }
      .searchable-select-empty {
        padding: 8px 9px;
        color: var(--muted, #66788a);
        font-size: 12px;
      }
    `;
    document.head.append(style);
  }

  function visibleLabel(select) {
    const selected = select.selectedOptions?.[0] || [...select.options].find((option) => option.value === select.value);
    return selected?.textContent || select.options[0]?.textContent || "เลือก";
  }

  function optionMatches(option, term) {
    return !term || normalize(option.textContent).includes(term);
  }

  function enhance(select) {
    if (!select) return;
    const existing = controllers.get(select);
    if (existing) {
      existing.renderOptions();
      return;
    }

    injectStyles();
    select.dataset.searchableEnhanced = "true";
    select.classList.add("searchable-select-native");
    select.tabIndex = -1;

    const wrapper = document.createElement("div");
    wrapper.className = "searchable-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "searchable-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const panel = document.createElement("div");
    panel.className = "searchable-select-panel";
    panel.hidden = true;

    const search = document.createElement("input");
    search.type = "search";
    search.className = "searchable-select-search";
    search.placeholder = select.dataset.searchPlaceholder || "ค้นหา";
    search.setAttribute("aria-label", search.placeholder);

    const list = document.createElement("div");
    list.className = "searchable-select-list";
    list.setAttribute("role", "listbox");

    panel.append(search, list);
    select.before(wrapper);
    wrapper.append(select, trigger, panel);

    function close() {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (openController === controller) openController = null;
    }

    function open() {
      if (select.disabled) return;
      if (openController && openController !== controller) openController.close();
      openController = controller;
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      renderOptions();
      search.focus();
    }

    function choose(option) {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      trigger.focus();
    }

    function renderOptions() {
      trigger.textContent = visibleLabel(select);
      trigger.disabled = select.disabled;
      list.replaceChildren();
      const term = normalize(search.value);
      const matches = [...select.options].filter((option) => optionMatches(option, term));
      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "searchable-select-empty";
        empty.textContent = "ไม่พบตัวเลือก";
        list.append(empty);
        return;
      }
      matches.forEach((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "searchable-select-option";
        item.textContent = option.textContent;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.value === select.value));
        item.disabled = option.disabled;
        item.addEventListener("click", () => choose(option));
        list.append(item);
      });
    }

    const controller = { close, renderOptions };
    controllers.set(select, controller);

    trigger.addEventListener("click", () => {
      if (panel.hidden) open();
      else close();
    });
    search.addEventListener("input", renderOptions);
    select.addEventListener("change", renderOptions);
    document.addEventListener("click", (event) => {
      if (!wrapper.contains(event.target)) close();
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        trigger.focus();
      }
    });
    new MutationObserver(() => renderOptions()).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "label", "selected", "value"],
    });
    renderOptions();
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
