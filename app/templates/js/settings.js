const SETTINGS_KEY = "finance_tracker_settings";

const defaultSettings = {
  defaultSource: "BOB",
  clearPdfPassword: true,
  autoRefreshDashboard: true,
  autoDoneWhenComplete: true,
  openWithoutChangesUnknown: true,
  reviewQueue: "needs_review",
  paybackWindowDays: "90",
  amountTolerance: "0",
  hideSettlementsFromTotals: true,
  rowsPerPage: "10",
};

function getSettingsForm() {
  return document.getElementById("settingsForm");
}

function setStatus(message, kind = "neutral") {
  const status = document.getElementById("settingsStatus");
  if (!status) return;
  status.textContent = message;
  status.className = kind === "success"
    ? "text-sm font-semibold text-emerald-600"
    : kind === "warn"
      ? "text-sm font-semibold text-amber-600"
      : "text-sm font-semibold text-slate-500";
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...defaultSettings, ...stored };
  } catch (error) {
    console.warn("Unable to parse settings", error);
    return { ...defaultSettings };
  }
}

function applySettingsToForm(settings) {
  const form = getSettingsForm();
  if (!form) return;

  Object.entries(settings).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = String(value);
    }
  });
}

function readSettingsFromForm() {
  const form = getSettingsForm();
  if (!form) return { ...defaultSettings };

  return Object.fromEntries(
    Object.entries(defaultSettings).map(([key, defaultValue]) => {
      const field = form.elements[key];
      if (!field) return [key, defaultValue];
      return [key, field.type === "checkbox" ? field.checked : field.value];
    })
  );
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

document.addEventListener("DOMContentLoaded", () => {
  const form = getSettingsForm();
  applySettingsToForm(loadSettings());

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettings(readSettingsFromForm());
    setStatus("Settings saved locally", "success");
  });

  document.getElementById("resetSettings")?.addEventListener("click", () => {
    saveSettings(defaultSettings);
    applySettingsToForm(defaultSettings);
    setStatus("Defaults restored", "warn");
  });
});
