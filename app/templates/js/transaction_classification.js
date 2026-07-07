const classificationState = {
  transaction: null,
  split: null,
  categories: [],
  activeMode: "simple",
  savedMode: "",
  simpleCategoryTouched: false,
  simpleReviewStatusManual: false,
  simpleNatureManual: false,
  simplePartyManual: false,
  simpleVendorManual: false,
  simpleContextExpanded: false,
  learnedDefaults: null,
  selfTransferCandidates: [],
  splitRows: [],
  recoveryCandidates: [],
  pendingRecoveries: [],
  selfShare: {
    item_name: "My Share",
    amount: 0,
    category_id: "",
    subcategory_id: "",
  },
};
const REPORT_FORCE_REFRESH_KEY = "expense_tracker_report_force_refresh_v2";
const SIMPLE_REVIEW_STATUS_OPTIONS = [
  {
    value: "confirmed",
    label: "Done",
    description: "You know enough to close this transaction out.",
    activeClass: "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-emerald-100",
    pillClass: "bg-emerald-100 text-emerald-700",
  },
  {
    value: "needs_review",
    label: "Needs Review",
    description: "You have part of the story, but not the full picture yet.",
    activeClass: "border-amber-300 bg-amber-50 text-amber-900 shadow-amber-100",
    pillClass: "bg-amber-100 text-amber-700",
  },
  {
    value: "unknown",
    label: "Unknown",
    description: "You opened it, but still cannot confidently explain it.",
    activeClass: "border-slate-300 bg-slate-100 text-slate-900 shadow-slate-200",
    pillClass: "bg-slate-200 text-slate-700",
  },
  {
    value: "no_action_needed",
    label: "No Action",
    description: "This is understood enough and does not need more follow-up.",
    activeClass: "border-sky-300 bg-sky-50 text-sky-900 shadow-sky-100",
    pillClass: "bg-sky-100 text-sky-700",
  },
  {
    value: "unreviewed",
    label: "Unreviewed",
    description: "Leave it untouched for now and come back later.",
    activeClass: "border-violet-300 bg-violet-50 text-violet-900 shadow-violet-100",
    pillClass: "bg-violet-100 text-violet-700",
  },
];
const SIMPLE_NATURE_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the money purpose undecided for now." },
  { value: "expense", label: "Expense", description: "Money went out for spending or consumption.", allowedDirections: ["withdrawal"] },
  { value: "income", label: "Income", description: "Money came in as earnings or inflow.", allowedDirections: ["deposit"] },
  { value: "transfer", label: "Transfer", description: "Money moved between your own balances.", allowedDirections: ["withdrawal", "deposit"] },
  { value: "charge", label: "Fee / Charge", description: "Bank, platform, or service charge.", allowedDirections: ["withdrawal", "deposit"] },
];
// allowedDirections: options shown only for matching direction. Omit = always shown.
// direction values in DB: "withdrawal" (debit) | "deposit" | "credit" (both = incoming)
const CREDIT_DIRS = ["deposit", "credit"];
const DEBIT_DIRS  = ["withdrawal"];

const SIMPLE_BUCKET_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the transaction in the default flow and only use name and category." },
  { value: "merchant", label: "Merchant", description: "Business, store, seller, subscription, or service." },
  { value: "friend", label: "Friend", description: "A friend, roommate, or someone you split things with." },
  { value: "family", label: "Family", description: "Family or household related." },
  { value: "self_transfer", label: "Self Transfer", description: "Money moved between your own accounts." },
  { value: "income", label: "Income", description: "Money credited in as earnings or inflow.", allowedDirections: CREDIT_DIRS },
  { value: "employer", label: "Employer", description: "Salary, office payment, or work reimbursement.", allowedDirections: CREDIT_DIRS },
  { value: "unknown", label: "Unknown", description: "You want the app to remember that the identity is still unclear." },
];
const SIMPLE_PARTY_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the related party undecided." },
  { value: "self", label: "Self", description: "Primarily for you or between your own accounts." },
  { value: "friend", label: "Friend", description: "Involves a friend or roommate." },
  { value: "family", label: "Family", description: "Involves family or household sharing." },
  { value: "merchant", label: "Merchant", description: "This is mainly with a business or seller." },
  { value: "employer", label: "Employer", description: "Connected to work, salary, or office reimbursements.", allowedDirections: CREDIT_DIRS },
  { value: "unknown", label: "Unknown", description: "The related person or entity is still unclear." },
];
const SIMPLE_COUNTERPARTY_TYPE_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the other side unspecified for now." },
  { value: "merchant", label: "Merchant", description: "A store, seller, app, subscription, or service provider." },
  { value: "friend", label: "Friend", description: "A friend, roommate, or other personal contact." },
  { value: "family", label: "Family", description: "Family member or household connection." },
  { value: "employer", label: "Employer", description: "Office, salary source, or work-related payer.", allowedDirections: CREDIT_DIRS },
  { value: "bank", label: "Bank", description: "Bank, card issuer, lender, or account provider." },
  { value: "government", label: "Government", description: "Tax, utility board, authority, or public body." },
  { value: "unknown", label: "Unknown", description: "You want the app to remember that the counterparty is unclear." },
];
const SIMPLE_PRIMARY_FLOW_TYPE_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the main money movement unspecified." },
  { value: "expense", label: "Expense", description: "A normal outgoing spend or cost.", allowedDirections: DEBIT_DIRS },
  { value: "income", label: "Income", description: "A normal incoming payment, earning, or credit.", allowedDirections: CREDIT_DIRS },
  { value: "cashback", label: "Cashback", description: "Reward, cashback, or promotional credit received back.", allowedDirections: CREDIT_DIRS },
  { value: "refund", label: "Refund", description: "Money returned against an earlier expense.", allowedDirections: CREDIT_DIRS },
  { value: "transfer", label: "Transfer", description: "Money moved between your own balances." },
  { value: "investment_buy", label: "Investment Buy", description: "Money moved into an investment holding.", allowedDirections: DEBIT_DIRS },
  { value: "investment_sell", label: "Investment Sell", description: "Money came back from selling an investment.", allowedDirections: CREDIT_DIRS },
  { value: "loan_given", label: "Loan Given", description: "You paid out money that should come back later.", allowedDirections: DEBIT_DIRS },
  { value: "loan_taken", label: "Loan Taken", description: "You received money that you need to return later.", allowedDirections: CREDIT_DIRS },
  { value: "repayment_in", label: "Repayment In", description: "Someone paid back money owed to you.", allowedDirections: CREDIT_DIRS },
  { value: "repayment_out", label: "Repayment Out", description: "You repaid money you owed to someone else.", allowedDirections: DEBIT_DIRS },
  { value: "fee", label: "Fee", description: "Charge, penalty, commission, or service fee.", allowedDirections: DEBIT_DIRS },
];
const SIMPLE_CONSUMPTION_OWNERSHIP_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the beneficiary unspecified for now." },
  { value: "self", label: "Self", description: "This spend or benefit is mainly yours." },
  { value: "family_household", label: "Family / Household", description: "Family or shared-home consumption." },
  { value: "shared", label: "Shared", description: "A mixed bill shared with other people." },
  { value: "business", label: "Business", description: "Business, office, client, or work expense." },
  { value: "other", label: "Other", description: "Someone else benefited, but it does not fit the main groups." },
  { value: "not_consumption", label: "Not Consumption", description: "Transfer, repayment, investment, or other non-spend flow." },
];
const SIMPLE_SETTLEMENT_STATE_OPTIONS = [
  { value: "", label: "Not Set", description: "Leave the finality of the amount unspecified." },
  { value: "none", label: "None", description: "No extra obligation is attached to this transaction." },
  { value: "owed_to_me", label: "Owed To Me", description: "Someone still needs to pay you back.", allowedDirections: DEBIT_DIRS },
  { value: "i_owe", label: "I Owe", description: "You still owe part or all of this amount.", allowedDirections: CREDIT_DIRS },
  { value: "partial", label: "Partial", description: "Some of the amount is settled and some is still open." },
  { value: "settled", label: "Settled", description: "A previous obligation tied to this is fully settled." },
];

const initialMode = new URLSearchParams(window.location.search).get("mode") || "";

async function parseJsonResponse(response) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    const cleaned = (rawText || "").trim();
    const message = cleaned ? cleaned.slice(0, 240) : "Unexpected empty response.";
    throw new Error(message);
  }
}

function formatINR(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortenUPI(id, maxLen = 22) {
  if (!id || id.length <= maxLen) return id;
  const at = id.lastIndexOf("@");
  if (at > 0) {
    const provider = id.slice(at);
    const prefix   = id.slice(0, at);
    const keep     = Math.max(4, maxLen - provider.length - 1);
    return prefix.slice(0, keep) + "…" + provider;
  }
  return id.slice(0, maxLen - 1) + "…";
}

function hasSavedSimpleCategoryDecision() {
  const transaction = classificationState.transaction || {};
  const tagNames = Array.isArray(transaction.tag_names) ? transaction.tag_names.filter(Boolean) : [];
  return Boolean(transaction.no_tag_required) || tagNames.length > 0;
}

function getSimpleCategoryDecisionState() {
  const categoryId = document.getElementById("simple-category")?.value || "";
  const subcategoryId = getSelectedSimpleSubcategoryId();
  const noTagRequired = Boolean(document.getElementById("simple-no-tag-required")?.checked);
  return Boolean(noTagRequired || subcategoryId || (classificationState.simpleCategoryTouched && categoryId));
}

function getTransactionDirection() {
  return String(classificationState.transaction?.direction || "").trim().toLowerCase();
}

function getAvailableOptions(options) {
  const direction = getTransactionDirection();
  return options.filter((opt) => !opt.allowedDirections || opt.allowedDirections.includes(direction));
}

function getAvailableSimpleNatureOptions() {
  return getAvailableOptions(SIMPLE_NATURE_OPTIONS);
}

function syncPillDirections() {
  const dir = getTransactionDirection();
  const isDebit  = dir === "withdrawal";
  const isCredit = dir === "deposit" || dir === "credit";
  document.querySelectorAll("[data-dir]").forEach((btn) => {
    const d = btn.dataset.dir;
    const hide = (d === "debit" && !isDebit) || (d === "credit" && !isCredit);
    btn.style.display = hide ? "none" : "";
  });
}

function inferSimpleBucketFromFields(partyType, transactionNature) {
  const normalizedPartyType = String(partyType || "").trim().toLowerCase();
  const normalizedNature = String(transactionNature || "").trim().toLowerCase();

  if (normalizedPartyType === "self" || normalizedNature === "transfer") return "self_transfer";
  if (normalizedNature === "income" && !normalizedPartyType) return "income";
  if (["merchant", "friend", "family", "employer", "unknown"].includes(normalizedPartyType)) {
    return normalizedPartyType;
  }
  return "";
}

function mapSimpleBucketToFields(bucketValue) {
  const normalizedBucket = String(bucketValue || "").trim().toLowerCase();
  if (normalizedBucket === "self_transfer") {
    return { partyType: "self", transactionNature: "transfer" };
  }
  if (normalizedBucket === "income") {
    return { partyType: "", transactionNature: "income" };
  }
  if (["merchant", "friend", "family", "employer", "unknown"].includes(normalizedBucket)) {
    return {
      partyType: normalizedBucket,
      transactionNature: normalizedBucket === "unknown" ? "" : inferSimpleNatureFromParty(normalizedBucket),
    };
  }
  return { partyType: "", transactionNature: "" };
}

function getSimpleVendorDecisionValue() {
  return String(document.getElementById("simple-vendor")?.value || "").trim();
}

function inferSimpleNatureFromParty(partyType) {
  const direction = getTransactionDirection();
  const normalizedPartyType = String(partyType || "").trim().toLowerCase();
  if (direction === "deposit") {
    return normalizedPartyType === "self" ? "transfer" : "income";
  }
  if (direction === "withdrawal") {
    if (normalizedPartyType === "self") return "transfer";
    return "expense";
  }
  if (normalizedPartyType === "self") {
    return "transfer";
  }
  return "";
}

function normalizeLegacyCounterpartyType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["merchant", "friend", "family", "employer", "unknown"].includes(normalized) ? normalized : "";
}

function normalizeLegacyPrimaryFlowType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["expense", "income", "transfer"].includes(normalized)) return normalized;
  if (normalized === "charge") return "fee";
  if (normalized === "reimbursement") return "refund";
  return "";
}

function mapCounterpartyTypeToLegacyParty(counterpartyType) {
  const normalized = String(counterpartyType || "").trim().toLowerCase();
  return ["merchant", "friend", "family", "employer", "unknown"].includes(normalized) ? normalized : "";
}

function mapPrimaryFlowTypeToLegacyNature(primaryFlowType) {
  const normalized = String(primaryFlowType || "").trim().toLowerCase();
  if (["expense", "income", "transfer"].includes(normalized)) return normalized;
  if (normalized === "fee") return "charge";
  if (normalized === "refund") return "reimbursement";
  return "";
}

function getSelectedStructuredCounterpartyType() {
  return String(document.getElementById("simple-counterparty-type")?.value || "").trim();
}

function getSelectedStructuredPrimaryFlowType() {
  return String(document.getElementById("simple-primary-flow-type")?.value || "").trim();
}

function getSelectedStructuredConsumptionOwnership() {
  return String(document.getElementById("simple-consumption-ownership")?.value || "").trim();
}

function getSelectedStructuredSettlementState() {
  return String(document.getElementById("simple-settlement-state")?.value || "").trim();
}

function getResolvedSimpleNature() {
  const currentValue = String(document.getElementById("simple-transaction-nature")?.value || "").trim();
  if (currentValue) return currentValue;
  return inferSimpleNatureFromParty(document.getElementById("simple-party-type")?.value || "");
}

function getResolvedSimpleBucket() {
  const bucketValue = String(document.getElementById("simple-bucket")?.value || "").trim();
  if (bucketValue) return bucketValue;
  return inferSimpleBucketFromFields(
    document.getElementById("simple-party-type")?.value || "",
    document.getElementById("simple-transaction-nature")?.value || "",
  );
}

function isLearnedDefaultActive(fieldName, value) {
  const learnedDefaults = classificationState.learnedDefaults || {};
  const transaction = classificationState.transaction || {};
  if (!value || String(learnedDefaults[fieldName] || "").trim() !== String(value || "").trim()) {
    return false;
  }
  if (fieldName === "party_type") {
    return !String(transaction.party_type || "").trim() && !classificationState.simplePartyManual;
  }
  if (fieldName === "transaction_nature") {
    return !String(transaction.transaction_nature || "").trim() && !classificationState.simpleNatureManual;
  }
  if (fieldName === "simple_bucket") {
    const learnedBucket = inferSimpleBucketFromFields(
      learnedDefaults.party_type || "",
      learnedDefaults.transaction_nature || "",
    );
    const transactionBucket = inferSimpleBucketFromFields(
      transaction.party_type || transaction.counterparty_entity_type || "",
      transaction.transaction_nature || "",
    );
    return learnedBucket === String(value || "").trim()
      && !transactionBucket
      && !classificationState.simplePartyManual
      && !classificationState.simpleNatureManual;
  }
  return false;
}

function deriveAutoReviewStatus() {
  const transactionNature = getResolvedSimpleNature();
  const bucketValue = getResolvedSimpleBucket();
  const partyType = document.getElementById("simple-party-type")?.value || "";
  const counterpartyType = getSelectedStructuredCounterpartyType();
  const primaryFlowType = getSelectedStructuredPrimaryFlowType();
  const consumptionOwnership = getSelectedStructuredConsumptionOwnership();
  const settlementState = getSelectedStructuredSettlementState();
  const selfTransferTarget = document.getElementById("simple-self-transfer-transaction")?.value || "";
  const hasCategoryDecision = getSimpleCategoryDecisionState();
  const hasVendor = Boolean(getSimpleVendorDecisionValue());
  const hasNature = Boolean(transactionNature || primaryFlowType);
  const hasParty = Boolean(bucketValue || partyType || counterpartyType);
  const hasStructuredMeaning = Boolean(counterpartyType || primaryFlowType || consumptionOwnership || settlementState);
  const noTagRequired = Boolean(document.getElementById("simple-no-tag-required")?.checked);

  if (selfTransferTarget || noTagRequired || (hasVendor && (hasCategoryDecision || hasParty || hasStructuredMeaning))) {
    return "confirmed";
  }
  if (hasCategoryDecision || hasVendor || hasNature || hasParty || hasStructuredMeaning) {
    return "needs_review";
  }
  if (!hasCategoryDecision && !hasVendor && !hasNature && !hasParty && !hasStructuredMeaning) {
    return "unknown";
  }
  return "needs_review";
}

function getSimpleReviewStatusMeta(statusValue) {
  return SIMPLE_REVIEW_STATUS_OPTIONS.find((option) => option.value === statusValue) || SIMPLE_REVIEW_STATUS_OPTIONS[SIMPLE_REVIEW_STATUS_OPTIONS.length - 1];
}

