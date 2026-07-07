// balances.js v2
let _allBalances = [];
let _detailPerson = null;

function formatINR(v) {
  const n = Math.abs(parseFloat(v) || 0);
  if (n >= 1e5) return "₹" + (n / 1e5).toFixed(1) + "L";
  if (n >= 1e3) return "₹" + (n / 1e3).toFixed(1) + "K";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fullINR(v) {
  return "₹" + Math.abs(parseFloat(v)||0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}
function escH(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;");
}

function skeletonCard() {
  return `<div class="rounded-2xl border border-slate-100 bg-white p-5 space-y-3">
    <div class="flex items-center gap-3">
      <div class="skeleton w-10 h-10 rounded-full flex-shrink-0"></div>
      <div class="flex-1 space-y-2">
        <div class="skeleton h-3 w-28 rounded"></div>
        <div class="skeleton h-2 w-20 rounded"></div>
      </div>
      <div class="skeleton h-6 w-16 rounded"></div>
    </div>
    <div class="skeleton h-1.5 w-full rounded-full"></div>
  </div>`;
}

async function loadBalances() {
  const grid = document.getElementById("balances-grid");
  if (grid) grid.innerHTML = [1,2,3,4,5,6].map(skeletonCard).join("");

  const resp = await fetch("/reports/person-balances");
  const result = await resp.json();
  _allBalances = result.data || [];
  renderBalances(_allBalances);
}

function renderBalances(data) {
  const grid = document.getElementById("balances-grid");
  if (!grid) return;

  const filtered = data.filter(r => {
    const q = (document.getElementById("bal-search")?.value || "").toLowerCase();
    if (q && !r.person.toLowerCase().includes(q)) return false;
    const view = document.getElementById("bal-filter")?.value || "all";
    if (view === "owe_me" && r.net_balance <= 0) return false;
    if (view === "i_owe" && r.net_balance >= 0) return false;
    return true;
  });

  // Summary KPI strip
  const totalOwedToMe = filtered.filter(r => r.net_balance > 0).reduce((s,r) => s + r.net_balance, 0);
  const totalIOwe     = filtered.filter(r => r.net_balance < 0).reduce((s,r) => s + Math.abs(r.net_balance), 0);
  const summaryEl = document.getElementById("balances-summary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 flex items-center gap-3 anim-fade-up shadow-sm">
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100">
          <span class="material-symbols-outlined text-[20px] text-emerald-600">trending_up</span>
        </div>
        <div>
          <p class="text-[10px] font-black uppercase tracking-wider text-emerald-500">They Owe Me</p>
          <p class="text-xl font-black text-emerald-700">${formatINR(totalOwedToMe)}</p>
        </div>
      </div>
      <div class="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white p-4 flex items-center gap-3 anim-fade-up shadow-sm" style="animation-delay:60ms">
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-100">
          <span class="material-symbols-outlined text-[20px] text-rose-500">trending_down</span>
        </div>
        <div>
          <p class="text-[10px] font-black uppercase tracking-wider text-rose-400">I Owe Them</p>
          <p class="text-xl font-black text-rose-600">${formatINR(totalIOwe)}</p>
        </div>
      </div>`;
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center py-16 text-slate-400 anim-fade-up">
        <span class="material-symbols-outlined text-5xl mb-2 text-slate-200">balance</span>
        <p class="text-sm">No balances found.</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map((r, i) => {
    const owesMe  = r.net_balance > 0;
    const settled = Math.abs(r.net_balance) < 0.01;
    const color   = settled ? "#94a3b8" : owesMe ? "#16a34a" : "#dc2626";
    const bgBorder = settled
      ? "border-slate-200"
      : owesMe ? "border-emerald-200 hover:border-emerald-300"
               : "border-red-200 hover:border-red-300";
    const label   = settled ? "Settled" : owesMe ? "Owes you" : "You owe";
    const pct     = r.total_owed > 0 ? Math.min((r.total_recovered / r.total_owed) * 100, 100) : 100;
    const initials = r.person.replace(/\W/g,'').slice(0,2).toUpperCase() || "??";
    const delay   = Math.min(i * 55, 300);

    return `
    <div class="rounded-2xl border ${bgBorder} bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer p-5 anim-fade-up"
         style="animation-delay:${delay}ms" data-person="${escH(r.person)}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm"
               style="background:${color}">${initials}</div>
          <div>
            <p class="text-sm font-bold text-slate-800 leading-tight">${escH(r.person)}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${r.txn_count} split${r.txn_count===1?"":"s"} · ${fmtDate(r.last_date) || "—"}</p>
          </div>
        </div>
        <div class="text-right">
          <p class="text-[10px] font-bold uppercase tracking-wider" style="color:${color}">${label}</p>
          <p class="text-xl font-black leading-tight" style="color:${color}">${formatINR(Math.abs(r.net_balance))}</p>
        </div>
      </div>
      <div class="mt-3">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div class="h-full rounded-full transition-all duration-500" style="width:${pct.toFixed(1)}%;background:${color};transition-delay:${delay+200}ms"></div>
        </div>
        <div class="mt-1.5 flex justify-between text-[10px] text-slate-400">
          <span>Total: ${formatINR(r.total_owed)}</span>
          <span class="font-medium" style="color:${color}">Paid: ${formatINR(r.total_recovered)}</span>
        </div>
      </div>
    </div>`;
  }).join("");
}

async function openPersonDetail(person) {
  _detailPerson = person;
  const panel = document.getElementById("detail-panel");
  const title = document.getElementById("detail-title");
  const list  = document.getElementById("detail-list");
  if (!panel || !list) return;

  if (title) title.textContent = person;
  list.innerHTML = [1,2,3].map(() =>
    `<div class="rounded-xl border border-slate-100 p-3 mb-2 space-y-2">
       <div class="flex gap-3"><div class="skeleton h-3 flex-1 rounded"></div><div class="skeleton h-3 w-16 rounded"></div></div>
       <div class="skeleton h-2 w-24 rounded"></div>
     </div>`).join("");

  // Animate panel in: force re-trigger by removing/re-adding animation class
  panel.classList.remove("hidden");
  panel.style.animation = "none";
  void panel.offsetWidth; // reflow
  panel.style.animation = "";

  const resp = await fetch(`/reports/person-balance/${encodeURIComponent(person)}`);
  const result = await resp.json();
  const rows = result.data || [];

  if (!rows.length) {
    list.innerHTML = `
      <div class="flex flex-col items-center py-12 text-slate-400">
        <span class="material-symbols-outlined text-4xl text-slate-200 mb-2">receipt_long</span>
        <p class="text-xs">No details found.</p>
      </div>`;
    return;
  }

  list.innerHTML = rows.map((r, i) => {
    const outstanding = parseFloat(r.outstanding || 0);
    const settled = outstanding < 0.01;
    const delay = Math.min(i * 40, 200);
    return `
    <div class="rounded-xl border ${settled ? "border-slate-100 bg-slate-50/60" : "border-amber-100 bg-amber-50"} p-3 mb-2 anim-fade-up"
         style="animation-delay:${delay}ms">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-bold text-slate-700 truncate">${escH(r.merchant)}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">${fmtDate(r.transaction_date)} · ${escH(r.item_name || "split")}</p>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-black ${settled ? "text-slate-300 line-through" : "text-amber-700"}">${fullINR(r.outstanding)}</p>
          <p class="text-[10px] text-slate-400">of ${fullINR(r.owed_amount)}</p>
        </div>
      </div>
      ${r.recovered_amount > 0
        ? `<p class="text-[10px] text-emerald-600 mt-1.5 flex items-center gap-1">
             <span class="material-symbols-outlined text-[11px]">check_circle</span>
             Paid back: ${fullINR(r.recovered_amount)}</p>`
        : ""}
    </div>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  loadBalances();

  document.getElementById("bal-search")?.addEventListener("input",  () => renderBalances(_allBalances));
  document.getElementById("bal-filter")?.addEventListener("change", () => renderBalances(_allBalances));
  document.getElementById("bal-refresh")?.addEventListener("click", loadBalances);
  document.getElementById("detail-close")?.addEventListener("click", () => {
    document.getElementById("detail-panel")?.classList.add("hidden");
  });

  document.getElementById("balances-grid")?.addEventListener("click", e => {
    const card = e.target.closest("[data-person]");
    if (card) openPersonDetail(card.dataset.person);
  });
});
