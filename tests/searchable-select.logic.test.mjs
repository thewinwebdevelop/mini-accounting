import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const scriptPath = new URL("../forms/searchable-select.logic.browser.js", import.meta.url);

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.names = new Set();
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
    this.element._className = [...this.names].join(" ");
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
    this.element._className = [...this.names].join(" ");
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.key = options.key || "";
    this.target = null;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = new Map();
    this.classList = new FakeClassList(this);
    this._className = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.type = "";
    this.name = "";
    this.tabIndex = 0;
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = value;
    this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get options() {
    return this.children.filter((child) => child.tagName === "OPTION");
  }

  get selectedOptions() {
    return this.options.filter((option) => option.value === this.value);
  }

  append(...nodes) {
    nodes.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      }
      node.parentNode = this;
      this.children.push(node);
    });
  }

  before(node) {
    if (!this.parentNode) return;
    if (node.parentNode) {
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    }
    const index = this.parentNode.children.indexOf(this);
    node.parentNode = this.parentNode;
    this.parentNode.children.splice(index, 0, node);
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
    if (name === "id") this.id = value;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  matches(selector) {
    if (selector === "select[data-searchable]") return this.tagName === "SELECT" && "searchable" in this.dataset;
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains(target));
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    (this.eventListeners.get(event.type) || []).forEach((listener) => listener(event));
    return true;
  }

  click() {
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super("#document", null);
    this.ownerDocument = this;
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.activeElement = null;
    this.append(this.head, this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function createFakePage() {
  const document = new FakeDocument();
  const window = {
    document,
    Event: FakeEvent,
    addEventListener(type, listener) {
      this.listeners ||= new Map();
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    },
    dispatchEvent(event) {
      (this.listeners?.get(event.type) || []).forEach((listener) => listener(event));
    },
  };

  class FakeMutationObserver {
    constructor(listener) {
      this.listener = listener;
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }

  return { document, window, MutationObserver: FakeMutationObserver };
}

async function loadSearchableSelect() {
  const page = createFakePage();
  const context = vm.createContext({
    document: page.document,
    window: page.window,
    Event: FakeEvent,
    MutationObserver: page.MutationObserver,
    Node: { ELEMENT_NODE: 1 },
  });
  const script = await readFile(scriptPath, "utf8");
  vm.runInContext(script, context);
  return page;
}

function appendOption(select, value, label) {
  const option = select.ownerDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
  return option;
}

test("searchable select renders search inside the dropdown popover and filters options", async () => {
  const { document, window } = await loadSearchableSelect();
  const select = document.createElement("select");
  select.dataset.searchable = "";
  select.value = "sku-a";
  appendOption(select, "sku-a", "เสื้อ A สีดำ M");
  appendOption(select, "sku-b", "กระโปรง B สีขาว F");
  document.body.append(select);

  window.SearchableSelect.enhance(select);

  const wrapper = document.body.querySelector(".searchable-select");
  const trigger = wrapper.querySelector(".searchable-select-trigger");
  const panel = wrapper.querySelector(".searchable-select-panel");
  const search = panel.querySelector(".searchable-select-search");

  assert.equal(document.body.querySelector(".select-search"), null);
  assert.equal(search.parentNode, panel);
  assert.equal(panel.hidden, true);

  trigger.click();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, search);

  search.value = "กระโปรง";
  search.dispatchEvent(new FakeEvent("input"));

  const visibleOptions = panel.querySelectorAll(".searchable-select-option");
  assert.deepEqual(visibleOptions.map((option) => option.querySelector("span")?.textContent || option.textContent), ["กระโปรง B สีขาว F"]);
});

test("searchable select keeps the selected value to one line, clamps options to two lines, and lifts overflow ancestors", async () => {
  const { document, window } = await loadSearchableSelect();
  const section = document.createElement("div");
  section.className = "section";
  const select = document.createElement("select");
  select.dataset.searchable = "";
  select.dataset.displayLines = "2";
  select.value = "stock-1";
  appendOption(select, "stock-1", "รหัสสินค้า - ชื่อสินค้ายาวมากจนต้องตัดข้อความ");
  section.append(select);
  document.body.append(section);

  window.SearchableSelect.enhance(select);

  const styles = document.head.querySelector("#searchableSelectStyles").textContent;
  assert.match(styles, /\.searchable-select-trigger[\s\S]*?white-space:\s*nowrap/);
  assert.match(styles, /\.searchable-select\[data-display-lines="2"\] \.searchable-select-option[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.match(styles, /\.searchable-select\[data-display-lines="2"\] \.searchable-select-option[\s\S]*?height:\s*50px[\s\S]*?line-height:\s*18px/);
  assert.match(styles, /\.section\.searchable-select-open[\s\S]*?overflow:\s*visible/);
  assert.match(styles, /\.section:has\(\.searchable-select-panel:not\(\[hidden\]\)\)[\s\S]*?overflow:\s*visible/);

  const trigger = section.querySelector(".searchable-select-trigger");
  trigger.click();
  const optionLabel = section.querySelector(".searchable-select-option").querySelector("span");
  assert.ok(optionLabel);
  assert.match(styles, /\.searchable-select\[data-display-lines="2"\] \.searchable-select-option > span[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.equal(section.classList.contains("searchable-select-open"), true);
  trigger.click();
  assert.equal(section.classList.contains("searchable-select-open"), false);
});

test("searchable select lifts overflow ancestors when classList is array-like", async () => {
  const { document, window } = await loadSearchableSelect();
  const row = document.createElement("details");
  row.className = "line-row";
  row.classList = ["line-row"];
  const select = document.createElement("select");
  select.dataset.searchable = "";
  appendOption(select, "sku-1", "Stock SKU 1");
  row.append(select);
  document.body.append(row);

  window.SearchableSelect.enhance(select);

  const trigger = row.querySelector(".searchable-select-trigger");
  assert.doesNotThrow(() => trigger.click());
  assert.match(row.className, /searchable-select-open/);
  assert.doesNotThrow(() => trigger.click());
  assert.doesNotMatch(row.className, /searchable-select-open/);
});

test("searchable select keeps the native select synced for form submission", async () => {
  const { document, window } = await loadSearchableSelect();
  const select = document.createElement("select");
  select.dataset.searchable = "";
  select.value = "stock-1";
  appendOption(select, "stock-1", "TOP-A-BLACK-M");
  appendOption(select, "stock-2", "SKIRT-B-WHITE-F");
  document.body.append(select);

  let changes = 0;
  select.addEventListener("change", () => {
    changes += 1;
  });

  window.SearchableSelect.enhance(select);
  document.body.querySelector(".searchable-select-trigger").click();
  document.body.querySelectorAll(".searchable-select-option")[1].click();

  assert.equal(select.value, "stock-2");
  assert.equal(changes, 1);
  assert.equal(document.body.querySelector(".searchable-select-trigger").textContent, "SKIRT-B-WHITE-F");
});

test("searchable select mirrors disabled native selects on the custom trigger", async () => {
  const { document, window } = await loadSearchableSelect();
  const select = document.createElement("select");
  select.dataset.searchable = "";
  select.disabled = true;
  select.value = "stock-1";
  appendOption(select, "stock-1", "TOP-A-BLACK-M");
  document.body.append(select);

  window.SearchableSelect.enhance(select);

  const trigger = document.body.querySelector(".searchable-select-trigger");
  assert.equal(trigger.disabled, true);
});
