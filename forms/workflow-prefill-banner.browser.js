// Shared cross-document prefill banner (Item 4 followup).
//
// Before this module existed, the banner's fetch/render/apply/badge logic
// was implemented three near-verbatim times: forms/workflow-document.logic.
// browser.js, forms/substitute-receipt.logic.browser.js, and an inline
// <script> in forms/expense-request.html. A real bug on this branch (prefill
// folding in an empty group, blanking a field the user had already typed,
// and rendering the literal string "นำมาจาก undefined") had to be found and
// fixed in all three places. This module is the one place that logic lives
// now.
//
// Classic script, like forms/workflow-return-link.browser.js: no `require`,
// no ESM `import`, attaches to `window`. Must load after
// forms/workflow-prefill.logic.js's <script> tag (window.WorkflowPrefillLogic
// is only read at click time, so load order between the two doesn't matter
// beyond both loading before the page controller) and before any page
// controller that calls WorkflowPrefillBanner.create(...) — see the <script>
// ordering in forms/workflow-document.html, forms/substitute-receipt.html,
// and forms/expense-request.html.
//
// What stays here (identical across all three pages):
//   - exactly three tickable groups: payee / purpose / lines
//   - an unticked group's fields are left completely untouched
//   - an empty/absent group is never applied (folding it in used to blank a
//     field the user had already typed)
//   - a field only gets its "prefilled from <doc>" badge when there is a
//     real source document number; otherwise the badge stays hidden
//     (previously this rendered the literal, non-Thai "นำมาจาก undefined")
//   - `parties`, when the target document kind has any parties fields at
//     all, always rides along regardless of which of the three groups were
//     ticked (see applyWorkflowPrefillGroups in workflow-prefill.logic.js)
//   - a page with no transactionNo/workflowStepId in its query string never
//     fetches and never shows the banner
//
// What stays per-page (passed in as `options`, not hardcoded here) because
// it genuinely differs per document kind:
//   - which patch field names belong to the payee/purpose/parties groups for
//     that kind (e.g. substitute_receipt's payee group is
//     payeeName+payeeTaxId; the generic workflow-document shell's is just
//     payeeName; expense_request's is paymentTargetName+paymentBankName+
//     paymentAccountNo)
//   - the patch key that carries the lines array (`lines` for most kinds,
//     `expenseLines` for expense_request) and how to rebuild the line rows
//     from it, since each page's line-item markup/fields differ
//   - what to run after a patch is applied (each page's own updatePreview)
(function () {
  const PREFILL_GROUP_LABELS = {
    payee: "ผู้รับเงิน/คู่ค้า",
    purpose: "วัตถุประสงค์",
    lines: "รายการ",
  };

  async function fetchWorkflowPrefill(transactionNo, documentKind, stepId) {
    if (!transactionNo || !stepId) return null;
    try {
      const response = await fetch(`/api/workflow-transactions/${encodeURIComponent(transactionNo)}/prefill?documentKind=${encodeURIComponent(documentKind)}&stepId=${encodeURIComponent(stepId)}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function create(options) {
    const {
      documentKind,
      transactionNo,
      workflowStepId,
      form,
      fields = {},
      linesPatchKey = "lines",
      applyLines = () => {},
      onApplied = () => {},
      banner = document.querySelector("#workflowPrefillBanner"),
      groupsContainer = document.querySelector("#workflowPrefillGroups"),
      applyButton = document.querySelector("#workflowPrefillApply"),
      dismissButton = document.querySelector("#workflowPrefillDismiss"),
    } = options;

    let prefill = null;

    // Without a real source document number there is nothing honest to show
    // -- rendering the badge anyway used to print the literal string
    // "นำมาจาก undefined" (a non-Thai token in a Thai-only UI) whenever a
    // field got patched from a group whose `sources` entry was never set.
    // Hide the badge instead of guessing.
    function markFieldPrefilled(fieldName, sourceDocumentNo) {
      const badge = form.querySelector(`[data-badge-for="${fieldName}"]`);
      if (!badge) return;
      if (!sourceDocumentNo) {
        badge.hidden = true;
        return;
      }
      badge.hidden = false;
      badge.textContent = `นำมาจาก ${sourceDocumentNo}`;
    }

    function renderPrefillBanner(nextPrefill) {
      if (!nextPrefill || !Array.isArray(nextPrefill.availableGroups) || nextPrefill.availableGroups.length === 0) return;
      groupsContainer.replaceChildren(
        ...nextPrefill.availableGroups.map((group) => {
          const wrapper = document.createElement("label");
          wrapper.className = "prefill-group";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.value = group;
          checkbox.checked = true;
          const sourceDocumentNo = nextPrefill.sources?.[group];
          const labelText = document.createElement("span");
          labelText.textContent = sourceDocumentNo
            ? `${PREFILL_GROUP_LABELS[group] || group} (จาก ${sourceDocumentNo})`
            : (PREFILL_GROUP_LABELS[group] || group);
          wrapper.append(checkbox, labelText);
          return wrapper;
        }),
      );
      banner.hidden = false;
    }

    function applyScalarFields(groupName, patch) {
      for (const fieldName of fields[groupName] || []) {
        if (patch[fieldName] === undefined) continue;
        const element = form.elements[fieldName];
        if (!element) continue;
        element.value = patch[fieldName];
        markFieldPrefilled(fieldName, prefill?.sources?.[groupName]);
      }
    }

    function applyPrefillPatch(patch = {}, groups = []) {
      const selectedGroups = new Set(groups);
      if (selectedGroups.has("payee")) applyScalarFields("payee", patch);
      if (selectedGroups.has("purpose")) applyScalarFields("purpose", patch);
      if (selectedGroups.has("lines")) {
        const lines = patch[linesPatchKey];
        if (Array.isArray(lines) && lines.length) {
          applyLines(lines);
          markFieldPrefilled("lines", prefill?.sources?.lines);
        }
      }
      // `parties` always rides along regardless of which of the three
      // tickable groups were requested -- see applyWorkflowPrefillGroups in
      // workflow-prefill.logic.js, which folds context.parties into every
      // adapter call unconditionally (when the source document actually
      // supplied one).
      applyScalarFields("parties", patch);
      onApplied();
    }

    async function load() {
      if (!transactionNo || !workflowStepId) return;
      const nextPrefill = await fetchWorkflowPrefill(transactionNo, documentKind, workflowStepId);
      if (!nextPrefill) return;
      prefill = nextPrefill;
      renderPrefillBanner(nextPrefill);
    }

    applyButton?.addEventListener("click", () => {
      if (!prefill) return;
      const checkedGroups = [...groupsContainer.querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value);
      const patch = window.WorkflowPrefillLogic?.applyWorkflowPrefillGroups?.(prefill.context, documentKind, checkedGroups) || {};
      applyPrefillPatch(patch, checkedGroups);
      banner.hidden = true;
    });

    dismissButton?.addEventListener("click", () => {
      banner.hidden = true;
    });

    return { load };
  }

  window.WorkflowPrefillBanner = { create };
}());
