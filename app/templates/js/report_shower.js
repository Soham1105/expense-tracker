let amountChartInstance = null;
let currentReportTransactions = [];
let _hasSearchedOnce = false;
let currentModifyModalData = null;
let currentPlanningSummary = null;
const selectedTransactionIds = new Set();
let breakdownViewState = {
  month: "",
  direction: "",
  sourceGroup: "",
  ownershipGroup: "",
  settlementGroup: "",
  obligationFocus: "",
  tagState: "",
  reviewState: "",
  completionState: "",
  dateSort: "date_desc",
  amountSort: "",
  showHidden: false,
};
const REPORT_PAGE_STATE_KEY = "expense_tracker_report_state_v2";
const REPORT_SCROLL_STATE_KEY = "expense_tracker_report_scroll_v2";
const REPORT_FOCUS_TX_KEY = "expense_tracker_report_focus_tx_v2";
const REPORT_FORCE_REFRESH_KEY = "expense_tracker_report_force_refresh_v2";
let availableManagedTags = [];
let tagAncestorMap = {};
const CHANNEL_SOURCE_NAMES = new Set(["GPAY", "CRED", "CREDIT", "OTHER"]);
const SPEND_CHART_COLORS = [
  "#2563eb",
  "#059669",
  "#dc2626",
  "#ca8a04",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#475569",
];
const spendChartState = {
  groupBy: "category",
  limit: 8,
  includeUntagged: true,
};

function getTransactionSources(tx) {
  return String(tx?.statement_sources || tx?.payment_source_name || "")
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
}

function normalizeSourceLabel(value) {
  return String(value || "").trim().toUpperCase();
}

function isChannelSource(sourceName) {
  return CHANNEL_SOURCE_NAMES.has(normalizeSourceLabel(sourceName));
}

function getTransactionBankName(tx) {
  const sources = getTransactionSources(tx);
  const paymentSource = normalizeSourceLabel(tx?.payment_source_name);
  if (paymentSource && !isChannelSource(paymentSource)) return paymentSource;
  const directMatch = sources.find((source) => source && !isChannelSource(source));
  if (directMatch) return directMatch;

  const searchableText = [
    tx?.narration,
    tx?.counterparty_identifier,
    tx?.vendor_name,
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
    .join(" ");

  if (!searchableText) return "";
  if (searchableText.includes("RBL")) return "RBL";
  if (searchableText.includes("BANK OF BARODA") || searchableText.includes("BOB")) return "BOB";
  if (searchableText.includes("HDFC")) return "HDFC";
  if (searchableText.includes("ICICI")) return "ICICI";
  if (searchableText.includes("SBI") || searchableText.includes("STATE BANK OF INDIA")) return "SBI";
  if (searchableText.includes("AXIS")) return "AXIS";
  if (searchableText.includes("KOTAK")) return "KOTAK";
  if (searchableText.includes("IDFC")) return "IDFC";
  if (searchableText.includes("YES")) return "YES";
  return "";
}

function getTransactionChannelLabel(tx) {
  const sources = getTransactionSources(tx);
  const narration = String(tx?.narration || "").toLowerCase();
  const counterparty = String(tx?.counterparty_identifier || "").toLowerCase();
  if (
    sources.includes("GPAY") ||
    narration.includes("upi transaction id") ||
    counterparty.includes("gpay")
  ) {
    return "via GPay";
  }
  if (
    sources.includes("CRED") ||
    narration.includes("cred") ||
    counterparty.includes("cred")
  ) {
    return "via CRED";
  }
  if (
    sources.includes("CREDIT") ||
    String(tx?.payment_source_name || "").trim().toUpperCase() === "CREDIT"
  ) {
    return "Credit Card";
  }
  return "";
}

function getTransactionDisplayName(tx) {
  return String(
    tx?.vendor_name
    || tx?.counterparty_entity_name
    || tx?.counterparty_identifier
    || "Unknown vendor"
  ).trim();
}

function getTransactionPartyType(tx) {
  return String(tx?.counterparty_type || tx?.counterparty_entity_type || "").trim();
}

function getTransactionBucketLabel(tx) {
  const partyType = getTransactionPartyType(tx).toLowerCase();
  const primaryFlowType = String(tx?.primary_flow_type || "").trim().toLowerCase();

  if (primaryFlowType === "transfer") return "Self Transfer";
  if (primaryFlowType === "income" && !partyType) return "Income";
  if (partyType === "merchant") return "Merchant";
  if (partyType === "friend") return "Friend";
  if (partyType === "family") return "Family";
  if (partyType === "employer") return "Employer";
  if (partyType === "bank") return "Bank";
  if (partyType === "government") return "Government";
  if (partyType === "unknown") return "Unknown";
  return primaryFlowType ? primaryFlowType.replace(/_/g, " ") : "";
}

function getConsumptionOwnershipMeta(tx) {
  const value = String(tx?.consumption_ownership || "").trim().toLowerCase();
  if (!value) return null;

  const labelMap = {
    self: "Self",
    family_household: "Family / Household",
    shared: "Shared",
    business: "Business",
    other: "Other",
    not_consumption: "Not Consumption",
  };

  const classMap = {
    self: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    family_household: "bg-rose-50 text-rose-700 ring-rose-100",
    shared: "bg-amber-50 text-amber-700 ring-amber-100",
    business: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    other: "bg-slate-100 text-slate-700 ring-slate-200",
    not_consumption: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  };

  return {
    label: `Use: ${labelMap[value] || value.replace(/_/g, " ")}`,
    className: classMap[value] || "bg-slate-100 text-slate-700 ring-slate-200",
  };
}

function getSettlementStateMeta(tx) {
  const value = String(tx?.settlement_state || "").trim().toLowerCase();
  if (!value || value === "none") return null;

  const labelMap = {
    owed_to_me: "Pending Recovery",
    i_owe: "Payable",
    partial: "Partly Settled",
    settled: "Settled",
  };

  const classMap = {
    owed_to_me: "bg-amber-50 text-amber-700 ring-amber-100",
    i_owe: "bg-rose-50 text-rose-700 ring-rose-100",
    partial: "bg-orange-50 text-orange-700 ring-orange-100",
    settled: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  };

  return {
    label: labelMap[value] || value.replace(/_/g, " "),
    className: classMap[value] || "bg-slate-100 text-slate-700 ring-slate-200",
  };
}

function formatINR(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function renderPlanningSnapshot(summary) {
  currentPlanningSummary = summary || null;
  const budget = currentPlanningSummary?.budget || {};
  const planned = currentPlanningSummary?.planned_expenses || {};
  const wishlist = currentPlanningSummary?.wishlist || {};
  const plannedItems = Array.isArray(planned.items) ? planned.items : [];
  const wishlistItems = Array.isArray(wishlist.items) ? wishlist.items : [];
  const openWishlistCount = wishlistItems.filter((row) => ["wishlist", "planned"].includes(String(row?.status || "").trim().toLowerCase())).length;
  const budgetAmount = Number(budget.budget_amount || 0);
  const spentSoFar = Number(budget.spent_so_far || 0);
  const remainingAmount = Number(budget.remaining_amount || 0);
  const usagePercent = Math.max(0, Number(budget.usage_percent || 0));
  const budgetStatus = String(budget.status || "").trim().toLowerCase();

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  if (budgetAmount > 0) {
    setText(
      "planning-budget-total",
      `${remainingAmount < 0 ? "-" : ""}${formatINR(Math.abs(remainingAmount))} ${remainingAmount < 0 ? "over" : "left"}`
    );
    setText(
      "planning-budget-meta",
      `${Math.round(usagePercent)}% used · spent ${formatINR(spentSoFar)} of ${formatINR(budgetAmount)}${budgetStatus === "over_budget" ? " · over budget" : ""}`
    );
  } else {
    setText("planning-budget-total", formatINR(0));
    setText("planning-budget-meta", "Set a budget to start tracking monthly pressure.");
  }

  setText("planning-planned-total", formatINR(Number(planned.total_open || 0)));
  setText(
    "planning-planned-meta",
    plannedItems.length
      ? `${plannedItems.length} planned row${plannedItems.length === 1 ? "" : "s"} waiting in the pipeline.`
      : "No planned expenses yet."
  );

  setText("planning-wishlist-total", formatINR(Number(wishlist.total_open || 0)));
  setText(
    "planning-wishlist-meta",
    openWishlistCount
      ? `${openWishlistCount} wishlist item${openWishlistCount === 1 ? "" : "s"} still open.`
      : "No wishlist load tracked yet."
  );
}

async function loadPlanningSummary() {
  try {
    const response = await fetch("/planning/summary");
    const result = await response.json();
    if (!response.ok || result.success === false) {
      renderPlanningSnapshot(null);
      return;
    }
    renderPlanningSnapshot(result.data || null);
  } catch (error) {
    console.warn("Unable to load planning summary", error);
    renderPlanningSnapshot(null);
  }
}

function formatPlainDate(value) {
  return value ? String(value) : "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

// Shorten a long UPI / account identifier for display.
// Keeps the @provider suffix intact; truncates only the username prefix.
// e.g. "averylongupiname@paytm" → "avery…@paytm"  (maxLen = 22 by default)
function shortenUPI(id, maxLen = 22) {
  if (!id || id.length <= maxLen) return id;
  const at = id.lastIndexOf("@");
  if (at > 0) {
    const provider = id.slice(at);           // "@paytm"
    const prefix   = id.slice(0, at);
    const keep     = Math.max(4, maxLen - provider.length - 1); // at least 4 chars
    return prefix.slice(0, keep) + "…" + provider;
  }
  return id.slice(0, maxLen - 1) + "…";
}

function hasAnyNormalizedTag(tx, tagNames) {
  const lookup = new Set(tagNames.map((tag) => String(tag || "").trim().toLowerCase()));
  return normalizeTags(tx?.tags).some((tag) => lookup.has(tag.toLowerCase()));
}

function hasSalaryLikeText(tx) {
  return [
    tx?.narration,
    tx?.vendor_name,
    tx?.counterparty_entity_name,
    tx?.counterparty_identifier,
  ].some((value) => String(value || "").toLowerCase().includes("salary"));
}

function renderManagedTagOptions() {
  const datalist = document.getElementById("managed-tag-options");
  if (!datalist) return;
  datalist.innerHTML = availableManagedTags
    .map((tag) => `<option value="${escapeHtml(tag)}"></option>`)
    .join("");
}

async function loadManagedTags() {
  try {
    const tagsRes = await fetch("/classification/api/tags");
    const tagsResult = await tagsRes.json();
    if (!tagsRes.ok || tagsResult.success === false) return;
    const tags = Array.isArray(tagsResult.data) ? tagsResult.data : [];
    // The canonical token is the collision-aware display_name ("petrol (2-Wheeler)"
    // when the leaf name repeats under different parents, plain name otherwise).
    availableManagedTags = tags
      .map((tag) => String(tag.display_name || tag.name || "").trim())
      .filter(Boolean);
    _buildTagAncestorMap(tags);
    renderManagedTagOptions();
    // Populate category + subcategory color map for tag pill coloring
    if (!window._catColorMap || !Object.keys(window._catColorMap).length) {
      fetch("/classification/api/categories").then(r => r.json()).then(d => {
        window._catColorMap = {};
        function _rpHashColor(name) {
          let h = 0; const s = String(name || "").toLowerCase().trim();
          for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
          const p = ["#607AFB","#10b981","#f59e0b","#f97316","#ec4899","#14b8a6","#64748b","#ef4444","#84cc16","#fb923c","#6366f1","#d97706","#be185d","#0f766e"];
          return p[Math.abs(h) % p.length];
        }
        function _rpWalkTree(nodes) {
          nodes.forEach(node => {
            const color = node.color || _rpHashColor(node.name); // own color or hash — never inherit parent
            if (node.name) window._catColorMap[node.name.toLowerCase()] = color;
            if (node.subcategories) _rpWalkTree(node.subcategories);
            if (node.children) _rpWalkTree(node.children);
          });
        }
        _rpWalkTree(d.data || []);
      }).catch(() => {});
    }
    // Rows may have rendered before tags loaded; re-render so leaf labels (which depend
    // on the ancestor map for hierarchy depth) display correctly.
    if (Array.isArray(currentReportTransactions) && currentReportTransactions.length
        && typeof renderTransactionTable === "function") {
      renderTransactionTable(getBreakdownTransactions());
    }
  } catch (error) {
    console.warn("Unable to load managed tags", error);
  }
}

// Build the ancestor map from the authoritative tag graph (parent_id chain) so a
// disambiguated leaf maps to its own parents. Keyed by the leaf's display token;
// ancestors are the display tokens of the parent chain (nearest parent first).
function _buildTagAncestorMap(tags) {
  tagAncestorMap = {};
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
    if (key) tagAncestorMap[key] = ancestors;
  });
}

function getTagAncestors(tagName) {
  return tagAncestorMap[tagName.trim().toLowerCase()] || [];
}

function getTransactionRecoveryAmount(tx) {
  return Math.max(0, Number(tx?.recovery_amount || 0));
}

function isDebitTransaction(tx) {
  return String(tx?.direction || tx?.type || "").toLowerCase() === "withdrawal";
}

function isTransferLikeTransaction(tx) {
  const primaryFlowType = String(tx?.primary_flow_type || "").trim().toLowerCase();
  return primaryFlowType === "transfer";
}

function getTransactionNetSpend(tx) {
  const explicitNetAmount = Number(tx?.net_amount);
  if (Number.isFinite(explicitNetAmount)) {
    return Math.max(0, Number(Math.abs(explicitNetAmount).toFixed(2)));
  }
  const amount = Math.abs(Number(tx?.amount || 0));
  const recoveryAmount = getTransactionRecoveryAmount(tx);
  return Math.max(0, Number((amount - recoveryAmount).toFixed(2)));
}

function getPositiveAccountingAmount(tx, fieldName) {
  const rawValue = Number(tx?.[fieldName]);
  if (!Number.isFinite(rawValue)) return null;
  return Math.max(0, Number(Math.abs(rawValue).toFixed(2)));
}

function getTransactionEffectiveExpense(tx) {
  const explicitAmount = getPositiveAccountingAmount(tx, "effective_expense_amount");
  if (explicitAmount !== null) return explicitAmount;
  if (isSettlementTransaction(tx) || isTransferLikeTransaction(tx) || !isDebitTransaction(tx)) return 0;
  return getTransactionNetSpend(tx);
}

function getTransactionEffectiveIncome(tx) {
  const explicitAmount = getPositiveAccountingAmount(tx, "effective_income_amount");
  if (explicitAmount !== null) return explicitAmount;
  if (isSettlementTransaction(tx) || isTransferLikeTransaction(tx) || isDebitTransaction(tx)) return 0;
  return Math.max(0, Number(Math.abs(Number(tx?.amount || 0)).toFixed(2)));
}

function hasEffectiveAmountAdjustment(tx) {
  const rawAmount = Math.max(0, Number(Math.abs(Number(tx?.amount || 0)).toFixed(2)));
  const effectiveAmount = isDebitTransaction(tx)
    ? getTransactionEffectiveExpense(tx)
    : getTransactionEffectiveIncome(tx);
  return Math.abs(rawAmount - effectiveAmount) > 0.01;
}

function getTransactionAccountingDisplayAmount(tx) {
  return isDebitTransaction(tx)
    ? getTransactionEffectiveExpense(tx)
    : getTransactionEffectiveIncome(tx);
}

function getTransactionCompletionState(tx) {
  const completionState = String(tx?.completion_status || "").trim();
  if (!completionState || completionState === "Completed") return "Done";
  return completionState;
}

function getTransactionTagStatus(tx) {
  if (tx?.linked_as_recovery || tx?.no_tag_required) return "Not Required";
  return String(tx?.tag_status || "").trim() || "Tagged";
}

function getTransactionSplitStatus(tx) {
  if (tx?.linked_as_recovery || tx?.no_split_required) return "Not Required";
  return String(tx?.split_status || "").trim() || "Not Required";
}

function deriveCompletionStatus(tx) {
  const tagStatus = getTransactionTagStatus(tx);
  const splitStatus = getTransactionSplitStatus(tx);
  const needsTag = tagStatus === "Needs Tag";
  const needsSplit = splitStatus === "Needs Split";
  if (!needsTag && !needsSplit) return "Done";
  if (needsTag && needsSplit) return "Needs Tag & Split";
  if (needsTag) return "Needs Tag";
  return "Needs Split";
}

function getTransactionCategoryLabels(tx) {
  const tags = normalizeTags(tx?.tags);
  if (tags.length <= 1) return tags;
  // Show the top-level category and the most-specific leaf. We pick them by hierarchy
  // DEPTH (ancestor count), not array position — the backend's jsonb_agg sorts tags
  // alphabetically (case-insensitively), which can bury the leaf in the middle and was
  // causing leaves like "petrol (2-Wheeler)" to be dropped.
  const depth = (t) => getTagAncestors(t).length;
  const haveHierarchy = tags.some((t) => depth(t) > 0);
  if (!haveHierarchy) {
    // Ancestor map not loaded yet — fall back to the first/last heuristic.
    if (tags.length <= 2) return tags;
    const first = tags[0];
    const last = tags[tags.length - 1];
    return (!last || first === last) ? [first].filter(Boolean) : [first, last];
  }
  let leaf = tags[0], leafDepth = depth(tags[0]);
  let root = tags[0], rootDepth = leafDepth;
  for (const t of tags) {
    const d = depth(t);
    if (d > leafDepth) { leaf = t; leafDepth = d; }
    if (d < rootDepth) { root = t; rootDepth = d; }
  }
  return leaf === root ? [leaf].filter(Boolean) : [root, leaf];
}

function getPrimarySpendCategory(tx) {
  return getTransactionCategoryLabels(tx)[0] || "Uncategorized";
}

// The most-specific (leaf) tag for grouping/anomaly — last of [root, leaf].
function getTransactionLeafCategory(tx) {
  const labels = getTransactionCategoryLabels(tx);
  return labels[labels.length - 1] || "Uncategorized";
}

// A row that still wants the user's eyes: explicitly flagged for review, or
// auto/system-tagged but never manually confirmed.
function isNeedsReviewRow(tx) {
  const status = String(tx?.review_status || "").trim().toLowerCase();
  if (["needs_review", "unknown", "unreviewed"].includes(status)) return true;
  // Confirmed/no-action rows are done — never flag them as needing review
  if (status === "confirmed" || status === "no_action_needed") return false;
  // Auto/system-tagged but never manually confirmed
  const hasTags = Array.isArray(tx?.tags) && tx.tags.filter(Boolean).length > 0;
  return hasTags && !tx?.review_status_manual;
}

// Per-leaf-category median spend, computed from the currently rendered rows, so we
// can flag a transaction that is unusually large for its category.
let _leafSpendStats = {};
function _computeLeafSpendStats(rows) {
  const buckets = {};
  (Array.isArray(rows) ? rows : []).forEach((tx) => {
    if (!isDebitTransaction(tx) || isSettlementTransaction(tx)) return;
    const amt = getTransactionEffectiveExpense(tx);
    if (amt <= 0) return;
    const key = getTransactionLeafCategory(tx);
    if (!key || key === "Uncategorized") return;
    (buckets[key] = buckets[key] || []).push(amt);
  });
  _leafSpendStats = {};
  Object.entries(buckets).forEach(([key, vals]) => {
    if (vals.length < 4) return; // too few samples to call anything "unusual"
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    if (median > 0) _leafSpendStats[key] = median;
  });
}
function getAmountAnomaly(tx) {
  if (!isDebitTransaction(tx) || isSettlementTransaction(tx)) return null;
  const median = _leafSpendStats[getTransactionLeafCategory(tx)];
  if (!median) return null;
  const amt = getTransactionEffectiveExpense(tx);
  const ratio = amt / median;
  if (ratio >= 2.5 && amt >= 500) return { ratio: Math.round(ratio * 10) / 10 };
  return null;
}

function getPrimaryFlowType(tx) {
  return String(tx?.primary_flow_type || "").trim().toLowerCase();
}

function hasLegacyInvestmentTag(tx) {
  return normalizeTags(tx?.tags).some((tag) => tag.toLowerCase() === "investment");
}

function isInvestmentBuyTransaction(tx) {
  const primaryFlowType = getPrimaryFlowType(tx);
  if (primaryFlowType === "investment_buy") return true;
  return !primaryFlowType && hasLegacyInvestmentTag(tx) && isDebitTransaction(tx);
}

function isInvestmentSellTransaction(tx) {
  const primaryFlowType = getPrimaryFlowType(tx);
  if (primaryFlowType === "investment_sell") return true;
  return !primaryFlowType && hasLegacyInvestmentTag(tx) && !isDebitTransaction(tx);
}

function isInvestmentTransaction(tx) {
  return isInvestmentBuyTransaction(tx) || isInvestmentSellTransaction(tx) || hasLegacyInvestmentTag(tx);
}

function getInvestmentFlowAmount(tx) {
  if (isInvestmentBuyTransaction(tx)) {
    return getTransactionEffectiveExpense(tx) || getTransactionNetSpend(tx);
  }
  if (isInvestmentSellTransaction(tx)) {
    return getTransactionEffectiveIncome(tx) || Math.max(0, Number(Math.abs(Number(tx?.amount || 0)).toFixed(2)));
  }
  return isDebitTransaction(tx)
    ? getTransactionNetSpend(tx)
    : getTransactionEffectiveIncome(tx);
}

function getInvestmentGroupName(tx) {
  if (isInvestmentBuyTransaction(tx)) return "Investment Buy";
  if (isInvestmentSellTransaction(tx)) return "Investment Sell";
  const tags = normalizeTags(tx?.tags);
  const detailTag = tags.find((tag) => tag.toLowerCase() !== "investment");
  return detailTag || "Tagged Investment";
}

function getOwnershipSpendGroupName(tx) {
  const settlementState = String(tx?.settlement_state || "").trim().toLowerCase();
  if (settlementState === "owed_to_me" || settlementState === "partial") {
    return "Recoverable / Not Final";
  }
  if (settlementState === "i_owe") {
    return "Payable";
  }

  const ownership = String(tx?.consumption_ownership || "").trim().toLowerCase();
  const ownershipLabelMap = {
    self: "Self",
    family_household: "Family / Household",
    shared: "Shared",
    business: "Business",
    other: "Other",
    not_consumption: "Not Consumption",
  };

  return ownershipLabelMap[ownership] || "Unclassified Ownership";
}

function getSettlementSpendGroupName(tx) {
  const settlementState = String(tx?.settlement_state || "").trim().toLowerCase();
  const labelMap = {
    none: "Final / No Obligation",
    owed_to_me: "Recoverable / Owed To Me",
    i_owe: "Payable / I Owe",
    partial: "Partly Settled",
    settled: "Settled",
  };
  return labelMap[settlementState] || "Unclassified Settlement";
}

function matchesObligationFocus(tx, focus) {
  const settlementState = String(tx?.settlement_state || "").trim().toLowerCase();
  if (!focus) return true;

  if (focus === "all_open") {
    return settlementState === "owed_to_me" || settlementState === "partial" || settlementState === "i_owe";
  }
  if (focus === "receivable_open") {
    return settlementState === "owed_to_me" || settlementState === "partial";
  }
  if (focus === "payable_open") {
    return settlementState === "i_owe";
  }
  if (focus === "settled") {
    return settlementState === "settled";
  }
  if (focus === "any_obligation") {
    return ["owed_to_me", "partial", "i_owe", "settled"].includes(settlementState);
  }
  return true;
}

function applyObligationFocus(focus) {
  breakdownViewState.obligationFocus = String(focus || "").trim();
  const obligationEl = document.getElementById("breakdown_obligation_filter");
  if (obligationEl) obligationEl.value = breakdownViewState.obligationFocus;

  if (breakdownViewState.obligationFocus) {
    breakdownViewState.settlementGroup = "";
    const settlementEl = document.getElementById("breakdown_settlement_filter");
    if (settlementEl) settlementEl.value = "";
  }

  renderTransactionTable(getBreakdownTransactions());
  persistReportPageState();
}

function getSpendGroupName(tx, groupBy = "category") {
  if (groupBy === "source") {
    return getTransactionSourceGroup(tx);
  }
  if (groupBy === "investment") {
    return getInvestmentGroupName(tx);
  }
  if (groupBy === "ownership") {
    return getOwnershipSpendGroupName(tx);
  }
  if (groupBy === "settlement") {
    return getSettlementSpendGroupName(tx);
  }
  if (groupBy === "leaf") {
    return getTransactionLeafCategory(tx);
  }
  if (groupBy === "month") {
    const rawDate = String(tx?.transaction_date || "");
    const monthKey = rawDate.slice(0, 7);
    if (!monthKey) return "Unknown Month";
    const [year, month] = monthKey.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
    });
  }
  return getPrimarySpendCategory(tx);
}

function isSettlementTransaction(tx) {
  return Boolean(tx?.linked_as_recovery);
}

function cleanTransactionNarration(tx) {
  const narration = String(tx?.narration || "")
    .replace(/UPI\s*Transaction\s*ID\s*:\s*[^|]+/gi, "")
    .replace(/\|\s*\|/g, "|")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .trim();
  const vendor = getTransactionDisplayName(tx).toLowerCase();
  const counterparty = String(tx?.counterparty_identifier || "").trim().toLowerCase();
  const normalizedNarration = narration.toLowerCase();

  if (!narration) return "";
  if (vendor && normalizedNarration === vendor) return "";
  if (counterparty && normalizedNarration === counterparty) return "";
  return narration;
}

// Convert a stored "YYYY-MM-DD" date to "DD-MM-YYYY" (string-only, no timezone math).
function fmtDMY(value) {
  if (!value) return "";
  const parts = String(value).slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : String(value);
}

function getTransactionSecondaryLine(tx, opts = {}) {
  const parts = [];
  const transactionTime = String(tx?.transaction_time || "").trim();
  const cleanedNarration = cleanTransactionNarration(tx);
  const bankName = getTransactionBankName(tx);

  if (bankName) parts.push(`${bankName} Bank`);
  if (transactionTime) parts.push(transactionTime);
  if (cleanedNarration) {
    parts.push(cleanedNarration);
  } else if (tx?.counterparty_identifier && !opts.hideIdentifier) {
    // Drop the raw UPI / account id for already-tagged rows to keep them compact.
    parts.push(shortenUPI(String(tx.counterparty_identifier)));
  }

  return parts.slice(0, 3).join(" | ");
}

function getTransactionStatusChips(tx) {
  const chips = [];
  const consumptionOwnership = getConsumptionOwnershipMeta(tx);
  const settlementState = getSettlementStateMeta(tx);

  const channelLabel = getTransactionChannelLabel(tx);
  if (channelLabel) {
    chips.push({
      label: channelLabel,
      className: "bg-slate-800 text-slate-100 ring-slate-900/20",
    });
  }

  if (consumptionOwnership) {
    chips.push(consumptionOwnership);
  }

  if (settlementState) {
    chips.push(settlementState);
  }

  return chips;
}

function getTagActionState(tx) {
  const tagStatus = getTransactionTagStatus(tx);
  if (tagStatus === "Needs Tag") {
    return {
      label: "To Tag",
      icon: "sell",
      className:
        "bg-gradient-to-br from-amber-700 to-amber-800 text-white ring-1 ring-amber-900/20 shadow-[0_10px_22px_rgba(180,83,9,0.35)] hover:from-amber-600 hover:to-amber-700",
    };
  }
  if (tagStatus === "Not Required") {
    return {
      label: "General",
      icon: "label_outline",
      className:
        "bg-gradient-to-br from-slate-700 to-slate-800 text-slate-50 ring-1 ring-slate-900/20 shadow-[0_10px_22px_rgba(30,41,59,0.28)] hover:from-slate-600 hover:to-slate-700",
    };
  }
  return {
    label: "Tagged",
    icon: "task_alt",
    className:
      "bg-gradient-to-br from-emerald-700 to-emerald-800 text-white ring-1 ring-emerald-900/20 shadow-[0_10px_22px_rgba(5,150,105,0.32)] hover:from-emerald-600 hover:to-emerald-700",
  };
}

function getSplitActionState(tx) {
  const splitStatus = getTransactionSplitStatus(tx);
  if (splitStatus === "Needs Split") {
    return {
      label: "To Split",
      icon: "call_split",
      className:
        "bg-gradient-to-br from-rose-700 to-rose-800 text-white ring-1 ring-rose-900/20 shadow-[0_10px_22px_rgba(190,24,93,0.32)] hover:from-rose-600 hover:to-rose-700",
    };
  }
  if (splitStatus === "Not Required") {
    return {
      label: "Skip",
      icon: "horizontal_rule",
      className:
        "bg-gradient-to-br from-slate-700 to-slate-800 text-slate-50 ring-1 ring-slate-900/20 shadow-[0_10px_22px_rgba(30,41,59,0.28)] hover:from-slate-600 hover:to-slate-700",
    };
  }
  return {
    label: "Split",
    icon: "done_all",
    className:
      "bg-gradient-to-br from-sky-700 to-sky-800 text-white ring-1 ring-sky-900/20 shadow-[0_10px_22px_rgba(3,105,161,0.32)] hover:from-sky-600 hover:to-sky-700",
  };
}

