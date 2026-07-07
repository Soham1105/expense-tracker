// ── Helpers ───────────────────────────────────────────────────────────────────

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

function gINR(v) {
  const n = Math.abs(parseFloat(v) || 0);
  if (n === 0) return "₹0";
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  if (n >= 1000)   return "₹" + (n / 1000).toFixed(1) + "k";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function gFullINR(v) {
  const n = Math.abs(parseFloat(v) || 0);
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function gFmt(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const TYPE_META = {
  EVENT:     { label: "Event",      color: "bg-violet-100 text-violet-700",   icon: "restaurant" },
  PATTERN:   { label: "Pattern",    color: "bg-sky-100 text-sky-700",         icon: "auto_awesome" },
  PORTFOLIO: { label: "Tracking",   color: "bg-emerald-100 text-emerald-700", icon: "trending_up" },
  // Legacy aliases (fold to canonical at read-time in repo, but kept here for any
  // stored values that bypass canonicalization).
  SPLIT:    { label: "Split",    color: "bg-violet-100 text-violet-700",  icon: "group" },
  RETURN:   { label: "Return",   color: "bg-amber-100 text-amber-700",    icon: "undo" },
  CIRCLE:   { label: "Circle",   color: "bg-emerald-100 text-emerald-700",icon: "currency_exchange" },
  GENERAL:  { label: "General",  color: "bg-slate-100 text-slate-600",    icon: "folder_open" },
  MERCHANT: { label: "Merchant", color: "bg-sky-100 text-sky-700",        icon: "storefront" },
};
const ROLE_META = {
  EXPENSE:          { label: "Expense",          color: "bg-rose-50 text-rose-600 border-rose-200" },
  REFUND:           { label: "Refund",            color: "bg-green-50 text-green-700 border-green-200" },
  RECOVERY:         { label: "Recovery",          color: "bg-blue-50 text-blue-700 border-blue-200" },
  SETTLEMENT:       { label: "Settlement",        color: "bg-slate-50 text-slate-600 border-slate-200" },
  CONTRIBUTION_OUT: { label: "Contribution Out",  color: "bg-orange-50 text-orange-700 border-orange-200" },
  CONTRIBUTION_IN:  { label: "Contribution In",   color: "bg-teal-50 text-teal-700 border-teal-200" },
  PAYOUT_IN:        { label: "Payout Received",   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const ROLES_BY_TYPE = {
  // Canonical types
  EVENT: [
    { value: "EXPENSE",    label: "Expense — I paid this" },
    { value: "RECOVERY",   label: "Recovery — their share I received" },
    { value: "SETTLEMENT", label: "Settlement — final lump payback" },
    { value: "REFUND",     label: "Refund — money returned to me" },
  ],
  PATTERN: [
    { value: "EXPENSE", label: "Expense — transaction to classify" },
  ],
  PORTFOLIO: [
    { value: "CONTRIBUTION_OUT", label: "Buy / Contribution — money invested" },
    { value: "PAYOUT_IN",        label: "Payout / Sell — money received" },
  ],
  // Legacy aliases
  SPLIT:   [
    { value: "EXPENSE",    label: "Expense — I paid this" },
    { value: "RECOVERY",   label: "Recovery — their share I received" },
    { value: "SETTLEMENT", label: "Settlement — final lump payback" },
    { value: "REFUND",     label: "Refund — money returned to me" },
  ],
  RETURN:  [
    { value: "EXPENSE",    label: "Expense — original purchase" },
    { value: "REFUND",     label: "Refund — return credited back" },
    { value: "SETTLEMENT", label: "Settlement" },
  ],
  CIRCLE:  [
    { value: "CONTRIBUTION_OUT", label: "Contribution Out — I paid my share" },
    { value: "CONTRIBUTION_IN",  label: "Contribution In — member paid me" },
    { value: "PAYOUT_IN",        label: "Payout Received — I got the pool" },
    { value: "EXPENSE",          label: "Expense — other purchase" },
    { value: "SETTLEMENT",       label: "Settlement" },
  ],
  GENERAL: [
    { value: "EXPENSE",          label: "Expense — I paid this" },
    { value: "REFUND",           label: "Refund — money returned" },
    { value: "RECOVERY",         label: "Recovery — their share I received" },
    { value: "CONTRIBUTION_OUT", label: "Contribution Out" },
    { value: "CONTRIBUTION_IN",  label: "Contribution In" },
    { value: "PAYOUT_IN",        label: "Payout Received" },
    { value: "SETTLEMENT",       label: "Settlement" },
  ],
  MERCHANT: [
    { value: "EXPENSE", label: "Expense — transaction to classify" },
  ],
};

// ── State ─────────────────────────────────────────────────────────────────────

let _groups        = [];
let _activeGroupId = null;
let _activeGroup   = null;
let _txnSearchPage = 0;
let _txnSearchResults = [];
let _statusFilter  = null;   // null|"OPEN"|"SETTLED"
let _purposeFilter = null;   // null|"SETTLEMENT"|"MERCHANT"|"PORTFOLIO"

// Accept both canonical (EVENT/PATTERN/PORTFOLIO) and legacy values so the
// list filters keep working through the transition.
function isSettlementGroup(type) { return ["EVENT","SPLIT","CIRCLE","RETURN","GENERAL"].includes(type); }
function isMerchantGroup(type)   { return ["PATTERN","MERCHANT"].includes(type); }
function isPortfolioGroup(type)  { return type === "PORTFOLIO"; }

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadGroups();

  // Status filter tabs
  document.querySelectorAll("[data-status-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-status-tab]").forEach(b => {
        b.classList.remove("tab-active"); b.classList.add("tab-inactive");
      });
      btn.classList.remove("tab-inactive"); btn.classList.add("tab-active");
      loadGroups(btn.dataset.statusTab || null, undefined);
    });
  });

  // Purpose filter tabs
  document.querySelectorAll("[data-purpose-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-purpose-tab]").forEach(b => {
        b.classList.remove("tab-active"); b.classList.add("tab-inactive");
      });
      btn.classList.remove("tab-inactive"); btn.classList.add("tab-active");
      loadGroups(undefined, btn.dataset.purposeTab || null);
    });
  });

  // Create group form
  document.getElementById("create-group-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const name  = document.getElementById("cg-name").value.trim();
    const notes = document.getElementById("cg-notes").value.trim() || null;
    if (!name) return;
    // The 3 kind-cards write EVENT / PATTERN / PORTFOLIO directly into cg-type-hidden.
    const type = document.getElementById("cg-type-hidden").value || "EVENT";
    await fetch("/groups/", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, group_type: type, notes }) });
    closeModal("create-group-modal");
    document.getElementById("create-group-form").reset();
    resetGroupPurposeCards();
    loadGroups();
  });

  // Panel: add participant
  document.getElementById("add-participant-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const name = document.getElementById("participant-name").value.trim();
    if (!name || !_activeGroupId) return;
    await fetch(`/groups/${_activeGroupId}/participants`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_name: name }) });
    document.getElementById("participant-name").value = "";
    reloadPanel();
  });

  // Panel: add settlement
  document.getElementById("add-settlement-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("settle-amount").value);
    const person = document.getElementById("settle-person").value.trim() || null;
    const date   = document.getElementById("settle-date").value || todayStr();
    const notes  = document.getElementById("settle-notes").value.trim() || null;
    if (!amount || !_activeGroupId) return;
    await fetch(`/groups/${_activeGroupId}/settlements`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_person: person, amount, notes, settled_at: date }) });
    document.getElementById("add-settlement-form").reset();
    reloadPanel();
  });

  // Txn search input
  document.getElementById("txn-search-input")?.addEventListener("input", debounce(runTxnSearch, 300));
  document.getElementById("txn-search-from")?.addEventListener("change", runTxnSearch);
  document.getElementById("txn-search-to")?.addEventListener("change",   runTxnSearch);

  // Link selected transactions button
  document.getElementById("link-txns-btn")?.addEventListener("click", linkSelectedTxns);

  // Panel edit: save
  document.getElementById("panel-save-btn")?.addEventListener("click", saveGroupEdits);
  // Panel: mark settled
  document.getElementById("panel-settle-btn")?.addEventListener("click", markGroupSettled);
  // Panel: delete
  document.getElementById("panel-delete-btn")?.addEventListener("click", deleteActiveGroup);
});

