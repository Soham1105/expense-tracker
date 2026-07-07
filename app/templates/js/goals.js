/* goals.js */

function fmt(v) {
  return "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtFull(v) {
  return "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function escH(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function formatDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysRemaining(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  return diff;
}

// ── Priority styling ──────────────────────────────────────────────────────────
function priorityBadge(p) {
  const map = {
    urgent:       { label: "Urgent",       cls: "bg-rose-100 text-rose-700" },
    must_have:    { label: "Must have",    cls: "bg-rose-100 text-rose-700" },
    high:         { label: "High",         cls: "bg-amber-100 text-amber-700" },
    important:    { label: "Important",    cls: "bg-amber-100 text-amber-700" },
    normal:       { label: "Normal",       cls: "bg-slate-100 text-slate-600" },
    nice_to_have: { label: "Nice to have", cls: "bg-sky-100 text-sky-600" },
  };
  const m = map[p] || map.normal;
  return `<span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${m.cls}">${m.label}</span>`;
}

// ── Render planned expenses ───────────────────────────────────────────────────
let _monthlySurplus = 0;  // income − spend this month, for affordability hints
let _activeBudgetMonth = null;

function parseLocalDate(value) {
  if (!value) return null;
  const date = new Date(String(value).slice(0, 10) + "T00:00:00");
  return Number.isNaN(date.getTime()) ? null : date;
}

