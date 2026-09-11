// Shared fake-DOM test harness (Item 7 followup).
//
// Every tests/*.html.test.mjs file that runs a real forms/*.js file inside a
// `vm` sandbox needs a synthetic DOM to run it against. Before this module
// existed, each test file hand-typed its own `elementsById` map (a plain
// object literal listing every id the author remembered the page having) and
// its own copy of the `FakeNode` class. That made element coverage only as
// good as the list someone remembered to type: a script that queried an
// element the real HTML never defined would still find a FakeNode for it in
// the hand-typed map and pass, even though the same code would silently
// no-op (or throw) in a real browser tab.
//
// This module fixes that at the root: `buildFakeDomFromHtml` parses the
// *actual* HTML file text (a small tag-structure parser -- not a full HTML5
// parser, just enough to walk elements/attributes/nesting for the
// well-formed markup these forms use) and derives `elementsById`,
// `form.elements`, and `<template>` content directly from that real
// structure. `document.querySelector("#someId")` now returns null unless
// someId genuinely exists in the HTML file under test -- the same as a real
// browser -- so a stale/renamed/missing id fails the test instead of being
// quietly papered over.
//
// Not a general DOM/HTML implementation: only what forms/*.logic.browser.js
// and the inline page controllers in forms/*.html actually call.

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// <script>/<style> bodies are skipped verbatim (never tokenized as tags) --
// exactly like a real HTML parser treats them -- since these files' inline
// <script> blocks are full of `<`/`>` in ordinary JS (comparisons, arrow
// functions, template literals) that would otherwise derail tag scanning.
const RAW_TEXT_TAGS = new Set(["script", "style"]);

export class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.attrs = {};
    this.dataset = {};
    this.classListSet = new Set();
    this.id = "";
    this.name = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.selected = false;
    this.textContent = "";
    this._innerHTML = "";
    this.style = {};
    // Only meaningful on <select>, but harmless everywhere else -- avoids a
    // real DOM's automatic "currently selected option" computation, which
    // this fake DOM does not attempt to replicate. Tests that need it set it
    // directly.
    this.selectedOptions = [];
  }

  get className() {
    return [...this.classListSet].join(" ");
  }

  set className(value) {
    this.classListSet = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const self = this;
    return {
      add: (c) => self.classListSet.add(c),
      remove: (c) => self.classListSet.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          self.classListSet.has(c) ? self.classListSet.delete(c) : self.classListSet.add(c);
        } else if (force) {
          self.classListSet.add(c);
        } else {
          self.classListSet.delete(c);
        }
      },
      contains: (c) => self.classListSet.has(c),
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === "") {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = [];
    }
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] || []) handler(event);
  }

  setAttribute(name, value) {
    const stringValue = value === undefined ? "" : String(value);
    this.attrs[name] = stringValue;
    if (name === "id") this.id = stringValue;
    if (name === "name") this.name = stringValue;
    if (name === "type") this.type = stringValue;
    if (name === "value") this.value = stringValue;
    if (name === "class") this.className = stringValue;
    // Boolean HTML attributes: their mere presence in the markup (regardless
    // of value, including "") means true -- mirrors a real browser parsing
    // e.g. `<span ... hidden>` or `<button ... disabled>`.
    if (name === "hidden") this.hidden = true;
    if (name === "disabled") this.disabled = true;
    if (name === "checked") this.checked = true;
    if (name === "required") this.required = true;
    if (name === "selected") this.selected = true;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = stringValue;
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  // Supports the selector forms this codebase's controllers actually use:
  // comma-separated lists ("input, select"), one or more bracket clauses
  // optionally prefixed by a tag name (`[data-remove-line]`,
  // `input[name="x"]`, `[name="a"][value="b"]`), a bare class (".line-item"),
  // a bare id ("#foo"), a bare tag name, and the ":checked" pseudo-class.
  matches(selectorList) {
    return String(selectorList)
      .split(",")
      .map((part) => part.trim())
      .some((selector) => this._matchesSingle(selector));
  }

  _matchesSingle(selector) {
    let sel = selector;
    let requireChecked = false;
    if (sel.endsWith(":checked")) {
      requireChecked = true;
      sel = sel.slice(0, -":checked".length);
    }
    if (requireChecked && !this.checked) return false;

    const bracketed = sel.match(/^([a-zA-Z0-9]*)((?:\[[^\]]+\])+)$/);
    if (bracketed) {
      const [, tag, bracketsPart] = bracketed;
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const brackets = bracketsPart.match(/\[[^\]]+\]/g) || [];
      return brackets.every((bracket) => {
        const clause = bracket.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (!clause) return false;
        const [, attr, value] = clause;
        if (attr === "name") return value === undefined ? Boolean(this.name) : this.name === value;
        if (attr === "type") return value === undefined ? Boolean(this.type) : this.type === value;
        if (attr === "value") return value === undefined ? this.value !== "" : this.value === value;
        const actual = this.attrs[attr];
        return value === undefined ? actual !== undefined : actual === value;
      });
    }

    if (sel.startsWith(".")) {
      return String(this.className).split(/\s+/).filter(Boolean).includes(sel.slice(1));
    }
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  appendChild(node) {
    if (node.tagName === "#FRAGMENT") {
      for (const child of node.children) {
        child.parentNode = this;
        this.children.push(child);
      }
      node.children = [];
      return node;
    }
    if (node.parentNode) {
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    }
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  cloneNode(deep) {
    const clone = new FakeNode(this.tagName);
    clone.attrs = { ...this.attrs };
    clone.dataset = { ...this.dataset };
    clone.id = this.id;
    clone.name = this.name;
    clone.type = this.type;
    clone.value = this.value;
    clone.checked = this.checked;
    clone.hidden = this.hidden;
    clone.disabled = this.disabled;
    clone.required = this.required;
    clone.selected = this.selected;
    clone.className = this.className;
    if (deep) {
      clone.children = this.children.map((child) => {
        const childClone = child.cloneNode(true);
        childClone.parentNode = clone;
        return childClone;
      });
    }
    return clone;
  }
}

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(attrString))) {
    const [, rawName, dq, sq, bare] = match;
    const value = dq !== undefined ? dq : sq !== undefined ? sq : bare !== undefined ? bare : "";
    attrs[rawName] = value;
  }
  return attrs;
}

