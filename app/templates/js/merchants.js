/* merchants.js v3 — Merchant cleanup + UPI merge + UX polish */

let allMerchants    = [];
let _selectedUpiIds = new Set();
let _visibleItems   = []; // items currently rendered (after filter/sort)
let _expandedIdx    = null; // index of currently expanded row

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(v) {
  return "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function escH(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

/* Normalise: trim + title-case for uniformity ("SWIGGY FOOD" → "Swiggy Food") */
function normaliseName(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadMerchants() {
  document.getElementById("merchant-list").innerHTML =
    '<div class="px-5 py-12 text-center text-sm text-slate-400 flex flex-col items-center gap-2"><span class="material-symbols-outlined text-3xl text-slate-200 animate-pulse">storefront</span>Loading…</div>';
  _selectedUpiIds.clear();
  updateSelectionBar();
  try {
    const res  = await fetch("/reports/merchants");
    const data = (await res.json()).data || [];
    allMerchants = data;
    renderMerchants();
  } catch {
    document.getElementById("merchant-list").innerHTML =
      '<div class="px-5 py-8 text-center text-sm text-rose-500">Failed to load merchants.</div>';
  }
}

// ── Sort + filter + render ────────────────────────────────────────────────────
function renderMerchants() {
  const query = (document.getElementById("merchant-search")?.value || "").toLowerCase().trim();
  const sort  = document.getElementById("merchant-sort")?.value || "spend";

  let items = allMerchants;
  if (query) {
    items = items.filter(m =>
      (m.merchant                 || "").toLowerCase().includes(query) ||
      (m.vendor_name              || "").toLowerCase().includes(query) ||
      (m.counterparty_identifier  || "").toLowerCase().includes(query) ||
      (m.counterparty_entity_name || "").toLowerCase().includes(query)
    );
  }

  items = [...items].sort((a, b) => {
    if (sort === "count")   return b.transaction_count - a.transaction_count;
    if (sort === "recent")  return (b.last_transaction_date || "").localeCompare(a.last_transaction_date || "");
    if (sort === "unnamed") {
      const aU = a.vendor_name ? 1 : 0;
      const bU = b.vendor_name ? 1 : 0;
      if (aU !== bU) return aU - bU;
    }
    return b.total_spend - a.total_spend;
  });

  _visibleItems = items;

  // Header counts
  const unnamed  = allMerchants.filter(m => !m.vendor_name).length;
  const countEl  = document.getElementById("merchant-count");
  const unnamedEl = document.getElementById("unnamed-count");
  if (countEl) countEl.textContent = `${allMerchants.length} merchants`;
  if (unnamedEl) {
    if (unnamed > 0) {
      unnamedEl.textContent = `${unnamed} unnamed`;
      unnamedEl.classList.remove("hidden");
    } else {
      unnamedEl.classList.add("hidden");
    }
  }

  _expandedIdx = null; // collapse any open expand panel on re-render
  const container = document.getElementById("merchant-list");

  // Update result count + clear button visibility (reuse already-declared query and countEl)
  if (countEl) countEl.textContent = query
    ? `${items.length} of ${allMerchants.length} merchants`
    : `${allMerchants.length} merchants`;
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) clearBtn.style.display = query ? "flex" : "none";

  if (!items.length) {
    container.innerHTML = `
      <div class="px-5 py-14 text-center flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-4xl text-slate-200">search_off</span>
        <p class="text-sm font-semibold text-slate-500">No matches for "${escH(query)}"</p>
        <p class="text-xs text-slate-400">Try searching by vendor name, UPI ID (e.g. swiggy@icici), or bank name</p>
        <button onclick="document.getElementById('merchant-search').value='';renderMerchants()"
          class="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Clear search
        </button>
      </div>`;
    return;
  }

  container.innerHTML = items.map((m, idx) => {
    const hasName    = Boolean(m.vendor_name);
    const rawId      = m.counterparty_identifier || m.merchant;
    const upiId      = m.counterparty_identifier || "";
    const isSelected = _selectedUpiIds.has(upiId);

    const tagBadges = (m.top_tags || (m.top_tag ? [m.top_tag] : []))
      .slice(0, 2)
      .map(t => `<span class="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 ring-1 ring-sky-100">${escH(t)}</span>`)
      .join("");

    // Primary = best human-readable name; secondary = raw UPI ID
    const displayName = m.vendor_name || m.merchant || m.counterparty_identifier || "Unknown";
    const subLine     = (m.counterparty_identifier && m.counterparty_identifier !== displayName)
      ? m.counterparty_identifier : null;

    // Identity column: always show UPI ID as primary, entity name as secondary
    const primaryId   = upiId || m.counterparty_entity_name || m.merchant || "Unknown";
    const entityLabel = (m.counterparty_entity_name && m.counterparty_entity_name !== primaryId)
      ? m.counterparty_entity_name : null;
    const namedBadge = hasName
      ? `<span class="rounded-full bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600">✓ named</span>`
      : `<span class="rounded-full bg-amber-50 border border-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">no name</span>`;

    return `
      <div class="grid grid-cols-[28px_minmax(0,2fr)_80px_100px_90px_minmax(0,1.5fr)] items-center gap-4 px-5 py-3
        hover:bg-primary/5 transition-colors duration-150
        ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}"
        data-idx="${idx}" data-upi-id="${escH(upiId)}">

        <!-- Checkbox -->
        <label class="flex items-center justify-center cursor-pointer" title="${upiId ? "Select to merge" : "No UPI ID — cannot merge"}">
          <input type="checkbox" class="merchant-select-cb h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary focus:ring-offset-0 transition"
            data-upi-id="${escH(upiId)}" ${isSelected ? "checked" : ""} ${!upiId ? "disabled opacity-30" : ""}/>
        </label>

        <!-- Identity column: raw UPI/bank ID is always the primary identifier -->
        <div class="min-w-0 cursor-pointer select-none group/id" onclick="toggleMerchantExpand(${idx})" title="Click to view transactions">
          <div class="flex items-center gap-1.5">
            <p class="truncate text-sm font-mono font-medium text-slate-700" title="${escH(primaryId)}">${escH(primaryId)}</p>
            ${namedBadge}
            <span class="material-symbols-outlined text-[13px] text-slate-300 group-hover/id:text-primary transition-colors flex-shrink-0 ml-auto">
              ${_expandedIdx === idx ? "expand_less" : "expand_more"}
            </span>
          </div>
          ${entityLabel ? `<p class="mt-0.5 text-[10px] text-slate-500 truncate" title="${escH(entityLabel)}">${escH(entityLabel)}</p>` : ""}
          ${hasName ? `<p class="mt-0.5 text-[10px] text-emerald-600 font-semibold truncate" title="${escH(m.vendor_name)}">→ ${escH(m.vendor_name)}</p>` : ""}
          ${tagBadges ? `<div class="mt-0.5 flex gap-0.5">${tagBadges}</div>` : ""}
        </div>

        <!-- Count -->
        <div class="text-center">
          <span class="text-sm font-bold text-slate-700">${m.transaction_count}</span>
          <span class="block text-[9px] text-slate-400">txns</span>
        </div>

        <!-- Spend -->
        <span class="text-sm font-bold text-slate-900">${fmt(m.total_spend)}</span>

        <!-- Last seen -->
        <span class="text-[11px] text-slate-400">${fmtDate(m.last_transaction_date)}</span>

        <!-- Name input -->
        <div class="relative flex items-center gap-1.5">
          <div class="relative min-w-0 flex-1">
            <input
              type="text"
              placeholder="${escH(!hasName && m.merchant && m.merchant !== m.counterparty_identifier ? `Use "${m.merchant}"?` : hasName ? "Edit name…" : "Type clean name…")}"
              value="${escH(m.vendor_name || "")}"
              data-merchant-idx="${idx}"
              data-original="${escH(m.vendor_name || "")}"
              data-suggested="${escH(!hasName && m.merchant && m.merchant !== m.counterparty_identifier ? m.merchant : "")}"
              class="merchant-name-input w-full rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-all duration-150
                ${hasName
                  ? "border-primary/30 bg-primary/5 text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 placeholder:text-slate-400"}"
            />
            <span class="norm-preview" data-preview-idx="${idx}"></span>
          </div>
          <button
            data-merchant-idx="${idx}"
            class="save-merchant-btn flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-all duration-150
              ${hasName
                ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-white hover:border-primary hover:shadow-sm"
                : "border-slate-200 bg-white text-slate-300 hover:border-primary/40 hover:text-primary"}"
            title="Save name (Enter)">
            <span class="material-symbols-outlined text-[15px]">${hasName ? "check" : "add"}</span>
          </button>
        </div>
      </div>`;
  }).join("");
}

// ── Expand: inline transaction preview ───────────────────────────────────────
function toggleMerchantExpand(idx) {
  if (_expandedIdx === idx) {
    // collapse
    document.getElementById(`merchant-txns-${idx}`)?.remove();
    _expandedIdx = null;
    // re-render just the chevron icon direction
    const chevron = document.querySelector(`[data-idx="${idx}"] .group\\/id .material-symbols-outlined`);
    if (chevron) chevron.textContent = "expand_more";
    return;
  }
  // collapse any currently open one
  if (_expandedIdx !== null) {
    document.getElementById(`merchant-txns-${_expandedIdx}`)?.remove();
    const prevChevron = document.querySelector(`[data-idx="${_expandedIdx}"] .group\\/id .material-symbols-outlined`);
    if (prevChevron) prevChevron.textContent = "expand_more";
  }
  _expandedIdx = idx;
  const chevron = document.querySelector(`[data-idx="${idx}"] .group\\/id .material-symbols-outlined`);
  if (chevron) chevron.textContent = "expand_less";

  const m   = _visibleItems[idx];
  const row = document.querySelector(`[data-idx="${idx}"]`);
  if (!row || !m) return;

  const el = document.createElement("div");
  el.id = `merchant-txns-${idx}`;
  el.className = "border-t border-slate-100 bg-slate-50/70 px-5 py-3";
  el.innerHTML = `<div class="flex items-center gap-1.5 text-[11px] text-slate-400"><span class="material-symbols-outlined text-[13px]" style="animation:spin 0.8s linear infinite">autorenew</span>Loading transactions…</div>`;
  row.insertAdjacentElement("afterend", el);
  loadMerchantTransactions(m, idx, el);
}

async function loadMerchantTransactions(m, idx, el) {
  const searchTerm = m.counterparty_identifier || m.vendor_name || m.merchant;
  if (!searchTerm) {
    el.innerHTML = `<p class="text-[11px] text-slate-400">No identifier to search by.</p>`;
    return;
  }

  try {
    const params = new URLSearchParams({ search: searchTerm, page_size: 10, direction: "withdrawal" });
    const res  = await fetch(`/transactions?${params}`);
    const data = await res.json();
    const txns = data.transactions || [];

    if (!txns.length) {
      el.innerHTML = `<p class="text-[11px] text-slate-400 italic">No transactions found for "${escH(searchTerm)}".</p>`;
      return;
    }

    el.innerHTML = `
      <p class="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
        Recent transactions · ${escH(searchTerm)}
      </p>
      <div class="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white overflow-hidden">
        ${txns.map(t => `
          <div class="grid grid-cols-[90px_1fr_80px] items-center gap-3 px-3 py-1.5 hover:bg-primary/5">
            <span class="text-[10px] text-slate-400 flex-shrink-0">${fmtDate(t.transaction_date)}</span>
            <span class="text-[11px] text-slate-700 truncate" title="${escH(t.narration || "")}">${escH(t.narration || t.counterparty_identifier || "—")}</span>
            <span class="text-[11px] font-bold text-rose-600 text-right flex-shrink-0">−${fmt(t.amount)}</span>
          </div>`).join("")}
      </div>
      ${data.total > 10 ? `<p class="mt-1.5 text-[10px] text-slate-400">${data.total} total transactions — showing first 10</p>` : ""}`;
  } catch {
    el.innerHTML = `<p class="text-[11px] text-rose-400">Failed to load transactions.</p>`;
  }
}

// ── Save a merchant name ──────────────────────────────────────────────────────
async function saveMerchantName(idx, rawName) {
  const m = _visibleItems[idx];
  const realIdx = allMerchants.indexOf(m);
  if (!m || realIdx === -1) return;

  const newName = normaliseName(rawName);
  if (!newName) return;
  if (!m.sample_transaction_id) {
    showRowFeedback(idx, "error"); return;
  }

  // Update input immediately to normalized form
  const inputEl = document.querySelector(`input.merchant-name-input[data-merchant-idx="${idx}"]`);
  if (inputEl) { inputEl.value = newName; hideNormPreview(idx); }

  showRowFeedback(idx, "saving");

  try {
    const res = await fetch("/reports/transaction_update", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        id:                            m.sample_transaction_id,
        transaction_id:                m.sample_transaction_id,
        vendor_name:                   newName,
        counterparty_identifier:       m.counterparty_identifier || "",
        apply_to_similar_transactions: true,
        tags:                          [],
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Failed");

    allMerchants[realIdx] = { ...m, vendor_name: newName };
    window.toast?.success(`Saved "${newName}"`);
    showRowFeedback(idx, "success");

    // Flash the whole row
    const row = document.querySelector(`[data-idx="${idx}"]`);
    if (row) { row.classList.add("row-saved"); setTimeout(() => row.classList.remove("row-saved"), 1300); }

    setTimeout(() => renderMerchants(), 1200);
  } catch (err) {
    showRowFeedback(idx, "error");
  }
}

function showRowFeedback(idx, type) {
  const btn = document.querySelector(`button.save-merchant-btn[data-merchant-idx="${idx}"]`);
  if (!btn) return;
  const iconEl = btn.querySelector("span");
  const icons   = { saving:"hourglass_empty", success:"check_circle", error:"error" };
  const classes = {
    saving:  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400 transition-all duration-150",
    success: "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 transition-all duration-150",
    error:   "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-500 transition-all duration-150",
  };
  btn.className = `save-merchant-btn ${classes[type] || ""}`;
  if (iconEl) iconEl.textContent = icons[type] || "check";
}

// ── Normalize preview ─────────────────────────────────────────────────────────
function showNormPreview(idx, raw) {
  const preview = document.querySelector(`.norm-preview[data-preview-idx="${idx}"]`);
  if (!preview) return;
  const normalised = normaliseName(raw);
  if (normalised && normalised !== raw.trim() && raw.trim().length > 0) {
    preview.textContent = `→ ${normalised}`;
    preview.classList.add("visible");
  } else {
    hideNormPreview(idx);
  }
}

function hideNormPreview(idx) {
  const preview = document.querySelector(`.norm-preview[data-preview-idx="${idx}"]`);
  if (preview) preview.classList.remove("visible");
}

// ── Selection bar ─────────────────────────────────────────────────────────────
function updateSelectionBar() {
  const bar       = document.getElementById("selection-bar");
  const label     = document.getElementById("selection-label");
  const spendEl   = document.getElementById("selection-spend");
  const mergeCount = document.getElementById("merge-count");

  const n = _selectedUpiIds.size;
  if (!bar) return;

  if (n === 0) {
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  if (label) label.textContent = `${n} merchant${n === 1 ? "" : "s"} selected`;

  // Calculate combined spend for selected
  const totalSpend = allMerchants
    .filter(m => _selectedUpiIds.has(m.counterparty_identifier || ""))
    .reduce((s, m) => s + (m.total_spend || 0), 0);
  if (spendEl) spendEl.textContent = `Combined: ${fmt(totalSpend)}`;
  if (mergeCount) mergeCount.textContent = n >= 2 ? `(${n})` : "";

  // Update select-all checkbox state
  const selectAllCb = document.getElementById("select-all-cb");
  if (selectAllCb) {
    const visibleUpiIds = _visibleItems.map(m => m.counterparty_identifier || "").filter(Boolean);
    const allChecked = visibleUpiIds.length > 0 && visibleUpiIds.every(id => _selectedUpiIds.has(id));
    const someChecked = visibleUpiIds.some(id => _selectedUpiIds.has(id));
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = someChecked && !allChecked;
  }
}

// ── Merge flow ────────────────────────────────────────────────────────────────
function openMergeModal() {
  const modal   = document.getElementById("merge-modal");
  const countEl = document.getElementById("merge-modal-count");
  const list    = document.getElementById("merge-upi-list");

  if (countEl) countEl.textContent = `${_selectedUpiIds.size} UPI IDs`;

  // Populate the UPI list
  if (list) {
    const selected = allMerchants.filter(m => _selectedUpiIds.has(m.counterparty_identifier || ""));
    list.innerHTML = selected.map(m => `
      <div class="flex items-center justify-between py-0.5 px-1 rounded hover:bg-slate-100 group">
        <span class="text-[11px] font-mono text-slate-600 truncate">${escH(m.counterparty_identifier || "")}</span>
        ${m.vendor_name ? `<span class="text-[10px] text-slate-400 ml-2 flex-shrink-0">${escH(m.vendor_name)}</span>` : ""}
      </div>`).join("");
  }

  // Pre-fill name if all selected have the same vendor_name
  const names = [...new Set(allMerchants
    .filter(m => _selectedUpiIds.has(m.counterparty_identifier || "") && m.vendor_name)
    .map(m => normaliseName(m.vendor_name)))];
  const nameInput = document.getElementById("merge-canonical-name");
  if (nameInput) {
    nameInput.value = names.length === 1 ? names[0] : "";
    updateMergePreview();
  }

  if (modal) { modal.classList.remove("hidden"); modal.classList.add("flex"); }
  setTimeout(() => nameInput?.focus(), 50);
}

function closeMergeModal() {
  const modal = document.getElementById("merge-modal");
  if (modal) { modal.classList.add("hidden"); modal.classList.remove("flex"); }
  document.getElementById("merge-canonical-name").value = "";
  document.getElementById("merge-name-preview")?.classList.add("hidden");
}

function updateMergePreview() {
  const raw      = document.getElementById("merge-canonical-name")?.value || "";
  const preview  = document.getElementById("merge-name-preview");
  const previewT = document.getElementById("merge-name-preview-text");
  const normalised = normaliseName(raw);
  if (normalised && normalised !== raw.trim() && raw.trim().length > 0) {
    if (previewT) previewT.textContent = normalised;
    preview?.classList.remove("hidden");
  } else {
    preview?.classList.add("hidden");
  }
}

async function execMerge() {
  const canonical = normaliseName(document.getElementById("merge-canonical-name")?.value || "");
  if (!canonical) {
    document.getElementById("merge-canonical-name")?.focus();
    document.getElementById("merge-canonical-name")?.classList.add("border-rose-400");
    setTimeout(() => document.getElementById("merge-canonical-name")?.classList.remove("border-rose-400"), 1500);
    return;
  }
  const ids = [..._selectedUpiIds];
  const confirmBtn = document.getElementById("merge-confirm");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Merging…"; }

  try {
    const res = await fetch("/reports/merge-merchant", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ canonical_name: canonical, counterparty_identifiers: ids }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || result.message || "Failed");

    const savedName = result.data.canonical_name || canonical;
    ids.forEach(upiId => {
      const m = allMerchants.find(x => x.counterparty_identifier === upiId);
      if (m) m.vendor_name = savedName;
    });
    window.toast?.success(`Merged ${ids.length} IDs as "${result.data.canonical_name || canonical}"`);
    _selectedUpiIds.clear();
    updateSelectionBar();
    closeMergeModal();
    renderMerchants();
  } catch (err) {
    window.toast?.error("Merge failed: " + err.message);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Merge & Save"; }
  }
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.addEventListener("click", function (e) {
  // Save merchant name
  const saveBtn = e.target.closest(".save-merchant-btn");
  if (saveBtn) {
    const idx   = Number(saveBtn.dataset.merchantIdx);
    const input = document.querySelector(`input.merchant-name-input[data-merchant-idx="${idx}"]`);
    if (input) saveMerchantName(idx, input.value);
    return;
  }

  // Merge button (in selection bar)
  if (e.target.closest("#merge-btn")) { openMergeModal(); return; }

  // Deselect all
  if (e.target.closest("#deselect-btn")) {
    _selectedUpiIds.clear();
    updateSelectionBar();
    renderMerchants();
    return;
  }

  // Select all unnamed
  if (e.target.closest("#select-unnamed-btn")) {
    allMerchants.filter(m => !m.vendor_name && m.counterparty_identifier)
      .forEach(m => _selectedUpiIds.add(m.counterparty_identifier));
    updateSelectionBar();
    renderMerchants();
    return;
  }

  // Cancel merge modal
  if (e.target.closest("#merge-cancel") || (e.target === document.getElementById("merge-modal"))) {
    closeMergeModal(); return;
  }

  // Confirm merge
  if (e.target.closest("#merge-confirm")) { execMerge(); return; }
});

// Select-all checkbox in header
document.addEventListener("change", function (e) {
  // Row checkboxes
  const cb = e.target.closest(".merchant-select-cb");
  if (cb) {
    const upiId = cb.dataset.upiId;
    if (!upiId) return;
    if (cb.checked) _selectedUpiIds.add(upiId);
    else _selectedUpiIds.delete(upiId);
    updateSelectionBar();
    const row = cb.closest("[data-idx]");
    if (row) {
      row.classList.toggle("bg-primary/5", cb.checked);
      row.classList.toggle("border-l-primary", cb.checked);
      row.classList.toggle("border-l-transparent", !cb.checked);
    }
    return;
  }

  // Select-all header checkbox
  if (e.target.id === "select-all-cb") {
    const visibleUpiIds = _visibleItems.map(m => m.counterparty_identifier || "").filter(Boolean);
    if (e.target.checked) visibleUpiIds.forEach(id => _selectedUpiIds.add(id));
    else visibleUpiIds.forEach(id => _selectedUpiIds.delete(id));
    updateSelectionBar();
    renderMerchants();
    return;
  }
});

// Live normalize preview + blur auto-normalize
document.addEventListener("input", function (e) {
  // Merge modal name preview
  if (e.target.id === "merge-canonical-name") { updateMergePreview(); return; }

  // Merchant name inputs — live normalize preview
  const input = e.target.closest(".merchant-name-input");
  if (!input) return;
  showNormPreview(Number(input.dataset.merchantIdx), input.value);
});

document.addEventListener("blur", function (e) {
  const input = e.target.closest(".merchant-name-input");
  if (!input) return;
  const idx  = Number(input.dataset.merchantIdx);
  const norm = normaliseName(input.value);
  if (norm && norm !== input.value.trim()) {
    input.value = norm;
  }
  hideNormPreview(idx);
}, true);

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { closeMergeModal(); return; }

  if (e.key === "Enter") {
    const input = e.target.closest(".merchant-name-input");
    if (input) { saveMerchantName(Number(input.dataset.merchantIdx), input.value); return; }
    if (e.target.id === "merge-canonical-name") { execMerge(); return; }
  }

  // Tab on empty input with suggestion → auto-fill the suggestion
  if (e.key === "Tab") {
    const input = e.target.closest(".merchant-name-input");
    if (input && !input.value.trim() && input.dataset.suggested) {
      e.preventDefault();
      input.value = input.dataset.suggested;
      showNormPreview(Number(input.dataset.merchantIdx), input.value);
    }
  }
});

// Click into empty input with a suggested name → auto-fill
document.addEventListener("focus", function (e) {
  const input = e.target.closest(".merchant-name-input");
  if (input && !input.value.trim() && input.dataset.suggested) {
    input.value = input.dataset.suggested;
    input.select();
    showNormPreview(Number(input.dataset.merchantIdx), input.value);
  }
}, true);

// ── Filter + sort live ────────────────────────────────────────────────────────
document.getElementById("merchant-search")?.addEventListener("input", renderMerchants);
document.getElementById("merchant-sort")?.addEventListener("change", renderMerchants);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadMerchants);
