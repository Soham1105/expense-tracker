const ACCOUNT_RECONCILIATION_CACHE_KEY = "expense_tracker_statement_reconciliation_v1";

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

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDelta(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0.01 ? "+" : amount < -0.01 ? "-" : "";
  return `${prefix}${formatMoney(Math.abs(amount))}`;
}

function readLatestUploadReconciliation(sourceName) {
  const source = String(sourceName || "").trim().toUpperCase();
  if (!source) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_RECONCILIATION_CACHE_KEY) || "{}");
    const item = parsed && typeof parsed === "object" ? parsed[source] : null;
    return item && typeof item === "object" ? item : null;
  } catch (error) {
    console.warn("Unable to read statement reconciliation cache", error);
    return null;
  }
}

function normalizePayload(form) {
  const payload = {};
  new FormData(form).forEach((value, key) => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    if (["current_balance", "budget_amount", "amount", "expected_amount"].includes(key)) {
      payload[key] = Number(cleaned);
      return;
    }
    payload[key] = cleaned;
  });
  return payload;
}

function formatShortDate(value) {
  if (!value) return "No date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function planningPriorityTone(priority) {
  const value = String(priority || "").trim().toLowerCase();
  if (value === "urgent" || value === "must_have") return "bg-rose-100 text-rose-700";
  if (value === "high" || value === "important") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function renderPlannedExpenses(planned) {
  const container = document.getElementById("plannedExpenseList");
  if (!container) return;
  const items = Array.isArray(planned?.items) ? planned.items : [];
  const openTotal = Number(planned?.total_open || 0);

  setText("plannedTotal", formatMoney(openTotal));
  setText(
    "plannedMeta",
    items.length
      ? `${items.length} upcoming target${items.length === 1 ? "" : "s"} waiting to be funded.`
      : "No planned targets yet."
  );

  if (!items.length) {
    container.innerHTML = `<p class="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-sky-100">No planned expenses saved yet.</p>`;
    return;
  }

  container.innerHTML = items.slice(0, 6).map((item) => `
    <div class="rounded-2xl bg-white p-4 ring-1 ring-sky-100">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-extrabold text-slate-900">${escapeHtml(item.title || "Planned expense")}</p>
          <p class="mt-1 text-xs text-slate-500">${escapeHtml(item.category || "No category")} · due ${escapeHtml(formatShortDate(item.due_date))}</p>
        </div>
        <div class="text-right">
          <p class="text-sm font-black text-slate-950">${formatMoney(item.amount || 0)}</p>
          <span class="mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${planningPriorityTone(item.priority)}">${escapeHtml(String(item.priority || "normal").replace(/_/g, " "))}</span>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">${escapeHtml(String(item.frequency || "one_time").replace(/_/g, " "))}</span>
        <span class="inline-flex rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">${escapeHtml(String(item.status || "planned").replace(/_/g, " "))}</span>
      </div>
    </div>
  `).join("");
}

function renderWishlist(wishlist) {
  const container = document.getElementById("wishlistList");
  if (!container) return;
  const items = Array.isArray(wishlist?.items) ? wishlist.items : [];
  const openItems = items.filter((item) => ["wishlist", "planned"].includes(String(item?.status || "").trim().toLowerCase()));
  const totalOpen = Number(wishlist?.total_open || 0);

  setText("wishlistTotal", formatMoney(totalOpen));
  setText(
    "wishlistMeta",
    openItems.length
      ? `${openItems.length} open wishlist item${openItems.length === 1 ? "" : "s"} still optional.`
      : "No wishlist ideas saved yet."
  );

  if (!items.length) {
    container.innerHTML = `<p class="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-fuchsia-100">No wishlist items saved yet.</p>`;
    return;
  }

  container.innerHTML = items.slice(0, 6).map((item) => `
    <div class="rounded-2xl bg-white p-4 ring-1 ring-fuchsia-100">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-extrabold text-slate-900">${escapeHtml(item.item_name || "Wishlist item")}</p>
          <p class="mt-1 text-xs text-slate-500">${item.target_date ? `Target ${escapeHtml(formatShortDate(item.target_date))}` : "No target date"}${item.notes ? ` · ${escapeHtml(item.notes)}` : ""}</p>
        </div>
        <div class="text-right">
          <p class="text-sm font-black text-slate-950">${formatMoney(item.expected_amount || 0)}</p>
          <span class="mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${planningPriorityTone(item.priority)}">${escapeHtml(String(item.priority || "nice_to_have").replace(/_/g, " "))}</span>
        </div>
      </div>
    </div>
  `).join("");
}

function renderNetWorth(nw) {
  if (!nw) return;
  const net = Number(nw.net_worth || 0);
  const netEl = document.getElementById("netWorthTotal");
  if (netEl) {
    netEl.textContent = formatMoney(net);
    netEl.className = `mt-1 text-3xl font-black ${net >= 0 ? "text-slate-950" : "text-rose-700"}`;
  }
  setText("netWorthAssets", formatMoney(nw.total_assets || 0));
  setText("netWorthLiabilities", formatMoney(nw.total_liabilities || 0));
  setText("netWorthAsOf", nw.as_of ? `as of ${nw.as_of}` : "");

  const breakdown = nw.breakdown || {};
  const assets = Array.isArray(breakdown.assets) ? breakdown.assets : [];
  const liabilities = Array.isArray(breakdown.liabilities) ? breakdown.liabilities : [];
  const allRows = [
    ...assets.map((r) => ({ ...r, side: "asset" })),
    ...liabilities.map((r) => ({ ...r, side: "liability" })),
  ];

  const toggle = document.getElementById("netWorthBreakdownToggle");
  const panel = document.getElementById("netWorthBreakdown");
  const list = document.getElementById("netWorthBreakdownList");

  if (allRows.length > 0 && toggle && panel && list) {
    toggle.classList.remove("hidden");
    list.innerHTML = allRows.map((row) => {
      const isLiability = row.side === "liability";
      const tone = isLiability ? "text-rose-700 bg-rose-50" : "text-emerald-700 bg-emerald-50";
      return `
        <div class="flex items-center justify-between rounded-lg px-3 py-2 ${tone}">
          <div>
            <span class="text-xs font-semibold">${escapeHtml(row.account_subtype || row.account_type || "—")}</span>
            <span class="ml-2 rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold uppercase">${isLiability ? "liability" : "asset"}</span>
          </div>
          <span class="text-sm font-black">${isLiability ? "-" : ""}${formatMoney(row.total_balance || 0)}</span>
        </div>
      `;
    }).join("");

    let open = false;
    toggle.addEventListener("click", () => {
      open = !open;
      panel.classList.toggle("hidden", !open);
      toggle.textContent = open ? "Hide breakdown" : "Show breakdown";
    });
  }
}

function renderSummary(summary) {
  const accounts = summary?.accounts || {};
  const budget = summary?.budget || {};
  const planned = summary?.planned_expenses || {};
  const wishlist = summary?.wishlist || {};
  const items = Array.isArray(accounts.accounts) ? accounts.accounts : [];
  const linkedCount = items.filter((account) => account.is_bank_linked).length;
  const manualCount = items.filter((account) => !account.is_bank_linked).length;
  const mismatchTotal = items.reduce((sum, account) => sum + Math.abs(Number(account.account_delta || 0)), 0);

  const visibleTotal = items.reduce((sum, account) => {
    const balance = _accountBalanceFor(account);
    const isLiability = String(account.asset_class || "asset").toLowerCase() === "liability";
    return sum + (isLiability ? -Math.abs(balance) : balance);
  }, 0);

  setText("accountsTotalBalance", formatMoney(items.length ? visibleTotal : (accounts.total_balance || 0)));
  setText("accountsTrackedCount", String(items.length));
  setText("accountsLinkedCount", String(linkedCount));
  setText("accountsManualCount", String(manualCount));
  setText("accountsNeedsLinkCount", String(accounts.needs_link_count || 0));
  setText("accountsMismatchTotal", formatMoney(mismatchTotal));
  setText(
    "accountsHeroMeta",
    items.length
      ? `${items.length} account${items.length === 1 ? "" : "s"} tracked across linked bank sources and manual balances.`
      : "No account balances tracked yet."
  );

  renderNetWorth(summary?.net_worth || null);
  renderBudget(budget);
  renderPlannedExpenses(planned);
  renderWishlist(wishlist);

  // This month income / spent / saved
  const cm = summary?.current_month || {};
  const income = Number(cm.income_so_far || 0);
  const spent = Number(cm.spent_so_far || 0);
  const saved = income - spent;
  setText("monthIncome", formatMoney(income));
  setText("monthSpent", formatMoney(spent));
  const savedEl = document.getElementById("monthNetSaved");
  if (savedEl) {
    savedEl.textContent = formatMoney(Math.abs(saved));
    savedEl.className = `mt-1.5 text-2xl font-black ${saved >= 0 ? "text-sky-700" : "text-rose-700"}`;
  }
  const monthLabel = cm.month_start ? new Date(cm.month_start).toLocaleString("en-IN", { month: "long" }) : "This month";
  setText("monthNetMeta", saved >= 0 ? `${monthLabel} surplus` : `${monthLabel} deficit`);
}

function renderBudget(budget) {
  const usagePercent = Math.max(0, Number(budget.usage_percent || 0));
  const remaining = Number(budget.remaining_amount || 0);
  const isOverBudget = String(budget.status || "") === "over_budget";
  const paceStatus = String(budget.pace_status || "").toLowerCase();
  const plannedRemaining = Number(budget.planned_remaining || 0);
  const projectedOutflow = Number(budget.projected_month_outflow || 0);
  const reviewCount = Number(budget.open_review_count || 0);
  const topBuckets = Array.isArray(budget.top_spend_buckets) ? budget.top_spend_buckets : [];
  const daysElapsed = Number(budget.days_elapsed || 0);
  const daysInMonth = Number(budget.days_in_month || 0);
  const paceTargetSpend = Number(budget.pace_target_spend || 0);
  const progressBar = document.getElementById("budgetProgressBar");
  const progressWidth = Math.min(100, usagePercent);
  const paceBadge = document.getElementById("budgetPaceBadge");
  const topBucketsEl = document.getElementById("budgetTopBuckets");
  const topBucketsMetaEl = document.getElementById("budgetBucketMeta");

  const paceCopy = {
    no_budget: {
      label: "No budget yet",
      badge: "bg-slate-100 text-slate-700",
      text: "Set a monthly budget to start tracking whether this month is on pace.",
    },
    off_track: {
      label: "Off track",
      badge: "bg-rose-100 text-rose-700",
      text: `Actual spend is running ahead of your month pace target of ${formatMoney(paceTargetSpend)}.`,
    },
    ahead: {
      label: "Below pace",
      badge: "bg-blue-100 text-blue-700",
      text: `Actual spend is still below your pace target of ${formatMoney(paceTargetSpend)}.`,
    },
    on_track: {
      label: "On track",
      badge: "bg-emerald-100 text-emerald-700",
      text: `Actual spend is tracking close to your pace target of ${formatMoney(paceTargetSpend)}.`,
    },
  };
  const selectedPace = paceCopy[paceStatus] || paceCopy.no_budget;

  setText("budgetAmount", budget.budget_amount > 0 ? formatMoney(budget.budget_amount) : "Not set");
  setText("budgetSpent", formatMoney(budget.spent_so_far || 0));
  const remainingEl = document.getElementById("budgetRemaining");
  if (remainingEl) {
    remainingEl.textContent = budget.budget_amount > 0 ? `${remaining < 0 ? "-" : ""}${formatMoney(Math.abs(remaining))}` : "—";
    remainingEl.className = `mt-1.5 text-2xl font-black ${remaining < 0 ? "text-rose-700" : "text-emerald-700"}`;
  }
  setText("budgetUsagePercent", budget.budget_amount > 0 ? `${Math.round(usagePercent)}%` : "—");
  setText("budgetProjectedOutflow", formatMoney(projectedOutflow));
  setText("budgetPlannedRemaining", formatMoney(plannedRemaining));
  setText("budgetReviewQueue", String(reviewCount));
  setText("budgetMonthProgress", daysInMonth ? `${daysElapsed}/${daysInMonth} days tracked` : "Current month");
  setText("budgetPaceMeta", selectedPace.text);
  setText(
    "budgetMeta",
    budget.budget_amount > 0
      ? `${escapeHtml(String(budget.month_start || ""))} budget is ${isOverBudget ? "over" : "within"} limit based on current month spend.`
      : "No monthly budget set yet. Add one below to start tracking."
  );

  if (paceBadge) {
    paceBadge.textContent = selectedPace.label;
    paceBadge.className = `inline-flex rounded-full px-3 py-1 text-xs font-bold ${selectedPace.badge}`;
  }

  if (progressBar) {
    progressBar.style.width = `${progressWidth}%`;
    progressBar.className = `h-full rounded-full ${isOverBudget ? "bg-rose-500" : usagePercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`;
  }

  if (topBucketsMetaEl) {
    topBucketsMetaEl.textContent = topBuckets.length
      ? "Top categories this month"
      : "No spend buckets yet";
  }

  // Budget progress label
  setText("budgetProgressLabel", budget.budget_amount > 0
    ? `${formatMoney(budget.spent_so_far || 0)} of ${formatMoney(budget.budget_amount || 0)}`
    : "");

  if (topBucketsEl) {
    if (!topBuckets.length) {
      topBucketsEl.innerHTML = `<p class="text-sm text-slate-400">No categorised spend yet this month.</p>`;
    } else {
      topBucketsEl.innerHTML = topBuckets.map((bucket) => {
        const width = Math.max(4, Math.min(100, Number(bucket.share_percent || 0)));
        return `
          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <p class="text-sm font-semibold text-slate-800">${escapeHtml(bucket.name || "Uncategorized")}</p>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs text-slate-400">${bucket.share_percent || 0}%</span>
                <span class="text-sm font-black text-slate-950">${formatMoney(bucket.amount || 0)}</span>
              </div>
            </div>
            <div class="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-primary transition-all duration-500" style="width: ${width}%"></div>
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

function setBudgetInsightMode(mode = "overview") {
  const panel = document.getElementById("budgetInsightPanel");
  const overview = document.getElementById("budgetInsightOverviewPanel");
  const buckets = document.getElementById("budgetInsightBucketsPanel");
  const heading = document.getElementById("budgetInsightHeading");
  const overviewBtn = document.getElementById("budgetInsightToggleOverview");
  const bucketsBtn = document.getElementById("budgetInsightToggleBuckets");
  if (!panel || !overview || !buckets || !heading || !overviewBtn || !bucketsBtn) return;

  const activeButton = "rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white";
  const idleButton = "rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100";

  panel.classList.remove("hidden");
  if (mode === "buckets") {
    heading.textContent = "Top spend buckets";
    overview.classList.add("hidden");
    buckets.classList.remove("hidden");
    overviewBtn.className = idleButton;
    bucketsBtn.className = activeButton;
    return;
  }

  heading.textContent = "Month details";
  overview.classList.remove("hidden");
  buckets.classList.add("hidden");
  overviewBtn.className = activeButton;
  bucketsBtn.className = idleButton;
}

function hideBudgetInsightPanel() {
  const panel = document.getElementById("budgetInsightPanel");
  const overviewBtn = document.getElementById("budgetInsightToggleOverview");
  const bucketsBtn = document.getElementById("budgetInsightToggleBuckets");
  if (!panel || !overviewBtn || !bucketsBtn) return;
  const idleButton = "rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100";
  panel.classList.add("hidden");
  overviewBtn.className = idleButton;
  bucketsBtn.className = idleButton;
}

function bindBudgetInteractions() {
  const overviewBtn = document.getElementById("budgetInsightToggleOverview");
  const bucketsBtn = document.getElementById("budgetInsightToggleBuckets");
  const closeInsight = document.getElementById("budgetInsightClose");
  const budgetForm = document.getElementById("budgetForm");
  const budgetFormToggle = document.getElementById("budgetFormToggle");
  const budgetFormClose = document.getElementById("budgetFormClose");

  overviewBtn?.addEventListener("click", () => setBudgetInsightMode("overview"));
  bucketsBtn?.addEventListener("click", () => setBudgetInsightMode("buckets"));
  closeInsight?.addEventListener("click", () => hideBudgetInsightPanel());

  budgetFormToggle?.addEventListener("click", () => {
    if (!budgetForm) return;
    budgetForm.classList.toggle("hidden");
  });
  budgetFormClose?.addEventListener("click", () => {
    budgetForm?.classList.add("hidden");
  });
}

function accountTypLabel(type) {
  const map = { bank: "Bank", cash: "Cash", wallet: "Wallet", credit_card: "Credit card", personal_loan: "Personal loan", home_loan: "Home loan", fd: "Fixed deposit", other: "Other" };
  return map[type] || type || "Account";
}

function _accountBalanceFor(acc) {
  const cachedReconciliation = readLatestUploadReconciliation(acc.source_name || "");
  const lastStmtDate = acc.last_stmt_date ? String(acc.last_stmt_date).slice(0, 10) : "";
  const cacheApplies = cachedReconciliation
    && cachedReconciliation.statementClosingBalance != null
    && (!lastStmtDate || !cachedReconciliation.toDate || String(cachedReconciliation.toDate).slice(0, 10) >= lastStmtDate);
  if (cacheApplies) return Number(cachedReconciliation.statementClosingBalance);
  return acc.statement_balance != null ? Number(acc.statement_balance) : Number(acc.current_balance || 0);
}

function accountCard(acc) {
  const isLiability = String(acc.asset_class || "asset").toLowerCase() === "liability";
  const balanceColor = isLiability ? "text-rose-700" : "text-emerald-700";
  const typeBadge = isLiability
    ? "bg-rose-50 text-rose-600 border-rose-100"
    : "bg-emerald-50 text-emerald-600 border-emerald-100";

  const hasStatement = acc.statement_balance != null;
  const src = acc.source_name || "";
  const cachedReconciliation = readLatestUploadReconciliation(src);
  const lastStmtDate = acc.last_stmt_date ? String(acc.last_stmt_date).slice(0, 10) : "";
  const cacheApplies = cachedReconciliation
    && cachedReconciliation.statementClosingBalance != null
    && (!lastStmtDate || !cachedReconciliation.toDate || String(cachedReconciliation.toDate).slice(0, 10) >= lastStmtDate);
  const statementBalance = cacheApplies
    ? Number(cachedReconciliation.statementClosingBalance)
    : Number(acc.statement_balance);
  const displayBalance = hasStatement ? statementBalance : Number(acc.current_balance || 0);
  const balanceLabel = hasStatement
    ? `<span class="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">${cacheApplies ? "Latest upload" : "From statement"}</span>`
    : `<span class="text-[10px] text-slate-400">manual</span>`;

  // Statement vs system alignment - when off, link to Reports filtered by source.
  const systemBalance = acc.system_balance != null ? Number(acc.system_balance) : null;
  const sysDelta = systemBalance !== null && hasStatement ? statementBalance - systemBalance : null;
  const accountStatus = String(acc.account_match_status || "").toLowerCase();
  const backendMatched = accountStatus === "matched";
  const cacheMismatchApplies = cacheApplies && cachedReconciliation.isAligned === false;
  const sysMatched = sysDelta !== null && backendMatched && !cacheMismatchApplies;
  const issueText = cacheMismatchApplies
    ? `Latest upload checkpoint mismatch: ${formatDelta(cachedReconciliation.mismatchAmount || 0)}`
    : acc.reconciliation_issue_reason
      ? escapeHtml(acc.reconciliation_issue_reason)
      : `Statement vs system: ${formatDelta(sysDelta)}`;
  const reportsHref = `/reports/${src ? `?source=${encodeURIComponent(src)}` : ""}`;
  const deltaWarn = hasStatement && systemBalance !== null
    ? sysMatched
      ? `<p class="mt-2 flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
           <span class="material-symbols-outlined text-[13px]">check_circle</span>
           Statement matches system — aligned
         </p>`
      : `<a href="${reportsHref}" class="mt-2 inline-flex items-center gap-1 text-[10px] text-amber-600 font-semibold hover:underline">
           <span class="material-symbols-outlined text-[13px]">warning</span>
           ${issueText} � review transactions
           <span class="material-symbols-outlined text-[12px]">arrow_forward</span>
         </a>`
    : "";

  const editControls = hasStatement
    ? `<p class="text-[10px] text-slate-400 flex items-center gap-1">
         <span class="material-symbols-outlined text-[13px]">lock</span>
         Balance locked — managed by uploaded statement
       </p>`
    : "";

  // Freshness line: linked → last statement date + staleness + upload nudge;
  // manual → "as of" date.
  let metaLine = "";
  if (hasStatement && acc.last_stmt_date) {
    const d = new Date(acc.last_stmt_date);
    if (!Number.isNaN(d.getTime())) {
      const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      const daysLabel = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
      const stale = days >= 14;
      const txCount = acc.tx_count ? Number(acc.tx_count) : 0;
      const uploadBtn = stale && src
        ? `<a href="/dashboard.html?upload=1&source=${encodeURIComponent(src)}" title="Upload latest ${escapeHtml(src)} statement"
             class="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 hover:bg-amber-200">
             <span class="material-symbols-outlined text-[12px]">cloud_upload</span>Upload latest</a>`
        : "";
      metaLine = `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] ${stale ? "text-amber-600" : "text-slate-400"}">
           <span class="material-symbols-outlined text-[13px]">${stale ? "update" : "upload_file"}</span>
           Last statement: <span class="font-semibold ${stale ? "text-amber-700" : "text-slate-600"}">${dateStr}</span>
           <span class="text-slate-300">·</span><span>${daysLabel}</span>
           <span class="text-slate-300">·</span><span>${txCount.toLocaleString("en-IN")} txns</span>
           ${uploadBtn}
         </div>`;
    }
  } else if (!hasStatement) {
    const a = acc.balance_as_of ? new Date(acc.balance_as_of) : null;
    const asOfStr = a && !Number.isNaN(a.getTime())
      ? a.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : null;
    metaLine = asOfStr
      ? `<div class="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
           <span class="material-symbols-outlined text-[13px]">edit_calendar</span>
           Manual balance · as of <span class="font-semibold text-slate-600">${asOfStr}</span>
         </div>`
      : `<div class="mt-2 flex items-center gap-1.5 text-[10px] text-slate-300">
           <span class="material-symbols-outlined text-[13px]">upload_file</span>
           No statement uploaded yet
         </div>`;
  }

  return `
    <div class="goal-item-row rounded-xl border border-slate-200 bg-white p-4 shadow-sm" id="acc-${escapeHtml(acc.id)}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-extrabold text-slate-900">${escapeHtml(acc.account_name)}</p>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="rounded-full border px-2 py-0.5 text-[10px] font-bold ${typeBadge}">${isLiability ? "LIABILITY" : "ASSET"}</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">${escapeHtml(accountTypLabel(acc.account_type))}</span>
            ${acc.source_name ? `<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">${escapeHtml(acc.source_name)}</span>` : ""}
          </div>
          ${metaLine}
        </div>
        <div class="text-right shrink-0">
          <p class="text-lg font-black ${balanceColor}">${isLiability ? "-" : ""}${formatMoney(displayBalance)}</p>
          <div class="mt-0.5 flex justify-end">${balanceLabel}</div>
        </div>
      </div>
      ${deltaWarn}
      ${editControls ? `<div class="mt-3">${editControls}</div>` : ""}
      ${!hasStatement ? `
      <div class="goal-card-action-bar">
        <button onclick="showEditBalance('${escapeHtml(acc.id)}', ${Number(acc.current_balance || 0)})" title="Edit balance"
          class="p-1.5 rounded-full text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors">
          <span class="material-symbols-outlined text-[17px]">edit</span>
        </button>
        <button onclick="deleteAccount('${escapeHtml(acc.id)}', '${escapeHtml(acc.account_name)}')" title="Remove account"
          class="p-1.5 rounded-full text-slate-500 hover:text-rose-500 hover:bg-rose-50 transition-colors">
          <span class="material-symbols-outlined text-[17px]">delete</span>
        </button>
      </div>` : ""}
      <div id="edit-${escapeHtml(acc.id)}" class="hidden mt-3 flex items-center gap-2">
        <input type="number" step="0.01" min="0" placeholder="New balance"
          class="rounded-lg border-slate-200 text-sm w-40"
          id="editinput-${escapeHtml(acc.id)}" />
        <button onclick="saveBalance('${escapeHtml(acc.id)}', '${escapeHtml(acc.account_type)}', '${escapeHtml(acc.asset_class || "asset")}')"
          class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary/90">
          Save
        </button>
        <button onclick="hideEditBalance('${escapeHtml(acc.id)}')"
          class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  `;
}

function renderAccountsList(accounts) {
  const container = document.getElementById("accountsList");
  if (!container) return;
  const items = Array.isArray(accounts) ? accounts : [];

  setText("accountsListMeta", items.length ? `${items.length} account${items.length === 1 ? "" : "s"}` : "");

  if (!items.length) {
    container.innerHTML = `<p class="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">No accounts yet. Add your first account using the form.</p>`;
    return;
  }

  const isLiab = (a) => String(a.asset_class || "asset").toLowerCase() === "liability";
  const assets = items.filter((a) => !isLiab(a));
  const liabilities = items.filter(isLiab);

  const sectionHeader = (title, arr, tone) => {
    const subtotal = arr.reduce((s, a) => s + _accountBalanceFor(a), 0);
    return `
      <div class="mb-2 mt-1 flex items-center justify-between">
        <p class="text-[10px] font-black uppercase tracking-widest ${tone}">${title} <span class="text-slate-400">(${arr.length})</span></p>
        <p class="text-xs font-black ${tone}">${formatMoney(subtotal)}</p>
      </div>`;
  };

  let html = "";
  if (assets.length) {
    html += sectionHeader("Assets", assets, "text-emerald-600")
      + `<div class="space-y-3">${assets.map(accountCard).join("")}</div>`;
  }
  if (liabilities.length) {
    html += `<div class="mt-5">`
      + sectionHeader("Liabilities", liabilities, "text-rose-600")
      + `<div class="space-y-3">${liabilities.map(accountCard).join("")}</div></div>`;
  }
  container.innerHTML = html;
}

function showEditBalance(id, currentBalance) {
  const panel = document.getElementById(`edit-${id}`);
  const input = document.getElementById(`editinput-${id}`);
  if (!panel || !input) return;
  input.value = Math.abs(currentBalance);
  panel.classList.remove("hidden");
  input.focus();
  document.getElementById(`acc-${id}`)?.classList.add("is-editing");
}

function hideEditBalance(id) {
  document.getElementById(`edit-${id}`)?.classList.add("hidden");
  document.getElementById(`acc-${id}`)?.classList.remove("is-editing");
}

async function saveBalance(id, accountType, assetClass) {
  const input = document.getElementById(`editinput-${id}`);
  const card = document.getElementById(`acc-${id}`);
  if (!input || !card) return;
  const balance = parseFloat(input.value);
  if (isNaN(balance) || balance < 0) { window.toast?.error("Enter a valid positive balance."); return; }
  const accountName = card.querySelector("p.font-extrabold")?.textContent?.trim() || "Account";
  try {
    const resp = await fetch("/planning/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, current_balance: balance, account_type: accountType, asset_class: assetClass, account_name: accountName }),
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.message || "Save failed");
    hideEditBalance(id);
    await loadAccounts();
  } catch (err) {
    window.toast?.error(err.message || "Could not save balance.");
  }
}

async function deleteAccount(id, name) {
  if (!confirm(`Remove "${name}"? This only removes it from your account list, not your transaction history.`)) return;
  try {
    const resp = await fetch(`/planning/accounts/${id}`, { method: "DELETE" });
    const result = await resp.json();
    if (!result.success) throw new Error(result.message || "Delete failed");
    await loadAccounts();
  } catch (err) {
    window.toast?.error(err.message || "Could not remove account.");
  }
}

async function loadAccounts() {
  try {
    const summaryResp = await fetch("/planning/summary");
    const summary = await summaryResp.json();
    renderSummary(summary.data || {});
    // Use summary accounts which include statement_balance for the lock logic
    const summaryAccounts = (summary.data?.accounts?.accounts) || [];
    renderAccountsList(summaryAccounts);
    setText("accountsFormState", "Link the source tag to auto-match with uploaded statements.");
    setText("wishlistFormState", "Wishlist helps compare optional ideas against your budget and upcoming targets.");
  } catch (error) {
    console.warn("Unable to load accounts summary", error);
    setText("accountsHeroMeta", "Account summary could not be loaded.");
    setText("accountsListMeta", "Source summary could not be loaded.");
  }
}

function bindAccountForm() {
  const form = document.getElementById("accountsForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/planning/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Could not save account.");
      }
      form.reset();
      setText("accountsFormState", "Account saved successfully.");
      await loadAccounts();
    } catch (error) {
      console.warn("Unable to save account", error);
      setText("accountsFormState", error.message || "Could not save account.");
    }
  });
}

function bindBudgetForm() {
  const form = document.getElementById("budgetForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/planning/monthly_budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Could not save budget.");
      }
      setText("budgetFormState", "Monthly budget saved successfully.");
      await loadAccounts();
    } catch (error) {
      console.warn("Unable to save budget", error);
      setText("budgetFormState", error.message || "Could not save budget.");
    }
  });
}

function bindPlannedExpenseForm() {
  const form = document.getElementById("plannedExpenseForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/planning/planned_expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Could not save planned expense.");
      }
      form.reset();
      setText("plannedExpenseFormState", "Target saved successfully.");
      await loadAccounts();
    } catch (error) {
      console.warn("Unable to save planned expense", error);
      setText("plannedExpenseFormState", error.message || "Could not save planned expense.");
    }
  });
}

function bindWishlistForm() {
  const form = document.getElementById("wishlistForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/planning/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizePayload(form)),
      });
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Could not save wishlist item.");
      }
      form.reset();
      setText("wishlistFormState", "Wishlist item saved successfully.");
      await loadAccounts();
    } catch (error) {
      console.warn("Unable to save wishlist item", error);
      setText("wishlistFormState", error.message || "Could not save wishlist item.");
    }
  });
}

function bindAccountTypeAutoClass() {
  const typeSelect = document.querySelector('#accountsForm [name="account_type"]');
  const classSelect = document.querySelector('#accountsForm [name="asset_class"]');
  if (!typeSelect || !classSelect) return;
  const liabilityTypes = new Set(["credit_card", "personal_loan", "home_loan", "vehicle_loan", "other_liability"]);
  typeSelect.addEventListener("change", () => {
    classSelect.value = liabilityTypes.has(typeSelect.value) ? "liability" : "asset";
  });
}

// ── Trend charts ──────────────────────────────────────────────────────────────

function _svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

async function loadCharts() {
  await Promise.all([loadMonthlyChart(), loadNwSparkline()]);
}

async function loadMonthlyChart() {
  const svg = document.getElementById("monthly-chart");
  const labelsEl = document.getElementById("monthly-chart-labels");
  if (!svg || !labelsEl) return;

  try {
    // Build a 6-month date window
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);

    const res = await fetch(`/reports/trends/monthly?from_date=${fromStr}&to_date=${toStr}`);
    const data = await res.json();
    const rows = (data.data || []).slice(-6);
    if (!rows.length) { svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="11">No data yet</text>'; return; }

    const incomes  = rows.map(r => Math.abs(Number(r.total_income || 0)));
    const expenses = rows.map(r => Math.abs(Number(r.total_expense || 0)));
    const maxVal   = Math.max(...incomes, ...expenses, 1);

    const H = 110, padTop = 8, barH = H - padTop;
    const n = rows.length;
    const groupW = 100 / n;
    const bw = groupW * 0.32; // each bar ~32% of group width

    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 100 ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");

    rows.forEach((row, i) => {
      const cx = groupW * i + groupW / 2;
      const incH  = (incomes[i]  / maxVal) * barH;
      const expH  = (expenses[i] / maxVal) * barH;

      // Income bar
      const incBar = _svgEl("rect", {
        x: cx - bw - 1, y: H - incH, width: bw, height: Math.max(incH, 1),
        fill: "#059669", rx: "1",
      });
      svg.appendChild(incBar);

      // Expense bar
      const expBar = _svgEl("rect", {
        x: cx + 1, y: H - expH, width: bw, height: Math.max(expH, 1),
        fill: "#dc2626", rx: "1",
      });
      svg.appendChild(expBar);
    });

    // Labels
    labelsEl.innerHTML = rows.map(r => {
      const d = new Date(r.month + "-01");
      const label = d.toLocaleDateString("en-IN", { month: "short" });
      return `<span class="text-[9px] text-slate-400 font-semibold">${label}</span>`;
    }).join("");

  } catch (e) {
    if (svg) svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="11">Could not load chart</text>';
  }
}

async function loadNwSparkline() {
  const svg = document.getElementById("nw-sparkline");
  const meta = document.getElementById("nw-spark-meta");
  if (!svg) return;

  try {
    const res = await fetch("/planning/net-worth/history?limit=24");
    const data = await res.json();
    const rows = data.data || [];

    if (rows.length < 2) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="11">Not enough data yet</text>';
      if (meta) meta.textContent = "Take more daily snapshots to see a trend.";
      return;
    }

    const vals = rows.map(r => Number(r.net_worth || 0));
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const W = 100, H = 110, pad = 6;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = "";

    // Zero line
    if (minV < 0 && maxV > 0) {
      const zy = pad + (1 - (0 - minV) / range) * (H - pad * 2);
      const zLine = _svgEl("line", { x1: 0, y1: zy, x2: W, y2: zy, stroke: "#cbd5e1", "stroke-width": "0.5", "stroke-dasharray": "2,2" });
      svg.appendChild(zLine);
    }

    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = pad + (1 - (v - minV) / range) * (H - pad * 2);
      return `${x},${y}`;
    });

    // Gradient fill
    const defs = _svgEl("defs", {});
    const grad = _svgEl("linearGradient", { id: "nwGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
    const stop1 = _svgEl("stop", { offset: "0%", "stop-color": "#607AFB", "stop-opacity": "0.18" });
    const stop2 = _svgEl("stop", { offset: "100%", "stop-color": "#607AFB", "stop-opacity": "0.01" });
    grad.appendChild(stop1); grad.appendChild(stop2); defs.appendChild(grad); svg.appendChild(defs);

    const lastPt = pts[pts.length - 1];
    const firstPt = pts[0];
    const [lastX, lastY] = lastPt.split(",");
    const [, firstY] = firstPt.split(","); // unused but kept for symmetry
    const areaD = `M ${pts.join(" L ")} L ${lastX},${H} L 0,${H} Z`;
    const area = _svgEl("path", { d: areaD, fill: "url(#nwGrad)" });
    svg.appendChild(area);

    const line = _svgEl("polyline", {
      points: pts.join(" "), fill: "none", stroke: "#607AFB", "stroke-width": "1.5", "stroke-linejoin": "round", "stroke-linecap": "round",
    });
    svg.appendChild(line);

    // Endpoint dot
    const [ex, ey] = lastPt.split(",");
    svg.appendChild(_svgEl("circle", { cx: ex, cy: ey, r: "2.5", fill: "#607AFB" }));

    // Delta badge + label
    const first = vals[0], last = vals[vals.length - 1];
    const delta = last - first;
    const sign  = delta >= 0 ? "+" : "";
    const color = delta >= 0 ? "#059669" : "#dc2626";

    // Net-worth card badge: change since the first snapshot of the current month
    // (falls back to change vs the previous snapshot).
    const nwDeltaEl = document.getElementById("netWorthDelta");
    if (nwDeltaEl) {
      const nowM = new Date();
      const monthRows = rows.filter((r) => {
        const d = new Date(r.snapshot_date);
        return !Number.isNaN(d.getTime()) && d.getFullYear() === nowM.getFullYear() && d.getMonth() === nowM.getMonth();
      });
      let change = null, label = "";
      if (monthRows.length >= 2) {
        change = Number(monthRows[monthRows.length - 1].net_worth || 0) - Number(monthRows[0].net_worth || 0);
        label = "this month";
      } else if (vals.length >= 2) {
        change = vals[vals.length - 1] - vals[vals.length - 2];
        label = "since last snapshot";
      }
      if (change !== null && Math.abs(change) >= 1) {
        const up = change >= 0;
        nwDeltaEl.textContent = `${up ? "▲" : "▼"} ₹${Math.abs(change).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${label}`;
        nwDeltaEl.className = `mt-0.5 text-[10px] font-bold ${up ? "text-emerald-600" : "text-rose-600"}`;
      } else {
        nwDeltaEl.textContent = "";
      }
    }

    const badge = document.getElementById("nw-spark-badge");
    if (badge) {
      badge.textContent = `${sign}₹${Math.abs(delta).toLocaleString("en-IN",{maximumFractionDigits:0})}`;
      badge.style.background = delta >= 0 ? "#dcfce7" : "#fee2e2";
      badge.style.color = color;
    }
    if (meta) {
      meta.innerHTML = `<span style="color:${color};font-weight:700">${sign}₹${Math.abs(delta).toLocaleString("en-IN",{maximumFractionDigits:0})}</span> vs ${rows[0].snapshot_date} · ${rows.length} snapshots`;
    }

    // Hover tooltip
    const tooltip = document.getElementById("nw-tooltip");
    if (tooltip) {
      const svgRect = { W, H };
      svg.addEventListener("mousemove", e => {
        const rect = svg.getBoundingClientRect();
        const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const i = Math.round(xFrac * (vals.length - 1));
        const v = vals[i];
        const d = rows[i]?.snapshot_date || "";
        tooltip.style.display = "block";
        tooltip.textContent = `${d}: ₹${v.toLocaleString("en-IN",{maximumFractionDigits:0})}`;
        const tx = Math.min(e.clientX - rect.left, rect.width - 160);
        tooltip.style.left = tx + "px";
        tooltip.style.top = "-28px";
      });
      svg.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    }
  } catch (e) {
    if (svg) svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="11">Could not load</text>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindBudgetInteractions();
  bindAccountForm();
  bindBudgetForm();
  bindPlannedExpenseForm();
  bindWishlistForm();
  bindAccountTypeAutoClass();
  loadAccounts();
  loadCharts();
});