// Parses `html` into a FakeNode tree rooted at a synthetic "#root" node.
// Handles: nested elements, void elements, self-closing tags, comments,
// doctype/other bang declarations, <script>/<style> raw-text bodies, and
// <template> content (kept out of the main tree in `.content`, exactly like
// a real browser keeps template content inert). This is deliberately not a
// full HTML5 parser -- it assumes the well-formed markup this codebase
// actually writes (every non-void tag is explicitly closed).
export function parseHtml(html) {
  const root = new FakeNode("#root");
  const stack = [root];
  const tagOpenRe = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/;
  let i = 0;
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[lt + 1] === "!") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? len : end + 1;
      continue;
    }
    if (html[lt + 1] === "/") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? len : end + 1;
      if (stack.length > 1) stack.pop();
      continue;
    }

    const tagMatch = tagOpenRe.exec(html.slice(lt));
    if (!tagMatch) {
      i = lt + 1;
      continue;
    }
    const [fullMatch, rawTagName, attrString, selfCloseMark] = tagMatch;
    const tagName = rawTagName.toLowerCase();
    const node = new FakeNode(tagName);
    for (const [name, value] of Object.entries(parseAttrs(attrString))) {
      node.setAttribute(name, value);
    }
    stack[stack.length - 1].appendChild(node);
    i = lt + fullMatch.length;

    if (tagName === "template") {
      const closeTag = "</template>";
      const closeIdx = html.indexOf(closeTag, i);
      const innerHtml = closeIdx === -1 ? "" : html.slice(i, closeIdx);
      const contentRoot = parseHtml(innerHtml);
      const fragment = new FakeNode("#fragment");
      fragment.children = contentRoot.children;
      fragment.children.forEach((child) => { child.parentNode = fragment; });
      node.content = fragment;
      i = closeIdx === -1 ? len : closeIdx + closeTag.length;
      continue;
    }

    if (RAW_TEXT_TAGS.has(tagName)) {
      const closeTag = `</${tagName}>`;
      const closeIdx = html.indexOf(closeTag, i);
      i = closeIdx === -1 ? len : closeIdx + closeTag.length;
      continue;
    }

    if (VOID_TAGS.has(tagName) || selfCloseMark) continue;

    stack.push(node);
  }

  return root;
}

// Walks the parsed tree and returns a plain object of every id the HTML
// actually defines. This -- not a hand-typed literal -- is the ground truth
// `document.querySelector("#x")` now checks against.
export function buildElementsById(root) {
  const byId = {};
  const visit = (node) => {
    if (node.id) {
      if (Object.prototype.hasOwnProperty.call(byId, node.id)) {
        throw new Error(`duplicate id "${node.id}" found while parsing HTML for the fake DOM`);
      }
      byId[node.id] = node;
    }
    for (const child of node.children) visit(child);
    if (node.content) visit(node.content);
  };
  visit(root);
  return byId;
}

// Populates `.elements` on every <form> in the tree from its real
// descendant form controls' `name` attributes -- so `form.elements.foo` is
// only ever populated when the HTML genuinely has a `name="foo"` control
// inside that form, instead of a hand-typed `{ foo: { value: "" } }` stub
// that can silently drift from the real markup.
export function attachFormElementsCollections(root) {
  for (const form of root.querySelectorAll("form")) {
    form.elements = {};
    for (const control of form.querySelectorAll("input, select, textarea, button")) {
      if (control.name) form.elements[control.name] = control;
    }
  }
}

// Minimal `document` stand-in backed by the parsed tree. `#id` lookups go
// through `elementsById` directly (so a missing/renamed id reliably returns
// null, matching a real browser); every other selector is a real descendant
// search over the parsed tree.
export function createFakeDocument(root, elementsById) {
  return {
    querySelector(selector) {
      if (selector.startsWith("#")) {
        const id = selector.slice(1);
        return Object.prototype.hasOwnProperty.call(elementsById, id) ? elementsById[id] : null;
      }
      return root.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector.startsWith("#")) {
        const found = this.querySelector(selector);
        return found ? [found] : [];
      }
      return root.querySelectorAll(selector);
    },
    createElement(tag) {
      return new FakeNode(tag);
    },
  };
}

// One-call convenience: parses `html` and returns everything a test's setup
// function needs -- the real tree, the id-derived element map, and a
// document-like object wired to both. Callers still layer their own
// runtime-only scaffolding on top (fetch stubs, `location`, per-test field
// values) -- this only replaces the hand-typed DOM shape.
export function buildFakeDomFromHtml(html) {
  const root = parseHtml(html);
  const elementsById = buildElementsById(root);
  attachFormElementsCollections(root);
  const document = createFakeDocument(root, elementsById);
  return { root, elementsById, document };
}
