/* toast.js — shared toast notification system */
(function () {
  function ensureContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      document.body.appendChild(c);
    }
    return c;
  }

  const ICONS = {
    success: "check_circle",
    error:   "error",
    warning: "warning",
    info:    "info",
  };

  function show(message, type = "info", duration = 3500) {
    const container = ensureContainer();
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined toast-icon">${ICONS[type] || "info"}</span>
      <span class="toast-msg">${String(message)}</span>
      <button class="toast-close" aria-label="Dismiss">&times;</button>`;

    const dismiss = () => {
      toast.classList.add("leaving");
      setTimeout(() => toast.remove(), 240);
    };
    toast.querySelector(".toast-close").addEventListener("click", dismiss);

    container.appendChild(toast);
    const t = setTimeout(dismiss, duration);
    toast.addEventListener("mouseenter", () => clearTimeout(t));
    toast.addEventListener("mouseleave", () => setTimeout(dismiss, 1200));
    return toast;
  }

  window.toast = {
    show,
    success: (msg, ms) => show(msg, "success", ms),
    error:   (msg, ms) => show(msg, "error",   ms || 5000),
    info:    (msg, ms) => show(msg, "info",     ms),
    warning: (msg, ms) => show(msg, "warning",  ms),
  };
})();