function getClassificationActionState(tx) {
  if (isSettlementTransaction(tx)) {
    return {
      label: "Settled",
      icon: "linked_services",
      className:
        "bg-gradient-to-br from-slate-700 to-slate-800 text-white ring-1 ring-slate-900/20 shadow-[0_10px_22px_rgba(30,41,59,0.28)] hover:from-slate-600 hover:to-slate-700",
    };
  }
  const reviewStatus = String(tx?.review_status || "").trim().toLowerCase();
  if (reviewStatus === "needs_review") {
    return {
      label: "Needs Review",
      icon: "pending_actions",
      className:
        "bg-gradient-to-br from-amber-700 to-orange-800 text-white ring-1 ring-amber-900/20 shadow-[0_10px_22px_rgba(180,83,9,0.35)] hover:from-amber-600 hover:to-orange-700",
    };
  }
  if (reviewStatus === "unknown" || reviewStatus === "unreviewed") {
    return {
      label: reviewStatus === "unreviewed" ? "Review" : "Unknown",
      icon: reviewStatus === "unreviewed" ? "visibility" : "help",
      className:
        "bg-gradient-to-br from-slate-800 to-slate-900 text-white ring-1 ring-slate-900/20 shadow-[0_10px_22px_rgba(15,23,42,0.32)] hover:from-slate-700 hover:to-slate-800",
    };
  }
  if (reviewStatus === "confirmed" || reviewStatus === "no_action_needed") {
    return {
      label: reviewStatus === "confirmed" ? "Done" : "No Action",
      icon: "task_alt",
      className:
        "bg-gradient-to-br from-emerald-700 to-emerald-800 text-white ring-1 ring-emerald-900/20 shadow-[0_10px_22px_rgba(5,150,105,0.32)] hover:from-emerald-600 hover:to-emerald-700",
    };
  }
  if (!isDebitTransaction(tx)) {
    return {
      label: "Credit",
      icon: "south_west",
      className:
        "bg-gradient-to-br from-emerald-700 to-emerald-800 text-white ring-1 ring-emerald-900/20 shadow-[0_10px_22px_rgba(5,150,105,0.32)] hover:from-emerald-600 hover:to-emerald-700",
    };
  }
  const completion = deriveCompletionStatus(tx);
  const hasRealTags = normalizeTags(tx?.tags).length > 0;
  const hasSplitProgress =
    String(tx?.split_status || "").trim() === "Split Done" ||
    Boolean(tx?.linked_as_recovery);

  if (!hasRealTags && !hasSplitProgress && !tx?.no_tag_required && !tx?.no_split_required) {
    return {
      label: "Review",
      icon: "visibility",
      className:
        "bg-gradient-to-br from-slate-800 to-slate-900 text-white ring-1 ring-slate-900/20 shadow-[0_10px_22px_rgba(15,23,42,0.32)] hover:from-slate-700 hover:to-slate-800",
    };
  }
  if (completion === "Done") {
    return {
      label: "Done",
      icon: "task_alt",
      className:
        "bg-gradient-to-br from-emerald-700 to-emerald-800 text-white ring-1 ring-emerald-900/20 shadow-[0_10px_22px_rgba(5,150,105,0.32)] hover:from-emerald-600 hover:to-emerald-700",
    };
  }
  return {
    label: "Pending",
    icon: "pending_actions",
    className:
      "bg-gradient-to-br from-amber-700 to-orange-800 text-white ring-1 ring-amber-900/20 shadow-[0_10px_22px_rgba(180,83,9,0.35)] hover:from-amber-600 hover:to-orange-700",
  };
}

function getTransactionSourceGroup(tx) {
  const bankName = getTransactionBankName(tx);
  if (bankName) {
    return bankName;
  }
  const sources = getTransactionSources(tx);
  const source = sources.find((value) => value && value !== "OTHER")
    || normalizeSourceLabel(tx?.payment_source_name)
    || sources[0];
  return source || "Unknown";
}

function persistReportPageState() {
  try {
    const mainScroller = document.querySelector("main.soft-grid");
    const payload = {
      filters: {
        from_date: document.getElementById("from_date")?.value || "",
        to_date: document.getElementById("to_date")?.value || "",
        vendor_filter: document.getElementById("vendor_filter")?.value || "",
        amount_filter: document.getElementById("amount_filter")?.value || "",
        tag_filter: document.getElementById("tag_filter")?.value || "",
        report_type: document.getElementById("report_type")?.value || "",
      },
      breakdownViewState,
      transactions: currentReportTransactions,
      scrollTop: mainScroller?.scrollTop || 0,
    };
    sessionStorage.setItem(REPORT_PAGE_STATE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Unable to persist report page state", error);
  }
}

function persistReportFocusTransaction(transactionId) {
  try {
    if (!transactionId) return;
    sessionStorage.setItem(REPORT_FOCUS_TX_KEY, String(transactionId));
  } catch (error) {
    console.warn("Unable to persist report focus transaction", error);
  }
}

function consumeReportForceRefreshFlag() {
  try {
    const shouldRefresh = sessionStorage.getItem(REPORT_FORCE_REFRESH_KEY) === "1";
    if (shouldRefresh) {
      sessionStorage.removeItem(REPORT_FORCE_REFRESH_KEY);
    }
    return shouldRefresh;
  } catch (error) {
    console.warn("Unable to read report refresh flag", error);
    return false;
  }
}

function restoreReportPageState() {
  try {
    const raw = sessionStorage.getItem(REPORT_PAGE_STATE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved?.filters) {
      if (document.getElementById("from_date")) document.getElementById("from_date").value = saved.filters.from_date || "";
      if (document.getElementById("to_date")) document.getElementById("to_date").value = saved.filters.to_date || "";
      if (document.getElementById("vendor_filter")) document.getElementById("vendor_filter").value = saved.filters.vendor_filter || "";
      if (document.getElementById("amount_filter")) document.getElementById("amount_filter").value = saved.filters.amount_filter || "";
      if (document.getElementById("tag_filter")) document.getElementById("tag_filter").value = saved.filters.tag_filter || "";
      if (document.getElementById("report_type")) document.getElementById("report_type").value = saved.filters.report_type || "";
    }
    if (saved?.breakdownViewState) {
      const savedSort = String(saved.breakdownViewState.sort || "").trim();
      const normalizedBreakdownViewState = { ...saved.breakdownViewState };
      if (!normalizedBreakdownViewState.dateSort && !normalizedBreakdownViewState.amountSort && savedSort) {
        if (savedSort === "date_desc" || savedSort === "date_asc") {
          normalizedBreakdownViewState.dateSort = savedSort;
        } else if (savedSort === "amount_desc" || savedSort === "amount_asc") {
          normalizedBreakdownViewState.amountSort = savedSort;
        }
      }
      breakdownViewState = {
        ...breakdownViewState,
        ...normalizedBreakdownViewState,
      };
    }
    sessionStorage.setItem(
      REPORT_SCROLL_STATE_KEY,
      String(Number(saved?.scrollTop || 0))
    );
    return true;
  } catch (error) {
    console.warn("Unable to restore report page state", error);
    return false;
  }
}

function applyInitialReportViewFromUrl() {
  const allowedViews = new Set(["category", "ownership", "settlement", "investment", "source", "month"]);
  const requestedView = String(new URLSearchParams(window.location.search).get("view") || "").trim().toLowerCase();
  if (allowedViews.has(requestedView)) {
    spendChartState.groupBy = requestedView;
  }
}

function restoreReportScrollPosition() {
  const mainScroller = document.querySelector("main.soft-grid");
  if (!mainScroller) return;

  const savedScrollTop = Number(sessionStorage.getItem(REPORT_SCROLL_STATE_KEY) || 0);
  if (!savedScrollTop) return;

  requestAnimationFrame(() => {
    mainScroller.scrollTop = savedScrollTop;
    sessionStorage.removeItem(REPORT_SCROLL_STATE_KEY);
  });
}

function restoreFocusedTransactionRow() {
  const focusedId = sessionStorage.getItem(REPORT_FOCUS_TX_KEY);
  if (!focusedId) return;

  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-transaction-id="${CSS.escape(focusedId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    sessionStorage.removeItem(REPORT_FOCUS_TX_KEY);
  });
}

function getSelectedReportType() {
  return document.getElementById("report_type")?.value?.trim() || "Spending by Category";
}

function getSpendTransactions(data = []) {
  return (Array.isArray(data) ? data : []).filter((tx) => getTransactionEffectiveExpense(tx) > 0);
}

function getInvestmentTransactions(data = []) {
  return (Array.isArray(data) ? data : []).filter((tx) => (
    isInvestmentTransaction(tx)
    && !isSettlementTransaction(tx)
    && !isTransferLikeTransaction(tx)
    && getInvestmentFlowAmount(tx) > 0
  ));
}

function getSpendChartTransactions(data = []) {
  return spendChartState.groupBy === "investment"
    ? getInvestmentTransactions(data)
    : getSpendTransactions(data);
}

function getSpendChartAmount(tx) {
  return spendChartState.groupBy === "investment"
    ? getInvestmentFlowAmount(tx)
    : getTransactionEffectiveExpense(tx);
}

function aggregateTransactionsByPeriod(data, period) {
  const totals = new Map();

  getSpendTransactions(data).forEach((tx) => {
    const rawDate = String(tx.transaction_date || "");
    if (!rawDate) return;
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return;

    let key = rawDate;
    let label = rawDate;
    if (period === "month") {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      label = date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    } else if (period === "year") {
      key = String(date.getFullYear());
      label = key;
    }

    const current = totals.get(key) || { label, amount: 0 };
    current.amount += getTransactionEffectiveExpense(tx);
    totals.set(key, current);
  });

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => ({ label: value.label, amount: Number(value.amount.toFixed(2)) }));
}

