const RECEIPT_CATEGORIES = [
  "Grocery", "Snacks", "Dairy", "Vegetables", "Fruits",
  "Household", "Health", "Beverage", "Food", "Personal Care", "Other",
];

function openReceiptPanel() {
  const panel = document.getElementById("receipt-upload-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.classList.add("flex", "flex-col");
  const dateInput = document.getElementById("receipt-date");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split("T")[0];
  }
}

function closeReceiptPanel() {
  const panel = document.getElementById("receipt-upload-panel");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.classList.remove("flex", "flex-col");

  const imageInput = document.getElementById("receipt-image-input");
  if (imageInput) imageInput.value = "";
  const thumb = document.getElementById("receipt-thumbnail");
  if (thumb) { thumb.classList.add("hidden"); thumb.src = ""; }
  const extractBtn = document.getElementById("receipt-extract-btn");
  if (extractBtn) { extractBtn.disabled = true; extractBtn.textContent = "Extract Items"; }
  const status = document.getElementById("receipt-ocr-status");
  if (status) { status.classList.add("hidden"); status.textContent = ""; }
  const itemsSection = document.getElementById("receipt-items-section");
  if (itemsSection) itemsSection.classList.add("hidden");
  const itemsList = document.getElementById("receipt-items-list");
  if (itemsList) itemsList.innerHTML = "";
  const confirmBtn = document.getElementById("receipt-confirm-btn");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Save Transaction"; }
  const storeInput = document.getElementById("receipt-store-name");
  if (storeInput) storeInput.value = "";
  const totalDisplay = document.getElementById("receipt-total-display");
  if (totalDisplay) totalDisplay.textContent = "₹0.00";
}

function _handleImageSelect(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const thumb = document.getElementById("receipt-thumbnail");
    if (thumb) { thumb.src = e.target.result; thumb.classList.remove("hidden"); }
  };
  reader.readAsDataURL(file);
  const extractBtn = document.getElementById("receipt-extract-btn");
  if (extractBtn) extractBtn.disabled = false;
}

async function extractReceiptItems() {
  const fileInput = document.getElementById("receipt-image-input");
  if (!fileInput || !fileInput.files[0]) return;

  const btn = document.getElementById("receipt-extract-btn");
  const status = document.getElementById("receipt-ocr-status");
  if (btn) { btn.disabled = true; btn.textContent = "Extracting..."; }
  if (status) { status.textContent = "Reading bill with OCR — this may take a few seconds..."; status.classList.remove("hidden"); }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/upload/receipt", { method: "POST", body: formData });
    const data = await res.json();

    if (data.ocr_error) {
      const rawErr = String(data.ocr_error || "");
      const errMsg = rawErr.length > 180 ? rawErr.substring(0, 180) + "…" : rawErr;
      if (status) status.textContent = `OCR issue: ${errMsg} You can still add items manually below.`;
    } else {
      const count = (data.items || []).length;
      if (status) status.textContent = count > 0
        ? `Found ${count} item${count === 1 ? "" : "s"}. Review and edit below.`
        : "No items detected automatically. Add them manually below.";
    }

    const storeInput = document.getElementById("receipt-store-name");
    if (storeInput && data.store_name) storeInput.value = data.store_name;
    const dateInput = document.getElementById("receipt-date");
    if (dateInput && data.date) dateInput.value = data.date;

    _renderItemTable(data.items || []);

    // On classification page: transaction is already known — no need to search for a match
    // On reports page: try to auto-match an existing UPI/card transaction
    if (!window.TRANSACTION_ID && data.date && data.detected_total) {
      _findMatchingTransaction(data.detected_total, data.date, data.store_name || "");
    }
  } catch {
    if (status) status.textContent = "Could not connect to the server. Add items manually.";
    _renderItemTable([]);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Extract Items"; }
  }
}

async function _findMatchingTransaction(amount, date, store) {
  try {
    const params = new URLSearchParams({ amount, date, store });
    const res = await fetch(`/upload/receipt/match?${params}`);
    const data = await res.json();
    const matches = data.matches || [];
    if (matches.length === 0) return;
    _showMatchSuggestion(matches[0]);
  } catch {
    // silently ignore — user can still save as new
  }
}

