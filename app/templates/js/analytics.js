let monthlyChartInstance = null;
let savingsChartInstance = null;
let donutChartInstance   = null;
let currentChartType     = "bar";
let _lastCategoriesData  = [];
let _budgetsMap          = {};   // { tag_name_lower: {budget_amount, spent, usage_pct, is_over, id} }
let _budgetModalCategory = null;
let _analyticsBudgetMonthStart = null;
let _categoryChildrenMap = {};   // { "food": ["Outside Food","Groceries"], "outside food": [] }
let _sharedJoyTotal      = 0;    // total shared joy spent in current period
let _sharedJoyByCategory = {};   // { tag_name_lower: shared_joy_amount }
let _catColorMap         = {};   // { category_name_lower: hex_color } — user-defined category colors

// Stable hash-based fallback — gives each category a unique color derived from its name.
// Reserved module colors are EXCLUDED so categories never accidentally match a module:
//   sky #0ea5e9 = tags  |  #06b6d4 cyan = bulk-classify  |  #7c3aed/#8b5cf6 violet = groups  |  #9333ea/#a855f7 purple = shared joy
const _CAT_HASH_PALETTE = ["#607AFB","#10b981","#f59e0b","#f97316","#ec4899","#14b8a6","#64748b","#ef4444","#84cc16","#fb923c","#6366f1","#d97706","#be185d","#0f766e"];
function _hashNameColor(name) {
  let h = 0;
  const s = String(name || "").toLowerCase().trim();
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
  return _CAT_HASH_PALETTE[Math.abs(h) % _CAT_HASH_PALETTE.length];
}

// Resolve a category's color: custom (from category manager) → stable hash fallback.
function _getCatColor(name) {
  const stored = _catColorMap[(name || "").toLowerCase().trim()];
  return stored || _hashNameColor(name);
}

const TRACKED_KEY = "analytics_tracked_categories_v1";

function getTracked() {
  try { return JSON.parse(localStorage.getItem(TRACKED_KEY) || "[]"); } catch { return []; }
}
function setTracked(arr) {
  localStorage.setItem(TRACKED_KEY, JSON.stringify(arr));
}
function onTrackedAdd(sel) {
  const name = sel.value;
  if (!name) return;
  const tracked = getTracked();
  if (!tracked.includes(name)) { tracked.push(name); setTracked(tracked); }
  sel.value = "";
  renderTracked(_lastCategoriesData);
}
function removeTracked(name) {
  setTracked(getTracked().filter(n => n !== name));
  renderTracked(_lastCategoriesData);
}

let _modalMonthlyChart  = null;
let _modalMerchantChart = null;
let _modalSubcatChart   = null;
let _modalCurrentName   = null;
let _modalCurrentColor  = null;
let _modalDatePreset    = "1m";

