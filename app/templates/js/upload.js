const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const modal = document.getElementById("modal");
const modalMessage = document.getElementById("modalMessage");
const statementPasswordGroup = document.getElementById("statementPasswordGroup");
const statementPasswordInput = document.getElementById("statement_password");
const statementUploadInsight = document.getElementById("statementUploadInsight");
const manualTransactionModal = document.getElementById("manualTransactionModal");
const manualTransactionForm = document.getElementById("manualTransactionForm");
const manualTransactionMessage = document.getElementById("manualTransactionMessage");
const DASHBOARD_LIMIT = 10;
const APP_SETTINGS_KEY = "finance_tracker_settings";
const RBL_CHECKPOINT_HISTORY_KEY = "expense_tracker_rbl_checkpoint_history_v1";
const ACCOUNT_RECONCILIATION_CACHE_KEY = "expense_tracker_statement_reconciliation_v1";
const dashboardState = {
  rows: [],
  categories: [],
  selectedCategory: "",
  page: 1,
};

const selectedTxnIds = new Set();

function updateSelectionBar() {
  const bar = document.getElementById("merchant-selection-bar");
  const countEl = document.getElementById("merchant-selection-count");
  const groupBtn = document.getElementById("merchant-group-btn");
  if (!bar) return;
  if (selectedTxnIds.size >= 1) {
    bar.classList.remove("hidden");
    const n = selectedTxnIds.size;
    if (countEl) countEl.textContent = `${n} transaction${n === 1 ? "" : "s"} selected`;
    if (groupBtn) {
      groupBtn.disabled = n < 2;
      groupBtn.title = n < 2 ? "Select at least 2 transactions" : "";
    }
  } else {
    bar.classList.add("hidden");
  }
  const allBox = document.getElementById("selectAllTxns");
  if (allBox) {
    const visibleBoxes = document.querySelectorAll("tbody.divide-y input[type='checkbox'][data-txn-id]");
    const allChecked = visibleBoxes.length > 0 && [...visibleBoxes].every(cb => selectedTxnIds.has(cb.dataset.txnId));
    allBox.checked = allChecked;
    allBox.indeterminate = !allChecked && selectedTxnIds.size > 0;
  }
}

function clearTxnSelection() {
  selectedTxnIds.clear();
  document.querySelectorAll("tbody.divide-y input[type='checkbox'][data-txn-id]").forEach(cb => { cb.checked = false; });
  const allBox = document.getElementById("selectAllTxns");
  if (allBox) { allBox.checked = false; allBox.indeterminate = false; }
  updateSelectionBar();
}

function loadAppSettings() {
  try {
    return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || "{}");
  } catch (error) {
    console.warn("Unable to read app settings", error);
    return {};
  }
}

function getDashboardLimit() {
  const rowsPerPage = Number(loadAppSettings().rowsPerPage || DASHBOARD_LIMIT);
  return Number.isFinite(rowsPerPage) && rowsPerPage > 0 ? rowsPerPage : DASHBOARD_LIMIT;
}

