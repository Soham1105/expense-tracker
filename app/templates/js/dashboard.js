function formatINR(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMoney(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

function amount(row, field) {
  const value = Number(row?.[field]);
  return Number.isFinite(value) ? Math.max(0, Math.abs(value)) : 0;
}

function expense(row) {
  return amount(row, "effective_expense_amount");
}

function income(row) {
  return amount(row, "effective_income_amount");
}

function rawAmount(row) {
  return Math.max(0, Math.abs(Number(row?.amount || 0)));
}

function isDebit(row) {
  return String(row?.direction || "").trim().toLowerCase() === "withdrawal";
}

function rawDebit(row) {
  return isDebit(row) ? rawAmount(row) : 0;
}

function rawCredit(row) {
  return isDebit(row) ? 0 : rawAmount(row);
}

function category(row) {
  return normalizeTags(row.tags)[0] || "Uncategorized";
}

function source(row) {
  return row.payment_source_name || row.statement_sources || "Unknown";
}

function displayName(row) {
  return row.vendor_name || row.counterparty_entity_name || row.counterparty_identifier || row.narration || "Unknown transaction";
}

function isOpenReview(row) {
  return ["needs_review", "unknown", "unreviewed"].includes(
    String(row.review_status || "").trim().toLowerCase()
  );
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function parseLocalDate(value) {
  if (!value) return null;
  const date = new Date(String(value).slice(0, 10) + "T00:00:00");
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthEndDate(monthStart) {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
}

/* ── Animated counter ────────────────────────────────────────────────────── */
function animateCount(elId, target, duration) {
  const el = document.getElementById(elId);
  if (!el) return;
  duration = duration || 900;
  const start = performance.now();
  (function tick(now) {
    const t    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = formatINR(target * ease);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = formatINR(target);
  })(performance.now());
}

/* ── Time-aware greeting ─────────────────────────────────────────────────── */
function renderGreeting(totalExpense, reviewCount) {
  const el = document.getElementById("dash-greeting");
  if (!el) return;
  const hr  = new Date().getHours();
  const tod = hr < 12 ? "Good morning ☀️" : hr < 17 ? "Good afternoon ⛅" : "Good evening 🌙";
  let sub;
  if (reviewCount > 0)
    sub = `${reviewCount} transaction${reviewCount > 1 ? "s" : ""} need${reviewCount === 1 ? "s" : ""} your attention.`;
  else if (totalExpense > 0)
    sub = `You've spent ${formatINR(totalExpense)} this month. Keep it up 👌`;
  else
    sub = "No expenses logged yet this month. Fresh start! 🌱";
  el.innerHTML = `<span class="font-extrabold">${tod}</span><span class="text-slate-500 font-medium text-sm ml-2">${sub}</span>`;
}

/* ── vs Last Month delta ─────────────────────────────────────────────────── */
function renderDelta(elId, current, prev) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!prev || prev === 0) { el.innerHTML = ""; return; }
  const pct = Math.round(((current - prev) / Math.abs(prev)) * 100);
  const up  = pct > 0;
  const neutral = pct === 0;
  el.innerHTML = neutral
    ? `<span class="text-slate-400 text-[10px] font-bold">= same as last month</span>`
    : `<span class="${up ? "text-rose-400" : "text-emerald-400"} text-[10px] font-bold">${up ? "↑" : "↓"}${Math.abs(pct)}% vs last month</span>`;
}

/* ── Spending personality ─────────────────────────────────────────────────── */
const _PERSONALITIES = [
  { keys: ["food","dining","restaurant","cafe","swiggy","zomato","lunch","dinner"],  label: "Food Lover",      emoji: "🍕", cls: "text-orange-700 bg-orange-50 border-orange-200" },
  { keys: ["transport","travel","cab","uber","ola","fuel","petrol","metro","flight"], label: "Road Warrior",    emoji: "🚗", cls: "text-sky-700 bg-sky-50 border-sky-200" },
  { keys: ["shop","shopping","amazon","flipkart","mall","cloth","fashion"],           label: "Shopaholic",      emoji: "🛍️", cls: "text-pink-700 bg-pink-50 border-pink-200" },
  { keys: ["entertain","movie","netflix","game","fun","music","spotify","ott"],       label: "Fun Seeker",      emoji: "🎮", cls: "text-violet-700 bg-violet-50 border-violet-200" },
  { keys: ["health","gym","medical","pharma","doctor","hospital","fitness"],          label: "Wellness Guru",   emoji: "💪", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  { keys: ["invest","mutual","stock","sip","zerodha","groww","trading"],              label: "Smart Investor",  emoji: "📈", cls: "text-blue-700 bg-blue-50 border-blue-200" },
  { keys: ["grocery","vegetable","supermarket","kirana","bigbasket"],                 label: "Home Chef",       emoji: "🏠", cls: "text-teal-700 bg-teal-50 border-teal-200" },
  { keys: ["bill","utility","electric","water","gas","internet","recharge"],          label: "Bill Master",     emoji: "🧾", cls: "text-slate-700 bg-slate-100 border-slate-200" },
];

function renderPersonality(buckets) {
  const el = document.getElementById("dash-personality");
  if (!el || !buckets || !buckets.length) return;
  const topName = (buckets[0]?.name || "").toLowerCase();
  const p = _PERSONALITIES.find(p => p.keys.some(k => topName.includes(k)));
  if (!p) return;
  el.innerHTML = `
    <div class="inline-flex items-center gap-2 rounded-2xl border px-4 py-2 ${p.cls}">
      <span class="text-xl">${p.emoji}</span>
      <div>
        <p class="text-[9px] font-black uppercase tracking-widest opacity-60">Your spending personality</p>
        <p class="text-sm font-extrabold leading-tight">${p.label}</p>
      </div>
    </div>`;
}

function renderReviewQueue(rows) {
  const container = document.getElementById("dashboardReviewQueue");
  if (!container) return;
  const queue = rows.filter(isOpenReview).slice(0, 6);
  const nextLink = document.getElementById("reviewNextLink");

  if (nextLink && queue[0]?.id) {
    nextLink.href = `/classification/transaction/${encodeURIComponent(queue[0].id)}?mode=simple`;
  }

  if (!queue.length) {
    container.innerHTML = `<p class="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-100">No open review items. Tiny confetti in spirit.</p>`;
    return;
  }

  container.innerHTML = queue
    .map((row) => `
      <a class="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 hover:bg-white hover:ring-primary/30" href="/classification/transaction/${encodeURIComponent(row.id)}?mode=simple">
        <div class="min-w-0">
          <p class="truncate text-sm font-extrabold text-slate-900">${escapeHtml(displayName(row))}</p>
          <p class="mt-1 text-xs text-slate-500">${escapeHtml(row.transaction_date || "-")} · ${escapeHtml(source(row))}</p>
        </div>
        <span class="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">${formatINR(Math.max(expense(row), income(row), Math.abs(Number(row.amount || 0))))}</span>
      </a>
    `)
    .join("");
}

function renderDashBudget(summary) {
  const budget = summary?.budget || {};
  const section = document.getElementById("dash-budget-section");
  if (!section) return;
  if (!budget.budget_amount) return; // no budget configured — hide section

  section.classList.remove("hidden");

  const spent = Number(budget.spent_so_far || 0);
  const total = Number(budget.budget_amount || 0);
  const pct   = total > 0 ? Math.min(Math.round((spent / total) * 100), 100) : 0;
  const over  = spent > total;

  const spentEl = document.getElementById("dash-budget-spent");
  const totalEl = document.getElementById("dash-budget-total");
  const bar     = document.getElementById("dash-budget-bar");
  const pace    = document.getElementById("dash-budget-pace");
  const meta    = document.getElementById("dash-budget-meta");

  if (spentEl) spentEl.textContent = formatINR(spent);
  if (totalEl) totalEl.textContent = formatINR(total);
  if (bar) {
    bar.style.width = pct + "%";
    bar.style.background = over ? "#dc2626" : pct > 80 ? "#f59e0b" : "#607AFB";
  }

  const paceMap = {
    no_budget:  { label: "No budget", cls: "bg-slate-100 text-slate-500" },
    on_track:   { label: "On track",  cls: "bg-emerald-100 text-emerald-700" },
    ahead:      { label: "Ahead",     cls: "bg-sky-100 text-sky-700" },
    off_track:  { label: "Over pace", cls: "bg-amber-100 text-amber-700" },
    over_budget:{ label: "Over budget", cls: "bg-rose-100 text-rose-700" },
  };
  const ps = over ? "over_budget" : (budget.pace_status || "no_budget");
  const pm = paceMap[ps] || paceMap.no_budget;
  if (pace) { pace.textContent = pm.label; pace.className = `rounded-full px-3 py-1 text-xs font-bold ${pm.cls}`; }
  if (meta) meta.textContent = `${pct}% used · ₹${Math.max(0, total - spent).toLocaleString("en-IN", { maximumFractionDigits: 0 })} remaining`;

  // Budget overrun stress effect
  if (over) {
    section.classList.add("budget-overrun");
  } else {
    section.classList.remove("budget-overrun");
    // Confetti celebration when on track / ahead
    if ((ps === "on_track" || ps === "ahead") && !window._confettiLaunched) {
      window._confettiLaunched = true;
      setTimeout(() => window.launchConfetti?.(), 700);
    }
  }
}

function renderDashCategories(summary) {
  const buckets = summary?.current_month?.top_spend_buckets || summary?.budget?.top_spend_buckets || [];
  const section = document.getElementById("dash-categories-section");
  const container = document.getElementById("dashCategoryBarsVisible");
  if (!section || !container) return;
  if (!buckets.length) return;

  section.classList.remove("hidden");
  renderPersonality(buckets);
  const top = buckets.slice(0, 8);
  const maxAmt = Math.max(...top.map(b => Number(b.amount || 0)), 1);
  container.innerHTML = top.map(b => {
    const amt = Number(b.amount || 0);
    const pct = Math.round((amt / maxAmt) * 100);
    return `
      <div class="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-xs mb-1">
            <span class="font-semibold text-slate-700 truncate">${escapeHtml(b.name)}</span>
            <span class="font-bold text-slate-900 ml-2 shrink-0">${formatINR(amt)}</span>
          </div>
          <div class="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full rounded-full" style="width:${pct}%;background:#607AFB"></div>
          </div>
        </div>
      </div>`;
  }).join("");
}

async function loadPlanning() {
  try {
    const response = await fetch("/planning/summary");
    const result = await response.json();
    renderDashBudget(result.data || {});
    renderDashCategories(result.data || {});
    renderDashUpcoming(result.data || {});
  } catch (error) {
    console.warn("Unable to load planning", error);
  }
}

// Upcoming planned expenses due this month (falls back to total open targets).
function renderDashUpcoming(summary) {
  const el = document.getElementById("dash-upcoming");
  if (!el) return;
  const planned = summary?.planned_expenses || {};
  const items = Array.isArray(planned.items) ? planned.items : [];
  const activeMonth = parseLocalDate(summary?.current_month?.month_start) || new Date();
  const y = activeMonth.getFullYear(), m = activeMonth.getMonth();
  const dueThisMonth = items.filter((it) => {
    if (!it.due_date) return false;
    const d = parseLocalDate(it.due_date);
    return !Number.isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === m;
  });

  let total, meta;
  if (dueThisMonth.length) {
    total = dueThisMonth.reduce((s, it) => s + Number(it.amount || 0), 0);
    meta = `${dueThisMonth.length} planned expense${dueThisMonth.length === 1 ? "" : "s"} due this month`;
  } else {
    total = Number(planned.total_open || 0);
    if (total <= 0) { el.classList.add("hidden"); return; }
    meta = `${items.length} upcoming target${items.length === 1 ? "" : "s"} · none dated this month`;
  }
  setText("dash-upcoming-total", "₹" + Number(total).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
  setText("dash-upcoming-meta", meta);
  el.classList.remove("hidden");
}

// Shared Joy giving this month vs goal.
async function loadSharedJoy() {
  const el = document.getElementById("dash-sharedjoy");
  if (!el) return;
  try {
    const res = await fetch("/planning/shared-joy-budget");
    const data = (await res.json()).data || {};
    const spent = Number(data.spent || 0);
    const goal = Number(data.effective_goal || data.goal_amount || 0);
    if (spent <= 0 && goal <= 0) { el.classList.add("hidden"); return; }
    const pct = goal > 0 ? Math.min(Math.round((spent / goal) * 100), 100) : 0;
    const fmt = (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    setText("dash-sharedjoy-spent", fmt(spent));
    setText("dash-sharedjoy-pct", goal > 0 ? `${pct}% of goal` : "");
    const bar = document.getElementById("dash-sharedjoy-bar");
    if (bar) bar.style.width = (goal > 0 ? pct : 0) + "%";
    setText("dash-sharedjoy-meta", goal > 0
      ? `${fmt(spent)} of ${fmt(goal)} given this month`
      : `${fmt(spent)} given on others this month`);
    el.classList.remove("hidden");
  } catch (e) {
    el.classList.add("hidden");
  }
}

function renderDashboard(rows, balanceRows, prevRows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalExpense = safeRows.reduce((sum, row) => sum + expense(row), 0);
  const totalIncome = safeRows.reduce((sum, row) => sum + income(row), 0);
  const totalInvested = safeRows.reduce((sum, row) => sum + (Number(row.effective_investment_amount) || 0), 0);
  const classifiedNet = totalIncome - totalExpense;
  const openReview = safeRows.filter(isOpenReview);
  const untagged = safeRows.filter((row) => normalizeTags(row.tags).length === 0);
  const excluded = safeRows.filter((row) => expense(row) <= 0 && income(row) <= 0);
  const sources = new Set(safeRows.map(source).filter(Boolean));

  animateCount("dashExpense",  totalExpense);
  animateCount("dashIncome",   totalIncome);
  animateCount("dashInvested", totalInvested);
  animateCount("dashNetFlow",  classifiedNet);

  // vs last month deltas
  let prevRate = null;
  if (Array.isArray(prevRows) && prevRows.length) {
    const prevExpense  = prevRows.reduce((s, r) => s + expense(r), 0);
    const prevIncome   = prevRows.reduce((s, r) => s + income(r), 0);
    renderDelta("dashExpenseDelta", totalExpense, prevExpense);
    renderDelta("dashIncomeDelta",  totalIncome,  prevIncome);
    prevRate = prevIncome > 0 ? ((prevIncome - prevExpense) / prevIncome) * 100 : null;
  }

  // Savings rate: share of income kept this month. When overspending heavily
  // (income barely recorded), show "spent N× income" instead of a wild −%.
  const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : null;
  const srEl = document.getElementById("dashSavingsRate");
  if (srEl) {
    let srText = "—", srTone = "text-slate-400";
    if (savingsRate !== null) {
      if (savingsRate >= 0) { srText = `${savingsRate}% of income`; srTone = "text-sky-300"; }
      else {
        const ratio = totalExpense / totalIncome;
        srText = ratio >= 2 ? `spent ${ratio.toFixed(1)}× income` : `${savingsRate}% of income`;
        srTone = "text-rose-300";
      }
    }
    srEl.textContent = srText;
    srEl.className = `text-sm font-extrabold ${srTone}`;
  }
  const srDelta = document.getElementById("dashSavingsDelta");
  if (srDelta) {
    // Only meaningful when both months have a sane (in-range) savings rate.
    const inRange = (r) => r !== null && r >= -100 && r <= 100;
    if (inRange(savingsRate) && inRange(prevRate)) {
      const diff = Math.round(savingsRate - prevRate);
      srDelta.textContent = diff === 0 ? "" : `${diff > 0 ? "↑" : "↓"}${Math.abs(diff)}pts`;
      srDelta.className = `ml-1 text-[10px] font-bold ${diff >= 0 ? "text-emerald-400" : "text-rose-400"}`;
    } else {
      srDelta.textContent = "";
    }
  }

  renderGreeting(totalExpense, openReview.length);
  setText("dashNeedsReview", String(openReview.length));
  setText("dashRows", String(safeRows.length));
  setText("dashUntagged", String(untagged.length));
  setText("dashExcluded", String(excluded.length));
  setText("dashSources", String(sources.size));
  setText("dashboardHeroMeta", `${safeRows.length} transactions this month. ${excluded.length} transfers/paybacks excluded from totals.`);

  // Render actual bank balances from reconciliation data
  const safeBalance = Array.isArray(balanceRows) ? balanceRows : [];
  const balanceEl = document.getElementById("dash-bank-balances");
  const nwCard = document.getElementById("dash-net-worth-card");
  if (balanceEl && safeBalance.length) {
    if (nwCard) nwCard.classList.add("hidden");
    const totalBank = safeBalance.reduce((s, r) => s + Number(r.statement_closing_balance || r.calculated_closing_balance || 0), 0);
    const rows_html = safeBalance.map(r => {
      const bal = Number(r.statement_closing_balance || r.calculated_closing_balance || 0);
      const mismatch = Number(r.mismatch_amount || 0);
      const mismatchTag = Math.abs(mismatch) > 1
        ? `<span class="text-[10px] text-amber-600 font-semibold">±${formatINR(Math.abs(mismatch))}</span>`
        : "";
      return `<div class="flex items-center justify-between gap-2">
        <span class="text-xs text-slate-500 truncate">${r.source_name || "Unknown"}</span>
        <span class="text-sm font-extrabold text-slate-900 whitespace-nowrap">${formatINR(bal)} ${mismatchTag}</span>
      </div>`;
    }).join("");
    balanceEl.innerHTML = `
      <p class="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 mb-2">Bank Balances</p>
      <div class="space-y-1.5">${rows_html}</div>
      <div class="mt-3 border-t border-slate-100 pt-2 flex justify-between">
        <span class="text-xs font-bold text-slate-500">Total</span>
        <span class="text-base font-extrabold text-slate-950">${formatINR(totalBank)}</span>
      </div>
      <p class="mt-1 text-[10px] text-slate-400">From latest statement running balance. ±gap means statement vs calculated differ.</p>
    `;
    balanceEl.classList.remove("hidden");
  }

  renderReviewQueue(safeRows);
}

async function loadDashboard() {
  try {
    const planningRes = await fetch("/planning/summary");
    const planningResult = await planningRes.json();
    const currentMonth = planningResult?.data?.current_month || {};
    const activeMonthStart = parseLocalDate(currentMonth.month_start) || new Date();
    const asOfDate = parseLocalDate(currentMonth.as_of_date) || monthEndDate(activeMonthStart);
    const monthStart = dateKey(new Date(activeMonthStart.getFullYear(), activeMonthStart.getMonth(), 1));
    const monthEnd = dateKey(asOfDate);
    const monthLabel = activeMonthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    setText("dashMonthLabel", monthLabel);

    // Prev month date range for delta comparisons
    const prevMonthDate = new Date(activeMonthStart.getFullYear(), activeMonthStart.getMonth() - 1, 1);
    const prevMonthStart = dateKey(prevMonthDate);
    const prevMonthEnd = dateKey(monthEndDate(prevMonthDate));

    const [txnRes, balRes, prevTxnRes] = await Promise.all([
      fetch("/reports/transactions_filter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_date: monthStart, to_date: monthEnd }),
      }),
      fetch("/reports/balance_reconciliation"),
      fetch("/reports/transactions_filter", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_date: prevMonthStart, to_date: prevMonthEnd }),
      }),
    ]);
    const txnResult     = await txnRes.json();
    const balResult     = await balRes.json();
    const prevTxnResult = await prevTxnRes.json();

    renderDashboard(
      Array.isArray(txnResult.data)     ? txnResult.data     : [],
      Array.isArray(balResult.data)     ? balResult.data     : [],
      Array.isArray(prevTxnResult.data) ? prevTxnResult.data : []
    );
  } catch (error) {
    console.warn("Unable to load dashboard", error);
    setText("dashboardHeroMeta", "Dashboard data could not be loaded.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
  loadPlanning();
  loadSharedJoy();
});
