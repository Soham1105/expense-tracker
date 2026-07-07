/* budget.js */
const CAT_COLORS = ["#607AFB","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6","#f97316","#64748b"];

// Stable hash-based fallback palette — reserved module colors excluded:
// sky(tags) cyan(bulk) violet/purple(groups/joy) are reserved and must not appear here
const _CAT_FALLBACK = ["#607AFB","#10b981","#f59e0b","#f97316","#ec4899","#14b8a6","#64748b","#ef4444","#84cc16","#fb923c","#6366f1","#d97706","#be185d","#0f766e"];
function _hashCatColor(name) {
  let h = 0;
  const s = String(name || "").toLowerCase().trim();
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
  return _CAT_FALLBACK[Math.abs(h) % _CAT_FALLBACK.length];
}

// Resolve a category color: custom (from category manager) → stable hash fallback.
function _catColor(name) {
  const map = window._catColorMap || {};
  const stored = map[(name || "").toLowerCase().trim()];
  return stored || _hashCatColor(name);
}

// Fetch categories once and populate the color map for budget page if analytics hasn't done so.
(async function _initBudgetColors() {
  if (window._catColorMap && Object.keys(window._catColorMap).length > 0) return;
  try {
    const r = await fetch("/classification/api/categories");
    const d = await r.json();
    window._catColorMap = {};
    function _budgetWalkTree(nodes) {
      nodes.forEach(node => {
        const color = node.color || _hashCatColor(node.name); // own color or stable hash — never inherit parent
        if (node.name) window._catColorMap[node.name.toLowerCase()] = color;
        if (node.subcategories) _budgetWalkTree(node.subcategories);
        if (node.children) _budgetWalkTree(node.children);
      });
    }
    _budgetWalkTree(d.data || []);
  } catch (e) { window._catColorMap = window._catColorMap || {}; }
})();