function formatINR(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPlainDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getStatementPeriodLabel(period) {
  if (!period?.from_date && !period?.to_date) return "No statement dates found";
  if (period.from_date === period.to_date) return formatPlainDate(period.from_date);
  return `${formatPlainDate(period.from_date)} to ${formatPlainDate(period.to_date)}`;
}

function getReconciliationStatus(reconciliation) {
  if (!reconciliation) {
    return {
      settled: false,
      label: "No live reconciliation yet",
      className: "border-amber-200 bg-amber-50 text-amber-800",
      guidance: "Upload a statement with running balance rows, then check this panel again.",
    };
  }

  if (typeof reconciliation.is_aligned === "boolean") {
    const mismatch = Number(reconciliation.mismatch_amount || 0);
    const isCheckpoint = Boolean(reconciliation.to_date && !reconciliation.from_date);
    if (reconciliation.is_aligned) {
      return {
        settled: true,
        label: isCheckpoint ? "Checkpoint aligned" : "Period aligned",
        className: "border-emerald-200 bg-emerald-50 text-emerald-800",
        guidance: isCheckpoint
          ? "All DB transactions up to this statement close date reproduce the statement balance. Move forward in the binary search."
          : "This uploaded statement period matches the DB. For binary search, move forward and test the later half.",
      };
    }

    return {
      settled: false,
      label: `${isCheckpoint ? "Checkpoint" : "Period"} mismatch ${formatINR(mismatch)}`,
      className: "border-rose-200 bg-rose-50 text-rose-800",
      guidance: isCheckpoint
        ? "The DB balance up to this statement close date does not match the statement. The first bad statement is at or before this checkpoint."
        : "This uploaded statement period does not match the DB. Split this date window and test the smaller half next.",
    };
  }

  const mismatch = Number(reconciliation.mismatch_amount || 0);
  const componentCount = Math.max(
    Number(reconciliation.opening_component_count || 0),
    Number(reconciliation.closing_component_count || 0)
  );
  const settled = Math.abs(mismatch) <= 0.01 && componentCount <= 1;

  if (settled) {
    return {
      settled: true,
      label: "Settled",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      guidance: "This checkpoint is clean. For binary search, move forward and add the later half of the remaining RBL statements.",
    };
  }

  return {
    settled: false,
    label: `Mismatch ${formatINR(mismatch)}`,
    className: "border-rose-200 bg-rose-50 text-rose-800",
    guidance: "The drift exists in the current tested range. Split this date window and test the smaller half next.",
  };
}

function loadRblCheckpointHistory() {
  try {
    const raw = sessionStorage.getItem(RBL_CHECKPOINT_HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Unable to read RBL checkpoint history", error);
    return [];
  }
}

function saveRblCheckpointHistory(history) {
  try {
    sessionStorage.setItem(
      RBL_CHECKPOINT_HISTORY_KEY,
      JSON.stringify((Array.isArray(history) ? history : []).slice(-8))
    );
  } catch (error) {
    console.warn("Unable to save RBL checkpoint history", error);
  }
}

function addRblCheckpoint(result) {
  if (String(result?.statement_source || "").toUpperCase() !== "RBL") return;
  const status = getReconciliationStatus(
    result?.checkpoint_reconciliation
    || result?.period_reconciliation
    || result?.source_reconciliation
    || null
  );
  const period = result?.statement_period || {};
  const checkpoint = {
    periodLabel: getStatementPeriodLabel(period),
    fromDate: period.from_date || "",
    toDate: period.to_date || "",
    settled: status.settled,
    label: status.label,
    mismatchAmount: Number(
      result?.checkpoint_reconciliation?.mismatch_amount
      || result?.period_reconciliation?.mismatch_amount
      || result?.source_reconciliation?.mismatch_amount
      || 0
    ),
    checkedAt: new Date().toISOString(),
  };
  const history = loadRblCheckpointHistory();
  history.push(checkpoint);
  saveRblCheckpointHistory(history);
}

function saveLatestStatementReconciliation(result) {
  const source = String(result?.statement_source || "").trim().toUpperCase();
  if (!source) return;
  const reconciliation = result?.checkpoint_reconciliation
    || result?.period_reconciliation
    || result?.source_reconciliation
    || null;
  if (!reconciliation) return;
  const period = result?.statement_period || {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_RECONCILIATION_CACHE_KEY) || "{}");
    const cache = parsed && typeof parsed === "object" ? parsed : {};
    cache[source] = {
      source,
      checkedAt: new Date().toISOString(),
      fromDate: period.from_date || reconciliation.from_date || "",
      toDate: period.to_date || reconciliation.to_date || reconciliation.latest_transaction_date || "",
      isAligned: typeof reconciliation.is_aligned === "boolean"
        ? reconciliation.is_aligned
        : Math.abs(Number(reconciliation.mismatch_amount || 0)) <= 0.01,
      mismatchAmount: Number(reconciliation.mismatch_amount || 0),
      statementClosingBalance: reconciliation.statement_closing_balance
        ?? reconciliation.statement?.closing_balance
        ?? null,
      databaseCalculatedClosingBalance: reconciliation.database_calculated_closing_balance
        ?? reconciliation.database?.calculated_closing_balance
        ?? reconciliation.calculated_closing_balance
        ?? null,
    };
    localStorage.setItem(ACCOUNT_RECONCILIATION_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Unable to save statement reconciliation cache", error);
  }
}

function renderRblCheckpointHistory() {
  const history = loadRblCheckpointHistory();
  if (!history.length) return "";

  return `
    <div class="border-t border-slate-200 pt-3">
      <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">RBL checkpoints this session</p>
      <div class="mt-2 flex flex-col gap-1.5">
        ${history.slice(-5).reverse().map((checkpoint) => `
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">
            <span class="font-semibold text-slate-700">${escapeHtml(checkpoint.periodLabel || "-")}</span>
            <span class="font-bold ${checkpoint.settled ? "text-emerald-700" : "text-rose-700"}">${escapeHtml(checkpoint.label || "-")}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderStatementUploadInsight(result) {
  if (!statementUploadInsight) return;

  const source = String(result?.statement_source || "").toUpperCase();
  const period = result?.statement_period || {};
  const periodReconciliation = result?.period_reconciliation || null;
  const checkpointReconciliation = result?.checkpoint_reconciliation || null;
  const sourceReconciliation = result?.source_reconciliation || null;
  const reconciliation = checkpointReconciliation || periodReconciliation || sourceReconciliation;
  const status = getReconciliationStatus(reconciliation);
  const isRbl = source === "RBL";
  const appRange = periodReconciliation
    ? `${formatPlainDate(periodReconciliation.from_date)} to ${formatPlainDate(periodReconciliation.to_date)}`
    : sourceReconciliation
    ? `${formatPlainDate(sourceReconciliation.first_transaction_date)} to ${formatPlainDate(sourceReconciliation.latest_transaction_date)}`
    : "-";
  const chainCount = checkpointReconciliation
    ? Math.max(
        Number(checkpointReconciliation.database?.opening_component_count || 0),
        Number(checkpointReconciliation.database?.closing_component_count || 0)
      )
    : periodReconciliation
    ? Math.max(
        Number(periodReconciliation.database?.opening_component_count || 0),
        Number(periodReconciliation.database?.closing_component_count || 0)
      )
    : sourceReconciliation
    ? Math.max(
        Number(sourceReconciliation.opening_component_count || 0),
        Number(sourceReconciliation.closing_component_count || 0)
      )
    : 0;
  const alignment = result?.alignment || {};
  const statementWindow = periodReconciliation?.statement || {};
  const databaseWindow = periodReconciliation?.database || {};
  const checkpointDatabaseWindow = checkpointReconciliation?.database || {};
  const statementClosingBalance = checkpointReconciliation
    ? checkpointReconciliation.statement_closing_balance
    : periodReconciliation
    ? statementWindow.closing_balance
    : sourceReconciliation?.statement_closing_balance;
  const appCalculatedClosingBalance = checkpointReconciliation
    ? checkpointReconciliation.database_calculated_closing_balance
    : periodReconciliation
    ? databaseWindow.calculated_closing_balance
    : sourceReconciliation?.calculated_closing_balance;

  const inserted = Number(result?.inserted_count || 0);
  const merged   = Number(result?.merged_count   || 0);
  const skipped  = Number(result?.skipped_count  || 0);

  statementUploadInsight.classList.remove("hidden");
  statementUploadInsight.innerHTML = `
    <div class="flex flex-col gap-3">

      <!-- ── Import summary banner ── -->
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Import complete</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-3">
              <span class="flex items-center gap-1.5 text-sm font-extrabold text-emerald-700">
                <span class="material-symbols-outlined text-[16px]">add_circle</span>
                ${inserted} new
              </span>
              ${merged > 0 ? `<span class="flex items-center gap-1.5 text-sm font-semibold text-sky-700">
                <span class="material-symbols-outlined text-[16px]">merge</span>
                ${merged} merged
              </span>` : ""}
              ${skipped > 0 ? `<span class="flex items-center gap-1.5 text-sm font-semibold text-slate-500">
                <span class="material-symbols-outlined text-[16px]">block</span>
                ${skipped} skipped
              </span>` : ""}
            </div>
          </div>
          ${inserted > 0 ? `<a href="/reports/" class="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/90">
            Review in Reports →
          </a>` : ""}
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Upload checkpoint</p>
          <h4 class="mt-1 text-base font-black text-slate-900 dark:text-white">${escapeHtml(source || "Statement")} ${isRbl ? "binary-search status" : "statement status"}</h4>
        </div>
        <span class="rounded-lg border px-3 py-1 text-xs font-black ${status.className}">
          ${escapeHtml(status.label)}
        </span>
      </div>
      <div class="grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
        <p><span class="font-bold text-slate-900">Statement dates:</span> ${escapeHtml(getStatementPeriodLabel(period))}</p>
        <p><span class="font-bold text-slate-900">Parsed rows:</span> ${escapeHtml(String(period.transaction_count || result?.transaction_count || 0))}</p>
        <p><span class="font-bold text-slate-900">Checked DB range:</span> ${escapeHtml(appRange)}</p>
        <p><span class="font-bold text-slate-900">Balance chains:</span> ${escapeHtml(String(chainCount || "-"))}</p>
        <p><span class="font-bold text-slate-900">Statement net:</span> ${escapeHtml(formatINR(statementWindow.net_movement || 0))}</p>
        <p><span class="font-bold text-slate-900">DB net:</span> ${escapeHtml(formatINR(databaseWindow.net_movement || 0))}</p>
        <p><span class="font-bold text-slate-900">Statement close:</span> ${escapeHtml(formatINR(statementClosingBalance || 0))}</p>
        <p><span class="font-bold text-slate-900">DB calculated close:</span> ${escapeHtml(formatINR(appCalculatedClosingBalance || 0))}</p>
      </div>
      ${checkpointReconciliation ? `
        <p class="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
          Checkpoint calculation: DB transactions from the first ${escapeHtml(source)} row through ${escapeHtml(formatPlainDate(checkpointReconciliation.to_date))}
          calculate ${escapeHtml(formatINR(checkpointReconciliation.database_calculated_closing_balance || 0))}
          versus statement closing balance ${escapeHtml(formatINR(checkpointReconciliation.statement_closing_balance || 0))}.
        </p>
        <p class="text-xs text-slate-500">
          Cumulative DB rows ${escapeHtml(String(checkpointDatabaseWindow.transaction_count || 0))}, cumulative net ${escapeHtml(formatINR(checkpointDatabaseWindow.net_movement || 0))}.
        </p>
      ` : ""}
      ${periodReconciliation ? `
        <p class="text-xs text-slate-500">
          Statement-period check: statement rows ${escapeHtml(String(statementWindow.transaction_count || 0))}, DB rows ${escapeHtml(String(databaseWindow.transaction_count || 0))}, row difference ${escapeHtml(String(periodReconciliation.row_count_delta || 0))}, period mismatch ${escapeHtml(formatINR(periodReconciliation.mismatch_amount || 0))}.
        </p>
      ` : ""}
      ${isRbl ? `<p class="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">${escapeHtml(status.guidance)}</p>` : ""}
      ${isRbl && sourceReconciliation ? `
        <p class="text-xs text-slate-500">
          Overall ${escapeHtml(source)} status: ${escapeHtml(getReconciliationStatus(sourceReconciliation).label)}.
        </p>
      ` : ""}
      ${isRbl && alignment ? `
        <p class="text-xs text-slate-500">
          RBL alignment updated ${escapeHtml(String(alignment.updated_count || 0))}, retimed ${escapeHtml(String(alignment.retimed_count || 0))}, inserted ${escapeHtml(String(alignment.inserted_count || 0))}, deleted ${escapeHtml(String(alignment.deleted_count || 0))}.
        </p>
      ` : ""}
      ${isRbl ? renderRblCheckpointHistory() : ""}
    </div>
  `;
}

function getPositiveAmount(row, fieldName) {
  const value = Number(row?.[fieldName]);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(Math.abs(value).toFixed(2)));
}

function getEffectiveExpense(row) {
  return getPositiveAmount(row, "effective_expense_amount");
}

function getEffectiveIncome(row) {
  return getPositiveAmount(row, "effective_income_amount");
}

function getAccountingDisplayAmount(row) {
  return String(row?.direction || "").toLowerCase() === "withdrawal"
    ? getEffectiveExpense(row)
    : getEffectiveIncome(row);
}

function getReviewState(row) {
  return String(row?.review_status || "").trim().toLowerCase();
}

function isOpenReview(row) {
  return ["needs_review", "unknown", "unreviewed"].includes(getReviewState(row));
}

function getPrimaryCategory(row) {
  const tags = normalizeTags(row?.tags);
  return tags[0] || "Uncategorized";
}

function transactionMatchesCategory(row, categoryName) {
  const selectedCategory = String(categoryName || "").trim();
  if (!selectedCategory) return true;
  const tags = normalizeTags(row?.tags);
  if (selectedCategory === "Uncategorized") return tags.length === 0;
  return tags.some((tag) => tag.toLowerCase() === selectedCategory.toLowerCase());
}

function getFilteredDashboardRows() {
  return dashboardState.rows.filter((row) =>
    transactionMatchesCategory(row, dashboardState.selectedCategory)
  );
}

function setDashboardText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function buildCategoryTotals(rows) {
  const totals = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const amount = getEffectiveExpense(row);
    if (amount <= 0) return;
    const category = getPrimaryCategory(row);
    totals.set(category, (totals.get(category) || 0) + amount);
  });

  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