function fullINR(v) {
  const n = Math.abs(parseFloat(v) || 0);
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function getModalDateRange(preset) {
  const today = new Date();
  const fmt = d => {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dy}`;
  };
  const to = fmt(today);
  switch (preset) {
    case "1m": {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(f), to };
    }
    case "prev": {
      const f = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const t = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: fmt(f), to: fmt(t) };
    }
    case "3m": {
      const f = new Date(today); f.setMonth(f.getMonth() - 3);
      return { from: fmt(f), to };
    }
    case "6m": {
      const f = new Date(today); f.setMonth(f.getMonth() - 6);
      return { from: fmt(f), to };
    }
    case "12m": {
      const f = new Date(today); f.setFullYear(f.getFullYear() - 1);
      return { from: fmt(f), to };
    }
    case "all":
      return { from: null, to: null };
    default: {
      const f = new Date(today); f.setMonth(f.getMonth() - 6);
      return { from: fmt(f), to };
    }
  }
}

function buildModalParams(extra = {}) {
  const { from, to } = getModalDateRange(_modalDatePreset);
  const p = new URLSearchParams();
  if (from) p.set("from_date", from);
  if (to)   p.set("to_date",   to);
  Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

function _updateModalViewAllLink() {
  if (!_modalCurrentName) return;
  const { from, to } = getModalDateRange(_modalDatePreset);
  const p = new URLSearchParams({ tag: _modalCurrentName });
  if (from) p.set("from_date", from);
  if (to)   p.set("to_date",   to);
  const href = `/reports/?${p.toString()}`;
  ["modal-view-all", "modal-view-all-mobile"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.href = href;
  });
}

function _setModalPeriod(preset) {
  _modalDatePreset = preset;
  document.querySelectorAll(".modal-period-btn").forEach(btn => {
    const active = btn.dataset.preset === preset;
    btn.className = active
      ? "modal-period-btn h-6 rounded-full px-2.5 text-[10px] font-bold bg-primary text-white transition-colors"
      : "modal-period-btn h-6 rounded-full px-2.5 text-[10px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors";
  });
  _updateModalViewAllLink();
  if (!_modalCurrentName) return;
  if (_modalMonthlyChart)  { _modalMonthlyChart.destroy();  _modalMonthlyChart  = null; }
  if (_modalMerchantChart) { _modalMerchantChart.destroy(); _modalMerchantChart = null; }
  if (_modalSubcatChart)   { _modalSubcatChart.destroy();   _modalSubcatChart   = null; }
  const subcatSec = document.getElementById("modal-subcats-section");
  if (subcatSec) subcatSec.classList.add("hidden");
  const merchantsEl = document.getElementById("modal-merchants");
  if (merchantsEl) merchantsEl.innerHTML = '<p class="text-xs text-slate-400">Loading&#x2026;</p>';
  _loadModalData(_modalCurrentName, _modalCurrentColor);
}

function escAttr(s) {
  return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderTracked(categoriesData) {
  const grid   = document.getElementById("tracked-grid");
  const addSel = document.getElementById("tracked-add-select");
  if (!grid) return;

  const tracked      = getTracked();
  // Total for % ring = expense + invested across all categories
  const totalExpense = categoriesData.reduce((s, r) => s + Math.max(0, (r.total_expense||0) + (r.total_invested||0) - (r.total_income||0)), 0);

  // Rebuild add-dropdown (exclude already-tracked)
  if (addSel) {
    while (addSel.options.length > 1) addSel.remove(1);
    categoriesData
      .filter(r => r.category && r.category !== "Untagged" && !tracked.includes(r.category))
      .sort((a, b) => a.category.localeCompare(b.category))
      .forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.category;
        opt.textContent = r.category;
        addSel.appendChild(opt);
      });
    // Also include budgeted categories that have no transactions yet this period
    Object.values(_budgetsMap).forEach(b => {
      const display = b.tag_name;
      if (!display || display === "Untagged" || tracked.includes(display)) return;
      const alreadyAdded = [...addSel.options].some(o => o.value === display);
      if (!alreadyAdded) {
        const opt = document.createElement("option");
        opt.value = display;
        opt.textContent = `${display} (budgeted)`;
        addSel.appendChild(opt);
      }
    });
  }

  if (!tracked.length) {
    grid.innerHTML = '<p class="col-span-full text-sm text-slate-400">Select a category above to start tracking it here.</p>';
    return;
  }

  const overBudget = [];
  const nearBudget = [];

  // Re-trigger stagger animation on each render
  grid.classList.remove("stagger"); void grid.offsetWidth; grid.classList.add("stagger");

  grid.innerHTML = tracked.map((name, i) => {
    const row      = categoriesData.find(r => r.category === name);
    const budget   = _budgetsMap[name.toLowerCase()];
    // Fall back to budget's own `spent` when no category row exists (e.g. tagged via report page)
    const expense  = row ? (row.total_expense||0) : (budget?.spent || 0);
    const invested = row ? (row.total_invested||0) : 0;
    const income   = row ? (row.total_income||0) : 0;
    const spend    = Math.max(0, expense + invested - income);
    const count    = row ? (row.transaction_count||0) : 0;
    const pct      = totalExpense > 0 ? (spend/totalExpense*100).toFixed(1) : "0.0";
    const color    = _getCatColor(name);
    const r2   = 21;
    const circ = 2 * Math.PI * r2;
    const dash = Math.min(parseFloat(pct)/100, 1) * circ;

    const joyAmt      = _sharedJoyByCategory[name.toLowerCase()] || 0;
    const personalSpend = Math.max(0, spend - joyAmt);

    const hasBudget   = budget && budget.budget_amount > 0;
    const budgetAmt   = hasBudget ? Number(budget.budget_amount || 0) : 0;
    const budgetSpent = hasBudget ? Number(budget.spent ?? spend) : spend;
    const rawPct      = hasBudget ? (budgetAmt > 0 ? (budgetSpent / budgetAmt) * 100 : Number(budget.usage_pct || 0)) : 0;
    const budgetPct   = hasBudget ? Math.min(rawPct, 100) : 0;
    const budgetOver  = hasBudget && budgetSpent > budgetAmt;
    const budgetColor = budgetOver ? "#ef4444" : rawPct >= 80 ? "#f59e0b" : "#22c55e";
    const budgetLabel = hasBudget
      ? (budgetOver
          ? `<span class="text-[10px] font-bold text-red-500">₹${shortINR(budgetSpent - budgetAmt)} over budget</span>`
          : `<span class="text-[10px] text-slate-500">₹${shortINR(budgetAmt - budgetSpent)} of ₹${shortINR(budgetAmt)} left</span>`)
      : "";

    if (hasBudget && budgetOver) overBudget.push(name);
    else if (hasBudget && rawPct >= 80) nearBudget.push(name);

    const childNames = _categoryChildrenMap[name.toLowerCase()] || [];
    const subcatChips = childNames
      .map(childName => {
        const r = categoriesData.find(row => row.category === childName);
        if (!r) return null;
        const s = Math.max(0, (r.total_expense||0) + (r.total_invested||0) - (r.total_income||0));
        return s > 0 ? { name: childName, spend: s } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 4);

    return `
      <div class="group relative rounded-2xl border bg-white shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer"
           style="border-color:${color}25;border-top:3px solid ${color}"
           data-wl-name="${escAttr(name)}" data-wl-idx="${i}" data-wl-color="${escAttr(color)}">
        <div class="p-4">
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="min-w-0 flex flex-col gap-1">
              <p class="text-[11px] font-black uppercase tracking-widest text-slate-400 leading-tight">${name}</p>
              ${hasBudget
                ? (budgetOver
                    ? `<a href="/budget.html" onclick="event.stopPropagation()" class="inline-flex w-fit items-center gap-0.5 rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-600 hover:bg-red-100 transition-colors">🚨 Over budget</a>`
                    : rawPct >= 80
                    ? `<a href="/budget.html" onclick="event.stopPropagation()" class="inline-flex w-fit items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 hover:bg-amber-100 transition-colors">⚠ Near limit</a>`
                    : `<a href="/budget.html" onclick="event.stopPropagation()" class="inline-flex w-fit items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 hover:bg-emerald-100 transition-colors">✓ Go ahead</a>`)
                : `<a href="/budget.html" onclick="event.stopPropagation()" class="inline-flex w-fit items-center gap-0.5 rounded-full bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 hover:bg-slate-200 transition-colors">No budget</a>`}
            </div>
            <button data-wl-remove
              class="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-slate-300 hover:bg-rose-50 hover:text-rose-500 text-sm font-bold">×</button>
          </div>
          <div class="flex items-end justify-between gap-2">
            <div class="min-w-0">
              <p class="text-2xl font-black text-slate-900 dark:text-white leading-none">${formatINR(joyAmt > 0 ? personalSpend : spend)}</p>
              <div class="flex items-center gap-1.5 mt-1.5">
                <span class="text-[10px] text-slate-400">${count} txn${count===1?"":"s"}</span>
                ${joyAmt > 0 ? `<span class="text-[10px] text-slate-300">·</span><span class="text-[10px] font-semibold text-purple-500">✨ ${shortINR(joyAmt)}</span>` : ""}
              </div>
            </div>
            <div class="relative flex-shrink-0" style="width:52px;height:52px">
              <svg width="52" height="52" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="${r2}" fill="none" stroke="#f1f5f9" stroke-width="5"/>
                <circle cx="26" cy="26" r="${r2}" fill="none" stroke="${color}" stroke-width="5"
                  stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
                  transform="rotate(-90 26 26)"/>
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-[10px] font-black" style="color:${color}">${pct}%</span>
              </div>
            </div>
          </div>
          ${hasBudget ? `
          <div class="mt-3">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div class="h-full rounded-full transition-all" style="width:${budgetPct}%;background:${budgetColor}"></div>
            </div>
            <div class="mt-1 flex items-center justify-between">
              ${budgetLabel}
              <button data-set-budget="${escAttr(name)}" class="text-[10px] text-slate-300 hover:text-slate-500 transition-colors" title="Edit budget">✎</button>
            </div>
          </div>` : `
          <div class="mt-3">
            <button data-set-budget="${escAttr(name)}" class="text-[10px] text-slate-300 hover:text-slate-500 transition-colors">+ Set budget</button>
          </div>`}
        </div>
      </div>`;
  }).join("");

  const strip     = document.getElementById("budget-alert-strip");
  const alertText = document.getElementById("budget-alert-text");
  if (strip && alertText) {
    const parts = [];
    if (overBudget.length) parts.push(`Over budget: ${overBudget.join(", ")}`);
    if (nearBudget.length) parts.push(`Near limit (80%+): ${nearBudget.join(", ")}`);
    if (parts.length) { alertText.textContent = parts.join("  ·  "); strip.classList.remove("hidden"); }
    else strip.classList.add("hidden");
  }
}

function _renderModalKPIs(name, color, row, totalExpense, joyAmt) {
  const kpisEl = document.getElementById("modal-kpis");
  if (!kpisEl) return;
  if (!row) { kpisEl.innerHTML = '<div class="col-span-full text-xs text-slate-400">No data for this period.</div>'; return; }
  const spend    = row.total_expense || 0;
  const count    = row.transaction_count || 0;
  const avgTx    = count > 0 ? spend / count : 0;
  const pct      = totalExpense > 0 ? (spend / totalExpense * 100).toFixed(1) : "0.0";
  const personal = Math.max(0, spend - joyAmt);

  kpisEl.innerHTML = `
    <div class="rounded-xl p-3" style="background:${color}0d;border:1px solid ${color}30">
      <p class="text-[10px] font-bold uppercase tracking-widest mb-1" style="color:${color}">Your Spend</p>
      <p class="text-xl font-black text-slate-900 dark:text-white">${formatINR(joyAmt > 0 ? personal : spend)}</p>
      ${joyAmt > 0 ? `<p class="text-[10px] text-slate-400 mt-0.5">${formatINR(spend)} total</p>` : ""}
    </div>
    ${joyAmt > 0 ? `
    <div class="rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-700/40 p-3">
      <p class="text-[10px] font-bold uppercase tracking-widest text-purple-500 mb-1">✨ Shared Joy</p>
      <p class="text-xl font-black text-purple-600 dark:text-purple-400">${formatINR(joyAmt)}</p>
      <p class="text-[10px] text-purple-400 mt-0.5">spent for others</p>
    </div>` : `
    <div class="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Transactions</p>
      <p class="text-xl font-black text-slate-900 dark:text-white">${count.toLocaleString("en-IN")}</p>
    </div>`}
    <div class="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">${joyAmt > 0 ? "Transactions" : "Avg per Txn"}</p>
      <p class="text-xl font-black text-slate-900 dark:text-white">${joyAmt > 0 ? count.toLocaleString("en-IN") : (avgTx > 0 ? formatINR(avgTx) : "—")}</p>
    </div>
    <div class="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
      <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">% of Total</p>
      <p class="text-xl font-black" style="color:${color}">${pct}%</p>
    </div>`;
}

function openWatchlistModal(name, idx, color) {
  // Set preset + reset pills BEFORE setting _modalCurrentName so _setModalPeriod
  // skips its internal _loadModalData call (it guards on _modalCurrentName).
  _modalDatePreset = "1m";
  _setModalPeriod("1m");
  _modalCurrentName  = name;
  _modalCurrentColor = color;
  const modal = document.getElementById("watchlist-modal");
  if (!modal) return;

  // Set header info
  document.getElementById("modal-title").textContent = name;
  const dot = document.getElementById("modal-color-dot");
  if (dot) dot.style.background = color;
  _updateModalViewAllLink();

  // Populate KPIs from already-loaded category data
  const row = _lastCategoriesData.find(r => r.category === name);
  const totalExpense = _lastCategoriesData.reduce((s, r) => s + (r.total_expense||0), 0);
  _renderModalKPIs(name, color, row, totalExpense, _sharedJoyByCategory[name.toLowerCase()] || 0);

  // Reset dynamic sections
  const merchantsEl = document.getElementById("modal-merchants");
  if (merchantsEl) merchantsEl.innerHTML = '<p class="text-xs text-slate-400">Loading&#x2026;</p>';
  const pnlSection = document.getElementById("modal-pnl-section");
  if (pnlSection) pnlSection.classList.add("hidden");

  // Destroy stale charts
  if (_modalMonthlyChart)  { _modalMonthlyChart.destroy();  _modalMonthlyChart  = null; }
  if (_modalMerchantChart) { _modalMerchantChart.destroy(); _modalMerchantChart = null; }
  if (_modalSubcatChart)   { _modalSubcatChart.destroy();   _modalSubcatChart   = null; }

  // Reset subcategory section
  const subcatsSec = document.getElementById("modal-subcats-section");
  if (subcatsSec) subcatsSec.classList.add("hidden");

  modal.classList.remove("hidden");
  _loadModalData(name, color);
}

function closeWatchlistModal() {
  const modal = document.getElementById("watchlist-modal");
  if (modal) modal.classList.add("hidden");
  _modalCurrentName  = null;
  _modalCurrentColor = null;
  if (_modalMonthlyChart)  { _modalMonthlyChart.destroy();  _modalMonthlyChart  = null; }
  if (_modalMerchantChart) { _modalMerchantChart.destroy(); _modalMerchantChart = null; }
  if (_modalSubcatChart)   { _modalSubcatChart.destroy();   _modalSubcatChart   = null; }
}

// Renders sub-category donut. Items with spend > 0 go into the chart;
// items with 0 spend appear in the legend only (grayed, "no txns" note).
function _renderSubcatSunburst(canvasId, legendId, totalId, centerLabelId, level1, level2) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !level1.length) return null;

  // Split: only items with spend go into the donut chart
  const l1With = level1.filter(r => r.total_expense > 0);
  const l1None = level1.filter(r => r.total_expense <= 0);
  const l1Total  = l1With.reduce((s, r) => s + r.total_expense, 0);
  // Use the parent category's color for L1 items (falls back to CAT_COLORS by index)
  const l1Colors = l1With.map((r, i) => _getCatColor(r.category || r.subcategory) || CAT_COLORS[i % CAT_COLORS.length]);

  // L2 items with spend, sorted by their parent's position in l1With
  const l2Sorted = [], l2Colors = [];
  l1With.forEach((l1item, l1idx) => {
    level2
      .filter(r => r.parent_name === l1item.subcategory && r.total_expense > 0)
      .forEach(child => {
        l2Sorted.push(child);
        l2Colors.push(l1Colors[l1idx] + "99");
      });
  });

  const hasL2 = l2Sorted.length > 0;

  const totalEl  = document.getElementById(totalId);
  const centerEl = document.getElementById(centerLabelId);

  let chart = null;
  if (l1With.length > 0) {
    canvas.style.display = "";
    if (totalEl)  totalEl.textContent  = shortINR(l1Total);
    if (centerEl) centerEl.textContent = hasL2 ? "2 levels" : "Sub-cats";

    const datasets = [];
    if (hasL2) {
      datasets.push({
        data: l2Sorted.map(r => r.total_expense),
        backgroundColor: l2Colors,
        borderWidth: 1, borderColor: "#fff",
      });
    }
    datasets.push({
      data: l1With.map(r => r.total_expense),
      backgroundColor: l1Colors,
      borderWidth: 2.5, borderColor: "#fff",
    });

    chart = new Chart(canvas, {
      type: "doughnut",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: hasL2 ? "28%" : "58%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const isL2Ring = hasL2 && ctx.datasetIndex === 0;
                const item     = isL2Ring ? l2Sorted[ctx.dataIndex] : l1With[ctx.dataIndex];
                if (!item) return "";
                const base   = isL2Ring ? l2Sorted : l1With;
                const bTotal = base.reduce((s, r) => s + r.total_expense, 0);
                const pct    = bTotal > 0 ? (item.total_expense / bTotal * 100).toFixed(1) : "0";
                return ` ${item.subcategory}: ${fullINR(item.total_expense)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  } else {
    // No spend in this period — hide chart, clear center labels
    canvas.style.display = "none";
    if (totalEl)  totalEl.textContent  = "";
    if (centerEl) centerEl.textContent = "";
  }

  // Legend: ALL sub-categories shown. 0-spend ones appear grayed with "no txns"
  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    if (l1With.length === 0) {
      legendEl.innerHTML = `<p class="text-[11px] text-slate-400 italic py-3">No transactions in this period</p>`;
    } else {
      const { from: drFrom, to: drTo } = getModalDateRange(_modalDatePreset);
      const tagUrl = (tag) => {
        const p = new URLSearchParams({ tag });
        if (drFrom) p.set("from_date", drFrom);
        if (drTo)   p.set("to_date",   drTo);
        return `/reports/?${p.toString()}`;
      };

      legendEl.innerHTML = [...l1With, ...l1None].map((l1item) => {
        const hasSpend = l1item.total_expense > 0;
        const color    = hasSpend ? l1Colors[l1With.indexOf(l1item)] : "#cbd5e1";
        const pct      = l1Total > 0 && hasSpend
          ? (l1item.total_expense / l1Total * 100).toFixed(1) : null;

        const children = l2Sorted.filter(r => r.parent_name === l1item.subcategory);
        const childRows = children.map(child => {
          const pIdx   = l1With.findIndex(p => p.subcategory === child.parent_name);
          const cColor = pIdx >= 0 ? l1Colors[pIdx] + "cc" : "#cbd5e1";
          const cPct   = l1item.total_expense > 0
            ? (child.total_expense / l1item.total_expense * 100).toFixed(0) : "0";
          return `
            <a href="${tagUrl(child.subcategory)}" onclick="closeWatchlistModal()"
               class="flex items-center gap-2 py-1 pl-5 group hover:bg-slate-50 dark:hover:bg-slate-800 rounded">
              <span class="shrink-0 h-1.5 w-1.5 rounded-full" style="background:${cColor}"></span>
              <span class="flex-1 min-w-0 text-[10px] text-slate-500 dark:text-slate-400 truncate group-hover:text-primary">↳ ${child.subcategory}</span>
              <span class="text-[9px] tabular-nums text-slate-400 font-medium ml-2">${cPct}%</span>
              <span class="text-[10px] tabular-nums text-slate-500 dark:text-slate-300 font-semibold w-16 text-right">${fullINR(child.total_expense)}</span>
            </a>`;
        }).join("");

        return `
          <div class="py-1.5">
            <a href="${tagUrl(l1item.subcategory)}" onclick="closeWatchlistModal()"
               class="flex items-center gap-2 group hover:bg-slate-50 dark:hover:bg-slate-800 rounded px-1 ${hasSpend ? "" : "opacity-45"}">
              <span class="shrink-0 h-3 w-3 rounded-full" style="background:${color}"></span>
              <span class="flex-1 min-w-0 text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate group-hover:text-primary">${l1item.subcategory}</span>
              ${hasSpend
                ? `<span class="text-[10px] tabular-nums font-bold ml-2" style="color:${color}">${pct}%</span>
                   <span class="text-[11px] tabular-nums font-black text-slate-700 dark:text-slate-200 w-16 text-right">${fullINR(l1item.total_expense)}</span>`
                : `<span class="text-[9px] text-slate-300 italic ml-2 w-16 text-right">no txns</span>`}
            </a>
            ${childRows}
          </div>`;
      }).join("");
    }
  }
  return chart;
}