// ── Groups list ───────────────────────────────────────────────────────────────

async function loadGroups(status, purpose) {
  if (status  !== undefined) _statusFilter  = status  || null;
  if (purpose !== undefined) _purposeFilter = purpose || null;

  const qs = _statusFilter ? `?status=${_statusFilter}` : "";
  const res = await fetch(`/groups/${qs}`).then(r => r.json());
  _groups = res.data || [];

  let visible = _groups;
  if      (_purposeFilter === "SETTLEMENT") visible = _groups.filter(g => isSettlementGroup(g.group_type));
  else if (_purposeFilter === "MERCHANT")   visible = _groups.filter(g => isMerchantGroup(g.group_type));
  else if (_purposeFilter === "PORTFOLIO")  visible = _groups.filter(g => isPortfolioGroup(g.group_type));

  renderKPIs(_groups);
  renderGroupCards(visible);
}

function renderKPIs(groups) {
  const container = document.getElementById("groups-kpis");
  if (!container) return;
  const sg = groups.filter(g => isSettlementGroup(g.group_type));
  const mg = groups.filter(g => isMerchantGroup(g.group_type));
  const pg = groups.filter(g => isPortfolioGroup(g.group_type));
  const openSettlements = sg.filter(g => g.status === "OPEN" && parseFloat(g.net_balance) > 0).length;
  const totalPending    = sg.reduce((s, g) => {
    const net = parseFloat(g.net_balance || 0);
    return s + (g.status === "OPEN" && net > 0 ? net : 0);
  }, 0);
  const mgWithTxns = mg.filter(g => (g.link_count || 0) > 0).length;
  const portfolioInvested = pg.reduce((s, g) => {
    const invested = parseFloat(g.total_expense || 0) - parseFloat(g.total_deducted || 0);
    return s + Math.max(invested, 0);
  }, 0);
  container.innerHTML = [
    { label: "Open Events",       value: openSettlements,         icon: "pending_actions",       color: "text-rose-600",  sub: null },
    { label: "Total Pending",     value: gINR(totalPending),      icon: "account_balance_wallet",color: "text-amber-600", sub: null },
    { label: "Bulk Classify",     value: mg.length,               icon: "auto_awesome",          color: "text-sky-600",   sub: mgWithTxns ? `${mgWithTxns} with txns` : null },
    { label: "Tracking",          value: pg.length,               icon: "trending_up",           color: "text-emerald-600", sub: portfolioInvested ? `${gINR(portfolioInvested)} net invested` : null },
  ].map(k => `
    <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
      <div class="flex items-center gap-2 mb-1">
        <span class="material-symbols-outlined text-[16px] ${k.color}">${k.icon}</span>
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">${k.label}</p>
      </div>
      <p class="text-xl font-black ${k.color}">${k.value}</p>
      ${k.sub ? `<p class="text-[10px] text-slate-400 mt-0.5">${k.sub}</p>` : ""}
    </div>`).join("");
}

function sectionHeader(icon, label, count, colorClass) {
  return `<div class="col-span-full flex items-center gap-2 mt-2 mb-1">
    <span class="material-symbols-outlined text-[15px] ${colorClass}">${icon}</span>
    <p class="text-[10px] font-black uppercase tracking-widest ${colorClass}">${label}</p>
    <span class="text-[10px] text-slate-400 font-semibold">(${count})</span>
    <div class="flex-1 h-px bg-slate-100 ml-1"></div>
  </div>`;
}

