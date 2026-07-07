// tag-rules.js v2
let _rules = [];
let _tags  = [];

const FIELD_LABELS = {
  vendor_name:               "Vendor Name",
  counterparty_identifier:   "UPI / Account ID",
  counterparty_entity_name:  "Counterparty Name",
  narration:                 "Narration",
  payment_mode:              "Payment Mode",
};

function escH(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function loadAll() {
  const [rulesResp, tagsResp] = await Promise.all([
    fetch("/tag-rules/").then(r => r.json()),
    fetch("/classification/api/tags").then(r => r.json()),
  ]);
  _rules = rulesResp.data || [];
  _tags  = (tagsResp.data || []).filter(t => t.is_active);
  renderRules();
  populateTagSelect();
}

function populateTagSelect() {
  const sel = document.getElementById("rule-tag-id");
  if (!sel) return;
  sel.innerHTML = `<option value="">— select tag —</option>` +
    [..._tags].sort((a,b) => a.name.localeCompare(b.name))
      .map(t => `<option value="${escH(t.id)}">${escH(t.name)} <small>(${t.tag_type})</small></option>`)
      .join("");
}

function renderRules() {
  const tbody = document.getElementById("rules-tbody");
  const empty = document.getElementById("rules-empty");
  if (!tbody) return;

  if (!_rules.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="flex flex-col items-center py-14 text-slate-400 gap-2">
        <span class="material-symbols-outlined text-5xl text-slate-200">rule</span>
        <p class="text-sm font-semibold text-slate-500">No rules yet</p>
        <p class="text-xs text-slate-400">Add a rule above to start auto-tagging transactions on upload.</p>
      </div></td></tr>`;
    empty?.classList.add("hidden");
    return;
  }
  empty?.classList.add("hidden");

  tbody.innerHTML = _rules.map((r, i) => {
    const delay = Math.min(i * 40, 240);
    const fieldLabel = FIELD_LABELS[r.match_field] || r.match_field;
    const tagBadge   = `<span class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">${escH(r.tag_name)}</span>`;
    const tagOpts    = [..._tags].sort((a,b)=>a.name.localeCompare(b.name))
      .map(t=>`<option value="${t.id}" ${t.id===r.tag_id?"selected":""}>${escH(t.name)}</option>`).join("");
    const fieldOpts  = Object.entries(FIELD_LABELS)
      .map(([v,l])=>`<option value="${v}" ${v===r.match_field?"selected":""}>${l}</option>`).join("");
    const typeOpts   = ["CONTAINS","EXACT","REGEX"]
      .map(v=>`<option value="${v}" ${v===r.match_type?"selected":""}>${v}</option>`).join("");
    return `
    <tr class="group border-t border-slate-100 anim-fade-up ${r.is_active ? "" : "opacity-50"}" style="animation-delay:${delay}ms" data-rule-id="${r.id}">
      <td class="px-4 py-2 view-mode text-sm text-slate-700">${escH(r.name || "—")}</td>
      <td class="px-4 py-2 view-mode">
        <span class="text-xs text-slate-500">${escH(fieldLabel)}</span>
        <span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">${escH(r.match_type)}</span>
        <span class="ml-1 font-mono text-xs text-slate-800">"${escH(r.match_value)}"</span>
      </td>
      <td class="px-4 py-2 view-mode">${tagBadge}</td>
      <td class="px-4 py-2 view-mode text-xs text-slate-500">${r.priority}</td>
      <!-- edit-mode cells (hidden by default) -->
      <td colspan="4" class="px-3 py-2 edit-mode hidden">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 items-center">
          <input class="h-8 rounded border border-slate-200 px-2 text-xs" placeholder="Name" data-edit="name" value="${escH(r.name||"")}"/>
          <select class="h-8 rounded border border-slate-200 px-1 text-xs" data-edit="field">${fieldOpts}</select>
          <select class="h-8 rounded border border-slate-200 px-1 text-xs" data-edit="type">${typeOpts}</select>
          <input class="h-8 rounded border border-slate-200 px-2 text-xs font-mono" placeholder="Value" data-edit="value" value="${escH(r.match_value)}"/>
          <select class="h-8 rounded border border-slate-200 px-1 text-xs" data-edit="tag">${tagOpts}</select>
          <input type="number" class="h-8 rounded border border-slate-200 px-2 text-xs w-16" placeholder="Pri" data-edit="priority" value="${r.priority}"/>
        </div>
        <div class="flex gap-2 mt-2">
          <button data-save-rule="${r.id}" class="rounded bg-primary px-3 py-1 text-[11px] font-bold text-white hover:bg-primary/90">Save</button>
          <button data-cancel-edit class="rounded border border-slate-200 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
        </div>
      </td>
      <!-- action buttons -->
      <td class="px-4 py-2 view-mode">
        <label class="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" class="sr-only peer" ${r.is_active ? "checked" : ""}
            onchange="toggleRule(${r.id}, this.checked)" />
          <div class="h-5 w-9 rounded-full bg-slate-200 peer-checked:bg-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4"></div>
        </label>
      </td>
      <td class="px-4 py-2 view-mode">
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button data-edit-rule="${r.id}"
            class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deleteRule(${r.id})"
            class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-colors">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

async function toggleRule(id, active) {
  await fetch(`/tag-rules/${id}/toggle?active=${active}`, { method: "PATCH" });
  const r = _rules.find(x => x.id === id);
  if (r) { r.is_active = active; renderRules(); }
}

async function deleteRule(id) {
  if (!confirm("Delete this rule?")) return;
  await fetch(`/tag-rules/${id}`, { method: "DELETE" });
  _rules = _rules.filter(r => r.id !== id);
  renderRules();
}

async function applyRules() {
  const btn = document.getElementById("apply-btn");
  const status = document.getElementById("apply-status");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Applying…`; }
  if (status) status.textContent = "";
  const resp = await fetch("/tag-rules/apply", { method: "POST" });
  const result = await resp.json();
  if (btn) { btn.disabled = false; btn.innerHTML = `<span class="material-symbols-outlined text-[16px]">play_arrow</span> Apply Rules Now`; }
  if (status) {
    if (result.success) {
      const n = result.data?.tagged_transactions || 0;
      window.toast?.success(`${n} transaction${n===1?" has":"s have"} rule-based tags`);
      status.className = "text-xs text-emerald-600 font-semibold anim-slide-dn";
      status.textContent = `✓ ${n} tagged`;
      setTimeout(() => { status.textContent = ""; status.className = "text-xs text-slate-500 transition-all duration-300"; }, 5000);
    } else {
      status.className = "text-xs text-rose-500 anim-slide-dn";
      status.textContent = result.message || "Failed";
    }
  }
}

async function previewRule() {
  const field = document.getElementById("rule-match-field")?.value;
  const type  = document.getElementById("rule-match-type")?.value;
  const val   = document.getElementById("rule-match-value")?.value?.trim();
  const el    = document.getElementById("preview-count");
  if (!el || !field || !val) { if (el) el.innerHTML = ""; return; }
  el.innerHTML = `<span class="text-slate-400">…</span>`;
  const r = await fetch(`/tag-rules/preview?match_field=${encodeURIComponent(field)}&match_type=${encodeURIComponent(type)}&match_value=${encodeURIComponent(val)}`).then(x => x.json());
  const count   = r.data?.count ?? "?";
  const samples = r.data?.samples || [];
  const countStr = count === 0 ? `<span class="text-slate-400">No matches</span>`
    : `<span class="font-semibold text-primary">${count} match${count===1?"":"es"}</span>`;
  const samplesStr = samples.length
    ? `<span class="ml-1 text-slate-400">— e.g. ${samples.slice(0,3).map(s=>`<em>${escH(s)}</em>`).join(", ")}</span>`
    : "";
  el.innerHTML = countStr + samplesStr;
}

async function saveEditedRule(ruleId, tr) {
  const name     = tr.querySelector('[data-edit="name"]').value.trim();
  const field    = tr.querySelector('[data-edit="field"]').value;
  const type     = tr.querySelector('[data-edit="type"]').value;
  const val      = tr.querySelector('[data-edit="value"]').value.trim();
  const tagId    = parseInt(tr.querySelector('[data-edit="tag"]').value, 10);
  const priority = parseInt(tr.querySelector('[data-edit="priority"]').value || "0", 10);
  if (!field || !val || !tagId) { window.toast?.error("Match field, value and tag are required."); return; }
  const resp = await fetch(`/tag-rules/${ruleId}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, match_field: field, match_type: type, match_value: val, tag_id: tagId, priority }),
  });
  const result = await resp.json();
  if (!result.success) { window.toast?.error(result.error || "Save failed"); return; }
  const rule = _rules.find(r => r.id === ruleId);
  if (rule) {
    Object.assign(rule, { name, match_field: field, match_type: type, match_value: val, tag_id: tagId, priority });
    const tag = _tags.find(t => t.id === tagId);
    if (tag) rule.tag_name = tag.name;
  }
  window.toast?.success("Rule updated");
  renderRules();
}

async function addRule(e) {
  e.preventDefault();
  const name    = document.getElementById("rule-name")?.value?.trim();
  const field   = document.getElementById("rule-match-field")?.value;
  const type    = document.getElementById("rule-match-type")?.value;
  const val     = document.getElementById("rule-match-value")?.value?.trim();
  const tagId   = parseInt(document.getElementById("rule-tag-id")?.value || "0", 10);
  const priority= parseInt(document.getElementById("rule-priority")?.value || "0");
  if (!field || !val || !tagId) { window.toast?.error("Match field, value and tag are required."); return; }

  const resp = await fetch("/tag-rules/", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, match_field: field, match_type: type, match_value: val, tag_id: tagId, priority }),
  });
  const result = await resp.json();
  if (!result.success) { window.toast?.error(result.message || "Failed"); return; }

  const tag = _tags.find(t => t.id === tagId);
  _rules.unshift({ ...result.data, tag_name: tag?.name || String(tagId), tag_type: tag?.tag_type || "" });
  renderRules();

  // reset form
  document.getElementById("rule-form")?.reset();
  document.getElementById("preview-count").textContent = "";
}

document.addEventListener("DOMContentLoaded", () => {
  loadAll();
  document.getElementById("rule-form")?.addEventListener("submit", addRule);
  document.getElementById("apply-btn")?.addEventListener("click", applyRules);
  document.getElementById("rule-match-value")?.addEventListener("input", previewRule);
  document.getElementById("rule-match-field")?.addEventListener("change", previewRule);
  document.getElementById("rule-match-type")?.addEventListener("change", previewRule);

  document.getElementById("rules-tbody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-rule-id]");
    if (!tr) return;
    const ruleId = parseInt(tr.dataset.ruleId, 10);
    if (e.target.closest("[data-edit-rule]")) {
      tr.querySelectorAll(".view-mode").forEach(el => el.classList.add("hidden"));
      tr.querySelector(".edit-mode")?.classList.remove("hidden");
    } else if (e.target.closest("[data-cancel-edit]")) {
      tr.querySelectorAll(".view-mode").forEach(el => el.classList.remove("hidden"));
      tr.querySelector(".edit-mode")?.classList.add("hidden");
    } else if (e.target.closest("[data-save-rule]")) {
      saveEditedRule(ruleId, tr);
    }
  });
});