function askGoalChoice({ title, message, yesLabel = "Yes", noLabel = "No", cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const existing = document.getElementById("goal-choice-dialog");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "goal-choice-dialog";
    overlay.className = "fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm";
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300">
            <span class="material-symbols-outlined text-[22px]">help</span>
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-black text-slate-950 dark:text-slate-100">${escH(title)}</h3>
            <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">${escH(message)}</p>
          </div>
        </div>
        <div class="mt-5 grid grid-cols-3 gap-2">
          <button data-choice="no" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">${escH(noLabel)}</button>
          <button data-choice="cancel" class="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">${escH(cancelLabel)}</button>
          <button data-choice="yes" class="rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-rose-700">${escH(yesLabel)}</button>
        </div>
      </div>
    `;

    const close = (choice) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(choice);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close("cancel");
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("cancel");
      const button = event.target.closest("[data-choice]");
      if (button) close(button.dataset.choice);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

function renderPlannedExpenses(planned) {
  const container = document.getElementById("plannedExpenseList");
  if (!container) return;
  const allItems = Array.isArray(planned?.items) ? planned.items : [];
  const active    = allItems.filter(i => i.status !== "completed" && i.status !== "cancelled");
  const completed = allItems.filter(i => i.status === "completed");
  // Soonest-due first (overdue at top); undated last.
  active.sort((a, b) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return da - db;
  });

  setText("plannedTotal", fmt(planned?.total_open || 0));
  setText("plannedCount", `${active.length} upcoming target${active.length !== 1 ? "s" : ""}`);

  if (!allItems.length) {
    container.innerHTML = `
      <div class="py-8 text-center">
        <span class="material-symbols-outlined text-4xl text-slate-200">event_upcoming</span>
        <p class="mt-2 text-sm text-slate-400">No planned expenses yet.</p>
        <p class="text-xs text-slate-400">Add bills, trips, or fees you know are coming.</p>
      </div>`;
    return;
  }

  const now   = new Date();
  const monthRef = _activeBudgetMonth || now;
  const thisY = monthRef.getFullYear(), thisM = monthRef.getMonth();

  const activeHtml = active.map(item => {
    const days = daysRemaining(item.due_date);
    const dd   = parseLocalDate(item.due_date);
    const overdue = dd && dd < now;
    const inMon   = dd && dd.getFullYear() === thisY && dd.getMonth() === thisM;
    const daysLabel = days === null ? "" :
      days < 0   ? `<span class="text-rose-600 font-bold text-[11px]">Overdue ${Math.abs(days)}d</span>` :
      days === 0  ? `<span class="text-rose-600 font-bold text-[11px]">Due today</span>` :
      days <= 7   ? `<span class="text-amber-600 font-bold text-[11px]">In ${days} days</span>` :
                    `<span class="text-slate-400 text-[11px]">In ${days} days</span>`;
    const freq = item.frequency && item.frequency !== "one_time"
      ? `<span class="rounded-full bg-slate-100 dark:bg-slate-700/80 px-2 py-0.5 text-[10px] text-slate-500 dark:text-slate-300">${escH(item.frequency.replace(/_/g, " "))}</span>` : "";
    const cardBorder = overdue
      ? "border-rose-300 bg-rose-50/50 dark:border-rose-500/35 dark:bg-rose-500/10"
      : "border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-800/70";
    return `
      <div class="goal-item-row rounded-xl border ${cardBorder} px-4 py-3" id="planned-row-${item.id}">
        <div class="goal-row-content flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <p class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">${escH(item.title)}</p>
              ${inMon && !overdue ? `<span class="rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-300">This month</span>` : ""}
              ${overdue ? `<span class="rounded-full bg-rose-100 dark:bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold text-rose-600 dark:text-rose-300">Overdue</span>` : ""}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-slate-400 dark:text-slate-500">${formatDate(item.due_date)}</span>
              ${daysLabel}
              ${freq}
              ${item.category ? `<span class="rounded-full bg-primary/10 dark:bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary dark:text-indigo-300">${escH(item.category)}</span>` : ""}
            </div>
          </div>
          <p class="text-sm font-black text-slate-900 dark:text-slate-100 shrink-0">${fmt(item.amount)}</p>
        </div>
        <div class="goal-action-bar">
          <button onclick="startEditPlanned('${item.id}')" title="Edit"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:text-primary hover:bg-primary/10 transition-colors">
            <span class="material-symbols-outlined text-[17px]">edit</span>
          </button>
          <button onclick="markPlannedComplete('${item.id}')" title="Mark complete"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
            <span class="material-symbols-outlined text-[17px]">check_circle</span>
          </button>
          <button onclick="deletePlannedExpense('${item.id}')" title="Delete"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
            <span class="material-symbols-outlined text-[17px]">delete</span>
          </button>
        </div>
        ${item.notes ? `<p class="mt-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-50 dark:border-slate-700/70 pt-2">${escH(item.notes)}</p>` : ""}
        <div id="planned-edit-${item.id}" class="hidden mt-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900/80" style="border-left:4px solid var(--primary,#607AFB)">
          <div class="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100 dark:bg-slate-800/80 dark:border-slate-700">
            <span class="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide">
              <span class="material-symbols-outlined text-[14px] text-primary">edit</span>Edit expense
            </span>
            <button onclick="cancelEditPlanned('${item.id}')" class="rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 transition-colors">
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Title</label>
              <input id="pET-${item.id}" value="${escH(item.title)}" placeholder="e.g. School fees"
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-slate-500 mb-1">Amount</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none" data-rupee></span>
                  <input id="pEA-${item.id}" type="number" min="0" step="1" value="${item.amount || ""}" placeholder="0"
                    class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800" />
                </div>
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Due date</label>
                <input id="pED-${item.id}" type="date" value="${item.due_date || ""}"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800" />
              </div>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">Priority</label>
              <select id="pEP-${item.id}"
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary focus:bg-white transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800">
                ${["low","normal","high","urgent"].map(v =>
                  `<option value="${v}"${item.priority === v ? " selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}
              </select>
            </div>
            <div class="flex gap-2 pt-1">
              <button onclick="cancelEditPlanned('${item.id}')"
                class="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
              <button onclick="saveEditPlanned('${item.id}')"
                class="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-white hover:bg-primary/90 transition-colors">Save changes</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");

  const completedHtml = completed.length ? `
    <div class="mt-4 border-t border-slate-100 dark:border-slate-700/70 pt-3">
      <p class="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
        <span class="material-symbols-outlined text-[14px]">check_circle</span> Completed
      </p>
      <div class="space-y-1.5">
        ${completed.map(item => `
          <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-100/80 bg-emerald-50/55 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <p class="text-sm font-semibold text-slate-500 line-through truncate dark:text-slate-300">${escH(item.title)}</p>
            <p class="text-sm font-bold text-slate-400 shrink-0 dark:text-slate-400">${fmt(item.amount)}</p>
          </div>`).join("")}
      </div>
    </div>` : "";

  container.innerHTML = activeHtml + completedHtml;
}

// ── Render wishlist ───────────────────────────────────────────────────────────
function renderWishlist(wishlist) {
  const container = document.getElementById("wishlistList");
  if (!container) return;
  const allItems  = Array.isArray(wishlist?.items) ? wishlist.items : [];
  const openTotal = Number(wishlist?.total_open || 0);

  const active    = allItems.filter(i => i.status !== "completed");
  const completed = allItems.filter(i => i.status === "completed");

  setText("wishlistTotal", fmt(openTotal));
  setText("wishlistCount", `${active.length} item${active.length !== 1 ? "s" : ""}`);

  // Due-soon nudge chip
  const today = new Date();
  const dueSoon = active.filter(i => {
    if (!i.target_date) return false;
    const d = Math.ceil((new Date(i.target_date) - today) / 86400000);
    return d >= 0 && d <= 30;
  }).length;
  const dueSoonChip = dueSoon > 0
    ? `<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700 ml-2">
         <span class="material-symbols-outlined text-[13px]">schedule</span>${dueSoon} due soon
       </span>` : "";

  const subLabel = document.getElementById("wishlistSubLabel");
  if (subLabel) subLabel.innerHTML =
    `<span class="text-[11px] text-slate-400 italic">Quantify your dreams before you chase them.</span>${dueSoonChip}`;

  if (!allItems.length) {
    container.innerHTML = `
      <div class="py-10 text-center">
        <span class="material-symbols-outlined text-5xl text-slate-200">auto_awesome</span>
        <p class="mt-3 text-sm font-bold text-slate-500">Your wishlist is empty.</p>
        <p class="text-xs text-slate-400 mt-1">Start dreaming — your wallet needs a destination.</p>
      </div>`;
    return;
  }

  const now = new Date();
  const pLabel = { must_have: "Must have", important: "Important", nice_to_have: "Nice to have", urgent: "Urgent", high: "High", normal: "Normal" };

  const activeHtml = active.map(item => {
    const targetLine = item.target_date
      ? `<span class="text-[11px] text-slate-400">by ${formatDate(item.target_date)}</span>` : "";
    const days = daysRemaining(item.target_date);
    const td   = item.target_date ? new Date(item.target_date + "T00:00:00") : null;
    const overdue = td && td < now;
    const urgency = !overdue && days !== null && days >= 0 && days <= 7
      ? `<span class="text-[11px] font-bold text-rose-500">${days === 0 ? "Due today!" : `${days}d left`}</span>` : "";
    const cardBorder = overdue
      ? "border-rose-300 bg-rose-50/50 dark:border-rose-500/35 dark:bg-rose-500/10"
      : "border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-800/70";
    // Affordability vs this month's surplus
    const _amt = Number(item.expected_amount || 0);
    let affordChip = "";
    if (_amt > 0 && _monthlySurplus > 0) {
      affordChip = _monthlySurplus >= _amt
        ? `<span class="rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">affordable now</span>`
        : `<span class="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-300">~${Math.ceil(_amt / _monthlySurplus)} mo at current surplus</span>`;
    }
    return `
      <div class="goal-item-row rounded-xl border ${cardBorder} px-4 py-3" id="wishlist-row-${item.id}">
        <div class="goal-row-content flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <p class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">${escH(item.item_name)}</p>
              ${overdue ? `<span class="rounded-full bg-rose-100 dark:bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold text-rose-600 dark:text-rose-300">Overdue</span>` : ""}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
              ${item.target_date ? `<span class="text-[11px] text-slate-400 dark:text-slate-500">${formatDate(item.target_date)}</span>` : ""}
              ${urgency}
              ${priorityBadge(item.priority)}
              ${affordChip}
            </div>
          </div>
          <p class="text-sm font-black text-slate-900 dark:text-slate-100 shrink-0">${fmt(item.expected_amount || 0)}</p>
        </div>
        <div class="goal-action-bar">
          <button onclick="startEditWishlist('${item.id}')" title="Edit"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:bg-primary/10 hover:text-primary transition-colors">
            <span class="material-symbols-outlined text-[17px]">edit</span>
          </button>
          <button onclick="markWishlistBought('${item.id}')" title="Mark as bought"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 transition-colors">
            <span class="material-symbols-outlined text-[17px]">shopping_cart_checkout</span>
          </button>
          <button onclick="deleteWishlistItem('${item.id}')" title="Remove"
            class="p-1.5 rounded-full text-slate-500 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/20 transition-colors">
            <span class="material-symbols-outlined text-[17px]">delete</span>
          </button>
        </div>
        ${item.notes ? `<p class="mt-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700/70 pt-2">${escH(item.notes)}</p>` : ""}
        <div id="wishlist-edit-${item.id}" class="hidden mt-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900/80" style="border-left:4px solid #7c3aed">
          <div class="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100 dark:bg-slate-800/80 dark:border-slate-700">
            <span class="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide">
              <span class="material-symbols-outlined text-[14px] text-violet-500">edit</span>Edit item
            </span>
            <button onclick="cancelEditWishlist('${item.id}')" class="rounded p-0.5 text-slate-400 hover:text-slate-700 transition-colors">
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <div>
              <label class="block text-[11px] font-semibold text-slate-500 mb-1">Item name</label>
              <input id="wEN-${item.id}" value="${escH(item.item_name)}" placeholder="e.g. New phone"
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 focus:bg-white transition" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-semibold text-slate-500 mb-1">Expected amount</label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none" data-rupee></span>
                  <input id="wEA-${item.id}" type="number" min="0" step="1" value="${item.expected_amount || ""}" placeholder="0"
                    class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 focus:bg-white transition" />
                </div>
              </div>
              <div>
                <label class="block text-[11px] font-semibold text-slate-500 mb-1">Target date</label>
                <input id="wED-${item.id}" type="date" value="${item.target_date || ""}"
                  class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 focus:bg-white transition" />
              </div>
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-500 mb-1">Priority</label>
              <select id="wEP-${item.id}"
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 focus:bg-white transition">
                ${["nice_to_have","important","must_have","urgent"].map(v =>
                  `<option value="${v}"${item.priority === v ? " selected" : ""}>${pLabel[v] || v}</option>`).join("")}
              </select>
            </div>
            <div class="flex gap-2 pt-1">
              <button onclick="cancelEditWishlist('${item.id}')"
                class="flex-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onclick="saveEditWishlist('${item.id}')"
                class="flex-1 rounded-lg bg-violet-600 py-2 text-xs font-bold text-white hover:bg-violet-700 transition-colors">Save changes</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");

  const completedHtml = completed.length ? `
    <div class="mt-4 border-t border-slate-100 dark:border-slate-700/70 pt-3">
      <p class="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
        <span class="material-symbols-outlined text-[14px]">celebration</span> Bought it!
      </p>
      <div class="space-y-1.5">
        ${completed.map(item => `
          <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-100/80 bg-emerald-50/55 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <p class="text-sm font-semibold text-slate-500 line-through truncate dark:text-slate-300">${escH(item.item_name)}</p>
            <div class="flex items-center gap-2 shrink-0">
              <p class="text-sm font-bold text-slate-400 dark:text-slate-400">${fmt(item.expected_amount || 0)}</p>
              <button onclick="undoWishlistBought('${item.id}')" title="Move back to wishlist"
                      class="rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">
                Undo
              </button>
              <button onclick="deleteWishlistItem('${item.id}')" title="Delete item"
                      class="rounded-lg px-2 py-1 text-[10px] font-bold text-rose-400 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-300 dark:hover:bg-rose-500/15 transition-colors">
                Delete
              </button>
            </div>
          </div>`).join("")}
      </div>
    </div>` : "";

  container.innerHTML = activeHtml + completedHtml;
}

// ── Planned expenses CRUD ─────────────────────────────────────────────────────
function startEditPlanned(id) {
  document.querySelectorAll('[id^="planned-edit-"]').forEach(el => el.classList.add("hidden"));
  document.querySelectorAll('[id^="planned-row-"]').forEach(el => el.classList.remove("is-editing"));
  document.getElementById(`planned-edit-${id}`)?.classList.remove("hidden");
  document.getElementById(`planned-row-${id}`)?.classList.add("is-editing");
}
function cancelEditPlanned(id) {
  document.getElementById(`planned-edit-${id}`)?.classList.add("hidden");
  document.getElementById(`planned-row-${id}`)?.classList.remove("is-editing");
}
async function saveEditPlanned(id) {
  const payload = {
    title:    document.getElementById(`pET-${id}`)?.value?.trim(),
    amount:   Number(document.getElementById(`pEA-${id}`)?.value || 0),
    due_date: document.getElementById(`pED-${id}`)?.value || null,
    priority: document.getElementById(`pEP-${id}`)?.value,
  };
  try {
    const res = await fetch(`/planning/planned_expenses/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const r = await res.json();
    if (!r.success) throw new Error(r.message || "Update failed");
    await loadGoals();
    window.toast?.success("Updated");
  } catch(err) { window.toast?.error(err.message || "Update failed"); }
}
async function markPlannedComplete(id) {
  try {
    const res = await fetch(`/planning/planned_expenses/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const r = await res.json();
    if (!r.success) throw new Error(r.message || "Failed");
    window.launchConfetti?.();
    window.toast?.success("Marked complete!");
    await loadGoals();
  } catch(err) { window.toast?.error(err.message || "Failed"); }
}
async function deletePlannedExpense(id) {
  const choice = await askGoalChoice({
    title: "Delete planned expense?",
    message: "This removes it from your planned expenses list.",
    yesLabel: "Yes, delete",
    noLabel: "No",
    cancelLabel: "Cancel",
  });
  if (choice !== "yes") return;
  try {
    await fetch(`/planning/planned_expenses/${id}`, { method: "DELETE" });
    await loadGoals();
    window.toast?.success("Removed");
  } catch(err) { window.toast?.error(err.message || "Delete failed"); }
}

// ── Wishlist CRUD ─────────────────────────────────────────────────────────────
function startEditWishlist(id) {
  document.querySelectorAll('[id^="wishlist-edit-"]').forEach(el => el.classList.add("hidden"));
  document.querySelectorAll('[id^="wishlist-row-"]').forEach(el => el.classList.remove("is-editing"));
  document.getElementById(`wishlist-edit-${id}`)?.classList.remove("hidden");
  document.getElementById(`wishlist-row-${id}`)?.classList.add("is-editing");
}
function cancelEditWishlist(id) {
  document.getElementById(`wishlist-edit-${id}`)?.classList.add("hidden");
  document.getElementById(`wishlist-row-${id}`)?.classList.remove("is-editing");
}
async function saveEditWishlist(id) {
  const payload = {
    item_name:       document.getElementById(`wEN-${id}`)?.value?.trim(),
    expected_amount: Number(document.getElementById(`wEA-${id}`)?.value || 0),
    target_date:     document.getElementById(`wED-${id}`)?.value || null,
    priority:        document.getElementById(`wEP-${id}`)?.value,
  };
  try {
    const res = await fetch(`/planning/wishlist/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const r = await res.json();
    if (!r.success) throw new Error(r.message || "Update failed");
    await loadGoals();
    window.toast?.success("Wishlist updated");
  } catch(err) { window.toast?.error(err.message || "Update failed"); }
}

async function markWishlistBought(id) {
  await fetch(`/planning/wishlist/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed" }),
  });
  window.launchConfetti?.();
  window.toast?.success("You bought it! One dream achieved.");
  loadGoals();
}

async function undoWishlistBought(id) {
  await fetch(`/planning/wishlist/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "wishlist" }),
  });
  loadGoals();
}

async function deleteWishlistItem(id) {
  const choice = await askGoalChoice({
    title: "Delete wishlist item?",
    message: "This removes the item from your wishlist, including bought items.",
    yesLabel: "Yes, delete",
    noLabel: "No",
    cancelLabel: "Cancel",
  });
  if (choice !== "yes") return;
  await fetch(`/planning/wishlist/${id}`, { method: "DELETE" });
  loadGoals();
}

// ── Forms ─────────────────────────────────────────────────────────────────────
function bindToggle(btnId, panelId) {
  const btn   = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if (!btn || !panel) return;
  btn.addEventListener("click", () => {
    const open = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", open);
    btn.textContent = open ? btn.dataset.open || "Add" : btn.dataset.close || "Cancel";
  });
}

function normalizePayload(form) {
  const payload = {};
  new FormData(form).forEach((v, k) => {
    const s = String(v || "").trim();
    if (!s) return;
    payload[k] = ["amount", "expected_amount"].includes(k) ? Number(s) : s;
  });
  return payload;
}

function bindPlannedForm() {
  const form = document.getElementById("plannedExpenseForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const res = await fetch("/planning/planned_expenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || "Save failed");
      form.reset();
      document.getElementById("plannedFormPanel")?.classList.add("hidden");
      document.getElementById("addPlannedBtn").textContent = "Add expense";
      await loadGoals();
    } catch (err) {
      setText("plannedFormStatus", err.message || "Could not save.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save expense"; }
    }
  });
}

function bindWishlistForm() {
  const form = document.getElementById("wishlistForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const res = await fetch("/planning/wishlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || "Save failed");
      form.reset();
      document.getElementById("wishlistFormPanel")?.classList.add("hidden");
      document.getElementById("addWishlistBtn").textContent = "Add item";
      await loadGoals();
    } catch (err) {
      setText("wishlistFormStatus", err.message || "Could not save.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Save item"; }
    }
  });
}

// ── Recurring suggestions ─────────────────────────────────────────────────────

/* IDs of dismissed suggestions, persisted in localStorage */
function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem("rc_dismissed") || "[]")); }
  catch { return new Set(); }
}
function saveDismissed(set) {
  localStorage.setItem("rc_dismissed", JSON.stringify([...set]));
}

function freqLabel(f) {
  return { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }[f] || f;
}
function freqColor(f) {
  return { weekly: "bg-sky-100 text-sky-700", monthly: "bg-primary/10 text-primary",
           quarterly: "bg-violet-100 text-violet-700", yearly: "bg-amber-100 text-amber-700" }[f] || "bg-slate-100 text-slate-600";
}
function confidenceDot(c) {
  const col = { high: "#22c55e", medium: "#f59e0b", low: "#94a3b8" }[c] || "#94a3b8";
  const tip = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" }[c] || "";
  return `<span title="${tip}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:3px;vertical-align:middle"></span>`;
}

function renderRecurringSuggestions(items) {
  const container = document.getElementById("recurring-list");
  const countEl   = document.getElementById("recurring-count");
  const dismissAll = document.getElementById("recurring-dismiss-all");
  const section   = document.getElementById("recurring-section");
  if (!container) return;

  const dismissed = getDismissed();
  const visible = items.filter(s => !dismissed.has(s.vendor));

  if (!items.length) {
    section.classList.add("hidden");
    return;
  }
  if (!visible.length) {
    container.innerHTML = `<p class="py-3 text-center text-sm text-slate-400">All suggestions dismissed. <button class="text-primary underline" onclick="localStorage.removeItem('rc_dismissed');loadRecurringSuggestions()">Reset</button></p>`;
    countEl.classList.add("hidden");
    dismissAll.classList.add("hidden");
    return;
  }

  countEl.textContent = `${visible.length} detected`;
  countEl.classList.remove("hidden");
  dismissAll.classList.remove("hidden");

  container.innerHTML = `
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      ${visible.map(s => {
        const nextDate = new Date(s.next_expected);
        const nextFmt  = nextDate.toLocaleDateString("en-IN", { day:"2-digit", month:"short" });
        const daysUntil = Math.ceil((nextDate - new Date()) / 86400000);
        const dueLabel  = daysUntil < 0
          ? `<span style="color:#ef4444;font-weight:700">Overdue ${Math.abs(daysUntil)}d</span>`
          : daysUntil <= 7
            ? `<span style="color:#f59e0b;font-weight:700">Due in ${daysUntil}d</span>`
            : `<span style="color:#94a3b8">Next: ${nextFmt}</span>`;

        const variantNote = s.amount_consistent
          ? ""
          : `<p class="mt-1 text-[10px]" style="color:#f59e0b">⚠ Amount varies: ${s.sample_amounts.map(a=>"₹"+a.toLocaleString("en-IN")).join(", ")}</p>`;

        return `
          <div class="relative rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm hover:shadow-md transition-shadow">
            <!-- Dismiss -->
            <button data-dismiss="${escH(s.vendor)}"
              class="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition"
              title="Dismiss">
              <span style="font-size:13px;line-height:1">×</span>
            </button>

            <!-- Vendor + frequency -->
            <div class="pr-6">
              <p class="text-sm font-extrabold text-slate-900 truncate">${escH(s.vendor)}</p>
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${freqColor(s.frequency)}">${freqLabel(s.frequency)}</span>
                <span class="text-[10px] text-slate-400">${confidenceDot(s.confidence)}${s.occurrences}× in 6mo</span>
              </div>
            </div>

            <!-- Amount + next date -->
            <div class="mt-2.5 flex items-end justify-between">
              <div>
                <p class="text-lg font-black text-slate-950">${fmt(s.amount)}</p>
                <p class="text-[11px]">${dueLabel}</p>
                ${variantNote}
              </div>
              <!-- Add to planned -->
              <button data-add-vendor="${escH(s.vendor)}"
                data-add-amount="${s.amount}"
                data-add-freq="${escH(s.frequency)}"
                data-add-next="${escH(s.next_expected)}"
                class="add-recurring-btn flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-primary/90 active:scale-95 transition whitespace-nowrap">
                <span style="font-size:14px" class="material-symbols-outlined">add</span> Add
              </button>
            </div>
          </div>`;
      }).join("")}
    </div>`;

  /* Dismiss individual */
  container.querySelectorAll("[data-dismiss]").forEach(btn => {
    btn.addEventListener("click", () => {
      const d = getDismissed();
      d.add(btn.dataset.dismiss);
      saveDismissed(d);
      renderRecurringSuggestions(items);
    });
  });

  /* Dismiss all */
  dismissAll.onclick = () => {
    const d = getDismissed();
    visible.forEach(s => d.add(s.vendor));
    saveDismissed(d);
    renderRecurringSuggestions(items);
  };

  /* Add to planned — pre-fill the form and open it */
  container.querySelectorAll(".add-recurring-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const form = document.getElementById("plannedExpenseForm");
      if (!form) return;

      /* Fill form fields */
      form.querySelector("[name=title]").value    = btn.dataset.addVendor;
      form.querySelector("[name=amount]").value   = btn.dataset.addAmount;
      form.querySelector("[name=due_date]").value = btn.dataset.addNext;
      const freqMap = { weekly:"monthly", monthly:"monthly", quarterly:"quarterly", yearly:"yearly" };
      form.querySelector("[name=frequency]").value = freqMap[btn.dataset.addFreq] || "monthly";

      /* Open the form panel */
      const panel = document.getElementById("plannedFormPanel");
      const addBtn = document.getElementById("addPlannedBtn");
      if (panel) panel.classList.remove("hidden");
      if (addBtn) addBtn.textContent = addBtn.dataset.close || "Cancel";

      /* Scroll to form */
      panel?.scrollIntoView({ behavior: "smooth", block: "center" });

      /* Dismiss this suggestion once added */
      const d = getDismissed();
      d.add(btn.dataset.addVendor);
      saveDismissed(d);
      renderRecurringSuggestions(items);
    });
  });
}

async function loadRecurringSuggestions() {
  const container = document.getElementById("recurring-list");
  if (!container) return;
  try {
    const res  = await fetch("/planning/recurring-suggestions");
    const data = (await res.json()).data || [];
    renderRecurringSuggestions(data);
  } catch {
    const section = document.getElementById("recurring-section");
    if (section) section.classList.add("hidden");
  }
}

// ── Main load ─────────────────────────────────────────────────────────────────
async function loadGoals() {
  const res  = await fetch("/planning/summary");
  const data = (await res.json()).data || {};
  const cm   = data.current_month || {};
  _activeBudgetMonth = parseLocalDate(cm.month_start);
  _monthlySurplus = Math.max(0, Number(cm.income_so_far || 0) - Number(cm.spent_so_far || 0));
  renderPlannedExpenses(data.planned_expenses || {});
  renderWishlist(data.wishlist || {});
  const planned  = Number(data.planned_expenses?.total_open || 0);
  const wishlist = Number(data.wishlist?.total_open || 0);
  setText("plannedTotal2", fmt(planned + wishlist));
  renderAffordStrip(planned, wishlist, _monthlySurplus);
}

// Affordability: upcoming commitments vs this month's surplus.
function renderAffordStrip(planned, wishlist, surplus) {
  const el = document.getElementById("goalsAffordStrip");
  if (!el) return;
  if (planned + wishlist <= 0 && surplus <= 0) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  const covered = surplus >= planned;
  const tone = planned > 0 && !covered ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  el.innerHTML = `
    <div class="rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
      <div>
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Upcoming commitments</span>
        <span class="ml-1.5 font-extrabold text-slate-900 dark:text-white">${fmt(planned + wishlist)}</span>
        <span class="ml-1 text-[11px] text-slate-400">(${fmt(planned)} planned · ${fmt(wishlist)} wishlist)</span>
      </div>
      <div>
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Surplus this month</span>
        <span class="ml-1.5 font-extrabold ${surplus > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}">${fmt(surplus)}</span>
      </div>
      ${planned > 0 ? `<div class="text-[11px] font-bold ${tone}">${covered ? "✓ surplus covers planned this month" : `▲ planned exceeds surplus by ${fmt(planned - surplus)}`}</div>` : ""}
    </div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  bindToggle("addPlannedBtn",  "plannedFormPanel");
  bindToggle("addWishlistBtn", "wishlistFormPanel");
  bindPlannedForm();
  bindWishlistForm();
  loadGoals();
});