function renderGroupCards(groups) {
  const container = document.getElementById("groups-list");
  if (!container) return;
  if (!groups.length) {
    container.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-16 text-slate-400">
        <span class="material-symbols-outlined text-5xl mb-3">folder_open</span>
        <p class="text-sm font-medium">No groups here</p>
        <p class="text-xs mt-1">Create one to track shared expenses or bulk-classify transactions</p>
      </div>`;
    return;
  }

  // When showing all groups, partition into sections for clarity
  const showSections = !_purposeFilter;
  const settlementGroups = groups.filter(g => isSettlementGroup(g.group_type));
  const merchantGroups   = groups.filter(g => isMerchantGroup(g.group_type));
  const portfolioGroups  = groups.filter(g => isPortfolioGroup(g.group_type));
  const orderedGroups    = showSections
    ? [...settlementGroups, ...merchantGroups, ...portfolioGroups]
    : groups;

  let html = "";
  let sectionsEmitted = { settlement: false, merchant: false, portfolio: false };

  orderedGroups.forEach(g => {
    if (showSections) {
      if (isSettlementGroup(g.group_type) && !sectionsEmitted.settlement) {
        html += sectionHeader("restaurant", "Events", settlementGroups.length, "text-violet-500");
        sectionsEmitted.settlement = true;
      } else if (isMerchantGroup(g.group_type) && !sectionsEmitted.merchant) {
        html += sectionHeader("auto_awesome", "Bulk Classify", merchantGroups.length, "text-sky-500");
        sectionsEmitted.merchant = true;
      } else if (isPortfolioGroup(g.group_type) && !sectionsEmitted.portfolio) {
        html += sectionHeader("trending_up", "Tracking", portfolioGroups.length, "text-emerald-500");
        sectionsEmitted.portfolio = true;
      }
    }
    html += renderGroupCard(g);
  });

  container.innerHTML = html;
}

function renderGroupCard(g) {
    const meta = TYPE_META[g.group_type] || TYPE_META.GENERAL;

    if (isPortfolioGroup(g.group_type)) {
      const gmeta        = g.meta || {};
      const invested     = parseFloat(g.total_expense  || 0);
      const realized     = parseFloat(g.total_deducted || 0);
      const costBasis    = (gmeta.cost_basis !== undefined && gmeta.cost_basis !== null && gmeta.cost_basis !== "")
                            ? parseFloat(gmeta.cost_basis) : invested;
      const currentValue = parseFloat(gmeta.current_value || 0);
      const netInvested  = costBasis - realized;
      const unrealized   = currentValue - netInvested;
      const hasValue     = currentValue > 0;
      const positive     = unrealized >= 0;
      const returnTone   = !hasValue ? "text-slate-400" : positive ? "text-emerald-600" : "text-rose-600";
      const returnText   = !hasValue ? "—" : (positive ? "+" : "−") + gINR(Math.abs(unrealized));
      const assetLabel   = gmeta.asset_class ? String(gmeta.asset_class).replace(/_/g, " ") : "";
      return `
        <div class="relative bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer"
             onclick="openGroupPanel('${g.id}')">
          <div class="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-emerald-400"></div>
          <div class="flex items-start justify-between gap-2 mb-3 pt-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="material-symbols-outlined text-[18px] text-emerald-500">${meta.icon}</span>
              <p class="text-sm font-bold text-slate-800 truncate">${g.name}</p>
            </div>
            <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}">${assetLabel || meta.label}</span>
          </div>
          <div class="flex items-end justify-between">
            <div>
              <p class="text-xl font-black text-emerald-700">${gINR(hasValue ? currentValue : netInvested)}</p>
              <p class="text-[10px] text-slate-400 mt-0.5">${hasValue ? "current value" : "net invested"}</p>
            </div>
            <div class="text-right">
              <p class="text-[11px] font-bold ${returnTone}">${returnText}</p>
              <p class="text-[10px] text-slate-400">${g.link_count} txn${g.link_count===1?"":"s"}</p>
            </div>
          </div>
        </div>`;
    }

    if (isMerchantGroup(g.group_type)) {
      const total = parseFloat(g.total_expense || 0);
      return `
        <div class="relative bg-white rounded-2xl border border-sky-200 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer"
             onclick="openGroupPanel('${g.id}')">
          <div class="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-sky-400"></div>
          <div class="flex items-start justify-between gap-2 mb-3 pt-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="material-symbols-outlined text-[18px] text-sky-400">${meta.icon}</span>
              <p class="text-sm font-bold text-slate-800 truncate">${g.name}</p>
            </div>
            <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}">${meta.label}</span>
          </div>
          <div class="flex items-end justify-between">
            <div>
              <p class="text-xl font-black text-sky-700">${gINR(total)}</p>
              <p class="text-[10px] text-slate-400 mt-0.5">total spend</p>
            </div>
            <div class="text-right">
              <p class="text-[11px] font-semibold text-slate-500">${g.link_count} txn${g.link_count===1?"":"s"}</p>
              <p class="text-[10px] text-slate-400">Merchant group</p>
            </div>
          </div>
        </div>`;
    }

    const net     = parseFloat(g.net_balance || 0);
    const settled = g.status === "SETTLED";
    const netColor = settled ? "text-green-600" : net > 0 ? "text-rose-600" : "text-green-600";
    const netLabel = settled ? "Settled" : net > 0 ? `${gINR(net)} pending` : "Balanced";
    return `
      <div class="group relative bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer"
           onclick="openGroupPanel('${g.id}')">
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="material-symbols-outlined text-[18px] text-slate-400">${meta.icon}</span>
            <p class="text-sm font-bold text-slate-800 truncate">${g.name}</p>
          </div>
          <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}">${meta.label}</span>
        </div>
        <div class="flex items-end justify-between">
          <div>
            <p class="text-xl font-black ${netColor}">${gINR(Math.abs(net))}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${netLabel}</p>
          </div>
          <div class="text-right">
            <p class="text-[11px] font-semibold text-slate-500">${g.link_count} txn${g.link_count===1?"":"s"}</p>
            <p class="text-[10px] text-slate-400">${settled
              ? '<span class="text-green-500 font-bold">Settled</span>'
              : '<span class="text-amber-500 font-bold">Open</span>'}</p>
          </div>
        </div>
        ${!settled && net > 0 ? `
          <div class="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full rounded-full bg-rose-400"
                 style="width:${Math.min(((parseFloat(g.total_settled)||0)/(parseFloat(g.total_expense)||1))*100,100).toFixed(0)}%"></div>
          </div>` : ""}
      </div>`;
}

// ── Portfolio holding card ───────────────────────────────────────────────────

function renderPortfolioFields(g) {
  const meta         = g.meta || {};
  const invested     = parseFloat(g.total_expense  || 0);
  const realized     = parseFloat(g.total_deducted || 0);
  const costBasisRaw = meta.cost_basis !== undefined && meta.cost_basis !== null && meta.cost_basis !== ""
                       ? parseFloat(meta.cost_basis) : null;
  const currentValue = parseFloat(meta.current_value || 0);
  const costBasis    = costBasisRaw !== null ? costBasisRaw : invested;
  const netInvested  = costBasis - realized;
  const unrealized   = currentValue - netInvested;
  const pct          = netInvested > 0 ? (unrealized / netInvested) * 100 : 0;

  const investedEl     = document.getElementById("portfolio-invested");
  const realizedEl     = document.getElementById("portfolio-realized");
  const currentInput   = document.getElementById("portfolio-current-value");
  const costBasisInput = document.getElementById("portfolio-cost-basis");
  const assetSelect    = document.getElementById("portfolio-asset-class");
  const returnsCard    = document.getElementById("portfolio-returns-card");
  const returnsEl      = document.getElementById("portfolio-returns");
  const returnsPctEl   = document.getElementById("portfolio-returns-pct");

  if (investedEl)   investedEl.textContent   = gFullINR(invested);
  if (realizedEl)   realizedEl.textContent   = gFullINR(realized);
  if (currentInput) currentInput.value       = currentValue ? currentValue : "";
  if (costBasisInput) costBasisInput.value   = costBasisRaw !== null ? costBasisRaw : "";
  if (assetSelect)  assetSelect.value        = meta.asset_class || "";

  if (returnsCard && returnsEl && returnsPctEl) {
    const positive = unrealized >= 0;
    const tone = currentValue === 0
      ? { bg: "bg-slate-50",    border: "border-slate-200",    text: "text-slate-500" }
      : positive
        ? { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" }
        : { bg: "bg-rose-50",    border: "border-rose-200",    text: "text-rose-700" };
    returnsCard.className = `rounded-xl p-3 text-center border ${tone.bg} ${tone.border}`;
    returnsEl.className   = `text-2xl font-black ${tone.text}`;
    returnsEl.textContent = (currentValue === 0)
      ? "—"
      : (positive ? "+" : "−") + gFullINR(Math.abs(unrealized));
    returnsPctEl.className   = `text-[10px] font-semibold mt-0.5 ${tone.text}`;
    returnsPctEl.textContent = (currentValue === 0 || netInvested <= 0)
      ? "Enter current value to see returns"
      : `${positive ? "+" : ""}${pct.toFixed(2)}% on ${gFullINR(netInvested)} net invested`;
  }
}

// ── Split / Divide calculator (EVENT-style groups) ────────────────────────────

function renderSplitSection(g, isEvent) {
  const section = document.getElementById("panel-split-section");
  if (!section) return;
  section.classList.toggle("hidden", !isEvent);
  if (!isEvent) return;

  const total = parseFloat(g.total_expense || 0);
  const meta = g.meta || {};
  const saved = meta.split || null;

  const totalEl   = document.getElementById("split-total");
  const peopleEl  = document.getElementById("split-people");
  const perHeadEl = document.getElementById("split-per-head");
  const owedEl    = document.getElementById("split-owed-preview");
  const setOwedEl = document.getElementById("split-set-owed");
  const savedEl   = document.getElementById("split-saved");
  const applyBtn  = document.getElementById("split-apply-btn");

  if (totalEl) totalEl.textContent = gFullINR(total);

  // Default people: saved value → participant count → 2
  let people = saved && saved.people ? parseInt(saved.people, 10)
             : (g.participants && g.participants.length ? g.participants.length + 1 : 2);
  if (!people || people < 1) people = 2;
  if (peopleEl) peopleEl.value = people;
  if (setOwedEl) setOwedEl.checked = !!(saved && saved.set_owed);

  function recompute() {
    const n = Math.max(parseInt(peopleEl?.value || "1", 10) || 1, 1);
    const perHead = total / n;
    const othersOwe = total - perHead;   // everyone but you
    if (perHeadEl) perHeadEl.textContent = gFullINR(perHead);
    if (owedEl) owedEl.textContent = othersOwe > 0 ? `· ${gFullINR(othersOwe)}` : "";
    return { people: n, perHead, othersOwe };
  }
  recompute();
  if (peopleEl) peopleEl.oninput = recompute;

  if (savedEl) {
    savedEl.textContent = saved
      ? (saved.set_owed
          ? `Saved: ${saved.people} people · others owe you ${gFullINR(saved.others_owe || 0)}`
          : `Saved: split ${saved.people} ways · ${gFullINR(saved.per_head || 0)} each`)
      : "";
  }

  if (applyBtn) {
    applyBtn.onclick = async () => {
      const { people: n, perHead, othersOwe } = recompute();
      const setOwed = !!setOwedEl?.checked;
      applyBtn.disabled = true;
      applyBtn.textContent = "Saving…";
      try {
        await fetch(`/groups/${_activeGroupId}/meta`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meta_patch: {
              split: {
                people: n,
                per_head: Number(perHead.toFixed(2)),
                my_share: Number(perHead.toFixed(2)),
                others_owe: Number(othersOwe.toFixed(2)),
                set_owed: setOwed,
              },
            },
          }),
        });
        if (window.toast) window.toast.success(setOwed ? "Split saved · owed recorded" : "Split saved");
        reloadPanel();
      } catch (err) {
        if (window.toast) window.toast.error("Could not save split");
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = "Save split";
      }
    };
  }
}

// ── Group detail panel ────────────────────────────────────────────────────────

async function openGroupPanel(groupId) {
  _activeGroupId = groupId;
  document.getElementById("group-panel").classList.remove("translate-x-full");
  document.getElementById("panel-overlay").classList.remove("hidden");
  await reloadPanel();
}

async function reloadPanel() {
  if (!_activeGroupId) return;
  const res = await fetch(`/groups/${_activeGroupId}`).then(r => r.json());
  _activeGroup = res.data;
  renderPanel(_activeGroup);
}

function renderPanel(g) {
  if (!g) return;
  const meta    = TYPE_META[g.group_type] || TYPE_META.GENERAL;
  const settled = g.status === "SETTLED";

  document.getElementById("panel-title").textContent      = g.name;
  document.getElementById("panel-type-badge").className   = `text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`;
  document.getElementById("panel-type-badge").textContent = meta.label;
  document.getElementById("panel-name-input").value       = g.name;
  document.getElementById("panel-status-input").value     = g.status;
  document.getElementById("panel-notes-input").value      = g.notes || "";

  // Bucket selector — canonical type; changing it re-classifies the group immediately.
  const bucketSel = document.getElementById("panel-bucket-select");
  if (bucketSel) {
    bucketSel.value = g.group_type;
    bucketSel.onchange = () => changeGroupBucket(bucketSel.value);
  }

  const isMerchant = isMerchantGroup(g.group_type);
  const isPortfolio = isPortfolioGroup(g.group_type);
  const isEvent = g.group_type === "EVENT" || g.group_type === "SPLIT"
               || g.group_type === "CIRCLE" || g.group_type === "RETURN"
               || g.group_type === "GENERAL";

  // Shared-joy row: only meaningful for EVENT-style groups (bundles where you
  // can mark a portion of spend as "on others"). Hidden for PATTERN/PORTFOLIO.
  const sjRow = document.getElementById("panel-shared-joy-row");
  const sjInput = document.getElementById("panel-shared-joy-input");
  if (sjRow) sjRow.classList.toggle("hidden", !isEvent);
  if (sjInput) sjInput.value = parseFloat(g.shared_joy_amount || 0) || "";

  // Split / Divide calculator: EVENT-style groups only.
  renderSplitSection(g, isEvent);

  // Purpose banner
  const purposeDesc = document.getElementById("panel-purpose-desc");
  if (purposeDesc) {
    purposeDesc.textContent = isMerchant
      ? "Bulk-classify all linked transactions in one action"
      : "Track shared expenses and log who has paid back";
    purposeDesc.classList.remove("hidden");
  }

  // Balance strip: visible only for settlement groups (hidden for PATTERN + PORTFOLIO)
  const balanceStrip = document.getElementById("panel-balance-strip");
  if (balanceStrip) balanceStrip.classList.toggle("hidden", isMerchant || isPortfolio);

  const autoRec = parseFloat(g.auto_recovered || 0);
  document.getElementById("bal-expense").textContent  = gFullINR(g.total_expense);
  document.getElementById("bal-deducted").textContent = gFullINR(g.total_deducted);
  document.getElementById("bal-settled").textContent  = gFullINR(g.total_settled);
  const net = parseFloat(g.net_balance || 0);
  const balEl = document.getElementById("bal-net");
  balEl.textContent = gFullINR(Math.abs(net));
  balEl.className   = `text-lg font-black ${net > 0 ? "text-rose-600" : "text-green-600"}`;
  // Auto-recovered row (from split system)
  const autoRecEl = document.getElementById("bal-auto-recovered");
  const autoRecRow = document.getElementById("bal-auto-recovered-row");
  if (autoRecRow) autoRecRow.style.display = (!isMerchant && autoRec > 0) ? "" : "none";
  if (autoRecEl) autoRecEl.textContent = gFullINR(autoRec);

  // Merchant section vs settlement section vs portfolio section
  const merchantSection   = document.getElementById("panel-merchant-section");
  const settlementSection = document.getElementById("panel-settlement-section");
  const portfolioSection  = document.getElementById("panel-portfolio-section");
  if (merchantSection)   merchantSection.classList.toggle("hidden", !isMerchant);
  if (settlementSection) settlementSection.classList.toggle("hidden", isMerchant || isPortfolio);
  if (portfolioSection)  portfolioSection.classList.toggle("hidden", !isPortfolio);
  if (isMerchant) {
    const totalSpendEl = document.getElementById("merchant-total-spend");
    if (totalSpendEl) totalSpendEl.textContent = gFullINR(g.total_expense);
    initPatternPropagateForm(g);
  }
  if (isPortfolio) renderPortfolioFields(g);

  // Mark as Settled button: hide for MERCHANT and PORTFOLIO groups
  const settleBtn = document.getElementById("panel-settle-btn");
  settleBtn.style.display = (isMerchant || isPortfolio) ? "none" : "";

  // Monthly investment breakdown
  const mbEl = document.getElementById("panel-monthly-breakdown");
  if (mbEl && g.links.length) {
    const DEBIT = new Set(["EXPENSE","CONTRIBUTION_OUT"]);
    const byMonth = {};
    for (const l of g.links) {
      if (!DEBIT.has(l.role)) continue;
      const d = l.transaction_date ? l.transaction_date.slice(0, 7) : "Unknown";
      byMonth[d] = (byMonth[d] || 0) + parseFloat(l.attributed_amount || 0);
    }
    const months = Object.keys(byMonth).sort();
    if (months.length > 1 || isPortfolioGroup(g.group_type) || g.group_type === "CIRCLE") {
      const maxVal = Math.max(...Object.values(byMonth));
      const totalInvested = Object.values(byMonth).reduce((a, b) => a + b, 0);
      const monthLabel = m => {
        if (m === "Unknown") return "Unknown";
        const [y, mo] = m.split("-");
        return new Date(+y, +mo - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      };
      mbEl.innerHTML = `
        <div class="rounded-xl bg-slate-50 p-3 mb-1">
          <div class="flex items-center justify-between mb-2">
            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Monthly Breakdown</p>
            <p class="text-[10px] font-bold text-slate-500">${months.length} month${months.length===1?"":"s"} · ${gFullINR(totalInvested)} total</p>
          </div>
          <div class="space-y-1.5">
            ${months.map(m => {
              const v = byMonth[m];
              const pct = maxVal > 0 ? (v / maxVal * 100).toFixed(0) : 0;
              return `
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-semibold text-slate-500 w-12 shrink-0">${monthLabel(m)}</span>
                  <div class="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div class="h-full rounded-full bg-primary" style="width:${pct}%"></div>
                  </div>
                  <span class="text-[10px] font-bold text-slate-700 w-16 text-right tabular-nums">${gFullINR(v)}</span>
                </div>`;
            }).join("")}
          </div>
        </div>`;
    } else {
      mbEl.innerHTML = "";
    }
  } else if (mbEl) {
    mbEl.innerHTML = "";
  }

  // Participants — show for any settlement-style group (EVENT canonical + SPLIT/CIRCLE legacy)
  const partSec = document.getElementById("panel-participants-section");
  if (g.group_type === "EVENT" || g.group_type === "SPLIT" || g.group_type === "CIRCLE") {
    partSec.classList.remove("hidden");
    document.getElementById("panel-participants").innerHTML = g.participants.length
      ? g.participants.map(p => `
          <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-50 rounded-full text-xs font-semibold text-violet-700">
            ${p.person_name}
            <button onclick="removeParticipant('${p.id}')" class="hover:text-rose-500 leading-none ml-0.5">×</button>
          </span>`).join("")
      : `<span class="text-xs text-slate-400">No participants yet</span>`;
  } else {
    partSec.classList.add("hidden");
  }

  // Transactions
  document.getElementById("panel-links").innerHTML = g.links.length
    ? g.links.map(l => {
        const rm  = ROLE_META[l.role] || ROLE_META.EXPENSE;
        const amt = parseFloat(l.attributed_amount || 0);
        return `
          <div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
            <span class="shrink-0 text-[9px] font-bold border rounded px-1.5 py-0.5 ${rm.color}">${rm.label}</span>
            <div class="flex-1 min-w-0">
              <p class="text-[11px] font-semibold text-slate-700 truncate">${l.merchant}</p>
              <p class="text-[10px] text-slate-400">${gFmt(l.transaction_date)} · ${l.payment_source_name || ""}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-[11px] font-bold text-slate-700">${gFullINR(amt)}</p>
              ${!l.uses_full_amount ? `<p class="text-[9px] text-slate-400">of ${gFullINR(l.full_amount)}</p>` : ""}
            </div>
            <button onclick="removeLink('${l.id}')" class="shrink-0 text-slate-300 hover:text-rose-500 text-lg leading-none">×</button>
          </div>`;
      }).join("")
    : `<p class="text-xs text-slate-400 py-2">No transactions linked yet</p>`;

  // Settlements
  document.getElementById("panel-settlements").innerHTML = g.settlements.length
    ? g.settlements.map(s => `
        <div class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
          <span class="material-symbols-outlined text-[16px] text-green-500">payments</span>
          <div class="flex-1 min-w-0">
            <p class="text-[11px] font-semibold text-slate-700">${s.from_person || "Settlement"}</p>
            <p class="text-[10px] text-slate-400">${gFmt(s.settled_at)}${s.notes ? " · " + s.notes : ""}</p>
          </div>
          <p class="text-[11px] font-bold text-green-600 shrink-0">${gFullINR(s.amount)}</p>
          <button onclick="removeSettlement('${s.id}')" class="shrink-0 text-slate-300 hover:text-rose-500 text-lg leading-none">×</button>
        </div>`).join("")
    : `<p class="text-xs text-slate-400 py-2">No settlements recorded</p>`;

  // Settle / reopen button (already hidden for MERCHANT above)
  settleBtn.textContent = settled ? "Reopen Group" : "Mark as Settled";
  settleBtn.className   = settled
    ? "text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
    : "text-xs font-bold px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600";

  // Default settle date (settlement groups only)
  if (!isMerchant) document.getElementById("settle-date").value = todayStr();
}

function closeGroupPanel() {
  document.getElementById("group-panel").classList.add("translate-x-full");
  document.getElementById("panel-overlay").classList.add("hidden");
  _activeGroupId = null;
  _activeGroup   = null;
  loadGroups();
}

// ── Panel actions ─────────────────────────────────────────────────────────────

// Re-classify a group's bucket (Event / Bulk Classify / Tracking). Saves immediately
// and reloads the panel so type-specific sections (split, holding, propagate) update.
async function changeGroupBucket(newType) {
  if (!_activeGroupId || !_activeGroup) return;
  if (newType === _activeGroup.group_type) return;
  await fetch(`/groups/${_activeGroupId}`, { method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: _activeGroup.name,
      status: _activeGroup.status,
      notes: _activeGroup.notes || null,
      group_type: newType,
    }) });
  if (window.toast) {
    const label = (TYPE_META[newType] || {}).label || newType;
    window.toast.success(`Moved to ${label}`);
  }
  await reloadPanel();
  loadGroups();
}

async function saveGroupEdits() {
  if (!_activeGroupId) return;
  const btn = document.getElementById("panel-save-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const name   = document.getElementById("panel-name-input").value.trim();
    const status = document.getElementById("panel-status-input").value;
    const notes  = document.getElementById("panel-notes-input").value.trim() || null;
    const res = await fetch(`/groups/${_activeGroupId}`, { method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, status, notes }) });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);

    // Shared-joy is type-specific; only PATCH it if the row is visible (EVENT-style)
    const sjRow = document.getElementById("panel-shared-joy-row");
    if (sjRow && !sjRow.classList.contains("hidden")) {
      const raw = document.getElementById("panel-shared-joy-input").value;
      const sj = raw === "" ? 0 : parseFloat(raw);
      if (!Number.isNaN(sj)) {
        await fetch(`/groups/${_activeGroupId}/meta`, { method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shared_joy_amount: sj }) });
      }
    }

    // Portfolio meta (cost_basis / current_value / asset_class) — only when portfolio section visible
    const portfolioSec = document.getElementById("panel-portfolio-section");
    if (portfolioSec && !portfolioSec.classList.contains("hidden")) {
      const cvRaw  = document.getElementById("portfolio-current-value").value;
      const cbRaw  = document.getElementById("portfolio-cost-basis").value;
      const ac     = document.getElementById("portfolio-asset-class").value || null;
      const patch  = {
        current_value: cvRaw === "" ? null : parseFloat(cvRaw),
        cost_basis:    cbRaw === "" ? null : parseFloat(cbRaw),
        asset_class:   ac,
      };
      await fetch(`/groups/${_activeGroupId}/meta`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta_patch: patch }) });
    }

    if (window.toast) window.toast.success("Saved");
    await reloadPanel();
    loadGroups();
  } catch (err) {
    if (window.toast) window.toast.error(err.message || "Save failed");
    else window.toast?.error(err.message || "Save failed");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
}

async function markGroupSettled() {
  if (!_activeGroupId || !_activeGroup) return;
  const newStatus = _activeGroup.status === "SETTLED" ? "OPEN" : "SETTLED";
  await fetch(`/groups/${_activeGroupId}`, { method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: _activeGroup.name, status: newStatus, notes: _activeGroup.notes || null }) });
  reloadPanel();
  loadGroups();
}

async function deleteActiveGroup() {
  if (!_activeGroupId) return;
  if (!confirm("Delete this group? Linked transactions will not be deleted.")) return;
  await fetch(`/groups/${_activeGroupId}`, { method: "DELETE" });
  closeGroupPanel();
}

async function removeParticipant(pid) {
  await fetch(`/groups/${_activeGroupId}/participants/${pid}`, { method: "DELETE" });
  reloadPanel();
}

async function removeLink(linkId) {
  await fetch(`/groups/${_activeGroupId}/links/${linkId}`, { method: "DELETE" });
  reloadPanel();
}

async function removeSettlement(sid) {
  await fetch(`/groups/${_activeGroupId}/settlements/${sid}`, { method: "DELETE" });
  reloadPanel();
}

// ── Transaction search & link ─────────────────────────────────────────────────

function openTxnSearch() {
  document.getElementById("txn-search-modal").classList.remove("hidden");
  document.getElementById("txn-search-input").value = "";
  document.getElementById("txn-search-from").value  = "";
  document.getElementById("txn-search-to").value    = "";
  document.getElementById("txn-attributed-amount").value = "";
  // Populate roles based on current group type
  const type = _activeGroup?.group_type || "GENERAL";
  const roles = ROLES_BY_TYPE[type] || ROLES_BY_TYPE.GENERAL;
  const roleSelect = document.getElementById("txn-role-select");
  roleSelect.innerHTML = roles.map(r => `<option value="${r.value}">${r.label}</option>`).join("");
  roleSelect.value = roles[0].value;
  _txnSearchResults = [];
  runTxnSearch(); // auto-load recent transactions immediately
}

function closeTxnSearch() {
  document.getElementById("txn-search-modal").classList.add("hidden");
}

async function runTxnSearch() {
  const q    = document.getElementById("txn-search-input").value.trim();
  const from = document.getElementById("txn-search-from").value || null;
  const to   = document.getElementById("txn-search-to").value || null;

  const el = document.getElementById("txn-results");
  el.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Searching&#x2026;</p>`;

  const body = { vendor_filter: q || "", from_date: from, to_date: to };
  const res  = await fetch("/reports/transactions_filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({ data: [] }));

  _txnSearchResults = Array.isArray(res.data) ? res.data : (res.data?.transactions || []);
  renderTxnResults(_txnSearchResults);
}

