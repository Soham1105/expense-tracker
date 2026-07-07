/* app-init.js — dark mode, privacy PIN, confetti, auto-lock, keyboard shortcuts */
(function () {

  /* ── Dark mode ────────────────────────────────────────────────────────── */
  const DM_KEY = "ft_dark_mode";

  function applyDarkMode(dark) {
    document.documentElement.classList.toggle("dark", dark);
    // Update every dm-icon in the document (sidebar remnant + header button)
    document.querySelectorAll(".dm-icon").forEach(el => {
      el.textContent = dark ? "light_mode" : "dark_mode";
    });
    document.querySelectorAll(".dm-label").forEach(el => {
      el.textContent = dark ? "Light mode" : "Dark mode";
    });
  }
  function toggleDarkMode() {
    const dark = !document.documentElement.classList.contains("dark");
    localStorage.setItem(DM_KEY, dark ? "1" : "0");
    applyDarkMode(dark);
  }
  window._toggleDarkMode = toggleDarkMode;
  document.documentElement.classList.add("no-transition");


  /* ── Confetti ─────────────────────────────────────────────────────────── */
  window.launchConfetti = function (count) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999";
    document.body.appendChild(canvas);
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");
    const colors = ["#607AFB","#4a60d8","#10b981","#f59e0b","#f43f5e","#06b6d4","#8b5cf6","#ec4899"];
    const N = count || 90;
    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 40,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2.5 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 2,
      spin: (Math.random() - 0.5) * 8,
      angle: Math.random() * 360,
    }));
    const MAX = 200;
    let frame = 0;
    (function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const alpha = Math.max(0, 1 - frame / MAX);
      particles.forEach(p => {
        p.y     += p.speed;
        p.x     += p.drift;
        p.angle += p.spin;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle * Math.PI / 180);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < MAX) requestAnimationFrame(draw);
      else canvas.remove();
    })();
  };


  /* ── Privacy / PIN mode ───────────────────────────────────────────────── */
  const PRIV_PIN_KEY   = "ft_privacy_pin";
  const PRIV_SESS_KEY  = "ft_priv_unlocked";
  const PRIV_LEVEL_KEY = "ft_priv_level";
  const PRIV_TIMEOUT_KEY = "ft_priv_timeout";

  function _getPin()    { return localStorage.getItem(PRIV_PIN_KEY); }
  function _isPinSet()  { return !!_getPin(); }
  function _isLocked()  { return _isPinSet() && sessionStorage.getItem(PRIV_SESS_KEY) !== "1"; }
  function _getLevel()  { return localStorage.getItem(PRIV_LEVEL_KEY) || "all"; }

  function applyPrivacyMode() {
    const locked = _isLocked();
    document.documentElement.classList.toggle("privacy-mode", locked);
    document.documentElement.dataset.privLevel = _getLevel();

    // Replace all amounts with XXXX.XX (or restore originals)
    document.querySelectorAll(".amt").forEach(span => {
      if (locked) _maskAmt(span);
      else _unmaskAmt(span);
    });

    // Sync floating pill
    const pill = document.getElementById("priv-float-btn");
    if (pill) {
      const pillIcon = pill.querySelector(".priv-icon");
      const pillLbl  = pill.querySelector(".priv-float-label");
      if (pillIcon) pillIcon.textContent = locked ? "visibility_off" : "visibility";
      if (pillLbl)  pillLbl.textContent  = locked ? "Locked" : "Hide";
      pill.classList.toggle("locked", locked);
    }
  }

  // ── Auto-lock after inactivity ────────────────────────────────────────
  let _autoLockTimer = null;
  function _resetAutoLock() {
    clearTimeout(_autoLockTimer);
    const raw  = localStorage.getItem(PRIV_TIMEOUT_KEY) || "15";
    const mins = parseInt(raw, 10);
    if (!isFinite(mins) || !_isPinSet() || _isLocked()) return;
    _autoLockTimer = setTimeout(() => {
      sessionStorage.removeItem(PRIV_SESS_KEY);
      applyPrivacyMode();
      window.toast?.info("Auto-locked after inactivity");
    }, mins * 60 * 1000);
  }
  window._resetAutoLock = _resetAutoLock;
  ["click", "keydown", "mousemove", "touchstart"].forEach(ev =>
    document.addEventListener(ev, _resetAutoLock, { passive: true })
  );

  // ── Amount auto-wrap ──────────────────────────────────────────────────
  function _isLargeAmt(textNode) {
    let el = textNode.parentElement;
    for (let i = 0; i < 5 && el && el !== document.body; i++, el = el.parentElement) {
      const cls = el.className || "";
      if (/\btext-(xl|2xl|3xl|4xl|5xl|6xl)\b/.test(cls)) return true;
      if (/\bkpi-card\b/.test(cls)) return true;
      if (el.tagName === "TBODY" || el.tagName === "TR") return false;
    }
    return false;
  }

  const _AMT_MASK     = "₹XXXX.XX";
  const _STRICT_MASK  = "●●●";
  const _strictRevealed = new WeakSet(); // per-page-load reveal state

  function _isStrictAmt(node) {
    let el = node.parentElement || node;
    for (let i = 0; i < 12 && el && el !== document.body; i++, el = el.parentElement) {
      if (el.dataset && el.dataset.prvStrict === "1") return true;
    }
    return false;
  }

  function _shouldMask(span) {
    // Strict amounts: always hidden until explicitly revealed (regardless of PIN state)
    if (span.classList.contains("amt-strict") && !_strictRevealed.has(span)) return "strict";
    if (!_isLocked()) return false;
    const lv = _getLevel();
    if (lv === "summary") return span.classList.contains("amt-summary") ? "pin" : false;
    if (lv === "detail")  return span.classList.contains("amt-detail")  ? "pin" : false;
    return "pin";
  }

  function _maskAmt(span) {
    const reason = _shouldMask(span);
    if (!reason) return;
    if (!span.hasAttribute("data-orig")) {
      span.setAttribute("data-orig", span.textContent);
      if (reason === "strict") {
        span.textContent = _STRICT_MASK;
        span.setAttribute("data-strict-mask", "1");
        span.style.cursor = "pointer";
        span.title = "Tap to reveal";
      } else {
        span.textContent = _AMT_MASK;
      }
    }
  }

  function _unmaskAmt(span) {
    const orig = span.getAttribute("data-orig");
    if (orig !== null) {
      span.textContent = orig;
      span.removeAttribute("data-orig");
      span.removeAttribute("data-strict-mask");
      span.style.cursor = "";
      span.title = "";
    }
  }

  function _wrapAmts(root) {
    const walker = document.createTreeWalker(
      root || document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.textContent.includes("₹"))                        return NodeFilter.FILTER_REJECT;
          if (n.parentElement?.closest(".amt"))                     return NodeFilter.FILTER_REJECT;
          const tag = n.parentElement?.tagName || "";
          if (["SCRIPT","STYLE","INPUT","TEXTAREA"].includes(tag))  return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const strict = _isStrictAmt(n);
      const s = document.createElement("span");
      s.className = "amt " + (_isLargeAmt(n) ? "amt-summary" : "amt-detail") + (strict ? " amt-strict" : "");
      s.textContent = n.textContent;
      n.parentNode.replaceChild(s, n);
      _maskAmt(s);
    });
  }

  const _amtObs = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1) {
        _wrapAmts(n);
        // _wrapAmts already calls _maskAmt on each new span
      } else if (n.nodeType === 3 && n.textContent.includes("₹")) {
        const parent = n.parentElement;
        if (parent && !parent.closest(".amt")) {
          const strict = _isStrictAmt(n);
          const s = document.createElement("span");
          s.className = "amt " + (_isLargeAmt(n) ? "amt-summary" : "amt-detail") + (strict ? " amt-strict" : "");
          s.textContent = n.textContent;
          if (parent.contains(n)) parent.replaceChild(s, n);
          _maskAmt(s);
        }
      }
    }));
  });

  // ── PIN modal ─────────────────────────────────────────────────────────
  let _pinMode = "verify";
  let _pinFirst = "";
  let _pinDone  = null;

  function _buildPinModal() {
    if (document.getElementById("pin-modal")) return;
    const el = document.createElement("div");
    el.id = "pin-modal";
    el.className = "pin-modal-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `
      <div class="pin-modal-card">
        <div class="pin-modal-icon" id="pin-modal-icon">🔒</div>
        <h3 class="pin-modal-title" id="pin-modal-title">Enter PIN</h3>
        <p class="pin-modal-sub" id="pin-modal-sub">Enter your 4-digit privacy PIN</p>
        <div class="pin-dots">
          <div class="pin-dot" id="pd0"></div>
          <div class="pin-dot" id="pd1"></div>
          <div class="pin-dot" id="pd2"></div>
          <div class="pin-dot" id="pd3"></div>
        </div>
        <input id="pin-input" type="password" inputmode="numeric" pattern="[0-9]*"
          maxlength="4" autocomplete="off"
          style="opacity:0;position:absolute;left:-9999px;width:1px;height:1px" />
        <button id="pin-cancel-btn">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => { if (e.target === el) _closePinModal(); });
    el.querySelector("#pin-cancel-btn").addEventListener("click", _closePinModal);
    el.querySelector("#pin-input").addEventListener("input", _onPinInput);
  }

  function _openPinModal(mode, done) {
    _buildPinModal();
    _pinMode = mode || "verify";
    _pinDone = done || null;
    if (mode !== "confirm") _pinFirst = "";
    const cfg = {
      verify:  { icon: "🔒", title: "Enter PIN",           sub: "Enter your current PIN to continue" },
      set:     { icon: "🔑", title: "Set Privacy PIN",     sub: "Choose a 4-digit PIN" },
      confirm: { icon: "🔑", title: "Confirm PIN",         sub: "Re-enter your PIN to confirm" },
    }[_pinMode] || {};
    document.getElementById("pin-modal-icon").textContent  = cfg.icon;
    document.getElementById("pin-modal-title").textContent = cfg.title;
    document.getElementById("pin-modal-sub").textContent   = cfg.sub;
    _updateDots("", false);
    const input = document.getElementById("pin-input");
    document.getElementById("pin-modal").classList.add("open");
    input.value = "";
    setTimeout(() => input.focus(), 60);
  }
  window.openPinSetup = () => _openPinModal("set");

  function _closePinModal() {
    document.getElementById("pin-modal")?.classList.remove("open");
    _pinDone = null;
  }

  function _updateDots(val, err) {
    for (let i = 0; i < 4; i++) {
      const d = document.getElementById("pd" + i);
      if (d) d.className = "pin-dot" + (i < val.length ? (err ? " error" : " filled") : "");
    }
  }

  function _onPinInput(e) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
    e.target.value = raw;
    _updateDots(raw, false);
    if (raw.length < 4) return;

    if (_pinMode === "verify") {
      if (raw === _getPin()) {
        sessionStorage.setItem(PRIV_SESS_KEY, "1");
        applyPrivacyMode();
        _resetAutoLock();
        _closePinModal();
        const cb = _pinDone;
        _pinDone = null;
        if (cb) cb();
        else window.toast?.success("Amounts visible");
      } else {
        _updateDots(raw, true);
        e.target.value = "";
        setTimeout(() => _updateDots("", false), 700);
        window.toast?.error("Wrong PIN");
      }
    } else if (_pinMode === "set") {
      _pinFirst = raw;
      e.target.value = "";
      _openPinModal("confirm", _pinDone);
    } else if (_pinMode === "confirm") {
      if (raw === _pinFirst) {
        localStorage.setItem(PRIV_PIN_KEY, raw);
        sessionStorage.removeItem(PRIV_SESS_KEY);
        applyPrivacyMode();
        _closePinModal();
        const cb = _pinDone;
        _pinDone = null;
        if (cb) cb();
        window.toast?.success("PIN set — amounts are now hidden");
      } else {
        _updateDots(raw, true);
        e.target.value = "";
        _pinFirst = "";
        setTimeout(() => _openPinModal("set", _pinDone), 700);
        window.toast?.error("PINs didn't match — try again");
      }
    }
  }

  function _handlePrivacyToggle() {
    if (!_isPinSet()) { _openPinModal("set"); return; }
    if (_isLocked()) {
      _openPinModal("verify");
    } else {
      sessionStorage.removeItem(PRIV_SESS_KEY);
      applyPrivacyMode();
      window.toast?.info("Amounts hidden");
    }
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.removePrivacyPin = function () {
    if (!_isPinSet()) return;
    // Must verify current PIN before removing
    _openPinModal("verify", () => {
      localStorage.removeItem(PRIV_PIN_KEY);
      sessionStorage.removeItem(PRIV_SESS_KEY);
      clearTimeout(_autoLockTimer);
      applyPrivacyMode();
      _refreshPinStatus();
      window.toast?.success("Privacy PIN removed — amounts always visible");
    });
  };
  window._privSetPin = function () {
    if (_isPinSet()) {
      // Must verify current PIN before changing
      _openPinModal("verify", () =>
        _openPinModal("set", () => { applyPrivacyMode(); _refreshPinStatus(); })
      );
    } else {
      _openPinModal("set", () => { applyPrivacyMode(); _refreshPinStatus(); });
    }
  };
  window._privResetPin = function () {
    if (!_isPinSet()) { _openPinModal("set", () => { applyPrivacyMode(); _refreshPinStatus(); }); return; }
    // Verify old PIN → remove → set new
    _openPinModal("verify", () => {
      localStorage.removeItem(PRIV_PIN_KEY);
      _openPinModal("set", () => { applyPrivacyMode(); _refreshPinStatus(); });
    });
  };
  window._setPrivLevel = function (level) {
    localStorage.setItem(PRIV_LEVEL_KEY, level);
    document.documentElement.dataset.privLevel = level;
    window.toast?.success("Privacy level updated");
  };
  window.isPinSet         = _isPinSet;
  window.applyPrivacyMode = applyPrivacyMode;

  // ── Settings page PIN status ──────────────────────────────────────────
  function _refreshPinStatus() {
    const statusText = document.getElementById("pin-status-text");
    if (!statusText) return;
    const statusSub  = document.getElementById("pin-status-sub");
    const statusCard = document.getElementById("pin-status-card");
    const statusIcon = document.getElementById("pin-status-icon");
    const setBtn     = document.getElementById("pin-set-btn");
    const resetBtn   = document.getElementById("pin-reset-btn");
    const removeBtn  = document.getElementById("pin-remove-btn");
    const levelSec   = document.getElementById("privacy-level-section");
    const lockSec    = document.getElementById("autolock-section");
    const timeoutSel = document.getElementById("priv-timeout-select");

    if (_isPinSet()) {
      statusText.textContent = "PIN is set — amounts are hidden until unlocked";
      statusText.className   = "text-sm font-semibold text-emerald-700";
      if (statusSub) {
        statusSub.textContent = _isLocked() ? "Currently locked" : "Currently unlocked this session";
        statusSub.classList.remove("hidden");
      }
      if (statusCard) statusCard.className = "mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 border-emerald-100 bg-emerald-50";
      if (statusIcon) { statusIcon.className = "material-symbols-outlined text-[22px] text-emerald-600"; statusIcon.textContent = "lock"; }
      if (setBtn)    setBtn.textContent = "Change PIN";
      resetBtn?.classList.remove("hidden");
      removeBtn?.classList.remove("hidden");
      levelSec?.classList.remove("hidden");
      lockSec?.classList.remove("hidden");
      if (timeoutSel) timeoutSel.value = localStorage.getItem(PRIV_TIMEOUT_KEY) || "15";
      const radio = document.querySelector(`input[name="privacyLevel"][value="${_getLevel()}"]`);
      if (radio) radio.checked = true;
    } else {
      statusText.textContent = "No PIN set — amounts are always visible";
      statusText.className   = "text-sm font-semibold text-slate-500";
      statusSub?.classList.add("hidden");
      if (statusCard) statusCard.className = "mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 border-slate-100 bg-slate-50";
      if (statusIcon) { statusIcon.className = "material-symbols-outlined text-[22px] text-slate-400"; statusIcon.textContent = "lock_open"; }
      if (setBtn)    setBtn.textContent = "Set PIN";
      resetBtn?.classList.add("hidden");
      removeBtn?.classList.add("hidden");
      levelSec?.classList.add("hidden");
      lockSec?.classList.add("hidden");
    }
  }
  window._refreshPinStatus = _refreshPinStatus;


  /* ── Keyboard shortcuts: central catalog (single source of truth) ─────────
     Documented in the "?" overlay (global + current page) and on the Settings
     page (full reference). The actual key handlers live in each page's own JS
     (the global ones below; per-page in report_shower.js /
     transaction_classification.js). This catalog documents them and powers
     conflict detection — keep keys in sync with the handlers. */
  const SHORTCUTS_CATALOG = {
    global: [
      { group: "General", items: [
        { keys: ["?"],                  desc: "Show keyboard shortcuts" },
        { keys: ["Esc"],                desc: "Close panel / modal" },
        { keys: ["["],                  desc: "Toggle sidebar" },
        { keys: ["Ctrl", "Shift", "D"], desc: "Toggle dark mode" },
      ]},
      { group: "Go to… (press G then the letter)", items: [
        { keys: ["G", "R"], desc: "Reports",   href: "/reports/" },
        { keys: ["G", "A"], desc: "Analytics", href: "/reports/analytics" },
        { keys: ["G", "M"], desc: "Merchants", href: "/merchants.html" },
        { keys: ["G", "B"], desc: "Balances",  href: "/balances.html" },
        { keys: ["G", "T"], desc: "Tag rules", href: "/tag-rules.html" },
      ]},
    ],
    pages: [
      {
        label: "Reports", paths: ["/reports/", "/reports"], prefix: false,
        items: [
          { keys: ["J"], desc: "Highlight next row" },
          { keys: ["K"], desc: "Highlight previous row" },
          { keys: ["X"], desc: "Select / deselect highlighted row" },
          { keys: ["T"], desc: "Add tag to highlighted row" },
          { keys: ["E"], desc: "Open classification for highlighted row" },
          { keys: ["C"], desc: "Confirm (mark reviewed) highlighted row" },
        ],
      },
      {
        label: "Classify transaction", paths: ["/classification/transaction/"], prefix: true,
        items: [
          { keys: ["1"],     desc: "Simple mode" },
          { keys: ["2"],     desc: "Split by item" },
          { keys: ["3"],     desc: "Split by person" },
          { keys: ["/"],     desc: "Search category" },
          { keys: ["S"],     desc: "Save" },
          { keys: ["Enter"], desc: "Save & next to review" },
        ],
      },
    ],
  };

  function _sigOf(keys)   { return keys.map(k => k.toLowerCase()).join("+"); }
  function _kbdHtml(keys) { return keys.map(k => `<kbd>${k}</kbd>`).join(" "); }

  function _pageMatches(entry, path) {
    return (entry.paths || []).some(p =>
      entry.prefix ? path.startsWith(p) : (path === p || path === p.replace(/\/+$/, "")));
  }
  function _currentPageEntry() {
    return SHORTCUTS_CATALOG.pages.find(e => _pageMatches(e, window.location.pathname)) || null;
  }

  // Build the g-chord nav map straight from the catalog so the handler and the
  // documentation can never drift apart.
  function _navMap() {
    const nav = {};
    SHORTCUTS_CATALOG.global.forEach(g => g.items.forEach(it => {
      if (it.href && it.keys.length === 2 && it.keys[0].toLowerCase() === "g") {
        nav["g" + it.keys[1].toLowerCase()] = it.href;
      }
    }));
    return nav;
  }

  // Conflicts: a page binding whose signature also exists globally (the global
  // handler would shadow it), or a duplicate key within a single scope.
  function _shortcutConflicts() {
    const out = [];
    const globalSigs = new Map();
    SHORTCUTS_CATALOG.global.forEach(g => g.items.forEach(it => {
      const sig = _sigOf(it.keys);
      if (globalSigs.has(sig)) out.push({ scope: "Global", keys: it.keys, desc: it.desc, reason: `duplicates "${globalSigs.get(sig)}"` });
      else globalSigs.set(sig, it.desc);
    }));
    SHORTCUTS_CATALOG.pages.forEach(pg => {
      const seen = new Map();
      pg.items.forEach(it => {
        const sig = _sigOf(it.keys);
        if (globalSigs.has(sig)) out.push({ scope: pg.label, keys: it.keys, desc: it.desc, reason: `shadowed by global "${globalSigs.get(sig)}"` });
        if (seen.has(sig)) out.push({ scope: pg.label, keys: it.keys, desc: it.desc, reason: `duplicates "${seen.get(sig)}" on this page` });
        else seen.set(sig, it.desc);
      });
    });
    return out;
  }

  window.Shortcuts = {
    catalog: SHORTCUTS_CATALOG,
    conflicts: _shortcutConflicts,
    currentPageEntry: _currentPageEntry,
    pageMatches: _pageMatches,
    kbdHtml: _kbdHtml,
  };

  /* ── Shortcuts modal (rendered from the catalog, page-aware) ───────────── */
  const _SC_TITLE = `font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin:14px 0 6px`;

  function _renderRows(items) {
    return items.map(it =>
      `<div class="shortcut-row"><span>${it.desc}</span><span>${_kbdHtml(it.keys)}</span></div>`).join("");
  }

  function buildShortcutsModal() {
    let el = document.getElementById("shortcuts-modal");
    if (!el) {
      el = document.createElement("div");
      el.id = "shortcuts-modal";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      document.body.appendChild(el);
      el.addEventListener("click", e => { if (e.target === el) closeShortcutsModal(); });
    }
    const pageEntry = _currentPageEntry();
    const conflicts = _shortcutConflicts();
    const pageSection = pageEntry
      ? `<p style="${_SC_TITLE}">This page · ${pageEntry.label}</p>${_renderRows(pageEntry.items)}` : "";
    const globalSections = SHORTCUTS_CATALOG.global.map(g =>
      `<p style="${_SC_TITLE}">${g.group}</p>${_renderRows(g.items)}`).join("");
    const conflictBanner = conflicts.length
      ? `<div style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:600;margin-bottom:12px">⚠ ${conflicts.length} shortcut conflict${conflicts.length === 1 ? "" : "s"} detected — see Settings → Keyboard Shortcuts.</div>`
      : "";
    el.innerHTML = `
      <div class="modal-card" style="max-height:80vh;overflow:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="font-weight:800;font-size:15px">Keyboard Shortcuts</h3>
          <button id="shortcuts-close" style="background:none;border:none;cursor:pointer;font-size:20px;opacity:0.4;line-height:1">&times;</button>
        </div>
        ${conflictBanner}
        <div id="shortcuts-list">${pageSection}${globalSections}</div>
        <div style="margin-top:14px;text-align:right">
          <a href="/settings.html#keyboard-shortcuts" style="font-size:11px;font-weight:700;color:#607AFB;text-decoration:none">View all in Settings →</a>
        </div>
      </div>`;
    el.querySelector("#shortcuts-close")?.addEventListener("click", closeShortcutsModal);
  }
  function openShortcutsModal()  { buildShortcutsModal(); document.getElementById("shortcuts-modal")?.classList.add("open"); }
  function closeShortcutsModal() { document.getElementById("shortcuts-modal")?.classList.remove("open"); }
  window.openShortcutsModal = openShortcutsModal;

  // Full reference for the Settings page (#shortcuts-reference container).
  function _renderShortcutsReference() {
    const root = document.getElementById("shortcuts-reference");
    if (!root) return;
    const conflicts = _shortcutConflicts();
    const banner = conflicts.length
      ? `<div style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600">⚠ ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}: ${conflicts.map(c => `${_kbdHtml(c.keys)} on ${c.scope} (${c.reason})`).join("; ")}</div>`
      : `<div style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;font-size:12px;font-weight:600">✓ No shortcut conflicts — global keys and per-page keys don't overlap.</div>`;
    const section = (title, items) =>
      `<div><p style="${_SC_TITLE}">${title}</p>${_renderRows(items)}</div>`;
    let html = banner;
    SHORTCUTS_CATALOG.global.forEach(g => { html += section("Global · " + g.group, g.items); });
    SHORTCUTS_CATALOG.pages.forEach(pg => { html += section(pg.label, pg.items); });
    root.innerHTML = html;
  }
  window._renderShortcutsReference = _renderShortcutsReference;

  /* ── Post-save Undo toast (survives the redirect after classify save) ───── */
  function _showPendingClassifyUndo() {
    let raw;
    try { raw = sessionStorage.getItem("ft_classify_undo"); } catch (e) { return; }
    if (!raw) return;
    try { sessionStorage.removeItem("ft_classify_undo"); } catch (e) {}
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.payload) return;
    const t = window.toast?.success(`Saved ${data.label || ""} ✓`, 6000);
    if (!t) return;
    const btn = document.createElement("button");
    btn.textContent = "Undo";
    btn.style.cssText = "margin-left:10px;font-weight:800;color:inherit;text-decoration:underline;background:none;border:none;cursor:pointer";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await fetch("/classification/api/simple", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.payload) });
        window.toast?.info("Reverted to how it was when you opened it");
        if (location.pathname.startsWith("/reports")) location.reload();
      } catch (e) { window.toast?.error("Undo failed"); }
    });
    t.querySelector(".toast-msg")?.appendChild(btn);
  }


  /* ── Sidebar collapse ────────────────────────────────────────────────────── */
  const SIDEBAR_KEY = "ft_sidebar_collapsed";

  function _applySidebarState(aside, collapsed) {
    if (!aside) return;
    aside.classList.toggle("sidebar-collapsed", collapsed);
    const btn  = document.getElementById("sidebar-edge-toggle");
    const icon = btn?.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = collapsed ? "chevron_right" : "chevron_left";
    if (btn)  btn.title        = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  function _initSidebar() {
    const aside = document.querySelector("aside");
    // Only the global navigation sidebar (which contains a <nav>) is collapsible.
    // Skip in-page asides like the classify "allocation" panel, otherwise we'd
    // inject a stray chevron collapse toggle next to unrelated content.
    if (!aside || !aside.querySelector("nav")) return;

    // Remove Transactions page from nav (page retired — access via Reports)
    aside.querySelectorAll('nav a[href="/"]').forEach(a => a.remove());

    // Add .nav-label to text spans in every nav link for CSS targeting + add title tooltips
    aside.querySelectorAll("nav a").forEach(a => {
      const spans = a.querySelectorAll(":scope > span");
      spans.forEach(s => {
        if (!s.classList.contains("material-symbols-outlined")) {
          s.classList.add("nav-label");
          if (!a.title) a.title = s.textContent.trim();
        }
      });
    });

    // Mark categories widget (only exists on some pages)
    aside.querySelector(".mt-6.rounded-2xl")?.classList.add("sidebar-categories");

    // Inject edge toggle button — zero-width flex child between aside and main content
    if (!document.getElementById("sidebar-edge-toggle")) {
      const wrap = document.createElement("div");
      wrap.className = "sidebar-edge-wrap";

      const btn = document.createElement("button");
      btn.id = "sidebar-edge-toggle";
      btn.className = "sidebar-edge-toggle";
      btn.type = "button";          // not "submit" — avoid form-submit ghosts
      btn.title = "Collapse sidebar";
      // Span uses pointer-events:none so clicks always land on the button.
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:13px;line-height:1;pointer-events:none">chevron_left</span>`;

      wrap.appendChild(btn);
      aside.insertAdjacentElement("afterend", wrap);
    }
    // Click handler is attached via document-level delegation (see DOMContentLoaded)
    // so it survives re-renders + works even if the button is replaced.

    // Inject "Categories & Tags" nav link into sidebar nav links section
    if (!document.getElementById("sidebar-tags-link")) {
      const navLinks = aside.querySelector("nav .flex.flex-col.gap-1");
      if (navLinks) {
        const isActive = window.location.pathname === "/classification/manage";
        const link = document.createElement("a");
        link.id = "sidebar-tags-link";
        link.href = "/classification/manage";
        link.title = "Categories & Tags";
        link.className = isActive
          ? "flex items-center gap-3 rounded-lg bg-primary/10 px-3 py-2.5 text-primary active-nav"
          : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900";
        link.innerHTML = `<span class="material-symbols-outlined text-[20px]">category</span><span class="nav-label text-sm font-medium">Categories &amp; Tags</span>`;
        navLinks.appendChild(link);
      }
    }

    // Apply saved state
    _applySidebarState(aside, localStorage.getItem(SIDEBAR_KEY) === "1");

    // Enable smooth width transition only after initial state settles (no load flash)
    requestAnimationFrame(() => requestAnimationFrame(() =>
      aside.classList.add("sidebar-transition")
    ));
  }


  /* ── Quick-create tag popover ─────────────────────────────────────────── */
  function _buildQuickTagPopover() {
    if (document.getElementById("quick-tag-popover")) return;
    const el = document.createElement("div");
    el.id = "quick-tag-popover";
    el.className = "quick-tag-popover hidden";
    el.innerHTML = `
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#607AFB;margin-bottom:8px">Quick Create Tag</p>
      <div style="display:flex;gap:6px">
        <input id="qt-name" type="text" placeholder="Tag name…"
          style="flex:1;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;padding:6px 10px;font-size:13px;outline:none" />
        <button id="qt-save"
          style="border-radius:8px;background:#607AFB;color:#fff;padding:6px 12px;font-size:12px;font-weight:700;border:none;cursor:pointer">Add</button>
      </div>
      <p id="qt-status" style="margin-top:4px;font-size:11px;color:#f43f5e;display:none"></p>`;
    document.body.appendChild(el);
    document.addEventListener("click", e => {
      if (!el.contains(e.target) && !e.target.closest("#sidebar-quick-tag-btn")) {
        el.classList.add("hidden");
      }
    }, true);
    document.getElementById("qt-save").addEventListener("click", _submitQuickTag);
    document.getElementById("qt-name").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); _submitQuickTag(); }
    });
  }

  async function _submitQuickTag() {
    const inp = document.getElementById("qt-name");
    const name = (inp?.value || "").trim();
    const statusEl = document.getElementById("qt-status");
    if (statusEl) statusEl.style.display = "none";
    if (!name) return;
    try {
      const r = await fetch("/classification/api/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await r.json();
      if (!result.success) throw new Error(result.message || "Failed");
      inp.value = "";
      document.getElementById("quick-tag-popover")?.classList.add("hidden");
      window.toast?.success(`Tag "${name}" created`);
      if (Array.isArray(window.availableManagedTags)) {
        window.availableManagedTags.push(name);
        window.renderManagedTagOptions?.();
      }
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message; statusEl.style.display = "block"; }
    }
  }

  function _toggleQuickTagPopover(anchorBtn) {
    _buildQuickTagPopover();
    const pop = document.getElementById("quick-tag-popover");
    if (!pop) return;
    if (pop.classList.contains("hidden")) {
      const r = anchorBtn.getBoundingClientRect();
      pop.style.top  = (r.bottom + 8) + "px";
      pop.style.right = (window.innerWidth - r.right) + "px";
      const isDark = document.documentElement.classList.contains("dark");
      if (isDark) {
        pop.style.background = "#1e293b";
        pop.style.borderColor = "#334155";
        pop.style.color = "#e2e8f0";
        const inp = document.getElementById("qt-name");
        if (inp) { inp.style.background = "#0f172a"; inp.style.borderColor = "#475569"; inp.style.color = "#f1f5f9"; }
      } else {
        pop.style.background = "";
        pop.style.borderColor = "";
        pop.style.color = "";
        const inp = document.getElementById("qt-name");
        if (inp) { inp.style.background = ""; inp.style.borderColor = ""; inp.style.color = ""; }
      }
      pop.classList.remove("hidden");
      setTimeout(() => document.getElementById("qt-name")?.focus(), 50);
    } else {
      pop.classList.add("hidden");
    }
  }


  /* ── DOMContentLoaded ─────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    applyDarkMode(document.documentElement.classList.contains("dark"));
    requestAnimationFrame(() => requestAnimationFrame(() =>
      document.documentElement.classList.remove("no-transition")
    ));

    // Hide the sidebar dark mode button (moved to header)
    const dmBtn = document.getElementById("dark-mode-toggle");
    if (dmBtn) dmBtn.style.display = "none";

    // Inject compact dark mode icon button into the top header's right action area
    const pageHeader = document.querySelector("header.flex");
    if (pageHeader && !document.getElementById("header-dm-toggle")) {
      // Find or create a dedicated right-side container
      let headerRight = pageHeader.querySelector("#header-right");
      if (!headerRight) {
        headerRight = document.createElement("div");
        headerRight.id = "header-right";
        headerRight.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0";
        pageHeader.appendChild(headerRight);
      }
      const btn = document.createElement("button");
      btn.id = "header-dm-toggle";
      btn.title = "Toggle dark mode";
      btn.className = "rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors flex-shrink-0";
      btn.innerHTML = `<span class="material-symbols-outlined text-[20px] dm-icon">dark_mode</span>`;
      btn.addEventListener("click", toggleDarkMode);
      headerRight.appendChild(btn);
      // Re-apply to set correct icon for current mode
      applyDarkMode(document.documentElement.classList.contains("dark"));
    }

    // Inject floating privacy pill button (bottom-right, covers every page)
    if (!document.getElementById("priv-float-btn")) {
      const pill = document.createElement("button");
      pill.id = "priv-float-btn";
      pill.className = "priv-float-btn";
      pill.title = "Toggle privacy mode";
      pill.innerHTML = `<span class="material-symbols-outlined priv-icon" style="font-size:16px">visibility</span><span class="priv-float-label">Hide</span>`;
      pill.addEventListener("click", _handlePrivacyToggle);
      document.body.appendChild(pill);
    }

    // Amount auto-wrap + observer
    _wrapAmts(document.body);
    _amtObs.observe(document.body, { childList: true, subtree: true });

    // Click masked amount → reveal
    document.addEventListener("click", e => {
      const span = e.target.closest(".amt[data-orig]");
      if (!span) return;
      e.stopPropagation();
      if (span.hasAttribute("data-strict-mask")) {
        // Strict amount: reveal this element only (no PIN needed — just intentional tap)
        // But if the whole app is also PIN-locked, require PIN first
        if (_isLocked()) {
          _openPinModal("verify", () => {
            _strictRevealed.add(span);
            _unmaskAmt(span);
          });
        } else {
          _strictRevealed.add(span);
          _unmaskAmt(span);
        }
      } else if (_isLocked()) {
        // Regular PIN-masked amount
        _openPinModal("verify");
      }
    });

    // Apply privacy state + start auto-lock timer
    applyPrivacyMode();
    _resetAutoLock();

    // Settings page PIN status
    _refreshPinStatus();

    // Settings page keyboard-shortcuts reference (no-op elsewhere)
    _renderShortcutsReference();

    // Show an Undo toast if we just saved a classification on the previous page
    _showPendingClassifyUndo();

    // Init sidebar collapse
    _initSidebar();

    /* ── Sidebar edge toggle — document-level delegation ─────────────────────
       Direct listener on the injected button was occasionally lost when other
       page scripts re-rendered or replaced parts of the layout. Delegation
       survives DOM mutations and always queries <aside> fresh, so the toggle
       reliably flips state regardless of when/where the button was created. */
    document.addEventListener("click", (e) => {
      const target = e.target.closest("#sidebar-edge-toggle");
      if (!target) return;
      e.preventDefault();
      const aside = document.querySelector("aside");
      if (!aside) return;
      const next = !aside.classList.contains("sidebar-collapsed");
      try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch {}
      _applySidebarState(aside, next);
    });
  });


  /* ── Global keyboard handler ──────────────────────────────────────────── */
  let _gBuffer = "";
  let _gTimer  = null;

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.getElementById("quick-tag-popover")?.classList.add("hidden");
      const pinModal = document.getElementById("pin-modal");
      if (pinModal?.classList.contains("open")) { _closePinModal(); return; }
      closeShortcutsModal();
      document.getElementById("cp-panel")?.classList.add("hidden");
      document.getElementById("txn-quick-panel")?.classList.remove("open");
      document.getElementById("detail-panel")?.classList.add("hidden");
      if (typeof closeUploadPanel  === "function") closeUploadPanel();
      if (typeof closeReceiptPanel === "function") closeReceiptPanel();
      document.querySelectorAll('.fixed.inset-0[class*="z-5"]').forEach(m => {
        if (!m.classList.contains("hidden") && m.style.display !== "none") {
          if (typeof window.closeMergeModal === "function" && m.id === "merge-modal") window.closeMergeModal();
          else m.classList.add("hidden");
        }
      });
      return;
    }

    const tag = e.target.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
    if (inInput) return;

    if (e.key === "?") { e.preventDefault(); openShortcutsModal(); return; }
    if (e.key === "[") {
      e.preventDefault();
      const aside = document.querySelector("aside");
      if (aside) {
        const next = !aside.classList.contains("sidebar-collapsed");
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
        _applySidebarState(aside, next);
      }
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key === "D") { e.preventDefault(); toggleDarkMode(); return; }

    _gBuffer += e.key.toLowerCase();
    clearTimeout(_gTimer);
    _gTimer = setTimeout(() => { _gBuffer = ""; }, 1000);
    const nav = _navMap();
    if (nav[_gBuffer]) { e.preventDefault(); window.location.href = nav[_gBuffer]; _gBuffer = ""; }
  });

})();