function fmt(v)  { return "₹" + Number(v||0).toLocaleString("en-IN", {maximumFractionDigits:0}); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function escH(s) { return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function monthName(s) {
  if (!s) return "";
  return new Date(s.length===7 ? s+"-01" : s).toLocaleString("en-IN",{month:"long",year:"numeric"});
}

function nextMonthStart(s) {
  const base = s ? new Date(s + "T00:00:00") : new Date();
  return new Date(base.getFullYear(), base.getMonth() + 1, 1).toISOString().slice(0, 10);
}

function budgetChoiceDialog({ title, message, details = "", yesLabel = "Yes", noLabel = "No", cancelLabel = "Cancel", tone = "primary" }) {
  return new Promise((resolve) => {
    document.getElementById("budget-choice-dialog")?.remove();
    const isDanger = tone === "danger";
    const primaryCls = isDanger
      ? "bg-rose-600 hover:bg-rose-700"
      : "bg-primary hover:bg-primary/90";
    const iconCls = isDanger
      ? "bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300"
      : "bg-primary/10 text-primary dark:bg-primary/20 dark:text-indigo-300";
    const overlay = document.createElement("div");
    overlay.id = "budget-choice-dialog";
    overlay.className = "fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm";
    overlay.innerHTML = `
      <div class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconCls}">
            <span class="material-symbols-outlined text-[22px]">fact_check</span>
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-black text-slate-950 dark:text-slate-100">${escH(title)}</h3>
            <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">${escH(message)}</p>
          </div>
        </div>
        ${details ? `<div class="mt-4 max-h-72 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">${details}</div>` : ""}
        <div class="mt-5 grid grid-cols-3 gap-2">
          <button data-choice="no" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">${escH(noLabel)}</button>
          <button data-choice="cancel" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">${escH(cancelLabel)}</button>
          <button data-choice="yes" class="rounded-xl ${primaryCls} px-3 py-2 text-xs font-black text-white transition-colors">${escH(yesLabel)}</button>
        </div>
      </div>
    `;
    const close = (choice) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(choice);
    };
    const onKey = (event) => { if (event.key === "Escape") close("cancel"); };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("cancel");
      const btn = event.target.closest("[data-choice]");
      if (btn) close(btn.dataset.choice);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

let currentMonthStart  = "";
let activeBudgetMonthStart = "";
let isHistoricalBudgetView = false;
let currentBudget      = {};
let allTags            = [];
let _addParentContext  = null;
let _gaugeBudgetTotal  = 0; // stored so renderGoalsArc can update without full re-render

// ── Engagement helpers ────────────────────────────────────────────────────────
const _BUDGET_MSGS = {
  on_track:    ["You're crushing it! 💪 Right on track.", "Smooth sailing ⛵ Keep it up!", "Nice work! 🎯 Budget looking healthy."],
  ahead:       ["Budget boss! 🏆 You're well under plan.", "Money wizard detected 🧙 Ahead of budget.", "Killing it! 🚀 Under budget and thriving."],
  off_track:   ["Heads up! ⚠️ Spending a bit fast.", "Careful! 😅 Pace is above plan.", "Future you is watching! 👀 Slow down a little."],
  over_budget: ["Oops! Budget exceeded 😬 Time to pump the brakes.", "Over budget alert! 💸 But tomorrow is a new day.", "Overspent 🚨 Cut back on the top categories."],
  no_budget:   ["Set a monthly budget to track pace! 💡", "Add a budget amount to unlock pace tracking 📊"],
};

function renderBudgetFun(budget, items) {
  const pace = budget?.status === "over_budget" ? "over_budget" : (budget?.pace_status || "no_budget");
  const overItems = items.filter(i => Number(i.spent||0) > Number(i.budget_amount||0) && Number(i.budget_amount||0) > 0);
  const total     = items.length;
  const msgs      = _BUDGET_MSGS[pace] || _BUDGET_MSGS.no_budget;
  const msg       = msgs[Math.floor(Math.random() * msgs.length)];
  const isStress  = pace === "over_budget" || pace === "off_track";

  // Inject / update fun card
  let el = document.getElementById("budget-fun-card");
  if (!el) {
    el = document.createElement("div");
    el.id = "budget-fun-card";
    const anchor = document.getElementById("catBudgetList")?.closest(".rounded-2xl, .rounded-3xl, .bg-white") || document.getElementById("catBudgetList")?.parentElement;
    if (anchor) anchor.parentNode.insertBefore(el, anchor);
  }
  const cls = isStress
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
  el.innerHTML = `<div class="fun-card rounded-xl border ${cls} px-4 py-3 mb-3 flex items-center gap-2 text-sm font-semibold">
    <span class="text-lg">${isStress ? "⚠️" : "🎉"}</span>
    <span>${msg}</span>
    ${!isStress && total > 0 ? `<span class="ml-auto text-[10px] opacity-60">${total - overItems.length}/${total} on track</span>` : ""}
  </div>`;

  // Confetti when all categories are under budget
  if (!isStress && total > 0 && overItems.length === 0 && !window._budgetConfettiLaunched) {
    window._budgetConfettiLaunched = true;
    setTimeout(() => window.launchConfetti?.(), 600);
  }
}

// ── Budget ring gauge ─────────────────────────────────────────────────────────
function renderGauge(spent, planned, source) {
  const card = document.getElementById("budgetGaugeCard");
  if (!card) return;
  if (!planned || planned <= 0) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");

  const pct     = spent / planned;
  const dispPct = Math.round(pct * 100);
  const circ    = 251.33;
  // Split total spent into Shared-Joy slice (purple) and Personal slice (orange).
  // They sit as ADJACENT segments on the ring (Joy first, then Personal) so the
  // purple is never drawn inside/on-top-of the orange — they sit side-by-side.
  const joy           = Math.max(0, Math.min(_sharedJoyGaugeAmount || 0, spent));
  const personalSpent = Math.max(0, spent - joy);
  const joyDash       = Math.min(joy / planned, 1) * circ;
  const personalDash  = Math.min(personalSpent / planned, 1) * circ;
  const personalStart = -90 + (joyDash / circ) * 360;          // begin where joy ends
  const color   = "#f97316";                                    // personal spent = orange
  const label   = pct > 1 ? "Over budget" : pct > 0.8 ? "Near limit" : "On track";
  const isDark  = document.documentElement.classList.contains("dark");

  const arc = document.getElementById("gaugeArc");
  const bg  = document.getElementById("gaugeBg");
  if (arc) {
    arc.setAttribute("stroke-dasharray", `${personalDash} ${circ}`);
    arc.setAttribute("stroke", color);
    arc.setAttribute("transform", `rotate(${personalStart} 50 50)`);
  }
  if (bg)  { bg.setAttribute("stroke", isDark ? "#334155" : "#e2e8f0"); }
  // Sync the legend swatch with the actual Spent stroke (currently fixed orange).
  const legend = document.getElementById("gaugeLegendSpent");
  if (legend) legend.style.background = color;

  setText("gaugePct",       `${dispPct}%`);
  setText("gaugeLabel",     label);
  setText("gaugeSpent",     fmt(spent));
  setText("gaugePlanned",   fmt(planned));
  setText("gaugePlanLabel", source || "");

  const left  = planned - spent;
  const remEl = document.getElementById("gaugeRemaining");
  if (remEl) {
    remEl.textContent = (left < 0 ? "-" : "") + fmt(Math.abs(left));
    remEl.style.color = left < 0 ? "#ef4444" : "";
  }

  _gaugeBudgetTotal = planned;
  const _gPlanned  = _plannedForMonthItems.filter(i => i.item_type === "planned" ).reduce((s, i) => s + Number(i.amount || 0), 0);
  const _gWishlist = _plannedForMonthItems.filter(i => i.item_type === "wishlist").reduce((s, i) => s + Number(i.amount || 0), 0);
  renderGoalsArc(_gPlanned, _gWishlist);
}

// ── Goals arcs on ring gauge (planned = red #ef4444, wishlist = blue #607AFB, sharedJoy = pink #ec4899) ──
let _sharedJoyGaugeAmount = 0;

function renderGoalsArc(plannedTotal, wishlistTotal) {
  const budget = _gaugeBudgetTotal || (plannedTotal + wishlistTotal);
  if (!budget) return;
  const circ = 251.33;
  // ~3.5% of the ring — small enough not to lie about the proportion but big enough
  // that a non-zero value reliably registers as a visible arc on the ring.
  const MIN_ARC = 9;
  const visible = (raw) => raw <= 0 ? 0 : Math.max(raw, MIN_ARC);

  // Layout: Joy → Personal-Spent → Planned → Wishlist, all side-by-side on the ring.
  const joyTrue      = Math.max(0, _sharedJoyGaugeAmount || 0);
  const joyDashRaw   = Math.min(joyTrue / budget * circ, circ);
  const joyDash      = visible(joyDashRaw);
  const joyEl = document.getElementById("gaugeSharedJoyArc");
  if (joyEl) {
    joyEl.setAttribute("stroke-dasharray", `${joyDash} ${circ}`);
    joyEl.setAttribute("transform", `rotate(-90 50 50)`);
  }

  // The Spent (orange) arc was already sized + positioned by renderGauge — start it just
  // past the joy slice. Read its current dash to know how much of the ring it consumes.
  const arcEl       = document.getElementById("gaugeArc");
  const personalDash = arcEl
    ? parseFloat(arcEl.getAttribute("stroke-dasharray")?.split(" ")[0] || "0")
    : 0;
  const occupied = joyDashRaw + personalDash;
  const remaining = Math.max(0, circ - occupied);

  // Planned arc (red) — starts where Personal-Spent ends
  const plannedRaw  = Math.min((plannedTotal / budget) * circ, remaining);
  const plannedDash = visible(plannedRaw);
  const plannedEl   = document.getElementById("gaugePlannedArc");
  if (plannedEl) {
    const plannedStart = -90 + (occupied / circ) * 360;
    plannedEl.setAttribute("stroke-dasharray", `${plannedDash} ${circ}`);
    plannedEl.setAttribute("transform", `rotate(${plannedStart} 50 50)`);
  }

  // Wishlist arc (blue) — starts where Planned ends
  const wishlistRaw  = Math.min((wishlistTotal / budget) * circ, Math.max(0, remaining - plannedDash));
  const wishlistDash = visible(wishlistRaw);
  const wishlistEl   = document.getElementById("gaugeWishlistArc");
  if (wishlistEl) {
    const wishlistStart = -90 + ((occupied + plannedDash) / circ) * 360;
    wishlistEl.setAttribute("stroke-dasharray", `${wishlistDash} ${circ}`);
    wishlistEl.setAttribute("transform", `rotate(${wishlistStart} 50 50)`);
  }
}

// ── Header / forecast updates ──────────────────────────────────────────────────
function renderSummary(budget, cm) {
  const PACE = {
    no_budget: {l:"No budget", c:"bg-slate-100 text-slate-600"},
    off_track: {l:"⚠ Off track", c:"bg-rose-100 text-rose-700"},
    ahead:     {l:"Under pace",  c:"bg-sky-100 text-sky-700"},
    on_track:  {l:"✓ On track",  c:"bg-emerald-100 text-emerald-700"},
  };
  const p = PACE[budget.pace_status||"no_budget"] || PACE.no_budget;
  const badge = document.getElementById("paceBadge");
  if (badge) { badge.textContent = p.l; badge.className = `inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${p.c}`; }
  setText("pageMonthLabel", monthName(cm.month_start));
  const gaugeEyebrow = document.getElementById("budgetGaugeEyebrow");
  if (gaugeEyebrow) gaugeEyebrow.textContent = isHistoricalBudgetView ? monthName(cm.month_start) : "This month";
  syncBudgetMonthControls();
}

function normalizeMonthStart(ms) {
  if (!ms) return "";
  const str = String(ms);
  return str.length >= 7 ? `${str.slice(0, 7)}-01` : "";
}

function monthInputValue(ms) {
  const normalized = normalizeMonthStart(ms);
  return normalized ? normalized.slice(0, 7) : "";
}

function syncBudgetMonthControls() {
  const picker = document.getElementById("budgetViewMonth");
  const currentBtn = document.getElementById("budgetCurrentMonthBtn");
  const startBtn = document.getElementById("startNewMonthBtn");
  const closeBtn = document.getElementById("closePreviousMonthBtn");
  const addCatBtn = document.getElementById("addCatBtn");
  const planSubmitBtn = document.getElementById("planSubmitBtn");
  const budgetForm = document.getElementById("budgetForm");

  if (picker && currentMonthStart) picker.value = monthInputValue(currentMonthStart);
  currentBtn?.classList.toggle("hidden", !isHistoricalBudgetView);
  startBtn?.classList.toggle("hidden", isHistoricalBudgetView);
  closeBtn?.classList.toggle("hidden", isHistoricalBudgetView);
  addCatBtn?.classList.toggle("hidden", isHistoricalBudgetView);

  if (budgetForm) {
    budgetForm.querySelectorAll("input, textarea, button").forEach(el => {
      el.disabled = isHistoricalBudgetView;
    });
  }
  if (planSubmitBtn && isHistoricalBudgetView) planSubmitBtn.textContent = "Viewing previous month";
}

function categoryBudgetUrl() {
  const inactiveFlag = isHistoricalBudgetView ? "&include_inactive_history=true" : "";
  return `/planning/category-budgets?month_start=${currentMonthStart}${inactiveFlag}`;
}

// Fraction of the current month elapsed (for spend-pace projection).
function _monthFraction() {
  const b = currentBudget || {};
  const de = Number(b.days_elapsed || b._cm?.days_elapsed || 0);
  const di = Number(b.days_in_month || b._cm?.days_in_month || 0);
  if (de > 0 && di > 0) return Math.min(de / di, 1);
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(now.getDate() / dim, 1);
}

// ── Plan vs Actual table ──────────────────────────────────────────────────────
function _renderBudgetRow(item, isChild, categoryColor = null) {
  const planned   = Number(item.budget_amount||0);
  const actual    = Number(item.spent||0);
  const remaining = planned - actual;
  const pct       = planned > 0 ? Math.min(Math.round(actual/planned*100), 100) : 0;
  const isOver    = actual > planned && planned > 0;
  // Projected to exceed: at the current pace this category will blow its budget.
  const _frac     = _monthFraction();
  const projOver  = !isOver && planned > 0 && _frac > 0 && (actual / _frac) > planned * 1.02;
  // Use category identity color when available; fall back to status-based class
  const barCls    = categoryColor ? "" : (isOver ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500");
  const barStyle  = categoryColor ? `background:${categoryColor}` : "";
  const actualCls = isOver ? "text-rose-600 dark:text-rose-400 font-bold" : "text-slate-700 dark:text-slate-200 font-semibold";
  const remCls    = remaining < 0 ? "text-rose-500 dark:text-rose-400" : "text-slate-500 dark:text-slate-400";
  const nameCls   = isChild
    ? "text-xs text-slate-500 dark:text-slate-400 truncate"
    : "text-sm font-semibold text-slate-800 dark:text-slate-100 truncate";
  const rowId     = String(item.id || item.tag_name || "row").replace(/[^a-z0-9_-]/gi, "_");
  const canEdit   = !isHistoricalBudgetView && Boolean(item.id);

  // Planned expenses this month for THIS category (red on gauge = red here too)
  const plannedForCat = _plannedForMonthMap[item.tag_name?.toLowerCase()] || 0;

  return `
    <div id="catrow-${rowId}" class="group grid grid-cols-[1fr_88px_88px_88px_48px] gap-2 items-center px-5 py-3
      ${isChild ? "pl-10 bg-slate-50/50 dark:bg-slate-800/20" : ""}
      ${isOver ? "bg-rose-50/40 dark:bg-rose-900/10" : ""}
      hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">

      <div class="min-w-0">
        <div class="flex items-center gap-1.5 flex-wrap">
          ${isChild ? `<span class="text-slate-300 dark:text-slate-600 text-xs shrink-0">↳</span>` : ""}
          <span class="${nameCls}">${escH(item.tag_name)}</span>
          ${isOver ? `<span class="shrink-0 text-[9px] font-bold text-rose-500">▲</span>` : ""}
          ${projOver ? `<span title="At the current pace this category will exceed its budget" class="shrink-0 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-700/30 px-1.5 py-0 text-[9px] font-semibold text-amber-600 dark:text-amber-400">on track to exceed</span>` : ""}
          ${plannedForCat > 0 ? `<span title="Planned expenses for this category this month" class="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-700/30 px-1.5 py-0 text-[9px] font-semibold text-red-600 dark:text-red-400">↗ ${fmt(plannedForCat)} planned</span>` : ""}
        </div>
        <div class="mt-1.5 h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
          <div class="h-full rounded-full ${barCls} transition-all duration-500" style="width:${pct}%;${barStyle}"></div>
        </div>
      </div>

      <span class="text-right text-sm text-slate-500 dark:text-slate-400">${fmt(planned)}</span>
      <span class="text-right text-sm ${actualCls}">${fmt(actual)}</span>
      <span class="text-right text-sm ${remCls}">${remaining<0?"-":""}${fmt(Math.abs(remaining))}</span>

      <div class="flex items-center justify-end gap-0.5 ${canEdit ? "opacity-0 group-hover:opacity-100 transition-opacity" : ""}">
        ${canEdit ? `
        <button onclick="startEditCat('${item.id}',${planned})" title="Edit"
          class="p-1 rounded text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
          <span class="material-symbols-outlined text-[14px]">edit</span>
        </button>
        <button onclick="removeCatBudget('${item.id}')" title="Remove"
          class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
          <span class="material-symbols-outlined text-[14px]">close</span>
        </button>
        ` : ""}
      </div>
    </div>
    ${canEdit ? `<div id="catedit-${item.id}" class="hidden px-5 pb-3 flex items-center gap-2 bg-slate-50 dark:bg-slate-800/40">
      <input type="number" min="0" step="1" value="${planned}"
        id="catEditInput-${item.id}" class="w-28 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30" />
      <button onclick="saveEditCat('${item.id}','${escH(item.tag_name)}','${escH(item.parent_name||"")}')"
        class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90 transition-colors">Save</button>
      <button onclick="cancelEditCat('${item.id}')"
        class="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancel</button>
      <span id="catEditErr-${item.id}" class="text-xs text-rose-500 hidden"></span>
    </div>` : ""}`;
}

function renderPlanTable(items) {
  const list      = document.getElementById("catBudgetList");
  const totals    = document.getElementById("catTotalsRow");
  const chartCard = document.getElementById("chartCard");
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<p class="py-6 text-sm text-slate-400 text-center">No categories planned. Click "Add category" to start.</p>`;
    if (totals)    totals.classList.add("hidden");
    if (chartCard) chartCard.classList.add("hidden");
    return 0;
  }

  const roots    = items.filter(i => !i.parent_name);
  const children = items.filter(i =>  i.parent_name);

  // Pre-compute unbudgeted and merge into "Other" BEFORE rendering so rows are built correctly
  const _totalSpentAll2 = Number(currentBudget?._cm?.spent_so_far || 0);
  const _rawTracked     = roots.reduce((s, r) => s + Number(r.spent || 0), 0);
  const _unbudgeted2    = Math.max(0, _totalSpentAll2 - _rawTracked);
  const _otherItem      = _unbudgeted2 > 0.5
    ? roots.find(r => /^other[s]?$|^misc(ellaneous)?$|^general$/i.test((r.tag_name || "").trim()))
    : null;
  if (_otherItem) {
    _otherItem.spent = Number(_otherItem.spent || 0) + _unbudgeted2;
  }

  let totalPlanned = 0, totalActual = 0;
  const rows = [];

  roots.forEach((root, i) => {
    const catColor = _catColor(root.tag_name);
    rows.push(_renderBudgetRow(root, false, catColor));
    totalPlanned += Number(root.budget_amount||0);
    totalActual  += Number(root.spent||0);
    const kids = children.filter(c => c.parent_name.toLowerCase() === root.tag_name.toLowerCase());
    kids.forEach(kid => rows.push(_renderBudgetRow(kid, true, _catColor(kid.tag_name))));
  });

  // Orphan children flat
  children.filter(c => !roots.some(r => r.tag_name.toLowerCase() === c.parent_name.toLowerCase()))
    .forEach(o => rows.push(_renderBudgetRow(o, false)));

  // If no "Other" category exists but there is unbudgeted spend, add a synthetic row
  if (_unbudgeted2 > 0.5 && !_otherItem) {
    rows.push(`
      <div class="group grid grid-cols-[1fr_88px_88px_88px_48px] gap-2 items-center px-5 py-3
        border-t border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/10
        hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <div class="min-w-0">
          <span class="text-sm font-semibold text-slate-500 dark:text-slate-400 truncate">Other</span>
          <p class="text-[10px] text-slate-400 mt-0.5">Set an "Other" budget to plan for this</p>
          <div class="mt-1.5 h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
            <div class="h-full rounded-full bg-slate-300 dark:bg-slate-600" style="width:100%"></div>
          </div>
        </div>
        <span class="text-right text-sm text-slate-400">—</span>
        <span class="text-right text-sm font-semibold text-slate-600 dark:text-slate-300">${fmt(_unbudgeted2)}</span>
        <span class="text-right text-sm text-rose-500">−${fmt(_unbudgeted2)}</span>
        <span></span>
      </div>`);
    totalActual += _unbudgeted2;
  }

  list.innerHTML = rows.join("");

  if (totals) {
    totals.classList.remove("hidden");
    const rem = totalPlanned - totalActual;
    setText("footerPlanned",   fmt(totalPlanned));
    setText("footerActual",    fmt(totalActual));
    setText("footerRemaining", `${rem<0?"-":""}${fmt(Math.abs(rem))}`);
  }

  // Shared Joy deduction + Your spend rows
  const sjSpent = Number(_sharedJoyData?.spent || 0);
  const deductRow   = document.getElementById("sharedJoyDeductRow");
  const yourSpendRow = document.getElementById("yourSpendRow");
  if (sjSpent > 0 && totals) {
    setText("footerSharedJoy",  `-${fmt(sjSpent)}`);
    setText("footerYourSpend",  fmt(Math.max(0, totalActual - sjSpent)));
    deductRow?.classList.remove("hidden");
    yourSpendRow?.classList.remove("hidden");
  } else {
    deductRow?.classList.add("hidden");
    yourSpendRow?.classList.add("hidden");
  }

  renderBudgetInsight(items);

  renderChart(roots);
  if (chartCard) chartCard.classList.remove("hidden");
  renderBudgetFun(currentBudget, roots);
  return totalActual;
}

// Projection (month-end spend vs cap) + overspend summary strip.
function renderBudgetInsight(items) {
  const el = document.getElementById("budgetInsightStrip");
  if (!el) return;
  const b = currentBudget || {};
  const cap = Number(b.effective_budget || b.budget_amount || 0);
  const spent = Number(b._cm?.spent_so_far || 0);
  const frac = _monthFraction();
  const projected = Number(b.projected_month_outflow || (frac > 0 ? spent / frac : spent));

  let over = 0, overAmt = 0, projOver = 0;
  (items || []).forEach((it) => {
    const pl = Number(it.budget_amount || 0), ac = Number(it.spent || 0);
    if (pl > 0 && ac > pl) { over++; overAmt += ac - pl; }
    else if (pl > 0 && frac > 0 && ac / frac > pl * 1.02) projOver++;
  });

  if (cap <= 0 && over === 0 && projOver === 0) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");

  const capDiff = cap > 0 ? projected - cap : 0;
  const projTone = capDiff > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  el.innerHTML = `
    <div class="rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      ${cap > 0 ? `<div class="flex items-baseline gap-1.5">
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Projected month-end</span>
        <span class="font-extrabold text-slate-900 dark:text-white">${fmt(projected)}</span>
        <span class="text-[11px] font-bold ${projTone}">${capDiff > 0 ? `▲ ${fmt(capDiff)} over` : `▼ ${fmt(Math.abs(capDiff))} under`} ${fmt(cap)} cap</span>
      </div>` : ""}
      ${over > 0 ? `<div class="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold"><span class="material-symbols-outlined text-[15px]">warning</span>${over} over budget · ${fmt(overAmt)} overspent</div>` : ""}
      ${projOver > 0 ? `<div class="text-amber-600 dark:text-amber-400 font-semibold">${projOver} on track to exceed</div>` : ""}
      ${over === 0 && projOver === 0 && cap > 0 ? `<div class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold"><span class="material-symbols-outlined text-[15px]">check_circle</span>All categories within budget</div>` : ""}
    </div>`;
}

// ── Untracked spend section ───────────────────────────────────────────────────
function renderUntrackedSection(buckets, budgetedItems) {
  const el = document.getElementById("untrackedSection");
  if (!el) return;

  const budgetedNames = new Set((budgetedItems||[]).map(i => i.tag_name.toLowerCase()));
  const untracked = (buckets||[]).filter(b => !budgetedNames.has(b.name.toLowerCase()) && Number(b.amount||0) > 0);

  if (!untracked.length) { el.classList.add("hidden"); el.innerHTML = ""; return; }

  const isUncategorized = name => name.toLowerCase() === "uncategorized";

  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="border-t-2 border-dashed border-slate-200 mx-5 mt-1"></div>
    <div class="px-5 py-3">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Also Spent On</p>
        <span class="text-[10px] text-slate-400">No budget set · click + to track</span>
      </div>
      <div class="space-y-1.5">
        ${untracked.map(b => {
          const unc = isUncategorized(b.name);
          return `
          <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 ${unc ? "bg-amber-50" : "bg-slate-50"} hover:bg-slate-100 transition-colors">
            <div class="flex-1 min-w-0 flex items-center gap-2">
              ${unc ? `<span class="material-symbols-outlined text-[14px] text-amber-400 shrink-0">warning</span>` : `<span class="w-2 h-2 rounded-full bg-slate-300 shrink-0"></span>`}
              <span class="text-sm ${unc ? "text-amber-700" : "text-slate-700"} truncate">${escH(b.name)}</span>
              ${unc ? `<span class="text-[9px] text-amber-500 shrink-0">needs tagging</span>` : ""}
            </div>
            <span class="text-sm font-semibold ${unc ? "text-amber-700" : "text-slate-700"} shrink-0">${fmt(b.amount)}</span>
            ${!unc ? `<button onclick="startAddCatPreset('${escH(b.name)}')"
              class="shrink-0 flex items-center gap-0.5 rounded-full border border-primary/30 bg-white px-2 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/5 transition-colors">
              <span class="material-symbols-outlined text-[11px]">add</span> Budget
            </button>` : `<a href="/" class="shrink-0 text-[10px] font-semibold text-amber-500 hover:underline">Tag now →</a>`}
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

function startAddCatPreset(name) {
  _addParentContext = null;
  document.getElementById("addCatParentCtx")?.classList.add("hidden");
  const form = document.getElementById("addCatForm");
  const btn  = document.getElementById("addCatBtn");
  if (form) form.classList.remove("hidden");
  if (btn)  btn.classList.add("hidden");
  rebuildTagSelect(name);
  document.getElementById("catAmountInput")?.focus();
}

function toggleSubBudgets(subId, btn) {
  const el = document.getElementById(subId);
  if (!el) return;
  const isNowHidden = el.classList.toggle("hidden");
  const chevron = btn?.querySelector(".sub-chevron");
  if (chevron) chevron.style.transform = isNowHidden ? "" : "rotate(90deg)";
}

function openAddSubBudget(parentTagName) {
  _addParentContext = parentTagName;
  const form = document.getElementById("addCatForm");
  const btn  = document.getElementById("addCatBtn");
  if (form) form.classList.remove("hidden");
  if (btn)  btn.classList.add("hidden");
  const ctx = document.getElementById("addCatParentCtx");
  if (ctx) { ctx.textContent = `Sub-budget of: ${parentTagName}`; ctx.classList.remove("hidden"); }
  rebuildTagSelect();
  document.getElementById("catAmountInput")?.focus();
}

// ── Shared Joy per-category map (tag_name.lower() -> shared_joy_amount) ───────
let _sharedJoyByCategoryMap = {};

// ── Chart (one bar per category) ─────────────────────────────────────────────
function renderChart(items) {
  const el = document.getElementById("chartList");
  if (!el || !items.length) return;

  el.innerHTML = items.map((item, idx) => {
    const planned  = Number(item.budget_amount || 0);
    const actual   = Number(item.spent || 0);
    const joyAmt   = _sharedJoyByCategoryMap[item.tag_name?.toLowerCase()] || 0;
    const personal = Math.max(0, actual - joyAmt);
    const isOver   = actual > planned && planned > 0;
    const pct      = planned > 0 ? Math.min(Math.round(actual / planned * 100), 100) : 0;
    const color    = _catColor(item.tag_name);
    const barColor = isOver ? "#ef4444" : color;

    // Within the bar: personal portion + shared joy portion stacked
    const personalPct = planned > 0 ? Math.min(Math.round(personal / planned * 100), 100) : 0;
    const joyPct      = planned > 0 ? Math.min(Math.round(joyAmt   / planned * 100), Math.max(0, 100 - personalPct)) : 0;

    const statusCls = isOver
      ? "text-rose-500 dark:text-rose-400 font-bold"
      : pct >= 80
        ? "text-amber-500 dark:text-amber-400 font-semibold"
        : "text-slate-400 dark:text-slate-500";

    return `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">${escH(item.tag_name)}</span>
          <div class="flex items-center gap-1.5 shrink-0 ml-2">
            ${joyAmt > 0 ? `<span class="text-[10px] text-purple-500 dark:text-purple-400">✨${fmt(joyAmt)}</span>` : ""}
            <span class="text-[11px] ${statusCls}">${fmt(actual)}${planned > 0 ? ` / ${fmt(planned)}` : ""}</span>
          </div>
        </div>
        <div class="relative h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700/60 overflow-hidden">
          ${planned > 0 ? `
            <div class="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
              style="width:${personalPct}%;background:${barColor}"></div>
            ${joyPct > 0 ? `<div class="absolute top-0 h-full rounded-r-full transition-all duration-500"
              style="left:${personalPct}%;width:${joyPct}%;background:#a855f7;opacity:0.7"></div>` : ""}
          ` : `
            <div class="absolute top-0 left-0 h-full rounded-full bg-slate-300 dark:bg-slate-600" style="width:100%"></div>
          `}
        </div>
      </div>`;
  }).join("");

}

// ── Tag dropdown ──────────────────────────────────────────────────────────────
async function loadTags() {
  const res  = await fetch("/planning/tags");
  const data = (await res.json()).data || [];
  allTags    = data;
  rebuildTagSelect();
}

function rebuildTagSelect(preselectName) {
  const selectEl = document.getElementById("catTagSelect");
  if (!selectEl) return;
  const groups = { CATEGORY:[], SUBCATEGORY:[], category:[], OTHER:[] };
  allTags.forEach(t => {
    const k = t.tag_type==="CATEGORY" ? "CATEGORY"
            : t.tag_type==="SUBCATEGORY" ? "SUBCATEGORY"
            : t.tag_type==="category" ? "category" : "OTHER";
    groups[k].push(t);
  });
  const labels = { CATEGORY:"Categories", SUBCATEGORY:"Subcategories", category:"Your tags", OTHER:"Other" };
  let html = `<option value="">Select a category…</option>`;
  for (const [k, items] of Object.entries(groups)) {
    if (!items.length) continue;
    html += `<optgroup label="${labels[k]}">`;
    items.forEach(t => {
      const isSelected = preselectName && t.name.toLowerCase()===preselectName.toLowerCase() ? " selected" : "";
      html += `<option value="${escH(t.name)}" data-parent="${escH(t.parent_id||"")}"${isSelected}>${escH(t.name)}</option>`;
    });
    html += `</optgroup>`;
  }
  selectEl.innerHTML = html;
}

// ── Category CRUD ─────────────────────────────────────────────────────────────
async function postCat(tagName, parentName, amount) {
  if (isHistoricalBudgetView) return {success:false, error:"Previous month budgets are view-only."};
  const res = await fetch("/planning/category-budgets", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ month_start: currentMonthStart, tag_name: tagName, parent_name: parentName||null, budget_amount: amount }),
  });
  return await res.json();
}

function startEditCat(id, current) {
  if (isHistoricalBudgetView) return;
  const panel = document.getElementById(`catedit-${id}`);
  const input = document.getElementById(`catEditInput-${id}`);
  if (!panel||!input) return;
  panel.classList.remove("hidden"); input.value = current; input.focus();
  document.getElementById(`catrow-${id}`)?.classList.add("is-editing");
}
function cancelEditCat(id) {
  document.getElementById(`catedit-${id}`)?.classList.add("hidden");
  document.getElementById(`catrow-${id}`)?.classList.remove("is-editing");
}
async function saveEditCat(id, tagName, parentName) {
  if (isHistoricalBudgetView) return;
  const input = document.getElementById(`catEditInput-${id}`);
  const errEl = document.getElementById(`catEditErr-${id}`);
  const amount = parseFloat(input?.value||"0");
  if (isNaN(amount)||amount<0) return;
  const result = await postCat(tagName, parentName, amount);
  if (!result.success) {
    if (errEl) { errEl.textContent = result.error||"Save failed"; errEl.classList.remove("hidden"); }
    return;
  }
  await loadCategoryBudgets();
}
async function removeCatBudget(id) {
  if (!id || isHistoricalBudgetView) return;
  const choice = await budgetChoiceDialog({
    title: "Remove category?",
    message: "This removes the category from the active month plan.",
    yesLabel: "Yes, remove",
    noLabel: "No",
    cancelLabel: "Cancel",
  });
  if (choice !== "yes") return;
  await fetch(`/planning/category-budgets/${id}`, {method:"DELETE"});
  await loadCategoryBudgets();
}

async function loadCategoryBudgets() {
  if (!currentMonthStart) return;
  const res     = await fetch(categoryBudgetUrl());
  const catData = (await res.json()).data || {};
  const totalActual = renderPlanTable(catData.items||[]) || 0;
  renderSummary(currentBudget, currentBudget._cm||{});
  const _cap2     = Number(currentBudget.effective_budget || currentBudget.budget_amount || 0);
  const _cat2     = Number(catData.total_allocated || 0);
  const _carry2   = Number(currentBudget.carry_forward || 0);
  const _gaugeAmt2 = _cap2 > 0 ? _cap2 : _cat2;
  const _src2      = _cap2 > 0
    ? (!isHistoricalBudgetView && _carry2 > 0 ? `incl. ${fmt(_carry2)} saved` : "spend limit")
    : "cat. total";
  const _totalSpentAll = Number(currentBudget._cm?.spent_so_far || 0);
  renderGauge(_totalSpentAll, _gaugeAmt2, _src2);

  // Hint below gauge: show how much of total spend is tracked vs unbudgeted
  const _hintEl = document.getElementById("gaugeSpentHint");
  if (_hintEl) {
    const _unbudgeted = _totalSpentAll - totalActual;
    if (_unbudgeted > 0.5 && totalActual > 0) {
      _hintEl.textContent = `${fmt(totalActual)} tracked · ${fmt(_unbudgeted)} unbudgeted`;
      _hintEl.classList.remove("hidden");
    } else {
      _hintEl.classList.add("hidden");
    }
  }

  return catData;
}

function bindCategoryForm() {
  const addBtn    = document.getElementById("addCatBtn");
  const form      = document.getElementById("addCatForm");
  const saveBtn   = document.getElementById("saveCatBtn");
  const cancelBtn = document.getElementById("cancelCatBtn");
  const errEl     = document.getElementById("catFormError");

  addBtn?.addEventListener("click", () => {
    if (isHistoricalBudgetView) return;
    _addParentContext = null;
    document.getElementById("addCatParentCtx")?.classList.add("hidden");
    form?.classList.toggle("hidden");
  });
  cancelBtn?.addEventListener("click", () => {
    _addParentContext = null;
    document.getElementById("addCatParentCtx")?.classList.add("hidden");
    form?.classList.add("hidden");
    if (errEl) { errEl.textContent=""; errEl.classList.add("hidden"); }
  });
  saveBtn?.addEventListener("click", async () => {
    if (isHistoricalBudgetView) return;
    const sel    = document.getElementById("catTagSelect");
    const amt    = document.getElementById("catAmountInput");
    const name   = sel?.value||"";
    const amount = parseFloat(amt?.value||"0");
    if (!name)             { if(errEl){errEl.textContent="Select a category."; errEl.classList.remove("hidden");} return; }
    if (!amount||amount<=0){ if(errEl){errEl.textContent="Enter an amount.";   errEl.classList.remove("hidden");} return; }
    if (errEl) errEl.classList.add("hidden");
    const result = await postCat(name, _addParentContext, amount);
    if (!result.success) { if(errEl){errEl.textContent=result.error||"Save failed."; errEl.classList.remove("hidden");} return; }
    _addParentContext = null;
    document.getElementById("addCatParentCtx")?.classList.add("hidden");
    form?.classList.add("hidden");
    if (amt) amt.value = "";
    await loadCategoryBudgets();
  });
}

// ── Inline create tag ─────────────────────────────────────────────────────────
function bindCreateTagPanel() {
  const toggleBtn = document.getElementById("createTagToggleBtn");
  const panel     = document.getElementById("createTagPanel");
  const saveBtn   = document.getElementById("saveNewTagBtn");
  const statusEl  = document.getElementById("createTagStatus");

  toggleBtn?.addEventListener("click", () => {
    panel?.classList.toggle("hidden");
    if (!panel?.classList.contains("hidden")) document.getElementById("newTagName")?.focus();
  });
  saveBtn?.addEventListener("click", async () => {
    const name = (document.getElementById("newTagName")?.value||"").trim();
    if (!name) { if(statusEl){statusEl.textContent="Enter a name."; statusEl.className="text-xs font-semibold text-rose-600"; statusEl.classList.remove("hidden");} return; }
    if(saveBtn){saveBtn.disabled=true; saveBtn.textContent="Creating…";}
    try {
      const res = await fetch("/classification/api/categories", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({name, description:""}),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message||"Failed");
      if(statusEl){statusEl.textContent=`✓ "${name}" created`; statusEl.className="text-xs font-semibold text-emerald-600"; statusEl.classList.remove("hidden");}
      document.getElementById("newTagName").value = "";
      await loadTags();
      rebuildTagSelect(name);
      setTimeout(()=>{ panel?.classList.add("hidden"); if(statusEl) statusEl.classList.add("hidden"); }, 1200);
    } catch(err) {
      if(statusEl){statusEl.textContent=err.message||"Error"; statusEl.className="text-xs font-semibold text-rose-600"; statusEl.classList.remove("hidden");}
    } finally {
      if(saveBtn){saveBtn.disabled=false; saveBtn.textContent="Create";}
    }
  });
}

// ── Sync plan setup form with current saved budget ───────────────────────────
function _syncPlanSetupForm(budget) {
  const form = document.getElementById("budgetForm");
  if (!form) return;
  const hasPlan = budget && (Number(budget.expected_income||0) > 0 || Number(budget.budget_amount||0) > 0);

  // Pre-fill inputs with current saved values
  const incInput = form.querySelector('[name="expected_income"]');
  const limInput = form.querySelector('[name="budget_amount"]');
  const monInput = form.querySelector('[name="month_start"]');
  if (incInput) incInput.value = budget.expected_income > 0 ? budget.expected_income : "";
  if (limInput) limInput.value = budget.budget_amount   > 0 ? budget.budget_amount   : "";
  if (monInput) monInput.value = budget.month_start     || "";

  // Update button label
  const btn = document.getElementById("planSubmitBtn");
  if (btn) btn.textContent = hasPlan ? "Update plan" : "Save plan";

  // Show/hide "currently saved" info
  const infoPanel = document.getElementById("planCurrentInfo");
  const badge     = document.getElementById("planSetupBadge");
  if (hasPlan) {
    if (infoPanel) {
      infoPanel.classList.remove("hidden");
      setText("planCurrentIncome", budget.expected_income > 0 ? fmt(budget.expected_income) + "/mo" : "Not set");
      setText("planCurrentLimit",  budget.budget_amount   > 0 ? fmt(budget.budget_amount)           : "No cap");

      const carry   = Number(budget.carry_forward    || 0);
      const effBudg = Number(budget.effective_budget || 0);
      const carryEl = document.getElementById("planCarryForward");
      const effEl   = document.getElementById("planEffectiveBudget");

      const hintEl = document.getElementById("carryHint");
      if (isHistoricalBudgetView) {
        carryEl?.closest(".carry-row")?.classList.add("hidden");
        effEl?.closest(".eff-row")?.classList.add("hidden");
        hintEl?.classList.add("hidden");
      } else if (carry > 0) {
        if (carryEl) carryEl.textContent = `+${fmt(carry)} saved`;
        carryEl?.closest(".carry-row")?.classList.remove("hidden");
        if (effEl) effEl.textContent = fmt(effBudg);
        effEl?.closest(".eff-row")?.classList.remove("hidden");
        if (hintEl) hintEl.classList.add("hidden");
      } else {
        carryEl?.closest(".carry-row")?.classList.add("hidden");
        effEl?.closest(".eff-row")?.classList.add("hidden");
        if (hintEl && Number(budget.budget_amount || 0) > 0) {
          hintEl.textContent = `Spend under ${fmt(budget.budget_amount)} this month to keep room in the plan.`;
          hintEl.classList.remove("hidden");
        } else if (hintEl) {
          hintEl.classList.add("hidden");
        }
      }
    }
    if (badge) badge.classList.remove("hidden");
  } else {
    infoPanel?.classList.add("hidden");
    badge?.classList.add("hidden");
  }
  syncBudgetMonthControls();
}

// ── Plan form (salary + month) ────────────────────────────────────────────────
function bindPlanForm() {
  const form = document.getElementById("budgetForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isHistoricalBudgetView) return;
    const payload = {};
    new FormData(form).forEach((v,k) => {
      const s = String(v||"").trim(); if (!s) return;
      payload[k] = ["budget_amount","expected_income"].includes(k) ? Number(s) : s;
    });
    const btn = document.getElementById("planSubmitBtn");
    if (btn) { btn.disabled=true; btn.textContent="Saving…"; }
    try {
      const res = await fetch("/planning/monthly_budget",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result = await res.json();
      if (!result.success) throw new Error(result.message||"Save failed");
      setText("formStatus","✓ Saved");
      setTimeout(() => setText("formStatus",""), 2500);
      await loadBudget();
    } catch(err) { setText("formStatus", err.message||"Error"); }
    finally { if(btn) btn.disabled=false; }
  });
}

function bindStartNewMonth() {
  const btn = document.getElementById("startNewMonthBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const targetMonth = nextMonthStart(currentMonthStart);
    const targetLabel = monthName(targetMonth);
    const choice = await budgetChoiceDialog({
      title: `Start ${targetLabel} budget?`,
      message: "Your saved salary, spend limit, category budgets, planned expenses, and Shared Joy plan will be copied. Actual expenses will reset to the new active month.",
      yesLabel: "Yes, start",
      noLabel: "No",
      cancelLabel: "Cancel",
    });
    if (choice !== "yes") return;

    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-[16px]">hourglass_top</span> Moving...`;
    try {
      const res = await fetch("/planning/start-new-month", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({target_month_start: targetMonth}),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || "Could not start new month");
      window.toast?.success(`Budget moved to ${monthName(result.data?.active_month_start || targetMonth)}`);
      await loadBudget();
    } catch (err) {
      window.toast?.error(err.message || "Could not start new month");
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  });
}

// ── Main load ─────────────────────────────────────────────────────────────────
function bindBudgetMonthPicker() {
  const picker = document.getElementById("budgetViewMonth");
  const currentBtn = document.getElementById("budgetCurrentMonthBtn");
  picker?.addEventListener("change", async () => {
    const selected = picker.value ? `${picker.value}-01` : "";
    if (!selected) return;
    await loadBudget(selected);
  });
  currentBtn?.addEventListener("click", async () => {
    await loadBudget();
  });
}

function renderCloseMonthDetails(data) {
  const rows = Array.isArray(data.statement_status) ? data.statement_status : [];
  const difference = Number(data.carry_forward_amount || 0);
  const diffTone = difference < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300";
  const statusRows = rows.length
    ? rows.map(row => `
        <div class="flex items-center justify-between gap-3 border-t border-slate-200/70 py-2 first:border-t-0 dark:border-slate-700/70">
          <div class="min-w-0">
            <p class="font-bold text-slate-800 dark:text-slate-100">${escH(row.source_name || "Unknown")}</p>
            <p class="text-[11px] text-slate-400">Latest: ${escH(row.latest_transaction_date || "No statement")} - Txns: ${Number(row.transactions_in_month || 0)}</p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${row.is_ready ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"}">
            ${row.is_ready ? "Ready" : "Check"}
          </span>
        </div>`).join("")
    : `<p class="text-xs text-amber-600 dark:text-amber-300">No bank statement sources found.</p>`;
  return `
    <div class="grid grid-cols-3 gap-2">
      <div class="rounded-lg bg-white p-2 dark:bg-slate-900/80">
        <p class="text-[10px] uppercase tracking-wide text-slate-400">Budget</p>
        <p class="text-sm font-black">${fmt(data.budget_amount || 0)}</p>
      </div>
      <div class="rounded-lg bg-white p-2 dark:bg-slate-900/80">
        <p class="text-[10px] uppercase tracking-wide text-slate-400">Actual</p>
        <p class="text-sm font-black">${fmt(data.actual_spent || 0)}</p>
      </div>
      <div class="rounded-lg bg-white p-2 dark:bg-slate-900/80">
        <p class="text-[10px] uppercase tracking-wide text-slate-400">Difference</p>
        <p class="text-sm font-black ${diffTone}">${difference < 0 ? "-" : ""}${fmt(Math.abs(difference))}</p>
      </div>
    </div>
    <div class="mt-3 rounded-lg bg-white px-3 py-1 dark:bg-slate-900/80">${statusRows}</div>
  `;
}

function bindClosePreviousMonth() {
  const btn = document.getElementById("closePreviousMonthBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-[16px]">hourglass_top</span> Checking...`;
    try {
      const previewRes = await fetch("/planning/month-close-preview");
      const previewResult = await previewRes.json();
      if (!previewRes.ok || !previewResult.success) throw new Error(previewResult.message || "Could not check month");
      const data = previewResult.data || {};
      if (data.already_closed) {
        window.toast?.info?.(`${monthName(data.month_start)} is already closed.`);
        return;
      }
      const ready = Boolean(data.statements_ready);
      const monthLabel = monthName(data.month_start);
      const difference = Number(data.carry_forward_amount || 0);
      const choice = await budgetChoiceDialog({
        title: `Close ${monthLabel}?`,
        message: ready
          ? `Statements look ready. ${difference < 0 ? "Exceeded amount" : "Remaining amount"} will be applied to the active budget.`
          : "Some sources do not yet look complete for this month. You can wait, cancel, or close anyway if you know statements are final.",
        details: renderCloseMonthDetails(data),
        yesLabel: ready ? "Yes, close" : "Close anyway",
        noLabel: "No, wait",
        cancelLabel: "Cancel",
        tone: ready ? "primary" : "danger",
      });
      if (choice !== "yes") return;

      const res = await fetch("/planning/close-month", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({month_start: data.month_start, force: !ready}),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || "Could not close month");
      const closed = result.data || {};
      window.toast?.success(`${monthName(closed.month_start)} closed. Difference: ${fmt(closed.carry_forward_amount || 0)}`);
      await loadBudget();
    } catch (err) {
      window.toast?.error(err.message || "Could not close month");
    } finally {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  });
}

async function loadBudget(monthStart = null) {
  try {
    const requestedMonth = normalizeMonthStart(monthStart);
    const shouldUseMonthView = Boolean(requestedMonth && requestedMonth !== activeBudgetMonthStart);
    const url = shouldUseMonthView
      ? `/planning/month-view?month_start=${requestedMonth}`
      : "/planning/summary";
    const res   = await fetch(url);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data  = (await res.json()).data || {};
    const budget = data.budget        || {};
    const cm     = data.current_month || {};
    const view   = data.view          || {};

    const ms = cm.month_start;
    currentMonthStart = normalizeMonthStart(ms) || new Date().toISOString().slice(0,7)+"-01";
    activeBudgetMonthStart = normalizeMonthStart(view.active_month_start || activeBudgetMonthStart || currentMonthStart);
    isHistoricalBudgetView = Boolean(view.is_historical || (activeBudgetMonthStart && currentMonthStart !== activeBudgetMonthStart));
    budget._cm = cm;
    currentBudget = budget;

    const catRes  = await fetch(categoryBudgetUrl());
    if (!catRes.ok) throw new Error(`Category API error ${catRes.status}`);
    const catData = (await catRes.json()).data || {};

    renderSummary(budget, cm);
    renderPlanTable(catData.items||[]);
    renderUntrackedSection(budget.top_spend_buckets||[], catData.items||[]);
    const _spendCap  = Number(budget.effective_budget || budget.budget_amount || 0);
    const _catTotal  = Number(catData.total_allocated || 0);
    const _carryFwd  = Number(budget.carry_forward    || 0);
    const _gaugeAmt  = _spendCap > 0 ? _spendCap : _catTotal;
    const _gaugeSrc  = _spendCap > 0
      ? (!isHistoricalBudgetView && _carryFwd > 0 ? `incl. ${fmt(_carryFwd)} saved` : "spend limit")
      : "cat. total";
    renderGauge(Number(cm.spent_so_far || 0), _gaugeAmt, _gaugeSrc);
    _syncPlanSetupForm(budget);
    loadPlannedForMonth();
    loadSharedJoyData();
  } catch(err) {
    const badge = document.getElementById("paceBadge");
    if (badge) { badge.textContent = "⚠ Load error"; badge.className = "inline-flex rounded-full px-3 py-1.5 text-xs font-bold bg-rose-100 text-rose-700"; }
    console.error("loadBudget failed:", err);
  }
}

let _plannedForMonthMap   = {}; // category.lower() -> planned amount for current month
let _plannedForMonthItems = []; // all planned+wishlist items for current month


async function loadPlannedForMonth() {
  if (!currentMonthStart) return;
  try {
    const res   = await fetch(`/planning/planned-for-month?month_start=${currentMonthStart}`);
    const items = (await res.json()).data || [];

    const totalPlanned  = items.filter(i => i.item_type === "planned" ).reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalWishlist = items.filter(i => i.item_type === "wishlist").reduce((s, i) => s + Number(i.amount || 0), 0);
    const total = totalPlanned + totalWishlist;

    const el     = document.getElementById("gaugeUpcoming");
    const amtEl  = document.getElementById("gaugeUpcomingAmt");
    const listEl = document.getElementById("gaugeUpcomingList");
    if (el && amtEl && listEl) {
      if (total > 0) {
        el.classList.remove("hidden");
        amtEl.textContent = fmt(total);

        const now = new Date();
        listEl.innerHTML = items.map(item => {
          const amt    = Number(item.amount || 0);
          const dd     = item.due_date ? new Date(item.due_date + "T00:00:00") : null;
          const overdue = dd && dd < now;
          const days   = dd ? Math.ceil((dd - now) / 86400000) : null;

          const daysLabel = days === null ? "" :
            days < 0  ? `<span class="text-red-800 dark:text-red-100 font-bold">Overdue ${Math.abs(days)}d</span>` :
            days === 0 ? `<span class="text-amber-700 dark:text-amber-200 font-bold">Today</span>` :
            days <= 7  ? `<span class="text-amber-500 dark:text-amber-400 font-semibold">${days}d left</span>` :
                         "";

          const typeBadge = item.item_type === "planned"
            ? `<span class="rounded-full bg-sky-100 dark:bg-sky-900/30 px-1.5 py-0.5 text-[8px] font-bold text-sky-600 dark:text-sky-400">planned</span>`
            : `<span class="rounded-full bg-violet-100 dark:bg-violet-900/30 px-1.5 py-0.5 text-[8px] font-bold text-violet-600 dark:text-violet-400">wishlist</span>`;

          const dueToday = days === 0;
          // Distinct, attention-grabbing palette for overdue vs due-today:
          //  • OVERDUE  → bold red-600 — strongly saturated, sits clearly above the gauge card
          //  • DUE TODAY → soft amber — warm warning, distinct from overdue red
          //  • normal   → neutral slate row
          // Inline styles bake in exact RGBAs so global dark-mode rules can't dilute them.
          const isDark = document.documentElement.classList.contains("dark");
          const rowStyle = overdue
            ? `background:${isDark ? "rgba(220,38,38,0.32)" : "#fecaca"};border:1px solid ${isDark ? "#dc2626" : "#dc2626"};box-shadow:0 0 0 2px ${isDark ? "rgba(220,38,38,0.18)" : "rgba(220,38,38,0.12)"};`
            : dueToday
              ? `background:${isDark ? "rgba(245,158,11,0.22)" : "rgba(254,243,199,0.7)"};border:1px solid ${isDark ? "rgba(245,158,11,0.55)" : "#fcd34d"};`
              : "";
          const rowCls = overdue || dueToday
            ? "rounded-lg px-2.5 py-1.5 gauge-due-blink"
            : "rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50/40 dark:bg-slate-800/20 px-2.5 py-1.5";

          const titleCls = overdue
            ? "text-[11px] font-bold text-red-800 dark:text-red-100 truncate"
            : dueToday
              ? "text-[11px] font-semibold text-amber-800 dark:text-amber-200 truncate"
              : "text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate";

          const amtCls = overdue
            ? "text-[11px] font-black text-red-800 dark:text-red-100 shrink-0"
            : dueToday
              ? "text-[11px] font-black text-amber-700 dark:text-amber-200 shrink-0"
              : "text-[11px] font-black text-slate-900 dark:text-slate-100 shrink-0";

          const doneBtn = item.item_type === "planned"
            ? `<button onclick="markUpcomingDone('${item.id}','planned')" title="Mark done"
                 class="shrink-0 rounded-full p-0.5 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                 <span class="material-symbols-outlined text-[14px]">check_circle</span>
               </button>`
            : `<button onclick="markUpcomingDone('${item.id}','wishlist')" title="Mark bought"
                 class="shrink-0 rounded-full p-0.5 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                 <span class="material-symbols-outlined text-[14px]">check_circle</span>
               </button>`;

          return `
            <div class="${rowCls}" style="${rowStyle}">
              <div class="flex items-center justify-between gap-1.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1 flex-wrap">
                    <p class="${titleCls}">${escH(item.title)}</p>
                    ${typeBadge}
                  </div>
                  <div class="mt-0.5 flex items-center gap-1 text-[10px]">
                    ${dd ? `<span class="text-slate-400 dark:text-slate-500">${dd.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</span>` : ""}
                    ${daysLabel ? `<span class="text-slate-300 dark:text-slate-600 mx-0.5">·</span>${daysLabel}` : ""}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <p class="${amtCls}">${fmt(amt)}</p>
                  ${doneBtn}
                </div>
              </div>
            </div>`;
        }).join("");
      } else {
        el.classList.add("hidden");
      }
    }

    // Build category → planned amount map (planned expenses only — wishlist has no category)
    _plannedForMonthMap = {};
    items.filter(i => i.item_type === "planned" && i.category).forEach(i => {
      const k = i.category.toLowerCase();
      _plannedForMonthMap[k] = (_plannedForMonthMap[k] || 0) + Number(i.amount || 0);
    });
    _plannedForMonthItems = items;

    // Re-render category table (await so its renderGauge runs before we re-assert goals arc)
    await loadCategoryBudgets();

    // After loadCategoryBudgets may have hidden the gauge card (no budget case),
    // re-show it and re-draw arcs as the final step
    if (total > 0) {
      const card = document.getElementById("budgetGaugeCard");
      if (card && card.classList.contains("hidden")) {
        card.classList.remove("hidden");
        if (!_gaugeBudgetTotal) {
          _gaugeBudgetTotal = total;
          setText("gaugePct", "—");
          setText("gaugeLabel", "Goals only");
          const isDark = document.documentElement.classList.contains("dark");
          document.getElementById("gaugeBg")?.setAttribute("stroke", isDark ? "#334155" : "#e2e8f0");
          document.getElementById("gaugeArc")?.setAttribute("stroke-dasharray", `0 ${251.33}`);
        }
      }
      renderGoalsArc(totalPlanned, totalWishlist);
    } else {
      // Still update Shared Joy arc even when no planned/wishlist items
      renderGoalsArc(0, 0);
    }
  } catch(err) { console.error("loadPlannedForMonth:", err); }
}

async function markUpcomingDone(id, itemType) {
  try {
    if (itemType === "planned") {
      const res = await fetch(`/planning/planned_expenses/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const r = await res.json();
      if (!r.success) throw new Error(r.message || "Failed");
    } else {
      await fetch(`/planning/wishlist/${id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
    }
    window.toast?.success(itemType === "planned" ? "Marked as done!" : "Marked as bought!");
    await loadPlannedForMonth();
  } catch(err) { window.toast?.error(err.message || "Failed"); }
}

// ── Shared Joy ────────────────────────────────────────────────────────────────
let _sharedJoyData = null;

async function loadSharedJoyData() {
  if (!currentMonthStart) return;
  try {
    const res  = await fetch(`/planning/shared-joy-budget?month_start=${currentMonthStart}`);
    const data = (await res.json()).data || null;
    _sharedJoyData = data;

    // Update per-category map for chart overlay
    _sharedJoyByCategoryMap = {};
    (data?.by_category || []).forEach(c => {
      _sharedJoyByCategoryMap[c.tag_name.toLowerCase()] = Number(c.shared_joy_amount || 0);
    });

    // Update gauge Shared Joy amount and re-draw arcs
    _sharedJoyGaugeAmount = Number(data?.spent || 0);

    renderSharedJoyCard(data);

    // Yearly (Jan–Dec) roll-up
    try {
      const yr = new Date(currentMonthStart + "T00:00:00").getFullYear() || new Date().getFullYear();
      const yres = await fetch(`/planning/shared-joy-year?year=${yr}`);
      renderSharedJoyYear((await yres.json()).data || null);
    } catch (e) { renderSharedJoyYear(null); }

    // Refresh deduction rows and chart overlay with updated joy data
    await loadCategoryBudgets();
  } catch(err) {
    console.warn("loadSharedJoyData failed:", err);
    renderSharedJoyCard(null);
  }
}

const _SJ_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function renderSharedJoyYear(y) {
  const el = document.getElementById("sharedJoyYear");
  if (!el) return;
  if (!y || (Number(y.annual_target || 0) <= 0 && Number(y.annual_spent || 0) <= 0)) {
    el.classList.add("hidden"); el.innerHTML = ""; return;
  }
  el.classList.remove("hidden");

  const target = Number(y.annual_target || 0);
  const spent  = Number(y.annual_spent || 0);
  const pct    = target > 0 ? Math.min(Math.round((spent / target) * 100), 100) : 0;
  const shortfall = Number(y.shortfall || 0);

  // 12-month bars: emerald=met, purple=partial, slate=none; current month ringed.
  const strip = (y.months || []).map((m) => {
    const isCur = m.month === y.current_month;
    let bg = "bg-slate-200 dark:bg-slate-700";
    if (m.goal > 0 && m.achieved) bg = "bg-emerald-400";
    else if (m.spent > 0) bg = "bg-purple-400";
    const h = m.goal > 0 ? Math.max(8, Math.min(100, Math.round(m.pct))) : (m.spent > 0 ? 45 : 8);
    const tip = `${_SJ_MONTHS[m.month - 1]}: ${fmt(m.spent)}${m.goal > 0 ? ` / ${fmt(m.goal)}` : ""}`;
    return `<div class="flex flex-col items-center gap-0.5" title="${tip}">
      <div class="flex h-9 w-full items-end"><div class="w-full rounded-sm ${bg} ${isCur ? "ring-2 ring-purple-500" : ""}" style="height:${h}%"></div></div>
      <span class="text-[8px] ${isCur ? "font-black text-purple-600 dark:text-purple-400" : "text-slate-400"}">${_SJ_MONTHS[m.month - 1][0]}</span>
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="mt-3 pt-3 border-t border-purple-100 dark:border-purple-900/30">
      <div class="flex items-center justify-between mb-1">
        <p class="text-[10px] font-bold uppercase tracking-wider text-purple-500">This year (${y.year}) · ${y.achieved_months}/12 months met</p>
        <p class="text-[11px] font-bold text-purple-600 dark:text-purple-400">${fmt(spent)}${target > 0 ? ` of ${fmt(target)} · ${pct}%` : ""}</p>
      </div>
      ${target > 0 ? `<div class="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-2">
        <div class="h-full rounded-full bg-purple-500 transition-all duration-700" style="width:${pct}%"></div>
      </div>` : ""}
      <div class="grid grid-cols-12 gap-1 mb-2">${strip}</div>
      <div class="grid grid-cols-3 gap-1.5 text-center">
        <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-1 py-1.5">
          <p class="text-[8px] text-slate-400 uppercase tracking-wider">This month</p>
          <p class="text-xs font-black text-purple-500 dark:text-purple-400 mt-0.5">${fmt(y.current_month_spent)}</p>
        </div>
        <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-1 py-1.5">
          <p class="text-[8px] text-slate-400 uppercase tracking-wider">Year given</p>
          <p class="text-xs font-black text-purple-500 dark:text-purple-400 mt-0.5">${fmt(spent)}</p>
        </div>
        <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-1 py-1.5">
          <p class="text-[8px] text-slate-400 uppercase tracking-wider">${shortfall > 0 ? "To donate" : "Surplus"}</p>
          <p class="text-xs font-black ${shortfall > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} mt-0.5">${fmt(shortfall > 0 ? shortfall : Math.max(0, spent - target))}</p>
        </div>
      </div>
      ${shortfall > 0 && target > 0 ? `<p class="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">If the year ends short, donate ${fmt(shortfall)} to meet your ${fmt(target)} pledge.</p>` : ""}
    </div>`;
}

function renderSharedJoyCard(data) {
  const statsEl = document.getElementById("sharedJoyStats");
  if (!statsEl) return;

  const spent    = Number(data?.spent || 0);
  const goal     = Number(data?.effective_goal || data?.goal_amount || 0);
  const carry    = Number(data?.carry_forward || 0);
  const achieved = data?.achieved || false;
  const reward   = data?.reward_note || null;
  const pct      = goal > 0 ? Math.min(Math.round((spent / goal) * 100), 100) : 0;
  const remaining = Number(data?.remaining || 0);

  if (goal <= 0 && spent <= 0) {
    statsEl.innerHTML = `
      <p class="text-xs text-slate-400 text-center py-1">No giving tracked yet this month.</p>
      <p class="text-[10px] text-slate-400 text-center">Tag transactions as ✨ Shared Joy in the reports page to start tracking.</p>`;
    return;
  }

  const barColor = achieved ? "#10b981" : "#a855f7"; // purple progress, emerald on achieved
  const barOpacity = achieved ? "1" : "0.75";

  statsEl.innerHTML = `
    ${achieved && reward ? `
    <div class="rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 mb-2 flex items-start gap-2">
      <span class="text-lg shrink-0">🎉</span>
      <div>
        <p class="text-xs font-bold text-emerald-700 dark:text-emerald-400">Goal achieved!</p>
        <p class="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">${escH(reward)}</p>
      </div>
    </div>` : achieved ? `
    <div class="rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 mb-2 text-center">
      <p class="text-xs font-bold text-emerald-700 dark:text-emerald-400">🎉 Giving goal achieved!</p>
    </div>` : ""}

    <div class="flex items-end justify-between mb-1">
      <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">
        ${goal > 0 ? fmt(spent) + " of " + fmt(goal) : fmt(spent) + " given"}
      </span>
      ${goal > 0 ? `<span class="text-[11px] font-bold ${achieved?"text-emerald-600 dark:text-emerald-400":"text-purple-600 dark:text-purple-400"}">${pct}%</span>` : ""}
    </div>

    ${goal > 0 ? `
    <div class="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden mb-2">
      <div class="h-full rounded-full transition-all duration-700"
        style="width:${pct}%;background:${barColor};opacity:${barOpacity}"></div>
    </div>` : ""}

    <div class="grid grid-cols-2 gap-2 text-center mt-1">
      <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-2 py-1.5">
        <p class="text-[9px] text-slate-400 uppercase tracking-wider">Given</p>
        <p class="text-sm font-black text-purple-500 dark:text-purple-400 mt-0.5">${fmt(spent)}</p>
      </div>
      ${goal > 0 ? `
      <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-2 py-1.5">
        <p class="text-[9px] text-slate-400 uppercase tracking-wider">${achieved ? "Surplus" : "To go"}</p>
        <p class="text-sm font-black ${achieved?"text-emerald-600 dark:text-emerald-400":"text-slate-700 dark:text-slate-300"} mt-0.5">${fmt(remaining)}</p>
      </div>` : `
      <div class="rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-2 py-1.5">
        <p class="text-[9px] text-slate-400 uppercase tracking-wider">No goal set</p>
        <p class="text-[10px] text-slate-400 mt-0.5">Set a giving target →</p>
      </div>`}
    </div>

    ${carry > 0 ? `
    <div class="mt-2 flex items-center gap-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-700/30 px-2.5 py-1.5">
      <span class="text-purple-400 text-sm shrink-0">↩</span>
      <p class="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">+${fmt(carry)} kindness added from last month</p>
    </div>` : ""}`;
}

function bindSharedJoyForm() {
  const editBtn    = document.getElementById("sharedJoyEditBtn");
  const form       = document.getElementById("sharedJoyForm");
  const saveBtn    = document.getElementById("sjSaveBtn");
  const cancelBtn  = document.getElementById("sjCancelBtn");
  const statusEl   = document.getElementById("sjFormStatus");

  editBtn?.addEventListener("click", () => {
    form?.classList.toggle("hidden");
    if (!form?.classList.contains("hidden")) {
      const goalInp   = document.getElementById("sjGoalInput");
      const rewardInp = document.getElementById("sjRewardInput");
      if (goalInp   && _sharedJoyData) goalInp.value   = _sharedJoyData.goal_amount   > 0 ? _sharedJoyData.goal_amount   : "";
      if (rewardInp && _sharedJoyData) rewardInp.value = _sharedJoyData.reward_note   || "";
      goalInp?.focus();
    }
  });

  cancelBtn?.addEventListener("click", () => {
    form?.classList.add("hidden");
    if (statusEl) { statusEl.textContent = ""; statusEl.classList.add("hidden"); }
  });

  saveBtn?.addEventListener("click", async () => {
    const goalVal   = parseFloat(document.getElementById("sjGoalInput")?.value  || "0") || 0;
    const rewardVal = (document.getElementById("sjRewardInput")?.value || "").trim();
    if (statusEl) statusEl.classList.add("hidden");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    try {
      const res = await fetch("/planning/shared-joy-budget", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ month_start: currentMonthStart, goal_amount: goalVal, reward_note: rewardVal || null }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || "Save failed");
      _sharedJoyData = result.data;
      renderSharedJoyCard(result.data);
      form?.classList.add("hidden");
      window.toast?.success("Shared Joy goal saved ✨");
    } catch(err) {
      if (statusEl) { statusEl.textContent = err.message || "Error"; statusEl.classList.remove("hidden"); }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindCategoryForm();
  bindCreateTagPanel();
  bindPlanForm();
  bindBudgetMonthPicker();
  bindStartNewMonth();
  bindClosePreviousMonth();
  bindSharedJoyForm();
  loadTags();
  loadBudget();
});
