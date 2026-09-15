const priceEl = document.getElementById("price");
const updatedEl = document.getElementById("updated");
const errorEl = document.getElementById("error");

const showBadgeEl = document.getElementById("showBadge");
const refreshIntervalEl = document.getElementById("refreshInterval");
const minPriceEl = document.getElementById("minPrice");
const maxPriceEl = document.getElementById("maxPrice");
const alertTypeEl = document.getElementById("alertType");
const settingsPanelEl = document.getElementById("settingsPanel");
const saveStatusEl = document.getElementById("saveStatus");
const saveButtonEl = document.getElementById("save");
const developerLinksToggleEl = document.getElementById("developerLinksToggle");
const developerLinksPanelEl = document.getElementById("developerLinksPanel");

let statusTimer = null;

function formatPrice(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderPrice(data) {
  if (Number.isFinite(data.price)) {
    priceEl.textContent = `${formatPrice(data.price)} تومان`;
  }

  if (data.priceUpdatedAt) {
    updatedEl.textContent =
      `آخرین دریافت: ${new Date(data.priceUpdatedAt).toLocaleTimeString("fa-IR")}`;
  }

  errorEl.textContent = data.lastError
    ? "دریافت آخرین قیمت با خطا مواجه شد."
    : "";
}

function showSaveStatus(message, type) {
  if (statusTimer) clearTimeout(statusTimer);

  saveStatusEl.textContent = message;
  saveStatusEl.className = `save-status ${type}`;

  statusTimer = setTimeout(() => {
    saveStatusEl.textContent = "";
    saveStatusEl.className = "save-status";
  }, 4000);
}

async function load() {
  const data = await chrome.storage.local.get([
    "price",
    "priceUpdatedAt",
    "priceUnit",
    "lastError",
    "showBadge",
    "refreshInterval",
    "minPrice",
    "maxPrice",
    "alertType"
  ]);

  renderPrice(data);

  showBadgeEl.checked = Boolean(data.showBadge);
  refreshIntervalEl.value = data.refreshInterval === "5"
    ? "30"
    : data.refreshInterval || "off";
  minPriceEl.value = data.minPrice ?? "";
  maxPriceEl.value = data.maxPrice ?? "";
  alertTypeEl.value = data.alertType || "badge";
}

async function refresh() {
  errorEl.textContent = "";
  priceEl.textContent = "در حال دریافت...";

  const response = await chrome.runtime.sendMessage({ type: "refresh" });

  await load();

  if (!response?.ok) {
    errorEl.textContent = "دریافت قیمت انجام نشد.";
  }
}

async function save() {
  let min = minPriceEl.value.trim();
  let max = maxPriceEl.value.trim();

  if (min && max && Number(min) > Number(max)) {
    showSaveStatus(
      "حداقل قیمت نمی‌تواند بیشتر از حداکثر قیمت باشد.",
      "failure"
    );
    return;
  }

  saveButtonEl.disabled = true;
  saveButtonEl.textContent = "در حال ذخیره...";

  try {
    await chrome.storage.local.set({
      showBadge: showBadgeEl.checked,
      refreshInterval: refreshIntervalEl.value,
      minPrice: min,
      maxPrice: max,
      alertType: alertTypeEl.value
    });

    await chrome.runtime.sendMessage({ type: "configure" });
    await load();

    settingsPanelEl.open = false;
    showSaveStatus("✓ تغییرات با موفقیت ذخیره شد.", "success");
  } catch (error) {
    console.error(error);
    settingsPanelEl.open = true;
    showSaveStatus("ذخیره تغییرات انجام نشد؛ دوباره تلاش کنید.", "failure");
  } finally {
    saveButtonEl.disabled = false;
    saveButtonEl.textContent = "ذخیره تنظیمات";
  }
}

document.getElementById("refresh").addEventListener("click", refresh);
saveButtonEl.addEventListener("click", save);

developerLinksToggleEl.addEventListener("click", () => {
  const shouldOpen = developerLinksPanelEl.hidden;
  developerLinksPanelEl.hidden = !shouldOpen;
  developerLinksToggleEl.setAttribute("aria-expanded", String(shouldOpen));
});

showBadgeEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ showBadge: showBadgeEl.checked });
  await chrome.runtime.sendMessage({ type: "sync-badge" });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const priceData = {};
  let shouldRender = false;

  for (const key of ["price", "priceUpdatedAt", "lastError"]) {
    if (changes[key]) {
      priceData[key] = changes[key].newValue;
      shouldRender = true;
    }
  }

  if (shouldRender) renderPrice(priceData);
});

(async () => {
  await load();
})();