function _fmtInr(v) {
  return "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _showMatchSuggestion(match) {
  const existing = document.getElementById("receipt-match-banner");
  if (existing) existing.remove();

  const vendor = _escHtml(match.vendor_name || match.narration || "Unknown");
  const amt = _fmtInr(match.amount);
  const dt = match.transaction_date || "";
  const src = _escHtml(match.payment_source_name || "");
  const mode = _escHtml(match.payment_mode || "");

  const banner = document.createElement("div");
  banner.id = "receipt-match-banner";
  banner.className = "rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 p-3";
  banner.innerHTML = `
    <p class="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Possible match found</p>
    <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">${vendor} &mdash; ${amt}</p>
    <p class="text-xs text-slate-500 dark:text-slate-400">${dt} &bull; ${src} ${mode}</p>
    <div class="mt-2 flex gap-2">
      <button onclick="_linkToExistingTransaction('${_escHtml(match.id)}')"
        class="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors">
        Yes, link to this payment
      </button>
      <button onclick="document.getElementById('receipt-match-banner').remove()"
        class="rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
        No, create new
      </button>
    </div>
  `;

  const section = document.getElementById("receipt-items-section");
  if (section) section.parentNode.insertBefore(banner, section);
}

async function _linkToExistingTransaction(transactionId) {
  const rows = document.querySelectorAll(".receipt-item-row");
  const items = [];
  rows.forEach(row => {
    const name = (row.querySelector("input[type=text]")?.value || "").trim();
    const amount = parseFloat(row.querySelector("input[type=number]")?.value || "0");
    const category = row.querySelector("select")?.value || "Other";
    if (name && amount > 0) items.push({ item_name: name, amount, category });
  });

  if (items.length === 0) {
    window.toast?.error("Add at least one item before linking.");
    return;
  }

  const storeName = (document.getElementById("receipt-store-name")?.value || "").trim();
  const btn = document.querySelector("#receipt-match-banner button");
  if (btn) { btn.disabled = true; btn.textContent = "Linking…"; }

  let saved = false;
  try {
    const res = await fetch("/upload/receipt/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: transactionId, items, store_name: storeName }),
    });
    const data = await res.json();
    if (data.success) {
      saved = true;
      const tagList = (data.tags_applied || []).join(", ");
      const tagMsg = tagList ? ` Tagged: ${tagList}.` : "";
      const msg = `Receipt linked: ${data.item_count} items, ${_fmtInr(data.total)}.${tagMsg}`;
      window.toast?.success(msg);
      closeReceiptPanel();
      setTimeout(() => window.location.reload(), 400);
    } else {
      window.toast?.error("Failed to link: " + (data.message || "Unknown error."));
    }
  } catch {
    window.toast?.error("Error linking receipt. Please try again.");
  } finally {
    if (!saved && btn) { btn.disabled = false; btn.textContent = "Yes, link to this payment"; }
  }
}

function _escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _categoryOptions(selected) {
  return RECEIPT_CATEGORIES.map(c =>
    `<option value="${_escHtml(c)}"${c === selected ? " selected" : ""}>${_escHtml(c)}</option>`
  ).join("");
}