function renderSidebarCategories(rows, categories) {
  const container = document.getElementById("sidebarCategorySummary");
  const meta = document.getElementById("sidebarCategoryMeta");
  if (!container) return;

  const categoryTotals = buildCategoryTotals(rows);
  const totalExpense = categoryTotals.reduce((sum, category) => sum + category.amount, 0);
  const configuredCategories = Array.isArray(categories) ? categories : [];
  const configuredNames = configuredCategories.map((category) => String(category?.name || "").trim()).filter(Boolean);
  const shownNames = new Set();

  const topRows = categoryTotals.slice(0, 5).map((category) => {
    shownNames.add(category.name);
    const percent = totalExpense > 0 ? Math.min(100, Math.round((category.amount / totalExpense) * 100)) : 0;
    return { ...category, percent };
  });

  configuredNames
    .filter((name) => !shownNames.has(name))
    .slice(0, Math.max(0, 5 - topRows.length))
    .forEach((name) => topRows.push({ name, amount: 0, percent: 0 }));

  if (meta) {
    meta.textContent = `${configuredNames.length} saved, ${categoryTotals.length} used`;
  }

  if (!topRows.length) {
    container.innerHTML = `
      <a href="/classification/manage" class="block rounded-xl bg-white p-3 text-xs font-semibold text-primary shadow-sm ring-1 ring-slate-100 hover:bg-primary hover:text-white dark:bg-slate-900 dark:ring-slate-800">
        Create your first category
      </a>
    `;
    return;
  }

  container.innerHTML = [
    {
      name: "",
      label: "All categories",
      amount: totalExpense,
      percent: 100,
    },
    ...topRows.map((category) => ({ ...category, label: category.name })),
  ]
    .map((category) => `
      <button type="button" data-dashboard-category="${escapeHtml(category.name)}" class="block w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:ring-primary/30 dark:bg-slate-900 ${dashboardState.selectedCategory === category.name ? "ring-primary/60" : "ring-slate-100 dark:ring-slate-800"}">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-xs font-bold text-slate-700 dark:text-slate-200">${escapeHtml(category.label)}</span>
          <span class="text-[11px] font-semibold text-slate-400">${formatINR(category.amount)}</span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div class="h-full rounded-full bg-primary" style="width: ${category.percent}%"></div>
        </div>
      </button>
    `)
    .join("");
}