function updateSimpleReviewSummary() {
  const statusEl = document.getElementById("simple-review-status");
  if (!statusEl) return;
  const statusMeta = getSimpleReviewStatusMeta(statusEl.value || "unreviewed");
  const stripEl = document.getElementById("simple-auto-review-strip");
  const stripPillEl = document.getElementById("simple-auto-review-pill");
  const stripCopyEl = document.getElementById("simple-auto-review-copy");
  const mainCardEl = document.getElementById("simple-main-details-card");
  const spendCardEl = document.getElementById("simple-spend-category-card");
  const contextCardEl = document.getElementById("simple-context-card");
  const vendorInputEl = document.getElementById("simple-vendor");
  const categoryInputEl = document.getElementById("simple-category");
  const noTagRequired = Boolean(document.getElementById("simple-no-tag-required")?.checked);
  const hasVendor = Boolean(getSimpleVendorDecisionValue());
  const hasCategoryDecision = getSimpleCategoryDecisionState();
  const hasStructuredMeaning = Boolean(
    getSelectedStructuredCounterpartyType()
    || getSelectedStructuredPrimaryFlowType()
    || getSelectedStructuredConsumptionOwnership()
    || getSelectedStructuredSettlementState()
  );

  if (stripEl && stripPillEl && stripCopyEl) {
    stripEl.className = "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border px-4 py-3 shadow-sm transition-colors";
    stripPillEl.className = "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold";
    if (statusMeta.value === "confirmed" || statusMeta.value === "no_action_needed") {
      stripEl.classList.add("border-emerald-200", "bg-emerald-50/80");
      stripPillEl.classList.add("bg-emerald-100", "text-emerald-700");
      stripPillEl.textContent = statusMeta.value === "confirmed" ? "Ready" : "No follow-up";
      stripCopyEl.textContent = statusMeta.value === "confirmed"
        ? "Core details are complete enough. The system no longer treats this row as pending."
        : "The system sees this row as understood enough without more follow-up.";
    } else if (statusMeta.value === "needs_review") {
      stripEl.classList.add("border-amber-200", "bg-amber-50/80");
      stripPillEl.classList.add("bg-amber-100", "text-amber-700");
      stripPillEl.textContent = "Pending";
      stripCopyEl.textContent = "Some details are present, but the system still sees this row as pending review.";
    } else {
      stripEl.classList.add("border-slate-200", "bg-white");
      stripPillEl.classList.add("bg-slate-100", "text-slate-600");
      stripPillEl.textContent = "Not started";
      stripCopyEl.textContent = "The system will mark this automatically once you fill the key fields below.";
    }
  }

  const applyCardTone = (element, state) => {
    if (!element) return;
    element.classList.remove("border-emerald-200", "bg-emerald-50/40", "border-amber-200", "bg-amber-50/50", "border-slate-200", "bg-white", "bg-slate-50/70");
    if (state === "done") {
      element.classList.add("border-emerald-200", "bg-emerald-50/40");
    } else if (state === "pending") {
      element.classList.add("border-amber-200", "bg-amber-50/50");
    } else {
      element.classList.add("border-slate-200");
      if (element.id === "simple-spend-category-card") {
        element.classList.add("bg-slate-50/70");
      } else {
        element.classList.add("bg-white");
      }
    }
  };

  const applyInputTone = (element, state) => {
    if (!element) return;
    element.classList.remove("border-emerald-300", "bg-emerald-50/70", "border-amber-300", "bg-amber-50/70", "border-slate-200", "bg-slate-50");
    if (state === "done") {
      element.classList.add("border-emerald-300", "bg-emerald-50/70");
    } else if (state === "pending") {
      element.classList.add("border-amber-300", "bg-amber-50/70");
    } else {
      element.classList.add("border-slate-200", "bg-slate-50");
    }
  };

  applyCardTone(mainCardEl, hasVendor ? "done" : statusMeta.value === "needs_review" ? "pending" : "idle");
  applyCardTone(spendCardEl, (hasCategoryDecision || noTagRequired) ? "done" : statusMeta.value === "needs_review" ? "pending" : "idle");
  applyCardTone(contextCardEl, hasStructuredMeaning ? "done" : "idle");
  applyInputTone(vendorInputEl, hasVendor ? "done" : statusMeta.value === "needs_review" ? "pending" : "idle");
  applyInputTone(categoryInputEl, (hasCategoryDecision || noTagRequired) ? "done" : statusMeta.value === "needs_review" ? "pending" : "idle");

  const headlineEl = document.getElementById("simple-review-headline");
  const hintEl = document.getElementById("simple-review-hint");
  const modeEl = document.getElementById("simple-review-mode");
  const summaryCardEl = document.getElementById("simple-review-summary-card");
  if (!headlineEl || !hintEl || !modeEl || !summaryCardEl) return;
  headlineEl.textContent = statusMeta.label;
  hintEl.textContent = statusMeta.description;
  modeEl.textContent = classificationState.simpleReviewStatusManual ? "Manual" : "Auto";
  modeEl.className = `mt-3 inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${
    classificationState.simpleReviewStatusManual ? "bg-white text-slate-900" : "bg-slate-100 text-slate-600"
  }`;
  summaryCardEl.className = "rounded-3xl border p-5 shadow-sm transition-colors";
  if (statusMeta.value === "confirmed") {
    summaryCardEl.classList.add("border-emerald-200", "bg-emerald-50/80");
  } else if (statusMeta.value === "needs_review") {
    summaryCardEl.classList.add("border-amber-200", "bg-amber-50/80");
  } else if (statusMeta.value === "unknown") {
    summaryCardEl.classList.add("border-slate-300", "bg-slate-100/80");
  } else if (statusMeta.value === "no_action_needed") {
    summaryCardEl.classList.add("border-sky-200", "bg-sky-50/80");
  } else {
    summaryCardEl.classList.add("border-slate-200", "bg-white");
  }
}

function updateLearnedVendorNote() {
  const noteEl = document.getElementById("simple-vendor-learned");
  if (!noteEl) return;
  const learnedDefaults = classificationState.learnedDefaults || {};
  const transaction = classificationState.transaction || {};
  const learnedVendor = String(learnedDefaults.vendor_name || "").trim();
  const inputValue = getSimpleVendorDecisionValue();
  const matchCount = Number(learnedDefaults.match_count || 0);
  const aliasCount = Number(learnedDefaults.alias_count || 0);
  const isActive = Boolean(learnedVendor)
    && !String(transaction.vendor_name || "").trim()
    && !classificationState.simpleVendorManual
    && inputValue === learnedVendor;

  noteEl.classList.toggle("hidden", !isActive);
  if (!isActive) {
    noteEl.textContent = "";
    return;
  }
  if (aliasCount > 1) {
    noteEl.textContent = `Known identity across ${aliasCount} UPI ids and ${matchCount} similar transaction${matchCount === 1 ? "" : "s"}`;
    return;
  }
  noteEl.textContent = matchCount > 0
    ? `Learned from ${matchCount} similar transaction${matchCount === 1 ? "" : "s"}`
    : "Learned from similar transactions";
}

function updateSimpleIdentityHint() {
  const hintEl = document.getElementById("simple-identity-hint");
  if (!hintEl) return;

  const bucketValue = String(getResolvedSimpleBucket() || "").trim().toLowerCase();
  const currentName = getSimpleVendorDecisionValue();
  if (bucketValue === "friend" || bucketValue === "family" || bucketValue === "merchant" || bucketValue === "employer") {
    const label = currentName || (bucketValue === "merchant" ? "Merchant A" : "Friend A");
    hintEl.textContent = `Optional: use one shared name like "${label}" only when you are sure different UPI ids belong to the same ${bucketValue}. If you do nothing, this transaction still saves normally.`;
    hintEl.classList.remove("hidden");
    return;
  }

  hintEl.textContent = "";
  hintEl.classList.add("hidden");
}

function syncSimpleContextVisibility() {
  const panel = document.getElementById("simple-context-panel");
  const toggle = document.getElementById("simple-context-toggle");
  if (!panel || !toggle) return;

  panel.classList.toggle("hidden", !classificationState.simpleContextExpanded);
  toggle.innerHTML = classificationState.simpleContextExpanded
    ? '<span class="material-symbols-outlined text-[18px]">expand_less</span>Hide context'
    : '<span class="material-symbols-outlined text-[18px]">tune</span>More context';
}

function renderSimpleSelfTransferOptions() {
  const toggle   = document.getElementById("simple-self-transfer-toggle");
  const linkRow  = document.getElementById("simple-self-transfer-link-row");
  const select   = document.getElementById("simple-self-transfer-transaction");
  const note     = document.getElementById("simple-self-transfer-note");
  const badge    = document.getElementById("simple-self-transfer-badge");
  if (!toggle || !linkRow || !select || !note) return;

  const primaryFlowType = getSelectedStructuredPrimaryFlowType().toLowerCase();
  const candidates = Array.isArray(classificationState.selfTransferCandidates) ? classificationState.selfTransferCandidates : [];
  const alreadyLinked = (classificationState.transaction?.self_transfer_transaction_id || "").trim();
  const isTransfer = primaryFlowType === "transfer";

  // Sync toggle checked state
  toggle.checked = isTransfer;

  // Show badge when candidates auto-detected
  if (badge) badge.classList.toggle("hidden", candidates.length === 0);

  // Show link row only when toggled on
  linkRow.classList.toggle("hidden", !isTransfer);

  if (!isTransfer) {
    select.innerHTML = '<option value="">—</option>';
    note.textContent = "";
    return;
  }

  // Populate candidate dropdown
  const currentValue = String(alreadyLinked || select.value || "");
  const dirLabel = (d) => String(d || "").toLowerCase() === "withdrawal" ? "Dr" : "Cr";
  select.innerHTML = `<option value="">No link — just mark as transfer</option>${candidates.map((c) => {
    const label = [c.transaction_date, dirLabel(c.direction), c.vendor_name || c.counterparty_identifier || "", formatINR(c.amount)].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(c.id)}" ${String(c.id) === currentValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("")}`;

  note.textContent = candidates.length
    ? "Linking marks both sides as self-transfer automatically."
    : "No matching opposite transaction found nearby (same amount, ±7 days). You can still save without linking.";
}

function renderSimpleChoiceGroup({ containerId, selectId, options }) {
  const container = document.getElementById(containerId);
  const select = document.getElementById(selectId);
  if (!container || !select) return;

  const selectedValue = select.value || "";
  const isReviewStatusGroup = selectId === "simple-review-status";
  container.innerHTML = options.map((option) => {
    const isActive = selectedValue === option.value;
    const learnedFieldName =
      selectId === "simple-party-type"
        ? "party_type"
        : selectId === "simple-transaction-nature"
          ? "transaction_nature"
          : "";
    const isLearned = Boolean(learnedFieldName) && isLearnedDefaultActive(learnedFieldName, option.value);
    const activeClass = isLearned
      ? "border-slate-900 bg-slate-900 text-white shadow-slate-300"
      : (option.activeClass || "border-primary/30 bg-primary/5 text-slate-900 shadow-primary/10");
    const pillClass = option.pillClass || "bg-slate-100 text-slate-600";
    const widthClass = isReviewStatusGroup
      ? "w-full max-w-full lg:max-w-[320px] lg:justify-self-end"
      : "w-full";
    return `
      <button
        type="button"
        data-choice-target="${escapeHtml(selectId)}"
        data-choice-value="${escapeHtml(option.value)}"
        class="group flex ${widthClass} items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
          isActive
            ? `${activeClass} shadow-sm`
            : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white"
        }"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold">${escapeHtml(option.label)}</span>
            ${option.value ? `<span class="rounded-full px-2 py-0.5 text-[10px] font-semibold ${pillClass}">${escapeHtml(option.value.replaceAll("_", " "))}</span>` : ""}
            ${isLearned ? '<span class="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-current">learned</span>' : ""}
          </div>
          <p class="mt-1 text-sm leading-6 ${isActive ? "text-current/80" : "text-slate-500"}">${escapeHtml(option.description)}</p>
        </div>
        <span class="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isActive ? "border-current bg-white/70" : "border-slate-300 bg-white"}">
          ${isActive ? '<span class="material-symbols-outlined text-[14px]">check</span>' : ""}
        </span>
      </button>
    `;
  }).join("");
}

function renderSimpleChoiceGroups() {
  renderSimpleChoiceGroup({
    containerId: "simple-review-status-options",
    selectId: "simple-review-status",
    options: SIMPLE_REVIEW_STATUS_OPTIONS,
  });
  renderSimpleChoiceGroup({
    containerId: "simple-bucket-options",
    selectId: "simple-bucket",
    options: getAvailableOptions(SIMPLE_BUCKET_OPTIONS),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-transaction-nature-options",
    selectId: "simple-transaction-nature",
    options: getAvailableSimpleNatureOptions(),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-counterparty-type-options",
    selectId: "simple-counterparty-type",
    options: getAvailableOptions(SIMPLE_COUNTERPARTY_TYPE_OPTIONS),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-primary-flow-type-options",
    selectId: "simple-primary-flow-type",
    options: getAvailableOptions(SIMPLE_PRIMARY_FLOW_TYPE_OPTIONS),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-consumption-ownership-options",
    selectId: "simple-consumption-ownership",
    options: getAvailableOptions(SIMPLE_CONSUMPTION_OWNERSHIP_OPTIONS),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-settlement-state-options",
    selectId: "simple-settlement-state",
    options: getAvailableOptions(SIMPLE_SETTLEMENT_STATE_OPTIONS),
  });
  renderSimpleChoiceGroup({
    containerId: "simple-party-type-options",
    selectId: "simple-party-type",
    options: getAvailableOptions(SIMPLE_PARTY_OPTIONS),
  });
  updateSimpleReviewSummary();
  updateLearnedVendorNote();
  updateSimpleIdentityHint();
  renderSimpleSelfTransferOptions();
  syncSimpleContextVisibility();
  syncPillDirections();
  window._syncAllPills?.();
}

function syncSimpleReviewStatus({ forceAuto = false } = {}) {
  const reviewStatusEl = document.getElementById("simple-review-status");
  if (!reviewStatusEl) return;
  classificationState.simpleReviewStatusManual = false;
  const noTagRequiredEl = document.getElementById("simple-no-tag-required");
  if (noTagRequiredEl && getSelectedSimpleSubcategoryId()) {
    noTagRequiredEl.checked = false;
  }
  reviewStatusEl.value = deriveAutoReviewStatus();
  renderSimpleChoiceGroups();
}

function getCategoryById(categoryId) {
  return classificationState.categories.find((category) => String(category.id) === String(categoryId)) || null;
}

function getSubcategoryById(subcategoryId) {
  const walk = (items, category) => {
    for (const subcategory of items || []) {
      if (String(subcategory.id) === String(subcategoryId)) return { category, subcategory };
      const nested = walk(subcategory.children || [], category);
      if (nested) return nested;
    }
    return null;
  };
  for (const category of classificationState.categories) {
    const match = walk(category.subcategories || [], category);
    if (match) return match;
  }
  return null;
}

function getSubcategoryPathIds(subcategoryId) {
  const path = [];
  const walk = (items) => {
    for (const subcategory of items || []) {
      path.push(subcategory.id);
      if (String(subcategory.id) === String(subcategoryId)) return true;
      if (walk(subcategory.children || [])) return true;
      path.pop();
    }
    return false;
  };

  for (const category of classificationState.categories) {
    path.length = 0;
    if (walk(category.subcategories || [])) {
      return [...path];
    }
  }
  return [];
}

function getSubcategoryChildren(categoryId, pathIds = [], level = 0) {
  const category = getCategoryById(categoryId);
  if (!category) return [];
  if (level === 0) return category.subcategories || [];

  const parentId = pathIds[level - 1];
  const parentNode = getSubcategoryById(parentId)?.subcategory;
  return parentNode?.children || [];
}