async function _loadModalData(name, color) {
  const qs         = buildModalParams({ tag: name });
  const merchantQs = buildModalParams({ tag: name, min_transaction_count: "1" });
  const subcatQs   = buildModalParams({ parent_name: name });

  const modalDateRange = getModalDateRange(_modalDatePreset);
  const joyQs = new URLSearchParams();
  if (modalDateRange.from) joyQs.set("from_date", modalDateRange.from);
  if (modalDateRange.to)   joyQs.set("to_date",   modalDateRange.to);

  const [monthly, merchants, subcats, joyData] = await Promise.all([
    safeLoad(`/reports/trends/monthly?${qs}`),
    safeLoad(`/reports/merchants?${merchantQs}`),
    safeLoad(`/reports/trends/subcategories?${subcatQs}`),
    safeLoad(`/reports/shared-joy/period-summary?${joyQs}`, {}),
  ]);

  if (_modalCurrentName !== name) return; // modal closed or switched

  // Refresh KPI strip with period-specific shared joy data
  const modalCatData = await safeLoad(`/reports/trends/by_category?${qs}`);
  const modalRow = modalCatData.find(r => r.category === name);
  const modalTotal = modalCatData.reduce((s, r) => s + (r.total_expense||0), 0);
  const modalJoyAmt = (joyData?.by_category || []).find(c => c.tag_name?.toLowerCase() === name.toLowerCase())?.shared_joy_amount || 0;
  _renderModalKPIs(name, color, modalRow, modalTotal, modalJoyAmt);

  

  // ── Update dynamic section labels with category name ──
  const monthlyTitleEl = document.getElementById("modal-monthly-title");
  if (monthlyTitleEl) monthlyTitleEl.textContent = `Monthly Spend — ${name}`;
  const merchantTitleEl = document.getElementById("modal-merchant-title");
  if (merchantTitleEl) merchantTitleEl.textContent = `Top Merchants for ${name}`;
  const merchantsListTitleEl = document.getElementById("modal-merchants-title");
  if (merchantsListTitleEl) merchantsListTitleEl.textContent = `Top Merchants · ${name}`;
  const merchantSummaryEl = document.getElementById("modal-merchant-summary");
  if (merchantSummaryEl && merchants.length) {
    const totalMerchantSpend = merchants.reduce((s, r) => s + (r.total_spend || 0), 0);
    merchantSummaryEl.textContent = `${merchants.length} merchant${merchants.length === 1 ? "" : "s"} · ${fullINR(totalMerchantSpend)} total`;
  }

  // ── Sub-categories sunburst (inner = L1, outer = L2 if nested exist) ──
  const level1 = subcats.filter(r => r.level === 1);
  const level2 = subcats.filter(r => r.level === 2);
  const subcatSection = document.getElementById("modal-subcats-section");
  if (level1.length && subcatSection) {
    subcatSection.classList.remove("hidden");
    const badge = document.getElementById("modal-subcat-level-badge");
    if (badge) badge.textContent = level2.length ? "2 levels deep" : "1 level deep";
    _modalSubcatChart = _renderSubcatSunburst(
      "modal-subcat-chart", "modal-subcat-legend", "modal-subcat-total",
      "modal-subcat-center-label", level1, level2
    );
  }

  // ── Monthly spend trend chart ──
  const monthlyCanvas = document.getElementById("modal-monthly-chart");
  const monthlyEmpty  = document.getElementById("modal-monthly-empty");
  if (monthlyCanvas) {
    if (monthly.length) {
      if (monthlyEmpty) monthlyEmpty.classList.add("hidden");
      monthlyCanvas.style.display = "";
      _modalMonthlyChart = new Chart(monthlyCanvas, {
        type: "bar",
        data: {
          labels: monthly.map(r => r.month),
          datasets: [{
            label: name,
            data: monthly.map(r => r.total_expense||0),
            backgroundColor: color + "bb",
            borderColor: color,
            borderWidth: 1,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${fullINR(ctx.raw)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: "Manrope", size: 10 } } },
            y: { grid: { color: "#f1f5f9" }, ticks: { font: { family: "Manrope", size: 10 }, callback: v => shortINR(v) } },
          },
        },
      });
    } else {
      monthlyCanvas.style.display = "none";
      if (monthlyEmpty) monthlyEmpty.classList.remove("hidden");
    }
  }

  // ── Merchant breakdown donut ──
  const merchantCanvas = document.getElementById("modal-merchant-chart");
  const merchantEmpty  = document.getElementById("modal-merchant-empty");
  const merchantLegend = document.getElementById("modal-merchant-legend");
  const top7  = merchants.slice(0, 7);

  if (merchantCanvas && top7.length) {
    const mLabels = top7.map(r => r.merchant || r.vendor_name || "Unknown");
    const mData   = top7.map(r => r.total_spend || 0);
    const mColors = CAT_COLORS.slice(0, top7.length);
    const mTotal  = mData.reduce((s, v) => s + v, 0);

    if (merchantEmpty) merchantEmpty.classList.add("hidden");
    merchantCanvas.style.display = "";

    _modalMerchantChart = new Chart(merchantCanvas, {
      type: "doughnut",
      data: {
        labels: mLabels,
        datasets: [{
          data: mData,
          backgroundColor: mColors,
          borderWidth: 2,
          borderColor: "#fff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${fullINR(ctx.raw)} (${(ctx.raw/mTotal*100).toFixed(1)}%)`,
            },
          },
        },
      },
    });

    if (merchantLegend) {
      merchantLegend.innerHTML = top7.map((r, i) => {
        const pct = mTotal > 0 ? (r.total_spend/mTotal*100).toFixed(0) : 0;
        return `
          <div class="flex items-center gap-1.5">
            <span class="shrink-0 h-2 w-2 rounded-full" style="background:${mColors[i]}"></span>
            <span class="flex-1 truncate text-[10px] text-slate-600">${mLabels[i]}</span>
            <span class="text-[10px] font-bold text-slate-500">${pct}%</span>
          </div>`;
      }).join("");
    }
  } else if (merchantCanvas) {
    merchantCanvas.style.display = "none";
    if (merchantEmpty) merchantEmpty.classList.remove("hidden");
    if (merchantLegend) merchantLegend.innerHTML = "";
  }

  // ── P&L summary ──
  const totalSpend    = monthly.reduce((s,r) => s+(r.total_expense||0), 0);
  const totalInvested = monthly.reduce((s,r) => s+(r.total_invested||0), 0);
  const totalIncome   = monthly.reduce((s,r) => s+(r.total_income||0), 0);
  const totalInvRet   = monthly.reduce((s,r) => s+(r.total_investment_return||0), 0);
  const totalOut      = totalSpend + totalInvested;   // all cash deployed (expense + investment)
  const totalIn       = totalIncome + totalInvRet;    // all cash received back
  const pnlSection    = document.getElementById("modal-pnl-section");
  const pnlEl         = document.getElementById("modal-pnl");
  if ((totalIn > 0 || totalInvested > 0) && pnlSection && pnlEl) {
    const net      = totalIn - totalOut;
    const pnlColor = net >= 0 ? "#059669" : "#dc2626";
    pnlSection.classList.remove("hidden");
    pnlEl.innerHTML = `
      <div class="rounded-xl bg-rose-50 border border-rose-100 p-3 text-center">
        <p class="text-[10px] font-bold uppercase tracking-widest text-rose-500 mb-1">Deployed</p>
        <p class="text-lg font-black text-rose-700">${fullINR(totalOut)}</p>
        ${totalInvested > 0 ? `<p class="text-[9px] text-rose-400 mt-0.5">${fullINR(totalSpend)} exp + ${fullINR(totalInvested)} inv</p>` : ""}
      </div>
      <div class="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
        <p class="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Received</p>
        <p class="text-lg font-black text-emerald-700">${fullINR(totalIn)}</p>
      </div>
      <div class="rounded-xl p-3 text-center" style="background:${pnlColor}0d;border:1px solid ${pnlColor}30">
        <p class="text-[10px] font-bold uppercase tracking-widest mb-1" style="color:${pnlColor}">Net</p>
        <p class="text-lg font-black" style="color:${pnlColor}">${net>=0?"+":""}${fullINR(Math.abs(net))}</p>
      </div>`;
  }

  // ── Top merchants list ──
  const merchantsListEl = document.getElementById("modal-merchants");
  if (merchantsListEl) {
    if (merchants.length) {
      const top      = merchants.slice(0, 8);
      const maxSpend = Math.max(...top.map(r => r.total_spend||0));
      merchantsListEl.innerHTML = top.map((r, i) => {
        const pct   = maxSpend > 0 ? Math.round((r.total_spend||0)/maxSpend*100) : 0;
        const mColor = CAT_COLORS[i % CAT_COLORS.length];
        const mName = r.merchant || r.vendor_name || "Unknown";
        return `
          <div>
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[55%]">${mName}</span>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-black text-slate-800 dark:text-white">${fullINR(r.total_spend||0)}</span>
                <span class="text-[10px] text-slate-400">${r.transaction_count} txn${r.transaction_count===1?"":"s"}</span>
              </div>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${mColor}"></div>
            </div>
          </div>`;
      }).join("");
    } else {
      merchantsListEl.innerHTML = '<p class="text-xs text-slate-400">No merchant data for this period.</p>';
    }
  }
}