function populateDashboardCategoryFilter(rows, categories) {
  const select = document.getElementById("dashboardCategoryFilter");
  if (!select) return;

  const categoryTotals = buildCategoryTotals(rows);
  const names = new Set();
  (Array.isArray(categories) ? categories : []).forEach((category) => {
    const name = String(category?.name || "").trim();
    if (name) names.add(name);
  });
  categoryTotals.forEach((category) => names.add(category.name));
  if (rows.some((row) => normalizeTags(row.tags).length === 0)) {
    names.add("Uncategorized");
  }

  select.innerHTML = [
    '<option value="">All categories</option>',
    ...[...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
  ].join("");
  select.value = [...names].includes(dashboardState.selectedCategory) ? dashboardState.selectedCategory : "";
  dashboardState.selectedCategory = select.value;
}

function renderDashboardSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const expenseRows = safeRows.filter((row) => getEffectiveExpense(row) > 0);
  const incomeRows = safeRows.filter((row) => getEffectiveIncome(row) > 0);
  const reviewRows = safeRows.filter(isOpenReview);
  const excludedRows = safeRows.filter((row) => getAccountingDisplayAmount(row) <= 0);
  const totalExpense = expenseRows.reduce((sum, row) => sum + getEffectiveExpense(row), 0);
  const totalIncome = incomeRows.reduce((sum, row) => sum + getEffectiveIncome(row), 0);
  const categoryTotals = buildCategoryTotals(safeRows);
  const topCategory = categoryTotals[0];

  setDashboardText("summaryTotalSpent", formatINR(totalExpense));
  setDashboardText("summaryTotalIncome", formatINR(totalIncome));
  setDashboardText("summaryNeedsReview", String(reviewRows.length));
  setDashboardText("summaryTopCategory", topCategory?.name || "No category yet");
  setDashboardText("summaryTotalSpentMeta", `${expenseRows.length} counted rows, ${excludedRows.length} transfer/payback/refund rows excluded.`);
  setDashboardText("summaryTotalIncomeMeta", `${incomeRows.length} counted credit rows. Linked paybacks are excluded.`);
  setDashboardText("summaryNeedsReviewMeta", reviewRows.length ? "Open these from Reports to finish tagging." : "Everything visible is reviewed.");
  setDashboardText("summaryTopCategoryMeta", topCategory ? `${formatINR(topCategory.amount)} cash spend` : "Tag transactions to build this.");
  setDashboardText(
    "dashboardSummaryMeta",
    dashboardState.selectedCategory
      ? `${safeRows.length} transaction${safeRows.length === 1 ? "" : "s"} in ${dashboardState.selectedCategory}`
      : `${safeRows.length} total transactions loaded`
  );
}