function buildSpendCategoryBreakdown(data = []) {
  const totals = new Map();
  const baseRows = getSpendChartTransactions(data);

  baseRows.forEach((tx) => {
    const category = getSpendGroupName(tx, spendChartState.groupBy);
    if (!spendChartState.includeUntagged && category === "Uncategorized") return;
    const current = totals.get(category) || { name: category, amount: 0, count: 0 };
    current.amount += getSpendChartAmount(tx);
    current.count += 1;
    totals.set(category, current);
  });

  const rows = [...totals.values()]
    .map((row) => ({
      ...row,
      amount: Number(row.amount.toFixed(2)),
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  const sliceLimit = Math.max(1, Number(spendChartState.limit || 8));
  const topRows = rows.slice(0, sliceLimit);
  const otherAmount = rows.slice(sliceLimit).reduce((sum, row) => sum + row.amount, 0);
  const otherCount = rows.slice(sliceLimit).reduce((sum, row) => sum + row.count, 0);
  if (otherAmount > 0) {
    topRows.push({
      name: "Other",
      amount: Number(otherAmount.toFixed(2)),
      count: otherCount,
    });
  }

  const total = topRows.reduce((sum, row) => sum + row.amount, 0);
  return {
    rows: topRows.map((row, index) => ({
      ...row,
      color: SPEND_CHART_COLORS[index % SPEND_CHART_COLORS.length],
      percent: total > 0 ? (row.amount / total) * 100 : 0,
    })),
    total,
    allRows: rows,
  };
}

function getSpendFilterPayload(rowName) {
  if (!rowName || rowName === "Other") return null;
  if (spendChartState.groupBy === "category" || spendChartState.groupBy === "leaf") {
    return { type: rowName === "Uncategorized" ? "untagged" : "tag", value: rowName };
  }
  if (spendChartState.groupBy === "ownership") {
    return { type: "ownership", value: rowName };
  }
  if (spendChartState.groupBy === "settlement") {
    return { type: "settlement", value: rowName };
  }
  if (spendChartState.groupBy === "investment") {
    return { type: "tag", value: rowName === "Uncategorized Investment" ? "Investment" : rowName };
  }
  if (spendChartState.groupBy === "source") {
    return { type: "source", value: rowName };
  }
  if (spendChartState.groupBy === "month") {
    return { type: "month", value: rowName };
  }
  return null;
}

function applySpendFilter(rowName) {
  const payload = getSpendFilterPayload(rowName);
  if (!payload) return;
  if (payload.type === "tag") {
    const tagInput = document.getElementById("tag_filter");
    if (tagInput) tagInput.value = payload.value;
    submitSearch();
    return;
  }
  if (payload.type === "untagged") {
    breakdownViewState.tagState = "untagged";
    const tagEl = document.getElementById("breakdown_tag_filter");
    if (tagEl) tagEl.value = "untagged";
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
    return;
  }
  if (payload.type === "source") {
    breakdownViewState.sourceGroup = payload.value;
    const sourceEl = document.getElementById("breakdown_source_filter");
    if (sourceEl) sourceEl.value = payload.value;
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
    return;
  }
  if (payload.type === "ownership") {
    breakdownViewState.ownershipGroup = payload.value;
    const ownershipEl = document.getElementById("breakdown_ownership_filter");
    if (ownershipEl) ownershipEl.value = payload.value;
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
    return;
  }
  if (payload.type === "settlement") {
    breakdownViewState.settlementGroup = payload.value;
    const settlementEl = document.getElementById("breakdown_settlement_filter");
    if (settlementEl) settlementEl.value = payload.value;
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
    return;
  }
  if (payload.type === "month") {
    const monthOption = [...(document.getElementById("breakdown_month_filter")?.options || [])]
      .find((option) => option.textContent === payload.value);
    if (monthOption) {
      breakdownViewState.month = monthOption.value;
      document.getElementById("breakdown_month_filter").value = monthOption.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    }
  }
}

function renderSpendPieChart(data = []) {
  const chartEl = document.getElementById("spend-pie-chart");
  const legendEl = document.getElementById("spend-pie-legend");
  const insightsEl = document.getElementById("spend-insights");
  const totalEl = document.getElementById("spend-chart-total");
  const centerTotalEl = document.getElementById("spend-pie-center-total");
  const captionEl = document.getElementById("spend-chart-caption");
  const nextActionEl = document.getElementById("spend-next-action");
  if (!chartEl || !legendEl || !insightsEl) return;

  const spendRows = getSpendChartTransactions(data);
  const { rows, total, allRows } = buildSpendCategoryBreakdown(data);
  if (totalEl) totalEl.textContent = formatINR(total);
  if (centerTotalEl) centerTotalEl.textContent = formatINR(total);

  if (!rows.length) {
    chartEl.style.background = "#f1f5f9";
    legendEl.innerHTML = `
      <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
        ${spendChartState.groupBy === "investment"
          ? "No investment-flow transactions here yet."
          : spendChartState.groupBy === "ownership"
          ? "No ownership-based spend in this view yet."
          : spendChartState.groupBy === "settlement"
          ? "No settlement-based spend in this view yet."
          : "No counted spend in this view. Transfers, refunds, and income are excluded."}
      </p>
    `;
    insightsEl.innerHTML = `
      <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200">
        ${spendChartState.groupBy === "investment"
          ? "Mark rows as investment buys or sells to build this bucket."
          : spendChartState.groupBy === "ownership"
          ? "Classify more rows with consumption ownership or settlement state to build this view."
          : spendChartState.groupBy === "settlement"
          ? "Add settlement meaning to rows so this view can separate final, recoverable, payable, and settled amounts."
          : "Search a date range or remove filters to see spend insights."}
      </p>
    `;
    if (captionEl) {
      captionEl.textContent = spendChartState.groupBy === "investment"
        ? "No investment-flow transactions in this selection."
        : spendChartState.groupBy === "ownership"
        ? "No ownership-classified spend in this selection."
        : spendChartState.groupBy === "settlement"
        ? "No settlement-classified spend in this selection."
        : "No counted spend for this selection.";
    }
    if (nextActionEl) {
      nextActionEl.textContent = spendChartState.groupBy === "investment"
        ? "No investment-flow transactions here. Mark rows as investment buys or sells, or keep using the legacy Investment tag where old data still depends on it."
        : spendChartState.groupBy === "ownership"
        ? "No ownership-classified spend here. Add split or structured meaning where needed so this view can separate self, shared, and recoverable spend."
        : spendChartState.groupBy === "settlement"
        ? "No settlement-classified spend here. Add settlement meaning where needed so this view can separate final, payable, and recoverable amounts."
        : "No counted spend here. Try widening the date range or clearing amount/category filters.";
    }
    return;
  }

  let cursor = 0;
  const gradientParts = rows.map((row) => {
    const start = cursor;
    cursor += row.percent;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  chartEl.style.background = `conic-gradient(${gradientParts.join(", ")})`;

  legendEl.innerHTML = rows.map((row) => {
    const percentLabel = `${Math.round(row.percent)}%`;
    const canFilter = Boolean(getSpendFilterPayload(row.name));
    return `
      <button
        type="button"
        data-spend-filter="${escapeHtml(row.name)}"
        class="min-w-0 rounded-lg bg-white px-3 py-2 text-left ring-1 ring-slate-200 transition ${canFilter ? "hover:-translate-y-0.5 hover:ring-primary/40" : "cursor-default"}"
        ${canFilter ? "" : "disabled"}
      >
        <div class="flex min-w-0 items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-3 w-3 shrink-0 rounded-sm" style="background:${row.color}"></span>
            <span class="min-w-0 truncate text-xs font-bold text-slate-800">${escapeHtml(row.name)}</span>
          </div>
          <span class="shrink-0 text-xs font-black text-slate-500">${escapeHtml(percentLabel)}</span>
        </div>
        <div class="mt-1 flex items-center justify-between text-[11px] text-slate-500">
          <span class="shrink-0">${escapeHtml(String(row.count))} row${row.count === 1 ? "" : "s"}</span>
          <span class="min-w-0 truncate pl-2 text-right font-bold text-slate-900">${formatINR(row.amount)}</span>
        </div>
      </button>
    `;
  }).join("");

  const topCategory = allRows[0];
  const uncategorized = allRows.find((row) => (
    spendChartState.groupBy === "ownership"
      ? row.name === "Unclassified Ownership"
      : spendChartState.groupBy === "settlement"
      ? row.name === "Unclassified Settlement"
      : row.name === "Uncategorized"
  ));
  const biggestExpense = [...spendRows]
    .sort((a, b) => getSpendChartAmount(b) - getSpendChartAmount(a))[0];
  const firstDate = spendRows.map((tx) => tx.transaction_date).filter(Boolean).sort()[0];
  const lastDate = spendRows.map((tx) => tx.transaction_date).filter(Boolean).sort().slice(-1)[0];
  const dayCount = firstDate && lastDate
    ? Math.max(1, Math.round((new Date(lastDate) - new Date(firstDate)) / 86400000) + 1)
    : 1;
  const dailyAverage = total / dayCount;

  const insightCards = [
    {
      label: spendChartState.groupBy === "settlement"
        ? "Top settlement"
        : spendChartState.groupBy === "ownership"
        ? "Top bucket"
        : "Top category",
      value: topCategory ? `${topCategory.name} (${formatINR(topCategory.amount)})` : "-",
      tone: "bg-blue-50 text-blue-700 ring-blue-100",
    },
    {
      label: spendChartState.groupBy === "settlement"
        ? "Settlement missing"
        : spendChartState.groupBy === "ownership"
        ? "Ownership missing"
        : "Untagged spend",
      value: uncategorized
        ? `${formatINR(uncategorized.amount)} across ${uncategorized.count} row${uncategorized.count === 1 ? "" : "s"}`
        : "None in this view",
      tone: uncategorized
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-emerald-50 text-emerald-700 ring-emerald-100",
    },
    {
      label: "Largest expense",
      value: biggestExpense ? `${formatINR(getSpendChartAmount(biggestExpense))} - ${getTransactionDisplayName(biggestExpense)}` : "-",
      tone: "bg-rose-50 text-rose-700 ring-rose-100",
    },
    {
      label: "Daily average",
      value: `${formatINR(dailyAverage)} over ${dayCount} day${dayCount === 1 ? "" : "s"}`,
      tone: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    },
  ];

  insightsEl.innerHTML = insightCards.map((card) => `
    <div class="min-w-0 rounded-lg px-3 py-2 ring-1 ${card.tone}">
      <p class="text-[10px] font-black uppercase tracking-[0.14em] opacity-80">${escapeHtml(card.label)}</p>
      <p class="clamp-two mt-1 text-xs font-bold">${escapeHtml(card.value)}</p>
    </div>
  `).join("");

  if (captionEl) {
    const groupLabel = spendChartState.groupBy === "category"
      ? "categories"
      : spendChartState.groupBy === "source"
      ? "sources"
      : spendChartState.groupBy === "investment"
      ? "investment buckets"
      : spendChartState.groupBy === "ownership"
      ? "ownership buckets"
      : spendChartState.groupBy === "settlement"
      ? "settlement buckets"
      : "months";
    captionEl.textContent = spendChartState.groupBy === "investment"
      ? `${spendRows.length} investment-flow row${spendRows.length === 1 ? "" : "s"} across ${allRows.length} bucket${allRows.length === 1 ? "" : "s"}. Structured flow types are used first, with the legacy Investment tag as fallback.`
      : spendChartState.groupBy === "ownership"
      ? `${spendRows.length} counted spend row${spendRows.length === 1 ? "" : "s"} across ${allRows.length} ${groupLabel}. This view separates final spend from recoverable amounts.`
      : spendChartState.groupBy === "settlement"
      ? `${spendRows.length} counted spend row${spendRows.length === 1 ? "" : "s"} across ${allRows.length} ${groupLabel}. This view separates final, recoverable, payable, and settled amounts.`
      : `${spendRows.length} counted spend row${spendRows.length === 1 ? "" : "s"} across ${allRows.length} ${groupLabel}. Click a legend item to focus the table.`;
  }

  if (nextActionEl) {
    if (uncategorized && spendChartState.groupBy === "category") {
      nextActionEl.innerHTML = `
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span><strong>Next step:</strong> ${formatINR(uncategorized.amount)} is still untagged. Review those rows to improve this chart.</span>
          <button type="button" data-spend-action="review-untagged" class="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500">Review Untagged</button>
        </div>
      `;
    } else if (uncategorized && spendChartState.groupBy === "ownership") {
      nextActionEl.textContent = `Next step: ${formatINR(uncategorized.amount)} is still missing ownership meaning. Classify those rows to separate self, shared, and recoverable spend more cleanly.`;
    } else if (uncategorized && spendChartState.groupBy === "settlement") {
      nextActionEl.textContent = `Next step: ${formatINR(uncategorized.amount)} is still missing settlement meaning. Classify those rows so this view can separate final, payable, and recoverable amounts more cleanly.`;
    } else if (biggestExpense) {
      nextActionEl.innerHTML = `<strong>Next step:</strong> Check the largest ${spendChartState.groupBy === "investment" ? "investment" : spendChartState.groupBy === "ownership" ? "ownership bucket" : spendChartState.groupBy === "settlement" ? "settlement bucket" : "expense"} first: ${escapeHtml(getTransactionDisplayName(biggestExpense))} at ${formatINR(getSpendChartAmount(biggestExpense))}.`;
    } else {
      nextActionEl.textContent = "Everything in this view looks tagged enough for a clean spend summary.";
    }
  }
}

function renderCashFlowChart(data = []) {
  const rows = Array.isArray(data) ? data : [];
  const creditRows = rows.filter((tx) => getTransactionEffectiveIncome(tx) > 0);
  const debitRows = rows.filter((tx) => getTransactionEffectiveExpense(tx) > 0);
  const creditTotal = creditRows.reduce((sum, tx) => sum + getTransactionEffectiveIncome(tx), 0);
  const debitTotal = debitRows.reduce((sum, tx) => sum + getTransactionEffectiveExpense(tx), 0);
  const biggestDebit = [...debitRows].sort((a, b) => getTransactionEffectiveExpense(b) - getTransactionEffectiveExpense(a))[0];
  const netTotal = creditTotal - debitTotal;
  const flowTotal = creditTotal + debitTotal;
  const creditPercent = flowTotal > 0 ? (creditTotal / flowTotal) * 100 : 0;
  const debitPercent = flowTotal > 0 ? (debitTotal / flowTotal) * 100 : 0;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("cash-flow-credit-value", formatINR(creditTotal));
  setText("cash-flow-debit-value", formatINR(debitTotal));
  const signedNetLabel = `${netTotal > 0.01 ? "+" : netTotal < -0.01 ? "-" : ""}${formatINR(Math.abs(netTotal))}`;
  setText("cash-flow-net-value", signedNetLabel);
  setText("cash-flow-credit-percent", `${Math.round(creditPercent)}%`);
  setText("cash-flow-debit-percent", `${Math.round(debitPercent)}%`);
  setText("cash-flow-credit-meta", `${creditRows.length} credit row${creditRows.length === 1 ? "" : "s"}`);
  setText("cash-flow-debit-meta", `${debitRows.length} debit row${debitRows.length === 1 ? "" : "s"}`);
  setText("cash-flow-debit-pressure", `${Math.round(debitPercent)}%`);

  const debitPressureBar = document.getElementById("cash-flow-debit-pressure-bar");
  if (debitPressureBar) debitPressureBar.style.width = `${Math.max(0, Math.min(100, debitPercent))}%`;

  const chartEl = document.getElementById("cash-flow-pie-chart");
  if (chartEl) {
    if (flowTotal <= 0) {
      chartEl.style.background = "#f1f5f9";
    } else if (creditTotal <= 0) {
      chartEl.style.background = "#f43f5e";
    } else if (debitTotal <= 0) {
      chartEl.style.background = "#10b981";
    } else {
      chartEl.style.background = `conic-gradient(#10b981 0% ${creditPercent.toFixed(2)}%, #f43f5e ${creditPercent.toFixed(2)}% 100%)`;
    }
  }

  const pillEl = document.getElementById("cash-flow-state-pill");
  const summaryEl = document.getElementById("cash-flow-summary");
  const guidanceEl = document.getElementById("cash-flow-guidance");
  const captionEl = document.getElementById("cash-flow-caption");
  const debitStoryEl = document.getElementById("cash-flow-debit-story");

  let stateLabel = "Balanced";
  let pillClass = "rounded-lg bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-600 ring-1 ring-slate-200";
  let summary = "Money in and money out are balanced";
  let guidance = "Money in and money out are roughly equal in this filtered view.";
  let debitStory = debitRows.length
    ? `Money out is ${Math.round(debitPercent)}% of total flow. Biggest spend: ${getTransactionDisplayName(biggestDebit)} at ${formatINR(getTransactionEffectiveExpense(biggestDebit))}.`
    : "No money out rows in this filtered view.";

  if (!rows.length) {
    stateLabel = "Waiting";
    summary = "No rows selected yet";
    guidance = "Use date, amount, or tag filters to see whether money in or money out is higher.";
    debitStory = "Money out activity will appear here after search.";
  } else if (netTotal > 0.01) {
    stateLabel = "Cash-positive";
    pillClass = "rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-100";
    summary = `${formatINR(netTotal)} surplus`;
    guidance = `Money in is higher than money out by ${formatINR(netTotal)} across ${creditRows.length} credit row${creditRows.length === 1 ? "" : "s"} and ${debitRows.length} debit row${debitRows.length === 1 ? "" : "s"}.`;
  } else if (netTotal < -0.01) {
    const deficit = Math.abs(netTotal);
    stateLabel = "Spend-heavy";
    pillClass = "rounded-lg bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-rose-700 ring-1 ring-rose-100";
    summary = `${formatINR(deficit)} deficit`;
    guidance = `Money out is higher than money in by ${formatINR(deficit)} across ${debitRows.length} debit row${debitRows.length === 1 ? "" : "s"} and ${creditRows.length} credit row${creditRows.length === 1 ? "" : "s"}.`;
  }

  if (pillEl) {
    pillEl.className = pillClass;
    pillEl.textContent = stateLabel;
  }
  if (summaryEl) summaryEl.textContent = summary;
  if (guidanceEl) guidanceEl.textContent = guidance;
  if (debitStoryEl) debitStoryEl.textContent = debitStory;
  if (captionEl) {
    captionEl.textContent = rows.length
      ? `${rows.length} filtered row${rows.length === 1 ? "" : "s"} compared as money in vs money out.`
      : "Search to compare money in, money out, and net balance.";
  }
}

function renderReportOverview(data) {
  const rows = Array.isArray(data) ? data : [];
  const expenseRows = rows.filter((tx) => getTransactionEffectiveExpense(tx) > 0);
  const incomeRows = rows.filter((tx) => getTransactionEffectiveIncome(tx) > 0);
  const transferRows = rows.filter((tx) => (
    (!isSettlementTransaction(tx) && isTransferLikeTransaction(tx))
    || Boolean(tx.linked_as_recovery)
    || Number(tx.recovery_amount || 0) > 0
    || (Number(tx.split_expense_amount || 0) > 0 && hasEffectiveAmountAdjustment(tx))
  ));
  const debitTotal = expenseRows.reduce((sum, tx) => sum + getTransactionEffectiveExpense(tx), 0);
  const creditTotal = incomeRows.reduce((sum, tx) => sum + getTransactionEffectiveIncome(tx), 0);
  const liquidNetTotal = Number((creditTotal - debitTotal).toFixed(2));
  const openReviewRows = rows.filter((tx) => ["needs_review", "unknown", "unreviewed"].includes(String(tx.review_status || "").trim().toLowerCase()));

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const ownershipSummary = {
    self: { amount: 0, count: 0 },
    family: { amount: 0, count: 0 },
    shared: { amount: 0, count: 0 },
    business: { amount: 0, count: 0 },
    investments: { amount: 0, count: 0, buyAmount: 0, sellAmount: 0 },
    other: { amount: 0, count: 0 },
    payable: { amount: 0, count: 0 },
    recoverable: { amount: 0, count: 0 },
  };

  rows.forEach((tx) => {
    if (!isInvestmentTransaction(tx) || isSettlementTransaction(tx) || isTransferLikeTransaction(tx)) return;
    const amount = getInvestmentFlowAmount(tx);
    if (amount <= 0) return;

    if (isInvestmentBuyTransaction(tx)) {
      ownershipSummary.investments.amount += amount;
      ownershipSummary.investments.buyAmount += amount;
      ownershipSummary.investments.count += 1;
      return;
    }

    if (isInvestmentSellTransaction(tx)) {
      ownershipSummary.investments.amount -= amount;
      ownershipSummary.investments.sellAmount += amount;
      ownershipSummary.investments.count += 1;
    }
  });

  expenseRows.forEach((tx) => {
    const amount = getTransactionEffectiveExpense(tx);
    const settlementState = String(tx?.settlement_state || "").trim().toLowerCase();
    const ownership = String(tx?.consumption_ownership || "").trim().toLowerCase();

    if (settlementState === "owed_to_me" || settlementState === "partial") {
      ownershipSummary.recoverable.amount += amount;
      ownershipSummary.recoverable.count += 1;
      return;
    }
    if (settlementState === "i_owe") {
      ownershipSummary.payable.amount += amount;
      ownershipSummary.payable.count += 1;
      return;
    }
    if (ownership === "family_household") {
      ownershipSummary.family.amount += amount;
      ownershipSummary.family.count += 1;
      return;
    }
    if (ownership === "shared") {
      ownershipSummary.shared.amount += amount;
      ownershipSummary.shared.count += 1;
      return;
    }
    if (ownership === "business") {
      ownershipSummary.business.amount += amount;
      ownershipSummary.business.count += 1;
      return;
    }
    if (ownership === "other") {
      ownershipSummary.other.amount += amount;
      ownershipSummary.other.count += 1;
      return;
    }
    if (ownership === "self") {
      ownershipSummary.self.amount += amount;
      ownershipSummary.self.count += 1;
    }
  });

  setText("summary-debit-total", formatINR(debitTotal));
  setText("summary-credit-total", formatINR(creditTotal));
  setText("summary-review-count", String(openReviewRows.length));
  setText("summary-linked-count", String(transferRows.length));
  setText("summary-debit-meta", `${expenseRows.length} effective tagged expense row${expenseRows.length === 1 ? "" : "s"}`);
  setText("summary-credit-meta", `${incomeRows.length} classified income row${incomeRows.length === 1 ? "" : "s"}`);
  setText("summary-review-meta", openReviewRows.length ? `${openReviewRows.length} transaction${openReviewRows.length === 1 ? "" : "s"} still need attention` : "No open review items");
  setText("summary-linked-meta", transferRows.length ? `${transferRows.length} transfer, refund, payback, or split-adjusted row${transferRows.length === 1 ? "" : "s"} kept out of raw spend` : "No transfers or paybacks in this view");
  setText("ownership-self-total", formatINR(ownershipSummary.self.amount));
  setText("ownership-family-total", formatINR(ownershipSummary.family.amount));
  setText("ownership-shared-total", formatINR(ownershipSummary.shared.amount));
  setText("ownership-business-total", formatINR(ownershipSummary.business.amount));
  setText("ownership-investments-total", formatINR(ownershipSummary.investments.amount));
  setText("ownership-other-total", formatINR(ownershipSummary.other.amount));
  setText("ownership-payable-total", formatINR(ownershipSummary.payable.amount));
  setText("ownership-recoverable-total", formatINR(ownershipSummary.recoverable.amount));
  setText("ownership-self-meta", `${ownershipSummary.self.count} row${ownershipSummary.self.count === 1 ? "" : "s"}`);
  setText("ownership-family-meta", `${ownershipSummary.family.count} row${ownershipSummary.family.count === 1 ? "" : "s"}`);
  setText("ownership-shared-meta", `${ownershipSummary.shared.count} row${ownershipSummary.shared.count === 1 ? "" : "s"}`);
  setText("ownership-business-meta", `${ownershipSummary.business.count} row${ownershipSummary.business.count === 1 ? "" : "s"}`);
  setText(
    "ownership-investments-meta",
    ownershipSummary.investments.count
      ? `${ownershipSummary.investments.count} row${ownershipSummary.investments.count === 1 ? "" : "s"} · buys ${formatINR(ownershipSummary.investments.buyAmount)} / sells ${formatINR(ownershipSummary.investments.sellAmount)}`
      : "0 rows"
  );
  setText("ownership-other-meta", `${ownershipSummary.other.count} row${ownershipSummary.other.count === 1 ? "" : "s"}`);
  setText("ownership-payable-meta", `${ownershipSummary.payable.count} row${ownershipSummary.payable.count === 1 ? "" : "s"}`);
  setText("ownership-recoverable-meta", `${ownershipSummary.recoverable.count} row${ownershipSummary.recoverable.count === 1 ? "" : "s"}`);
  setText("net-liquid-total", formatINR(liquidNetTotal));
  setText("net-liquid-meta", `In ${formatINR(creditTotal)} · Out ${formatINR(debitTotal)}`);
  setText("net-investment-total", formatINR(ownershipSummary.investments.amount));
  setText(
    "net-investment-meta",
    `Buys ${formatINR(ownershipSummary.investments.buyAmount)} · Sells ${formatINR(ownershipSummary.investments.sellAmount)}`
  );
  setText(
    "net-receivable-total",
    formatINR(ownershipSummary.recoverable.amount)
  );
  setText(
    "net-receivable-meta",
    `${ownershipSummary.recoverable.count} open row${ownershipSummary.recoverable.count === 1 ? "" : "s"}`
  );
  setText(
    "net-payable-total",
    formatINR(ownershipSummary.payable.amount)
  );
  setText(
    "net-payable-meta",
    `${ownershipSummary.payable.count} open row${ownershipSummary.payable.count === 1 ? "" : "s"}`
  );

  const captionEl = document.getElementById("report-summary-caption");
  if (captionEl) {
    if (!rows.length) {
      captionEl.textContent = "Search to see cash spend, counted credits, review, and transfer state separately.";
    } else {
      const firstDate = rows[rows.length - 1]?.transaction_date;
      const lastDate = rows[0]?.transaction_date;
      const dateRange = firstDate && lastDate ? ` - ${firstDate} to ${lastDate}` : "";
      captionEl.textContent = `${rows.length} rows in view${dateRange} - refunds, paybacks, and self transfers are excluded from expense and income totals, while the structured summary separates ownership and shows net-position signals for liquid money, investments, receivables, and payables.`;
    }
  }

  renderSpendPieChart(rows);
  renderCashFlowChart(rows);
}

function populateBreakdownMonthFilter(data) {
  const selectEl = document.getElementById("breakdown_month_filter");
  if (!selectEl) return;

  const previousValue = breakdownViewState.month || "";
  const monthOptions = [...new Set(
    (Array.isArray(data) ? data : [])
      .map((tx) => String(tx.transaction_date || "").slice(0, 7))
      .filter(Boolean)
  )].sort().reverse();

  selectEl.innerHTML = [
    '<option value="">All Months</option>',
    ...monthOptions.map((monthKey) => {
      const [year, month] = monthKey.split("-");
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });
      return `<option value="${escapeHtml(monthKey)}">${escapeHtml(label)}</option>`;
    }),
  ].join("");

  selectEl.value = monthOptions.includes(previousValue) ? previousValue : "";
  breakdownViewState.month = selectEl.value;
}

function populateBreakdownSourceFilter(data) {
  const selectEl = document.getElementById("breakdown_source_filter");
  if (!selectEl) return;

  const previousValue = breakdownViewState.sourceGroup || "";
  const sourceOptions = [...new Set(
    (Array.isArray(data) ? data : [])
      .map(getTransactionSourceGroup)
      .map((source) => String(source || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  selectEl.innerHTML = [
    '<option value="">All Sources</option>',
    ...sourceOptions.map((source) => (
      `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`
    )),
  ].join("");

  selectEl.value = sourceOptions.includes(previousValue) ? previousValue : "";
  breakdownViewState.sourceGroup = selectEl.value;
}

function populateBreakdownOwnershipFilter(data) {
  const selectEl = document.getElementById("breakdown_ownership_filter");
  if (!selectEl) return;

  const previousValue = breakdownViewState.ownershipGroup || "";
  const ownershipOptions = [...new Set(
    (Array.isArray(data) ? data : [])
      .map(getOwnershipSpendGroupName)
      .map((group) => String(group || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  selectEl.innerHTML = [
    '<option value="">All Ownership</option>',
    ...ownershipOptions.map((group) => (
      `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`
    )),
  ].join("");

  selectEl.value = ownershipOptions.includes(previousValue) ? previousValue : "";
  breakdownViewState.ownershipGroup = selectEl.value;
}

function populateBreakdownSettlementFilter(data) {
  const selectEl = document.getElementById("breakdown_settlement_filter");
  if (!selectEl) return;

  const previousValue = breakdownViewState.settlementGroup || "";
  const settlementOptions = [...new Set(
    (Array.isArray(data) ? data : [])
      .map(getSettlementSpendGroupName)
      .map((group) => String(group || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  selectEl.innerHTML = [
    '<option value="">All Settlement</option>',
    ...settlementOptions.map((group) => (
      `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`
    )),
  ].join("");

  selectEl.value = settlementOptions.includes(previousValue) ? previousValue : "";
  breakdownViewState.settlementGroup = selectEl.value;
}

function getBreakdownTransactions() {
  let rows = Array.isArray(currentReportTransactions) ? [...currentReportTransactions] : [];
  if (!breakdownViewState.showHidden) {
    rows = rows.filter((tx) => !tx?.linked_as_recovery);
  }
  if (breakdownViewState.month) {
    rows = rows.filter(
      (tx) => String(tx.transaction_date || "").slice(0, 7) === breakdownViewState.month
    );
  }
  if (breakdownViewState.direction) {
    rows = rows.filter(
      (tx) => String(tx.direction || tx.type || "").toLowerCase() === breakdownViewState.direction
    );
  }
  if (breakdownViewState.sourceGroup) {
    rows = rows.filter((tx) => getTransactionSourceGroup(tx) === breakdownViewState.sourceGroup);
  }
  if (breakdownViewState.ownershipGroup) {
    rows = rows.filter((tx) => getOwnershipSpendGroupName(tx) === breakdownViewState.ownershipGroup);
  }
  if (breakdownViewState.settlementGroup) {
    rows = rows.filter((tx) => getSettlementSpendGroupName(tx) === breakdownViewState.settlementGroup);
  }
  if (breakdownViewState.obligationFocus) {
    rows = rows.filter((tx) => matchesObligationFocus(tx, breakdownViewState.obligationFocus));
  }
  if (breakdownViewState.tagState === "tagged") {
    rows = rows.filter((tx) => Array.isArray(tx.tags) && tx.tags.length > 0);
  } else if (breakdownViewState.tagState === "untagged") {
    rows = rows.filter((tx) => !Array.isArray(tx.tags) || tx.tags.filter(Boolean).length === 0);
  }
  if (breakdownViewState.reviewState === "needs_review") {
    rows = rows.filter((tx) => isNeedsReviewRow(tx));
  }
  const dateSort = breakdownViewState.dateSort || "date_desc";
  const amountSort = breakdownViewState.amountSort || "";
  const compareByDate = (a, b) => {
    if (dateSort === "date_asc") {
      return String(a.transaction_date || "").localeCompare(String(b.transaction_date || ""));
    }
    return String(b.transaction_date || "").localeCompare(String(a.transaction_date || ""));
  };
  const compareByAmount = (a, b) => {
    if (amountSort === "amount_desc") {
      return getTransactionAccountingDisplayAmount(b) - getTransactionAccountingDisplayAmount(a);
    }
    if (amountSort === "amount_asc") {
      return getTransactionAccountingDisplayAmount(a) - getTransactionAccountingDisplayAmount(b);
    }
    return 0;
  };
  rows.sort((a, b) => {
    if (amountSort) {
      const amountResult = compareByAmount(a, b);
      if (amountResult !== 0) return amountResult;
      const dateResult = compareByDate(a, b);
      if (dateResult !== 0) return dateResult;
    } else {
      const dateResult = compareByDate(a, b);
      if (dateResult !== 0) return dateResult;
    }

    return getTransactionDisplayName(a).localeCompare(getTransactionDisplayName(b));
  });

  return rows;
}

// Footer summary: count + running totals of the currently filtered view (#6) plus a
// classification-completeness chip with a one-click jump to untagged rows (#2).
function updateBreakdownSummary(rows) {
  const footerEl = document.getElementById("breakdown_footer_text");
  if (!footerEl) return;
  if (!_hasSearchedOnce) {
    footerEl.innerHTML = "Apply filters above to load transactions.";
    return;
  }
  const list = Array.isArray(rows) ? rows : [];
  const count = list.length;
  let outTotal = 0, inTotal = 0, tagged = 0;
  list.forEach((tx) => {
    outTotal += getTransactionEffectiveExpense(tx);
    inTotal += getTransactionEffectiveIncome(tx);
    if (Array.isArray(tx.tags) && tx.tags.filter(Boolean).length > 0) tagged += 1;
  });
  const net = inTotal - outTotal;
  const untagged = count - tagged;
  const pct = count ? Math.round((tagged / count) * 100) : 100;
  const netColor = net >= 0 ? "text-emerald-600" : "text-rose-600";
  const untaggedChip = untagged > 0
    ? `· <button type="button" data-jump-untagged="1" class="font-bold text-amber-600 hover:text-amber-700 hover:underline">${untagged} untagged (${pct}% tagged)</button>`
    : `· <span class="font-bold text-emerald-600">100% tagged</span>`;
  footerEl.innerHTML = `
    <span class="font-semibold text-slate-500">${count} transaction${count === 1 ? "" : "s"}</span>
    · <span class="text-rose-500">Out ${formatINR(outTotal)}</span>
    · <span class="text-emerald-600">In ${formatINR(inTotal)}</span>
    · <span class="${netColor} font-bold">Net ${net >= 0 ? "+" : "−"}${formatINR(Math.abs(net))}</span>
    ${untaggedChip}`;
}

// Quick-filter toggle chips (Needs review / Untagged) — purely client-side view filters.
function renderQuickFilters() {
  const bar = document.getElementById("quick-filter-chips");
  if (!bar) return;
  bar.classList.remove("hidden");
  const chip = (active, label, attr) =>
    `<button type="button" ${attr} class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
      active
        ? "bg-primary text-white ring-primary"
        : "bg-white text-slate-500 ring-slate-200 hover:ring-primary/40 hover:text-primary"
    }">${label}</button>`;
  bar.innerHTML =
    chip(breakdownViewState.reviewState === "needs_review", "⚠ Needs review", 'data-quick-filter="needs_review"') +
    chip(breakdownViewState.tagState === "untagged", "Untagged", 'data-quick-filter="untagged"');
}

function setBulkTagMessage(message, isError = false) {
  const messageEl = document.getElementById("bulk-tag-message");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.classList.remove("hidden", "bg-emerald-50", "text-emerald-700", "bg-rose-50", "text-rose-700");
  messageEl.classList.add(
    isError ? "bg-rose-50" : "bg-emerald-50",
    isError ? "text-rose-700" : "text-emerald-700"
  );
}

function clearBulkTagMessage() {
  const messageEl = document.getElementById("bulk-tag-message");
  if (!messageEl) return;
  messageEl.textContent = "";
  messageEl.classList.add("hidden");
}

function getDisplayedTransactionIds() {
  return [...document.querySelectorAll("[data-bulk-select-transaction]")]
    .map((input) => String(input.dataset.transactionId || "").trim())
    .filter(Boolean);
}

function updateBulkTagToolbar() {
  const toolbar = document.getElementById("bulk-tag-toolbar");
  const countEl = document.getElementById("bulk-tag-selected-count");
  const groupClassifyBtn = document.getElementById("bulk-group-classify-btn");
  const selectAllEl = document.getElementById("select-all-transactions");
  const selectedCount = selectedTransactionIds.size;
  const displayedIds = getDisplayedTransactionIds();
  const selectedDisplayedCount = displayedIds.filter((id) => selectedTransactionIds.has(id)).length;

  if (toolbar) {
    toolbar.classList.toggle("hidden", selectedCount === 0);
  }
  if (countEl) {
    countEl.textContent = `${selectedCount} transaction${selectedCount === 1 ? "" : "s"} selected`;
  }
  if (groupClassifyBtn) {
    groupClassifyBtn.disabled = selectedCount < 2;
    groupClassifyBtn.title = selectedCount < 2 ? "Select at least 2 transactions" : "Group & classify all selected at once";
  }
  if (selectAllEl) {
    selectAllEl.checked = displayedIds.length > 0 && selectedDisplayedCount === displayedIds.length;
    selectAllEl.indeterminate = selectedDisplayedCount > 0 && selectedDisplayedCount < displayedIds.length;
  }
  // Refresh the drop strip chips whenever toolbar visibility changes
  if (selectedCount > 0) _renderDropStrip();
}

function clearBulkSelection() {
  selectedTransactionIds.clear();
  document.querySelectorAll("[data-bulk-select-transaction]").forEach((input) => {
    input.checked = false;
  });
  updateBulkTagToolbar();
}

function validateFilters() {
  const report_type = document.getElementById("report_type")?.value?.trim() || "";
  const fromDate = document.getElementById("from_date").value;
  const toDate = document.getElementById("to_date").value;
  const vendor_filter = document.getElementById("vendor_filter").value.trim();
  const amount_filter = document.getElementById("amount_filter")?.value?.trim() || "";
  const tag_filter = document.getElementById("tag_filter")?.value?.trim() || "";

  response = {
    valid: false,
    search_values: {},
    message: "",
  };

  if (!fromDate && !toDate && !vendor_filter && !amount_filter && !tag_filter && !report_type) {
    response.message = "Provide at least one filter or date range";
    return response;
  }

  if (fromDate && toDate) {
    if (fromDate > toDate) {
      response.message = "From date cannot be after To date";
      return response;
    }

    response.valid = true;
    response.search_values = {
      from_date: fromDate,
      to_date: toDate,
    };
  }

  if (report_type) {
    response.valid = true;
    response["search_values"]["report_type"] = report_type;
  }

  if (vendor_filter) {
    response.valid = true;
    response["search_values"]["vendor_filter"] = vendor_filter;
  }

  if (amount_filter) {
    const parsedAmount = Number(amount_filter);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      response.message = "Amount must be a valid positive number";
      return response;
    }
    response.valid = true;
    response["search_values"]["amount_filter"] = parsedAmount;
  }

  if (tag_filter) {
    response.valid = true;
    response["search_values"]["tag_filter"] = tag_filter;
  }

  return response;
}

async function submitSearch() {
  const errorDiv = document.getElementById("errorMessage");

  /* Re-derive the month-nav label up-front so even validation failures (e.g.
     a preset with empty dates) still leave the label matching the inputs. */
  (function syncMonthLabel() {
    const fromEl = document.getElementById("from_date");
    const toEl   = document.getElementById("to_date");
    const labelEl = document.getElementById("month-nav-label");
    if (!labelEl || !fromEl || !toEl) return;
    const from = fromEl.value, to = toEl.value;
    if (!from && !to) { labelEl.textContent = "All time"; return; }
    if (from && to) {
      const d = new Date(from + "T00:00:00");
      const y = d.getFullYear(), m = d.getMonth();
      const expectedFirst = `${y}-${String(m+1).padStart(2,"0")}-01`;
      const lastDay = new Date(y, m+1, 0);
      const expectedLast = `${y}-${String(m+1).padStart(2,"0")}-${String(lastDay.getDate()).padStart(2,"0")}`;
      if (from === expectedFirst && to === expectedLast) {
        /* Full calendar month — compute the friendly label */
        const now = new Date();
        if (y === now.getFullYear() && m === now.getMonth()) { labelEl.textContent = "This month"; return; }
        const monthsDiff = (now.getFullYear() - y) * 12 + (now.getMonth() - m);
        if (monthsDiff === 1) { labelEl.textContent = "Last month"; return; }
        const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        labelEl.textContent = `${MONTHS[m]} ${y}`;
        return;
      }
    }
    labelEl.textContent = "Custom";
  })();

  const result = validateFilters();
  if (!result.valid) {
    errorDiv.innerText = result.message;
    errorDiv.classList.remove("hidden");
    return; // 🚨 API WILL NOT BE CALLED
  }
  errorDiv.classList.add("hidden");

  try {
    const response = await fetch("/reports/transactions_filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.search_values),
    });

    if (!response.ok) {
      throw new Error("Backend error");
    }

    const data = await response.json();
    currentReportTransactions = Array.isArray(data.data) ? data.data : [];
    _hasSearchedOnce = true;
    populateBreakdownMonthFilter(currentReportTransactions);
    populateBreakdownSourceFilter(currentReportTransactions);
    populateBreakdownOwnershipFilter(currentReportTransactions);
    populateBreakdownSettlementFilter(currentReportTransactions);
    renderAmountChart(data.data);
    // Pre-fetch group membership so EVENT members collapse on first paint.
    await _fetchGroupFlags(currentReportTransactions.map((t) => t.id).filter(Boolean));
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
  } catch (err) {
    errorDiv.innerText = "Something went wrong";
    errorDiv.classList.remove("hidden");
  }
}

function renderAmountChart(data) {
  renderReportOverview(data);
}

function renderTransactionTable(data) {
  const tbody = document.getElementById("transactions_table_body");
  const rows = Array.isArray(data) ? data : [];
  _computeLeafSpendStats(rows);
  updateBreakdownSummary(rows);
  renderQuickFilters();
  if (typeof updateActiveFilterChips === "function") updateActiveFilterChips();
  updateConfirmAutoButton();
  const visibleIds = new Set(
    (Array.isArray(data) ? data : [])
      .map((tx) => String(tx?.id || ""))
      .filter(Boolean)
  );
  [...selectedTransactionIds].forEach((id) => {
    if (!visibleIds.has(id)) selectedTransactionIds.delete(id);
  });
  tbody.innerHTML = "";

  if (!Array.isArray(data) || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-10 text-center">
          <div class="mx-auto max-w-sm rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
            <p class="text-base font-semibold text-slate-700">No transactions found</p>
            <p class="mt-2 text-sm text-slate-500">Try broadening the date range or removing one of the filters.</p>
          </div>
        </td>
      </tr>
    `;
    updateBulkTagToolbar();
    return;
  }

  const allRows = Array.isArray(data) ? data : [];
  const emittedEvents = new Set();
  allRows.forEach((tx) => {
    const flag = _groupFlagsCache[String(tx.id || "")];
    if (flag && flag.group_type === "EVENT") {
      if (emittedEvents.has(flag.group_id)) return;   // event already rendered
      emittedEvents.add(flag.group_id);
      const members = allRows.filter((r) => {
        const mf = _groupFlagsCache[String(r.id || "")];
        return mf && mf.group_id === flag.group_id;
      });
      _appendEventGroup(tbody, flag, members);
    } else {
      tbody.appendChild(_buildTransactionRowEl(tx, {}));
    }
  });
  updateBulkTagToolbar();
  _refreshGroupBadges(allRows.map((t) => t.id).filter(Boolean));
}

function _buildTransactionRowEl(tx, opts = {}) {
    const isChild = !!opts.isChild;
    const tags = normalizeTags(tx.tags);
    const actualTags = getTransactionCategoryLabels(tx);
    const anomaly = getAmountAnomaly(tx);
    const statusChips = getTransactionStatusChips(tx);
    const actionState = getClassificationActionState(tx);
    const isSettlement = isSettlementTransaction(tx);
    const recoveryAmount = getTransactionRecoveryAmount(tx);
    const effectiveDisplayAmount = getTransactionAccountingDisplayAmount(tx);
    const rawDisplayAmount = Math.abs(Number(tx.amount || 0));
    const amountWasAdjusted = hasEffectiveAmountAdjustment(tx);
    // Hide the raw UPI/account id on already-tagged rows to keep them compact.
    const secondaryLine = getTransactionSecondaryLine(tx, { hideIdentifier: actualTags.length > 0 });
    const isCredit = tx.direction == "withdrawal" ? false : true;
    const amountClass = isCredit
      ? "bg-emerald-900/90 text-emerald-50 ring-emerald-950/20"
      : "bg-red-700 text-red-50 ring-red-900/20";
    const row = document.createElement("tr");
    const _dirBorder = isSettlement
      ? "border-l-2 border-l-slate-300"
      : isCredit
        ? "border-l-2 border-l-emerald-400"
        : "border-l-2 border-l-rose-400";
    row.className = `group transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-700/50 ${_dirBorder}`;
    row.dataset.transactionId = String(tx.id || "");
    row.draggable = true;
    row.addEventListener("dragstart", e => {
      const id = String(tx.id || "");
      if (!selectedTransactionIds.has(id)) {
        selectedTransactionIds.add(id);
        updateBulkTagToolbar();
        const cb = row.querySelector("[data-bulk-select-transaction]");
        if (cb) cb.checked = true;
      }
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", [...selectedTransactionIds].join(","));
    });
    if (isChild) {
      row.dataset.eventChild = opts.groupId || "";
      row.style.boxShadow = "inset 4px 0 0 #c4b5fd";
      if (!opts.expanded) row.classList.add("hidden");
    }
    row.innerHTML = `
       <td class="breakdown-cell">
          <input
            type="checkbox"
            data-bulk-select-transaction="1"
            data-transaction-id="${escapeHtml(tx.id || "")}"
            class="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            ${selectedTransactionIds.has(String(tx.id || "")) ? "checked" : ""}
          />
       </td>
       <td class="breakdown-cell text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtml(fmtDMY(tx.transaction_date))}</td>
        <td class="breakdown-cell">
          <div class="breakdown-copy flex min-w-0 flex-col">
            <span class="font-semibold text-slate-800 cursor-pointer hover:text-primary transition-colors" data-cp-name="${escapeHtml(getTransactionDisplayName(tx))}">${escapeHtml(getTransactionDisplayName(tx))}</span>
            ${(secondaryLine || statusChips.length) ? `<div class="mt-0.5 flex items-center gap-1 min-w-0">
              ${secondaryLine ? `<span class="truncate text-xs text-slate-500 min-w-0">${escapeHtml(secondaryLine)}</span>` : ""}
              ${statusChips.map((chip) => `<span class="shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${chip.className}">${escapeHtml(chip.label)}</span>`).join("")}
            </div>` : ""}
          </div>
        </td>
         <td class="breakdown-cell">
           <div class="flex flex-wrap items-center gap-1.5">
             ${actualTags.length
               ? (() => {
                   // "auto" only applies when not yet manually confirmed — suppress on Done/No-Action rows
                   const _rs = String(tx?.review_status || "").trim().toLowerCase();
                   const _isDone = _rs === "confirmed" || _rs === "no_action_needed";
                   const isSystemTagged = actualTags.length > 0 && !tx.review_status_manual && !_isDone;
                   // All tag pills use sky (one standard tag color).
                   // The "auto" amber badge (below) is the only differentiator for auto-tagged.
                   const tagCls = "bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-900/20 dark:text-sky-300 dark:ring-sky-800/40";
                   const pills = actualTags.map((tag) => {
                     const catColor = (window._catColorMap || {})[(tag || "").toLowerCase().trim()];
                     // Category color as left-border accent — the category identity sits on the tag pill.
                     const pillStyle = catColor ? `border-left:3px solid ${catColor}` : "";
                     return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tagCls}" style="${pillStyle}">${escapeHtml(tag)}</span>`;
                   }).join("");
                   // +N chip for any tags not in the shown [root, leaf] pair (#3) — reveals on click.
                   const hidden = tags.filter((t) => !actualTags.includes(t));
                   const hiddenAttr = escapeHtml(JSON.stringify(hidden));
                   const moreChip = hidden.length
                     ? `<button type="button" data-expand-tags data-hidden-json="${hiddenAttr}" data-tag-cls="${escapeHtml(tagCls)}" title="${escapeHtml(hidden.join(", "))}" class="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200 transition">+${hidden.length}</button>`
                     : "";
                   const badge = isSystemTagged
                     ? `<span title="System tagged — not yet manually reviewed" class="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 ring-1 ring-amber-200"><span class="material-symbols-outlined text-[9px]">smart_toy</span>auto</span>`
                     : "";
                   return pills + moreChip + badge;
                 })()
               : ""}
             <button
               data-quick-tag-btn="${escapeHtml(tx.id || "")}"
               title="Add tag"
               class="flex-shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-primary hover:text-primary hover:bg-primary/10 transition opacity-0 group-hover:opacity-100"
             ><span class="material-symbols-outlined text-[13px] leading-none">new_label</span></button>
             <span data-group-badge="${escapeHtml(tx.id || "")}"></span>
             <button
               data-add-to-group-txn="${escapeHtml(tx.id || "")}"
               data-add-to-group-amt="${Math.abs(parseFloat(tx.amount || 0))}"
               title="Add to group"
               class="flex-shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition opacity-0 group-hover:opacity-100"
             ><span class="material-symbols-outlined text-[12px] leading-none">group_work</span></button>
             ${(!isCredit && !isSettlement) ? (() => {
               const sjAmt = Number(tx.shared_joy_amount || 0);
               const isTagged = sjAmt > 0;
               return `<button
                 data-shared-joy-txn="${escapeHtml(tx.id || "")}"
                 data-shared-joy-amount="${sjAmt}"
                 data-shared-joy-max="${Math.abs(Number(tx.amount || 0))}"
                 title="${isTagged ? `✨ Shared Joy: ${formatINR(sjAmt)} — click to edit` : "Tag as ✨ Shared Joy"}"
                 class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition
                   ${isTagged
                     ? "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-600/60 hover:bg-purple-100 dark:hover:bg-purple-900/50"
                     : "bg-transparent text-slate-400 dark:text-slate-500 hover:text-purple-500 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 border border-slate-200 dark:border-slate-600/50 hover:border-purple-300 dark:hover:border-purple-600 opacity-0 group-hover:opacity-100 transition-opacity"}">
                 ✨${isTagged ? ` ${formatINR(sjAmt)}` : ""}
               </button>`;
             })() : ""}
           </div>
         </td>
        <td class="breakdown-cell text-right">
          <div class="inline-flex flex-col items-end">
            <span class="rounded-full px-3 py-1 text-sm font-bold ring-1 ${amountClass}">${formatINR(effectiveDisplayAmount)}</span>
            ${anomaly ? `<span title="About ${anomaly.ratio}× your usual ${escapeHtml(getTransactionLeafCategory(tx))} spend" class="mt-1 inline-flex items-center gap-0.5 rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-600 ring-1 ring-orange-200"><span class="material-symbols-outlined text-[10px]">priority_high</span>${anomaly.ratio}× usual</span>` : ""}
            ${amountWasAdjusted ? `<span class="mt-1 text-[10px] text-slate-400 line-through">${escapeHtml(formatINR(rawDisplayAmount))}</span>` : ""}
            ${amountWasAdjusted && !isCredit && recoveryAmount > 0 ? `<span class="mt-0.5 text-[10px] font-semibold text-emerald-600">${escapeHtml(formatINR(recoveryAmount))} recovered</span>` : ""}
            ${Number(tx.shared_joy_amount || 0) > 0 ? `<span class="mt-0.5 text-[10px] font-semibold text-purple-500 dark:text-purple-400">✨ ${escapeHtml(formatINR(Number(tx.shared_joy_amount)))} shared</span>` : ""}
          </div>
        </td>
        <td class="breakdown-cell text-center text-slate-1000 dark:text-slate-400">
          <div class="flex flex-col items-center gap-1.5">
          ${isSettlement
            ? `<a data-preserve-report-state="1" href="/classification/transaction/${encodeURIComponent(tx.id)}?mode=simple"
                class="inline-flex min-w-[96px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold tracking-[0.01em] text-slate-500 ring-1 ring-slate-200 hover:bg-slate-200 transition" title="Open to review or unlink settlement">
                <span class="material-symbols-outlined text-[13px]">linked_services</span>Settled</a>`
            : `<a
          data-preserve-report-state="1"
          class="inline-flex min-w-[96px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[11px] font-bold tracking-[0.01em] transition hover:-translate-y-0.5 ${actionState.className}"
           href="/classification/transaction/${encodeURIComponent(tx.id)}?mode=simple"
         >
          <span class="material-symbols-outlined text-[15px] leading-none">${escapeHtml(actionState.icon)}</span>
          <span>${escapeHtml(actionState.label)}</span>
         </a>`}
          </div>
         </td>
        `;

    return row;
}

/* ── EVENT group collapse (Reports page) ──────────────────────────────────── */

function _appendEventGroup(tbody, info, members) {
  const groupId = String(info.group_id || "");
  const expanded = _expandedEventGroups.has(groupId);
  const settled = String(info.status || "").toUpperCase() === "SETTLED";
  const sj = Number(info.shared_joy_amount || 0);
  const total = members.reduce((s, m) => s + Math.abs(Number(getTransactionAccountingDisplayAmount(m) || 0)), 0);
  const dates = members.map((m) => m.transaction_date).filter(Boolean).sort();
  const dateLabel = dates.length
    ? (dates[0] === dates[dates.length - 1] ? fmtDMY(dates[0]) : `${fmtDMY(dates[0])} – ${fmtDMY(dates[dates.length - 1])}`)
    : "";
  // Total member count (may exceed visible members if some are outside the date filter)
  const totalCount = Number(info.total_member_count || members.length);
  const hiddenCount = Math.max(0, totalCount - members.length);

  const parent = document.createElement("tr");
  parent.dataset.eventParent = groupId;
  parent.className = "cursor-pointer bg-violet-50/70 hover:bg-violet-100/70 dark:bg-violet-900/20 dark:hover:bg-violet-900/30 transition-colors";
  parent.innerHTML = `
    <td class="breakdown-cell">
      <span data-event-chevron class="material-symbols-outlined text-[18px] text-violet-500 transition-transform" style="${expanded ? "transform:rotate(90deg)" : ""}">chevron_right</span>
    </td>
    <td class="breakdown-cell text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtml(dateLabel)}</td>
    <td class="breakdown-cell">
      <div class="flex min-w-0 flex-col">
        <span class="font-bold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px]">restaurant</span>${escapeHtml(info.group_name || "Event")}
        </span>
        <span class="mt-0.5 text-xs text-slate-500">${totalCount} transaction${totalCount === 1 ? "" : "s"} · Event${hiddenCount > 0 ? ` <span class="text-violet-400">(${hiddenCount} outside date range)</span>` : ""}</span>
      </div>
    </td>
    <td class="breakdown-cell">
      <div class="flex flex-wrap items-center gap-1.5">
        <button data-event-shared-joy="${escapeHtml(groupId)}" data-event-sj-amount="${sj}" data-event-sj-max="${total}"
          title="${sj > 0 ? `✨ Shared Joy: ${formatINR(sj)} — click to edit` : "Tag event ✨ Shared Joy"}"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition ${sj > 0
            ? "bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-600/60 hover:bg-purple-100"
            : "bg-transparent text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-600/50 hover:text-purple-500 hover:border-purple-300"}">
          ✨${sj > 0 ? ` ${formatINR(sj)}` : ""}
        </button>
        ${settled
          ? `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-200">Settled</span>`
          : `<span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600 ring-1 ring-amber-200">Open</span>`}
      </div>
    </td>
    <td class="breakdown-cell text-right">
      <span class="rounded-full px-3 py-1 text-sm font-bold ring-1 bg-violet-700 text-violet-50 ring-violet-900/20">${formatINR(total)}</span>
    </td>
    <td class="breakdown-cell text-center">
      <div class="flex flex-col items-center gap-1.5">
        ${settled
          ? `<button data-event-action data-event-reopen="${escapeHtml(groupId)}" class="inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200">Reopen</button>`
          : `<button data-event-action data-event-settle="${escapeHtml(groupId)}" class="inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-600">Settle</button>`}
        <a data-event-action href="/groups.html" class="text-[10px] font-semibold text-violet-500 hover:underline">Open group</a>
      </div>
    </td>`;
  parent.addEventListener("click", (e) => {
    if (e.target.closest("[data-event-action]") || e.target.closest("[data-event-shared-joy]")) return;
    window.toggleEventGroup(groupId);
  });
  tbody.appendChild(parent);

  members.forEach((m) => tbody.appendChild(_buildTransactionRowEl(m, { isChild: true, groupId, expanded })));
}

window.toggleEventGroup = function (groupId) {
  if (_expandedEventGroups.has(groupId)) _expandedEventGroups.delete(groupId);
  else _expandedEventGroups.add(groupId);
  const expanded = _expandedEventGroups.has(groupId);
  document.querySelectorAll(`[data-event-child="${CSS.escape(groupId)}"]`).forEach((r) => r.classList.toggle("hidden", !expanded));
  const chev = document.querySelector(`[data-event-parent="${CSS.escape(groupId)}"] [data-event-chevron]`);
  if (chev) chev.style.transform = expanded ? "rotate(90deg)" : "";

  // Fetch out-of-range members the first time the group is expanded
  if (expanded) {
    const parentRow = document.querySelector(`[data-event-parent="${CSS.escape(groupId)}"]`);
    if (parentRow && parentRow.dataset.outOfRangeFetched !== "1") {
      parentRow.dataset.outOfRangeFetched = "1";
      _fetchOutOfRangeGroupMembers(groupId, parentRow);
    }
  }
};

async function _fetchOutOfRangeGroupMembers(groupId, parentRow) {
  try {
    const res = await fetch(`/groups/${encodeURIComponent(groupId)}/member-transactions`);
    const result = await res.json();
    const allIds = (result.data || []).map(String);
    // Find IDs already rendered as child rows
    const existingIds = new Set(
      [...document.querySelectorAll(`[data-event-child="${CSS.escape(groupId)}"]`)]
        .map(r => r.dataset.transactionId).filter(Boolean)
    );
    const missingIds = allIds.filter(id => !existingIds.has(id));
    if (!missingIds.length) return;
    // Fetch the missing transactions
    const txRes = await fetch("/reports/transactions_filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: missingIds }),
    });
    const txResult = await txRes.json();
    const txns = Array.isArray(txResult.data) ? txResult.data : [];
    // Insert them after the last existing child row
    const lastChild = [...document.querySelectorAll(`[data-event-child="${CSS.escape(groupId)}"]`)].at(-1);
    const insertAfter = lastChild || parentRow;
    txns.forEach(tx => {
      const row = _buildTransactionRowEl(tx, { isChild: true, groupId, expanded: true });
      // Add "outside period" badge styling
      row.classList.add("opacity-70");
      row.title = "Outside current date filter";
      insertAfter.after(row);
    });
  } catch (e) {
    console.warn("Could not fetch out-of-range group members", e);
  }
}

// Update the cached shared-joy amount for every member of an event group.
function _setEventSharedJoyInCache(groupId, amount) {
  for (const info of Object.values(_groupFlagsCache)) {
    if (info && String(info.group_id) === String(groupId)) info.shared_joy_amount = amount;
  }
}

// Event-level Shared Joy: writes to the group (PATCH /groups/{id}/meta), which
// analytics/budget read back. Distinct from per-transaction quick-tag.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-event-shared-joy]");
  if (!btn) return;
  e.stopPropagation();
  _openEventSharedJoyPopover(
    btn.dataset.eventSharedJoy,
    parseFloat(btn.dataset.eventSjAmount || "0"),
    parseFloat(btn.dataset.eventSjMax || "0"),
    btn
  );
});

function _openEventSharedJoyPopover(groupId, currentAmount, maxAmount, anchorEl) {
  const isDark = document.documentElement.classList.contains("dark");
  let popover = document.getElementById("event-shared-joy-popover");
  if (!popover) {
    popover = document.createElement("div");
    popover.id = "event-shared-joy-popover";
    document.body.appendChild(popover);
    document.addEventListener("click", (e) => {
      if (!popover.contains(e.target) && !e.target.closest("[data-event-shared-joy]")) popover.classList.add("hidden");
    }, true);
  }
  popover.className = "fixed z-50 rounded-2xl shadow-2xl p-4 w-72";
  popover.style.cssText = isDark
    ? "background:#1e293b;border:1px solid rgba(217,119,6,0.4);color:#f1f5f9"
    : "background:#ffffff;border:1px solid #fde68a;color:#0f172a";
  const inputStyle = isDark
    ? "width:100%;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;padding:8px 12px;font-size:13px;outline:none;box-sizing:border-box"
    : "width:100%;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;padding:8px 12px;font-size:13px;outline:none;box-sizing:border-box";
  const titleStyle = isDark ? "color:#f8fafc" : "color:#0f172a";

  popover.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
      <div>
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#f59e0b">Event giving</p>
        <h4 style="font-size:14px;font-weight:800;margin-top:2px;${titleStyle}">✨ Shared Joy (whole event)</h4>
      </div>
      <button id="esj-close" style="padding:4px;border:none;background:transparent;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1">✕</button>
    </div>
    <p style="font-size:11px;color:${isDark ? "#94a3b8" : "#64748b"};margin-bottom:12px">How much of this combined event was spent on others?</p>
    <label style="display:block;font-size:11px;font-weight:600;color:${isDark ? "#94a3b8" : "#475569"};margin-bottom:4px">Amount (₹) <span style="font-weight:400;color:${isDark ? "#64748b" : "#94a3b8"}">of ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(maxAmount)}</span></label>
    <input id="esj-amount" type="number" min="0" max="${maxAmount}" step="1" style="${inputStyle}" placeholder="e.g. 450" value="${currentAmount > 0 ? currentAmount : ""}" />
    <div style="display:flex;gap:8px;padding-top:10px">
      <button id="esj-save" style="flex:1;border-radius:8px;background:#f59e0b;padding:8px 12px;font-size:11px;font-weight:700;color:#fff;border:none;cursor:pointer">Save ✨</button>
      ${currentAmount > 0 ? `<button id="esj-remove" style="border-radius:8px;border:1px solid ${isDark ? "rgba(239,68,68,0.4)" : "#fecaca"};padding:8px 12px;font-size:11px;font-weight:600;color:${isDark ? "#f87171" : "#ef4444"};background:transparent;cursor:pointer">Remove</button>` : ""}
    </div>
    <p id="esj-status" style="display:none;font-size:11px;font-weight:600;color:#ef4444;margin-top:8px"></p>`;

  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 6}px`;
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 296))}px`;
  popover.classList.remove("hidden");
  document.getElementById("esj-close")?.addEventListener("click", () => popover.classList.add("hidden"));

  async function _save(amount) {
    const saveBtn = document.getElementById("esj-save");
    const statusEl = document.getElementById("esj-status");
    if (statusEl) statusEl.style.display = "none";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    try {
      const res = await fetch(`/groups/${groupId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared_joy_amount: amount }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || "Save failed");
      popover.classList.add("hidden");
      window.toast?.success(amount > 0 ? `✨ Event Shared Joy: ${formatINR(amount)}` : "Shared Joy removed");
      _setEventSharedJoyInCache(groupId, amount);
      renderTransactionTable(getBreakdownTransactions());
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || "Error"; statusEl.style.display = "block"; }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save ✨"; }
    }
  }

  document.getElementById("esj-save")?.addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("esj-amount")?.value || "0") || 0;
    const statusEl = document.getElementById("esj-status");
    if (amount < 0 || amount > maxAmount) {
      if (statusEl) { statusEl.textContent = `Enter an amount between 0 and ${formatINR(maxAmount)}`; statusEl.style.display = "block"; }
      return;
    }
    _save(amount);
  });
  document.getElementById("esj-remove")?.addEventListener("click", () => _save(0));
}

// Settle / reopen an event group from the collapsed parent row.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-event-settle], [data-event-reopen]");
  if (!btn) return;
  e.stopPropagation();
  const groupId = btn.dataset.eventSettle || btn.dataset.eventReopen;
  const newStatus = btn.dataset.eventSettle ? "SETTLED" : "OPEN";
  btn.disabled = true;
  try {
    // Fetch current name/notes so the PUT doesn't wipe them (status-only intent).
    const cur = await fetch(`/groups/${groupId}`).then((r) => r.json()).catch(() => ({}));
    const g = cur.data || {};
    const res = await fetch(`/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: g.name || "Event", status: newStatus, notes: g.notes ?? null }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.message || "Failed");
    window.toast?.success(newStatus === "SETTLED" ? "Event settled" : "Event reopened");
    for (const info of Object.values(_groupFlagsCache)) {
      if (info && String(info.group_id) === String(groupId)) info.status = newStatus;
    }
    renderTransactionTable(getBreakdownTransactions());
  } catch (err) {
    window.toast?.error(err.message || "Something went wrong");
  } finally {
    btn.disabled = false;
  }
});

/* ── Shared Joy popover ───────────────────────────────────────────────────── */

document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-shared-joy-txn]");
  if (!btn) return;
  e.stopPropagation();
  _openSharedJoyPopover(
    btn.dataset.sharedJoyTxn,
    parseFloat(btn.dataset.sharedJoyAmount || "0"),
    parseFloat(btn.dataset.sharedJoyMax || "0"),
    btn
  );
});

function _openSharedJoyPopover(txnId, currentAmount, maxAmount, anchorEl) {
  const isDark = document.documentElement.classList.contains("dark");

  let popover = document.getElementById("shared-joy-popover");
  if (!popover) {
    popover = document.createElement("div");
    popover.id = "shared-joy-popover";
    document.body.appendChild(popover);
    document.addEventListener("click", e => {
      if (!popover.contains(e.target) && !e.target.closest("[data-shared-joy-txn]")) {
        popover.classList.add("hidden");
      }
    }, true);
  }

  // Apply theme-aware styles directly (Tailwind CDN doesn't always apply dark: on dynamic elements)
  popover.className = "fixed z-50 rounded-2xl shadow-2xl p-4 w-72";
  popover.style.cssText = isDark
    ? "background:#1e293b;border:1px solid rgba(217,119,6,0.4);color:#f1f5f9"
    : "background:#ffffff;border:1px solid #fde68a;color:#0f172a";

  const contextOptions = ["Family", "Friends", "Donation", "Colleague", "Others"];

  const inputStyle = isDark
    ? "width:100%;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;padding:8px 12px;font-size:13px;outline:none;box-sizing:border-box"
    : "width:100%;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;padding:8px 12px;font-size:13px;outline:none;box-sizing:border-box";

  const labelStyle = isDark
    ? "display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px"
    : "display:block;font-size:11px;font-weight:600;color:#475569;margin-bottom:4px";

  const subTextStyle  = isDark ? "color:#64748b" : "color:#94a3b8";
  const titleStyle    = isDark ? "color:#f8fafc" : "color:#0f172a";
  const descStyle     = isDark ? "font-size:11px;color:#94a3b8;margin-bottom:12px" : "font-size:11px;color:#64748b;margin-bottom:12px";
  const removeBtnStyle = isDark
    ? "border-radius:8px;border:1px solid rgba(239,68,68,0.4);padding:8px 12px;font-size:11px;font-weight:600;color:#f87171;background:transparent;cursor:pointer"
    : "border-radius:8px;border:1px solid #fecaca;padding:8px 12px;font-size:11px;font-weight:600;color:#ef4444;background:transparent;cursor:pointer";

  popover.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
      <div>
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#f59e0b">Giving tracker</p>
        <h4 style="font-size:14px;font-weight:800;margin-top:2px;${titleStyle}">✨ Shared Joy</h4>
      </div>
      <button id="sj-close" style="padding:4px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:${isDark?'#94a3b8':'#94a3b8'};font-size:18px;line-height:1">✕</button>
    </div>
    <p style="${descStyle}">How much of this expense did you spend on others?</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <label style="${labelStyle}">Amount (₹) <span style="${subTextStyle};font-weight:400">of ${new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(maxAmount)}</span></label>
        <input id="sj-amount-input" type="number" min="0" max="${maxAmount}" step="1"
          style="${inputStyle}" placeholder="e.g. 800" value="${currentAmount > 0 ? currentAmount : ""}" />
      </div>
      <div>
        <label style="${labelStyle}">For whom?</label>
        <select id="sj-context-select" style="${inputStyle}">
          ${contextOptions.map(c => `<option value="${c}" style="background:${isDark?'#1e293b':'#fff'}">${c}</option>`).join("")}
        </select>
      </div>
      <div style="display:flex;gap:8px;padding-top:4px">
        <button id="sj-save-btn"
          style="flex:1;border-radius:8px;background:#f59e0b;padding:8px 12px;font-size:11px;font-weight:700;color:#fff;border:none;cursor:pointer">
          Save ✨
        </button>
        ${currentAmount > 0 ? `<button id="sj-remove-btn" style="${removeBtnStyle}">Remove</button>` : ""}
      </div>
      <p id="sj-status" style="display:none;font-size:11px;font-weight:600;color:#ef4444"></p>
    </div>`;

  document.getElementById("sj-close")?.addEventListener("click", () => popover.classList.add("hidden"));

  async function _doSave(amount) {
    const saveBtn   = document.getElementById("sj-save-btn");
    const statusEl  = document.getElementById("sj-status");
    const context   = document.getElementById("sj-context-select")?.value || "Others";
    if (statusEl) statusEl.classList.add("hidden");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    try {
      const res = await fetch("/reports/shared-joy/quick-tag", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ transaction_id: txnId, shared_joy_amount: amount, context }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.message || "Save failed");
      popover.classList.add("hidden");
      window.toast?.success(amount > 0 ? `✨ Shared Joy tagged: ${new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(amount)}` : "Shared Joy removed");
      // Update the cached row data and re-render the full table
      const txIdx = currentReportTransactions.findIndex(t => t.id === txnId);
      if (txIdx >= 0) {
        const rawAmt = Math.abs(Number(currentReportTransactions[txIdx].amount || 0));
        const recovAmt = Number(currentReportTransactions[txIdx].recovery_amount || 0);
        currentReportTransactions[txIdx] = {
          ...currentReportTransactions[txIdx],
          shared_joy_amount: amount,
          effective_expense_amount: Math.max(0, rawAmt - recovAmt - amount),
          net_amount: Math.max(0, rawAmt - recovAmt - amount),
        };
        renderTransactionTable(currentReportTransactions);
      }
    } catch(err) {
      if (statusEl) { statusEl.textContent = err.message || "Error"; statusEl.classList.remove("hidden"); }
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save ✨"; }
    }
  }

  document.getElementById("sj-save-btn")?.addEventListener("click", async () => {
    const inp = document.getElementById("sj-amount-input");
    const amount = parseFloat(inp?.value || "0") || 0;
    if (amount < 0 || amount > maxAmount) {
      const statusEl = document.getElementById("sj-status");
      if (statusEl) { statusEl.textContent = `Amount must be between 0 and ${maxAmount}`; statusEl.classList.remove("hidden"); }
      return;
    }
    await _doSave(amount);
  });

  document.getElementById("sj-remove-btn")?.addEventListener("click", async () => {
    await _doSave(0);
  });

  // Position popover near the anchor
  const rect = anchorEl.getBoundingClientRect();
  const popW = 288;
  let left = rect.right + 8;
  if (left + popW > window.innerWidth) left = rect.left - popW - 8;
  let top = rect.top;
  if (top + 320 > window.innerHeight) top = window.innerHeight - 330;
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top  = `${Math.max(8, top)}px`;
  popover.classList.remove("hidden");
  document.getElementById("sj-amount-input")?.focus();
}

/* ── Group picker ─────────────────────────────────────────────────────────── */

let _openGroups = [];
let _bulkClassifyGroups = [];         // PATTERN + MERCHANT groups (drop targets)
let _groupFlagsCache = {};            // txnId -> { group_id, group_name, group_type, status, shared_joy_amount }
let _expandedEventGroups = new Set(); // group_ids currently expanded
let _collapseRerenderGuard = false;   // prevents flag-fetch ↔ re-render loops

async function _loadOpenGroups() {
  const res = await fetch("/groups/?status=OPEN").then(r => r.json()).catch(() => ({ data: [] }));
  _openGroups = res.data || [];
}

async function _loadBulkClassifyGroups() {
  const res = await fetch("/groups/?status=OPEN").then(r => r.json()).catch(() => ({ data: [] }));
  _bulkClassifyGroups = (res.data || []).filter(g => g.group_type === "PATTERN" || g.group_type === "MERCHANT");
  _renderDropStrip();
}

function _renderDropStrip() {
  const strip = document.getElementById("group-drop-strip");
  if (!strip) return;
  if (!_bulkClassifyGroups.length) { strip.classList.add("hidden"); return; }
  strip.classList.remove("hidden");
  const chips = _bulkClassifyGroups.map(g => `
    <button type="button" data-group-drop="${escapeHtml(g.id)}" data-group-name="${escapeHtml(g.name)}"
      class="group-drop-chip inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 hover:border-violet-400 transition select-none"
      title="Drop selected transactions onto: ${escapeHtml(g.name)}">
      <span class="material-symbols-outlined text-[13px] leading-none">category</span>
      ${escapeHtml(g.name)}
      ${g.link_count ? `<span class="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold">${g.link_count}</span>` : ""}
    </button>`).join("");
  strip.innerHTML = `
    <div class="mt-2 pt-2 border-t border-slate-100">
      <p class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Drop onto existing group</p>
      <div class="flex flex-wrap gap-2 items-center">
        ${chips}
        <button type="button" onclick="window.openMerchantGroupPanel()" class="inline-flex items-center gap-1 rounded-full border border-dashed border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-600 hover:bg-violet-50 transition" title="Create a new Bulk Classify group">
          <span class="material-symbols-outlined text-[13px] leading-none">add</span> new group
        </button>
      </div>
    </div>`;
  // Wire drag-and-drop handlers on each chip
  strip.querySelectorAll("[data-group-drop]").forEach(chip => {
    chip.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; chip.classList.add("ring-2", "ring-violet-500", "bg-violet-100"); });
    chip.addEventListener("dragleave", () => chip.classList.remove("ring-2", "ring-violet-500", "bg-violet-100"));
    chip.addEventListener("drop", e => {
      e.preventDefault();
      chip.classList.remove("ring-2", "ring-violet-500", "bg-violet-100");
      _runDropOnGroup(chip.dataset.groupDrop, chip.dataset.groupName);
    });
  });
}

async function _runDropOnGroup(groupId, groupName) {
  const ids = [...selectedTransactionIds];
  if (!ids.length) return;
  try {
    const res = await fetch(`/groups/${encodeURIComponent(groupId)}/extend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: ids }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      const msg = (data.detail || data.message || "Drop failed.");
      window.toast?.error(msg);
      return;
    }
    const d = data.data || {};
    const tagLabel = (d.tag_names || []).slice(0, 3).join(", ") || "—";
    const msg = `Added ${d.added || 0} to "${d.group_name || groupName}" · tagged ${tagLabel}`;
    window.toast?.success(msg);
    clearBulkSelection();
    await _loadBulkClassifyGroups();
    await submitSearch();
  } catch (e) {
    window.toast?.error("Drop failed.");
  }
}

// Fetch group membership for the given transactions and populate the cache.
// Called (awaited) before rendering so EVENT members collapse on first paint.
async function _fetchGroupFlags(txnIds) {
  const ids = (txnIds || []).map(String).filter(Boolean);
  if (!ids.length) return;
  const res = await fetch(`/groups/transaction-flags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }).then(r => r.json()).catch(() => ({ data: {} }));
  const flags = res.data || {};
  for (const [txnId, info] of Object.entries(flags)) _groupFlagsCache[txnId] = info;
}

// Called by merchant_group.js after a group is created/changed from this page,
// so newly-grouped EVENT transactions collapse immediately without a manual re-search.
window.refreshGroupCollapse = async function () {
  const ids = (currentReportTransactions || []).map((t) => t.id).filter(Boolean);
  await _fetchGroupFlags(ids);
  renderTransactionTable(getBreakdownTransactions());
};

// Paint the small inline badge for NON-EVENT group members (EVENT membership is
// shown via the collapsed parent row). Reads the cache only — no network.
function _paintGroupBadges() {
  // Color per group type — matches the Groups page visual language
  const _groupBadgeCls = {
    PATTERN:   "bg-cyan-50 text-cyan-600 ring-cyan-200 hover:bg-cyan-100",     // bulk classify → cyan
    PORTFOLIO: "bg-emerald-50 text-emerald-600 ring-emerald-200 hover:bg-emerald-100",
    EVENT:     "bg-violet-50 text-violet-600 ring-violet-200 hover:bg-violet-100",
  };
  document.querySelectorAll("[data-group-badge]").forEach((badge) => {
    const txnId = badge.getAttribute("data-group-badge");
    const info = _groupFlagsCache[txnId];
    if (info && info.group_type !== "EVENT") {
      const cls = _groupBadgeCls[info.group_type] || _groupBadgeCls.PATTERN;
      badge.innerHTML = `
        <a href="/groups.html" title="In group: ${escapeHtml(info.group_name)}"
           class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${cls}">
          <span class="material-symbols-outlined text-[9px]">group_work</span>${escapeHtml(info.group_name)}
        </a>`;
    }
  });
}

// Safety net for render paths that didn't pre-fetch flags (e.g. state restore):
// if visible rows have no cached membership yet, fetch once then re-render.
async function _refreshGroupBadges(txnIds) {
  const ids = (txnIds || []).map(String).filter(Boolean);
  if (!ids.length) return;
  const missing = ids.filter((id) => !(id in _groupFlagsCache));
  if (!missing.length) { _paintGroupBadges(); return; }
  if (_collapseRerenderGuard) { _paintGroupBadges(); return; }
  await _fetchGroupFlags(missing);
  _collapseRerenderGuard = true;
  try { renderTransactionTable(getBreakdownTransactions()); }
  finally { _collapseRerenderGuard = false; }
}

// Delegate clicks on add-to-group buttons
document.addEventListener("click", async e => {
  const btn = e.target.closest("[data-add-to-group-txn]");
  if (!btn) return;
  e.stopPropagation();
  await _loadOpenGroups();
  _openGroupPicker(btn.dataset.addToGroupTxn, parseFloat(btn.dataset.addToGroupAmt || 0), btn);
});

function _openGroupPicker(txnId, txnAmt, anchorEl) {
  let picker = document.getElementById("group-picker-popover");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "group-picker-popover";
    picker.className = "fixed z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 w-72";
    document.body.appendChild(picker);
  }

  const groupOpts = _openGroups.length
    ? _openGroups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("")
    : `<option value="">— no open groups —</option>`;

  picker.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <p class="text-xs font-black uppercase tracking-widest text-slate-500">Add to Group</p>
      <button id="gp-close" class="text-slate-400 hover:text-slate-700"><span class="material-symbols-outlined text-[16px]">close</span></button>
    </div>
    <div class="space-y-2">
      <select id="gp-group" class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:ring-violet-400 focus:border-violet-400">
        <option value="">— select group —</option>
        ${groupOpts}
      </select>
      <select id="gp-role" class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:ring-violet-400 focus:border-violet-400">
        <option value="EXPENSE">Expense — I paid this</option>
        <option value="REFUND">Refund — money returned to me</option>
        <option value="RECOVERY">Recovery — someone's share I received</option>
        <option value="SETTLEMENT">Settlement — final payback</option>
        <option value="CONTRIBUTION_OUT">Contribution Out — I paid my share</option>
        <option value="CONTRIBUTION_IN">Contribution In — member paid me</option>
        <option value="PAYOUT_IN">Payout Received — I got the pool</option>
      </select>
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-slate-500 shrink-0">Amount</label>
        <input id="gp-amount" type="number" step="0.01" value="${txnAmt.toFixed(2)}"
               class="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-violet-400 focus:border-violet-400" />
      </div>
      <div class="flex items-center gap-2">
        <label class="text-[10px] text-slate-500 shrink-0 w-14">Or new</label>
        <input id="gp-new-name" type="text" placeholder="New group name…"
               class="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-violet-400 focus:border-violet-400" />
      </div>
      <button id="gp-link-btn"
              class="w-full text-xs font-bold py-2 rounded-xl bg-violet-500 text-white hover:bg-violet-600">
        Link to Group
      </button>
    </div>`;

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top  = `${Math.min(rect.bottom + 6, window.innerHeight - 300)}px`;
  picker.style.left = `${Math.max(rect.left - 200, 8)}px`;
  picker.style.display = "block";

  document.getElementById("gp-close").onclick = () => { picker.style.display = "none"; };

  // Update role options when group selection changes
  const _GP_ROLES = {
    SPLIT:   [["EXPENSE","Expense — I paid this"],["RECOVERY","Recovery — their share I received"],["SETTLEMENT","Settlement"],["REFUND","Refund"]],
    RETURN:  [["EXPENSE","Expense — original purchase"],["REFUND","Refund — return credited back"],["SETTLEMENT","Settlement"]],
    CIRCLE:  [["CONTRIBUTION_OUT","Contribution Out — I paid my share"],["CONTRIBUTION_IN","Contribution In — member paid me"],["PAYOUT_IN","Payout Received — I got the pool"],["EXPENSE","Expense — other purchase"],["SETTLEMENT","Settlement"]],
    GENERAL: [["EXPENSE","Expense"],["REFUND","Refund"],["RECOVERY","Recovery"],["CONTRIBUTION_OUT","Contribution Out"],["CONTRIBUTION_IN","Contribution In"],["PAYOUT_IN","Payout Received"],["SETTLEMENT","Settlement"]],
  };
  document.getElementById("gp-group").addEventListener("change", () => {
    const gid  = document.getElementById("gp-group").value;
    const grp  = _openGroups.find(g => g.id === gid);
    const type = grp?.group_type || "GENERAL";
    const opts = _GP_ROLES[type] || _GP_ROLES.GENERAL;
    const sel  = document.getElementById("gp-role");
    sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    sel.value = opts[0][0];
  });

  document.getElementById("gp-link-btn").onclick = async () => {
    const newName = (document.getElementById("gp-new-name").value || "").trim();
    const role    = document.getElementById("gp-role").value;
    const amount  = parseFloat(document.getElementById("gp-amount").value) || txnAmt;
    let groupId   = document.getElementById("gp-group").value;

    if (newName) {
      const cres = await fetch("/groups/", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, group_type: "GENERAL" }) }).then(r => r.json());
      groupId = cres.data?.id;
    }
    if (!groupId) { window.toast?.error("Select or create a group first"); return; }

    await fetch(`/groups/${groupId}/links`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: txnId, role, attributed_amount: amount }) });

    picker.style.display = "none";
    _refreshGroupBadges([txnId]);
    await _loadOpenGroups();
  };

  // Close on outside click
  setTimeout(() => {
    const outsideClick = ev => {
      if (!picker.contains(ev.target) && ev.target !== anchorEl) {
        picker.style.display = "none";
        document.removeEventListener("click", outsideClick);
      }
    };
    document.addEventListener("click", outsideClick);
  }, 10);
}

/* ── Month navigator ──────────────────────────────────────────────────────── */
(function () {
  /* null = "All time" mode; otherwise a Date set to the 1st of the viewed month */
  let activeMonth = null;

  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

  function today() { return new Date(); }

  function labelFor(d) {
    if (!d) return "All time";
    const now = today();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
      return "This month";
    if (d.getFullYear() === now.getFullYear() - 1 ||
        (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())) {
      const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      if (diff === 1) return "Last month";
    }
    return `${MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`;
  }

  function applyMonth(d) {
    activeMonth = d;
    const labelEl = document.getElementById("month-nav-label");
    const nextBtn = document.getElementById("month-nav-next");
    if (labelEl) labelEl.textContent = labelFor(d);

    /* Disable next only when already on current month */
    if (nextBtn) {
      const now = today();
      const isCurrent = d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      nextBtn.disabled = isCurrent;  /* never disabled in All-time mode */
    }

    /* Set the hidden date inputs and fire search */
    const fromEl = document.getElementById("from_date");
    const toEl   = document.getElementById("to_date");
    if (!fromEl || !toEl) return;

    if (!d) {
      fromEl.value = "";
      toEl.value   = "";
    } else {
      /* first day of month */
      const y = d.getFullYear(), m = d.getMonth();
      const first = `${y}-${String(m+1).padStart(2,"0")}-01`;
      /* last day of month */
      const last  = new Date(y, m+1, 0);
      const lastStr = `${y}-${String(m+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;
      fromEl.value = first;
      toEl.value   = lastStr;
    }

    if (typeof submitSearch === "function") submitSearch();
  }

  function initMonthNav(hasRestoredState) {
    const prevBtn  = document.getElementById("month-nav-prev");
    const nextBtn  = document.getElementById("month-nav-next");
    const labelBtn = document.getElementById("month-nav-label");
    if (!prevBtn || !nextBtn || !labelBtn) return;

    if (hasRestoredState) {
      /* Restored saved dates — just sync the label to match, don't override */
      const fromEl = document.getElementById("from_date");
      const toEl   = document.getElementById("to_date");
      if (fromEl?.value) {
        const d = new Date(fromEl.value + "T00:00:00");
        activeMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        labelBtn.textContent = labelFor(activeMonth);
        const now = today();
        if (nextBtn) {
          const isCurrent = activeMonth.getFullYear() === now.getFullYear() && activeMonth.getMonth() === now.getMonth();
          nextBtn.disabled = isCurrent;
        }
      } else {
        labelBtn.textContent = "All time";
      }
    } else {
      /* No saved state — default to All time so all data is visible */
      applyMonth(null);
    }

    prevBtn.addEventListener("click", () => {
      const base = activeMonth || new Date(today().getFullYear(), today().getMonth(), 1);
      applyMonth(new Date(base.getFullYear(), base.getMonth() - 1, 1));
    });

    nextBtn.addEventListener("click", () => {
      if (!activeMonth) {
        /* from All-time, jump to current month */
        const now = today();
        applyMonth(new Date(now.getFullYear(), now.getMonth(), 1));
        return;
      }
      applyMonth(new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1));
    });

    /* Click label to toggle between all-time and current month */
    labelBtn.addEventListener("click", () => {
      if (activeMonth) applyMonth(null);
      else {
        const now = today();
        applyMonth(new Date(now.getFullYear(), now.getMonth(), 1));
      }
    });
  }

  window._initMonthNav = initMonthNav;
})();