function populateCategorySelects(selectedSubcategoryId = "", fallbackCategoryId = "") {
  const categorySelect = document.getElementById("simple-category");
  if (!categorySelect) return;

  const selectedSubcategory = selectedSubcategoryId ? getSubcategoryById(selectedSubcategoryId) : null;
  const selectedCategoryId = selectedSubcategory?.category?.id || fallbackCategoryId || categorySelect.value || "";

  categorySelect.innerHTML = [
    '<option value="">No category selected</option>',
    ...classificationState.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`),
  ].join("");
  categorySelect.value = selectedCategoryId;
  renderSimpleSubcategoryChain(selectedCategoryId, selectedSubcategoryId);
}

function renderSimpleSubcategoryChain(categoryId, selectedSubcategoryId = "") {
  const container = document.getElementById("simple-subcategory-chain");
  if (!container) return;
  // Render subcategory selects only when a category is selected AND it actually has
  // subcategories. Otherwise leave the container empty so no placeholder space shows.
  container.innerHTML = categoryId ? buildSubcategoryChainHtml(categoryId, selectedSubcategoryId, null) : "";
}

function getSelectedSimpleSubcategoryId() {
  const selects = [...document.querySelectorAll("[data-simple-sub-level]")];
  if (!selects.length) return "";
  return selects[selects.length - 1].value || "";
}

function simpleCategoryHasSubcategories(categoryId) {
  return getSubcategoryChildren(categoryId, [], 0).length > 0;
}

function buildSubcategoryChainHtml(categoryId, selectedSubcategoryId = "", rowIndex = null) {
  const selectedPath = selectedSubcategoryId ? getSubcategoryPathIds(selectedSubcategoryId) : [];
  const parts = [];
  let level = 0;
  while (true) {
    const options = getSubcategoryChildren(categoryId, selectedPath, level);
    if (!options.length) break;
    const selectedValue = selectedPath[level] || "";
    const attrName = rowIndex === null ? "data-simple-sub-level" : "data-row-sub-level";
    const attrIndex = rowIndex === null ? "" : ` data-row-index="${rowIndex}"`;
    parts.push(`
      <select ${attrName}="${level}"${attrIndex} class="w-full rounded-xl border-slate-200 bg-white text-sm">
        <option value="">Choose subcategory</option>
        ${options.map((subcategory) => `<option value="${subcategory.id}" ${String(subcategory.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(subcategory.name)}</option>`).join("")}
      </select>
    `);
    level += 1;
    if (!selectedValue) break;
  }
  return parts.join("");
}

function flattenLeafSubcategoryOptions(items = [], prefix = "") {
  return items.flatMap((subcategory) => {
    const label = prefix ? `${prefix} / ${subcategory.name}` : subcategory.name;
    const children = Array.isArray(subcategory.children) ? subcategory.children : [];
    if (!children.length) {
      return [{ id: subcategory.id, label }];
    }
    return flattenLeafSubcategoryOptions(children, label);
  });
}

function buildRowSubcategorySelectHtml(categoryId, selectedSubcategoryId = "", rowIndex = 0) {
  if (!categoryId) {
    return '<p class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-400" style="min-width:0">—</p>';
  }
  const category = getCategoryById(categoryId);
  const options = flattenLeafSubcategoryOptions(category?.subcategories || []);
  if (!options.length) {
    return '<p class="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-400" style="min-width:0">None</p>';
  }
  const selectedValue = options.some((option) => String(option.id) === String(selectedSubcategoryId))
    ? selectedSubcategoryId
    : "";
  return `
    <select data-row-index="${rowIndex}" data-field="subcategory_id" class="w-full rounded-lg border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:border-primary focus:bg-white focus:ring-primary">
      <option value="">Choose subcategory</option>
      ${options.map((option) => `<option value="${option.id}" ${String(option.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
  `;
}

function isRefundRow(row) {
  if (classificationState.activeMode !== "item") return false;
  const lineKind = String(row?.line_kind || row?.expense_for || "").toLowerCase();
  return lineKind === "refund";
}

function getItemOwnerType(row) {
  if (isRefundRow(row)) return "Refund";
  return String(row?.owner_type || "");
}

function deriveSimpleSelectionFromTags() {
  const tx = classificationState.transaction || {};

  // Tier 1: match by subcategory ID — works regardless of how many ancestor tags were stored.
  // tag_subcategory_ids contains the subcategory UUID of every leaf system_tag on this transaction.
  const tagSubIds = new Set(
    (Array.isArray(tx.tag_subcategory_ids) ? tx.tag_subcategory_ids : [])
      .map(String).filter(id => id && id !== "null")
  );
  if (tagSubIds.size > 0) {
    for (const category of classificationState.categories) {
      const walkById = (items) => {
        for (const subcategory of items || []) {
          if (tagSubIds.has(String(subcategory.id))) {
            return { categoryId: category.id, subcategoryId: subcategory.id };
          }
          const found = walkById(subcategory.children || []);
          if (found) return found;
        }
        return null;
      };
      const match = walkById(category.subcategories || []);
      if (match) return match;
    }
  }

  // Tier 2: match by category ID (category-only tag, no subcategory stored).
  const tagCatIds = new Set(
    (Array.isArray(tx.tag_category_ids) ? tx.tag_category_ids : [])
      .map(String).filter(id => id && id !== "null")
  );
  if (tagCatIds.size > 0) {
    for (const category of classificationState.categories) {
      if (tagCatIds.has(String(category.id))) {
        return { categoryId: category.id, subcategoryId: "" };
      }
    }
  }

  // Tier 3: name-based fallback — works for any leaf subcategory name present in tag_names,
  // even without the parent category name (handles tag-rule and single-tag scenarios).
  const tags = (Array.isArray(tx.tag_names) ? tx.tag_names : []).filter(Boolean);
  if (tags.length > 0) {
    // First try: strict match — both category.name AND subcategory.name in tags (legacy path).
    for (const category of classificationState.categories) {
      const strictWalk = (items) => {
        for (const subcategory of items || []) {
          if (tags.includes(category.name) && tags.includes(subcategory.name)) {
            return { categoryId: category.id, subcategoryId: subcategory.id };
          }
          const found = strictWalk(subcategory.children || []);
          if (found) return found;
        }
        return null;
      };
      const match = strictWalk(category.subcategories || []);
      if (match) return match;
    }
    // Second try: loose match — subcategory.name in tags (leaf-only tagged transactions).
    for (const category of classificationState.categories) {
      const looseWalk = (items) => {
        for (const subcategory of items || []) {
          if (tags.includes(subcategory.name)) {
            return { categoryId: category.id, subcategoryId: subcategory.id };
          }
          const found = looseWalk(subcategory.children || []);
          if (found) return found;
        }
        return null;
      };
      const match = looseWalk(category.subcategories || []);
      if (match) return match;
    }
    // Third try: category-only name match.
    for (const category of classificationState.categories) {
      if (tags.includes(category.name)) {
        return { categoryId: category.id, subcategoryId: "" };
      }
    }
  }

  return { categoryId: "", subcategoryId: "" };
}

function hasSimpleClassificationSaved() {
  const tagNames = Array.isArray(classificationState.transaction?.tag_names)
    ? classificationState.transaction.tag_names.filter(Boolean)
    : [];
  return Boolean(classificationState.transaction?.no_tag_required) || tagNames.length > 0;
}

function hasMeaningfulSavedSplit() {
  const splitMode = classificationState.split?.split?.split_mode;
  const lineItems = getSavedLineItems().filter((item) => normalizeAmount(item?.amount || 0) > 0);
  if (!splitMode || !lineItems.length) return false;
  if (splitMode === "quick") {
    return lineItems.some((item) => !isSelfLikeLineItem(item));
  }
  return lineItems.length > 0;
}

function getSavedClassificationMode() {
  const splitMode = classificationState.split?.split?.split_mode;
  if (hasMeaningfulSavedSplit()) {
    if (splitMode === "quick") return "person";
    if (splitMode === "itemized") return "item";
  }
  if (hasSimpleClassificationSaved()) return "simple";
  return "";
}

function getModeLabel(mode) {
  if (mode === "item") return "Split by Item";
  if (mode === "person") return "Split by Person";
  return "Simple";
}

function isModeLocked(mode) {
  return false;
}

function updateModeIndicators() {
  const modes = ["simple", "item", "person"];
  modes.forEach((mode) => {
    document.getElementById(`mode-chip-${mode}`)?.classList.toggle("hidden", classificationState.savedMode !== mode);
    const input = document.querySelector(`input[name="classification_mode"][value="${mode}"]`);
    const label = input?.closest("label");
    const locked = false;
    if (input) {
      input.disabled = locked;
    }
    label?.classList.toggle("pointer-events-none", locked);
    label?.classList.toggle("opacity-50", locked);
  });
  const warningEl = document.getElementById("mode-warning");
  const lockNoteEl = document.getElementById("mode-lock-note");
  if (warningEl) {
    warningEl.textContent = "";
    warningEl.classList.add("hidden");
  }
  if (lockNoteEl) {
    lockNoteEl.textContent = "";
    lockNoteEl.classList.add("hidden");
  }
}

function updateSummary() {
  const layout = document.getElementById("classification-layout");
  const sidebar = document.getElementById("classification-sidebar");
  const allocationPanel = document.getElementById("allocation-summary-panel");
  const hideSidebar = false;
  const hideAllocationPanel = classificationState.activeMode === "simple";
  if (layout) {
    layout.classList.toggle("lg:grid-cols-[minmax(0,1fr)_340px]", !hideSidebar);
    layout.classList.toggle("lg:grid-cols-1", hideSidebar);
  }
  if (sidebar) {
    sidebar.classList.toggle("hidden", hideSidebar);
    sidebar.toggleAttribute("hidden", hideSidebar);
  }
  if (allocationPanel) {
    allocationPanel.classList.toggle("hidden", hideAllocationPanel);
    allocationPanel.toggleAttribute("hidden", hideAllocationPanel);
  }
  const total = Math.abs(Number(classificationState.transaction?.amount || 0));
  const isPersonMode = classificationState.activeMode === "person";
  const isItemMode = classificationState.activeMode === "item";
  const refundCard = document.getElementById("summary-refund-card");
  const refundEl = document.getElementById("summary-refund");
  const refundHintEl = document.getElementById("summary-refund-hint");
  const otherLabelEl = document.getElementById("summary-other-label");
  const selfLabelEl = document.getElementById("summary-self-label");
  const selfHintEl = document.getElementById("summary-self-hint");

  let selfAllocated = 0;
  let otherAllocated = 0;
  let refundAllocated = 0;
  let otherRecovered = 0;
  let otherPending = 0;

  if (isPersonMode) {
    selfAllocated = Number(classificationState.selfShare.amount || 0);
    otherAllocated = classificationState.splitRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    otherRecovered = classificationState.splitRows.reduce((sum, _row, index) => sum + Number(getRecoveryTotalsForRow(index).recovered || 0), 0);
    otherPending = Math.max(0, normalizeAmount(otherAllocated - otherRecovered));
  } else if (isItemMode) {
    selfAllocated = classificationState.splitRows.reduce((sum, row) => {
      if (isRefundRow(row)) return sum;
      return sum + (String(getItemOwnerType(row)).toLowerCase() === "self" ? Number(row.amount || 0) : 0);
    }, 0);
    otherAllocated = classificationState.splitRows.reduce((sum, row) => {
      if (isRefundRow(row)) return sum;
      return sum + (String(getItemOwnerType(row)).toLowerCase() === "self" ? 0 : Number(row.amount || 0));
    }, 0);
    refundAllocated = classificationState.splitRows.reduce((sum, row) => (
      sum + (isRefundRow(row) ? Number(row.amount || 0) : 0)
    ), 0);
  }

  const allocated = selfAllocated + otherAllocated + refundAllocated;
  const remaining = Number((total - allocated).toFixed(2));
  const status = Math.abs(remaining) <= 0.01 ? "balanced" : remaining > 0 ? "under" : "over";
  const addRowBtn = document.getElementById("add-split-row");
  const canAddMoreRows = classificationState.activeMode !== "simple" && remaining > 0.01;
  if (addRowBtn) {
    if (classificationState.activeMode === "person") {
      const canAddPersonRows = isPersonModeUnlocked();
      addRowBtn.disabled = !canAddPersonRows;
      addRowBtn.classList.toggle("opacity-50", !canAddPersonRows);
      addRowBtn.classList.toggle("cursor-not-allowed", !canAddPersonRows);
    } else {
      addRowBtn.disabled = !canAddMoreRows;
      addRowBtn.classList.toggle("opacity-50", !canAddMoreRows);
      addRowBtn.classList.toggle("cursor-not-allowed", !canAddMoreRows);
    }
  }
  document.getElementById("summary-total").textContent = formatINR(total);
  if (document.getElementById("summary-self")) {
    document.getElementById("summary-self").textContent = formatINR(selfAllocated);
  }
  if (selfLabelEl && selfHintEl) {
    selfLabelEl.textContent = isItemMode ? "Mine" : "Your Share";
    selfHintEl.textContent = isItemMode
      ? "Kept items that belong to you."
      : "Your own final amount in this transaction.";
  }
  if (document.getElementById("summary-other")) {
    document.getElementById("summary-other").textContent = formatINR(otherAllocated);
  }
  if (otherLabelEl) {
    otherLabelEl.textContent = isItemMode ? "Others" : "Other Rows";
  }
  if (document.getElementById("summary-other-hint")) {
    document.getElementById("summary-other-hint").textContent = isPersonMode
      ? `${formatINR(otherRecovered)} linked, ${formatINR(otherPending)} still pending.`
      : isItemMode
        ? "Kept items that belong to family or someone else."
        : "Rows that can later be settled or linked.";
  }
  if (refundCard && refundEl && refundHintEl) {
    refundCard.classList.toggle("hidden", !isItemMode);
    refundEl.textContent = formatINR(refundAllocated);
    refundHintEl.textContent = "Returned-item amounts that can be credited back later.";
  }
  document.getElementById("summary-allocated").textContent = formatINR(allocated);
  const remainingEl = document.getElementById("summary-remaining");
  if (remainingEl) {
    remainingEl.textContent = formatINR(Math.abs(remaining));
    remainingEl.classList.toggle("text-rose-600", remaining !== 0);
    remainingEl.classList.toggle("text-slate-900", remaining === 0);
  }
  const remainingCard = document.getElementById("summary-remaining-card");
  const remainingLabel = document.getElementById("summary-remaining-label");
  const balanceCard = document.getElementById("summary-balance-card");
  const balanceLabel = document.getElementById("summary-balance-label");
  const balanceHint = document.getElementById("summary-balance-hint");
  const balanceIcon = document.getElementById("summary-balance-icon");
  if (remainingCard && remainingLabel) {
    remainingCard.className = "rounded-2xl px-4 py-4 ring-1 transition";
    remainingLabel.className = "text-xs font-bold uppercase tracking-[0.14em]";
    if (status === "balanced") {
      remainingCard.classList.add("bg-emerald-50", "ring-emerald-100");
      remainingLabel.classList.add("text-emerald-700");
    } else if (status === "under") {
      remainingCard.classList.add("bg-amber-50", "ring-amber-200");
      remainingLabel.classList.add("text-amber-700");
    } else {
      remainingCard.classList.add("bg-rose-50", "ring-rose-200");
      remainingLabel.classList.add("text-rose-700");
    }
  }
  if (balanceCard && balanceLabel && balanceHint && balanceIcon) {
    balanceCard.className = "border-b px-6 py-5 text-white";
    balanceIcon.className = "material-symbols-outlined rounded-2xl p-2 text-[24px]";
    if (status === "balanced") {
      balanceCard.classList.add("border-emerald-800", "bg-gradient-to-br", "from-emerald-600", "to-emerald-800");
      balanceIcon.classList.add("bg-white/15");
      balanceIcon.textContent = "task_alt";
      balanceLabel.textContent = "Matched";
      balanceHint.textContent = isItemMode
        ? "Mine + Others + Refund matches the transaction total."
        : "Your allocation matches the transaction total.";
    } else if (status === "under") {
      balanceCard.classList.add("border-amber-300", "bg-gradient-to-br", "from-amber-400", "to-orange-500");
      balanceIcon.classList.add("bg-black/10");
      balanceIcon.textContent = "warning";
      balanceLabel.textContent = "Still Missing";
      balanceHint.textContent = `${formatINR(Math.abs(remaining))} is still left to place. Add it to your share or another row before saving.`;
    } else {
      balanceCard.classList.add("border-rose-300", "bg-gradient-to-br", "from-rose-500", "to-red-700");
      balanceIcon.classList.add("bg-black/10");
      balanceIcon.textContent = "error";
      balanceLabel.textContent = "Too Much Added";
      balanceHint.textContent = `${formatINR(Math.abs(remaining))} is above the transaction total. Reduce one of the row amounts before saving.`;
    }
  }
}

function setStatusMessage(elementId, type, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message || "";
  el.className = "text-sm font-medium";
  if (!message) {
    el.classList.add("text-slate-500");
    return;
  }
  if (type === "error") {
    el.classList.add("rounded-2xl", "border", "border-rose-200", "bg-rose-50", "px-4", "py-3", "text-rose-700");
  } else if (type === "warn") {
    el.classList.add("rounded-2xl", "border", "border-amber-200", "bg-amber-50", "px-4", "py-3", "text-amber-800");
  } else if (type === "success") {
    el.classList.add("rounded-2xl", "border", "border-emerald-200", "bg-emerald-50", "px-4", "py-3", "text-emerald-700");
  } else {
    el.classList.add("text-slate-500");
  }
}

function normalizeAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getSavedLineItems() {
  return Array.isArray(classificationState.split?.line_items) ? classificationState.split.line_items : [];
}

function getSavedRecoveries() {
  return Array.isArray(classificationState.split?.recoveries) ? classificationState.split.recoveries : [];
}

function isSelfLikeLineItem(item) {
  const expenseFor = String(item?.expense_for || "").trim().toLowerCase();
  const itemName = String(item?.item_name || "").trim().toLowerCase();
  return ["self", "my share", "myshare"].includes(expenseFor) || ["my share", "myshare"].includes(itemName);
}

function getSavedSelfLineItem() {
  return getSavedLineItems().find((item) => isSelfLikeLineItem(item)) || null;
}

function getSavedNonSelfLineItems(mode = classificationState.activeMode) {
  const items = getSavedLineItems();
  if (mode !== "person") return items;
  return items.filter((item) => !isSelfLikeLineItem(item));
}

function isPersonModeUnlocked() {
  if (classificationState.activeMode !== "person") return true;
  return normalizeAmount(classificationState.selfShare.amount) > 0;
}

function getRecoveriesForRow(rowIndex) {
  const savedLineItems = getSavedNonSelfLineItems();
  const savedLineItemId = savedLineItems[rowIndex]?.id ? String(savedLineItems[rowIndex].id) : null;
  const savedRecoveries = getSavedRecoveries().filter((recovery) => {
    if (!savedLineItemId) return false;
    return String(recovery.split_line_item_id || "") === savedLineItemId;
  });
  const pendingRecoveries = (classificationState.pendingRecoveries || []).filter(
    (recovery) => Number(recovery.rowIndex) === Number(rowIndex)
  );
  return [...pendingRecoveries, ...savedRecoveries];
}

function getRecoveryTotalsForRow(rowIndex) {
  const recoveries = getRecoveriesForRow(rowIndex);
  const recovered = recoveries.reduce((sum, recovery) => sum + normalizeAmount(recovery.amount), 0);
  const target = Math.abs(normalizeAmount(classificationState.splitRows[rowIndex]?.amount || 0));
  const remaining = Math.max(0, normalizeAmount(target - recovered));
  return {
    recoveries,
    recovered: normalizeAmount(recovered),
    remaining,
    target,
  };
}

function isRecoveryRowLocked(rowIndex) {
  const row = classificationState.splitRows[rowIndex];
  if (!row) return false;
  if (classificationState.activeMode === "item" && !isRefundRow(row)) return false;
  const { target, remaining } = getRecoveryTotalsForRow(rowIndex);
  return target > 0 && remaining <= 0.01;
}

function getRowRecoveryState(rowIndex) {
  const row = classificationState.splitRows[rowIndex];
  if (classificationState.activeMode === "item" && !isRefundRow(row)) {
    return {
      label: "Kept",
      className: "bg-slate-100 text-slate-600 ring-slate-200",
    };
  }
  const { recovered, remaining, target } = getRecoveryTotalsForRow(rowIndex);
  if (!target) {
    return {
      label: "Set amount",
      className: "bg-slate-100 text-slate-500 ring-slate-200",
    };
  }
  if (!recovered) {
    return {
      label: "Open",
      className: "bg-amber-100 text-amber-700 ring-amber-200",
    };
  }
  if (remaining <= 0.01) {
    return {
      label: "Settled",
      className: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    };
  }
  return {
    label: "Partly Settled",
    className: "bg-sky-100 text-sky-700 ring-sky-200",
  };
}

function getRecoveryTargetOptions() {
  const savedLineItems = getSavedNonSelfLineItems();
  const baseOption = [];
  const buildRowLabel = (item, index) => {
    const explicitName = String(item?.item_name || item?.expense_for || "").trim();
    const fallback = classificationState.activeMode === "person" ? `Share row ${index + 1}` : `Split row ${index + 1}`;
    const label = explicitName || fallback;
    return `${label} - ${formatINR(Math.abs(item.amount || 0))}`;
  };

  if (classificationState.split?.split_id && savedLineItems.length) {
    return [
      ...baseOption,
      ...savedLineItems
        .filter((item, index) => (classificationState.activeMode !== "item" || isRefundRow(item)) && !isRecoveryRowLocked(index))
        .map((item, index) => ({
        value: `saved:${item.id}`,
        label: buildRowLabel(item, index),
        amount: Math.abs(normalizeAmount(item.amount)),
        savedLineItemId: item.id,
        rowIndex: index,
        }))
        .filter((option) => option.amount > 0),
    ];
  }

  return [
    ...baseOption,
      ...classificationState.splitRows
        .map((item, index) => ({ item, index }))
        .filter(({ item, index }) => (classificationState.activeMode !== "item" || isRefundRow(item)) && !isRecoveryRowLocked(index))
        .map(({ item, index }) => ({
          value: `draft:${index}`,
          label: buildRowLabel(item, index),
          amount: Math.abs(normalizeAmount(item.amount)),
          savedLineItemId: null,
          rowIndex: index,
        })),
  ].filter((option) => option.amount > 0);
}

function parseRecoveryTargetValue(value) {
  if (!value) {
    return { savedLineItemId: null, rowIndex: null, amount: 0 };
  }
  if (value.startsWith("saved:")) {
    const savedLineItemId = value.slice(6);
    const savedLineItems = getSavedNonSelfLineItems();
    const rowIndex = savedLineItems.findIndex((item) => String(item.id) === String(savedLineItemId));
    const lineItem = rowIndex >= 0 ? savedLineItems[rowIndex] : null;
    return {
      savedLineItemId,
      rowIndex: rowIndex >= 0 ? rowIndex : null,
      amount: Math.abs(normalizeAmount(lineItem?.amount || 0)),
    };
  }
  if (value.startsWith("draft:")) {
    const rowIndex = Number(value.slice(6));
    const row = classificationState.splitRows[rowIndex];
    return {
      savedLineItemId: null,
      rowIndex,
      amount: normalizeAmount(row?.amount || 0),
    };
  }
  return { savedLineItemId: null, rowIndex: null, amount: 0 };
}

function buildRecoveryMatchCandidates(amount) {
  const normalizedAmount = normalizeAmount(amount);
  const unavailableRecoveryIds = new Set([
    ...(classificationState.split?.recoveries || []).map((item) => String(item.recovery_transaction_id)),
    ...(classificationState.pendingRecoveries || []).map((item) => String(item.recovery_transaction_id)),
  ]);

  const exactMatches = (classificationState.recoveryCandidates || []).filter(
    (tx) =>
      !unavailableRecoveryIds.has(String(tx.id)) &&
      Math.abs(normalizeAmount(tx.amount) - normalizedAmount) <= 0.01
  );

  if (exactMatches.length) return exactMatches;

  const underOrEqualMatches = [...(classificationState.recoveryCandidates || [])]
    .filter(
      (tx) =>
        !unavailableRecoveryIds.has(String(tx.id)) &&
        normalizeAmount(tx.amount) <= normalizedAmount
    )
    .sort((a, b) => Math.abs(normalizedAmount - normalizeAmount(a.amount)) - Math.abs(normalizedAmount - normalizeAmount(b.amount)))
    .slice(0, 12);

  if (underOrEqualMatches.length) return underOrEqualMatches;

  return [...(classificationState.recoveryCandidates || [])]
    .filter((tx) => !unavailableRecoveryIds.has(String(tx.id)))
    .sort((a, b) => Math.abs(normalizedAmount - normalizeAmount(a.amount)) - Math.abs(normalizedAmount - normalizeAmount(b.amount)))
    .slice(0, 12);
}

function syncRecoveryLinkButtonState() {
  const lineItemSelect = document.getElementById("recovery-line-item");
  const candidateSelect = document.getElementById("recovery-candidate");
  const amountInput = document.getElementById("recovery-amount");
  const linkBtn = document.getElementById("link-recovery-btn");
  if (!lineItemSelect || !candidateSelect || !amountInput || !linkBtn) return;

  const hasTarget = Boolean(lineItemSelect.value);
  const hasCandidate = Boolean(candidateSelect.value);
  const hasAmount = Number(amountInput.value || 0) > 0.01;
  const canLink = hasTarget && hasCandidate && hasAmount;
  linkBtn.disabled = !canLink;
  linkBtn.classList.toggle("opacity-50", !canLink);
  linkBtn.classList.toggle("cursor-not-allowed", !canLink);
  if (classificationState.activeMode === "person" && !isPersonModeUnlocked()) {
    linkBtn.textContent = "Unlock First";
  } else {
    linkBtn.textContent = "Link";
  }
}

function buildSelfSubcategoryChainHtml(categoryId, selectedSubcategoryId = "") {
  if (!categoryId) return "";
  const selectedPath = selectedSubcategoryId ? getSubcategoryPathIds(selectedSubcategoryId) : [];
  const parts = [];
  let level = 0;
  while (true) {
    const options = getSubcategoryChildren(categoryId, selectedPath, level);
    if (!options.length) break;
    const selectedValue = selectedPath[level] || "";
    parts.push(`
      <select data-self-sub-level="${level}" class="w-full rounded-xl border-slate-200 bg-white text-sm">
        <option value="">Choose subcategory</option>
        ${options.map((subcategory) => `<option value="${subcategory.id}" ${String(subcategory.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(subcategory.name)}</option>`).join("")}
      </select>
    `);
    level += 1;
    if (!selectedValue) break;
  }
  return parts.join("");
}

function returnToReports() {
  _suppressUnsavedGuard = true;
  try {
    sessionStorage.setItem(REPORT_FORCE_REFRESH_KEY, "1");
  } catch (error) {
    console.warn("Unable to persist report refresh flag", error);
  }
  const referrer = document.referrer || "";
  if (referrer.includes("/reports/")) {
    window.history.back();
    return;
  }
  window.location.href = "/reports/";
}

function renderPersonSelfSection() {
  const panel = document.getElementById("person-self-panel");
  const categorySelect = document.getElementById("person-self-category");
  const chainEl = document.getElementById("person-self-subcategory-chain");
  const amountInput = document.getElementById("person-self-amount");
  const statusEl = document.getElementById("person-self-status");
  if (!panel || !categorySelect || !chainEl || !amountInput || !statusEl) return;

  const isPerson = classificationState.activeMode === "person";
  panel.classList.toggle("hidden", !isPerson);
  if (!isPerson) return;
  const selectedCategoryId =
    classificationState.selfShare.category_id ||
    getSubcategoryById(classificationState.selfShare.subcategory_id)?.category?.id ||
    "";
  categorySelect.innerHTML = [
    '<option value="">Choose category</option>',
    ...classificationState.categories
      .map((category) => `<option value="${category.id}" ${String(category.id) === String(selectedCategoryId) ? "selected" : ""}>${escapeHtml(category.name)}</option>`),
  ]
    .join("");
  classificationState.selfShare.category_id = selectedCategoryId;
  amountInput.value = classificationState.selfShare.amount
    ? Number(classificationState.selfShare.amount).toFixed(2)
    : "";
  chainEl.innerHTML = buildSelfSubcategoryChainHtml(selectedCategoryId, classificationState.selfShare.subcategory_id);
  const unlocked = isPersonModeUnlocked();
  amountInput.classList.toggle("ring-2", !unlocked);
  amountInput.classList.toggle("ring-amber-200", !unlocked);
  amountInput.classList.toggle("border-amber-300", !unlocked);
  amountInput.classList.toggle("bg-amber-50", !unlocked);
  statusEl.textContent = unlocked
    ? "Your share is set. You can now add other rows and link transactions below."
    : "Set your share amount first to unlock Add Row and linked transactions below.";
}

function updatePersonModeAvailability() {
  const unlocked = isPersonModeUnlocked();
  const addRowBtn = document.getElementById("add-split-row");
  const rowsLockNote = document.getElementById("split-rows-lock-note");
  const rowsContainer = document.getElementById("split-rows");
  const recoveryPanel = document.getElementById("recovery-link-panel");
  const linkBtn = document.getElementById("link-recovery-btn");
  const recoveryStatus = document.getElementById("recovery-status");

  if (classificationState.activeMode !== "person") {
    if (addRowBtn) {
      addRowBtn.disabled = false;
      addRowBtn.classList.remove("opacity-50", "cursor-not-allowed");
      addRowBtn.textContent = "Add Row";
      addRowBtn.removeAttribute("title");
    }
    rowsLockNote?.classList.add("hidden");
    rowsContainer?.classList.remove("opacity-50", "pointer-events-none");
    recoveryPanel?.classList.remove("opacity-50", "pointer-events-none");
    if (linkBtn) {
      linkBtn.textContent = "Link";
      linkBtn.removeAttribute("title");
    }
    return;
  }

  if (addRowBtn) {
    addRowBtn.disabled = !unlocked;
    addRowBtn.classList.toggle("opacity-50", !unlocked);
    addRowBtn.classList.toggle("cursor-not-allowed", !unlocked);
    addRowBtn.classList.toggle("hover:bg-slate-800", unlocked);
    addRowBtn.textContent = unlocked ? "Add Row" : "Set Your Share First";
    addRowBtn.title = unlocked ? "" : "Enter your own share amount first.";
  }
  rowsLockNote?.classList.toggle("hidden", unlocked);
  rowsContainer?.classList.toggle("opacity-50", !unlocked);
  rowsContainer?.classList.toggle("pointer-events-none", !unlocked);
  recoveryPanel?.classList.toggle("opacity-50", !unlocked);
  recoveryPanel?.classList.toggle("pointer-events-none", !unlocked);
  if (!unlocked && recoveryStatus) {
    recoveryStatus.textContent = "Enter your own share amount first, then you can add rows and link the matching payback transaction here.";
  }
  if (linkBtn) {
    linkBtn.textContent = unlocked ? "Link" : "Unlock First";
    linkBtn.title = unlocked ? "" : "Set your own share amount first.";
  }
}

function refreshRecoveryCandidateOptions() {
  const lineItemSelect = document.getElementById("recovery-line-item");
  const candidateSelect = document.getElementById("recovery-candidate");
  const amountInput = document.getElementById("recovery-amount");
  const status = document.getElementById("recovery-status");
  const linkBtn = document.getElementById("link-recovery-btn");
  if (!lineItemSelect || !candidateSelect || !amountInput || !status || !linkBtn) return;

  const target = parseRecoveryTargetValue(lineItemSelect.value || "");
  const { amount } = target;
  if (!target.savedLineItemId && (target.rowIndex === null || target.rowIndex === undefined)) {
    candidateSelect.innerHTML = '<option value="">Choose linked transaction</option>';
    candidateSelect.value = "";
    amountInput.value = "";
    status.textContent =
      classificationState.activeMode === "item"
        ? "Choose a refund row first, then pick the credited transaction you want to link."
        : "Choose the row you want to settle first, then pick the matching transaction.";
    syncRecoveryLinkButtonState();
    return;
  }
  const matches = buildRecoveryMatchCandidates(amount);
  const remainingForRow =
    target.rowIndex !== null && target.rowIndex !== undefined
      ? getRecoveryTotalsForRow(target.rowIndex).remaining
      : amount;

  if (target.rowIndex !== null && target.rowIndex !== undefined && remainingForRow <= 0.01) {
    candidateSelect.innerHTML = '<option value="">Choose linked transaction</option>';
    candidateSelect.value = "";
    amountInput.value = "0.00";
    status.textContent = "This row is already fully settled, so linking is locked.";
    syncRecoveryLinkButtonState();
    return;
  }

  candidateSelect.innerHTML =
    '<option value="">Choose linked transaction</option>' +
    matches
      .map((candidate) => `<option value="${candidate.id}">${escapeHtml([candidate.transaction_date, candidate.vendor_name || candidate.counterparty_identifier || "Credit transaction", formatINR(candidate.amount)].filter(Boolean).join(" | "))}</option>`)
      .join("");

  if (matches.length) {
    const currentCandidateValue = candidateSelect.dataset.selectedValue || candidateSelect.value || "";
    const chosenCandidate = matches.find((candidate) => String(candidate.id) === String(currentCandidateValue)) || null;
    candidateSelect.value = chosenCandidate ? String(chosenCandidate.id) : "";
    amountInput.value = chosenCandidate
      ? normalizeAmount(Math.min(Number(chosenCandidate.amount || 0), Number(remainingForRow || 0))).toFixed(2)
      : "";
    status.textContent =
      target.rowIndex !== null && target.rowIndex !== undefined
        ? `${matches.length} matching transaction${matches.length === 1 ? "" : "s"} found. ${formatINR(remainingForRow)} is still remaining on this row. Pick one to continue.`
        : `${matches.length} matching transaction${matches.length === 1 ? "" : "s"} found for ${formatINR(amount)}.`;
    syncRecoveryLinkButtonState();
  } else {
    candidateSelect.value = "";
    amountInput.value = remainingForRow ? normalizeAmount(remainingForRow).toFixed(2) : "";
    status.textContent = amount
      ? `No close matches found for ${formatINR(amount)} yet.`
      : classificationState.activeMode === "item"
        ? "Choose a refund row to see matching credited transactions here."
        : "Enter an amount in the split rows to see matching transactions here.";
    syncRecoveryLinkButtonState();
  }
}

function renderRecoveryControls() {
  const lineItemSelect = document.getElementById("recovery-line-item");
  const candidateSelect = document.getElementById("recovery-candidate");
  const amountInput = document.getElementById("recovery-amount");
  const list = document.getElementById("linked-recoveries");
  const status = document.getElementById("recovery-status");
  const linkBtn = document.getElementById("link-recovery-btn");
  if (!lineItemSelect || !candidateSelect || !amountInput || !list || !status || !linkBtn) return;

  const recoveries = getSavedRecoveries();
  const pendingRecoveries = Array.isArray(classificationState.pendingRecoveries) ? classificationState.pendingRecoveries : [];
  const targetOptions = getRecoveryTargetOptions();
  const currentTargetValue = lineItemSelect.value || "";

  lineItemSelect.innerHTML = ['<option value="">Choose row to settle</option>', ...targetOptions
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)]
    .join("");
  lineItemSelect.value = targetOptions.some((option) => option.value === currentTargetValue) ? currentTargetValue : "";

  const hasRows = targetOptions.length > 0;
  [lineItemSelect, candidateSelect, amountInput, linkBtn].forEach((el) => {
    el.disabled = !hasRows;
  });

  if (!hasRows) {
    status.textContent =
      classificationState.activeMode === "person"
        ? "Add an open row with remaining amount before linking transactions."
        : "Mark refunded items as Refund, and only open refund rows can receive linked credits.";
    candidateSelect.innerHTML = '<option value="">Choose linked transaction</option>';
    amountInput.value = "";
    syncRecoveryLinkButtonState();
  } else {
    refreshRecoveryCandidateOptions();
  }

  const combinedRecoveries = [...pendingRecoveries, ...recoveries];
  list.innerHTML = combinedRecoveries.length
    ? combinedRecoveries.map((recovery) => `
      <div class="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-800">${escapeHtml(recovery.vendor_name || recovery.counterparty_identifier || recovery.recovery_type || "Settlement")}</p>
          <p class="mt-1 text-xs text-slate-500">${escapeHtml([recovery.recovery_type, recovery.transaction_date, recovery.is_pending ? "Pending save" : ""].filter(Boolean).join(" | "))}</p>
        </div>
        <div class="ml-4 flex items-center gap-3">
          <span class="text-sm font-bold text-emerald-700">${formatINR(recovery.amount)}</span>
          <button type="button" data-remove-recovery="${recovery.id}" class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:text-rose-600">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>
    `).join("")
    : '<p class="text-sm text-slate-400">No linked settlement transactions yet.</p>';
}

function renderTransactionHeader() {
  const transaction = classificationState.transaction || {};
  document.getElementById("tx-vendor").textContent =
    transaction.vendor_name
    || transaction.counterparty_entity_name
    || transaction.counterparty_identifier
    || "Unknown vendor";
  document.getElementById("tx-meta").textContent = [transaction.transaction_date, transaction.transaction_time, shortenUPI(transaction.counterparty_identifier)].filter(Boolean).join(" | ");
  const countEl = document.getElementById("tx-counterparty-count");
  if (countEl) {
    const count = Number(transaction.counterparty_count || 0);
    const aliasCount = Number(transaction.learned_defaults?.alias_count || 0);
    if (aliasCount > 1 && transaction.counterparty_entity_name) {
      countEl.textContent = `${aliasCount} UPI ids are linked to ${transaction.counterparty_entity_name}`;
      countEl.classList.remove("hidden");
    } else if (count > 0) {
      countEl.textContent = `${count} similar transactions share this counterparty`;
      countEl.classList.remove("hidden");
    } else {
      countEl.textContent = "";
      countEl.classList.add("hidden");
    }
  }
  const amountEl = document.getElementById("tx-amount");
  if (amountEl) {
    const isDebit = String(transaction.direction || "").toLowerCase() === "withdrawal";
    const sign    = isDebit ? "−" : "+";
    const label   = isDebit ? "Dr" : "Cr";
    amountEl.textContent = `${sign} ${formatINR(Math.abs(Number(transaction.amount || 0)))}  ${label}`;
    amountEl.style.background  = isDebit ? "#be123c" : "#047857";
    amountEl.style.color       = "#ffffff";
  }
  syncPillDirections();
  const sourceEl = document.getElementById("tx-source");
  const sourceText = transaction.statement_sources || transaction.payment_source_name || "";
  if (sourceText) {
    sourceEl.textContent = sourceText;
    sourceEl.classList.remove("hidden");
  } else {
    sourceEl.textContent = "";
    sourceEl.classList.add("hidden");
  }
  const narrationEl = document.getElementById("tx-narration");
  if (transaction.narration) {
    narrationEl.textContent = transaction.narration;
    narrationEl.classList.remove("hidden");
  } else {
    narrationEl.textContent = "";
    narrationEl.classList.add("hidden");
  }
  const tagsEl = document.getElementById("tx-tags");
  if (tagsEl) {
    const tagNames = (Array.isArray(transaction.tag_names) ? transaction.tag_names : []).filter(Boolean);
    tagsEl.innerHTML = tagNames.map(name =>
      `<span class="inline-flex items-center gap-1 rounded-full bg-sky-50 dark:bg-sky-900/20 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300 ring-1 ring-sky-100 dark:ring-sky-800/40">
        <span class="material-symbols-outlined text-[11px]" style="font-variation-settings:'FILL' 1">sell</span>${escapeHtml(name)}
      </span>`
    ).join("");
    if (tagNames.length > 0) {
      tagsEl.classList.remove("hidden");
    } else {
      tagsEl.classList.add("hidden");
    }
  }
}

function setSimpleReviewFields() {
  const transaction = classificationState.transaction || {};
  const reviewStatusEl = document.getElementById("simple-review-status");
  const counterpartyTypeEl = document.getElementById("simple-counterparty-type");
  const primaryFlowTypeEl = document.getElementById("simple-primary-flow-type");
  const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
  const settlementStateEl = document.getElementById("simple-settlement-state");
  const noTagRequiredEl = document.getElementById("simple-no-tag-required");
  const learnedDefaults = classificationState.learnedDefaults || {};
  classificationState.simpleReviewStatusManual = false;
  classificationState.simpleCategoryTouched = hasSavedSimpleCategoryDecision();
  if (reviewStatusEl) reviewStatusEl.value = transaction.review_status || "unreviewed";
  const resolvedCounterpartyType =
    transaction.counterparty_type
    || learnedDefaults.counterparty_type
    || transaction.counterparty_entity_type
    || "";
  const resolvedPrimaryFlowType =
    transaction.primary_flow_type
    || learnedDefaults.primary_flow_type
    || "";
  const resolvedConsumptionOwnership =
    transaction.consumption_ownership
    || learnedDefaults.consumption_ownership
    || (resolvedPrimaryFlowType === "transfer" ? "not_consumption" : "");
  const resolvedSettlementState = transaction.settlement_state || "";
  if (counterpartyTypeEl) counterpartyTypeEl.value = resolvedCounterpartyType;
  if (primaryFlowTypeEl) primaryFlowTypeEl.value = resolvedPrimaryFlowType;
  if (consumptionOwnershipEl) consumptionOwnershipEl.value = resolvedConsumptionOwnership;
  if (settlementStateEl) settlementStateEl.value = resolvedSettlementState;
  if (noTagRequiredEl) noTagRequiredEl.checked = Boolean(transaction.no_tag_required);
  const hasCandidates = (classificationState.selfTransferCandidates || []).length > 0;
  classificationState.simpleContextExpanded = Boolean(
    transaction.no_tag_required
    || resolvedCounterpartyType
    || resolvedPrimaryFlowType
    || resolvedConsumptionOwnership
    || resolvedSettlementState
    || hasCandidates
  );
  renderSimpleChoiceGroups();
  syncSimpleReviewStatus({ forceAuto: !classificationState.simpleReviewStatusManual });
}

function hasSavedRecoveryForLineItem(lineItemId) {
  if (!lineItemId) return false;
  return Array.isArray(classificationState.split?.recoveries)
    && classificationState.split.recoveries.some((recovery) => String(recovery.split_line_item_id || "") === String(lineItemId));
}

function createSplitRow(row = {}) {
  const rawExpenseFor = String(row.expense_for || "");
  const loweredExpenseFor = rawExpenseFor.toLowerCase();
  const hasExplicitSelections = Boolean(row.line_kind || row.owner_type || row.category_id || row.subcategory_id);
  const looksLikeItemRow =
    classificationState.activeMode === "item" ||
    Boolean(row.line_kind) ||
    Boolean(row.owner_type) ||
    loweredExpenseFor === "keep" ||
    loweredExpenseFor === "refund" ||
    loweredExpenseFor === "self" ||
    loweredExpenseFor === "family" ||
    loweredExpenseFor === "other";
  const inferredLineKind = row.line_kind || (
    looksLikeItemRow && hasSavedRecoveryForLineItem(row.id) ? "Refund" : (loweredExpenseFor === "refund" ? "Refund" : "")
  );
  const inferredExpenseFor = row.expense_for || (
    looksLikeItemRow && hasSavedRecoveryForLineItem(row.id) ? "Refund" : ""
  );
  const inferredOwnerType = row.owner_type
    || (loweredExpenseFor === "self" ? "Self" : "")
    || (loweredExpenseFor === "family" ? "Family" : "")
    || (loweredExpenseFor === "other" ? "Other" : "")
    || (hasExplicitSelections ? "Self" : "");
  return {
    id: row.id || "",
    item_name: row.item_name || "",
    expense_for: inferredExpenseFor,
    line_kind: inferredLineKind,
    owner_type: inferredOwnerType,
    amount: Number(row.amount || 0),
    category_id: row.category_id || getSubcategoryById(row.subcategory_id)?.category?.id || "",
    subcategory_id: row.subcategory_id || "",
    primary_flow_type: row.primary_flow_type || "",
  };
}

/* ── Per-row category picker (#5) — same fuzzy index as the simple-mode picker
   (built once in DOMContentLoaded as _catSearchIndex), scoped per row. ── */
function splitRowCategoryLabel(row) {
  if (row.subcategory_id) {
    const m = getSubcategoryById(row.subcategory_id);
    if (m) {
      const pathNames = getSubcategoryPathIds(row.subcategory_id)
        .map((id) => getSubcategoryById(id)?.subcategory?.name)
        .filter(Boolean)
        .join(" / ");
      return [m.category?.name, pathNames].filter(Boolean).join(" / ");
    }
  }
  const c = getCategoryById(row.category_id);
  return c ? c.name : "";
}
function renderRowCategoryResults(index, query) {
  const box = document.querySelector(`[data-row-cat-results="${index}"]`);
  if (!box) return;
  const q = (query || "").trim().toLowerCase();
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; box._matches = []; return; }
  const terms = q.split(/\s+/);
  const matches = _catSearchIndex.filter((o) => terms.every((t) => o.label.toLowerCase().includes(t))).slice(0, 25);
  box._matches = matches;
  box.innerHTML = matches.length
    ? matches.map((m, i) => `<button type="button" data-row-cat-pick="${i}" class="block w-full px-3 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-primary/10">${escapeHtml(m.label)}</button>`).join("")
    : `<div class="px-3 py-2 text-xs text-slate-400">No matching category</div>`;
  box.classList.remove("hidden");
}
function applyRowCategoryPick(index, match) {
  const row = classificationState.splitRows[index];
  if (!row || !match) return;
  row.category_id = match.categoryId || "";
  row.subcategory_id = match.subcategoryId || "";
  markClassifyDirty();
  renderSplitRows();
}

/* Person-mode "My Share" category search (#5 for by-person) */
function _renderPersonSelfCategoryResults(query) {
  const box = document.getElementById("person-self-category-search-results");
  if (!box) return;
  const q = (query || "").trim().toLowerCase();
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; box._matches = []; return; }
  const terms = q.split(/\s+/);
  const matches = _catSearchIndex.filter((o) => terms.every((t) => o.label.toLowerCase().includes(t))).slice(0, 25);
  box._matches = matches;
  box.innerHTML = matches.length
    ? matches.map((m, i) => `<button type="button" data-cat-pick="${i}" class="block w-full px-3 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-primary/10">${escapeHtml(m.label)}</button>`).join("")
    : `<div class="px-3 py-2 text-xs text-slate-400">No matching category</div>`;
  box.classList.remove("hidden");
}
function _applyPersonSelfCategoryPick(match) {
  if (!match) return;
  classificationState.selfShare.category_id = match.categoryId || "";
  classificationState.selfShare.subcategory_id = match.subcategoryId || "";
  const box = document.getElementById("person-self-category-search-results");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  const input = document.getElementById("person-self-category-search");
  if (input) input.value = "";
  renderPersonSelfSection();
  markClassifyDirty();
}

function renderSplitRows() {
  const container = document.getElementById("split-rows");
  if (!container) return;
  if (!classificationState.expandedSplitRows) classificationState.expandedSplitRows = new Set();
  renderPersonSelfSection();
  updatePersonModeAvailability();
  if (classificationState.activeMode === "person" && !isPersonModeUnlocked()) {
    container.innerHTML = "";
    updateSummary();
    renderRecoveryControls();
    return;
  }
  if (!classificationState.splitRows.length) {
    classificationState.splitRows = [createSplitRow()];
  }

  container.innerHTML = classificationState.splitRows.map((row, index) => {
    const isPersonMode = classificationState.activeMode === "person";
    // Smart defaults (#6/#7): in item mode most rows are Keep + Self, so the user
    // only has to touch the exceptions. Written back so saving picks them up.
    if (!isPersonMode) {
      if (!row.line_kind && !isRefundRow(row)) row.line_kind = "Keep";
      if (!isRefundRow(row) && !row.owner_type) row.owner_type = "Self";
    }
    const rowCategory = row.category_id || getSubcategoryById(row.subcategory_id)?.category?.id || "";
    const categoryOptions = [
      '<option value="">Category</option>',
      ...classificationState.categories.map((cat) => `<option value="${cat.id}" ${String(cat.id) === String(rowCategory) ? "selected" : ""}>${escapeHtml(cat.name)}</option>`),
    ].join("");
    const rowSubcategorySelect = buildRowSubcategorySelectHtml(rowCategory, row.subcategory_id, index);
    const rowRecoveryState = getRowRecoveryState(index);
    const rowRecoveryTotals = getRecoveryTotalsForRow(index);
    const showRecoveryMetrics = isPersonMode || isRefundRow(row);
    const rowLocked = isRecoveryRowLocked(index);

    /* ── Left-border colour by row state ── */
    const isRefund = isRefundRow(row);
    const ownerType = getItemOwnerType(row);
    let accentColor = "#e2e8f0"; /* slate-200 default */
    if (rowLocked)          accentColor = "#cbd5e1"; /* slate-300 */
    else if (isRefund)      accentColor = "#f59e0b"; /* amber-400 */
    else if (ownerType === "Self")   accentColor = "#607AFB"; /* primary */
    else if (ownerType === "Family") accentColor = "#a78bfa"; /* violet-400 */
    else if (ownerType === "Other")  accentColor = "#38bdf8"; /* sky-400 */

    /* ── Recovery badges ── */
    const rowRecoveriesHtml = rowRecoveryTotals.recoveries.length
      ? `<div class="mt-2 flex flex-wrap gap-1.5">
          ${rowRecoveryTotals.recoveries.map((r) => `
            <span class="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white">
              ${escapeHtml(r.vendor_name || r.counterparty_identifier || r.recovery_type || "Linked")}
              <span class="text-slate-300">${escapeHtml(formatINR(r.amount))}</span>
            </span>`).join("")}
        </div>`
      : "";

    /* ── PERSON MODE row (unchanged layout, slightly refreshed) ── */
    if (isPersonMode) {
      const recoveryFooter = showRecoveryMetrics ? `
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2.5 text-[11px] text-slate-400 dark:text-slate-500">
          <span>Target <span class="font-semibold text-slate-600 dark:text-slate-300">${escapeHtml(formatINR(rowRecoveryTotals.target))}</span></span>
          <span>Received <span class="font-semibold text-teal-600">${escapeHtml(formatINR(rowRecoveryTotals.recovered))}</span></span>
          <span>Outstanding <span class="font-semibold ${rowRecoveryTotals.remaining > 0 ? "text-amber-600" : "text-emerald-600"}">${escapeHtml(formatINR(rowRecoveryTotals.remaining))}</span></span>
        </div>` : "";
      return `
        <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden" style="border-left:3px solid ${accentColor}">
          <!-- Single-row layout: number · name · amount · type · status · remove -->
          <div class="flex items-center gap-2 px-3 py-2.5 ${rowLocked ? "opacity-60" : ""}">
            <span class="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white" style="background:${accentColor}">${index + 1}</span>
            <input data-row-index="${index}" data-field="item_name"
              class="flex-1 min-w-0 rounded-lg border-slate-200 dark:border-slate-600 bg-transparent dark:bg-transparent dark:text-white px-2.5 py-1.5 text-sm font-semibold placeholder-slate-300 dark:placeholder-slate-600 focus:bg-white dark:focus:bg-slate-800 focus:border-primary transition-colors"
              placeholder="Friend A, Family…" value="${escapeHtml(row.item_name)}" ${rowLocked ? "disabled" : ""} />
            <div class="flex items-center gap-1 flex-shrink-0 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5">
              <span class="text-[11px] text-slate-400 dark:text-slate-500 font-semibold select-none">₹</span>
              <input data-row-index="${index}" data-field="amount" type="number" min="0" step="0.01"
                class="w-20 bg-transparent dark:text-white text-sm font-bold text-right focus:outline-none"
                placeholder="0.00" value="${Number(row.amount || 0).toFixed(2)}" ${rowLocked ? "disabled" : ""} />
            </div>
            <select data-row-index="${index}" data-field="primary_flow_type"
              class="flex-shrink-0 w-24 rounded-lg border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-white px-2 py-1.5 text-xs"
              ${rowLocked ? "disabled" : ""}>
              <option value="">Type…</option>
              <option value="expense" ${row.primary_flow_type === "expense" ? "selected" : ""}>Expense</option>
              <option value="investment_buy" ${row.primary_flow_type === "investment_buy" ? "selected" : ""}>Invest</option>
              <option value="loan_given" ${row.primary_flow_type === "loan_given" ? "selected" : ""}>Loan Out</option>
              <option value="transfer" ${row.primary_flow_type === "transfer" ? "selected" : ""}>Transfer</option>
              <option value="fee" ${row.primary_flow_type === "fee" ? "selected" : ""}>Fee</option>
            </select>
            ${rowRecoveryState.label !== "None" ? `<span class="flex-shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${rowRecoveryState.className}">${escapeHtml(rowRecoveryState.label)}</span>` : ""}
            <button type="button" data-remove-row="${index}" class="flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 transition hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-500 ${rowLocked ? "cursor-not-allowed" : ""}" ${rowLocked ? "disabled" : ""}>
              <span class="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          ${recoveryFooter}
          ${rowRecoveriesHtml}
        </div>`;
    }

    /* ── ITEM MODE row ── progressive disclosure (#6/#7) ──
       Collapsed default shows only Amount + searchable Category. Type / Who /
       Flow / subcategory live in a details drawer revealed by the ⌄ button;
       refund rows expand automatically because they need recovery linking. */
    let rowBg = "#ffffff";
    if (rowLocked)                   rowBg = "rgba(0,0,0,0.015)";
    else if (isRefund)               rowBg = "rgba(245,158,11,0.05)";
    else if (ownerType === "Self")   rowBg = "rgba(96,122,251,0.04)";
    else if (ownerType === "Family") rowBg = "rgba(167,139,250,0.05)";
    else if (ownerType === "Other")  rowBg = "rgba(56,189,248,0.05)";

    const expanded = isRefund || classificationState.expandedSplitRows.has(index);
    const catLabel = splitRowCategoryLabel(row);
    const kindStyle = isRefund
      ? "background:#fffbeb; border-color:#fcd34d; color:#b45309; font-weight:600"
      : "background:#eef1fe; border-color:#a5b4fc; color:#4f46e5; font-weight:600";

    const recoveriesInline = rowRecoveriesHtml
      ? `<div class="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-1.5">${rowRecoveriesHtml}</div>`
      : "";
    const metricsInline = showRecoveryMetrics
      ? `<div class="flex flex-wrap gap-3 border-t border-slate-100 px-3 py-1 text-[10px] text-slate-400">
           <span>Target <strong class="text-slate-600">${escapeHtml(formatINR(rowRecoveryTotals.target))}</strong></span>
           <span>· Recovered <strong style="color:#0d9488">${escapeHtml(formatINR(rowRecoveryTotals.recovered))}</strong></span>
           <span>· Remaining <strong style="color:#d97706">${escapeHtml(formatINR(rowRecoveryTotals.remaining))}</strong></span>
           ${rowLocked ? `<span style="color:#64748b">🔒 Locked</span>` : ""}
         </div>`
      : rowLocked
        ? `<div class="border-t border-slate-100 px-3 py-1 text-[10px]" style="color:#64748b">🔒 Fully recovered — row locked</div>`
        : "";

    return `
      <div class="overflow-visible rounded-xl border border-slate-200 ${rowLocked ? "opacity-60" : ""}" style="border-left:3px solid ${accentColor}; background:${rowBg}">
        <!-- Main line: amount + searchable category -->
        <div class="flex items-center gap-2 px-3 py-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">${index + 1}</span>
          <input data-row-index="${index}" data-field="amount" type="number" min="0" step="0.01"
            class="w-[96px] shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900"
            placeholder="0.00" value="${Number(row.amount || 0).toFixed(2)}" ${rowLocked ? "disabled" : ""} />
          <div class="relative min-w-0 flex-1">
            <input data-row-cat-search="${index}" type="text" autocomplete="off"
              class="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
              placeholder="🔍 Search category…" value="${escapeHtml(catLabel)}" ${rowLocked ? "disabled" : ""} />
            <div data-row-cat-results="${index}" class="hidden absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800"></div>
          </div>
          ${isRefund ? `<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style="${kindStyle}">↩ Refund</span>`
            : (ownerType && ownerType !== "Self") ? `<span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">${escapeHtml(ownerType)}</span>` : ""}
          <button type="button" data-toggle-row-details="${index}" title="More options"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-primary/40 hover:text-primary"
            ${isRefund ? "disabled" : ""}>
            <span class="material-symbols-outlined text-[16px] transition-transform ${expanded ? "rotate-180" : ""}">expand_more</span>
          </button>
          <button type="button" data-remove-row="${index}"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-300 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500 ${rowLocked ? "cursor-not-allowed opacity-30" : ""}"
            ${rowLocked ? "disabled" : ""}>
            <span class="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
        <!-- Details drawer: Type / Who / Flow / subcategory -->
        <div data-row-details="${index}" class="${expanded ? "" : "hidden"} grid gap-2 border-t border-slate-100 px-3 py-2 sm:grid-cols-[108px_108px_120px_minmax(0,1fr)]" style="background:rgba(248,250,252,0.6)">
          <div>
            <label class="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Type</label>
            <select data-row-index="${index}" data-field="line_kind" class="w-full rounded-lg border px-2 py-1.5 text-sm" style="${kindStyle}" ${rowLocked ? "disabled" : ""}>
              <option value="Keep" ${String(row.line_kind || "Keep") === "Keep" ? "selected" : ""}>✓ Keep</option>
              <option value="Refund" ${String(row.line_kind || "") === "Refund" ? "selected" : ""}>↩ Refund</option>
            </select>
          </div>
          <div>
            <label class="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Who</label>
            <select data-row-index="${index}" data-field="owner_type" class="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
              style="${isRefund ? "opacity:0.4" : ""}" ${(isRefund || rowLocked) ? "disabled" : ""}>
              <option value="Self" ${String(getItemOwnerType(row)) === "Self" ? "selected" : ""}>Self</option>
              <option value="Family" ${String(getItemOwnerType(row)) === "Family" ? "selected" : ""}>Family</option>
              <option value="Other" ${String(getItemOwnerType(row)) === "Other" ? "selected" : ""}>Other</option>
            </select>
          </div>
          <div>
            <label class="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Flow</label>
            <select data-row-index="${index}" data-field="primary_flow_type" class="w-full rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 text-xs text-slate-700" ${rowLocked ? "disabled" : ""}>
              <option value="">Flow…</option>
              <option value="expense" ${row.primary_flow_type === "expense" ? "selected" : ""}>Expense</option>
              <option value="investment_buy" ${row.primary_flow_type === "investment_buy" ? "selected" : ""}>Invest</option>
              <option value="loan_given" ${row.primary_flow_type === "loan_given" ? "selected" : ""}>Loan Out</option>
              <option value="loan_taken" ${row.primary_flow_type === "loan_taken" ? "selected" : ""}>Loan In</option>
              <option value="transfer" ${row.primary_flow_type === "transfer" ? "selected" : ""}>Transfer</option>
              <option value="fee" ${row.primary_flow_type === "fee" ? "selected" : ""}>Fee</option>
            </select>
          </div>
          <div style="min-width:0">
            <label class="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Refine subcategory</label>
            <div class="space-y-1">${rowSubcategorySelect}</div>
          </div>
        </div>
        ${metricsInline}${recoveriesInline}
      </div>`;
  }).join("");
  classificationState.splitRows.forEach((_row, index) => {
    if (!isRecoveryRowLocked(index)) return;
    container
      .querySelectorAll(`[data-row-index="${index}"][data-row-sub-level]`)
      .forEach((select) => {
        select.disabled = true;
      });
  });
  updateSummary();
  renderRecoveryControls();
}

function setMode(mode) {
  classificationState.activeMode = mode;
  const activeMode = classificationState.activeMode;
  const layout = document.getElementById("classification-layout");
  const sidebar = document.getElementById("classification-sidebar");
  const allocationPanel = document.getElementById("allocation-summary-panel");
  document.getElementById("simple-mode-panel").classList.toggle("hidden", activeMode !== "simple");
  document.getElementById("split-mode-panel").classList.toggle("hidden", activeMode === "simple");
  const hideSidebar = false;
  const hideAllocationPanel = activeMode === "simple";
  if (layout) {
    layout.classList.toggle("lg:grid-cols-[minmax(0,1fr)_340px]", !hideSidebar);
    layout.classList.toggle("lg:grid-cols-1", hideSidebar);
  }
  if (sidebar) {
    sidebar.classList.toggle("hidden", hideSidebar);
    sidebar.toggleAttribute("hidden", hideSidebar);
  }
  if (allocationPanel) {
    allocationPanel.classList.toggle("hidden", hideAllocationPanel);
    allocationPanel.toggleAttribute("hidden", hideAllocationPanel);
  }
  document.getElementById("split-panel-title").textContent = activeMode === "person" ? "Split this transaction between people" : "Split this transaction into detailed rows";
  /* Show column headers only in item mode */
  const rowsHeader = document.getElementById("split-rows-header");
  // New progressive-disclosure rows are self-explanatory cards, so the old
  // spreadsheet column header doesn't apply to either mode.
  if (rowsHeader) rowsHeader.style.display = "none";
  const splitRowsHelp = document.getElementById("split-rows-help");
  if (splitRowsHelp) {
    splitRowsHelp.innerHTML = activeMode === "person"
      ? 'Each row should represent one final bucket like <span class="font-semibold text-slate-700">Friends Share</span>, <span class="font-semibold text-slate-700">Family Share</span>, or <span class="font-semibold text-slate-700">Returned Items</span>.'
      : 'For item split, mark each row as <span class="font-semibold text-slate-700">Keep</span> or <span class="font-semibold text-slate-700">Refund</span>. Kept items can belong to <span class="font-semibold text-slate-700">Self</span>, <span class="font-semibold text-slate-700">Family</span>, or <span class="font-semibold text-slate-700">Other</span>.';
  }
  const activeInput = document.querySelector(`input[name="classification_mode"][value="${activeMode}"]`);
  if (activeInput) activeInput.checked = true;
  updateModeIndicators();
  if (activeMode !== "simple") {
    renderSplitRows();
  }
}

async function loadContext() {
  const response = await fetch(`/classification/api/context/${window.TRANSACTION_ID}`);
  const result = await parseJsonResponse(response);
  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Unable to load classification context.");
  }

  classificationState.transaction = result.data.transaction || {};
  classificationState.split = result.data.split || null;
  classificationState.learnedDefaults = classificationState.transaction.learned_defaults || null;
  classificationState.selfTransferCandidates = Array.isArray(classificationState.transaction.self_transfer_candidates)
    ? classificationState.transaction.self_transfer_candidates
    : [];
  classificationState.categories = Array.isArray(result.data.categories) ? result.data.categories : [];
  classificationState.recoveryCandidates = Array.isArray(result.data.recovery_candidates) ? result.data.recovery_candidates : [];
  classificationState.savedMode = "";
  classificationState.simpleNatureManual = false;
  classificationState.simplePartyManual = false;
  classificationState.simpleVendorManual = false;
  if (!classificationState.split?.split_id) {
    classificationState.pendingRecoveries = [];
  }
  renderTransactionHeader();
  const derivedSelection = deriveSimpleSelectionFromTags();
  populateCategorySelects(derivedSelection.subcategoryId, derivedSelection.categoryId);
  document.getElementById("simple-vendor").value =
    classificationState.transaction.vendor_name
    || classificationState.transaction.counterparty_entity_name
    || classificationState.learnedDefaults?.vendor_name
    || "";
  setSimpleReviewFields();

  const derivedSavedMode = getSavedClassificationMode();
  classificationState.savedMode = derivedSavedMode;

  if (hasMeaningfulSavedSplit()) {
    const savedSelfLine = getSavedSelfLineItem();
    classificationState.selfShare = {
      item_name: savedSelfLine?.item_name || "My Share",
      amount: Number(savedSelfLine?.amount || 0),
      category_id: savedSelfLine?.category_id || "",
      subcategory_id: savedSelfLine?.subcategory_id || "",
    };
    const savedSplitMode = classificationState.split?.split?.split_mode === "quick" ? "person" : "item";
    classificationState.splitRows = getSavedNonSelfLineItems(savedSplitMode).map((row) => createSplitRow(row));
    setMode(savedSplitMode);
  } else {
    classificationState.splitRows = [createSplitRow()];
    classificationState.selfShare = {
      item_name: "My Share",
      amount: 0,
      category_id: "",
      subcategory_id: "",
    };
    setMode(derivedSavedMode || "simple");
  }
  if (!derivedSavedMode && (initialMode === "item" || initialMode === "person" || initialMode === "simple")) {
    setMode(initialMode);
  }
  const activeInput = document.querySelector(`input[name="classification_mode"][value="${classificationState.activeMode}"]`);
  if (activeInput) activeInput.checked = true;
  document.getElementById("split-vendor").value = classificationState.transaction.vendor_name || "";
  document.getElementById("split-notes").value = classificationState.split?.split?.notes || "";
  renderRecoveryControls();
}

function collectSimplePayload() {
  const subcategoryId = getSelectedSimpleSubcategoryId();
  const categoryId = document.getElementById("simple-category")?.value || "";
  const effectiveCategoryId = classificationState.simpleCategoryTouched ? categoryId : "";
  const noTagRequired = Boolean(document.getElementById("simple-no-tag-required")?.checked);
  return {
    transaction_id: window.TRANSACTION_ID,
    vendor_name: document.getElementById("simple-vendor")?.value || "",
    category_id: effectiveCategoryId || null,
    subcategory_id: subcategoryId || null,
    review_status: deriveAutoReviewStatus(),
    review_status_manual: true,  // user explicitly submitted this classification
    counterparty_type: getSelectedStructuredCounterpartyType(),
    primary_flow_type: getSelectedStructuredPrimaryFlowType(),
    consumption_ownership: getSelectedStructuredConsumptionOwnership(),
    settlement_state: getSelectedStructuredSettlementState(),
    self_transfer_transaction_id: document.getElementById("simple-self-transfer-transaction")?.value || null,
    no_tag_required: noTagRequired,
    apply_to_similar_transactions: document.getElementById("simple-apply-similar")?.checked || false,
    counterparty_identifier: classificationState.transaction?.counterparty_identifier || "",
  };
}

// options: { next } caller advances to the next review item; { stay } save in place
// and show an undo toast; default returns to Reports (legacy behaviour).
async function saveSimple(options = {}) {
  syncSimpleReviewStatus();
  try {
    setStatusMessage("simple-status", "info", "Saving simple classification...");
    const response = await fetch("/classification/api/simple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectSimplePayload()),
    });
    const result = await response.json();
    const _saveMsg = (() => {
      if (!result.success) return result.message || "Unable to save classification.";
      const _ids = Array.isArray(result.data?.transaction_ids) ? result.data.transaction_ids : [];
      if (_ids.length > 1) return `Saved — applied to this + ${_ids.length - 1} similar transaction${_ids.length - 1 === 1 ? "" : "s"}.`;
      return "Saved.";
    })();
    setStatusMessage("simple-status", result.success ? "success" : "error", _saveMsg);
    if (result.success) {
      clearClassifyDirty();
      stashUndoToken();
      if (options.next) return true;
      returnToReports();
      return true;
    }
    return false;
  } catch (error) {
    setStatusMessage("simple-status", "error", error.message || "Unable to save classification.");
    return false;
  }
}

async function saveSplit() {
  if (classificationState.activeMode === "person" && !isPersonModeUnlocked()) {
    setStatusMessage("split-status", "warn", "Enter your share first. Once that is set, the rest of the split will unlock.");
    return;
  }
  const total = Math.abs(Number(classificationState.transaction?.amount || 0));
  const personRowsWithAmount = classificationState.splitRows.filter((row) => normalizeAmount(row.amount) > 0);

  if (classificationState.activeMode === "person" && personRowsWithAmount.length === 0) {
    const selfAmount = normalizeAmount(classificationState.selfShare.amount || 0);
    if (Math.abs(total - selfAmount) > 0.01) {
      setStatusMessage(
        "split-status",
        selfAmount < total ? "warn" : "error",
        selfAmount < total
          ? `${formatINR(total - selfAmount)} is still missing. If this is only your own expense, your share should match the full transaction amount.`
          : `${formatINR(selfAmount - total)} is extra. Reduce your share to match the transaction total.`
      );
      return;
    }
    if (!classificationState.selfShare.category_id) {
      setStatusMessage("split-status", "warn", "Choose a primary category for your share before saving.");
      return;
    }

    try {
      setStatusMessage("split-status", "info", "Saving your share as a simple transaction...");
      const simpleResponse = await fetch("/classification/api/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: window.TRANSACTION_ID,
          vendor_name: document.getElementById("split-vendor")?.value || classificationState.transaction?.vendor_name || "",
          category_id: classificationState.selfShare.category_id || null,
          subcategory_id: classificationState.selfShare.subcategory_id,
          no_tag_required: false,
          apply_to_similar_transactions: false,
          counterparty_identifier: classificationState.transaction?.counterparty_identifier || "",
        }),
      });
      const simpleResult = await simpleResponse.json();
      if (!simpleResponse.ok || simpleResult.success === false) {
        throw new Error(simpleResult.message || "Unable to save your share classification.");
      }

      const noSplitResponse = await fetch("/classification/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: window.TRANSACTION_ID,
          vendor_name: document.getElementById("split-vendor")?.value || "",
          notes: document.getElementById("split-notes")?.value || "",
          mode: "person",
          no_split_required: true,
          line_items: [],
        }),
      });
      const noSplitResult = await noSplitResponse.json();
      if (!noSplitResponse.ok || noSplitResult.success === false) {
        throw new Error(noSplitResult.message || "Unable to save this as a no-split transaction.");
      }

      returnToReports();
      return;
    } catch (error) {
      setStatusMessage("split-status", "error", error.message || "Unable to save split.");
      return;
    }
  }

  const personModeLineItems = classificationState.activeMode === "person"
    ? [
        {
          id: getSavedSelfLineItem()?.id || null,
          item_name: classificationState.selfShare.item_name || "My Share",
          expense_for: "Self",
          amount: Number(classificationState.selfShare.amount || 0),
          category_id: classificationState.selfShare.category_id || null,
          subcategory_id: classificationState.selfShare.subcategory_id || null,
        },
        ...classificationState.splitRows.map((row, index) => ({
          id: row.id || null,
          item_name: (row.item_name || "").trim(),
          expense_for: row.item_name || row.expense_for || "Other",
          amount: Number(row.amount || 0),
          category_id: row.category_id || null,
          subcategory_id: classificationState.activeMode === "person" ? null : (row.subcategory_id || null),
          primary_flow_type: row.primary_flow_type || null,
        })),
      ]
    : [];
  const payload = {
    transaction_id: window.TRANSACTION_ID,
    vendor_name: document.getElementById("split-vendor")?.value || "",
    notes: document.getElementById("split-notes")?.value || "",
    mode: classificationState.activeMode === "person" ? "person" : "item",
    no_split_required: false,
    line_items: classificationState.activeMode === "person" ? personModeLineItems : classificationState.splitRows.map((row, index) => ({
      id: row.id || null,
      item_name: (row.item_name || "").trim(),
      expense_for: classificationState.activeMode === "person" ? row.item_name || row.expense_for || "Other" : (isRefundRow(row) ? "Refund" : getItemOwnerType(row)),
      amount: Number(row.amount || 0),
      category_id: row.category_id || null,
      subcategory_id: classificationState.activeMode === "person" ? null : (row.subcategory_id || null),
      line_kind: classificationState.activeMode === "person" ? null : (row.line_kind || null),
      owner_type: classificationState.activeMode === "person" ? null : (isRefundRow(row) ? null : (getItemOwnerType(row) || null)),
      primary_flow_type: row.primary_flow_type || null,
    })),
  };

  const allocated = (payload.line_items || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const remaining = Number((total - allocated).toFixed(2));
  if (classificationState.activeMode === "item") {
    const incompleteRow = classificationState.splitRows.find((row) => {
      if (normalizeAmount(row.amount || 0) <= 0) return false;
      if (!row.line_kind) return true;
      if (!isRefundRow(row) && !getItemOwnerType(row)) return true;
      return false;
    });
    if (incompleteRow) {
      setStatusMessage("split-status", "warn", "Choose row type and owner for every detailed row before saving.");
      return;
    }
  }
  if (Math.abs(remaining) > 0.01) {
    setStatusMessage(
      "split-status",
      remaining > 0 ? "warn" : "error",
      remaining > 0
        ? `${formatINR(Math.abs(remaining))} is still missing. Add it to your share or another row before saving.`
        : `${formatINR(Math.abs(remaining))} is extra. Reduce one of the row amounts before saving.`
    );
    return;
  }

  try {
    setStatusMessage("split-status", "info", "Saving split classification...");
    const response = await fetch("/classification/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setStatusMessage("split-status", result.success ? "success" : "error", result.success ? "Saved split classification." : (result.message || "Unable to save split."));
    if (result.success) {
      classificationState.savedMode = classificationState.activeMode;
      const savedLineItems = Array.isArray(result.data?.line_items) ? result.data.line_items : [];
      await persistPendingRecoveries(savedLineItems);
      returnToReports();
    }
  } catch (error) {
    setStatusMessage("split-status", "error", error.message || "Unable to save split.");
  }
}

async function persistPendingRecoveries(savedLineItems) {
  if (!classificationState.pendingRecoveries.length) return;

  for (const pendingRecovery of classificationState.pendingRecoveries) {
    let splitLineItemId = null;
    if (pendingRecovery.rowIndex !== null && pendingRecovery.rowIndex !== undefined) {
      const offset = classificationState.activeMode === "person" ? 1 : 0;
      splitLineItemId = savedLineItems[pendingRecovery.rowIndex + offset]?.id || null;
    }

    const response = await fetch("/reports/transaction_split/recovery_link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: window.TRANSACTION_ID,
        split_line_item_id: splitLineItemId,
        recovery_transaction_id: pendingRecovery.recovery_transaction_id,
        amount: pendingRecovery.amount,
        recovery_type: pendingRecovery.recovery_type,
      }),
    });
    const result = await response.json();
    if (!response.ok || result.success === false) {
      throw new Error(result.message || "Unable to save linked transaction.");
    }
  }

  classificationState.pendingRecoveries = [];
}

async function linkRecoveryTransaction() {
  const target = parseRecoveryTargetValue(document.getElementById("recovery-line-item")?.value || "");
  const payload = {
    transaction_id: window.TRANSACTION_ID,
    split_line_item_id: target.savedLineItemId,
    recovery_transaction_id: document.getElementById("recovery-candidate")?.value || null,
    amount: Number(document.getElementById("recovery-amount")?.value || 0),
    recovery_type: document.getElementById("recovery-type")?.value || "Merchant Refund",
  };
  if (!payload.recovery_transaction_id || payload.amount <= 0) {
    document.getElementById("recovery-status").textContent = "Choose a transaction and amount to link.";
    return;
  }
  if (target.rowIndex !== null && target.rowIndex !== undefined) {
    const { remaining } = getRecoveryTotalsForRow(target.rowIndex);
    if (payload.amount - remaining > 0.01) {
      document.getElementById("recovery-status").textContent = `This link is larger than the remaining ${formatINR(remaining)} for the selected row.`;
      return;
    }
  }
  if (!classificationState.split?.split_id) {
    const candidate = classificationState.recoveryCandidates.find((item) => String(item.id) === String(payload.recovery_transaction_id));
    classificationState.pendingRecoveries = [
      {
        id: `pending-${Date.now()}`,
        rowIndex: target.rowIndex,
        split_line_item_id: null,
        recovery_transaction_id: payload.recovery_transaction_id,
        recovery_type: payload.recovery_type,
        amount: payload.amount,
        transaction_date: candidate?.transaction_date || null,
        counterparty_identifier: candidate?.counterparty_identifier || null,
        vendor_name: candidate?.vendor_name || null,
        is_pending: true,
      },
      ...classificationState.pendingRecoveries.filter((item) => String(item.recovery_transaction_id) !== String(payload.recovery_transaction_id)),
    ];
    document.getElementById("recovery-status").textContent = "Transaction queued. It will be linked when you save the split.";
    renderRecoveryControls();
    renderSplitRows();
    return;
  }
  const response = await fetch("/reports/transaction_split/recovery_link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  document.getElementById("recovery-status").textContent = result.success ? "Linked settlement transaction." : (result.message || "Unable to link transaction.");
  if (result.success) {
    await loadContext();
    setMode(classificationState.activeMode);
  }
}

async function removeRecoveryTransaction(recoveryId) {
  const pendingRecovery = classificationState.pendingRecoveries.find((item) => String(item.id) === String(recoveryId));
  if (pendingRecovery) {
    classificationState.pendingRecoveries = classificationState.pendingRecoveries.filter((item) => String(item.id) !== String(recoveryId));
    document.getElementById("recovery-status").textContent = "Removed pending linked transaction.";
    renderSplitRows();
    return;
  }

  const response = await fetch(`/reports/transaction_split/recovery_link/${recoveryId}`, {
    method: "DELETE",
  });
  const result = await response.json();
  document.getElementById("recovery-status").textContent = result.success ? "Removed linked transaction." : (result.message || "Unable to remove linked transaction.");
  if (result.success) {
    await loadContext();
    setMode(classificationState.activeMode);
  }
}

/* ── Unsaved-changes guard (#5) ─────────────────────────────────────────── */
let _classifyDirty = false;
let _suppressUnsavedGuard = false;
function markClassifyDirty()  { _classifyDirty = true; }
function clearClassifyDirty() { _classifyDirty = false; }
window.addEventListener("beforeunload", (e) => {
  if (_classifyDirty && !_suppressUnsavedGuard) { e.preventDefault(); e.returnValue = ""; }
});

/* ── Searchable category picker (#1) ────────────────────────────────────── */
let _catSearchIndex = [];
function buildCategorySearchIndex() {
  const out = [];
  (classificationState.categories || []).forEach((cat) => {
    const leaves = flattenLeafSubcategoryOptions(cat.subcategories || []);
    if (leaves.length) {
      // Path labels already carry the parent chain, so same-named leaves under
      // different parents (e.g. petrol 2W vs 4W) are naturally disambiguated.
      leaves.forEach((leaf) => out.push({ categoryId: cat.id, subcategoryId: leaf.id, label: `${cat.name} / ${leaf.label}` }));
    } else {
      out.push({ categoryId: cat.id, subcategoryId: "", label: cat.name });
    }
  });
  return out;
}
function renderCategorySearchResults(query) {
  const box = document.getElementById("simple-category-search-results");
  if (!box) return;
  const q = (query || "").trim().toLowerCase();
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; box._matches = []; return; }
  const terms = q.split(/\s+/);
  const matches = _catSearchIndex.filter((o) => terms.every((t) => o.label.toLowerCase().includes(t))).slice(0, 30);
  box._matches = matches;
  box.innerHTML = matches.length
    ? matches.map((m, i) => `<button type="button" data-cat-pick="${i}" class="block w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-primary/10">${escapeHtml(m.label)}</button>`).join("")
    : `<div class="px-3 py-2 text-xs text-slate-400">No matching category</div>`;
  box.classList.remove("hidden");
}
function applyCategorySearchPick(match) {
  if (!match) return;
  classificationState.simpleCategoryTouched = true;
  if (match.subcategoryId) {
    populateCategorySelects(match.subcategoryId);
  } else {
    const sel = document.getElementById("simple-category");
    if (sel) sel.value = match.categoryId;
    renderSimpleSubcategoryChain(match.categoryId, "");
  }
  const box = document.getElementById("simple-category-search-results");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  const input = document.getElementById("simple-category-search");
  if (input) input.value = "";
  document.getElementById("simple-suggestion")?.classList.add("hidden");
  syncSimpleReviewStatus();
  markClassifyDirty();
}

/* ── Insights: guess (#3), apply-to-similar preview (#4), amount (#8) ────── */
async function loadInsights() {
  try {
    const res = await fetch(`/classification/api/insights/${window.TRANSACTION_ID}`);
    const result = await res.json();
    if (!result || !result.success) return;
    classificationState.insights = result.data || {};
    renderAmountContext();
    renderApplySimilarCount();
    renderSuggestion();
    renderMerchantHistory();
  } catch (e) { /* non-fatal */ }
}
function renderMerchantHistory() {
  const el = document.getElementById("tx-merchant-history");
  if (!el) return;
  const ins = classificationState.insights || {};
  const count = ins.similar_count || 0;
  const amount = ins.amount;
  if (count > 0 && amount?.median) {
    el.textContent = `${count} past transaction${count === 1 ? "" : "s"} here · avg ${formatINR(amount.median)}`;
    el.classList.remove("hidden");
  } else if (count > 0) {
    el.textContent = `${count} past transaction${count === 1 ? "" : "s"} from this counterparty`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}
function renderAmountContext() {
  const el = document.getElementById("tx-amount-context");
  if (!el) return;
  const a = classificationState.insights?.amount;
  if (!a || !a.median) { el.classList.add("hidden"); return; }
  if (a.is_anomaly) {
    el.textContent = `≈${a.ratio.toFixed(1)}× your usual ${formatINR(a.median)} here`;
    el.className = "mt-1.5 text-xs font-semibold text-amber-600";
  } else {
    el.textContent = `Usual here: ${formatINR(a.median)} · ${a.samples} past txn${a.samples === 1 ? "" : "s"}`;
    el.className = "mt-1.5 text-xs font-semibold text-slate-400";
  }
  el.classList.remove("hidden");
}
function syncSaveButtonLabel() {
  const btn = document.getElementById("save-simple-btn");
  const preview = document.getElementById("apply-similar-preview");
  const checked = document.getElementById("simple-apply-similar")?.checked;
  const n = classificationState.insights?.similar_count || 0;
  if (checked && n > 0) {
    if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1">save</span>Save (+${n}) <kbd>S</kbd>`;
    if (preview) { preview.textContent = `Will confirm this transaction + ${n} similar from the same counterparty.`; preview.classList.remove("hidden"); }
  } else {
    if (btn) btn.innerHTML = `<span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1">save</span>Save <kbd>S</kbd>`;
    if (preview) preview.classList.add("hidden");
  }
}

function renderApplySimilarCount() {
  const el = document.getElementById("simple-apply-similar-count");
  if (!el) return;
  const cb = document.getElementById("simple-apply-similar");
  const loaded = classificationState.insights && typeof classificationState.insights.similar_count !== "undefined";
  const n = loaded ? (classificationState.insights.similar_count || 0) : null;
  if (n && n > 0) {
    el.textContent = `→ ${n} similar`;
    el.title = `"Apply to similar" will also update ${n} other transaction${n === 1 ? "" : "s"} from this counterparty`;
    el.classList.remove("hidden");
    if (cb) { cb.disabled = false; cb.title = ""; }
  } else if (loaded) {
    // Insights loaded but nothing matches — make the no-op visible instead of silent.
    el.classList.add("hidden");
    if (cb) { cb.disabled = true; cb.checked = false; cb.title = "No other transactions from this counterparty"; }
  } else {
    // Insights unavailable (e.g. server not restarted) — leave the box usable.
    el.classList.add("hidden");
  }
  syncSaveButtonLabel();
}
function renderSuggestion() {
  const box = document.getElementById("simple-suggestion");
  if (!box) return;
  const s = classificationState.insights?.suggestion;
  const alreadyChosen = Boolean(getSelectedSimpleSubcategoryId()) && classificationState.simpleCategoryTouched;
  if (!s || alreadyChosen) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const confidence = s.count >= 10 ? "High" : s.count >= 3 ? "Good" : "Low";
  const confColor  = s.count >= 10 ? "text-emerald-600" : s.count >= 3 ? "text-violet-600" : "text-slate-400";
  box.className = "rounded-xl border border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800/40 px-3.5 py-2.5 mb-2";
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[10px] font-bold uppercase tracking-widest text-violet-400 mb-0.5">Suggested category</p>
        <p class="text-sm font-bold text-violet-900 dark:text-violet-200 truncate">${escapeHtml(s.label)}</p>
        <p class="text-[10px] text-violet-500 mt-0.5">Based on ${s.count} past transaction${s.count === 1 ? "" : "s"} · <span class="${confColor} font-semibold">${confidence} confidence</span></p>
      </div>
      <button type="button" id="simple-accept-suggestion" class="shrink-0 rounded-lg bg-violet-600 dark:bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 dark:hover:bg-violet-600 active:scale-95 transition-all">
        <span class="material-symbols-outlined text-[14px] mr-1 align-middle">check</span>Use this
      </button>
    </div>`;
  box.classList.remove("hidden");
  document.getElementById("simple-accept-suggestion")?.addEventListener("click", () => {
    classificationState.simpleCategoryTouched = true;
    if (s.subcategoryId) {
      populateCategorySelects(s.subcategoryId);
    } else if (s.categoryId) {
      const sel = document.getElementById("simple-category");
      if (sel) sel.value = s.categoryId;
      renderSimpleSubcategoryChain(s.categoryId, "");
    }
    syncSimpleReviewStatus();
    box.classList.add("hidden");
    markClassifyDirty();
    window.toast?.success(`Applied: ${s.label}`);
  });
}

/* ── Save & next to review (#2) ─────────────────────────────────────────── */
async function gotoNextReview() {
  try {
    const res = await fetch(`/classification/api/next_unreviewed?exclude=${encodeURIComponent(window.TRANSACTION_ID)}`);
    const result = await res.json();
    const nextId = result?.data?.transaction_id;
    if (nextId) {
      _suppressUnsavedGuard = true;
      window.location.href = `/classification/transaction/${nextId}?mode=simple`;
      return true;
    }
  } catch (e) { /* fall through */ }
  return false;
}
async function saveSimpleAndNext() {
  const ok = await saveSimple({ next: true });
  if (!ok) return;
  const advanced = await gotoNextReview();
  if (!advanced) { window.toast?.info("All caught up — nothing left to review"); returnToReports(); }
}

/* ── Undo after save (#10) — stash the as-opened payload; app-init.js shows a
   cross-page "Saved ✓ Undo" toast on the destination page, so Save can still
   redirect to Reports while keeping Undo available. ───────────────────────── */
function stashUndoToken() {
  const prior = classificationState.loadedPayload;
  if (!prior) return;
  const label = classificationState.transaction?.vendor_name
    || classificationState.transaction?.counterparty_entity_name
    || "transaction";
  try { sessionStorage.setItem("ft_classify_undo", JSON.stringify({ payload: prior, label })); } catch (e) {}
}

/* ── Keyboard shortcuts (#7) — see catalog in app-init.js ───────────────── */
function kbSetMode(mode) {
  const input = document.querySelector(`input[name="classification_mode"][value="${mode}"]`);
  if (input) input.checked = true;
  setMode(mode);
}

document.addEventListener("DOMContentLoaded", async () => {
  const heroCard = document.getElementById("tx-hero-card");
  heroCard?.classList.add("animate-pulse");
  try {
    await loadContext();
    _catSearchIndex = buildCategorySearchIndex();
    loadInsights();
    // Snapshot the as-loaded payload so Undo can revert to the opening state.
    classificationState.loadedPayload = collectSimplePayload();
  } catch (error) {
    document.getElementById("tx-vendor").textContent = "Unable to load transaction";
    document.getElementById("tx-meta").textContent = error.message || "Something went wrong.";
  } finally {
    heroCard?.classList.remove("animate-pulse");
  }

  document.querySelectorAll('input[name="classification_mode"]').forEach((input) => {
    input.addEventListener("change", () => setMode(input.value));
  });

  document.getElementById("simple-category")?.addEventListener("change", (event) => {
    classificationState.simpleCategoryTouched = true;
    renderSimpleSubcategoryChain(event.target.value);
    syncSimpleReviewStatus();
  });

  document.getElementById("simple-vendor")?.addEventListener("input", () => {
    classificationState.simpleVendorManual = true;
    updateLearnedVendorNote();
    syncSimpleReviewStatus();
  });

  document.getElementById("simple-context-toggle")?.addEventListener("click", () => {
    classificationState.simpleContextExpanded = !classificationState.simpleContextExpanded;
    syncSimpleContextVisibility();
  });

  document.getElementById("simple-subcategory-chain")?.addEventListener("change", (event) => {
    const level = Number(event.target.dataset.simpleSubLevel);
    if (Number.isNaN(level)) return;
    classificationState.simpleCategoryTouched = true;
    const categoryId = document.getElementById("simple-category")?.value || "";
    const selectedValues = [...document.querySelectorAll("[data-simple-sub-level]")]
      .slice(0, level + 1)
      .map((select) => select.value)
      .filter(Boolean);
    renderSimpleSubcategoryChain(categoryId, selectedValues[selectedValues.length - 1] || "");
    syncSimpleReviewStatus();
  });

  document.getElementById("simple-no-tag-required")?.addEventListener("change", () => {
    syncSimpleReviewStatus();
  });

  document.getElementById("simple-apply-similar")?.addEventListener("change", syncSaveButtonLabel);

  // Self-transfer toggle — checking marks as transfer, unchecking clears it
  document.getElementById("simple-self-transfer-toggle")?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    const primaryFlowTypeEl      = document.getElementById("simple-primary-flow-type");
    const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
    const settlementStateEl      = document.getElementById("simple-settlement-state");
    const noTagEl                = document.getElementById("simple-no-tag-required");
    const selectEl               = document.getElementById("simple-self-transfer-transaction");
    if (checked) {
      if (primaryFlowTypeEl)      primaryFlowTypeEl.value      = "transfer";
      if (consumptionOwnershipEl) consumptionOwnershipEl.value = "not_consumption";
      if (settlementStateEl)      settlementStateEl.value      = "none";
      if (noTagEl)                noTagEl.checked              = true;
    } else {
      if (primaryFlowTypeEl)      primaryFlowTypeEl.value = "";
      if (consumptionOwnershipEl && consumptionOwnershipEl.value === "not_consumption") consumptionOwnershipEl.value = "";
      if (settlementStateEl      && settlementStateEl.value      === "none")            settlementStateEl.value      = "";
      if (noTagEl)                noTagEl.checked = false;
      if (selectEl)               selectEl.value  = "";
    }
    renderSimpleChoiceGroups();
    syncSimpleReviewStatus();
  });

  // Linking a specific candidate transaction is optional — just syncs review status
  document.getElementById("simple-self-transfer-transaction")?.addEventListener("change", () => {
    syncSimpleReviewStatus();
  });

  document.getElementById("simple-editor")?.addEventListener("click", (event) => {
    const choiceButton = event.target.closest("[data-choice-target]");
    if (!choiceButton) return;

    const targetId = choiceButton.dataset.choiceTarget;
    const nextValue = choiceButton.dataset.choiceValue ?? "";
    const target = document.getElementById(targetId);
    if (!target) return;

    target.value = nextValue;
    if (targetId === "simple-review-status") {
      classificationState.simpleReviewStatusManual = true;
    } else if (targetId === "simple-bucket") {
      classificationState.simplePartyManual = true;
      classificationState.simpleNatureManual = true;
      const mapped = mapSimpleBucketToFields(nextValue);
      const partyEl = document.getElementById("simple-party-type");
      const natureEl = document.getElementById("simple-transaction-nature");
      const counterpartyTypeEl = document.getElementById("simple-counterparty-type");
      const primaryFlowTypeEl = document.getElementById("simple-primary-flow-type");
      const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
      const settlementStateEl = document.getElementById("simple-settlement-state");
      if (partyEl) partyEl.value = mapped.partyType;
      if (natureEl) {
        const availableNatureValues = new Set(getAvailableSimpleNatureOptions().map((option) => option.value));
        natureEl.value = availableNatureValues.has(mapped.transactionNature) ? mapped.transactionNature : "";
      }
      if (counterpartyTypeEl) counterpartyTypeEl.value = normalizeLegacyCounterpartyType(mapped.partyType);
      if (primaryFlowTypeEl) primaryFlowTypeEl.value = normalizeLegacyPrimaryFlowType(mapped.transactionNature);
      if (consumptionOwnershipEl && mapped.transactionNature === "transfer" && !consumptionOwnershipEl.value) {
        consumptionOwnershipEl.value = "not_consumption";
      }
      if (settlementStateEl && mapped.transactionNature === "transfer" && !settlementStateEl.value) {
        settlementStateEl.value = "none";
      }
    } else if (targetId === "simple-party-type") {
      classificationState.simplePartyManual = true;
      const natureEl = document.getElementById("simple-transaction-nature");
      const counterpartyTypeEl = document.getElementById("simple-counterparty-type");
      if (natureEl) {
        const inferredNature = inferSimpleNatureFromParty(nextValue);
        const availableNatureValues = new Set(getAvailableSimpleNatureOptions().map((option) => option.value));
        natureEl.value = availableNatureValues.has(inferredNature) ? inferredNature : "";
      }
      if (counterpartyTypeEl) counterpartyTypeEl.value = normalizeLegacyCounterpartyType(nextValue);
    } else if (targetId === "simple-transaction-nature") {
      classificationState.simpleNatureManual = true;
      const primaryFlowTypeEl = document.getElementById("simple-primary-flow-type");
      const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
      const settlementStateEl = document.getElementById("simple-settlement-state");
      if (primaryFlowTypeEl) primaryFlowTypeEl.value = normalizeLegacyPrimaryFlowType(nextValue);
      if (consumptionOwnershipEl && nextValue === "transfer" && !consumptionOwnershipEl.value) {
        consumptionOwnershipEl.value = "not_consumption";
      }
      if (settlementStateEl && nextValue === "transfer" && !settlementStateEl.value) {
        settlementStateEl.value = "none";
      }
    } else if (targetId === "simple-counterparty-type") {
      const partyEl = document.getElementById("simple-party-type");
      if (partyEl) partyEl.value = mapCounterpartyTypeToLegacyParty(nextValue);
    } else if (targetId === "simple-primary-flow-type") {
      const natureEl = document.getElementById("simple-transaction-nature");
      const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
      const settlementStateEl = document.getElementById("simple-settlement-state");
      if (natureEl) {
        const mappedNature = mapPrimaryFlowTypeToLegacyNature(nextValue);
        const availableNatureValues = new Set(getAvailableSimpleNatureOptions().map((option) => option.value));
        natureEl.value = availableNatureValues.has(mappedNature) ? mappedNature : "";
      }
      if (consumptionOwnershipEl && nextValue === "transfer" && !consumptionOwnershipEl.value) {
        consumptionOwnershipEl.value = "not_consumption";
      }
      if (settlementStateEl && nextValue === "transfer" && !settlementStateEl.value) {
        settlementStateEl.value = "none";
      }
    }
    renderSimpleChoiceGroups();
    if (targetId !== "simple-review-status") {
      syncSimpleReviewStatus();
    }
  });

  ["simple-bucket", "simple-transaction-nature", "simple-party-type", "simple-counterparty-type", "simple-primary-flow-type", "simple-consumption-ownership", "simple-settlement-state"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "simple-bucket") {
        classificationState.simpleNatureManual = true;
        classificationState.simplePartyManual = true;
        const mapped = mapSimpleBucketToFields(document.getElementById(id)?.value || "");
        const natureEl = document.getElementById("simple-transaction-nature");
        const partyEl = document.getElementById("simple-party-type");
        const counterpartyTypeEl = document.getElementById("simple-counterparty-type");
        const primaryFlowTypeEl = document.getElementById("simple-primary-flow-type");
        const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
        const settlementStateEl = document.getElementById("simple-settlement-state");
        if (natureEl) {
          const availableNatureValues = new Set(getAvailableSimpleNatureOptions().map((option) => option.value));
          natureEl.value = availableNatureValues.has(mapped.transactionNature) ? mapped.transactionNature : "";
        }
        if (partyEl) partyEl.value = mapped.partyType;
        if (counterpartyTypeEl) counterpartyTypeEl.value = normalizeLegacyCounterpartyType(mapped.partyType);
        if (primaryFlowTypeEl) primaryFlowTypeEl.value = normalizeLegacyPrimaryFlowType(mapped.transactionNature);
        if (consumptionOwnershipEl && mapped.transactionNature === "transfer" && !consumptionOwnershipEl.value) {
          consumptionOwnershipEl.value = "not_consumption";
        }
        if (settlementStateEl && mapped.transactionNature === "transfer" && !settlementStateEl.value) {
          settlementStateEl.value = "none";
        }
      }
      if (id === "simple-transaction-nature") {
        classificationState.simpleNatureManual = true;
        const primaryFlowTypeEl = document.getElementById("simple-primary-flow-type");
        const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
        const settlementStateEl = document.getElementById("simple-settlement-state");
        if (primaryFlowTypeEl) primaryFlowTypeEl.value = normalizeLegacyPrimaryFlowType(document.getElementById(id)?.value || "");
        if (consumptionOwnershipEl && document.getElementById(id)?.value === "transfer" && !consumptionOwnershipEl.value) {
          consumptionOwnershipEl.value = "not_consumption";
        }
        if (settlementStateEl && document.getElementById(id)?.value === "transfer" && !settlementStateEl.value) {
          settlementStateEl.value = "none";
        }
      }
      if (id === "simple-party-type") {
        classificationState.simplePartyManual = true;
        const counterpartyTypeEl = document.getElementById("simple-counterparty-type");
        if (counterpartyTypeEl) counterpartyTypeEl.value = normalizeLegacyCounterpartyType(document.getElementById(id)?.value || "");
      }
      if (id === "simple-counterparty-type") {
        const partyEl = document.getElementById("simple-party-type");
        if (partyEl) partyEl.value = mapCounterpartyTypeToLegacyParty(document.getElementById(id)?.value || "");
      }
      if (id === "simple-primary-flow-type") {
        const natureEl = document.getElementById("simple-transaction-nature");
        const selectedFlowType = document.getElementById(id)?.value || "";
        const consumptionOwnershipEl = document.getElementById("simple-consumption-ownership");
        const settlementStateEl = document.getElementById("simple-settlement-state");
        if (natureEl) {
          const mappedNature = mapPrimaryFlowTypeToLegacyNature(selectedFlowType);
          const availableNatureValues = new Set(getAvailableSimpleNatureOptions().map((option) => option.value));
          natureEl.value = availableNatureValues.has(mappedNature) ? mappedNature : "";
        }
        if (consumptionOwnershipEl && selectedFlowType === "transfer" && !consumptionOwnershipEl.value) {
          consumptionOwnershipEl.value = "not_consumption";
        }
        if (settlementStateEl && selectedFlowType === "transfer" && !settlementStateEl.value) {
          settlementStateEl.value = "none";
        }
      }
      renderSimpleChoiceGroups();
      syncSimpleReviewStatus();
    });
  });

  document.getElementById("add-split-row")?.addEventListener("click", () => {
    classificationState.splitRows.push(createSplitRow());
    renderSplitRows();
  });

  document.getElementById("split-rows")?.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    const rowIndex = Number(event.target.dataset.rowIndex);
    if (!field || Number.isNaN(rowIndex)) return;
    if (field === "amount") {
      classificationState.splitRows[rowIndex][field] = Number(event.target.value || 0);
    } else {
      classificationState.splitRows[rowIndex][field] = event.target.value;
    }
    updateSummary();
    renderRecoveryControls();
  });

  document.getElementById("split-rows")?.addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    const rowIndex = Number(event.target.dataset.rowIndex);
    if (!field || Number.isNaN(rowIndex)) return;
    classificationState.splitRows[rowIndex][field] = event.target.value;
    if (field === "category_id") {
      classificationState.splitRows[rowIndex].subcategory_id = "";
      renderSplitRows();
      return;
    }
    if (field === "line_kind") {
      if (String(event.target.value) === "Refund") {
        classificationState.splitRows[rowIndex].owner_type = "Other";
      }
      renderSplitRows();
      return;
    }
    updateSummary();
    renderRecoveryControls();
  });

  document.getElementById("split-rows")?.addEventListener("change", (event) => {
    const level = Number(event.target.dataset.rowSubLevel);
    const rowIndex = Number(event.target.dataset.rowIndex);
    if (Number.isNaN(level) || Number.isNaN(rowIndex)) return;
    const selectedValues = [...document.querySelectorAll(`[data-row-index="${rowIndex}"][data-row-sub-level]`)]
      .slice(0, level + 1)
      .map((select) => select.value)
      .filter(Boolean);
    classificationState.splitRows[rowIndex].subcategory_id = selectedValues[selectedValues.length - 1] || "";
    renderSplitRows();
  });

  document.getElementById("split-rows")?.addEventListener("click", (event) => {
    const removeIndex = event.target.closest("[data-remove-row]")?.dataset.removeRow;
    if (removeIndex === undefined) return;
    classificationState.splitRows.splice(Number(removeIndex), 1);
    renderSplitRows();
  });

  document.getElementById("person-self-amount")?.addEventListener("input", (event) => {
    classificationState.selfShare.amount = Number(event.target.value || 0);
    renderSplitRows();
  });

  document.getElementById("person-self-category")?.addEventListener("change", (event) => {
    classificationState.selfShare.category_id = event.target.value;
    classificationState.selfShare.subcategory_id = "";
    renderPersonSelfSection();
  });

  document.getElementById("person-self-subcategory-chain")?.addEventListener("change", (event) => {
    const level = Number(event.target.dataset.selfSubLevel);
    if (Number.isNaN(level)) return;
    const selectedValues = [...document.querySelectorAll("[data-self-sub-level]")]
      .slice(0, level + 1)
      .map((select) => select.value)
      .filter(Boolean);
    classificationState.selfShare.subcategory_id = selectedValues[selectedValues.length - 1] || "";
    renderPersonSelfSection();
  });

  // Save = save & return to Reports (with a cross-page Undo toast); Save & next
  // saves and advances to the next review item.
  document.getElementById("save-simple-btn")?.addEventListener("click", () => saveSimple());
  document.getElementById("save-split-btn")?.addEventListener("click", saveSplit);
  const saveNextBtn = document.getElementById("save-simple-next-btn");
  if (saveNextBtn) {
    saveNextBtn.classList.remove("hidden");
    saveNextBtn.classList.add("flex");
    saveNextBtn.addEventListener("click", saveSimpleAndNext);
  }

  // Searchable category picker (#1)
  const catSearch = document.getElementById("simple-category-search");
  if (catSearch) {
    catSearch.addEventListener("input", () => renderCategorySearchResults(catSearch.value));
    catSearch.addEventListener("focus", () => renderCategorySearchResults(catSearch.value));
    catSearch.addEventListener("keydown", (e) => {
      const box = document.getElementById("simple-category-search-results");
      if (e.key === "Enter") {
        e.preventDefault();
        applyCategorySearchPick(box?._matches?.[0]);
      } else if (e.key === "Escape") {
        box?.classList.add("hidden");
        catSearch.blur();
      }
    });
  }
  document.getElementById("simple-category-search-results")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat-pick]");
    if (!btn) return;
    const box = document.getElementById("simple-category-search-results");
    applyCategorySearchPick(box?._matches?.[Number(btn.dataset.catPick)]);
  });
  document.addEventListener("click", (e) => {
    const box = document.getElementById("simple-category-search-results");
    if (!box || box.classList.contains("hidden")) return;
    if (!e.target.closest("#simple-category-search-results") && e.target.id !== "simple-category-search") {
      box.classList.add("hidden");
    }
  });

  // Dirty tracking (#5) + hide the guess once the user picks a category (#3)
  ["simple-editor", "split-editor"].forEach((id) => {
    const editor = document.getElementById(id);
    if (!editor) return;
    editor.addEventListener("input", markClassifyDirty);
    editor.addEventListener("change", (e) => {
      markClassifyDirty();
      if (e.target.closest("#simple-spend-category-card")) {
        document.getElementById("simple-suggestion")?.classList.add("hidden");
      }
    });
  });

  // Page keyboard shortcuts (#7): 1/2/3 modes, "/" search, Enter = Save & next.
  // (Esc, "?", "[" and g-nav are handled globally in app-init.js.)
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "1")      { e.preventDefault(); kbSetMode("simple"); }
    else if (e.key === "2") { e.preventDefault(); kbSetMode("item"); }
    else if (e.key === "3") { e.preventDefault(); kbSetMode("person"); }
    else if (e.key === "/") { e.preventDefault(); document.getElementById("simple-category-search")?.focus(); }
    else if (e.key === "Enter") {
      const btn = document.getElementById("save-simple-next-btn");
      const simplePanel = document.getElementById("simple-mode-panel");
      if (btn && !btn.classList.contains("hidden") && simplePanel && !simplePanel.classList.contains("hidden")) {
        e.preventDefault();
        btn.click();
      }
    }
  });
  document.getElementById("link-recovery-btn")?.addEventListener("click", linkRecoveryTransaction);
  document.getElementById("recovery-line-item")?.addEventListener("change", () => {
    const candidateSelect = document.getElementById("recovery-candidate");
    if (candidateSelect) candidateSelect.dataset.selectedValue = "";
    refreshRecoveryCandidateOptions();
  });
  document.getElementById("recovery-candidate")?.addEventListener("change", (event) => {
    event.target.dataset.selectedValue = event.target.value || "";
    const candidate = classificationState.recoveryCandidates.find((item) => String(item.id) === String(event.target.value));
    const target = parseRecoveryTargetValue(document.getElementById("recovery-line-item")?.value || "");
    const remainingForRow =
      target.rowIndex !== null && target.rowIndex !== undefined
        ? getRecoveryTotalsForRow(target.rowIndex).remaining
        : normalizeAmount(target.amount || 0);
    if (candidate) {
      document.getElementById("recovery-amount").value = normalizeAmount(
        Math.min(Number(candidate.amount || 0), Number(remainingForRow || 0))
      ).toFixed(2);
    }
    const linkBtn = document.getElementById("link-recovery-btn");
    if (linkBtn) {
      syncRecoveryLinkButtonState();
    }
  });
  document.getElementById("recovery-amount")?.addEventListener("input", () => {
    syncRecoveryLinkButtonState();
  });
  document.getElementById("linked-recoveries")?.addEventListener("click", (event) => {
    const recoveryId = event.target.closest("[data-remove-recovery]")?.dataset.removeRecovery;
    if (!recoveryId) return;
    removeRecoveryTransaction(recoveryId);
  });

  // Search picker for the person-mode "My Share" category (#5 for by-person)
  const personSearch = document.getElementById("person-self-category-search");
  if (personSearch) {
    personSearch.addEventListener("input", () => _renderPersonSelfCategoryResults(personSearch.value));
    personSearch.addEventListener("focus", () => _renderPersonSelfCategoryResults(personSearch.value));
    personSearch.addEventListener("keydown", (e) => {
      const box = document.getElementById("person-self-category-search-results");
      if (e.key === "Enter") { e.preventDefault(); _applyPersonSelfCategoryPick(box?._matches?.[0]); }
      else if (e.key === "Escape") { box?.classList.add("hidden"); personSearch.blur(); }
    });
  }
  document.getElementById("person-self-category-search-results")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat-pick]");
    if (!btn) return;
    const box = document.getElementById("person-self-category-search-results");
    _applyPersonSelfCategoryPick(box?._matches?.[Number(btn.dataset.catPick)]);
  });

  // Toggle the details drawer on an item row (progressive disclosure)
  document.getElementById("split-rows")?.addEventListener("click", (event) => {
    const t = event.target.closest("[data-toggle-row-details]");
    if (!t) return;
    const idx = Number(t.dataset.toggleRowDetails);
    if (Number.isNaN(idx)) return;
    if (classificationState.expandedSplitRows.has(idx)) classificationState.expandedSplitRows.delete(idx);
    else classificationState.expandedSplitRows.add(idx);
    const details = document.querySelector(`[data-row-details="${idx}"]`);
    if (details) details.classList.toggle("hidden");
    t.querySelector(".material-symbols-outlined")?.classList.toggle("rotate-180");
  });

  // Per-row category search (#5)
  document.getElementById("split-rows")?.addEventListener("input", (event) => {
    const inp = event.target.closest("[data-row-cat-search]");
    if (!inp) return;
    renderRowCategoryResults(Number(inp.dataset.rowCatSearch), inp.value);
  });
  document.getElementById("split-rows")?.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-row-cat-pick]");
    if (!pick) return;
    const box = pick.closest("[data-row-cat-results]");
    if (!box) return;
    applyRowCategoryPick(Number(box.dataset.rowCatResults), box._matches?.[Number(pick.dataset.rowCatPick)]);
  });
  // Close per-row + person-self category results on outside click
  document.addEventListener("click", (event) => {
    const insideRow = event.target.closest("[data-row-cat-results]") || event.target.closest("[data-row-cat-search]");
    const insidePerson = event.target.closest("#person-self-category-search-results") || event.target.id === "person-self-category-search";
    if (!insideRow) {
      document.querySelectorAll("[data-row-cat-results]:not(.hidden)").forEach((b) => b.classList.add("hidden"));
    }
    if (!insidePerson) {
      document.getElementById("person-self-category-search-results")?.classList.add("hidden");
    }
  });

  document.getElementById("back-to-reports")?.addEventListener("click", (event) => {
    const referrer = document.referrer || "";
    if (referrer.includes("/reports/")) {
      event.preventDefault();
      returnToReports();
    }
  });
});