function renderRecentTransactions(rows) {
  const tbody = document.querySelector("tbody.divide-y");
  if (!tbody) return;

  const sortedRows = [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => {
      const dateResult = String(b.transaction_date || "").localeCompare(String(a.transaction_date || ""));
      if (dateResult !== 0) return dateResult;
      return String(b.transaction_time || "").localeCompare(String(a.transaction_time || ""));
    });
  const pageLimit = getDashboardLimit();
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageLimit));
  dashboardState.page = Math.min(Math.max(1, dashboardState.page || 1), totalPages);
  const startIndex = (dashboardState.page - 1) * pageLimit;
  const recentRows = sortedRows.slice(startIndex, startIndex + pageLimit);

  if (!recentRows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-10 text-center text-sm text-slate-500">
          Upload a statement to see recent transactions here.
        </td>
      </tr>
    `;
    setDashboardText(
      "dashboardPaginationText",
      dashboardState.selectedCategory
        ? `No transactions found for ${dashboardState.selectedCategory}`
        : "No transactions loaded yet"
    );
    return;
  }

  tbody.innerHTML = recentRows
    .map((row) => {
      const isDebit = String(row.direction || "").toLowerCase() === "withdrawal";
      const displayAmount = getAccountingDisplayAmount(row);
      const txnId = escapeHtml(String(row.id || ""));
      const rawAmount = Math.abs(Number(row.amount || 0));
      const tags = normalizeTags(row.tags).slice(0, 3);
      const vendor = row.vendor_name || row.counterparty_entity_name || row.counterparty_identifier || row.narration || "Unknown transaction";
      const source = row.payment_source_name || "Statement";
      const amountClass = isDebit ? "text-red-600" : "text-emerald-600";
      const reviewLabel = getReviewState(row).replace(/_/g, " ") || "unreviewed";
      return `
        <tr class="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" data-txn-id="${txnId}">
          <td class="px-6 py-4" onclick="event.stopPropagation()">
            <input class="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600 dark:bg-slate-800" type="checkbox" data-txn-id="${txnId}" onchange="(function(cb){if(cb.checked)selectedTxnIds.add(cb.dataset.txnId);else selectedTxnIds.delete(cb.dataset.txnId);updateSelectionBar();})(this)" />
          </td>
          <td class="px-6 py-4 text-slate-500 dark:text-slate-400">${escapeHtml(row.transaction_date || "-")}</td>
          <td class="px-6 py-4">
            <div class="flex flex-col">
              <span class="font-medium text-slate-900 dark:text-white hover:text-primary transition-colors">${escapeHtml(vendor)}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(source)}${row.transaction_time ? ` | ${escapeHtml(row.transaction_time)}` : ""}</span>
            </div>
          </td>
          <td class="px-6 py-4 text-right font-bold ${amountClass}">
            ${formatINR(displayAmount)}
            ${Math.abs(rawAmount - displayAmount) > 0.01 ? `<div class="text-xs font-medium text-slate-400 line-through">${formatINR(rawAmount)}</div>` : ""}
          </td>
          <td class="px-6 py-4">
            <div class="flex flex-wrap gap-2">
              ${tags.length
                ? tags.map((tag) => `<span class="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">${escapeHtml(tag)}</span>`).join("")
                : `<span class="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-100">${escapeHtml(reviewLabel)}</span>`}
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <a href="/classification/transaction/${encodeURIComponent(row.id)}?mode=simple" class="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold text-primary ring-1 ring-primary/20 hover:bg-primary hover:text-white">
              Review
            </a>
          </td>
        </tr>
      `;
    })
    .join("");

  // Restore check state for already-selected IDs
  document.querySelectorAll("tbody.divide-y input[type='checkbox'][data-txn-id]").forEach(cb => {
    if (selectedTxnIds.has(cb.dataset.txnId)) cb.checked = true;
  });
  updateSelectionBar();

  // Wire up select-all header checkbox
  const allBox = document.getElementById("selectAllTxns");
  if (allBox) {
    allBox.onchange = function () {
      const visibleBoxes = document.querySelectorAll("tbody.divide-y input[type='checkbox'][data-txn-id]");
      visibleBoxes.forEach(cb => {
        cb.checked = allBox.checked;
        if (allBox.checked) selectedTxnIds.add(cb.dataset.txnId);
        else selectedTxnIds.delete(cb.dataset.txnId);
      });
      updateSelectionBar();
    };
  }

  setDashboardText(
    "dashboardPaginationText",
    dashboardState.selectedCategory
      ? `Showing ${startIndex + 1}-${startIndex + recentRows.length} of ${rows.length} ${dashboardState.selectedCategory} transactions`
      : `Showing ${startIndex + 1}-${startIndex + recentRows.length} of ${rows.length} transactions`
  );
  updateDashboardPaginationControls(totalPages);
}

function renderDashboardView() {
  const filteredRows = getFilteredDashboardRows();
  renderDashboardSummary(filteredRows);
  renderSidebarCategories(dashboardState.rows, dashboardState.categories);
  renderRecentTransactions(filteredRows);
}

/* ── Transaction quick-view panel ──────────────────────────────────────── */
function openTxnPanel(txnId) {
  const panel = document.getElementById("txn-quick-panel");
  const body  = document.getElementById("txn-panel-body");
  if (!panel || !body) return;

  const row = dashboardState.rows.find(r => String(r.id) === String(txnId));
  panel.classList.add("open");

  if (!row) { body.innerHTML = `<p class="text-sm text-slate-400 p-4">Transaction not found.</p>`; return; }

  const isDebit  = String(row.direction || "").toLowerCase() === "withdrawal";
  const amtColor = isDebit ? "text-rose-600" : "text-emerald-600";
  const amtSign  = isDebit ? "−" : "+";
  const tags     = (Array.isArray(row.tags) ? row.tags : []).filter(Boolean);
  const vendor   = row.vendor_name || row.counterparty_entity_name || row.counterparty_identifier || row.narration || "Unknown";

  body.innerHTML = `
    <div class="p-5 space-y-4">
      <div>
        <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400">${isDebit ? "Debit" : "Credit"} · ${escapeHtml(row.payment_source_name || "Statement")}</p>
        <p class="text-xl font-black mt-1 ${amtColor}">${amtSign}${formatINR(Math.abs(Number(row.amount || 0)))}</p>
        <p class="text-sm font-semibold text-slate-800 mt-1">${escapeHtml(vendor)}</p>
        <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(row.transaction_date || "")}${row.transaction_time ? ` · ${escapeHtml(row.transaction_time)}` : ""}</p>
      </div>
      ${row.narration ? `<div class="rounded-lg bg-slate-50 px-3 py-2">
        <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Narration</p>
        <p class="text-xs text-slate-600 break-words">${escapeHtml(row.narration)}</p>
      </div>` : ""}
      ${row.counterparty_identifier ? `<div>
        <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">UPI / Account</p>
        <p class="text-xs font-mono text-slate-600">${escapeHtml(row.counterparty_identifier)}</p>
      </div>` : ""}
      ${tags.length ? `<div>
        <p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Tags</p>
        <div class="flex flex-wrap gap-1.5">
          ${tags.map(t => `<span class="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">${escapeHtml(t)}</span>`).join("")}
        </div>
      </div>` : `<p class="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">No tags yet</p>`}
      <a href="/classification/transaction/${encodeURIComponent(row.id)}?mode=simple"
         class="flex items-center justify-center gap-1.5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 transition-colors">
        <span class="material-symbols-outlined text-[16px]">edit_note</span>
        Review &amp; Tag
      </a>
    </div>`;
}

function closeTxnPanel() {
  document.getElementById("txn-quick-panel")?.classList.remove("open");
}

document.addEventListener("click", e => {
  const tr = e.target.closest("tr[data-txn-id]");
  if (tr && !e.target.closest("a") && !e.target.closest("input") && !e.target.closest("button")) {
    openTxnPanel(tr.dataset.txnId);
  }
});

function setDashboardCategoryFilter(categoryName) {
  dashboardState.selectedCategory = String(categoryName || "").trim();
  dashboardState.page = 1;
  const select = document.getElementById("dashboardCategoryFilter");
  if (select) select.value = dashboardState.selectedCategory;
  renderDashboardView();
}

function updateDashboardPaginationControls(totalPages) {
  const previousButton = document.getElementById("dashboardPrevPage");
  const nextButton = document.getElementById("dashboardNextPage");
  if (previousButton) {
    const isDisabled = dashboardState.page <= 1;
    previousButton.disabled = isDisabled;
    previousButton.classList.toggle("opacity-50", isDisabled);
    previousButton.classList.toggle("cursor-not-allowed", isDisabled);
  }
  if (nextButton) {
    const isDisabled = dashboardState.page >= totalPages;
    nextButton.disabled = isDisabled;
    nextButton.classList.toggle("opacity-50", isDisabled);
    nextButton.classList.toggle("cursor-not-allowed", isDisabled);
  }
}

function changeDashboardPage(delta) {
  const totalRows = getFilteredDashboardRows().length;
  const totalPages = Math.max(1, Math.ceil(totalRows / getDashboardLimit()));
  dashboardState.page = Math.min(totalPages, Math.max(1, dashboardState.page + delta));
  renderDashboardView();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || result.detail || "Unable to load dashboard data");
  }
  return result;
}

async function loadDashboardSummary() {
  try {
    const [transactionResult, categoryResult] = await Promise.all([
      fetchJson("/reports/transactions_filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch((error) => ({ success: false, data: [], message: error.message })),
      fetchJson("/classification/api/categories").catch(() => ({ success: false, data: [] })),
    ]);

    dashboardState.rows = Array.isArray(transactionResult.data) ? transactionResult.data : [];
    dashboardState.categories = Array.isArray(categoryResult.data) ? categoryResult.data : [];
    populateDashboardCategoryFilter(dashboardState.rows, dashboardState.categories);
    renderDashboardView();
  } catch (error) {
    console.warn("Unable to load dashboard summary", error);
    setDashboardText("dashboardSummaryMeta", "Summary unavailable");
    renderRecentTransactions([]);
  }
}

function getStatementSourceElement() {
  return (
    document.getElementById("statement_source") ||
    document.getElementById("statementSource") ||
    document.querySelector('select[name="statement_source"]')
  );
}

function getCustomStatementSourceElement() {
  return document.getElementById("custom_statement_source");
}

function getSelectedStatementSource() {
  const statementSource = getStatementSourceElement();
  const selectedSource = String(statementSource?.value || "BOB").trim();
  if (selectedSource === "CUSTOM") {
    return String(getCustomStatementSourceElement()?.value || "").trim().toUpperCase();
  }
  return selectedSource;
}

function selectFile() {
  fileInput.click();
}

function isPdfFile(file) {
  return Boolean(file?.name?.toLowerCase().endsWith(".pdf"));
}

function clearStatementPassword() {
  if (loadAppSettings().clearPdfPassword === false) return;
  if (statementPasswordInput) {
    statementPasswordInput.value = "";
  }
}

function applyUploadSettings() {
  const statementSource = getStatementSourceElement();
  const defaultSource = String(loadAppSettings().defaultSource || "").trim();
  if (statementSource && defaultSource && !fileInput?.files?.length) {
    statementSource.value = defaultSource;
  }
}

function syncStatementUploadControls() {
  const statementSource = getStatementSourceElement();
  const customSourceInput = getCustomStatementSourceElement();
  const selectedSource = String(statementSource?.value || "BOB").trim();
  if (customSourceInput) {
    customSourceInput.classList.toggle("hidden", selectedSource !== "CUSTOM");
  }
  const showPasswordField = selectedSource === "RBL";

  if (fileInput) {
    if (selectedSource === "RBL") {
      fileInput.accept = ".pdf";
    } else if (selectedSource === "BOB") {
      fileInput.accept = ".csv";
    } else if (selectedSource === "UNION" || selectedSource === "DCB") {
      // Union Bank / DCB export CSV or Excel statements.
      fileInput.accept = ".csv,.xlsx,.xls";
    } else {
      fileInput.accept = ".csv,.pdf,.xlsx,.xls";
    }
  }

  if (statementPasswordGroup) {
    // Toggle only `hidden`; the group is a vertical stack (space-y), so adding
    // `flex` (row) squished the label/input/hint side-by-side.
    statementPasswordGroup.classList.toggle("hidden", !showPasswordField);
  }

  if (!showPasswordField) {
    clearStatementPassword();
  }
}

fileInput.addEventListener("change", () => {
  const name = fileInput.files.length ? fileInput.files[0].name : "";
  if (fileName) {
    fileName.textContent = name || "Click to select file";
    // Highlight the dropzone if a file is chosen
    const dz = document.getElementById("upload-dropzone");
    if (dz) dz.classList.toggle("border-primary/60", !!name);
  }
  clearStatementPassword();
  syncStatementUploadControls();
});

getStatementSourceElement()?.addEventListener("change", () => {
  clearStatementPassword();
  syncStatementUploadControls();
});

function openModal(message) {
  modalMessage.textContent = message;
  modal.style.display = "flex";
}

function closeModal() {
  modal.style.display = "none";
}

function setManualTransactionMessage(message, isError = false) {
  if (!manualTransactionMessage) return;
  manualTransactionMessage.textContent = message;
  manualTransactionMessage.classList.remove("hidden", "bg-emerald-50", "text-emerald-700", "bg-rose-50", "text-rose-700");
  manualTransactionMessage.classList.add(
    isError ? "bg-rose-50" : "bg-emerald-50",
    isError ? "text-rose-700" : "text-emerald-700"
  );
}

function clearManualTransactionMessage() {
  if (!manualTransactionMessage) return;
  manualTransactionMessage.textContent = "";
  manualTransactionMessage.classList.add("hidden");
}

function openManualTransactionModal() {
  if (!manualTransactionModal) return;
  clearManualTransactionMessage();
  const sourceInput = document.getElementById("manual_source");
  const selectedSource = getSelectedStatementSource() || "RBL";
  if (sourceInput) sourceInput.value = selectedSource || "RBL";
  manualTransactionModal.classList.remove("hidden");
  manualTransactionModal.classList.add("flex");
}

function closeManualTransactionModal() {
  if (!manualTransactionModal) return;
  manualTransactionModal.classList.add("hidden");
  manualTransactionModal.classList.remove("flex");
}

function getManualTransactionPayload() {
  return {
    payment_source_name: String(document.getElementById("manual_source")?.value || "RBL").trim() || "RBL",
    transaction_date: document.getElementById("manual_date")?.value || "",
    transaction_time: document.getElementById("manual_time")?.value || null,
    direction: document.getElementById("manual_direction")?.value || "withdrawal",
    amount: Number(document.getElementById("manual_amount")?.value || 0),
    running_balance: Number(document.getElementById("manual_running_balance")?.value || 0),
    counterparty_identifier: document.getElementById("manual_counterparty")?.value || null,
    narration: document.getElementById("manual_narration")?.value || null,
  };
}

async function submitManualTransaction(event) {
  event.preventDefault();
  const payload = getManualTransactionPayload();
  if (!payload.transaction_date || !payload.amount || !Number.isFinite(payload.amount)) {
    setManualTransactionMessage("Date and amount are required.", true);
    return;
  }
  if (!Number.isFinite(payload.running_balance)) {
    setManualTransactionMessage("Running balance is required.", true);
    return;
  }

  setManualTransactionMessage("Adding transaction...");
  try {
    const result = await fetchJson("/upload/manual_transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const sourceLabel = result.statement_source || payload.payment_source_name || "source";
    const statusLabel = result.source_reconciliation
      ? getReconciliationStatus(result.source_reconciliation).label
      : "added";
    setManualTransactionMessage(`Manual ${sourceLabel} transaction added. ${statusLabel}.`);
    manualTransactionForm?.reset();
    if (loadAppSettings().autoRefreshDashboard !== false) {
      await loadDashboardSummary();
    }
  } catch (error) {
    setManualTransactionMessage(error.message || "Manual transaction could not be added.", true);
  }
}

async function uploadFile() {
  const file = fileInput.files[0];
  const statementSource = getStatementSourceElement();
  const rawSelectedSource = getSelectedStatementSource();
  const selectedSource = rawSelectedSource || "BOB";

  if (!file) {
    window.toast?.error("Please select a file first");
    return;
  }
  if (statementSource?.value === "CUSTOM" && !rawSelectedSource) {
    openModal("Enter the bank/account name before uploading this CSV.");
    return;
  }
  if (selectedSource === "BOB" && isPdfFile(file)) {
    openModal("Please select a BOB CSV statement.");
    return;
  }
  if (selectedSource === "RBL" && !isPdfFile(file)) {
    openModal("Please select an RBL PDF statement.");
    return;
  }

  openModal("Processing...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("statement_source", selectedSource);
  if (statementPasswordInput?.value) {
    formData.append("pdf_password", statementPasswordInput.value);
  }

  try {
    const response = await fetch("/upload/statement", {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (!response.ok || result.success === false) {
      throw new Error(result.message || "Upload failed");
    }

    const sourceLabel =
      result.statement_source || selectedSource || "statement";
    const countLabel =
      typeof result.transaction_count === "number"
        ? ` (${result.transaction_count} transactions)`
        : "";
    const mergeSummary =
      typeof result.inserted_count === "number" || typeof result.merged_count === "number"
        ? ` Inserted: ${result.inserted_count || 0}, merged: ${result.merged_count || 0}, skipped: ${result.skipped_count || 0}.`
        : "";
    const periodSummary = result.statement_period
      ? ` Dates: ${getStatementPeriodLabel(result.statement_period)}.`
      : "";
    const reconciliationSummary = result.checkpoint_reconciliation
      ? ` ${result.statement_source || selectedSource} ${getReconciliationStatus(result.checkpoint_reconciliation).label}.`
      : result.period_reconciliation
      ? ` ${result.statement_source || selectedSource} ${getReconciliationStatus(result.period_reconciliation).label}.`
      : result.source_reconciliation
      ? ` ${result.statement_source || selectedSource} ${getReconciliationStatus(result.source_reconciliation).label}.`
      : "";

    saveLatestStatementReconciliation(result);
    addRblCheckpoint(result);
    renderStatementUploadInsight(result);
    openModal(`Upload successful for ${sourceLabel}${countLabel}.${periodSummary}${mergeSummary}${reconciliationSummary}`);
    if (loadAppSettings().autoRefreshDashboard !== false) {
      loadDashboardSummary();
    }
  } catch (err) {
    openModal(err.message || "Upload failed. Please try again.");
  } finally {
    clearStatementPassword();
  }
}

applyUploadSettings();
syncStatementUploadControls();
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openManualTransactionModal")?.addEventListener("click", openManualTransactionModal);
  document.getElementById("closeManualTransactionModal")?.addEventListener("click", closeManualTransactionModal);
  document.getElementById("cancelManualTransaction")?.addEventListener("click", closeManualTransactionModal);
  manualTransactionModal?.addEventListener("click", (event) => {
    if (event.target === manualTransactionModal) closeManualTransactionModal();
  });
  manualTransactionForm?.addEventListener("submit", submitManualTransaction);

  const categoryFilter = document.getElementById("dashboardCategoryFilter");
  if (categoryFilter) {
    categoryFilter.addEventListener("change", () => {
      setDashboardCategoryFilter(categoryFilter.value);
    });
  }

  const sidebarCategories = document.getElementById("sidebarCategorySummary");
  if (sidebarCategories) {
    sidebarCategories.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-dashboard-category]");
      if (!trigger) return;
      setDashboardCategoryFilter(trigger.dataset.dashboardCategory || "");
    });
  }

  document.getElementById("dashboardPrevPage")?.addEventListener("click", () => {
    changeDashboardPage(-1);
  });

  document.getElementById("dashboardNextPage")?.addEventListener("click", () => {
    changeDashboardPage(1);
  });

  loadDashboardSummary();
});