function renderTxnResults(txns) {
  const el = document.getElementById("txn-results");
  if (!txns.length) {
    el.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">No transactions found</p>`;
    return;
  }
  el.innerHTML = txns.map(t => {
    const merchant = t.vendor_name || t.counterparty_entity_name || t.counterparty_identifier || "Unknown";
    const isCredit = t.direction === "credit" || t.direction === "inbound";
    return `
      <label class="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer border border-transparent has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-all">
        <input type="checkbox" value="${t.id}" data-amount="${Math.abs(t.amount || 0)}"
               class="txn-checkbox rounded border-slate-300 text-primary focus:ring-primary">
        <div class="flex-1 min-w-0">
          <p class="text-[11px] font-semibold text-slate-700 truncate">${merchant}</p>
          <p class="text-[10px] text-slate-400">${gFmt(t.transaction_date)} · ${t.payment_source_name || ""}</p>
        </div>
        <p class="text-[11px] font-bold shrink-0 ${isCredit ? "text-green-600" : "text-rose-600"}">
          ${isCredit ? "+" : ""}${gFullINR(t.amount)}
        </p>
      </label>`;
  }).join("");
}

async function linkSelectedTxns() {
  const checked = [...document.querySelectorAll(".txn-checkbox:checked")];
  if (!checked.length) { window.toast?.error("Select at least one transaction"); return; }
  const role   = document.getElementById("txn-role-select").value;
  const manualAmt = parseFloat(document.getElementById("txn-attributed-amount").value) || null;

  for (const cb of checked) {
    const attributed_amount = manualAmt !== null ? manualAmt : parseFloat(cb.dataset.amount);
    await fetch(`/groups/${_activeGroupId}/links`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: cb.value, role, attributed_amount }) });
  }
  closeTxnSearch();
  reloadPanel();
}

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id)?.classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id)?.classList.add("hidden"); }