function _appendItemRow(itemName, category, amount) {
  const list = document.getElementById("receipt-items-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "receipt-item-row grid grid-cols-[1fr_110px_90px_24px] gap-1 items-center";
  row.innerHTML = `
    <input type="text" value="${_escHtml(itemName || "")}" placeholder="Item name"
      class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary outline-none min-w-0" />
    <select class="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1 py-1.5 text-xs text-slate-900 dark:text-white focus:border-primary outline-none">
      ${_categoryOptions(category || "Other")}
    </select>
    <input type="number" value="${amount > 0 ? Number(amount).toFixed(2) : ""}" placeholder="0.00" min="0" step="0.01"
      class="receipt-amount-input rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-right text-slate-900 dark:text-white focus:border-primary outline-none"
      oninput="updateReceiptTotal()" />
    <button onclick="this.closest('.receipt-item-row').remove(); updateReceiptTotal();"
      class="text-slate-300 hover:text-red-500 transition-colors text-lg leading-none font-bold">&times;</button>
  `;
  list.appendChild(row);
}

function _renderItemTable(items) {
  const list = document.getElementById("receipt-items-list");
  if (list) list.innerHTML = "";

  // Auto-switch to Split-by-item mode when OCR finds 2+ items — only makes sense
  // to populate split rows from a multi-item receipt, and the row-fill code below
  // expects the split panel to be rendered.
  if (items.length >= 2) {
    const itemRadio = document.querySelector('input[name="classification_mode"][value="item"]');
    if (itemRadio && !itemRadio.checked) {
      itemRadio.checked = true;
      itemRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  if (items.length === 0) {
    _appendItemRow("", "Other", 0);
  } else {
    items.forEach(item => _appendItemRow(item.item_name, item.suggested_category || "Other", item.amount || 0));
  }

  const section = document.getElementById("receipt-items-section");
  if (section) section.classList.remove("hidden");
  const confirmBtn = document.getElementById("receipt-confirm-btn");
  if (confirmBtn) confirmBtn.disabled = false;
  updateReceiptTotal();
}

function addReceiptItemRow() {
  _appendItemRow("", "Other", 0);
  const section = document.getElementById("receipt-items-section");
  if (section) section.classList.remove("hidden");
  const confirmBtn = document.getElementById("receipt-confirm-btn");
  if (confirmBtn) confirmBtn.disabled = false;
}

function updateReceiptTotal() {
  let total = 0;
  document.querySelectorAll(".receipt-amount-input").forEach(input => {
    const v = parseFloat(input.value);
    if (!isNaN(v) && v > 0) total += v;
  });
  const display = document.getElementById("receipt-total-display");
  if (display) {
    display.textContent = "₹" + total.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

async function confirmReceipt() {
  const rows = document.querySelectorAll(".receipt-item-row");
  const items = [];
  let hasIncomplete = false;

  rows.forEach(row => {
    const nameInput = row.querySelector("input[type=text]");
    const catSelect = row.querySelector("select");
    const amtInput = row.querySelector("input[type=number]");
    const name = (nameInput?.value || "").trim();
    const amount = parseFloat(amtInput?.value || "0");
    const category = catSelect?.value || "Other";

    if (name && amount > 0) {
      items.push({ item_name: name, amount, category });
    } else if (name || amount > 0) {
      hasIncomplete = true;
    }
  });

  if (hasIncomplete) {
    window.toast?.error("Some rows have incomplete data. Each item needs a name and positive amount.");
    return;
  }
  if (items.length === 0) {
    window.toast?.error("Add at least one item before saving.");
    return;
  }

  const storeName = (document.getElementById("receipt-store-name")?.value || "").trim();
  const dateVal = document.getElementById("receipt-date")?.value || "";
  const paymentSource = document.getElementById("receipt-payment-source")?.value || "CASH";

  if (!dateVal) {
    window.toast?.error("Please enter the bill date.");
    return;
  }

  const btn = document.getElementById("receipt-confirm-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

  // On the classification page, window.TRANSACTION_ID is already set — link directly
  if (window.TRANSACTION_ID) {
    await _linkToExistingTransaction(window.TRANSACTION_ID);
    if (btn) { btn.disabled = false; btn.textContent = "Link to this Transaction"; }
    return;
  }

  let saved = false;
  try {
    const res = await fetch("/upload/receipt/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName || "Store Purchase",
        date: dateVal,
        payment_source: paymentSource,
        items,
      }),
    });
    const data = await res.json();

    if (data.success) {
      saved = true;
      const totalFmt = "₹" + Number(data.total || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
      const tagList = (data.tags_applied || []).join(", ");
      const tagMsg = tagList ? ` Tagged: ${tagList}.` : " Review in Reports to classify.";
      const msg = `Receipt saved: ${data.item_count} item${data.item_count === 1 ? "" : "s"}, ${totalFmt}.${tagMsg}`;
      window.toast?.success(msg);
      closeReceiptPanel();
      setTimeout(() => window.location.reload(), 400);
    } else {
      window.toast?.error("Failed to save receipt: " + (data.message || "Unknown error."));
    }
  } catch {
    window.toast?.error("Error saving receipt. Please try again.");
  } finally {
    if (!saved && btn) { btn.disabled = false; btn.textContent = "Save Transaction"; }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("receipt-image-input");
  const dropZone = document.getElementById("receipt-drop-zone");

  if (input) {
    input.addEventListener("change", e => {
      if (e.target.files[0]) _handleImageSelect(e.target.files[0]);
    });
  }

  if (dropZone) {
    dropZone.addEventListener("dragover", e => {
      e.preventDefault();
      dropZone.classList.add("border-primary");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("border-primary");
    });
    dropZone.addEventListener("drop", e => {
      e.preventDefault();
      dropZone.classList.remove("border-primary");
      const file = e.dataTransfer?.files[0];
      if (file && input) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
        } catch {
          // DataTransfer not supported in all browsers — image still handled below
        }
        _handleImageSelect(file);
      }
    });
  }
});