/* ── Budget alert strip ───────────────────────────────────────────────────── */
async function loadBudgetAlerts() {
  const strip   = document.getElementById("budget-alert-strip");
  const chips   = document.getElementById("budget-alert-chips");
  const dismiss = document.getElementById("budget-alert-dismiss");
  if (!strip || !chips) return;

  if (sessionStorage.getItem("budget_alert_dismissed") === "1") return;

  try {
    const res  = await fetch("/planning/category-budgets");
    const data = (await res.json()).data || [];
    const alerts = data.filter(b => Number(b.usage_pct || 0) >= 80);
    if (!alerts.length) return;

    chips.innerHTML = alerts.map(b => {
      const pct    = Math.min(Math.round(Number(b.usage_pct || 0)), 999);
      const isOver = b.is_over || pct >= 100;
      const bg     = isOver ? "#fef2f2"  : "#fffbeb";
      const border = isOver ? "#fca5a5"  : "#fcd34d";
      const color  = isOver ? "#b91c1c"  : "#92400e";
      const barBg  = isOver ? "#ef4444"  : "#f59e0b";
      const barW   = Math.min(pct, 100);
      const spent  = Number(b.spent || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
      const budget = Number(b.budget_amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
      return `
        <a href="/budget.html" class="inline-flex shrink-0 flex-col rounded-lg px-3 py-1.5 transition hover:opacity-80"
           style="background:${bg};border:1px solid ${border};text-decoration:none;min-width:120px">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold truncate" style="color:${color}">${escapeHtml(b.tag_name)}</span>
            <span class="text-[10px] font-black shrink-0" style="color:${color}">${pct}%</span>
          </div>
          <div class="mt-1 h-1 w-full rounded-full" style="background:rgba(0,0,0,0.08)">
            <div class="h-full rounded-full" style="width:${barW}%;background:${barBg}"></div>
          </div>
          <span class="mt-0.5 text-[9px]" style="color:${color};opacity:0.75">₹${spent} / ₹${budget}</span>
        </a>`;
    }).join("");

    strip.classList.remove("hidden");

    dismiss?.addEventListener("click", () => {
      strip.classList.add("hidden");
      sessionStorage.setItem("budget_alert_dismissed", "1");
    });
  } catch { /* silently ignore */ }
}

/* ── Quick-tag: compact "+tag" button → small popover picker ──────────────── */
async function _applyQuickTag(txId, tagName) {
  const tx = (currentReportTransactions || []).find(t => String(t.id) === String(txId));
  const currentTags = tx ? normalizeTags(tx.tags) : [];
  if (currentTags.includes(tagName)) return;
  // Auto-include ancestor tags (parent subcategory / category).
  const ancestors = getTagAncestors(tagName).filter(a => !currentTags.includes(a) && a !== tagName);
  const allNewTags = [...currentTags, tagName, ...ancestors];
  try {
    const res = await fetch("/reports/transaction_update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: txId, transaction_id: txId, tags: allNewTags }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Failed");
    if (tx) tx.tags = allNewTags;
    if (window.toast) window.toast.success(`Tagged: ${tagName}`);
    if (typeof loadPlanningSummary === "function") loadPlanningSummary();
    renderTransactionTable(getBreakdownTransactions());
  } catch (err) {
    if (window.toast) window.toast.error(err.message || "Could not tag");
    else console.warn("Quick tag failed:", err);
  }
}

document.addEventListener("click", function (e) {
  const btn = e.target.closest("[data-quick-tag-btn]");
  if (!btn) return;
  e.stopPropagation();
  _openQuickTagPopover(btn.dataset.quickTagBtn, btn);
});

function _openQuickTagPopover(txId, anchorEl) {
  const isDark = document.documentElement.classList.contains("dark");
  let pop = document.getElementById("quick-tag-popover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "quick-tag-popover";
    document.body.appendChild(pop);
    document.addEventListener("click", (ev) => {
      if (!pop.contains(ev.target) && !ev.target.closest("[data-quick-tag-btn]")) pop.classList.add("hidden");
    }, true);
  }
  pop.className = "fixed z-50 w-60 rounded-2xl shadow-2xl p-2";
  pop.style.cssText = isDark
    ? "background:#1e293b;border:1px solid #334155;color:#e2e8f0"
    : "background:#ffffff;border:1px solid #e2e8f0;color:#0f172a";

  const tx = (currentReportTransactions || []).find(t => String(t.id) === String(txId));
  const current = tx ? normalizeTags(tx.tags) : [];
  const options = (availableManagedTags || []).filter(t => !current.includes(t));
  const inputStyle = isDark
    ? "width:100%;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;padding:6px 10px;font-size:13px;outline:none;box-sizing:border-box"
    : "width:100%;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e293b;padding:6px 10px;font-size:13px;outline:none;box-sizing:border-box";

  pop.innerHTML = `
    <input id="qt-search" type="text" placeholder="Search tags…" autocomplete="off" style="${inputStyle}" />
    <div id="qt-list" style="max-height:200px;overflow-y:auto;margin-top:6px"></div>`;

  function renderList(q) {
    const list = document.getElementById("qt-list");
    const ql = (q || "").trim().toLowerCase();
    const filtered = options.filter(t => !ql || t.toLowerCase().includes(ql)).slice(0, 60);
    if (!filtered.length) { list.innerHTML = `<p style="padding:8px 10px;font-size:12px;color:#94a3b8">No tags found</p>`; return; }
    const hov = isDark ? "#334155" : "#eef2ff";
    list.innerHTML = filtered.map(t =>
      `<div data-qt="${escapeHtml(t)}" style="cursor:pointer;padding:6px 10px;border-radius:8px;font-size:13px" onmouseover="this.style.background='${hov}'" onmouseout="this.style.background='transparent'">${escapeHtml(t)}</div>`
    ).join("");
    list.querySelectorAll("[data-qt]").forEach(el => el.addEventListener("click", () => {
      pop.classList.add("hidden");
      _applyQuickTag(txId, el.dataset.qt);
    }));
  }
  renderList("");

  const rect = anchorEl.getBoundingClientRect();
  pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 270)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left - 110, window.innerWidth - 248))}px`;
  pop.classList.remove("hidden");
  const search = document.getElementById("qt-search");
  search.addEventListener("input", () => renderList(search.value));
  setTimeout(() => search.focus(), 30);
}

/* ── Saved filter presets ── */
const PRESETS_KEY = "REPORT_FILTER_PRESETS";

function getPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]"); } catch { return []; }
}

function saveFilterPreset(name) {
  if (!name.trim()) return;
  const filters = {
    from_date: document.getElementById("from_date")?.value || "",
    to_date:   document.getElementById("to_date")?.value || "",
    vendor_filter: document.getElementById("vendor_filter")?.value || "",
    report_type:   document.getElementById("report_type")?.value || "",
    source:    document.getElementById("breakdown_source_filter")?.value || "",
    direction: document.getElementById("breakdown_direction_filter")?.value || "",
    tag_state: document.getElementById("breakdown_tag_filter")?.value || "",
  };
  const presets = getPresets().filter(p => p.name !== name.trim());
  presets.unshift({ name: name.trim(), filters });
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.slice(0, 20)));
  renderPresetsList();
}

function loadFilterPreset(filters) {
  // Set value + fire `change` so the existing per-field listeners run.
  // Without the change event, the client-side breakdownViewState object stayed
  // stuck on whatever the user had typed manually before re-clicking the preset.
  const setAndFire = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val || "";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  setAndFire("from_date",                   filters.from_date);
  setAndFire("to_date",                     filters.to_date);
  setAndFire("vendor_filter",               filters.vendor_filter);
  setAndFire("report_type",                 filters.report_type);
  setAndFire("breakdown_source_filter",     filters.source);
  setAndFire("breakdown_direction_filter",  filters.direction);
  setAndFire("breakdown_tag_filter",        filters.tag_state);
  document.getElementById("presets-dropdown")?.classList.add("hidden");
  submitSearch();
}

function deleteFilterPreset(name) {
  const presets = getPresets().filter(p => p.name !== name);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  renderPresetsList();
}

function renderPresetsList() {
  const container = document.getElementById("presets-list");
  if (!container) return;
  const presets = getPresets();
  if (!presets.length) {
    container.innerHTML = `<p class="px-3 py-2 text-[11px] text-slate-400">No presets saved yet.</p>`;
    return;
  }
  container.innerHTML = presets.map(p => `
    <div class="flex items-center justify-between px-3 py-1.5 hover:bg-slate-50 group">
      <button data-load-preset="${escapeHtml(p.name)}" class="text-xs text-slate-700 truncate text-left flex-1">${escapeHtml(p.name)}</button>
      <button data-delete-preset="${escapeHtml(p.name)}" class="ml-2 text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100">
        <span class="material-symbols-outlined text-[14px]">delete</span>
      </button>
    </div>`).join("");
}

/* ── Counterparty profile panel ── */
function openCpPanel(name) {
  const panel = document.getElementById("cp-panel");
  const title = document.getElementById("cp-panel-title");
  const body  = document.getElementById("cp-panel-body");
  if (!panel || !title || !body) return;
  title.textContent = name;
  body.innerHTML = `<div class="flex justify-center py-8"><span class="material-symbols-outlined animate-spin text-slate-300 text-4xl">progress_activity</span></div>`;
  // Re-trigger slide animation each time
  panel.classList.remove("hidden");
  panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = "";

  fetch("/reports/transactions_filter", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ vendor_filter: name }),
  }).then(r => r.json()).then(result => {
    const txs = result.transactions || result.data || [];
    if (!txs.length) { body.innerHTML = `<p class="text-slate-400 text-xs">No transactions found.</p>`; return; }
    const debits  = txs.filter(t => t.direction === "withdrawal");
    const credits = txs.filter(t => t.direction === "credit");
    const totalSpend = debits.reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);
    const totalIn    = credits.reduce((s, t) => s + Math.abs(parseFloat(t.amount || 0)), 0);
    const lastDate   = txs.reduce((m, t) => (t.date > m ? t.date : m), "");
    const tags = [...new Set(txs.flatMap(t => (t.tags || []).map(g => g.name || g)).filter(Boolean))];
    const recent = txs.slice(0, 10);
    body.innerHTML = `
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg bg-rose-50 p-3">
          <div class="text-[10px] font-bold uppercase text-rose-400 tracking-wide">Total Spend</div>
          <div class="mt-0.5 text-lg font-black text-rose-700">₹${totalSpend.toLocaleString("en-IN", {maximumFractionDigits:0})}</div>
          <div class="text-[10px] text-rose-400">${debits.length} debit txns</div>
        </div>
        <div class="rounded-lg bg-emerald-50 p-3">
          <div class="text-[10px] font-bold uppercase text-emerald-400 tracking-wide">Total In</div>
          <div class="mt-0.5 text-lg font-black text-emerald-700">₹${totalIn.toLocaleString("en-IN", {maximumFractionDigits:0})}</div>
          <div class="text-[10px] text-emerald-400">${credits.length} credit txns</div>
        </div>
      </div>
      ${tags.length ? `<div class="flex flex-wrap gap-1">${tags.map(t=>`<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <div class="text-[10px] text-slate-400">Last seen: ${lastDate || "—"}</div>
      <div class="space-y-1.5">
        <div class="text-[10px] font-bold uppercase text-slate-400 tracking-wide">Recent transactions</div>
        ${recent.map(t => `
          <div class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <div>
              <div class="text-xs font-medium text-slate-700">${escapeHtml(t.narration || t.vendor_name || "")}</div>
              <div class="text-[10px] text-slate-400">${t.date || ""}</div>
            </div>
            <div class="text-xs font-bold ${t.direction==='credit'?'text-emerald-600':'text-rose-600'}">
              ${t.direction==='credit'?'+':'−'}₹${Math.abs(parseFloat(t.amount||0)).toLocaleString("en-IN",{maximumFractionDigits:0})}
            </div>
          </div>`).join("")}
      </div>`;
  }).catch(() => { body.innerHTML = `<p class="text-slate-400 text-xs">Failed to load data.</p>`; });
}

function closeCpPanel() {
  document.getElementById("cp-panel")?.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
  loadManagedTags();
  loadBudgetAlerts();
  loadPlanningSummary();
  renderPresetsList();
  _loadBulkClassifyGroups();

  /* Clear all filters button */
  function clearAllFilters() {
    sessionStorage.removeItem(REPORT_PAGE_STATE_KEY);

    const inputIds = ["from_date","to_date","vendor_filter","amount_filter","tag_filter",
                      "breakdown_source_filter","breakdown_direction_filter","breakdown_tag_filter",
                      "breakdown_month_filter","breakdown_ownership_filter","breakdown_settlement_filter",
                      "breakdown_obligation_filter","breakdown_completion_filter"];
    inputIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const cbIds = ["breakdown_show_hidden"];
    cbIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });

    breakdownViewState = { month: "", sourceGroup: "", direction: "", tagState: "", reviewState: "",
                           ownershipGroup: "", settlementGroup: "", completionState: "",
                           dateSort: "date_desc", amountSort: "", showHidden: false };

    /* Hide error message */
    const errEl = document.getElementById("errorMessage");
    if (errEl) { errEl.textContent = ""; errEl.classList.add("hidden"); }

    /* Reset month navigator */
    const labelEl = document.getElementById("month-nav-label");
    if (labelEl) labelEl.textContent = "All time";
    const nextBtn = document.getElementById("month-nav-next");
    if (nextBtn) nextBtn.disabled = false;

    updateActiveFilterChips();
    submitSearch();
  }
  document.getElementById("clear-all-filters-btn")?.addEventListener("click", clearAllFilters);

  /* Active filter chips — show what's currently active */
  function updateActiveFilterChips() {
    const bar   = document.getElementById("active-filter-chips");
    const chips = document.getElementById("filter-chip-list");
    if (!bar || !chips) return;

    const labels = [];
    const fromV = document.getElementById("from_date")?.value;
    const toV   = document.getElementById("to_date")?.value;
    if (fromV || toV) labels.push({ label: fromV && toV ? `${fromV} – ${toV}` : fromV || toV, id: "date" });

    const srcV = document.getElementById("breakdown_source_filter")?.value;
    if (srcV) labels.push({ label: `Source: ${srcV}`, id: "source" });

    const dirV = document.getElementById("breakdown_direction_filter")?.value;
    if (dirV) labels.push({ label: dirV === "withdrawal" ? "Debit only" : "Credit only", id: "dir" });

    const tagStateV = document.getElementById("breakdown_tag_filter")?.value;
    if (tagStateV) labels.push({ label: tagStateV === "untagged" ? "Untagged only" : "Tagged only", id: "tagstate" });

    const vendorV = document.getElementById("vendor_filter")?.value?.trim();
    if (vendorV) labels.push({ label: `"${vendorV}"`, id: "vendor" });

    const tagV = document.getElementById("tag_filter")?.value?.trim();
    if (tagV) labels.push({ label: `Tag: ${tagV}`, id: "tag" });

    const amtV = document.getElementById("amount_filter")?.value;
    if (amtV) labels.push({ label: `₹${amtV}`, id: "amt" });

    const monthV = document.getElementById("breakdown_month_filter")?.value;
    if (monthV) labels.push({ label: `Month: ${monthV}`, id: "month" });

    if (!labels.length) {
      bar.classList.add("hidden");
    } else {
      bar.classList.remove("hidden");
      chips.innerHTML = labels.map(l =>
        `<span class="inline-flex items-center gap-1 rounded-full border border-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary" style="background:rgba(96,122,251,0.08)">
          ${escapeHtml(l.label)}
          <button type="button" onclick="removeFilterChip('${l.id}')"
            class="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-primary/60 hover:bg-primary/20 hover:text-primary transition"
            aria-label="Remove filter"><span style="font-size:10px;line-height:1">×</span></button>
        </span>`
      ).join("");
    }

    /* Update "More" button badge with count of active advanced filters */
    const advancedFields = [
      "tag_filter", "amount_filter", "breakdown_month_filter",
      "breakdown_ownership_filter", "breakdown_settlement_filter", "breakdown_obligation_filter"
    ];
    let advCount = advancedFields.filter(id => {
      const el = document.getElementById(id);
      return el && el.value && el.value.trim() !== "";
    }).length;
    const hiddenCb = document.getElementById("breakdown_show_hidden");
    if (hiddenCb && hiddenCb.checked) advCount++;
    const advBadge = document.getElementById("advanced-badge");
    if (advBadge) {
      if (advCount > 0) {
        advBadge.textContent = advCount;
        advBadge.classList.remove("hidden");
        advBadge.classList.add("inline-flex");
      } else {
        advBadge.classList.add("hidden");
        advBadge.classList.remove("inline-flex");
      }
    }
  }

  /* Filter chip individual remove helper */
  window.removeFilterChip = function(id) {
    const map = {
      date:     () => { ["from_date","to_date"].forEach(f => { const el = document.getElementById(f); if (el) el.value = ""; }); },
      source:   () => { const el = document.getElementById("breakdown_source_filter"); if (el) el.value = ""; breakdownViewState.sourceGroup = ""; },
      dir:      () => { const el = document.getElementById("breakdown_direction_filter"); if (el) el.value = ""; breakdownViewState.direction = ""; },
      tagstate: () => { const el = document.getElementById("breakdown_tag_filter"); if (el) el.value = ""; breakdownViewState.tagState = ""; },
      vendor:   () => { const el = document.getElementById("vendor_filter"); if (el) el.value = ""; },
      tag:      () => { const el = document.getElementById("tag_filter"); if (el) el.value = ""; },
      amt:      () => { const el = document.getElementById("amount_filter"); if (el) el.value = ""; },
      month:    () => { const el = document.getElementById("breakdown_month_filter"); if (el) el.value = ""; breakdownViewState.month = ""; },
    };
    if (map[id]) { map[id](); updateActiveFilterChips(); submitSearch(); }
  };

  /* Update chips whenever filters change */
  ["from_date","to_date","vendor_filter","amount_filter","tag_filter",
   "breakdown_source_filter","breakdown_direction_filter","breakdown_tag_filter",
   "breakdown_month_filter"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", updateActiveFilterChips);
    document.getElementById(id)?.addEventListener("input", updateActiveFilterChips);
  });
  /* Advanced-filter selects that update breakdownViewState but previously didn't fire updateActiveFilterChips */
  ["breakdown_ownership_filter","breakdown_settlement_filter",
   "breakdown_obligation_filter"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", updateActiveFilterChips);
  });
  document.getElementById("breakdown_show_hidden")
    ?.addEventListener("change", updateActiveFilterChips);
  applyInitialReportViewFromUrl();
  updateBreakdownSummary([]);
  const restored = restoreReportPageState();
  const shouldForceRefresh = consumeReportForceRefreshFlag();
  // If URL params supply filters, treat as "restored" so _initMonthNav skips applyMonth(null)
  // (which would clear from_date/to_date before our URL-param code sets them)
  const _hasUrlFilter = new URLSearchParams(window.location.search).has("tag")
    || new URLSearchParams(window.location.search).has("from_date")
    || new URLSearchParams(window.location.search).has("to_date");
  window._initMonthNav(restored || _hasUrlFilter);

  const reportTypeEl = document.getElementById("report_type");
  if (reportTypeEl) {
    reportTypeEl.addEventListener("change", function () {
      renderAmountChart(currentReportTransactions);
    });
  }

  const breakdownMonthEl = document.getElementById("breakdown_month_filter");
  if (breakdownMonthEl) {
    breakdownMonthEl.value = breakdownViewState.month || "";
  }
  if (breakdownMonthEl) {
    breakdownMonthEl.addEventListener("change", function () {
      breakdownViewState.month = breakdownMonthEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownDirectionEl = document.getElementById("breakdown_direction_filter");
  if (breakdownDirectionEl) {
    breakdownDirectionEl.value = breakdownViewState.direction || "";
  }
  if (breakdownDirectionEl) {
    breakdownDirectionEl.addEventListener("change", function () {
      breakdownViewState.direction = breakdownDirectionEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownSourceEl = document.getElementById("breakdown_source_filter");
  if (breakdownSourceEl) {
    breakdownSourceEl.value = breakdownViewState.sourceGroup || "";
  }
  if (breakdownSourceEl) {
    breakdownSourceEl.addEventListener("change", function () {
      breakdownViewState.sourceGroup = breakdownSourceEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownTagEl = document.getElementById("breakdown_tag_filter");
  if (breakdownTagEl) {
    breakdownTagEl.value = breakdownViewState.tagState || "";
  }
  if (breakdownTagEl) {
    breakdownTagEl.addEventListener("change", function () {
      breakdownViewState.tagState = breakdownTagEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownOwnershipEl = document.getElementById("breakdown_ownership_filter");
  if (breakdownOwnershipEl) {
    breakdownOwnershipEl.value = breakdownViewState.ownershipGroup || "";
  }
  if (breakdownOwnershipEl) {
    breakdownOwnershipEl.addEventListener("change", function () {
      breakdownViewState.ownershipGroup = breakdownOwnershipEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownSettlementEl = document.getElementById("breakdown_settlement_filter");
  if (breakdownSettlementEl) {
    breakdownSettlementEl.value = breakdownViewState.settlementGroup || "";
  }
  if (breakdownSettlementEl) {
    breakdownSettlementEl.addEventListener("change", function () {
      breakdownViewState.settlementGroup = breakdownSettlementEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownObligationEl = document.getElementById("breakdown_obligation_filter");
  if (breakdownObligationEl) {
    breakdownObligationEl.value = breakdownViewState.obligationFocus || "";
  }
  if (breakdownObligationEl) {
    breakdownObligationEl.addEventListener("change", function () {
      applyObligationFocus(breakdownObligationEl.value);
    });
  }

  const breakdownCompletionEl = document.getElementById("breakdown_completion_filter");
  if (breakdownCompletionEl) {
    breakdownCompletionEl.value = breakdownViewState.completionState || "";
  }
  if (breakdownCompletionEl) {
    breakdownCompletionEl.addEventListener("change", function () {
      breakdownViewState.completionState = breakdownCompletionEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownDateSortEl = document.getElementById("breakdown_date_sort");
  if (breakdownDateSortEl) {
    breakdownDateSortEl.value = breakdownViewState.dateSort || "date_desc";
  }
  if (breakdownDateSortEl) {
    breakdownDateSortEl.addEventListener("change", function () {
      breakdownViewState.dateSort = breakdownDateSortEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownAmountSortEl = document.getElementById("breakdown_amount_sort");
  if (breakdownAmountSortEl) {
    breakdownAmountSortEl.value = breakdownViewState.amountSort || "";
  }
  if (breakdownAmountSortEl) {
    breakdownAmountSortEl.addEventListener("change", function () {
      breakdownViewState.amountSort = breakdownAmountSortEl.value;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const breakdownShowHiddenEl = document.getElementById("breakdown_show_hidden");
  if (breakdownShowHiddenEl) {
    breakdownShowHiddenEl.checked = Boolean(breakdownViewState.showHidden);
  }
  if (breakdownShowHiddenEl) {
    breakdownShowHiddenEl.addEventListener("change", function () {
      breakdownViewState.showHidden = breakdownShowHiddenEl.checked;
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    });
  }

  const spendGroupEl = document.getElementById("spend-chart-group");
  if (spendGroupEl) {
    spendGroupEl.value = spendChartState.groupBy;
    spendGroupEl.addEventListener("change", function () {
      spendChartState.groupBy = spendGroupEl.value || "category";
      renderSpendPieChart(currentReportTransactions);
    });
  }

  const spendLimitEl = document.getElementById("spend-chart-limit");
  if (spendLimitEl) {
    spendLimitEl.value = String(spendChartState.limit);
    spendLimitEl.addEventListener("change", function () {
      spendChartState.limit = Number(spendLimitEl.value || 8);
      renderSpendPieChart(currentReportTransactions);
    });
  }

  const includeUntaggedEl = document.getElementById("spend-chart-include-untagged");
  if (includeUntaggedEl) {
    includeUntaggedEl.checked = Boolean(spendChartState.includeUntagged);
    includeUntaggedEl.addEventListener("change", function () {
      spendChartState.includeUntagged = includeUntaggedEl.checked;
      renderSpendPieChart(currentReportTransactions);
    });
  }

  document.getElementById("spend-pie-legend")?.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-spend-filter]");
    if (!trigger) return;
    applySpendFilter(trigger.dataset.spendFilter || "");
  });

  document.getElementById("spend-next-action")?.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-spend-action]");
    if (!trigger) return;
    if (trigger.dataset.spendAction === "review-untagged") {
      applySpendFilter("Uncategorized");
    }
  });

  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-obligation-focus]");
    if (!trigger) return;
    applyObligationFocus(trigger.dataset.obligationFocus || "");
  });

  // Quick-filter chips (#1 Needs review, #2 Untagged) — client-side view toggles.
  document.addEventListener("click", function (event) {
    const qf = event.target.closest("[data-quick-filter]");
    if (qf) {
      const kind = qf.dataset.quickFilter;
      if (kind === "needs_review") {
        breakdownViewState.reviewState = breakdownViewState.reviewState === "needs_review" ? "" : "needs_review";
      } else if (kind === "untagged") {
        breakdownViewState.tagState = breakdownViewState.tagState === "untagged" ? "" : "untagged";
        const sel = document.getElementById("breakdown_tag_filter");
        if (sel) sel.value = breakdownViewState.tagState;
      }
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
      return;
    }
    const jump = event.target.closest("[data-jump-untagged]");
    if (jump) {
      breakdownViewState.tagState = "untagged";
      const sel = document.getElementById("breakdown_tag_filter");
      if (sel) sel.value = "untagged";
      renderTransactionTable(getBreakdownTransactions());
      persistReportPageState();
    }
  });

  // +N tag chip (#3) — reveal the hidden tags inline, no layout jump elsewhere.
  document.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-expand-tags]");
    if (!btn) return;
    let hidden = [];
    try { hidden = JSON.parse(btn.dataset.hiddenJson || "[]"); } catch { hidden = []; }
    const cls = btn.dataset.tagCls || "bg-sky-50 text-sky-700 ring-sky-100";
    const html = hidden.map((t) =>
      `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${cls}">${escapeHtml(t)}</span>`
    ).join("");
    btn.insertAdjacentHTML("beforebegin", html);
    btn.remove();
  });

  // Bulk row actions (#4) — confirm / no-tag / set flow type on the current selection.
  async function _runBulkAction(action, value, idsOverride) {
    const ids = idsOverride || [...selectedTransactionIds];
    if (!ids.length) return;
    if (action === "no_tag" &&
        !confirm(`Clear tags and mark ${ids.length} transaction${ids.length === 1 ? "" : "s"} as "no tag needed"?`)) return;
    try {
      const res = await fetch("/reports/bulk_update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_ids: ids, action, value: value || null }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) { window.toast?.error(data.message || "Bulk action failed."); return; }
      if (!idsOverride) clearBulkSelection();
      await submitSearch();
    } catch (e) { window.toast?.error("Bulk action failed."); }
  }
  document.getElementById("bulk-tag-toolbar")?.addEventListener("click", function (event) {
    const btn = event.target.closest('button[data-bulk-action]');
    if (!btn) return;
    _runBulkAction(btn.dataset.bulkAction);
  });
  document.querySelector('select[data-bulk-action="flow_type"]')?.addEventListener("change", function (event) {
    const val = event.target.value;
    event.target.value = "";
    if (val) _runBulkAction("flow_type", val);
  });

  // Quick date presets (#11) — set the date range and re-run the search.
  function _applyDatePreset(preset) {
    const today = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let from = "", to = fmt(today);
    if (preset === "this_month") {
      from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
      to = fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    } else if (preset === "last_month") {
      from = fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      to = fmt(new Date(today.getFullYear(), today.getMonth(), 0));
    } else if (preset === "30d") {
      const f = new Date(today); f.setDate(f.getDate() - 29); from = fmt(f);
    } else if (preset === "3m") {
      const f = new Date(today); f.setMonth(f.getMonth() - 3); from = fmt(f);
    } else if (preset === "6m") {
      const f = new Date(today); f.setMonth(f.getMonth() - 6); from = fmt(f);
    } else if (preset === "all_time") {
      from = "";
      to = "";
    } else if (preset === "this_week") {
      const f = new Date(today); const dow = (f.getDay() + 6) % 7; f.setDate(f.getDate() - dow); from = fmt(f);
    }
    const fromEl = document.getElementById("from_date");
    const toEl = document.getElementById("to_date");
    if (fromEl) fromEl.value = from;
    if (toEl) toEl.value = to;
    submitSearch();
  }
  document.querySelectorAll("[data-date-preset]").forEach((btn) => {
    btn.addEventListener("click", () => _applyDatePreset(btn.dataset.datePreset));
  });

  // Keyboard review (#10): j/k move, x select, t tag, e edit/classify, c confirm.
  let _kbRow = -1;
  const _kbRows = () => [...document.querySelectorAll('#transactions_table_body tr[data-transaction-id]')];
  function _kbHighlight(idx) {
    const rows = _kbRows();
    rows.forEach((r) => r.classList.remove("ring-2", "ring-primary", "bg-primary/5"));
    if (idx < 0 || idx >= rows.length) { _kbRow = -1; return; }
    _kbRow = idx;
    rows[idx].classList.add("ring-2", "ring-primary", "bg-primary/5");
    rows[idx].scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("keydown", function (event) {
    const t = (event.target.tagName || "").toLowerCase();
    if (t === "input" || t === "textarea" || t === "select" || event.target.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = _kbRows();
    if (!rows.length) return;
    if (event.key === "j") { event.preventDefault(); _kbHighlight(Math.min((_kbRow < 0 ? -1 : _kbRow) + 1, rows.length - 1)); return; }
    if (event.key === "k") { event.preventDefault(); _kbHighlight(Math.max((_kbRow < 0 ? 1 : _kbRow) - 1, 0)); return; }
    if (_kbRow < 0 || _kbRow >= rows.length) return;
    const row = rows[_kbRow];
    const id = row.dataset.transactionId;
    if (event.key === "t") { event.preventDefault(); row.querySelector("[data-quick-tag-btn]")?.click(); }
    else if (event.key === "e") { event.preventDefault(); row.querySelector('a[href*="/classification/transaction/"]')?.click(); }
    else if (event.key === "c") { event.preventDefault(); _runBulkAction("confirm", null, [id]); }
    else if (event.key === "x") {
      event.preventDefault();
      const cb = row.querySelector("[data-bulk-select-transaction]");
      if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    }
  });

  document.getElementById("select-all-transactions")?.addEventListener("change", function (event) {
    const checked = Boolean(event.target.checked);
    getDisplayedTransactionIds().forEach((id) => {
      if (checked) {
        selectedTransactionIds.add(id);
      } else {
        selectedTransactionIds.delete(id);
      }
    });
    document.querySelectorAll("[data-bulk-select-transaction]").forEach((input) => {
      input.checked = checked;
    });
    clearBulkTagMessage();
    updateBulkTagToolbar();
  });

  document.getElementById("transactions_table_body")?.addEventListener("change", function (event) {
    const checkbox = event.target.closest("[data-bulk-select-transaction]");
    if (!checkbox) return;
    const transactionId = String(checkbox.dataset.transactionId || "").trim();
    if (!transactionId) return;
    if (checkbox.checked) {
      selectedTransactionIds.add(transactionId);
    } else {
      selectedTransactionIds.delete(transactionId);
    }
    clearBulkTagMessage();
    updateBulkTagToolbar();
  });

  document.getElementById("bulk-clear-selection")?.addEventListener("click", function () {
    clearBulkSelection();
  });

  // Pre-filter from external links e.g. /reports/?tag=Food&from_date=...&to_date=...
  // Also supports ?direction=withdrawal|deposit, ?source=<name>, ?vendor=<text>
  // so Analytics drill-throughs can land on a pre-filtered Reports view.
  const _urlP         = new URLSearchParams(window.location.search);
  const _urlTag       = _urlP.get("tag");
  const _urlFromDate  = _urlP.get("from_date");
  const _urlToDate    = _urlP.get("to_date");
  const _urlDirection = _urlP.get("direction");
  const _urlSource    = _urlP.get("source");
  const _urlVendor    = _urlP.get("vendor");
  if (_urlTag || _urlFromDate || _urlToDate || _urlDirection || _urlSource || _urlVendor) {
    if (_urlTag)       { const el = document.getElementById("tag_filter");                 if (el) el.value = _urlTag; }
    if (_urlFromDate)  { const el = document.getElementById("from_date");                  if (el) el.value = _urlFromDate; }
    if (_urlToDate)    { const el = document.getElementById("to_date");                    if (el) el.value = _urlToDate; }
    if (_urlDirection) { const el = document.getElementById("breakdown_direction_filter"); if (el) el.value = _urlDirection; breakdownViewState.direction = _urlDirection; }
    if (_urlSource)    { const el = document.getElementById("breakdown_source_filter");    if (el) el.value = _urlSource;    breakdownViewState.sourceGroup = _urlSource; }
    if (_urlVendor)    { const el = document.getElementById("vendor_filter");              if (el) el.value = _urlVendor; }
    // Sync month-nav label to reflect the URL-supplied date range
    (function syncNavLabel() {
      const labelEl = document.getElementById("month-nav-label");
      if (!labelEl || !_urlFromDate || !_urlToDate) return;
      const d = new Date(_urlFromDate + "T00:00:00");
      const y = d.getFullYear(), m = d.getMonth();
      const first = `${y}-${String(m+1).padStart(2,"0")}-01`;
      const last  = new Date(y, m+1, 0);
      const lastS = `${y}-${String(m+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;
      labelEl.textContent = (_urlFromDate === first && _urlToDate === lastS)
        ? d.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "Custom";
    })();
    updateActiveFilterChips();
    await submitSearch();
  } else if (restored || shouldForceRefresh) {
    await submitSearch();
    restoreReportScrollPosition();
    restoreFocusedTransactionRow();
  }

  /* ── Presets dropdown ── */
  document.getElementById("presets-btn")?.addEventListener("click", e => {
    e.stopPropagation();
    document.getElementById("presets-dropdown")?.classList.toggle("hidden");
  });
  document.addEventListener("click", e => {
    if (!e.target.closest("#presets-btn") && !e.target.closest("#presets-dropdown")) {
      document.getElementById("presets-dropdown")?.classList.add("hidden");
    }
    const loadBtn = e.target.closest("[data-load-preset]");
    if (loadBtn) {
      const name = loadBtn.dataset.loadPreset;
      const preset = getPresets().find(p => p.name === name);
      if (preset) loadFilterPreset(preset.filters);
    }
    const delBtn = e.target.closest("[data-delete-preset]");
    if (delBtn) { e.stopPropagation(); deleteFilterPreset(delBtn.dataset.deletePreset); }
  }, true);
  document.getElementById("preset-save-btn")?.addEventListener("click", () => {
    const name = document.getElementById("preset-name-input")?.value.trim();
    if (!name) return;
    saveFilterPreset(name);
    const inp = document.getElementById("preset-name-input");
    if (inp) inp.value = "";
  });

  /* ── Counterparty profile panel ── */
  document.getElementById("cp-panel-close")?.addEventListener("click", closeCpPanel);
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-cp-name]");
    if (btn) { e.stopPropagation(); openCpPanel(btn.dataset.cpName); }
  });

  document.addEventListener("click", function (e) {
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;


    const action = actionBtn.dataset.action;
    const txnId = actionBtn.dataset.txnId;

    if (action === "modify-tags-modal") {
      handleModifyClick(txnId);
      return;
    }

    if (action === "split-transaction-modal") {
      handleSplitClick(txnId);
      return;
    }
  });

  async function handleModifyClick(txnId) {
    const selectedTx = (currentReportTransactions || []).find((tx) => String(tx.id) === String(txnId));
    if (isSettlementTransaction(selectedTx)) {
      return;
    }
    openModal();
    showLoading();

    try {
      const response = await fetch(`/reports/transaction_details/${txnId}`, {
        method: "GET",
      });
      const data = await response.json();
      const res = {
        ok: true,
        transaction_date: data.transaction_date,
        amount: data.amount,
        counterparty_identifier: data.counterparty_identifier,
        direction: data.direction,
        transaction_time: data.transaction_time,
        narration: data.narration,
        vendor_name: data.vendor_name,
        payment_source_name: data.payment_source_name,
        statement_sources: data.statement_sources,
        no_tag_required: Boolean(data.no_tag_required),
        no_split_required: Boolean(data.no_split_required),
        vendor: data.name,
        tag_names: data.tag_names,
        id: txnId,
        counterparty_count: data.counterparty_count,
      };
      if (!res.ok) throw new Error("API failed");
      populateModal(res);
    } catch (err) {
      // showError();
      console.error(err);
    }
  }

  function openModal() {
    document.getElementById("modify-tags-modal").classList.remove("hidden");
  }

  function showLoading() {
    const loading = document.getElementById("modal-loading");
    const content = document.getElementById("modal-content");
    if (!loading || !content) return;

    loading.classList.remove("hidden");
    content.classList.add("hidden");
  }

  function createTagElement(value) {
    const tag = document.createElement("span");

    tag.className =
      "tag-item flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white";
    tag.dataset.value = value;

    tag.innerHTML = `${tag.dataset.value}
    <button type="button" class="remove-tag"> ×</button>`;

    return tag;
  }

  function showTagError(message) {
    const errorBox = document.getElementById("tag-error");
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function setTaggingLocked(locked) {
    const tagContainer = document.getElementById("transaction_tags");
    const input = document.getElementById("new-tag-input");
    const tagEditorSection = document.getElementById("modify-tag-editor-section");
    const noTagPanel = document.getElementById("modify-no-tag-panel");
    if (tagContainer) {
      tagContainer.classList.toggle("opacity-60", locked);
      tagContainer.classList.toggle("pointer-events-none", locked);
    }
    if (input) {
      input.disabled = locked;
      input.placeholder = locked ? "Tagging disabled for this transaction" : "Type and press Enter...";
    }
    if (tagEditorSection) {
      tagEditorSection.classList.toggle("hidden", locked);
    }
    if (noTagPanel) {
      noTagPanel.classList.toggle("hidden", !locked);
    }
  }

  function resetModifyTagModalState() {
    document
      .querySelectorAll("#transaction_tags [data-value]")
      .forEach((tag) => tag.remove());
    const vendorInput = document.getElementById("vendor_name");
    if (vendorInput) vendorInput.value = "";
    const noTagRequiredToggle = document.getElementById("no-tag-required-toggle");
    if (noTagRequiredToggle) noTagRequiredToggle.checked = false;
    setTaggingLocked(false);
  }

  function populateModal(data) {
    currentModifyModalData = data;
    document.getElementById("modal-loading").classList.add("hidden");
    document.getElementById("modal-content").classList.remove("hidden");

    const amountEl = document.getElementById("amount");
    if (amountEl) {
      const isCredit = String(data.direction || "").toLowerCase() !== "withdrawal";
      amountEl.innerText = formatINR(Math.abs(Number(data.amount || 0)));
      amountEl.className = isCredit
        ? "text-4xl font-black text-emerald-600"
        : "text-4xl font-black text-red-600";
    }
    document.getElementById("vendor_name").value = data.vendor_name || "";
    document.getElementById("transaction_id").innerText =
      data.counterparty_identifier;
    const sourceWrapEl = document.getElementById("transaction_source_wrap");
    const sourceBankEl = document.getElementById("transaction_source_bank");
    const sourceChannelEl = document.getElementById("transaction_source_channel");
    if (sourceWrapEl && sourceBankEl && sourceChannelEl) {
      const bankName = getTransactionBankName(data);
      const channelLabel = getTransactionChannelLabel(data);
      sourceBankEl.textContent = bankName ? `${bankName} Bank` : "";
      sourceChannelEl.textContent = channelLabel;
      sourceBankEl.classList.toggle("hidden", !bankName);
      sourceChannelEl.classList.toggle("hidden", !channelLabel);
      sourceWrapEl.classList.toggle("hidden", !(bankName || channelLabel));
    }
    const narrationWrapEl = document.getElementById("transaction_narration_wrap");
    const narrationEl = document.getElementById("transaction_narration");
    if (narrationWrapEl && narrationEl) {
      if (data.narration) {
        narrationEl.innerText = data.narration;
        narrationWrapEl.classList.remove("hidden");
      } else {
        narrationEl.innerText = "";
        narrationWrapEl.classList.add("hidden");
      }
    }
    document.getElementById("transaction_date").innerText =
      data.transaction_date;
    document.getElementById("transaction_time").innerText =
      data.transaction_time || "";
    document.getElementById("counterparty_count").innerText =
      data.counterparty_count;

    const tagContainer = document.getElementById("transaction_tags");
    const input = document.getElementById("new-tag-input");
    const save_transaction = document.getElementById("save_transaction");
    const modify_tags_modal = document.getElementById("modify-tags-modal");
    const discard_changes = document.getElementById("discard_changes");
    const noTagRequiredToggle = document.getElementById("no-tag-required-toggle");

    if (noTagRequiredToggle) {
      noTagRequiredToggle.checked = Boolean(data.no_tag_required);
      setTaggingLocked(noTagRequiredToggle.checked);
      noTagRequiredToggle.onchange = function () {
        setTaggingLocked(this.checked);
      };
    }

    if (data.tag_names) {
      data.tag_names.forEach((tag) => {
        if (tag !== null) {
          tagContainer.insertBefore(createTagElement(tag), input);
        }
      });
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();

        const value = input.value.trim();
        const existingTags = [
          ...document.querySelectorAll("#transaction_tags [data-value]"),
        ].map((tag) => tag.dataset.value);

        if (!value) return;
        if (existingTags.includes(value)) {
          showTagError("Tag already exists");
          tagContainer.classList.add("border-red-500", "ring-red-100");
          input.value = "";
          return;
        }

        if (availableManagedTags.length && !availableManagedTags.includes(value)) {
          showTagError("Create this tag in Manage Tags first, then use it here.");
          tagContainer.classList.add("border-red-500", "ring-red-100");
          input.value = "";
          return;
        }

        tagContainer.insertBefore(createTagElement(value), input);
        input.value = "";
      }
    });

    tagContainer.addEventListener("click", function (e) {
      if (e.target.classList.contains("remove-tag")) {
        e.target.closest(".tag-item").remove();
      }
    });

    save_transaction.onclick = async function (e) {
      e.preventDefault();
      const tags = [
        ...document.querySelectorAll("#transaction_tags [data-value]"),
      ].map((tag) => tag.dataset.value);

      const transaction_id =
        document.getElementById("transaction_id").innerText;
      const vendor_name = document.getElementById("vendor_name").value.trim();
      const apply_to_similar_transactions =
        document.getElementById("select-all-toggle").checked;
      const no_tag_required = Boolean(
        document.getElementById("no-tag-required-toggle")?.checked
      );
      const payload = {
        amount: Number(data.amount || 0),
        vendor_name,
        tags,
        transaction_id,
        id: data.id,
        apply_to_similar_transactions,
        counterparty_identifier: data.counterparty_identifier,
        no_tag_required,
      };

      try {
        const response = await fetch("/reports/transaction_update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok || result.success === false) {
          throw new Error(result.message || "Failed to update transaction tags.");
        }

        persistReportFocusTransaction(data.id);
        await submitSearch();
        closeModifyTagsModal();
      } catch (err) {
        console.error("Error:", err);
      }
    };

    discard_changes.onclick = function (e) {
      e.preventDefault();
      document
        .querySelectorAll("#transaction_tags [data-value]")
        .forEach((tag) => tag.remove());

      document.getElementById("vendor_name").value = "";
      if (noTagRequiredToggle) noTagRequiredToggle.checked = false;
      setTaggingLocked(false);

      modify_tags_modal.classList.add("hidden");
    };

  }

  function showError() {
    document.getElementById("modal-loading").innerText =
      "Failed to load transaction details";
  }

  async function saveModifyTagChanges(event) {
    if (event) event.preventDefault();
    const data = currentModifyModalData;
    if (!data?.id) return;

    const tags = [
      ...document.querySelectorAll("#transaction_tags [data-value]"),
    ].map((tag) => tag.dataset.value);

    const transaction_id =
      document.getElementById("transaction_id").innerText;
    const vendor_name = document.getElementById("vendor_name").value.trim();
    const apply_to_similar_transactions =
      document.getElementById("select-all-toggle").checked;
    const no_tag_required = Boolean(
      document.getElementById("no-tag-required-toggle")?.checked
    );
    const payload = {
      amount: Number(data.amount || 0),
      vendor_name,
      tags,
      transaction_id,
      id: data.id,
      apply_to_similar_transactions,
      counterparty_identifier: data.counterparty_identifier,
      no_tag_required,
    };

    try {
      const response = await fetch("/reports/transaction_update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Failed to update transaction tags.");
      }

      persistReportFocusTransaction(data.id);
      await submitSearch();
      closeModifyTagsModal();
    } catch (err) {
      console.error("Error:", err);
    }
  }

  function discardModifyTagChanges(event) {
    if (event) event.preventDefault();
    closeModifyTagsModal();
  }

  function closeModifyTagsModal() {
    currentModifyModalData = null;
    resetModifyTagModalState();
    document.getElementById("modify-tags-modal").classList.add("hidden");
  }

  window.saveModifyTagChanges = saveModifyTagChanges;
  window.discardModifyTagChanges = discardModifyTagChanges;
  window.closeModifyTagsModal = closeModifyTagsModal;

  function syncUpdatedTransactionsInReport({
    transactionId,
    tags,
    vendorName,
    applyToSimilarTransactions,
    counterpartyIdentifier,
    noTagRequired,
  }) {
    if (!Array.isArray(currentReportTransactions) || !currentReportTransactions.length) {
      return;
    }

    const normalizedTags = normalizeTags(tags);
    currentReportTransactions = currentReportTransactions.map((tx) => {
      const matchesPrimaryTransaction = String(tx.id) === String(transactionId);
      const matchesSimilarTransaction =
        applyToSimilarTransactions &&
        counterpartyIdentifier &&
        String(tx.counterparty_identifier || "") === String(counterpartyIdentifier);

      if (!matchesPrimaryTransaction && !matchesSimilarTransaction) {
        return tx;
      }

      const updatedTx = {
        ...tx,
        tags: normalizedTags,
        no_tag_required: Boolean(noTagRequired),
        vendor_name: vendorName || tx.vendor_name,
      };
      updatedTx.tag_status = getTransactionTagStatus(updatedTx);
      updatedTx.completion_status = deriveCompletionStatus(updatedTx);
      return updatedTx;
    });

    renderAmountChart(currentReportTransactions);
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
  }

  function syncSplitRequirementInReport({ transactionId, noSplitRequired, splitDone }) {
    if (!Array.isArray(currentReportTransactions) || !currentReportTransactions.length) {
      return;
    }

    currentReportTransactions = currentReportTransactions.map((tx) => {
      if (String(tx.id) !== String(transactionId)) {
        return tx;
      }

      const updatedTx = {
        ...tx,
        no_split_required: Boolean(noSplitRequired),
      };
      if (splitDone) {
        updatedTx.split_status = "Split Done";
      }
      updatedTx.completion_status = deriveCompletionStatus(updatedTx);
      return updatedTx;
    });

    renderAmountChart(currentReportTransactions);
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
  }

  function syncRecoveryLinkedTransactionInReport(recoveryTransactionId, linked = true) {
    if (!Array.isArray(currentReportTransactions) || !currentReportTransactions.length) {
      return;
    }

    currentReportTransactions = currentReportTransactions.map((tx) => {
      if (String(tx.id) !== String(recoveryTransactionId)) {
        return tx;
      }

      const updatedTx = {
        ...tx,
        linked_as_recovery: Boolean(linked),
      };
      updatedTx.tag_status = getTransactionTagStatus(updatedTx);
      updatedTx.split_status = getTransactionSplitStatus(updatedTx);
      updatedTx.completion_status = deriveCompletionStatus(updatedTx);
      return updatedTx;
    });

    renderAmountChart(currentReportTransactions);
    renderTransactionTable(getBreakdownTransactions());
    persistReportPageState();
  }

  const SPLIT_CATEGORY_OPTIONS = [
    "Groceries",
    "Health",
    "Snacks",
    "Food & Drinks",
    "Household",
    "Shopping",
    "Bills",
    "Travel",
    "Entertainment",
    "Other",
  ];
  const SPLIT_EXPENSE_FOR_OPTIONS = [
    "Self",
    "Family",
    "Friends",
    "Work",
    "Reimbursable",
    "Other",
  ];
  const SPLIT_RECOVERY_TYPES = [
    "Merchant Refund",
    "Friend Paid Back",
    "Family Paid Back",
    "Work Reimbursement",
    "Other Recovery",
  ];
  const SPLIT_SUMMARY_COLORS = [
    "bg-orange-400",
    "bg-blue-400",
    "bg-emerald-400",
    "bg-pink-400",
    "bg-slate-400",
  ];
  const SMALL_TRANSACTION_LABEL_OPTIONAL_LIMIT = 300;
  let splitState = createInitialSplitState();
  let activeSplitRequestId = 0;
  let activeSplitSubmitId = 0;

  function createInitialSplitState() {
    return {
      splitId: "",
      transactionId: "",
      totalAmount: 0,
      mode: "itemized",
      isLoading: false,
      lineItems: [],
      defaultCategory: SPLIT_CATEGORY_OPTIONS[0],
      categorySuggestions: [],
      transactionTags: [],
      vendorName: "",
      noSplitRequired: false,
      noSplitRequiredAuto: false,
      recoveries: [],
      pendingRecoveries: [],
      creditCandidates: [],
      recoveryPickerLineItemId: "",
    };
  }

  function setSplitModalLocked(locked) {
    const idsToDisable = [
      "split-vendor-name",
      "split-notes",
      "split-mode-itemized",
      "split-mode-quick",
      "split-add-line-item",
      "split-only-mine",
      "split-equal-count",
      "split-apply-equal",
      "split-my-share-amount",
      "split-my-share-other",
      "split-apply-my-share",
    ];
    idsToDisable.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = locked;
    });

    const lineItemsContainer = document.getElementById("split-line-items");
    if (lineItemsContainer) {
      lineItemsContainer.classList.toggle("opacity-60", locked);
      lineItemsContainer.classList.toggle("pointer-events-none", locked);
    }
  }

  function applySplitNoRequiredState(checked, autoSuggested = false) {
    splitState.noSplitRequired = checked;
    splitState.noSplitRequiredAuto = checked && autoSuggested;
    const noSplitRequiredToggle = document.getElementById("split-no-required-toggle");
    const editingShell = document.getElementById("split-editing-shell");
    const quickActions = document.getElementById("split-quick-actions");
    const lineItemsSection = document.getElementById("split-line-items-section");
    const summaryPanel = document.getElementById("split-summary-panel");
    const noRequiredPanel = document.getElementById("split-no-required-panel");
    const shouldHideEditing = checked && !autoSuggested;
    if (noSplitRequiredToggle) {
      noSplitRequiredToggle.checked = checked;
    }
    setSplitModalLocked(shouldHideEditing);
    [editingShell, quickActions, lineItemsSection, summaryPanel].forEach((el) => {
      if (el) el.classList.toggle("hidden", shouldHideEditing);
    });
    if (noRequiredPanel) {
      noRequiredPanel.classList.toggle("hidden", !shouldHideEditing);
    }
    if (shouldHideEditing) {
      closeRecoveryPicker();
    }
  }

  function markSplitEditingStarted() {
    if (splitState.noSplitRequired && splitState.noSplitRequiredAuto) {
      applySplitNoRequiredState(false, false);
    }
  }

  function createSplitLineItem(index = 0, overrides = {}) {
    const mode = overrides.mode || splitState.mode || "itemized";
    return {
      id: overrides.id || `split-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      item_name:
        overrides.item_name ||
        (mode === "quick" ? `Share ${index + 1}` : `Item ${index + 1}`),
      category: overrides.category || splitState.defaultCategory || SPLIT_CATEGORY_OPTIONS[0],
      expense_for:
        overrides.expense_for ||
        SPLIT_EXPENSE_FOR_OPTIONS[index % SPLIT_EXPENSE_FOR_OPTIONS.length],
      amount: Number(overrides.amount || 0),
    };
  }

  function formatCurrency(value) {
    return formatINR(value);
  }

  function normalizeAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, amount);
  }

  function splitRequiresCustomLabels() {
    return (
      splitState.mode === "itemized" &&
      splitState.lineItems.length > 1 &&
      normalizeAmount(splitState.totalAmount) > SMALL_TRANSACTION_LABEL_OPTIONAL_LIMIT
    );
  }

  function isGenericSplitItemName(value, index, expenseFor) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return true;
    return normalizedValue === buildDefaultSplitItemName(index, expenseFor);
  }

  function getSplitNotes() {
    return document.getElementById("split-notes");
  }

  function getSplitLineItemsContainer() {
    return document.getElementById("split-line-items");
  }

  function getRecoveryCreditsForCurrentReport() {
    return currentReportTransactions
      .filter((tx) => {
        const direction = String(tx.direction || tx.type || "").toLowerCase();
        return tx.id && tx.id !== splitState.transactionId && direction !== "withdrawal";
      })
      .map((tx) => ({
        id: tx.id,
        amount: normalizeAmount(Math.abs(tx.amount)),
        vendor_name: tx.vendor_name || tx.counterparty_identifier || "Credit transaction",
        counterparty_identifier: tx.counterparty_identifier || "",
        transaction_date: tx.transaction_date || "",
      }));
  }

  function renderRecoveryCandidates() {
    const selectEl = document.getElementById("split-recovery-transaction");
    if (!selectEl) return;

    const options = splitState.creditCandidates.length
      ? splitState.creditCandidates.map((tx) => {
          const label = `${tx.transaction_date || "No date"} | ${tx.vendor_name} | ${formatCurrency(tx.amount)}`;
          return `<option value="${escapeHtml(tx.id)}">${escapeHtml(label)}</option>`;
        }).join("")
      : "";

    selectEl.innerHTML = `<option value="">Select a credit transaction</option>${options}`;
  }

  function renderRecoveryLineItemOptions() {
    const selectEl = document.getElementById("split-recovery-line-item");
    if (!selectEl) return;

    const options = splitState.lineItems
      .filter((item) => item.id && !String(item.id).startsWith("split-row-"))
      .map((item) => {
        const label = `${item.item_name || "Line item"} - ${formatCurrency(item.amount)}`;
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
      })
      .join("");

    selectEl.innerHTML = `<option value="">Whole transaction</option>${options}`;
  }

  function renderRecoveryList() {
    const listEl = document.getElementById("split-recovery-list");
    const totalEl = document.getElementById("split-recovery-total");
    if (!listEl || !totalEl) return;

    const recoveries = Array.isArray(splitState.recoveries) ? splitState.recoveries : [];
    const totalRecovered = recoveries.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
    totalEl.textContent = formatCurrency(totalRecovered);

    if (!recoveries.length) {
      listEl.innerHTML = '<p class="text-xs text-slate-400">No linked refunds or paybacks yet.</p>';
      return;
    }

    listEl.innerHTML = recoveries
      .map((item) => {
        const title = item.vendor_name || item.counterparty_identifier || item.recovery_type || "Recovery";
        const subtitleParts = [
          item.recovery_type,
          item.transaction_date,
          item.counterparty_identifier,
        ].filter(Boolean);
        return `
          <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(title)}</p>
                <p class="mt-0.5 text-[11px] text-slate-500">${escapeHtml(subtitleParts.join(" • "))}</p>
              </div>
              <span class="shrink-0 text-sm font-semibold text-emerald-600">${formatCurrency(item.amount)}</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function getRecoveriesForLineItem(lineItemId) {
    const savedRecoveries = (splitState.recoveries || []).filter(
      (item) => item.split_line_item_id === lineItemId
    );
    const pendingRecoveries = (splitState.pendingRecoveries || []).filter(
      (item) => item.split_line_item_id === lineItemId
    );
    return [...savedRecoveries, ...pendingRecoveries];
  }

  function buildRecoveryMatchCandidates(amount) {
    const normalizedAmount = normalizeAmount(amount);
    const unavailableRecoveryIds = new Set([
      ...(splitState.recoveries || []).map((item) => item.recovery_transaction_id),
      ...(splitState.pendingRecoveries || []).map((item) => item.recovery_transaction_id),
    ]);
    const exactMatches = splitState.creditCandidates.filter(
      (tx) =>
        !unavailableRecoveryIds.has(tx.id) &&
        Math.abs(normalizeAmount(tx.amount) - normalizedAmount) <= 0.01
    );

    if (exactMatches.length) return exactMatches;

    return [...splitState.creditCandidates]
      .filter(
        (tx) =>
          !unavailableRecoveryIds.has(tx.id) && normalizeAmount(tx.amount) <= normalizedAmount
      )
      .sort((a, b) => Math.abs(normalizedAmount - a.amount) - Math.abs(normalizedAmount - b.amount))
      .slice(0, 8);
  }

  function closeRecoveryPicker() {
    const shouldRefresh = Boolean(splitState.transactionId);
    splitState.recoveryPickerLineItemId = "";
    const pickerEl = document.getElementById("split-recovery-picker");
    const listEl = document.getElementById("split-recovery-picker-list");
    const statusEl = document.getElementById("split-recovery-picker-status");
    const noteEl = document.getElementById("split-recovery-picker-note");
    const typeEl = document.getElementById("split-recovery-picker-type");
    if (pickerEl) pickerEl.classList.add("hidden");
    if (listEl) listEl.innerHTML = "";
    if (statusEl) statusEl.textContent = "";
    if (noteEl) noteEl.value = "";
    if (typeEl) typeEl.value = "Merchant Refund";
    if (shouldRefresh) renderSplitLineItems();
  }

  function openRecoveryPicker(lineItemId) {
    const pickerEl = document.getElementById("split-recovery-picker");
    const subtitleEl = document.getElementById("split-recovery-picker-subtitle");
    const statusEl = document.getElementById("split-recovery-picker-status");
    const listEl = document.getElementById("split-recovery-picker-list");
    if (!pickerEl || !listEl) return;

    const lineItem = splitState.lineItems.find((item) => item.id === lineItemId);
    if (!lineItem) return;

    splitState.recoveryPickerLineItemId = lineItemId;
    const candidates = buildRecoveryMatchCandidates(lineItem.amount);
    if (subtitleEl) {
      subtitleEl.textContent = `Matching credit transactions for ${formatCurrency(lineItem.amount)}.`;
    }
    if (statusEl) {
      statusEl.textContent = !splitState.splitId
        ? "Pick a credit now and it will be attached automatically when you finalize the split."
        : candidates.length
          ? ""
          : "No matching credit transactions found in the current report list.";
    }

    listEl.innerHTML = candidates.length
      ? candidates.map((tx) => `
          <button
            type="button"
            data-recovery-pick="${escapeHtml(tx.id)}"
            class="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-slate-50"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(tx.vendor_name)}</p>
              <p class="mt-1 text-xs text-slate-500">${escapeHtml([tx.transaction_date, tx.counterparty_identifier].filter(Boolean).join(" | "))}</p>
            </div>
            <span class="ml-3 shrink-0 text-sm font-bold text-emerald-600">${formatCurrency(tx.amount)}</span>
          </button>
        `).join("")
      : '<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">No matching credit transaction found.</div>';

    pickerEl.classList.remove("hidden");
  }

  function setSplitActionAvailability(disabled) {
    [
      "split-finalize-btn",
      "split-discard-changes",
      "split-add-line-item",
      "split-mode-itemized",
      "split-mode-quick",
      "split-link-recovery-btn",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = disabled;
      el.classList.toggle("opacity-60", disabled);
      el.classList.toggle("cursor-not-allowed", disabled);
    });
  }

  function getValidSplitLineItems() {
    return splitState.lineItems
      .map((item, index) => ({
        item_name: (
          String(item.item_name || "").trim() || buildDefaultSplitItemName(index, item.expense_for)
        ).trim(),
        category: item.category || splitState.defaultCategory || null,
        expense_for: item.expense_for || "Other",
        assignee: item.expense_for || null,
        amount: normalizeAmount(item.amount),
      }))
      .filter((item) => item.item_name && item.amount > 0);
  }

  function ensureSplitRowsForMode() {
    if (splitState.mode === "quick") {
      if (!splitState.lineItems.length) {
        splitState.lineItems = [
          createSplitLineItem(0, {
            mode: "quick",
            item_name: "My Share",
            category: splitState.defaultCategory,
            expense_for: "Self",
            amount: splitState.totalAmount || 0,
          }),
        ];
      }
      return;
    }

    if (!splitState.lineItems.length) {
      splitState.lineItems = [
        createSplitLineItem(0, { amount: splitState.totalAmount || 0 }),
      ];
    }
  }

  function updateSplitModeButtons() {
    const itemizedBtn = document.getElementById("split-mode-itemized");
    const quickBtn = document.getElementById("split-mode-quick");
    const hintEl = document.getElementById("split-line-item-hint");
    if (!itemizedBtn || !quickBtn) return;

    const activeClasses = ["bg-white", "dark:bg-slate-700", "text-primary", "shadow-sm"];
    const inactiveClasses = ["text-slate-500"];

    [itemizedBtn, quickBtn].forEach((btn) => {
      btn.classList.remove(...activeClasses);
      btn.classList.add(...inactiveClasses);
    });

    const activeBtn = splitState.mode === "quick" ? quickBtn : itemizedBtn;
    activeBtn.classList.add(...activeClasses);
    activeBtn.classList.remove(...inactiveClasses);

    if (hintEl) {
      hintEl.textContent =
        splitState.mode === "quick"
          ? "Use people split for shared bills."
          : "Use items split for shopping and detailed bills.";
    }
  }

  function getSplitCategoryOptions() {
    return [...new Set([
      ...splitState.categorySuggestions,
      ...SPLIT_CATEGORY_OPTIONS,
    ])];
  }

  function buildDefaultSplitItemName(index, expenseFor) {
    if (splitState.mode === "quick") {
      if (expenseFor === "Self") return "Personal Spend";
      if (expenseFor === "Family") return "Family Spend";
      if (expenseFor === "Friends") return "Friends Spend";
      if (expenseFor === "Work") return "Work Spend";
      if (expenseFor === "Reimbursable") return "Reimbursable Spend";
      return "Other Spend";
    }
    return `Item ${index + 1}`;
  }

  function shouldUseQuickSplitMode(vendorName, tagNames = []) {
    const normalizedText = `${vendorName || ""} ${tagNames.join(" ")}`.toLowerCase();
    const quickKeywords = [
      "hotel",
      "restaurant",
      "cafe",
      "dinner",
      "lunch",
      "breakfast",
      "food",
      "bar",
      "uber",
      "ola",
      "cab",
      "taxi",
      "movie",
      "bill",
    ];
    const itemizedKeywords = [
      "dmart",
      "store",
      "mart",
      "supermarket",
      "grocery",
      "groceries",
      "pharmacy",
      "medical",
      "amazon",
      "shopping",
      "bazaar",
    ];

    if (itemizedKeywords.some((keyword) => normalizedText.includes(keyword))) {
      return false;
    }
    return quickKeywords.some((keyword) => normalizedText.includes(keyword));
  }

  function buildInitialSplitRows({ amount, mode, defaultCategory, vendorName }) {
    if (mode === "quick") {
      return [
        createSplitLineItem(0, {
          mode,
          item_name: "Personal Spend",
          category: defaultCategory,
          expense_for: "Self",
          amount,
        }),
      ];
    }

    return [
      createSplitLineItem(0, {
        mode,
        item_name: vendorName || "Item 1",
        category: defaultCategory,
        expense_for: "Self",
        amount,
      }),
    ];
  }


  function splitAmountEvenly(totalAmount, parts) {
    const normalizedTotal = Math.round(normalizeAmount(totalAmount) * 100);
    const safeParts = Math.max(1, Number(parts) || 1);
    const baseAmount = Math.floor(normalizedTotal / safeParts);
    let remainder = normalizedTotal - (baseAmount * safeParts);

    return Array.from({ length: safeParts }, () => {
      const nextAmount = baseAmount + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      return Number((nextAmount / 100).toFixed(2));
    });
  }

  function applyOnlyMineShortcut() {
    markSplitEditingStarted();
    splitState.mode = "quick";
    splitState.lineItems = [
      createSplitLineItem(0, {
        mode: "quick",
        item_name: "Personal Spend",
        category: splitState.defaultCategory,
        expense_for: "Self",
        amount: splitState.totalAmount,
      }),
    ];
    renderSplitLineItems();
  }

  function applyEqualSplitShortcut(splitCount) {
    markSplitEditingStarted();
    const safeCount = Math.max(2, Math.floor(Number(splitCount) || 0));
    const splitAmounts = splitAmountEvenly(splitState.totalAmount, safeCount);
    const ownerSequence = ["Self", "Friends", "Family", "Work", "Reimbursable"];

    splitState.mode = "quick";
    splitState.lineItems = splitAmounts.map((amount, index) =>
      createSplitLineItem(index, {
        mode: "quick",
        item_name: `Share ${index + 1}`,
        category: splitState.defaultCategory,
        expense_for: ownerSequence[index] || "Friends",
        amount,
      })
    );
    renderSplitLineItems();
  }

  function applyMyShareShortcut(myShareAmount, otherExpenseFor) {
    markSplitEditingStarted();
    const normalizedTotal = normalizeAmount(splitState.totalAmount);
    const normalizedMyShare = normalizeAmount(myShareAmount);
    const safeOtherExpenseFor = otherExpenseFor || "Friends";

    if (normalizedMyShare <= 0 || normalizedMyShare > normalizedTotal) {
      const statusEl = document.getElementById("split-submit-status");
      if (statusEl) {
        statusEl.textContent = "My share must be greater than 0 and within the total amount.";
      }
      return;
    }

    const remainderAmount = Number((normalizedTotal - normalizedMyShare).toFixed(2));
    splitState.mode = "quick";
    splitState.lineItems = [
      createSplitLineItem(0, {
        mode: "quick",
        item_name: "Personal Spend",
        category: splitState.defaultCategory,
        expense_for: "Self",
        amount: normalizedMyShare,
      }),
    ];

    if (remainderAmount > 0) {
      splitState.lineItems.push(
        createSplitLineItem(1, {
          mode: "quick",
          item_name: buildDefaultSplitItemName(1, safeOtherExpenseFor),
          category: splitState.defaultCategory,
          expense_for: safeOtherExpenseFor,
          amount: remainderAmount,
        })
      );
    }

    renderSplitLineItems();
  }

  function renderSplitLineItems() {
    const container = getSplitLineItemsContainer();
    if (!container) return;

    ensureSplitRowsForMode();
    container.innerHTML = "";

    splitState.lineItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className =
        "grid grid-cols-12 gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm";
      row.dataset.lineItemId = item.id;

      const categoryOptions = getSplitCategoryOptions()
        .map(
          (option) =>
            `<option value="${escapeHtml(option)}" ${item.category === option ? "selected" : ""}>${escapeHtml(option)}</option>`
        )
        .join("");

      const expenseForOptions = SPLIT_EXPENSE_FOR_OPTIONS
        .map(
          (option) =>
            `<option value="${escapeHtml(option)}" ${item.expense_for === option ? "selected" : ""}>${escapeHtml(option)}</option>`
        )
        .join("");
      const linkedRecoveries = getRecoveriesForLineItem(item.id);
      const hasAmount = normalizeAmount(item.amount) > 0;
      const recoveryDisabled = !hasAmount;
      const customLabelRequired = splitRequiresCustomLabels();
      const labelText = customLabelRequired
        ? `${splitState.mode === "quick" ? "Label" : "Item"} Required`
        : `${splitState.mode === "quick" ? "Label" : "Item"} Optional`;
      row.innerHTML = `
        <div class="col-span-12 grid grid-cols-12 gap-2.5 items-end lg:gap-3">
          <div class="col-span-12 lg:col-span-3 flex flex-col gap-1">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${labelText}</label>
            <input
              data-field="item_name"
              class="form-input h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-medium focus:ring-primary dark:border-slate-700 dark:bg-slate-800"
              type="text"
              value="${escapeHtml(item.item_name || "")}"
              placeholder="${customLabelRequired ? "Enter a clear item label" : (splitState.mode === "quick" ? "Family dinner" : "Optional for small/simple splits")}"
            />
          </div>
          <div class="col-span-6 lg:col-span-3 flex flex-col gap-1">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Category</label>
            <select
              data-field="category"
              class="form-select h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-medium focus:ring-primary dark:border-slate-700 dark:bg-slate-800"
            >
              ${categoryOptions}
            </select>
          </div>
          <div class="col-span-6 lg:col-span-2 flex flex-col gap-1">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Owner</label>
            <select
              data-field="expense_for"
              class="form-select h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-medium focus:ring-primary dark:border-slate-700 dark:bg-slate-800"
            >
              ${expenseForOptions}
            </select>
          </div>
          <div class="col-span-8 lg:col-span-2 flex flex-col gap-1">
            <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">INR</span>
              <input
                data-field="amount"
                class="form-input h-10 w-full rounded-lg border-slate-200 bg-white pl-10 text-right text-sm font-black focus:ring-primary dark:border-slate-700 dark:bg-slate-800"
                type="number"
                min="0"
                step="0.01"
                value="${normalizeAmount(item.amount).toFixed(2)}"
              />
            </div>
          </div>
          <div class="col-span-4 lg:col-span-1 flex items-end">
            <label
              data-recovery-trigger="1"
              class="flex h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-600 ${recoveryDisabled ? "opacity-60" : "cursor-pointer hover:border-primary/30 hover:bg-slate-100"}"
            >
              <input
                type="checkbox"
                class="mr-1.5 size-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                data-recovery-toggle="1"
                ${linkedRecoveries.length ? "checked" : ""}
              />
              Later Back
            </label>
          </div>
          <div class="col-span-12 lg:col-span-11">
            ${linkedRecoveries.length
              ? `<div class="flex flex-wrap gap-2 pt-1">${linkedRecoveries.map((recovery) => `
                  <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100" data-recovery-chip="${escapeHtml(recovery.id)}">
                    <span class="recovery-label">${escapeHtml(recovery.vendor_name || recovery.counterparty_identifier || recovery.recovery_type || "Recovery")} ${escapeHtml(formatCurrency(recovery.amount))}${recovery.is_pending ? ' (pending)' : ""}</span>
                    ${!recovery.is_pending ? `
                    <button
                      type="button"
                      data-edit-recovery="${escapeHtml(recovery.id)}"
                      data-edit-amount="${escapeHtml(String(recovery.amount))}"
                      class="inline-flex size-4 items-center justify-center rounded-full text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-800"
                      aria-label="Edit recovery amount"
                    ><span class="material-symbols-outlined text-[12px]">edit</span></button>` : ""}
                    <button
                      type="button"
                      data-remove-recovery="${escapeHtml(recovery.id)}"
                      class="inline-flex size-4 items-center justify-center rounded-full text-emerald-600 transition-colors hover:bg-emerald-100 hover:text-emerald-800"
                      aria-label="Remove linked recovery"
                    >
                      <span class="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </span>
                `).join("")}</div>`
              : ""}
          </div>
          <div class="col-span-12 lg:col-span-1 flex items-end justify-end">
            <button
              type="button"
              data-remove-line-item="1"
              class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
              ${splitState.lineItems.length <= 1 ? "disabled" : ""}
              aria-label="Remove split row ${index + 1}"
            >
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
        </div>
      `;

      container.appendChild(row);
    });

    updateSplitModeButtons();
    updateSplitSummary();
    renderRecoveryLineItemOptions();
  }

  function renderSummaryGroup(containerId, totals, emptyLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const entries = Object.entries(totals).filter(([, amount]) => amount > 0);
    if (!entries.length) {
      container.innerHTML = `<p class="text-sm text-slate-400">${emptyLabel}</p>`;
      return;
    }

    container.innerHTML = entries
      .map(([label, amount], index) => `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="size-2 rounded-full ${SPLIT_SUMMARY_COLORS[index % SPLIT_SUMMARY_COLORS.length]}"></div>
            <span class="text-sm text-slate-600 dark:text-slate-400">${escapeHtml(label)}</span>
          </div>
          <span class="text-sm font-bold">${formatCurrency(amount)}</span>
        </div>
      `)
      .join("");
  }

  function updateSplitSummary() {
    const totalAmount = normalizeAmount(splitState.totalAmount);
    const allocatedAmount = getValidSplitLineItems().reduce(
      (sum, item) => sum + normalizeAmount(item.amount),
      0
    );
    const remainingAmount = Number((totalAmount - allocatedAmount).toFixed(2));
    const progress = totalAmount > 0 ? Math.min((allocatedAmount / totalAmount) * 100, 100) : 0;

    const totalEl = document.getElementById("split-allocated-total");
    const progressEl = document.getElementById("split-allocation-progress");
    const statusEl = document.getElementById("split-allocation-status");
    if (totalEl) {
      totalEl.textContent = `${formatCurrency(allocatedAmount)} / ${formatCurrency(totalAmount)}`;
    }
    if (progressEl) {
      progressEl.style.width = `${progress}%`;
      progressEl.classList.remove("bg-primary", "bg-amber-500", "bg-red-500");
      progressEl.classList.add(
        remainingAmount === 0 ? "bg-primary" : allocatedAmount > totalAmount ? "bg-red-500" : "bg-amber-500"
      );
    }
    if (statusEl) {
      statusEl.className =
        "flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight";
      if (!allocatedAmount) {
        statusEl.classList.add("text-slate-500");
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-xs">info</span>Add line items';
      } else if (remainingAmount === 0) {
        statusEl.classList.add("text-green-500");
        statusEl.innerHTML =
          '<span class="material-symbols-outlined text-xs">verified</span>Fully allocated';
      } else if (remainingAmount > 0) {
        statusEl.classList.add("text-amber-500");
        statusEl.innerHTML =
          `<span class="material-symbols-outlined text-xs">warning</span>${formatCurrency(remainingAmount)} remaining`;
      } else {
        statusEl.classList.add("text-red-500");
        statusEl.innerHTML =
          `<span class="material-symbols-outlined text-xs">error</span>${formatCurrency(Math.abs(remainingAmount))} over allocated`;
      }
    }

    const categoryTotals = {};
    const expenseForTotals = {};
    getValidSplitLineItems().forEach((item) => {
      const category = item.category || "Uncategorized";
      const expenseFor = item.expense_for || "Other";
      categoryTotals[category] = (categoryTotals[category] || 0) + item.amount;
      expenseForTotals[expenseFor] = (expenseForTotals[expenseFor] || 0) + item.amount;
    });

    renderSummaryGroup("split-category-summary", categoryTotals, "No category allocation yet.");
    renderSummaryGroup("split-person-summary", expenseForTotals, "No expense-for allocation yet.");
    renderRecoveryList();

    const hintEl = document.getElementById("split-line-item-hint");
    if (hintEl && splitRequiresCustomLabels()) {
      hintEl.textContent = `Add clear labels for larger item splits above INR ${SMALL_TRANSACTION_LABEL_OPTIONAL_LIMIT}.`;
    }
  }

  function addSplitLineItem(overrides = {}) {
    markSplitEditingStarted();
    splitState.lineItems.push(
      createSplitLineItem(splitState.lineItems.length, {
        category: splitState.defaultCategory,
        mode: splitState.mode,
        ...overrides,
      })
    );
    renderSplitLineItems();
  }

  function removeSplitLineItem(lineItemId) {
    markSplitEditingStarted();
    if (splitState.lineItems.length <= 1) return;
    splitState.lineItems = splitState.lineItems.filter((item) => item.id !== lineItemId);
    renderSplitLineItems();
  }

  async function _scanReceiptForSplit() {
    const fileInput = document.getElementById("split-receipt-file-input");
    if (!fileInput) return;

    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = "";

      const btn = document.getElementById("split-scan-receipt-btn");
      const originalHtml = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-outlined text-[15px] leading-none">hourglass_top</span> Reading…`;
      }

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/upload/receipt", { method: "POST", body: formData });
        const data = await res.json();

        const items = data.items || [];
        if (items.length === 0) {
          if (typeof window.toast === "function") {
            window.toast(data.ocr_error ? "OCR could not read the bill. Add items manually." : "No items detected. Add items manually.", "warning");
          }
          addSplitLineItem();
          return;
        }

        // Clear the single default blank row if it has no data
        if (
          splitState.lineItems.length === 1 &&
          !splitState.lineItems[0].item_name &&
          !splitState.lineItems[0].amount
        ) {
          splitState.lineItems = [];
        }

        items.forEach(item => {
          addSplitLineItem({
            item_name: item.item_name || "",
            amount: item.amount || 0,
            category: item.suggested_category || "",
          });
        });

        if (typeof window.toast === "function") {
          window.toast(`${items.length} item${items.length === 1 ? "" : "s"} extracted from receipt.`, "success");
        }
      } catch {
        if (typeof window.toast === "function") {
          window.toast("Could not read receipt. Check your connection and try again.", "error");
        }
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
      }
    };

    fileInput.click();
  }

  function updateSplitLineItem(lineItemId, field, value) {
    markSplitEditingStarted();
    let shouldRefreshItemName = false;
    let nextItemName = "";

    splitState.lineItems = splitState.lineItems.map((item, index) => {
      if (item.id !== lineItemId) return item;
      const nextValue = field === "amount" ? normalizeAmount(value) : value;
      const currentDefaultName = buildDefaultSplitItemName(index, item.expense_for);
      const updatedItemName =
        field === "expense_for" && (!item.item_name || item.item_name === currentDefaultName)
          ? buildDefaultSplitItemName(index, nextValue)
          : item.item_name;

      if (updatedItemName !== item.item_name) {
        shouldRefreshItemName = true;
        nextItemName = updatedItemName;
      }

      return {
        ...item,
        [field]: nextValue,
        item_name: updatedItemName,
      };
    });

    if (shouldRefreshItemName) {
      const rowEl = document.querySelector(`[data-line-item-id="${lineItemId}"]`);
      const itemInput = rowEl?.querySelector('[data-field="item_name"]');
      if (itemInput) {
        itemInput.value = nextItemName;
      }
    }

    updateSplitSummary();
  }

  function setSplitMode(mode) {
    markSplitEditingStarted();
    if (splitState.mode === mode) return;
    splitState.mode = mode;
    splitState.lineItems = splitState.lineItems.map((item, index) => ({
      ...item,
      item_name: item.item_name?.trim() || buildDefaultSplitItemName(index, item.expense_for),
      category: item.category || splitState.defaultCategory,
    }));
    ensureSplitRowsForMode();
    renderSplitLineItems();
  }

  async function handleSplitClick(txnId) {
    const selectedTx = (currentReportTransactions || []).find((tx) => String(tx.id) === String(txnId));
    if (isSettlementTransaction(selectedTx)) {
      return;
    }
    openSplitModal();
    await loadSplitTransactionDetails(txnId);
  }

  async function loadSplitTransactionDetails(txnId) {
    const statusEl = document.getElementById("split-submit-status");
    const requestId = ++activeSplitRequestId;
    try {
      splitState.isLoading = true;
      setSplitActionAvailability(true);
      if (statusEl) statusEl.textContent = "";
      const [detailsResponse, splitResponse] = await Promise.all([
        fetch(`/reports/transaction_details/${txnId}`, { method: "GET" }),
        fetch(`/reports/transaction_split/${txnId}`, { method: "GET" }),
      ]);
      if (!detailsResponse.ok) throw new Error("Failed to load transaction details.");
      if (!splitResponse.ok) throw new Error("Failed to load saved split details.");

      const data = await detailsResponse.json();
      const splitData = await splitResponse.json();
      if (requestId !== activeSplitRequestId) {
        return;
      }
      populateSplitModal(txnId, data, splitData?.data || null);
      splitState.isLoading = false;
      setSplitActionAvailability(false);
      if (statusEl) statusEl.textContent = "";
    } catch (error) {
      if (requestId !== activeSplitRequestId) {
        return;
      }
      splitState.isLoading = false;
      setSplitActionAvailability(false);
      console.error("Error loading split transaction details:", error);
      if (statusEl) statusEl.textContent = "Unable to load transaction details.";
    }
  }

  function populateSplitModal(txnId, data, savedSplit = null) {
    const splitModalEl = document.getElementById("split-transaction-modal");
    if (!splitModalEl) return;

    const amount = normalizeAmount(Math.abs(Number(data.amount || 0)));
    const tagNames = Array.isArray(data.tag_names)
      ? data.tag_names.map((tag) => (tag || "").trim()).filter(Boolean)
      : [];
    const defaultCategory = tagNames[0] || SPLIT_CATEGORY_OPTIONS[0];
    const normalizedVendor = data.vendor_name || data.counterparty_identifier || "";
    const suggestedMode = savedSplit?.split_mode || (shouldUseQuickSplitMode(normalizedVendor, tagNames) ? "quick" : "itemized");
    const savedLineItems = Array.isArray(savedSplit?.line_items)
      ? savedSplit.line_items.map((item, index) =>
          createSplitLineItem(index, {
            id: item.id,
            mode: savedSplit?.split_mode || suggestedMode,
            item_name: item.item_name,
            category: item.category || defaultCategory,
            expense_for: item.expense_for || "Other",
            amount: normalizeAmount(item.amount),
          })
        )
      : [];
    splitState = {
      splitId: savedSplit?.split_id || "",
      transactionId: txnId,
      totalAmount: amount,
      mode: suggestedMode,
      isLoading: false,
      defaultCategory,
      categorySuggestions: tagNames.length ? tagNames : [defaultCategory],
      transactionTags: tagNames,
      vendorName: normalizedVendor,
      noSplitRequired: Boolean(data.no_split_required),
      noSplitRequiredAuto: false,
      recoveries: Array.isArray(savedSplit?.recoveries) ? savedSplit.recoveries : [],
      pendingRecoveries: [],
      creditCandidates: getRecoveryCreditsForCurrentReport(),
      recoveryPickerLineItemId: "",
      lineItems: savedLineItems.length ? savedLineItems : buildInitialSplitRows({
        amount,
        mode: suggestedMode,
        defaultCategory,
        vendorName: normalizedVendor,
      }),
    };

    splitModalEl.dataset.txnId = txnId;

    const vendorInputEl = document.getElementById("split-vendor-name");
    if (vendorInputEl) {
      vendorInputEl.value = data.vendor_name || data.counterparty_identifier || "";
    }

    const txnMetaEl = document.getElementById("split-txn-meta");
    if (txnMetaEl) {
      txnMetaEl.textContent = `${data.counterparty_identifier || "N/A"} - ${data.transaction_date || "N/A"}`;
    }
    const txnTimeEl = document.getElementById("split-txn-time");
    if (txnTimeEl) {
      if (data.transaction_time) {
        txnTimeEl.textContent = `Time: ${data.transaction_time}`;
        txnTimeEl.classList.remove("hidden");
      } else {
        txnTimeEl.textContent = "";
        txnTimeEl.classList.add("hidden");
      }
    }

    const narrationEl = document.getElementById("split-narration");
    const narrationWrapEl = document.getElementById("split-narration-wrap");
    if (narrationEl && narrationWrapEl) {
      if (data.narration) {
        narrationEl.textContent = data.narration;
        narrationWrapEl.classList.remove("hidden");
      } else {
        narrationEl.textContent = "";
        narrationWrapEl.classList.add("hidden");
      }
    }

    const totalAmountEl = document.getElementById("split-total-amount");
    if (totalAmountEl) {
      totalAmountEl.textContent = formatCurrency(amount);
    }

    const notesEl = getSplitNotes();
    if (notesEl) {
      notesEl.value = savedSplit?.notes || "";
    }
    const noSplitRequiredToggle = document.getElementById("split-no-required-toggle");
    const shouldDefaultNoSplitRequired =
      !savedSplit?.split_id &&
      !savedLineItems.length &&
      !splitState.noSplitRequired;
    applySplitNoRequiredState(
      splitState.noSplitRequired || shouldDefaultNoSplitRequired,
      shouldDefaultNoSplitRequired
    );
    const equalCountEl = document.getElementById("split-equal-count");
    if (equalCountEl) {
      equalCountEl.value = String(Math.max(splitState.lineItems.length || 2, 2));
    }
    const myShareAmountEl = document.getElementById("split-my-share-amount");
    if (myShareAmountEl) {
      myShareAmountEl.value = "";
    }
    const myShareOtherEl = document.getElementById("split-my-share-other");
    if (myShareOtherEl) {
      myShareOtherEl.value = "Friends";
    }

    bindSplitModalControls();
    bindSplitFinalize();
    renderSplitLineItems();
  }

  function collectSplitLineItems() {
    return getValidSplitLineItems();
  }

  async function persistPendingRecoveries(savedLineItems = []) {
    if (!splitState.pendingRecoveries.length || !splitState.splitId) {
      return;
    }

    const validLocalLineItems = splitState.lineItems.filter(
      (item) => normalizeAmount(item.amount) > 0
    );
    const persistedRecoveries = [];

    for (const pendingRecovery of splitState.pendingRecoveries) {
      const localLineItemIndex = validLocalLineItems.findIndex(
        (item) => item.id === pendingRecovery.split_line_item_id
      );
      const persistedLineItem = localLineItemIndex >= 0 ? savedLineItems[localLineItemIndex] : null;
      if (!persistedLineItem?.id) {
        throw new Error("Unable to match a saved split row for the selected recovery.");
      }

      const payload = {
        transaction_id: splitState.transactionId,
        split_line_item_id: persistedLineItem.id,
        recovery_transaction_id: pendingRecovery.recovery_transaction_id,
        amount: normalizeAmount(pendingRecovery.amount),
        recovery_type: pendingRecovery.recovery_type || "Merchant Refund",
        notes: pendingRecovery.notes || null,
      };

      const response = await fetch("/reports/transaction_split/recovery_link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Failed to save selected refund / payback.");
      }

      persistedRecoveries.push({
        ...pendingRecovery,
        id: result.data?.recovery_id || pendingRecovery.id,
        split_line_item_id: persistedLineItem.id,
      });
      syncRecoveryLinkedTransactionInReport(pendingRecovery.recovery_transaction_id, true);
    }

    splitState.recoveries = [...persistedRecoveries, ...splitState.recoveries];
    splitState.pendingRecoveries = [];
  }

  async function handleLinkRecovery(recoveryTransactionId) {
    const statusEl = document.getElementById("split-recovery-picker-status");
    const noteEl = document.getElementById("split-recovery-picker-note");
    const typeEl = document.getElementById("split-recovery-picker-type");
    const lineItemId = splitState.recoveryPickerLineItemId;
    const lineItem = splitState.lineItems.find((item) => item.id === lineItemId);
    const matchedTx = splitState.creditCandidates.find((tx) => tx.id === recoveryTransactionId);

    if (!lineItem || !recoveryTransactionId) return;
    if (!splitState.splitId) {
      splitState.pendingRecoveries = [
        {
          id: `pending-recovery-${Date.now()}`,
          split_line_item_id: lineItem.id,
          recovery_transaction_id: recoveryTransactionId,
          recovery_type: typeEl?.value || "Merchant Refund",
          amount: normalizeAmount(matchedTx?.amount ?? lineItem.amount),
          notes: noteEl?.value?.trim() || null,
          transaction_date: matchedTx?.transaction_date || null,
          counterparty_identifier: matchedTx?.counterparty_identifier || null,
          vendor_name: matchedTx?.vendor_name || null,
          is_pending: true,
        },
        ...splitState.pendingRecoveries.filter((item) => item.recovery_transaction_id !== recoveryTransactionId),
      ];
      splitState.creditCandidates = splitState.creditCandidates.filter((tx) => tx.id !== recoveryTransactionId);
      if (statusEl) {
        statusEl.textContent = "Credit selected. It will be linked when you finalize the split.";
      }
      closeRecoveryPicker();
      return;
    }

    const payload = {
      transaction_id: splitState.transactionId,
      split_line_item_id: lineItem.id,
      recovery_transaction_id: recoveryTransactionId,
      amount: normalizeAmount(matchedTx?.amount ?? lineItem.amount),
      recovery_type: typeEl?.value || "Merchant Refund",
      notes: noteEl?.value?.trim() || null,
    };

    try {
      if (statusEl) statusEl.textContent = "Linking refund / payback...";
      const response = await fetch("/reports/transaction_split/recovery_link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Failed to link refund / payback.");
      }

      splitState.recoveries = [
        {
          id: result.data?.recovery_id || `recovery-${Date.now()}`,
          split_line_item_id: lineItem.id,
          recovery_transaction_id: recoveryTransactionId,
          recovery_type: payload.recovery_type,
          amount: payload.amount,
          notes: payload.notes,
          transaction_date: matchedTx?.transaction_date || null,
          counterparty_identifier: matchedTx?.counterparty_identifier || null,
          vendor_name: matchedTx?.vendor_name || null,
        },
        ...splitState.recoveries.filter((item) => item.recovery_transaction_id !== recoveryTransactionId),
      ];
      splitState.creditCandidates = splitState.creditCandidates.filter((tx) => tx.id !== recoveryTransactionId);
      syncRecoveryLinkedTransactionInReport(recoveryTransactionId, true);
      closeRecoveryPicker();
    } catch (error) {
      console.error("Recovery link error:", error);
      if (statusEl) statusEl.textContent = error.message || "Failed to link refund / payback.";
    }
  }

  async function editRecoveryAmount(recoveryId, newAmount) {
    const recovery = splitState.recoveries.find((r) => r.id === recoveryId);
    if (!recovery || !newAmount || isNaN(newAmount) || Number(newAmount) <= 0) return;
    const payload = {
      transaction_id:          splitState.transactionId,
      recovery_transaction_id: recovery.recovery_transaction_id,
      split_line_item_id:      recovery.split_line_item_id || null,
      amount:                  Number(newAmount),
      recovery_type:           recovery.recovery_type || "Merchant Refund",
      notes:                   recovery.notes || null,
    };
    const resp = await fetch("/reports/transaction_split/recovery_link", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!result.success) { window.toast?.error(result.message || "Failed to update amount"); return; }
    recovery.amount = Number(newAmount);
    renderSplitLineItems();
  }

  async function removeLinkedRecovery(recoveryId) {
    const recovery = splitState.recoveries.find((item) => item.id === recoveryId);
    const pendingRecovery = splitState.pendingRecoveries.find((item) => item.id === recoveryId);
    if (!recoveryId || (!recovery && !pendingRecovery)) return;

    if (pendingRecovery) {
      splitState.pendingRecoveries = splitState.pendingRecoveries.filter((item) => item.id !== recoveryId);
      const alreadyCandidate = splitState.creditCandidates.some(
        (item) => item.id === pendingRecovery.recovery_transaction_id
      );
      if (!alreadyCandidate) {
        splitState.creditCandidates.push({
          id: pendingRecovery.recovery_transaction_id,
          amount: normalizeAmount(pendingRecovery.amount),
          vendor_name: pendingRecovery.vendor_name || pendingRecovery.counterparty_identifier || "Credit transaction",
          counterparty_identifier: pendingRecovery.counterparty_identifier || "",
          transaction_date: pendingRecovery.transaction_date || "",
        });
      }
      renderSplitLineItems();
      return;
    }

    try {
      const response = await fetch(`/reports/transaction_split/recovery_link/${recoveryId}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Failed to remove linked recovery.");
      }

      splitState.recoveries = splitState.recoveries.filter((item) => item.id !== recoveryId);
      syncRecoveryLinkedTransactionInReport(recovery.recovery_transaction_id, false);
      const alreadyCandidate = splitState.creditCandidates.some(
        (item) => item.id === recovery.recovery_transaction_id
      );
      if (!alreadyCandidate) {
        splitState.creditCandidates.push({
          id: recovery.recovery_transaction_id,
          amount: normalizeAmount(recovery.amount),
          vendor_name: recovery.vendor_name || recovery.counterparty_identifier || "Credit transaction",
          counterparty_identifier: recovery.counterparty_identifier || "",
          transaction_date: recovery.transaction_date || "",
        });
      }
      renderSplitLineItems();
    } catch (error) {
      console.error("Remove recovery link error:", error);
      const statusEl = document.getElementById("split-submit-status");
      if (statusEl) {
        statusEl.textContent = error.message || "Failed to remove linked refund / payback.";
      }
    }
  }

  function bindSplitFinalize() {
    const finalizeBtn = document.getElementById("split-finalize-btn");
    if (finalizeBtn && finalizeBtn.dataset.bound !== "1") {
      finalizeBtn.dataset.bound = "1";
      finalizeBtn.addEventListener("click", async function () {
        const splitModalEl = document.getElementById("split-transaction-modal");
        const statusEl = document.getElementById("split-submit-status");
        if (!splitModalEl) return;
        if (splitState.isLoading) {
          if (statusEl) statusEl.textContent = "Please wait for transaction details to finish loading.";
          return;
        }

        const transactionId = splitModalEl.dataset.txnId;
        const lineItems = collectSplitLineItems();
        const totalAllocated = lineItems.reduce((sum, item) => sum + item.amount, 0);
        const notes = getSplitNotes()?.value.trim() || null;
        const vendorName = document.getElementById("split-vendor-name")?.value.trim() || null;
        splitState.vendorName = vendorName || splitState.vendorName;
        const noSplitRequired = Boolean(
          document.getElementById("split-no-required-toggle")?.checked
        );
        const missingRequiredLabelIndex = splitRequiresCustomLabels()
          ? splitState.lineItems.findIndex((item, index) =>
              normalizeAmount(item.amount) > 0 &&
              isGenericSplitItemName(item.item_name, index, item.expense_for)
            )
          : -1;

        if (!transactionId) {
          if (statusEl) statusEl.textContent = "Missing transaction id.";
          return;
        }
        if (noSplitRequired) {
          try {
            const response = await fetch("/reports/transaction_split", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transaction_id: transactionId,
                line_items: [],
                no_split_required: true,
              }),
            });
            const result = await response.json();
            if (!response.ok || result.success === false) {
              throw new Error(result.message || "Failed to mark split as not required.");
            }
            syncSplitRequirementInReport({
              transactionId,
              noSplitRequired: true,
              splitDone: false,
            });
            closeSplitModal();
          } catch (error) {
            console.error("Split requirement update error:", error);
            if (statusEl) {
              statusEl.textContent = error.message || "Failed to mark split as not required.";
            }
          }
          return;
        }
        if (!lineItems.length) {
          if (statusEl) statusEl.textContent = "Add at least one valid line item.";
          return;
        }
        if (missingRequiredLabelIndex >= 0) {
          if (statusEl) {
            statusEl.textContent = `Add a clear label for line item ${missingRequiredLabelIndex + 1}.`;
          }
          return;
        }
        if (Math.abs(totalAllocated - splitState.totalAmount) > 0.009) {
          if (statusEl) statusEl.textContent = "Allocated amount must match the transaction total.";
          return;
        }

        try {
          const submitId = ++activeSplitSubmitId;
          finalizeBtn.disabled = true;
          finalizeBtn.classList.add("opacity-60", "cursor-not-allowed");
          if (statusEl) statusEl.textContent = "Submitting split transaction...";
          const response = await fetch("/reports/transaction_split", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transaction_id: transactionId,
              line_items: lineItems,
              notes: notes,
              vendor_name: vendorName,
              split_mode: splitState.mode,
              default_category: splitState.defaultCategory,
              transaction_tags: splitState.transactionTags,
              no_split_required: false,
            }),
          });

          const result = await response.json();
          if (submitId !== activeSplitSubmitId) {
            return;
          }
          if (!response.ok || result.success === false) {
            throw new Error(result.message || "Split request failed.");
          }
          splitState.splitId = result.data?.split_id || splitState.splitId;
          syncSplitRequirementInReport({
            transactionId,
            noSplitRequired: false,
            splitDone: true,
          });
          if (statusEl && splitState.pendingRecoveries.length) {
            statusEl.textContent = "Saving split and linking selected refund / payback...";
          }
          await persistPendingRecoveries(result.data?.line_items || []);
          closeSplitModal();
        } catch (error) {
          if (finalizeBtn.isConnected) {
            finalizeBtn.disabled = false;
            finalizeBtn.classList.remove("opacity-60", "cursor-not-allowed");
          }
          console.error("Split transaction error:", error);
          if (statusEl) {
            statusEl.textContent = error.message || "Failed to submit split transaction.";
          }
        }
      });
    }
  }

  function bindSplitModalControls() {
    const discardBtn = document.getElementById("split-discard-changes");
    const closeBtn = document.getElementById("split-close-btn");
    const vendorInputEl = document.getElementById("split-vendor-name");
    const notesInputEl = getSplitNotes();
    const addItemBtn = document.getElementById("split-add-line-item");
    const itemizedBtn = document.getElementById("split-mode-itemized");
    const quickBtn = document.getElementById("split-mode-quick");
    const onlyMineBtn = document.getElementById("split-only-mine");
    const applyEqualBtn = document.getElementById("split-apply-equal");
    const applyMyShareBtn = document.getElementById("split-apply-my-share");
    const noSplitRequiredToggle = document.getElementById("split-no-required-toggle");
    const recoveryPickerCloseBtn = document.getElementById("split-recovery-picker-close");
    const recoveryPickerEl = document.getElementById("split-recovery-picker");
    const lineItemsContainer = getSplitLineItemsContainer();

    if (discardBtn && discardBtn.dataset.bound !== "1") {
      discardBtn.dataset.bound = "1";
      discardBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeSplitModal();
      });
    }

    if (closeBtn && closeBtn.dataset.bound !== "1") {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        closeSplitModal();
      });
    }

    if (vendorInputEl && vendorInputEl.dataset.bound !== "1") {
      vendorInputEl.dataset.bound = "1";
      vendorInputEl.addEventListener("input", function () {
        markSplitEditingStarted();
      });
    }

    if (notesInputEl && notesInputEl.dataset.bound !== "1") {
      notesInputEl.dataset.bound = "1";
      notesInputEl.addEventListener("input", function () {
        markSplitEditingStarted();
      });
    }

    if (addItemBtn && addItemBtn.dataset.bound !== "1") {
      addItemBtn.dataset.bound = "1";
        addItemBtn.addEventListener("click", function () {
          addSplitLineItem({
            item_name:
            splitState.mode === "quick"
              ? buildDefaultSplitItemName(splitState.lineItems.length, "Other")
              : `Item ${splitState.lineItems.length + 1}`,
            expense_for:
              splitState.mode === "quick" ? "Other" : SPLIT_EXPENSE_FOR_OPTIONS[splitState.lineItems.length % SPLIT_EXPENSE_FOR_OPTIONS.length],
            category: splitState.defaultCategory,
            amount: 0,
          });
        });
      }

    if (itemizedBtn && itemizedBtn.dataset.bound !== "1") {
      itemizedBtn.dataset.bound = "1";
      itemizedBtn.addEventListener("click", function () {
        setSplitMode("itemized");
      });
    }

    if (quickBtn && quickBtn.dataset.bound !== "1") {
      quickBtn.dataset.bound = "1";
      quickBtn.addEventListener("click", function () {
        setSplitMode("quick");
      });
    }

    if (onlyMineBtn && onlyMineBtn.dataset.bound !== "1") {
      onlyMineBtn.dataset.bound = "1";
      onlyMineBtn.addEventListener("click", function () {
        applyOnlyMineShortcut();
      });
    }

    if (applyEqualBtn && applyEqualBtn.dataset.bound !== "1") {
      applyEqualBtn.dataset.bound = "1";
      applyEqualBtn.addEventListener("click", function () {
        const equalCountEl = document.getElementById("split-equal-count");
        applyEqualSplitShortcut(equalCountEl?.value);
      });
    }

    if (applyMyShareBtn && applyMyShareBtn.dataset.bound !== "1") {
      applyMyShareBtn.dataset.bound = "1";
      applyMyShareBtn.addEventListener("click", function () {
        const myShareAmountEl = document.getElementById("split-my-share-amount");
        const myShareOtherEl = document.getElementById("split-my-share-other");
        applyMyShareShortcut(myShareAmountEl?.value, myShareOtherEl?.value);
      });
    }

    if (noSplitRequiredToggle && noSplitRequiredToggle.dataset.bound !== "1") {
      noSplitRequiredToggle.dataset.bound = "1";
      noSplitRequiredToggle.addEventListener("change", function () {
        applySplitNoRequiredState(this.checked, false);
      });
    }

    if (recoveryPickerCloseBtn && recoveryPickerCloseBtn.dataset.bound !== "1") {
      recoveryPickerCloseBtn.dataset.bound = "1";
      recoveryPickerCloseBtn.addEventListener("click", function () {
        closeRecoveryPicker();
      });
    }

    if (recoveryPickerEl && recoveryPickerEl.dataset.bound !== "1") {
      recoveryPickerEl.dataset.bound = "1";
      recoveryPickerEl.addEventListener("click", function (e) {
        if (e.target === recoveryPickerEl) {
          closeRecoveryPicker();
          return;
        }

        const pickBtn = e.target.closest("[data-recovery-pick]");
        if (pickBtn) {
          handleLinkRecovery(pickBtn.dataset.recoveryPick);
        }
      });
    }

    if (lineItemsContainer && lineItemsContainer.dataset.bound !== "1") {
      lineItemsContainer.dataset.bound = "1";

      lineItemsContainer.addEventListener("input", function (e) {
        const fieldEl = e.target.closest("[data-field]");
        const rowEl = e.target.closest("[data-line-item-id]");
        if (!fieldEl || !rowEl) return;
        updateSplitLineItem(rowEl.dataset.lineItemId, fieldEl.dataset.field, fieldEl.value);
      });

      lineItemsContainer.addEventListener("change", function (e) {
        const fieldEl = e.target.closest("[data-field]");
        const rowEl = e.target.closest("[data-line-item-id]");
        if (!fieldEl || !rowEl) return;
        updateSplitLineItem(rowEl.dataset.lineItemId, fieldEl.dataset.field, fieldEl.value);
      });

      lineItemsContainer.addEventListener("click", function (e) {
        const recoveryTrigger = e.target.closest("[data-recovery-trigger], [data-recovery-toggle]");
        if (recoveryTrigger) {
          const rowEl = recoveryTrigger.closest("[data-line-item-id]");
          const recoveryToggle = rowEl?.querySelector("[data-recovery-toggle]");
          if (rowEl) {
            const rowItem = splitState.lineItems.find((item) => item.id === rowEl.dataset.lineItemId);
            if (!rowItem || normalizeAmount(rowItem.amount) <= 0) {
              if (recoveryToggle) recoveryToggle.checked = false;
              return;
            }
            if (recoveryToggle) {
              recoveryToggle.checked = getRecoveriesForLineItem(rowEl.dataset.lineItemId).length > 0 || true;
            }
            openRecoveryPicker(rowEl.dataset.lineItemId);
          }
          return;
        }

        const removeRecoveryBtn = e.target.closest("[data-remove-recovery]");
        if (removeRecoveryBtn) {
          removeLinkedRecovery(removeRecoveryBtn.dataset.removeRecovery);
          return;
        }

        const editRecoveryBtn = e.target.closest("[data-edit-recovery]");
        if (editRecoveryBtn) {
          const recoveryId  = editRecoveryBtn.dataset.editRecovery;
          const currentAmt  = editRecoveryBtn.dataset.editAmount;
          const chip        = editRecoveryBtn.closest("[data-recovery-chip]");
          const labelSpan   = chip?.querySelector(".recovery-label");
          if (!chip || !labelSpan) return;
          // Replace label with inline input
          const origHTML = labelSpan.innerHTML;
          labelSpan.innerHTML = `
            <input type="number" step="0.01" min="0.01"
              value="${escapeHtml(currentAmt)}"
              class="w-24 rounded border border-emerald-300 bg-white px-1 py-0.5 text-[11px] text-slate-800 focus:outline-none"
              id="edit-rec-input-${escapeHtml(recoveryId)}" />
            <button type="button" id="edit-rec-confirm-${escapeHtml(recoveryId)}"
              class="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700">✓</button>
            <button type="button" id="edit-rec-cancel-${escapeHtml(recoveryId)}"
              class="ml-0.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-300">✕</button>`;
          document.getElementById(`edit-rec-input-${recoveryId}`)?.focus();
          document.getElementById(`edit-rec-confirm-${recoveryId}`)?.addEventListener("click", async () => {
            const val = document.getElementById(`edit-rec-input-${recoveryId}`)?.value;
            await editRecoveryAmount(recoveryId, val);
          });
          document.getElementById(`edit-rec-cancel-${recoveryId}`)?.addEventListener("click", () => {
            labelSpan.innerHTML = origHTML;
          });
          return;
        }

        const removeBtn = e.target.closest("[data-remove-line-item]");
        const rowEl = e.target.closest("[data-line-item-id]");
        if (!removeBtn || !rowEl) return;
        removeSplitLineItem(rowEl.dataset.lineItemId);
      });
    }
  }

  function closeSplitModal() {
    const splitModalEl = document.getElementById("split-transaction-modal");
    const statusEl = document.getElementById("split-submit-status");
    const finalizeBtn = document.getElementById("split-finalize-btn");
    if (!splitModalEl) return;
    activeSplitRequestId += 1;
    activeSplitSubmitId += 1;
    splitState = createInitialSplitState();
    closeRecoveryPicker();
    splitModalEl.classList.add("hidden");
    splitModalEl.style.display = "";
    splitModalEl.dataset.txnId = "";
    if (statusEl) statusEl.textContent = "";
    if (finalizeBtn) {
      finalizeBtn.disabled = false;
      finalizeBtn.classList.remove("opacity-60", "cursor-not-allowed");
    }
    applySplitNoRequiredState(false, false);
    setSplitActionAvailability(false);
    if (getSplitNotes()) getSplitNotes().value = "";
  }

  function openSplitModal() {
    const splitModalEl = document.getElementById("split-transaction-modal");
    if (!splitModalEl) {
      console.error("split-transaction-modal not found");
      return;
    }
    if (splitModalEl.parentElement !== document.body) {
      document.body.appendChild(splitModalEl);
    }
    splitModalEl.hidden = false;
    splitModalEl.removeAttribute("hidden");
    splitModalEl.classList.remove("hidden");
    splitModalEl.style.display = "flex";
    bindSplitModalControls();
  }
});

document.addEventListener("click", (event) => {
  const preserveLink = event.target.closest("[data-preserve-report-state='1']");
  if (!preserveLink) return;
  persistReportPageState();
  const href = preserveLink.getAttribute("href") || "";
  const match = href.match(/\/classification\/transaction\/([^/?#]+)/i);
  if (match?.[1]) {
    persistReportFocusTransaction(decodeURIComponent(match[1]));
  }
});

window.addEventListener("pageshow", async (event) => {
  const navigation = performance.getEntriesByType("navigation")?.[0];
  const isHistoryReturn = event.persisted || navigation?.type === "back_forward";
  if (!isHistoryReturn) return;
  const shouldForceRefresh = consumeReportForceRefreshFlag();
  const restored = restoreReportPageState();
  if (!restored) return;
  await submitSearch();
  restoreReportScrollPosition();
  restoreFocusedTransactionRow();
});


document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tag]");
  if (!btn) return;

  const tag = btn.dataset.tag;
  btn.parentElement.remove(); // remove from UI
});

// ── Confirm auto-tagged ───────────────────────────────────────────────────────

function updateConfirmAutoButton() {
  const btn = document.getElementById("confirm-auto-btn");
  const label = document.getElementById("confirm-auto-label");
  if (!btn) return;
  const autoIds = (currentReportTransactions || [])
    .filter(tx => !tx.review_status_manual && Array.isArray(tx.tags) && tx.tags.filter(Boolean).length > 0)
    .map(tx => tx.id);
  if (autoIds.length > 0) {
    btn.classList.remove("hidden");
    if (label) label.textContent = `Confirm auto-tagged (${autoIds.length})`;
  } else {
    btn.classList.add("hidden");
  }
}

async function confirmAutoTagged() {
  const btn = document.getElementById("confirm-auto-btn");
  const label = document.getElementById("confirm-auto-label");
  const autoIds = (currentReportTransactions || [])
    .filter(tx => !tx.review_status_manual && Array.isArray(tx.tags) && tx.tags.filter(Boolean).length > 0)
    .map(tx => tx.id);
  if (!autoIds.length) return;

  const originalLabel = label ? label.textContent : "";
  if (btn) btn.disabled = true;
  if (label) label.textContent = `Confirming ${autoIds.length}…`;

  try {
    const res = await fetch("/reports/bulk_confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: autoIds }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      const confirmedSet = new Set(autoIds);
      currentReportTransactions.forEach(tx => {
        if (confirmedSet.has(tx.id)) tx.review_status_manual = true;
      });
      renderTransactionTable(currentReportTransactions);
      updateConfirmAutoButton();
    } else {
      if (label) label.textContent = data.message || "Failed";
    }
  } catch (e) {
    console.error("Bulk confirm failed", e);
    if (label) label.textContent = e.name === "TimeoutError" ? "Timed out — try a smaller filter" : "Failed — try again";
  } finally {
    if (btn) btn.disabled = false;
    // Reset label after 3s if still showing error/progress text
    setTimeout(() => { if (label && !label.textContent.startsWith("Confirm")) updateConfirmAutoButton(); }, 3000);
  }
}

// ── Export functions ──────────────────────────────────────────────────────────

function exportCsv() {
  const rows = currentReportTransactions;
  if (!rows || !rows.length) {
    window.toast?.error("No transactions to export. Apply filters first to load transactions.");
    return;
  }

  const COLS = [
    { h: "Date",          f: r => r.transaction_date || "" },
    { h: "Merchant",      f: r => r.vendor_name || r.counterparty_identifier || "" },
    { h: "Narration",     f: r => r.narration || "" },
    { h: "Direction",     f: r => r.direction || "" },
    { h: "Amount",        f: r => Math.abs(Number(r.amount || 0)).toFixed(2) },
    { h: "Net Amount",    f: r => Math.abs(Number(r.net_amount || 0)).toFixed(2) },
    { h: "Tags",          f: r => (Array.isArray(r.tags) ? r.tags : []).join("; ") },
    { h: "Source",        f: r => r.payment_source_name || r.statement_sources || "" },
    { h: "Review Status", f: r => r.review_status || "" },
    { h: "Tag Status",    f: r => r.tag_status || "" },
    { h: "Counterparty",  f: r => r.counterparty_identifier || "" },
    { h: "ID",            f: r => r.id || "" },
  ];

  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const header = COLS.map(c => esc(c.h)).join(",");
  const body   = rows.map(r => COLS.map(c => esc(c.f(r))).join(",")).join("\n");
  const csv    = header + "\n" + body;

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPdf() {
  window.print();
}