// ── PATTERN propagate form ────────────────────────────────────────────────────

let _ppPicker = null;

async function initPatternPropagateForm(g) {
  if (!_ppPicker && typeof window.makeMGTagPicker === "function") {
    _ppPicker = window.makeMGTagPicker({
      searchId: "pp-tag-search",
      dropdownId: "pp-tag-dropdown",
      selectedId: "pp-selected-tags",
    });
  }
  if (_ppPicker) {
    await _ppPicker.init();
    _ppPicker.reset();
  }

  // Seed vendor / rule value from the group name or first linked txn
  const vendorInput = document.getElementById("pp-vendor-name");
  if (vendorInput) vendorInput.value = "";

  const ruleValueInput = document.getElementById("pp-rule-value");
  if (ruleValueInput) {
    const firstLink = (g.links || [])[0];
    ruleValueInput.value = firstLink ? (firstLink.counterparty_identifier || firstLink.merchant || "") : "";
  }

  ["pp-flow-type", "pp-counterparty-type", "pp-consumption-ownership", "pp-settlement-state"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const ruleCheckbox = document.getElementById("pp-create-rule");
  const ruleDetails  = document.getElementById("pp-rule-details");
  if (ruleCheckbox) {
    ruleCheckbox.checked = false;
    ruleCheckbox.onchange = () => {
      if (ruleDetails) ruleDetails.classList.toggle("hidden", !ruleCheckbox.checked);
    };
  }
  if (ruleDetails) ruleDetails.classList.add("hidden");

  const submitBtn = document.getElementById("pp-submit-btn");
  if (submitBtn) submitBtn.onclick = submitPatternPropagate;
}

async function submitPatternPropagate() {
  if (!_activeGroupId || !_activeGroup) return;
  const btn = document.getElementById("pp-submit-btn");

  const vendorName = (document.getElementById("pp-vendor-name")?.value || "").trim() || null;
  const flowType   = document.getElementById("pp-flow-type")?.value || null;
  const cpType     = document.getElementById("pp-counterparty-type")?.value || null;
  const consOwn    = document.getElementById("pp-consumption-ownership")?.value || null;
  const settle     = document.getElementById("pp-settlement-state")?.value || null;
  const createRule = document.getElementById("pp-create-rule")?.checked || false;
  const ruleField  = document.getElementById("pp-rule-field")?.value || "counterparty_identifier";
  const ruleValue  = (document.getElementById("pp-rule-value")?.value || "").trim() || null;
  const tagNames   = _ppPicker ? _ppPicker.getSelected() : [];

  if (btn) { btn.disabled = true; btn.textContent = "Applying…"; }

  try {
    const res = await fetch(`/groups/${_activeGroupId}/propagate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor_name: vendorName,
        tag_names: tagNames,
        primary_flow_type: flowType,
        counterparty_type: cpType,
        consumption_ownership: consOwn,
        settlement_state: settle,
        no_tag_required: false,
        create_tag_rule: createRule,
        tag_rule_match_field: createRule ? ruleField : null,
        tag_rule_match_value: createRule ? ruleValue : null,
      }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.message || "Failed to propagate classification");

    if (window.toast) window.toast.success(`Applied to ${result.data.updated_count} transactions`);
    reloadPanel();
  } catch (err) {
    if (window.toast) window.toast.error(err.message || "Something went wrong");
    else window.toast?.error(err.message || "Something went wrong");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined text-[14px]">auto_awesome</span> Apply to All Linked Transactions`;
    }
  }
}

// ── Create-modal "kind" cards (EVENT / PATTERN / PORTFOLIO) ───────────────────
// Three buttons, each writes its kind directly into #cg-type-hidden.

const _KIND_CARD_STYLE = {
  EVENT:     { active: ["border-violet-400",  "bg-violet-50"]  },
  PATTERN:   { active: ["border-sky-400",     "bg-sky-50"]     },
  PORTFOLIO: { active: ["border-emerald-400", "bg-emerald-50"] },
};
const _KIND_CARD_IDS = {
  EVENT:     "kind-event",
  PATTERN:   "kind-pattern",
  PORTFOLIO: "kind-portfolio",
};

function _allKindCards() {
  return Object.values(_KIND_CARD_IDS).map(id => document.getElementById(id)).filter(Boolean);
}

function selectGroupKind(kind) {
  if (!_KIND_CARD_STYLE[kind]) return;
  // Reset all 3 cards to default border
  _allKindCards().forEach(btn => {
    btn.classList.remove(
      "border-violet-400","bg-violet-50",
      "border-sky-400","bg-sky-50",
      "border-emerald-400","bg-emerald-50",
    );
    btn.classList.add("border-slate-200");
  });
  // Highlight the chosen card
  const chosen = document.getElementById(_KIND_CARD_IDS[kind]);
  if (chosen) {
    chosen.classList.remove("border-slate-200");
    chosen.classList.add(..._KIND_CARD_STYLE[kind].active);
  }
  document.getElementById("cg-type-hidden").value = kind;
  const submitBtn = document.getElementById("cg-submit-btn");
  if (submitBtn) submitBtn.disabled = false;
}

function resetGroupPurposeCards() {
  // Name kept for backwards-compat with existing closeModal callers in the HTML.
  _allKindCards().forEach(btn => {
    btn.classList.remove(
      "border-violet-400","bg-violet-50",
      "border-sky-400","bg-sky-50",
      "border-emerald-400","bg-emerald-50",
    );
    btn.classList.add("border-slate-200");
  });
  const hiddenType = document.getElementById("cg-type-hidden");
  if (hiddenType) hiddenType.value = "";
  const submitBtn = document.getElementById("cg-submit-btn");
  if (submitBtn) submitBtn.disabled = true;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