const CAT_COLORS = [
  "#137fec","#059669","#dc2626","#ca8a04","#7c3aed",
  "#0891b2","#c2410c","#4f46e5","#be185d","#065f46",
];

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function getDateRange() {
  const preset = document.getElementById("analytics-preset").value;
  const today  = new Date();
  const fmt    = (d) => d.toISOString().split("T")[0];
  if (preset === "custom") {
    return {
      from: document.getElementById("analytics-from").value,
      to:   document.getElementById("analytics-to").value,
    };
  }
  const to = fmt(today);
  if (preset === "1m")  { return { from: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-01`, to }; }
  if (preset === "prev") { return { from: fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: fmt(new Date(today.getFullYear(), today.getMonth(), 0)) }; }
  if (preset === "3m")  { const f = new Date(today); f.setMonth(f.getMonth()-3); return { from: fmt(f), to }; }
  if (preset === "6m")  { const f = new Date(today); f.setMonth(f.getMonth()-6); return { from: fmt(f), to }; }
  if (preset === "12m") { const f = new Date(today); f.setFullYear(f.getFullYear()-1); return { from: fmt(f), to }; }
  if (preset === "ytd") { return { from: `${today.getFullYear()}-01-01`, to }; }
  return { from: null, to: null }; // all time
}

function getBudgetMonthStartForRange(from, to) {
  if (!from || !to) return null;
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  return fromMonth === toMonth ? `${fromMonth}-01` : null;
}

function onPresetChange() {
  const isCustom = document.getElementById("analytics-preset").value === "custom";
  document.getElementById("custom-range").classList.toggle("hidden", !isCustom);
  if (!isCustom) loadAnalytics();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function formatINR(v) {
  const n = parseFloat(v) || 0;
  return "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortINR(v) {
  const n = Math.abs(parseFloat(v) || 0);
  if (n >= 1e7) return "₹" + (n/1e7).toFixed(1) + "Cr";
  if (n >= 1e5) return "₹" + (n/1e5).toFixed(1) + "L";
  if (n >= 1e3) return "₹" + (n/1e3).toFixed(1) + "k";
  return "₹" + n.toFixed(0);
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function escHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function skeletonRows(n = 5, cols = 2) {
  return Array.from({length: n}, () =>
    `<div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
      ${Array.from({length: cols}, (_, i) =>
        `<div class="h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" style="flex:${i === 0 ? 2 : 1}"></div>`
      ).join("")}
    </div>`
  ).join("");
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function buildParams(extra = {}) {
  const { from, to } = getDateRange();
  const source = document.getElementById("analytics-source").value;
  const p = new URLSearchParams();
  if (from)   p.set("from_date", from);
  if (to)     p.set("to_date",   to);
  if (source) p.set("source",    source);
  Object.entries(extra).forEach(([k,v]) => { if (v) p.set(k, v); });
  return p.toString();
}
async function safeLoad(url, fallback = []) {
  try { const r = await fetchJSON(url); return r.data || fallback; }
  catch (e) { console.warn("Analytics fetch failed:", url, e.message); return fallback; }
}

// ---------------------------------------------------------------------------
// Period & drill-through helpers (used by KPI deltas, top-mover tiles, and
// every analytics surface that links into Reports). The period-shift mirrors
// the same-length backwards window already used inside loadComparison.
// ---------------------------------------------------------------------------
function computePeriodWindow(from, to) {
  if (!from || !to) return { prevFrom: null, prevTo: null };
  const f = new Date(from + "T00:00:00");
  const t = new Date(to   + "T00:00:00");
  const days = Math.max(1, Math.round((t - f) / 86400000) + 1);
  const prevT = new Date(f); prevT.setDate(prevT.getDate() - 1);
  const prevF = new Date(prevT); prevF.setDate(prevF.getDate() - (days - 1));
  const fmt = (d) => d.toISOString().split("T")[0];
  return { prevFrom: fmt(prevF), prevTo: fmt(prevT) };
}

function _priorPeriodLabel(preset) {
  if (preset === "1m")  return "vs last month";
  if (preset === "prev") return "vs month before";
  if (preset === "3m")  return "vs prev 3 mo";
  if (preset === "6m")  return "vs prev 6 mo";
  if (preset === "12m") return "vs prev year";
  if (preset === "ytd") return "vs prev YTD";
  return "vs prior period";
}

function _pct(curr, prev) {
  const c = Number(curr || 0), p = Number(prev || 0);
  if (!isFinite(c) || !isFinite(p)) return null;
  if (p === 0) return c === 0 ? 0 : null;   // null = "new" / not comparable
  return ((c - p) / Math.abs(p)) * 100;
}

// Pill rendering — colour tone reflects whether the change is *desirable*.
function _deltaPillHtml(curr, prev, opts = {}) {
  const betterIsHigher = !!opts.betterIsHigher;
  const suffix = opts.suffix || "";
  const pct = _pct(curr, prev);
  if (pct === null) {
    if (Number(curr || 0) > 0 && !Number(prev || 0)) {
      return `<span class="ml-1 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-100">▲ new</span>`;
    }
    return "";
  }
  if (Math.abs(pct) < 0.5) {
    return `<span class="ml-1 inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">~flat</span>`;
  }
  const up = pct > 0;
  const good = (up && betterIsHigher) || (!up && !betterIsHigher);
  const cls = good
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : "bg-rose-50 text-rose-700 ring-rose-100";
  return `<span class="ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${cls}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%${suffix}</span>`;
}

// Top movers across two arrays of {key,valueKey} rows, sorted by |Δ| desc.
function computeTopMovers(curr, prev, opts = {}) {
  const key = opts.key || "tag_name";
  const valueKey = opts.valueKey || "total_expense";
  const n = opts.n || 3;
  const prevMap = new Map();
  (prev || []).forEach((r) => { if (r && r[key] != null) prevMap.set(String(r[key]).toLowerCase(), Number(r[valueKey] || 0)); });
  const seen = new Set();
  const out = [];
  (curr || []).forEach((r) => {
    if (!r || r[key] == null) return;
    const k = String(r[key]).toLowerCase();
    seen.add(k);
    const c = Number(r[valueKey] || 0);
    const p = prevMap.get(k) || 0;
    out.push({ name: r[key], curr: c, prev: p, delta: c - p, deltaPct: _pct(c, p), isNew: p === 0 && c > 0 });
  });
  // Items present in prior but dropped to 0 in current (also movers)
  (prev || []).forEach((r) => {
    if (!r || r[key] == null) return;
    const k = String(r[key]).toLowerCase();
    if (seen.has(k)) return;
    const p = Number(r[valueKey] || 0);
    out.push({ name: r[key], curr: 0, prev: p, delta: -p, deltaPct: _pct(0, p), isNew: false });
  });
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, n);
}

// Compose /reports/?... carrying analytics' current date range.
function reportsUrl(opts = {}) {
  const { from, to } = getDateRange();
  const p = new URLSearchParams();
  if (opts.tag)       p.set("tag", opts.tag);
  if (opts.source)    p.set("source", opts.source);
  if (opts.vendor)    p.set("vendor", opts.vendor);
  if (opts.direction) p.set("direction", opts.direction);
  if (from)           p.set("from_date", from);
  if (to)             p.set("to_date", to);
  return "/reports/?" + p.toString();
}

// Walk every [data-drill] element and set a live href reflecting the analytics
// source filter + current date range. Called after each loadAnalytics(), and
// once on DOMContentLoaded so links work before data finishes loading.
function _applyDrillThroughHrefs() {
  const drillMap = {
    expense:       { direction: "withdrawal" },
    income:        { direction: "deposit" },
    invested:      { direction: "withdrawal" },
    net:           {},
    savings:       {},
    count:         {},
    "cf-income":   { direction: "deposit" },
    "cf-expense":  { direction: "withdrawal" },
    "inv-deployed": { direction: "withdrawal" },
    "inv-returned": { direction: "deposit" },
    "reports-debit": { direction: "withdrawal" },
  };
  document.querySelectorAll("[data-drill]").forEach((el) => {
    const opts = drillMap[el.dataset.drill];
    if (opts !== undefined) el.setAttribute("href", reportsUrl(opts));
  });
}

function _buildCategoryChildrenMap(categoryTree) {
  _categoryChildrenMap = {};
  for (const cat of categoryTree) {
    const key = cat.name.trim().toLowerCase();
    _categoryChildrenMap[key] = (cat.subcategories || []).map(s => s.name.trim());
    for (const sub of (cat.subcategories || [])) {
      _categoryChildrenMap[sub.name.trim().toLowerCase()] = [];
    }
  }
}

// ---------------------------------------------------------------------------
// Watchlist quick-add buttons (#5)
// ---------------------------------------------------------------------------
function _wireQuickAddButtons(categoriesData) {
  const overBtn = document.getElementById("tracked-add-over-budget");
  const top5Btn = document.getElementById("tracked-add-top5");

  // Show "Over budget" button only when there are over-budget categories not yet tracked
  const overBudget = Object.values(_budgetsMap).filter(b => b.is_over).map(b => b.tag_name);
  if (overBtn) {
    if (overBudget.length > 0) {
      overBtn.classList.remove("hidden");
      overBtn.textContent = `Over budget (${overBudget.length})`;
      overBtn.onclick = () => {
        const tracked = getTracked();
        const toAdd = overBudget.filter(n => !tracked.includes(n));
        if (!toAdd.length) { window.toast?.info("All over-budget categories are already tracked."); return; }
        setTracked([...new Set([...tracked, ...toAdd])]);
        renderTracked(categoriesData);
        window.toast?.success(`Added ${toAdd.length} over-budget ${toAdd.length === 1 ? "category" : "categories"} to watchlist.`);
      };
    } else {
      overBtn.classList.add("hidden");
    }
  }

  // "Top 5" by expense — always available when data loaded
  if (top5Btn && categoriesData.length > 0) {
    top5Btn.classList.remove("hidden");
    top5Btn.onclick = () => {
      const tracked = getTracked();
      const top5 = [...categoriesData]
        .filter(r => r.category && r.category !== "Untagged")
        .sort((a, b) => (b.total_expense || 0) - (a.total_expense || 0))
        .slice(0, 5).map(r => r.category);
      const toAdd = top5.filter(n => !tracked.includes(n));
      if (!toAdd.length) { window.toast?.info("Top 5 categories are already tracked."); return; }
      setTracked([...new Set([...tracked, ...toAdd])]);
      renderTracked(categoriesData);
      window.toast?.success(`Added ${toAdd.length} ${toAdd.length === 1 ? "category" : "categories"} to watchlist.`);
    };
  }
}

// ---------------------------------------------------------------------------
// Budget overview strip (Change 3)
// ---------------------------------------------------------------------------
function renderBudgetOverview() {
  const strip = document.getElementById("budget-overview-strip");
  if (!strip) return;
  const entries = Object.values(_budgetsMap);
  if (!entries.length) { strip.classList.add("hidden"); return; }
  const over = entries.filter(b => b.is_over);
  const near = entries.filter(b => !b.is_over && b.usage_pct >= 80);
  const ok   = entries.filter(b => !b.is_over && b.usage_pct < 80);
  const _renderBovSpan = (id, items, icon, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!items.length) { el.classList.add("hidden"); el.classList.remove("flex"); return; }
    el.innerHTML = `<span class="material-symbols-outlined text-[13px]" style="font-variation-settings:'FILL' 1">${icon}</span>${items.length} ${label}: ${items.map(b => escHtml(b.tag_name)).join(", ")}`;
    el.classList.remove("hidden");
    el.classList.add("flex");
  };
  _renderBovSpan("bov-over", over, "warning",      "over budget");
  _renderBovSpan("bov-near", near, "trending_up",  "near limit");
  _renderBovSpan("bov-ok",   ok,   "check_circle", "on track");
  strip.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Balance over time chart (Change 8)
// ---------------------------------------------------------------------------
let _balanceChartInstance = null;
async function loadBalanceChart(qs) {
  const card = document.getElementById("balance-chart-card");
  const canvas = document.getElementById("balance-chart");
  if (!card || !canvas) return;
  const data = await safeLoad(`/reports/trends/balance?${qs}`, []);
  if (!data.length) { card.classList.add("hidden"); return; }

  // Group by source → series
  const bySource = {};
  data.forEach(({ date, balance, source }) => {
    if (!bySource[source]) bySource[source] = [];
    bySource[source].push({ x: date, y: parseFloat(balance) });
  });
  const sources = Object.keys(bySource);
  const COLORS = ["#0ea5e9","#10b981","#f59e0b","#8b5cf6","#f43f5e","#6366f1"];

  // Build a unified sorted date list across all sources
  const allDates = [...new Set(data.map(d => d.date))].sort();
  // Sample to ≤60 labels for readability
  const step   = Math.max(1, Math.floor(allDates.length / 60));
  const labels = allDates.filter((_, i) => i % step === 0 || i === allDates.length - 1);
  const labelSet = new Set(labels);

  if (_balanceChartInstance) { _balanceChartInstance.destroy(); _balanceChartInstance = null; }
  const isDark = document.documentElement.classList.contains("dark");
  _balanceChartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: sources.map((src, i) => {
        const balanceByDate = {};
        bySource[src].forEach(({ x, y }) => { balanceByDate[x] = y; });
        return {
          label: src,
          data: labels.map(d => balanceByDate[d] ?? null),
          borderColor: COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length] + "18",
          fill: true, tension: 0.3,
          pointRadius: labels.length > 40 ? 0 : 2,
          borderWidth: 2, spanGaps: true,
        };
      }),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: sources.length > 1, labels: { font: { family: "Manrope", size: 10 }, boxWidth: 10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatINR(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "Manrope", size: 10 }, maxTicksLimit: 8, maxRotation: 0 } },
        y: { grid: { color: isDark ? "#1e293b" : "#f1f5f9" }, ticks: { font: { family: "Manrope", size: 10 }, callback: v => shortINR(v) } },
      },
    },
  });
  const label = document.getElementById("balance-chart-label");
  if (label) label.textContent = sources.length > 1 ? `${sources.length} accounts` : sources[0] || "Balance";
  card.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Shared Joy summary section (Change 9)
