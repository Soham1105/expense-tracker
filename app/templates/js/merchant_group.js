(function () {
  /* Defensive: many pages that load merchant_group.js don't ship an
     `escapeHtml` global. Provide a fallback so the IIFE's tag-chip and
     txn-list rendering doesn't ReferenceError. */
  if (typeof window.escapeHtml !== "function") {
    window.escapeHtml = function (value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };
  }

  /* ── Shared cache for tags + category ancestor map ──────────────────────── */
  let _allTags = [];
  let _tagAncestorMap = {};
  let _tagsFetched = false;

  async function _fetchTags() {
    if (_tagsFetched) return;
    try {
      const tagsRes = await fetch("/classification/api/tags");
      const tagsResult = await tagsRes.json();
      _allTags = Array.isArray(tagsResult.data) ? tagsResult.data : [];
      _buildTagAncestorMap(_allTags);
      _tagsFetched = true;
    } catch (_) {
      _allTags = [];
    }
  }

  // Keyed by the collision-aware display token; ancestors are the display tokens
  // of the parent chain (nearest first), walked over the authoritative tag graph.
  function _buildTagAncestorMap(tags) {
    _tagAncestorMap = {};
    const byId = {};
    const displayOf = (t) => String((t && (t.display_name || t.name)) || "").trim();
    tags.forEach((t) => { if (t && t.id != null) byId[t.id] = t; });
    tags.forEach((t) => {
      const ancestors = [];
      let cur = (t && t.parent_id != null) ? byId[t.parent_id] : null;
      let guard = 0;
      while (cur && guard++ < 20) {
        const label = displayOf(cur);
        if (label) ancestors.push(label);
        cur = cur.parent_id != null ? byId[cur.parent_id] : null;
      }
      const key = displayOf(t).toLowerCase();
      if (key) _tagAncestorMap[key] = ancestors;
    });
  }

  function _getTagAncestors(tagName) {
    return _tagAncestorMap[tagName.trim().toLowerCase()] || [];
  }

  /* ── Reusable picker factory ───────────────────────────────────────────────
     Attach to any set of three element IDs (search input, dropdown container,
     selected-chip container). Returns { reset, getSelected, setSelected }.
  */
  window.makeMGTagPicker = function ({ searchId, dropdownId, selectedId, includeAncestors = true } = {}) {
    let selected = [];

    function renderSelected() {
      const el = document.getElementById(selectedId);
      if (!el) return;
      el.innerHTML = selected.map(name => `
        <span class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          ${escapeHtml(name)}
          <button type="button" data-remove-tag="${escapeHtml(name)}" class="ml-0.5 text-primary/70 hover:text-primary leading-none">&times;</button>
        </span>
      `).join("");
      el.querySelectorAll("[data-remove-tag]").forEach(btn => {
        btn.addEventListener("click", () => {
          selected = selected.filter(t => t !== btn.dataset.removeTag);
          renderSelected();
        });
      });
    }

    function renderDropdown(query) {
      const dropdown = document.getElementById(dropdownId);
      if (!dropdown) return;
      const q = (query || "").trim().toLowerCase();
      const filtered = _allTags.filter(t => {
        const label = String(t.display_name || t.name || "").toLowerCase();
        return !q || label.includes(q);
      }).slice(0, 20);

      if (!filtered.length) {
        dropdown.innerHTML = `<p class="px-3 py-2 text-xs text-slate-400">No tags found</p>`;
        return;
      }
      dropdown.innerHTML = filtered.map(t => {
        const label = String(t.display_name || t.name || "");
        return `
        <div class="cursor-pointer px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-primary/10 hover:text-primary" data-tag-name="${escapeHtml(label)}">
          ${escapeHtml(label)}
          ${t.tag_type ? `<span class="ml-1 text-[10px] text-slate-400">${escapeHtml(t.tag_type)}</span>` : ""}
        </div>`;
      }).join("");
      dropdown.querySelectorAll("[data-tag-name]").forEach(el => {
        el.addEventListener("click", () => {
          const name = el.dataset.tagName;
          if (!name) return;
          const ancestors = includeAncestors ? _getTagAncestors(name) : [];
          const toAdd = [name, ...ancestors].filter(a => !selected.includes(a));
          toAdd.forEach(a => selected.push(a));
          renderSelected();
          const input = document.getElementById(searchId);
          if (input) input.value = "";
          dropdown.classList.add("hidden");
        });
      });
    }

    function initSearch() {
      const input = document.getElementById(searchId);
      const dropdown = document.getElementById(dropdownId);
      if (!input || !dropdown) return;
      const fresh = input.cloneNode(true);
      input.parentNode.replaceChild(fresh, input);
      fresh.addEventListener("focus", () => { renderDropdown(fresh.value); dropdown.classList.remove("hidden"); });
      fresh.addEventListener("input", () => renderDropdown(fresh.value));
      document.addEventListener("click", function _oc(e) {
        if (!fresh.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.classList.add("hidden");
          document.removeEventListener("click", _oc);
        }
      });
    }

    return {
      async init() {
        await _fetchTags();
        renderSelected();
        initSearch();
      },
      reset() { selected = []; renderSelected(); },
      getSelected() { return selected.slice(); },
      setSelected(arr) { selected = Array.isArray(arr) ? arr.slice() : []; renderSelected(); },
    };
  };

  /* Expose tag fetcher too, for callers that just need tags without the picker */
  window.MGTags = { fetch: _fetchTags };

  /* ── Floating-bar (transactions page) flow ─────────────────────────────── */
  let _mgPicker = null;
  let _mgKind = "PATTERN";  // default: backwards-compatible bulk-classify behavior
  let _mgEventTotal = 0;    // sum of selected transactions (for the Event split calc)

  function _inr(v) {
    const n = Math.abs(Number(v || 0));
    return (typeof formatINR === "function") ? formatINR(n) : "₹" + n.toFixed(2);
  }

  // Live split calculation for the Bundle-as-Event panel.
  function _recomputeEventSplit() {
    const peopleEl = document.getElementById("mg-event-people");
    const perHeadEl = document.getElementById("mg-event-per-head");
    const owedEl = document.getElementById("mg-event-owed-preview");
    const n = Math.max(parseInt(peopleEl?.value || "1", 10) || 1, 1);
    const perHead = _mgEventTotal / n;
    const othersOwe = _mgEventTotal - perHead;
    if (perHeadEl) perHeadEl.textContent = _inr(perHead);
    if (owedEl) owedEl.textContent = othersOwe > 0 ? `· ${_inr(othersOwe)}` : "";
    return { people: n, perHead, othersOwe };
  }

  const _KIND_STYLE = {
    EVENT:     ["border-violet-400",  "bg-violet-50",  "dark:bg-violet-950/30"],
    PATTERN:   ["border-sky-400",     "bg-sky-50",     "dark:bg-sky-950/30"],
    PORTFOLIO: ["border-emerald-400", "bg-emerald-50", "dark:bg-emerald-950/30"],
  };
  const _ALL_KIND_CLASSES = [
    "border-violet-400","bg-violet-50","dark:bg-violet-950/30",
    "border-sky-400","bg-sky-50","dark:bg-sky-950/30",
    "border-emerald-400","bg-emerald-50","dark:bg-emerald-950/30",
  ];

  function _applyKindUI(kind) {
    _mgKind = kind;

    // Card highlight
    document.querySelectorAll(".mg-kind-card").forEach(card => {
      card.classList.remove(..._ALL_KIND_CLASSES);
      card.classList.add("border-slate-200");
      if (card.dataset.mgKind === kind) {
        card.classList.remove("border-slate-200");
        card.classList.add(...(_KIND_STYLE[kind] || []));
      }
    });

    // Field visibility
    const patternFields   = document.getElementById("mg-pattern-fields");
    const eventFields     = document.getElementById("mg-event-fields");
    const portfolioFields = document.getElementById("mg-portfolio-fields");
    if (patternFields)   patternFields.classList.toggle("hidden", kind !== "PATTERN");
    if (eventFields)     eventFields.classList.toggle("hidden", kind !== "EVENT");
    if (portfolioFields) portfolioFields.classList.toggle("hidden", kind !== "PORTFOLIO");

    // Title + submit label
    const titleEl  = document.getElementById("mg-panel-title");
    const submitEl = document.getElementById("mg-submit-btn");
    if (titleEl) {
      titleEl.textContent =
        kind === "EVENT"     ? "New Event" :
        kind === "PORTFOLIO" ? "Add to Tracking" :
                               "Group & Classify";
    }
    if (submitEl) {
      submitEl.textContent =
        kind === "EVENT"     ? "Create Event" :
        kind === "PORTFOLIO" ? "Create Tracking" :
                               "Apply to All";
    }
  }

  window.selectMGKind = function (kind) {
    if (!_KIND_STYLE[kind]) return;
    _applyKindUI(kind);
  };

  function _getSelectedIds() {
    if (typeof selectedTransactionIds !== "undefined") return selectedTransactionIds; // reports page
    if (typeof selectedTxnIds !== "undefined") return selectedTxnIds;               // transactions page
    return new Set();
  }

  function _getAllRows() {
    if (typeof currentReportTransactions !== "undefined" && currentReportTransactions.length)
      return currentReportTransactions;
    if (typeof dashboardState !== "undefined") return dashboardState.rows || [];
    return [];
  }

  function _getSelectedTransactionRows() {
    const ids = _getSelectedIds();
    const rows = _getAllRows();
    return [...ids].map(id => rows.find(r => String(r.id) === id)).filter(Boolean);
  }

  function _afterSuccess() {
    if (typeof clearBulkSelection === "function") clearBulkSelection();
    else if (typeof clearTxnSelection === "function") clearTxnSelection();
    // Reports page: re-fetch group flags + re-render so a new EVENT collapses immediately.
    if (typeof window.refreshGroupCollapse === "function") window.refreshGroupCollapse();
  }

  window.openMerchantGroupPanel = async function () {
    const panel = document.getElementById("merchant-group-panel");
    if (!panel) return;

    const rows = _getSelectedTransactionRows();
    if (rows.length < 2) {
      if (window.toast) window.toast.warn("Select at least 2 transactions to group");
      else window.toast?.error("Select at least 2 transactions to group");
      return;
    }

    if (!_mgPicker) {
      _mgPicker = window.makeMGTagPicker({
        searchId: "mg-tag-search",
        dropdownId: "mg-tag-dropdown",
        selectedId: "mg-selected-tags",
      });
    }
    await _mgPicker.init();
    _mgPicker.reset();

    const countLabel = document.getElementById("mg-txn-count-label");
    if (countLabel) countLabel.textContent = `${rows.length} transactions selected`;

    const txnList = document.getElementById("mg-txn-list");
    if (txnList) {
      txnList.innerHTML = rows.map(r => {
        const vendor = r.vendor_name || r.counterparty_entity_name || r.counterparty_identifier || r.narration || "Unknown";
        const isDebit = String(r.direction || "").toLowerCase() === "withdrawal";
        const amtCls = isDebit ? "text-red-600" : "text-emerald-600";
        const amt = typeof formatINR === "function" ? formatINR(Math.abs(Number(r.amount || 0))) : "₹" + Math.abs(Number(r.amount || 0));
        return `<div class="flex items-center justify-between text-xs py-0.5">
          <span class="truncate text-slate-700 dark:text-slate-300 max-w-[60%]">${escapeHtml(vendor)}</span>
          <span class="${amtCls} font-semibold ml-2 shrink-0">${amt}</span>
        </div>`;
      }).join("");
    }

    const vendorCounts = {};
    rows.forEach(r => {
      const v = r.vendor_name || r.counterparty_entity_name || "";
      if (v) vendorCounts[v] = (vendorCounts[v] || 0) + 1;
    });
    const topVendor = Object.keys(vendorCounts).sort((a, b) => vendorCounts[b] - vendorCounts[a])[0] || "";
    const groupNameInput = document.getElementById("mg-group-name");
    const vendorNameInput = document.getElementById("mg-vendor-name");
    if (groupNameInput) groupNameInput.value = topVendor;
    if (vendorNameInput) vendorNameInput.value = topVendor;

    const firstRow = rows[0];
    const ruleValueInput = document.getElementById("mg-rule-value");
    if (ruleValueInput) ruleValueInput.value = firstRow?.counterparty_identifier || "";

    ["mg-flow-type", "mg-counterparty-type", "mg-consumption-ownership", "mg-settlement-state"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const ruleCheckbox = document.getElementById("mg-create-rule");
    const ruleDetails = document.getElementById("mg-rule-details");
    if (ruleCheckbox) {
      ruleCheckbox.checked = false;
      ruleCheckbox.onchange = () => { if (ruleDetails) ruleDetails.classList.toggle("hidden", !ruleCheckbox.checked); };
    }
    if (ruleDetails) ruleDetails.classList.add("hidden");

    // Reset EVENT / PORTFOLIO fields
    const sjInput = document.getElementById("mg-event-shared-joy");
    if (sjInput) sjInput.value = "";
    const acSelect = document.getElementById("mg-portfolio-asset-class");
    if (acSelect) acSelect.value = "";

    // Event split: total of selected + default 2-way split
    _mgEventTotal = rows.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const totalEl = document.getElementById("mg-event-total");
    if (totalEl) totalEl.textContent = _inr(_mgEventTotal);
    const peopleEl = document.getElementById("mg-event-people");
    if (peopleEl) { peopleEl.value = 2; peopleEl.oninput = _recomputeEventSplit; }
    const setOwedEl = document.getElementById("mg-event-set-owed");
    if (setOwedEl) setOwedEl.checked = false;
    _recomputeEventSplit();

    // Default kind = PATTERN (preserves original single-click behavior)
    _applyKindUI("PATTERN");

    panel.classList.remove("hidden");
    panel.classList.add("flex", "flex-col");
  };

  window.closeMerchantGroupPanel = function () {
    const panel = document.getElementById("merchant-group-panel");
    if (panel) { panel.classList.add("hidden"); panel.classList.remove("flex", "flex-col"); }
  };

  async function _submitPattern(rows, groupName, btn) {
    const vendorName = (document.getElementById("mg-vendor-name")?.value || "").trim() || null;
    const flowType = document.getElementById("mg-flow-type")?.value || null;
    const counterpartyType = document.getElementById("mg-counterparty-type")?.value || null;
    const consumptionOwnership = document.getElementById("mg-consumption-ownership")?.value || null;
    const settlementState = document.getElementById("mg-settlement-state")?.value || null;
    const createRule = document.getElementById("mg-create-rule")?.checked || false;
    const ruleField = document.getElementById("mg-rule-field")?.value || "counterparty_identifier";
    const ruleValue = (document.getElementById("mg-rule-value")?.value || "").trim() || null;
    const transactionIds = rows.map(r => String(r.id));

    const groupRes = await fetch("/groups/merchant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupName, transaction_ids: transactionIds }),
    });
    const groupResult = await groupRes.json();
    if (!groupResult.success) throw new Error(groupResult.message || "Failed to create group");

    const groupId = groupResult.data.group_id;
    const tagNames = _mgPicker ? _mgPicker.getSelected() : [];
    const propRes = await fetch(`/groups/${groupId}/propagate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor_name: vendorName,
        tag_names: tagNames,
        primary_flow_type: flowType,
        counterparty_type: counterpartyType,
        consumption_ownership: consumptionOwnership,
        settlement_state: settlementState,
        no_tag_required: false,
        create_tag_rule: createRule,
        tag_rule_match_field: createRule ? ruleField : null,
        tag_rule_match_value: createRule ? ruleValue : null,
      }),
    });
    const propResult = await propRes.json();
    if (!propResult.success) throw new Error(propResult.message || "Failed to propagate classification");

    return { count: propResult.data.updated_count, label: "Applied to" };
  }

  async function _createGenericGroup(groupName, groupType) {
    const res = await fetch("/groups/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupName, group_type: groupType, notes: null }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.message || "Failed to create group");
    return result.data.id;
  }

  async function _linkTransactions(groupId, rows, roleFor) {
    for (const row of rows) {
      const role = typeof roleFor === "function" ? roleFor(row) : roleFor;
      await fetch(`/groups/${groupId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: String(row.id),
          role,
          attributed_amount: null,
          notes: null,
        }),
      });
    }
  }

  async function _submitEvent(rows, groupName) {
    const sjRaw = document.getElementById("mg-event-shared-joy")?.value || "";
    const sharedJoy = sjRaw === "" ? null : parseFloat(sjRaw);
    const { people, perHead, othersOwe } = _recomputeEventSplit();
    const setOwed = !!document.getElementById("mg-event-set-owed")?.checked;

    const groupId = await _createGenericGroup(groupName, "EVENT");
    await _linkTransactions(groupId, rows, "EXPENSE");

    // Persist shared joy + the split (so the group panel shows the same calc).
    const metaPatch = {};
    if (people > 1) {
      metaPatch.split = {
        people,
        per_head: Number(perHead.toFixed(2)),
        my_share: Number(perHead.toFixed(2)),
        others_owe: Number(othersOwe.toFixed(2)),
        set_owed: setOwed,
      };
    }
    if (sharedJoy !== null && !Number.isNaN(sharedJoy)) {
      await fetch(`/groups/${groupId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared_joy_amount: sharedJoy, meta_patch: metaPatch }),
      });
    } else if (Object.keys(metaPatch).length) {
      await fetch(`/groups/${groupId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta_patch: metaPatch }),
      });
    }
    return { count: rows.length, label: "Bundled" };
  }

  async function _submitPortfolio(rows, groupName) {
    const assetClass = document.getElementById("mg-portfolio-asset-class")?.value || null;

    const groupId = await _createGenericGroup(groupName, "PORTFOLIO");
    await _linkTransactions(groupId, rows, row => {
      const dir = String(row.direction || "").toLowerCase();
      return (dir === "deposit" || dir === "credit" || dir === "inbound") ? "PAYOUT_IN" : "CONTRIBUTION_OUT";
    });

    if (assetClass) {
      await fetch(`/groups/${groupId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta_patch: { asset_class: assetClass } }),
      });
    }
    return { count: rows.length, label: "Added to tracking:" };
  }

  window.submitMerchantGroup = async function () {
    const btn = document.getElementById("mg-submit-btn");
    const rows = _getSelectedTransactionRows();
    if (rows.length < 2) { return; }

    const groupName = (document.getElementById("mg-group-name")?.value || "").trim()
      || (_mgKind === "EVENT" ? "Event" : _mgKind === "PORTFOLIO" ? "Tracking" : "Merchant Group");

    if (btn) { btn.disabled = true; btn.textContent = "Working…"; }

    try {
      let result;
      if      (_mgKind === "EVENT")     result = await _submitEvent(rows, groupName);
      else if (_mgKind === "PORTFOLIO") result = await _submitPortfolio(rows, groupName);
      else                              result = await _submitPattern(rows, groupName, btn);

      if (window.toast) window.toast.success(`${result.label} ${result.count} transactions`);
      window.closeMerchantGroupPanel();
      _afterSuccess();
    } catch (err) {
      if (window.toast) window.toast.error(err.message || "Something went wrong");
      else window.toast?.error(err.message || "Something went wrong");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent =
          _mgKind === "EVENT"     ? "Create Event" :
          _mgKind === "PORTFOLIO" ? "Create Tracking" :
                                    "Apply to All";
      }
    }
  };
})();