// ---------------------------------------------------------------------------
function renderSharedJoySection() {
  const section = document.getElementById("shared-joy-section");
  if (!section) return;
  if (!(_sharedJoyTotal > 0)) { section.classList.add("hidden"); return; }
  const totalEl = document.getElementById("sj-total");
  const subEl   = document.getElementById("sj-sub");
  const catsEl  = document.getElementById("sj-categories");
  const totalExpense = _lastCategoriesData.reduce((s, r) => s + (r.total_expense || 0), 0);
  if (totalEl) totalEl.textContent = formatINR(_sharedJoyTotal);
  if (subEl) {
    const pct = totalExpense > 0 ? ((_sharedJoyTotal / totalExpense) * 100).toFixed(1) : 0;
    subEl.textContent = `${pct}% of total spend`;
  }
  if (catsEl) {
    const top3 = Object.entries(_sharedJoyByCategory).sort(([,a],[,b]) => b - a).slice(0, 3);
    catsEl.innerHTML = top3.map(([name, amt]) =>
      `<span class="rounded-full bg-purple-100 dark:bg-purple-900/40 px-2.5 py-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300 ring-1 ring-purple-200 dark:ring-purple-700">${escHtml(name)} ${shortINR(amt)}</span>`
    ).join("");
  }
  section.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Main load
// ---------------------------------------------------------------------------
async function loadAnalytics() {
  const loading = document.getElementById("analytics-loading");
  if (loading) loading.classList.remove("hidden");
  const errorEl = document.getElementById("analytics-error");
  if (errorEl) errorEl.classList.add("hidden");

  try {
    const qs    = buildParams();
    const catQs = buildParams();
    // Prior-period window (same length, immediately preceding) for KPI deltas
    // and top-mover insight tiles. Source filter carries over but date overrides.
    const { from, to } = getDateRange();
    _analyticsBudgetMonthStart = getBudgetMonthStartForRange(from, to);
    const { prevFrom, prevTo } = computePeriodWindow(from, to);
    const _source = document.getElementById("analytics-source")?.value || "";
    const prevP = new URLSearchParams();
    if (prevFrom) prevP.set("from_date", prevFrom);
    if (prevTo)   prevP.set("to_date",   prevTo);
    if (_source)  prevP.set("source",    _source);
    const prevQs = prevP.toString();
    const _wantPrev = Boolean(prevFrom && prevTo);

    const [
      monthlyData, categoriesData, sourcesData, merchantData,
      budgetResult, categoryTree, sharedJoyResult,
      prevMonthlyData, prevCategoriesData, prevSourcesData, prevMerchantData,
    ] = await Promise.all([
      safeLoad(`/reports/trends/monthly?${qs}`),
      safeLoad(`/reports/trends/by_category?${catQs}`),
      safeLoad(`/reports/trends/by_source?${qs}`),
      safeLoad(`/reports/merchants?${qs}&min_transaction_count=1`),
      safeLoad(_analyticsBudgetMonthStart ? `/planning/category-budgets?month_start=${_analyticsBudgetMonthStart}&include_inactive_history=true` : "/planning/category-budgets"),
      safeLoad(`/classification/api/categories`),
      safeLoad(`/reports/shared-joy/period-summary?${qs}`, {}),
      _wantPrev ? safeLoad(`/reports/trends/monthly?${prevQs}`)       : Promise.resolve([]),
      _wantPrev ? safeLoad(`/reports/trends/by_category?${prevQs}`)   : Promise.resolve([]),
      _wantPrev ? safeLoad(`/reports/trends/by_source?${prevQs}`)     : Promise.resolve([]),
      _wantPrev ? safeLoad(`/reports/merchants?${prevQs}&min_transaction_count=1`) : Promise.resolve([]),
    ]);

    _budgetsMap = {};
    (budgetResult?.items || []).forEach(b => { _budgetsMap[b.tag_name.toLowerCase()] = b; });

    _buildCategoryChildrenMap(Array.isArray(categoryTree) ? categoryTree : []);

    // Build category + subcategory color map from user-defined colors
    _catColorMap = {};
    function _walkCatTree(nodes) {
      nodes.forEach(node => {
        const color = node.color || _hashNameColor(node.name); // own color or stable hash — never inherit parent
        if (node.name) _catColorMap[node.name.toLowerCase()] = color;
        if (node.subcategories) _walkCatTree(node.subcategories);
        if (node.children) _walkCatTree(node.children);
      });
    }
    _walkCatTree(Array.isArray(categoryTree) ? categoryTree : []);

    // Build shared joy per-category map for watchlist cards
    _sharedJoyTotal = Number(sharedJoyResult?.total || 0);
    _sharedJoyByCategory = {};
    (sharedJoyResult?.by_category || []).forEach(c => {
      _sharedJoyByCategory[c.tag_name.toLowerCase()] = Number(c.shared_joy_amount || 0);
    });

    _lastCategoriesData = categoriesData;
    window._lastMerchantData = merchantData;
    // Stash prev data so renderers (deltas, top-movers) can pick it up without
    // having to be threaded through every call site.
    window._analyticsPrev = {
      monthly: prevMonthlyData, byCategory: prevCategoriesData,
      bySource: prevSourcesData, merchants: prevMerchantData,
      label: _priorPeriodLabel(document.getElementById("analytics-preset").value),
      hasData: _wantPrev,
    };
    window._catColorMap = _catColorMap; // expose for budget.js and report_shower.js
    renderKPIs(monthlyData, prevMonthlyData);
    renderTracked(categoriesData);
    renderBudgetOverview();
    _wireQuickAddButtons(categoriesData);
    renderMonthlyChart(monthlyData);
    renderSavingsRateChart(monthlyData);
    renderCategoryDonut(categoriesData);
    renderMerchants(merchantData);
    renderSources(sourcesData, prevSourcesData);
    populateSourceFilter(sourcesData);
    renderInsightStrip(monthlyData, categoriesData);
    renderSharedJoySection();
    loadBalanceChart(qs);
    _applyDrillThroughHrefs();
  } catch (e) {
    console.error("Analytics load failed", e);
    if (errorEl) { errorEl.textContent = "Failed to load: " + (e.message||"unknown"); errorEl.classList.remove("hidden"); }
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------
function renderKPIs(rows, prevRows = []) {
  const totalExpense     = rows.reduce((s,r) => s+(r.total_expense||0), 0);
  const totalIncome      = rows.reduce((s,r) => s+(r.total_income||0), 0);
  const totalInvested    = rows.reduce((s,r) => s+(r.total_invested||0), 0);
  const totalInvReturn   = rows.reduce((s,r) => s+(r.total_investment_return||0), 0);
  const totalCount       = rows.reduce((s,r) => s+(r.transaction_count||0), 0);
  const net              = totalIncome - totalExpense;
  const savingsRate      = totalIncome > 0 ? ((net / totalIncome) * 100) : 0;
  const invPnl           = totalInvReturn - totalInvested;
  const invRoi           = totalInvested > 0 ? (invPnl / totalInvested * 100) : 0;

  // Prior-period totals for the delta pills appended to each KPI sub-line.
  const pExpense  = (prevRows || []).reduce((s,r) => s+(r.total_expense||0), 0);
  const pIncome   = (prevRows || []).reduce((s,r) => s+(r.total_income||0), 0);
  const pInvested = (prevRows || []).reduce((s,r) => s+(r.total_invested||0), 0);
  const pCount    = (prevRows || []).reduce((s,r) => s+(r.transaction_count||0), 0);
  const pNet      = pIncome - pExpense;
  const pSavRate  = pIncome > 0 ? (pNet / pIncome * 100) : 0;
  const hasPrev   = Array.isArray(prevRows) && prevRows.length > 0;
  const priorLbl  = (window._analyticsPrev && window._analyticsPrev.label) || "vs prior period";

  setText("kpi-expense",       formatINR(totalExpense));
  setText("kpi-income",        formatINR(totalIncome));
  setText("kpi-invested",      formatINR(totalInvested));
  setText("kpi-count",         totalCount.toLocaleString("en-IN"));
  setText("kpi-savings-rate",  savingsRate.toFixed(1) + "%");

  const netEl = document.getElementById("kpi-net");
  if (netEl) {
    netEl.textContent = (net >= 0 ? "+" : "") + formatINR(net);
    netEl.style.color = net >= 0 ? "#059669" : "#dc2626";
  }
  const rateEl = document.getElementById("kpi-savings-rate");
  if (rateEl) rateEl.style.color = savingsRate >= 20 ? "#059669" : savingsRate >= 0 ? "#d97706" : "#dc2626";

  // Investment P&L cards
  setText("inv-deployed", formatINR(totalInvested));
  setText("inv-returned", formatINR(totalInvReturn));
  const pnlEl    = document.getElementById("inv-pnl");
  const pnlSubEl = document.getElementById("inv-pnl-sub");
  const roiEl    = document.getElementById("inv-roi");
  const roiSubEl = document.getElementById("inv-roi-sub");
  if (totalInvReturn > 0) {
    // Realised P&L — can compute meaningfully
    if (pnlEl) {
      pnlEl.textContent = (invPnl >= 0 ? "+" : "-") + formatINR(Math.abs(invPnl));
      pnlEl.style.color = invPnl >= 0 ? "#059669" : "#dc2626";
    }
    if (roiEl) {
      roiEl.textContent = (invRoi >= 0 ? "+" : "") + invRoi.toFixed(1) + "%";
      roiEl.style.color = invRoi > 0 ? "#059669" : invRoi < 0 ? "#dc2626" : "#64748b";
    }
    if (pnlSubEl) pnlSubEl.textContent = "returned − deployed";
    if (roiSubEl) roiSubEl.textContent  = "P&L ÷ deployed";
  } else {
    // No sells yet — unrealised positions, P&L is not meaningful
    if (pnlEl)    { pnlEl.textContent = "—";  pnlEl.style.color = "#94a3b8"; }
    if (roiEl)    { roiEl.textContent = "—";  roiEl.style.color = "#94a3b8"; }
    if (pnlSubEl) pnlSubEl.textContent = "no sells yet";
    if (roiSubEl) roiSubEl.textContent  = "no sells yet";
  }

  // Hide investment section if no investment data at all
  const invSection = document.getElementById("investment-summary");
  if (invSection) invSection.style.display = (totalInvested > 0 || totalInvReturn > 0) ? "" : "none";

  // Sub-labels on KPI cards — when we have a prior period, replace the static
  // "across all months" text with the prior-period label + a ▲▼ delta pill.
  const expMonths = rows.filter(r => r.total_expense > 0).length;
  const incMonths = rows.filter(r => r.total_income > 0).length;
  const joySubText = _sharedJoyTotal > 0
    ? `✨ ${formatINR(_sharedJoyTotal)} for others · ${expMonths} month${expMonths === 1 ? "" : "s"}`
    : `${expMonths} month${expMonths === 1 ? "" : "s"} of expenses`;
  const invMonths = rows.filter(r => (r.total_invested||0) > 0).length;
  const setSub = (id, fallback, deltaArgs) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (hasPrev && deltaArgs) el.innerHTML = `${escHtml(priorLbl)} ${_deltaPillHtml(deltaArgs.c, deltaArgs.p, deltaArgs.opts || {})}`;
    else el.textContent = fallback;
  };
  setSub("kpi-expense-sub",      joySubText,                                              { c: totalExpense,  p: pExpense,  opts: { betterIsHigher: false } });
  // Budget vs actual indicator — only when not showing prior-period delta
  if (!hasPrev) {
    const _totalBudgeted = Object.values(_budgetsMap).reduce((s, b) => s + (Number(b.budget_amount) || 0), 0);
    if (_totalBudgeted > 0) {
      const _overBy = totalExpense - _totalBudgeted;
      const _subEl = document.getElementById("kpi-expense-sub");
      if (_subEl) {
        if (_overBy > 0.5) {
          _subEl.innerHTML = `<span class="font-bold text-rose-600">${shortINR(_overBy)} over ${shortINR(_totalBudgeted)} budget</span>`;
        } else if (_overBy < -0.5) {
          _subEl.innerHTML = `<span class="font-bold text-emerald-600">${shortINR(-_overBy)} under ${shortINR(_totalBudgeted)} budget</span>`;
        } else {
          _subEl.innerHTML = `<span class="font-bold text-emerald-600">exactly on budget ${shortINR(_totalBudgeted)}</span>`;
        }
      }
    }
  }
  setSub("kpi-income-sub",       `${incMonths} month${incMonths === 1 ? "" : "s"} of income`, { c: totalIncome,   p: pIncome,   opts: { betterIsHigher: true } });
  setSub("kpi-invested-sub",     totalInvested > 0
    ? `${invMonths} month${invMonths === 1 ? "" : "s"} of purchases`
    : "no investments tagged",                                                            { c: totalInvested, p: pInvested, opts: { betterIsHigher: true } });
  setSub("kpi-count-sub",        `${rows.length} month${rows.length === 1 ? "" : "s"} of data`, { c: totalCount,    p: pCount,    opts: { betterIsHigher: true } });
  setSub("kpi-net-sub",          "income minus spend",                                    { c: net,           p: pNet,      opts: { betterIsHigher: true } });
  setSub("kpi-savings-sub",      "of income saved",                                       { c: savingsRate,   p: pSavRate,  opts: { betterIsHigher: true } });

  renderCashFlowBar(totalIncome, totalExpense, savingsRate);
  renderAnalyticsInsight(savingsRate, totalExpense, totalIncome, totalCount);

  // Run-rate projection (Change 2): when viewing current partial month, show pace estimate
  try {
    const _today = new Date();
    const { to } = getDateRange();
    const _toDate = to ? new Date(to) : _today;
    const _isCurrentMonth = _toDate.getFullYear() === _today.getFullYear()
      && _toDate.getMonth() === _today.getMonth();
    if (_isCurrentMonth && rows.length > 0) {
      const _lastRow = rows[rows.length - 1];
      const _curSpent = _lastRow?.total_expense || 0;
      const _day = _today.getDate();
      const _daysInMonth = new Date(_today.getFullYear(), _today.getMonth() + 1, 0).getDate();
      if (_day < _daysInMonth && _curSpent > 0) {
        const _pace = (_curSpent / _day) * _daysInMonth;
        const _subEl = document.getElementById("kpi-expense-sub");
        if (_subEl) _subEl.innerHTML += ` · <span class="font-bold">pace ${shortINR(_pace)}</span>`;
      }
    }
  } catch(_) {}
}

function renderAnalyticsInsight(savingsRate, totalExpense, totalIncome, totalCount) {
  let el = document.getElementById("analytics-insight");
  if (!el) {
    el = document.createElement("div");
    el.id = "analytics-insight";
    // Inject after the KPI strip
    const kpiAnchor = document.getElementById("kpi-expense")?.closest("section, .rounded-2xl, .rounded-3xl, .grid") || document.getElementById("kpi-expense")?.parentElement?.parentElement;
    if (kpiAnchor) kpiAnchor.insertAdjacentElement("afterend", el);
    else document.querySelector("main section")?.prepend(el);
  }

  let emoji, msg, cls;
  if (totalIncome === 0) return;
  if (savingsRate >= 30) {
    emoji = "ðŸ†"; cls = "border-emerald-200 bg-emerald-50 text-emerald-800";
    msg = "Incredible savings rate! Saving 30%+ means serious wealth building. You're a financial legend!";
  } else if (savingsRate >= 20) {
    emoji = "💪"; cls = "border-sky-200 bg-sky-50 text-sky-800";
    msg = `Great savings rate! ${savingsRate.toFixed(0)}% saved — well above the 20% goal. Keep this up!`;
  } else if (savingsRate >= 10) {
    emoji = "📈"; cls = "border-amber-200 bg-amber-50 text-amber-800";
    msg = `Decent! Saving ${savingsRate.toFixed(0)}% of income. Push toward 20% by trimming your top category.`;
  } else if (savingsRate >= 0) {
    emoji = "ðŸŒ±"; cls = "border-amber-200 bg-amber-50 text-amber-800";
    msg = `Low savings this period (${savingsRate.toFixed(0)}%). Small cuts in top categories = big difference over time.`;
  } else {
    emoji = "🚨"; cls = "border-rose-200 bg-rose-50 text-rose-800";
    msg = "Spent more than earned! Check where money leaked — usually food, shopping, or subscriptions.";
  }

  el.innerHTML = `<div class="fun-card rounded-xl border ${cls} px-4 py-3 mt-4 flex items-center gap-3 text-sm font-semibold">
    <span class="text-2xl">${emoji}</span>
    <span class="flex-1">${msg}</span>
    <span class="text-[10px] opacity-50 flex-shrink-0">${totalCount} txns</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Cash Flow Ratio Bar
// ---------------------------------------------------------------------------
function renderCashFlowBar(totalIncome, totalExpense, savingsRate) {
  const card = document.getElementById("cashflow-bar-card");
  if (!card) return;
  const total = totalIncome + totalExpense;
  if (total <= 0) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const incPct = (totalIncome / total * 100);
  const expPct = (totalExpense / total * 100);
  const net = totalIncome - totalExpense;
  setText("cf-income-amt", formatINR(totalIncome));
  setText("cf-expense-amt", formatINR(totalExpense));
  const netEl = document.getElementById("cf-net-amt");
  if (netEl) {
    netEl.textContent = (net >= 0 ? "+" : "−") + formatINR(Math.abs(net));
    netEl.style.color = net >= 0 ? "#059669" : "#dc2626";
  }
  const incBar = document.getElementById("cf-income-bar");
  const expBar = document.getElementById("cf-expense-bar");
  const gapPx = 3;
  if (incBar) incBar.style.width = `calc(${incPct.toFixed(1)}% - ${gapPx / 2}px)`;
  if (expBar) expBar.style.width = `calc(${expPct.toFixed(1)}% - ${gapPx / 2}px)`;
  setText("cf-income-pct", incPct.toFixed(1) + "%");
  setText("cf-expense-pct", expPct.toFixed(1) + "%");
  const rate = typeof savingsRate === "number" ? savingsRate : 0;
  setText("cf-savings-label", `Savings rate ${rate >= 0 ? rate.toFixed(1) : "0.0"}%`);
}

// ---------------------------------------------------------------------------
// Key Insights Strip
// ---------------------------------------------------------------------------
function renderInsightStrip(monthlyData, categoriesData) {
  const strip = document.getElementById("insights-strip");
  if (!strip) return;
  const months = Array.isArray(monthlyData) ? monthlyData : [];
  const cats   = Array.isArray(categoriesData) ? categoriesData : [];
  if (!months.length && !cats.length) { strip.classList.add("hidden"); return; }

  const prev     = window._analyticsPrev || { monthly: [], byCategory: [], merchants: [], label: "vs prior period", hasData: false };
  const hasPrev  = !!prev.hasData;
  const priorLbl = prev.label || "vs prior period";

  // Totals
  const totalExp  = months.reduce((s, m) => s + (m.total_expense || 0), 0);
  const totalInc  = months.reduce((s, m) => s + (m.total_income || 0), 0);
  const pTotalExp = (prev.monthly || []).reduce((s, m) => s + (m.total_expense || 0), 0);
  const savRate   = totalInc > 0 ? ((totalInc - totalExp) / totalInc * 100) : 0;

  // Always-on fallbacks (current period only)
  const topCat = [...cats].filter(c => (c.total_expense || 0) > 0)
    .sort((a, b) => b.total_expense - a.total_expense)[0] || null;
  const merchants = Array.isArray(window._lastMerchantData) ? window._lastMerchantData : [];
  const topMer = merchants.length
    ? [...merchants].filter(m => (m.total_spend || 0) > 0)
        .sort((a, b) => (b.total_spend || 0) - (a.total_spend || 0))[0] || null
    : null;

  // Movers (only meaningful when prior data is loaded)
  const catMover = hasPrev
    ? (computeTopMovers(cats, prev.byCategory, { key: "category", valueKey: "total_expense", n: 1 })[0] || null)
    : null;
  const merMover = hasPrev
    ? (computeTopMovers(merchants, prev.merchants, { key: "merchant", valueKey: "total_spend", n: 1 })[0] || null)
    : null;

  // Last-vs-prior-month trend (unchanged spirit, kept as a fallback last tile)
  let trendPct = null, trendUp = true;
  if (months.length >= 2) {
    const last = months[months.length - 1].total_expense || 0;
    const prevM = months[months.length - 2].total_expense || 0;
    if (prevM > 0) { trendPct = ((last - prevM) / prevM * 100); trendUp = trendPct >= 0; }
  }

  const tiles = [];

  // Tile 1: Total spend (with prior delta when available)
  tiles.push({
    label: "Total Spend",
    value: formatINR(totalExp),
    sub: hasPrev
      ? `${escHtml(priorLbl)} ${_deltaPillHtml(totalExp, pTotalExp, { betterIsHigher: false })}`
      : `${months.length} month${months.length === 1 ? "" : "s"}`,
    icon: "payments", color: "text-rose-400",
    href: reportsUrl({ direction: "withdrawal" }),
  });

  // Tile 2: Biggest category mover (or top category when no prior)
  if (catMover) {
    tiles.push({
      label: "Biggest Category Mover",
      value: catMover.name,
      sub: `${escHtml(priorLbl)} ${_deltaPillHtml(catMover.curr, catMover.prev, { betterIsHigher: false })}`,
      icon: "trending_up", color: "text-slate-400",
      href: reportsUrl({ tag: catMover.name }),
    });
  } else if (topCat) {
    tiles.push({
      label: "Top Category",
      value: topCat.category,
      sub: formatINR(topCat.total_expense),
      icon: "category", color: "text-slate-400",
      href: reportsUrl({ tag: topCat.category }),
    });
  }

  // Tile 3: Biggest merchant mover (or top merchant when no prior)
  if (merMover) {
    tiles.push({
      label: "Biggest Merchant Mover",
      value: merMover.name,
      sub: `${escHtml(priorLbl)} ${_deltaPillHtml(merMover.curr, merMover.prev, { betterIsHigher: false })}`,
      icon: "storefront", color: "text-slate-400",
      href: reportsUrl({ vendor: merMover.name }),
    });
  } else if (topMer) {
    const mName = topMer.merchant || topMer.vendor_name || "—";
    tiles.push({
      label: "Top Merchant",
      value: mName,
      sub: formatINR(topMer.total_spend || 0),
      icon: "storefront", color: "text-slate-400",
      href: reportsUrl({ vendor: mName }),
    });
  }

  // Tile 4: Savings rate (with delta) — falls back to last-month trend
  if (hasPrev) {
    const pInc = (prev.monthly || []).reduce((s, m) => s + (m.total_income || 0), 0);
    const pNet = pInc - pTotalExp;
    const pSav = pInc > 0 ? (pNet / pInc * 100) : 0;
    tiles.push({
      label: "Savings Rate",
      value: `${savRate.toFixed(1)}%`,
      sub: `${escHtml(priorLbl)} ${_deltaPillHtml(savRate, pSav, { betterIsHigher: true })}`,
      icon: "savings", color: "text-amber-400",
      href: reportsUrl({}),
    });
  } else {
    tiles.push({
      label: "Spend Trend (last vs prior mo)",
      value: trendPct !== null ? `${trendUp ? "↑" : "↓"} ${Math.abs(trendPct).toFixed(1)}%` : "—",
      sub: months.length ? "click for last month" : "no data",
      icon: trendUp ? "trending_up" : "trending_down",
      color: trendUp ? "text-rose-400" : "text-emerald-400",
      href: months.length
        ? (() => {
            const m = months[months.length - 1].month; // YYYY-MM
            const [y, mo] = m.split("-");
            const last = new Date(+y, +mo, 0).getDate();
            return `/reports/?from_date=${m}-01&to_date=${m}-${String(last).padStart(2, "0")}&direction=withdrawal`;
          })()
        : "#",
    });
  }

  strip.innerHTML = tiles.map(t => `
    <a href="${escHtml(t.href)}" class="rounded-xl border border-slate-200 bg-white dark:bg-slate-800 px-3 py-2.5 flex items-start gap-2.5 shadow-sm hover:border-primary/40 hover:shadow-md transition-all">
      <span class="material-symbols-outlined text-[22px] mt-0.5 shrink-0 ${escHtml(t.color)}" style="font-variation-settings:'FILL' 1">${escHtml(t.icon)}</span>
      <div class="min-w-0">
        <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">${escHtml(t.label)}</p>
        <p class="text-sm font-black text-slate-800 dark:text-white truncate mt-0.5">${escHtml(t.value)}</p>
        <p class="text-[10px] text-slate-400 truncate flex items-center gap-1">${t.sub}</p>
      </div>
    </a>
  `).join("");
  strip.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Monthly flow chart (grouped bars + net line)
// ---------------------------------------------------------------------------
function renderMonthlyChart(rows) {
  const canvas = document.getElementById("monthly-chart");
  const empty  = document.getElementById("monthly-empty");
  if (!canvas) return;

  if (!rows.length) { canvas.classList.add("hidden"); if (empty) empty.classList.remove("hidden"); return; }
  canvas.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");

  const labels      = rows.map(r => r.month);
  const expenseData = rows.map(r => r.total_expense  || 0);
  const incomeData  = rows.map(r => r.total_income   || 0);
  const netData     = rows.map(r => (r.total_income||0) - (r.total_expense||0));

  if (monthlyChartInstance) { monthlyChartInstance.destroy(); monthlyChartInstance = null; }

  const isLine = currentChartType === "line";
  monthlyChartInstance = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: isLine ? "line" : "bar",
          label: "Income",
          data: incomeData,
          backgroundColor: "#6ee7b7cc",
          borderColor: "#059669",
          borderWidth: isLine ? 2 : 0,
          pointRadius: isLine ? 3 : 0,
          tension: 0.3,
          order: 2,
        },
        {
          type: isLine ? "line" : "bar",
          label: "Expense",
          data: expenseData,
          backgroundColor: "#fca5a5cc",
          borderColor: "#dc2626",
          borderWidth: isLine ? 2 : 0,
          pointRadius: isLine ? 3 : 0,
          tension: 0.3,
          order: 3,
        },
        {
          type: "line",
          label: "Net Savings",
          data: netData,
          borderColor: "#137fec",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: netData.map(v => v >= 0 ? "#137fec" : "#dc2626"),
          tension: 0.3,
          yAxisID: "y",
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { font: { family: "Manrope", size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${shortINR(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "Manrope", size: 10 } } },
        y: {
          grid: { color: "#f1f5f9" },
          ticks: { font: { family: "Manrope", size: 10 }, callback: v => shortINR(v) },
        },
      },
    },
  });
}

function setChartType(type) {
  currentChartType = type;
  const barBtn  = document.getElementById("chart-type-bar");
  const lineBtn = document.getElementById("chart-type-line");
  const on  = "h-8 rounded-lg bg-primary px-3 text-xs font-bold text-white";
  const off = "h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50";
  if (barBtn)  barBtn.className  = type === "bar"  ? on : off;
  if (lineBtn) lineBtn.className = type === "line" ? on : off;
  if (monthlyChartInstance) {
    const rows = monthlyChartInstance.data.labels.map((month, i) => ({
      month,
      total_income:  monthlyChartInstance.data.datasets[0].data[i],
      total_expense: monthlyChartInstance.data.datasets[1].data[i],
    }));
    renderMonthlyChart(rows);
  }
}

// ---------------------------------------------------------------------------
// Savings rate trend (line chart)
// ---------------------------------------------------------------------------
function renderSavingsRateChart(rows) {
  const canvas = document.getElementById("savings-rate-chart");
  const empty  = document.getElementById("savings-rate-empty");
  if (!canvas) return;

  const validRows = rows.filter(r => (r.total_income||0) > 0);
  if (!validRows.length) {
    canvas.classList.add("hidden");
    if (empty) empty.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");

  const labels = validRows.map(r => r.month);
  const rates  = validRows.map(r => {
    const inc = r.total_income || 0;
    const exp = r.total_expense || 0;
    return inc > 0 ? parseFloat(((inc - exp) / inc * 100).toFixed(1)) : 0;
  });

  if (savingsChartInstance) { savingsChartInstance.destroy(); savingsChartInstance = null; }

  savingsChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Savings Rate %",
        data: rates,
        borderColor: "#137fec",
        backgroundColor: "rgba(19,127,236,0.08)",
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: rates.map(v => v >= 20 ? "#059669" : v >= 0 ? "#d97706" : "#dc2626"),
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` Savings rate: ${ctx.raw}%`,
            afterLabel: ctx => ctx.raw >= 20 ? " Good!" : ctx.raw >= 0 ? " Moderate" : " Overspending",
          },
        },
        annotation: { annotations: {} },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: "Manrope", size: 9 } } },
        y: {
          grid: { color: "#f1f5f9" },
          ticks: { font: { family: "Manrope", size: 9 }, callback: v => v + "%" },
          suggestedMin: Math.min(...rates, 0) - 5,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Category donut chart
// ---------------------------------------------------------------------------
function renderCategoryDonut(rows) {
  const canvas = document.getElementById("category-donut");
  const legend = document.getElementById("category-legend");
  const totalEl = document.getElementById("donut-total");
  if (!canvas || !legend) return;

  const filtered = rows
    .filter(r => r.category !== "Untagged" && (r.total_expense||0) > 0)
    .sort((a,b) => b.total_expense - a.total_expense)
    .slice(0, 8);

  if (!filtered.length) {
    legend.innerHTML = '<p class="text-xs text-slate-400">No tagged expenses yet.</p>';
    return;
  }

  const total  = filtered.reduce((s,r) => s+(r.total_expense||0), 0);
  const labels = filtered.map(r => r.category);
  const data   = filtered.map(r => r.total_expense||0);

  if (totalEl) totalEl.textContent = shortINR(total);

  if (donutChartInstance) { donutChartInstance.destroy(); donutChartInstance = null; }

  donutChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: filtered.map(r => _getCatColor(r.category)),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      onClick: (evt, elements) => {
        if (!elements || !elements.length) return;
        const idx = elements[0].index;
        const label = labels[idx];
        if (label) window.location.href = reportsUrl({ tag: label });
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? "pointer" : "default";
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${shortINR(ctx.raw)} (${(ctx.raw/total*100).toFixed(1)}%)`,
          },
        },
      },
    },
  });

  legend.innerHTML = filtered.map((row, i) => {
    const pct = total > 0 ? (row.total_expense/total*100).toFixed(1) : 0;
    const url = reportsUrl({ tag: row.category });
    return `
      <a href="${escHtml(url)}" class="flex items-center gap-2 group">
        <span class="shrink-0 h-2.5 w-2.5 rounded-full" style="background:${_getCatColor(row.category)}"></span>
        <span class="flex-1 truncate text-xs font-semibold text-slate-700 group-hover:text-primary">${row.category}</span>
        <span class="text-xs font-black text-slate-500">${pct}%</span>
      </a>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Top merchants
// ---------------------------------------------------------------------------
function renderMerchants(rows) {
  const container = document.getElementById("merchant-list");
  if (!container) return;
  container.innerHTML = skeletonRows(5, 2);

  const filtered = rows.filter(r => (r.total_spend||0) > 0).slice(0, 8);
  if (!filtered.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No merchant data for this period.</p>';
    return;
  }

  const maxSpend = Math.max(...filtered.map(r => r.total_spend||0));
  container.innerHTML = filtered.map((row, i) => {
    const pct  = maxSpend > 0 ? Math.round((row.total_spend||0)/maxSpend*100) : 0;
    const name = row.merchant || row.vendor_name || "Unknown";
    const url  = reportsUrl({ vendor: name });
    const color = CAT_COLORS[i % CAT_COLORS.length];
    return `
      <a href="${url}" class="block group">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold text-slate-700 group-hover:text-primary truncate max-w-[55%]">${name}</span>
          <span class="text-sm font-black text-slate-800 flex-shrink-0">${formatINR(row.total_spend||0)}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div class="h-full rounded-full transition-all duration-500" style="width:${pct}%;background:${color}"></div>
        </div>
        <p class="mt-0.5 text-[10px] text-slate-400">${row.transaction_count} transactions · avg ${shortINR(row.avg_spend||0)}</p>
      </a>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// By source
// ---------------------------------------------------------------------------
function renderSources(rows, prevRows = []) {
  const container = document.getElementById("source-list");
  if (!container) return;
  container.innerHTML = skeletonRows(4, 2);

  const filtered = rows.filter(r => (r.total_expense||0) > 0);
  if (!filtered.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No source data for this period.</p>';
    return;
  }

  // Map prior totals by source name so we can render a delta pill per row.
  const prevMap = new Map();
  (prevRows || []).forEach(r => { if (r && r.payment_source) prevMap.set(r.payment_source, Number(r.total_expense || 0)); });
  const hasPrev = (prevRows || []).length > 0;

  const maxSpend = Math.max(...filtered.map(r => r.total_expense||0));
  container.innerHTML = filtered.map(row => {
    const pct    = maxSpend > 0 ? Math.round((row.total_expense||0)/maxSpend*100) : 0;
    const income = row.total_income || 0;
    const url    = reportsUrl({ source: row.payment_source });
    const delta  = hasPrev ? _deltaPillHtml(row.total_expense || 0, prevMap.get(row.payment_source) || 0, { betterIsHigher: false }) : "";
    return `
      <a href="${escHtml(url)}" class="block group">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-semibold text-slate-700 group-hover:text-primary truncate max-w-[55%]">${escHtml(row.payment_source)}</span>
          <span class="text-sm font-black text-slate-800 flex-shrink-0">${formatINR(row.total_expense||0)}${delta}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div class="h-full rounded-full bg-slate-400 transition-all duration-500" style="width:${pct}%"></div>
        </div>
        <p class="mt-0.5 text-[10px] text-slate-400">${row.transaction_count} txns${income>0 ? ' · '+formatINR(income)+' in':''}</p>
      </a>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Source filter
// ---------------------------------------------------------------------------
function populateSourceFilter(sourceRows) {
  const select = document.getElementById("analytics-source");
  if (!select) return;
  const current = select.value;
  while (select.options.length > 1) select.remove(1);
  sourceRows.forEach(row => {
    if (!row.payment_source || row.payment_source === "Unknown") return;
    const opt = document.createElement("option");
    opt.value = row.payment_source;
    opt.textContent = row.payment_source;
    if (row.payment_source === current) opt.selected = true;
    select.appendChild(opt);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = d => d.toISOString().split("T")[0];
  const fromEl = document.getElementById("analytics-from");
  const toEl   = document.getElementById("analytics-to");
  if (fromEl) fromEl.value = fmt(firstOfMonth);
  if (toEl)   toEl.value   = fmt(today);
  // Apply initial drill-through hrefs so KPI/etc. links work even before
  // loadAnalytics resolves (cards render via Jinja SSR with totals).
  _applyDrillThroughHrefs();
  loadAnalytics();
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeWatchlistModal(); });

  // Period pill clicks inside watchlist modal
  document.getElementById("watchlist-modal")?.addEventListener("click", e => {
    const pill = e.target.closest(".modal-period-btn");
    if (pill) _setModalPeriod(pill.dataset.preset);
  });

  // Delegated click handler for watchlist cards — survives innerHTML re-renders
  document.getElementById("tracked-grid")?.addEventListener("click", e => {
    const removeBtn = e.target.closest("[data-wl-remove]");
    if (removeBtn) {
      const card = removeBtn.closest("[data-wl-name]");
      if (card) removeTracked(card.dataset.wlName);
      return;
    }
    const budgetBtn = e.target.closest("[data-set-budget]");
    if (budgetBtn) { openBudgetModal(budgetBtn.dataset.setBudget); return; }

    const card = e.target.closest("[data-wl-name]");
    if (card) {
      const { wlName, wlIdx, wlColor } = card.dataset;
      openWatchlistModal(wlName, parseInt(wlIdx), wlColor);
    }
  });

  document.getElementById("budget-modal-cancel")?.addEventListener("click", closeBudgetModal);
  document.getElementById("budget-modal-save")?.addEventListener("click", saveBudget);
  document.getElementById("budget-modal-clear")?.addEventListener("click", clearBudget);
  document.getElementById("budget-modal-overlay")?.addEventListener("click", closeBudgetModal);
  document.getElementById("budget-modal-amount")?.addEventListener("keydown", e => { if (e.key === "Enter") saveBudget(); });

  document.getElementById("load-comparison-btn")?.addEventListener("click", loadComparison);
  document.getElementById("recurring-debits-only")?.addEventListener("change", loadRecurring);

  // Counterparty panel: delegated click on [data-cp-name]
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-cp-name]");
    if (el) { e.stopPropagation(); openCpPanel(el.dataset.cpName); }
  });

  loadRecurring();
});

window.addEventListener("pageshow", (event) => {
  const isHistoryReturn = event.persisted
    || performance.getEntriesByType?.("navigation")?.[0]?.type === "back_forward";
  if (isHistoryReturn) loadAnalytics();
});

function openBudgetModal(category) {
  _budgetModalCategory = category;
  const existing = _budgetsMap[category.toLowerCase()];
  const el = document.getElementById("budget-modal-title");
  const budgetMonthLabel = _analyticsBudgetMonthStart
    ? new Date(_analyticsBudgetMonthStart + "T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "active month";
  if (el) el.textContent = `Monthly budget for ${category} (${budgetMonthLabel})`;
  const inp = document.getElementById("budget-modal-amount");
  if (inp) { inp.value = existing ? existing.budget_amount : ""; inp.focus(); }
  const clearBtn = document.getElementById("budget-modal-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !existing?.id);
  const hintEl = document.getElementById("budget-spend-hint");
  if (hintEl) {
    const spent = existing?.spent || 0;
    if (spent > 0) {
      hintEl.textContent = `${formatINR(spent)} tagged as "${category}" in ${budgetMonthLabel}`;
      hintEl.className = "text-xs text-emerald-600 mt-1.5";
    } else {
      hintEl.textContent = `No transactions tagged as "${category}" found in ${budgetMonthLabel}`;
      hintEl.className = "text-xs text-amber-600 mt-1.5";
    }
  }
  document.getElementById("budget-set-modal")?.classList.remove("hidden");
}

function closeBudgetModal() {
  document.getElementById("budget-set-modal")?.classList.add("hidden");
  _budgetModalCategory = null;
}

async function clearBudget() {
  const cat = _budgetModalCategory;
  const existing = _budgetsMap[cat?.toLowerCase()];
  if (!existing?.id) return;
  await fetch(`/planning/category-budgets/${existing.id}`, { method: "DELETE" });
  closeBudgetModal();
  loadAnalytics();
}

async function saveBudget() {
  const cat = _budgetModalCategory;
  const amt = parseFloat(document.getElementById("budget-modal-amount")?.value);
  if (!cat || isNaN(amt) || amt <= 0) return;
  const today = new Date();
  const ms = _analyticsBudgetMonthStart || `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-01`;
  const resp = await fetch("/planning/category-budgets", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ tag_name: cat, budget_amount: amt, month_start: ms }),
  });
  const result = await resp.json();
  if (!result.success) { window.toast?.error(result.message || "Failed to save budget"); return; }
  closeBudgetModal();
  loadAnalytics();
}

// ── Monthly Comparison ──────────────────────────────────────────────────────
async function loadComparison() {
  const body = document.getElementById("comparison-body");
  if (body) body.innerHTML = `<p class="text-sm text-slate-400 text-center py-6">Loading…</p>`;

  const fmt = d => d.toISOString().split("T")[0];
  const today = new Date();
  const currStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevEnd   = new Date(today.getFullYear(), today.getMonth(), 0);
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const avg3Start = new Date(today.getFullYear(), today.getMonth() - 3, 1);

  const [curr, prev, avg3] = await Promise.all([
    safeLoad(`/reports/trends/by_category?from_date=${fmt(currStart)}&to_date=${fmt(today)}`),
    safeLoad(`/reports/trends/by_category?from_date=${fmt(prevStart)}&to_date=${fmt(prevEnd)}`),
    safeLoad(`/reports/trends/by_category?from_date=${fmt(avg3Start)}&to_date=${fmt(prevEnd)}`),
  ]);

  const toMap = arr => Object.fromEntries((arr||[]).map(r => [r.category, Math.max(0, (r.total_expense||0)+(r.total_invested||0)-(r.total_income||0))]));
  const currMap = toMap(curr), prevMap = toMap(prev), avg3Map = toMap(avg3);
  const cats = [...new Set([...Object.keys(currMap), ...Object.keys(prevMap)])].filter(c => c !== "Untagged");
  cats.sort((a, b) => (currMap[b]||0) - (currMap[a]||0));

  // Build row data with delta so we can sort
  let rowData = cats.slice(0, 20).map(cat => {
    const c = currMap[cat]||0, p = prevMap[cat]||0, a = (avg3Map[cat]||0) / 3;
    const delta = p > 0 ? ((c - p) / p * 100) : (c > 0 ? 100 : 0);
    return { cat, c, p, a, delta };
  });

  // Current sort state stored on the comparison body element
  const sortState = body?._sortByVariance || false;
  if (sortState) rowData.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const { from, to } = getDateRange();
  const rows = rowData.map(({ cat, c, p, a, delta }) => {
    const arrow = delta > 10 ? "▲" : delta < -10 ? "▼" : "→";
    const rowBg = delta > 20 ? "bg-rose-50/40 hover:bg-rose-50" : delta < -20 ? "bg-emerald-50/30 hover:bg-emerald-50" : "hover:bg-slate-50";
    const arrowCls = delta > 10 ? "text-red-500 font-black" : delta < -10 ? "text-emerald-600 font-black" : "text-slate-400";
    const url = reportsUrl({ tag: cat });
    return `<tr class="border-t border-slate-100 ${rowBg} cursor-pointer" data-drill-cat="${escHtml(cat)}" title="View ${cat} in Reports">
      <td class="py-2 px-3 text-xs font-semibold text-slate-700 hover:text-primary hover:underline">${cat}</td>
      <td class="py-2 px-3 text-xs text-right font-bold text-slate-900">${c > 0 ? formatINR(c) : "—"}</td>
      <td class="py-2 px-3 text-xs text-right text-slate-500">${p > 0 ? formatINR(p) : "—"}</td>
      <td class="py-2 px-3 text-xs text-right text-slate-400">${a > 0 ? formatINR(a) : "—"}</td>
      <td class="py-2 px-3 text-xs text-right ${arrowCls}">${p > 0 ? `${arrow} ${Math.abs(delta).toFixed(0)}%` : "—"}</td>
    </tr>`;
  }).join("");

  if (body) {
    body.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead class="text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <tr>
              <th class="py-2 px-3">Category</th>
              <th class="py-2 px-3 text-right">This Month</th>
              <th class="py-2 px-3 text-right">Last Month</th>
              <th class="py-2 px-3 text-right">3-Mo Avg</th>
              <th class="py-2 px-3 text-right">
                <button type="button" id="cmp-sort-btn" class="inline-flex items-center gap-1 hover:text-primary transition-colors">
                  Change ${sortState ? '<span class="material-symbols-outlined text-[11px]">sort</span>' : '<span class="material-symbols-outlined text-[11px] opacity-40">sort</span>'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    // Wire sort toggle
    body._sortByVariance = sortState;
    document.getElementById("cmp-sort-btn")?.addEventListener("click", () => {
      body._sortByVariance = !body._sortByVariance;
      loadComparison();
    });
    // Wire row drill-through
    body.querySelectorAll("[data-drill-cat]").forEach(row => {
      row.addEventListener("click", () => {
        const cat = row.dataset.drillCat;
        if (cat) window.open(reportsUrl({ tag: cat }), "_blank");
      });
    });
  }
}

// ── Recurring Transactions ───────────────────────────────────────────────────
async function loadRecurring() {
  const list = document.getElementById("recurring-list");
  if (list) list.innerHTML = skeletonRows(6, 2);
  const resp = await safeLoad("/reports/recurring");
  const debitsOnly = document.getElementById("recurring-debits-only")?.checked;
  const data = (resp || []).filter(r => !debitsOnly || r.direction === "withdrawal");

  if (!data.length) {
    if (list) list.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">No recurring patterns found in the last 6 months.</p>`;
    return;
  }
  if (list) list.innerHTML = data.slice(0, 30).map(r => {
    const missingBadge = !r.seen_this_month
      ? `<span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Not seen this month</span>`
      : "";
    const dirColor = r.direction === "withdrawal" ? "text-red-600" : "text-emerald-600";
    return `<div class="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                 data-cp-name="${escAttr(r.merchant)}">
      <div class="min-w-0 flex-1">
        <span class="text-xs font-semibold text-slate-700 truncate">${r.merchant}</span>
        ${missingBadge}
        <span class="ml-2 text-[10px] text-slate-400">${r.months_seen}/6 months</span>
      </div>
      <span class="text-xs font-black ${dirColor} flex-shrink-0">${formatINR(r.avg_amount)}/mo</span>
      <a href="${escHtml(reportsUrl({ vendor: r.merchant }))}" onclick="event.stopPropagation()"
         title="View transactions in Reports"
         class="ml-2 inline-flex items-center text-slate-400 hover:text-primary">
        <span class="material-symbols-outlined text-[16px]">open_in_new</span>
      </a>
    </div>`;
  }).join("");

  // Update committed KPI card using all recurring debits (not filtered by debitsOnly toggle)
  const allDebits = (resp || []).filter(r => r.direction === "withdrawal");
  const committedTotal = allDebits.reduce((s, r) => s + (r.avg_amount || 0), 0);
  const committedEl    = document.getElementById("kpi-committed");
  const committedSub   = document.getElementById("kpi-committed-sub");
  if (committedEl) committedEl.textContent = committedTotal > 0 ? shortINR(committedTotal) : "—";
  if (committedSub) committedSub.textContent = allDebits.length > 0
    ? `${allDebits.length} recurring expense${allDebits.length === 1 ? "" : "s"}`
    : "no recurring found";
}

// ── Counterparty Profile Panel ───────────────────────────────────────────────
async function openCpPanel(merchant) {
  const panel = document.getElementById("cp-panel");
  const nameEl = document.getElementById("cp-name");
  const summary = document.getElementById("cp-summary");
  const listEl = document.getElementById("cp-list");
  if (!panel) return;
  if (nameEl) nameEl.textContent = merchant;
  if (summary) summary.textContent = "Loading…";
  if (listEl) listEl.innerHTML = "";
  panel.classList.remove("hidden");
  panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = "";

  const resp = await fetch("/reports/transactions_filter", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ vendor_filter: merchant }),
  });
  const result = await resp.json();
  const txns = result.data || [];
  const total = txns.reduce((s, t) => s + (t.direction === "withdrawal" ? -(t.amount||0) : (t.amount||0)), 0);
  const spent = txns.filter(t => t.direction==="withdrawal").reduce((s,t) => s+(t.amount||0), 0);
  const rcvd  = txns.filter(t => t.direction!=="withdrawal").reduce((s,t) => s+(t.amount||0), 0);
  if (summary) summary.innerHTML = `${txns.length} transactions · <span class="text-red-600">−${formatINR(spent)}</span> spent · <span class="text-emerald-600">+${formatINR(rcvd)}</span> received`;
  if (listEl) listEl.innerHTML = txns.slice(0,50).map(t => {
    const isOut = t.direction === "withdrawal";
    return `<div class="flex items-center justify-between text-xs rounded-lg border border-slate-100 px-3 py-2">
      <div class="min-w-0">
        <p class="font-semibold text-slate-700 truncate">${t.narration || t.vendor_name || "—"}</p>
        <p class="text-slate-400">${t.transaction_date}</p>
      </div>
      <span class="font-bold flex-shrink-0 ${isOut ? "text-red-600" : "text-emerald-600"}">${isOut ? "−" : "+"}${formatINR(t.amount)}</span>
    </div>`;
  }).join("");
}

function closeCpPanel() {
  document.getElementById("cp-panel")?.classList.add("hidden");
}
