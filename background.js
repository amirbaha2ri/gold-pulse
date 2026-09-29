const ALARM_NAME = "gold-pulse-price-refresh";
const LEGACY_ALARM_NAME = "milli-price-refresh";
const PRICE_URL = "https://www.tgju.org/profile/geram18";
const NORMAL_BADGE_COLOR = "#17324d";
const ALERT_BADGE_COLOR = "#D32F2F";

const REFRESH_OPTIONS = {
  "off": null,
  "30": 0.5,
  "60": 1,
  "300": 5,
  "600": 10,
  "1800": 30
};

function normalizePrice(text) {
  const normalized = text
    .replace(/[\u06F0-\u06F9]/g, digit =>
      String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, digit =>
      String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\s,٬]/g, "");

  if (!/^\d+$/.test(normalized)) return null;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function htmlToText(html) {
  return html
    // The page may contain prices inside application data/scripts. Ignore those
    // and only inspect content that is actually rendered in the document body.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|rlm|lrm|zwnj);/gi, " ")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

async function fetchPrice() {
  const response = await fetch(PRICE_URL, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const priceElement = html.match(
    /<span\b(?=[^>]*\bdata-col\s*=\s*["']info\.last_trade\.PDrCotVal["'])[^>]*>([\s\S]*?)<\/span>/i
  );

  if (!priceElement) {
    throw new Error("TGJU price element not found.");
  }

  const price = normalizePrice(htmlToText(priceElement[1]));
  if (price === null) {
    throw new Error("TGJU price value is invalid.");
  }

  return price;
}

function formatPrice(price) {
  return new Intl.NumberFormat("en-US").format(price);
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function clearNotification() {
  const { notificationId } = await chrome.storage.local.get("notificationId");
  if (notificationId) {
    try {
      await chrome.notifications.clear(notificationId);
    } catch (_) {}
    await chrome.storage.local.remove("notificationId");
  }
}

function badgeText(price) {
  const leadingDigits = String(Math.trunc(price)).slice(0, 4);

  // Show the first four toman digits without rounding. For example,
  // 23,147,000 toman becomes "23,14" on the badge.
  return leadingDigits.length > 2
    ? `${leadingDigits.slice(0, 2)},${leadingDigits.slice(2)}`
    : leadingDigits;
}

async function updateBadge(price, state, settings) {
  const alertType = settings.alertType || "badge";
  const alertUsesBadge = alertType === "badge" || alertType === "both";
  const isOutsideRange = state !== "normal";
  const shouldShow = Boolean(settings.showBadge) ||
    (isOutsideRange && alertUsesBadge);

  await setBadge(
    shouldShow ? badgeText(price) : "",
    isOutsideRange ? ALERT_BADGE_COLOR : NORMAL_BADGE_COLOR
  );
}

async function triggerAlert(price, reason, settings) {
  const type = settings.alertType || "badge";
  const shouldNotify = type === "notification" || type === "both";

  const label = reason === "min" ? "حداقل قیمت" : "حداکثر قیمت";
  const title = reason === "min"
    ? "قیمت طلا به حداقل رسید"
    : "قیمت طلا به حداکثر رسید";

  if (shouldNotify) {
    const notificationId = `gold-pulse-price-${Date.now()}`;

    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message: `${label}: ${formatPrice(price)} تومان`,
      priority: 2,
      requireInteraction: false
    });

    await chrome.storage.local.set({ notificationId });
  }
}

async function checkAlert(price, settings) {
  const min = Number(settings.minPrice);
  const max = Number(settings.maxPrice);

  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;

  let state = "normal";

  if (hasMin && price <= min) {
    state = "min";
  } else if (hasMax && price >= max) {
    state = "max";
  }

  const data = await chrome.storage.local.get("lastAlertState");
  const previousState = data.lastAlertState || "normal";

  // Keep the badge numeric. Its background is red whenever the price is
  // outside the configured range and returns to the normal color otherwise.
  await updateBadge(price, state, settings);

  // Alert only when entering a threshold state, not on every refresh.
  if (state !== "normal" && state !== previousState) {
    await triggerAlert(price, state, settings);
  }

  if (state === "normal" && previousState !== "normal") {
    await clearNotification();
  }

  await chrome.storage.local.set({ lastAlertState: state });
}

async function updatePrice() {
  try {
    const priceInRials = await fetchPrice();
    const price = Math.trunc(priceInRials / 10);
    const settings = await chrome.storage.local.get([
      "minPrice",
      "maxPrice",
      "alertType",
      "showBadge"
    ]);

    await chrome.storage.local.set({
      price,
      priceUnit: "toman",
      priceUpdatedAt: Date.now(),
      lastError: ""
    });

    await checkAlert(price, settings);
    return price;
  } catch (error) {
    console.error("TGJU price update failed:", error);
    await chrome.storage.local.set({
      lastError: error.message || "Unknown error"
    });
    return null;
  }
}

async function configureAlarm() {
  const { refreshInterval = "off" } =
    await chrome.storage.local.get("refreshInterval");

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear(LEGACY_ALARM_NAME);

  const minutes = REFRESH_OPTIONS[refreshInterval];
  if (minutes) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: minutes,
      periodInMinutes: minutes
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    "refreshInterval",
    "alertType",
    "minPrice",
    "maxPrice",
    "showBadge",
    "price",
    "priceUnit"
  ]);

  // Version 2.0 incorrectly treated the old "5 seconds" value as 5 minutes.
  // Move existing users to the shortest interval supported by Chrome alarms.
  const refreshInterval = current.refreshInterval === "5"
    ? "30"
    : current.refreshInterval;
  const needsTomanMigration = current.priceUnit !== "toman";

  const migrateThreshold = value => {
    if (!needsTomanMigration || value === "" || value == null) return value;

    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? String(Math.trunc(numeric / 10))
      : value;
  };

  await chrome.storage.local.set({
    refreshInterval: Object.hasOwn(REFRESH_OPTIONS, refreshInterval)
      ? refreshInterval
      : "off",
    alertType: current.alertType || "badge",
    minPrice: migrateThreshold(current.minPrice ?? ""),
    maxPrice: migrateThreshold(current.maxPrice ?? ""),
    showBadge: Boolean(current.showBadge),
    priceUnit: "toman",
    ...(Number.isFinite(current.price) ? {
      price: needsTomanMigration
        ? Math.trunc(current.price / 10)
        : current.price
    } : {})
  });

  await configureAlarm();
  await updatePrice();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureAlarm();
  await updatePrice();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await updatePrice();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "refresh") {
      const price = await updatePrice();
      sendResponse({ ok: price !== null });
      return;
    }

    if (message.type === "configure") {
      await configureAlarm();
      await updatePrice();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "sync-badge") {
      const data = await chrome.storage.local.get([
        "price",
        "lastAlertState",
        "showBadge",
        "alertType"
      ]);

      if (Number.isFinite(data.price)) {
        await updateBadge(
          data.price,
          data.lastAlertState || "normal",
          data
        );
      } else {
        await setBadge("", NORMAL_BADGE_COLOR);
      }

      sendResponse({ ok: true });
      return;
    }
  })().catch(error => {
    console.error(error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  await chrome.notifications.clear(notificationId);
  await chrome.storage.local.remove("notificationId");
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  const { notificationId: storedId } =
    await chrome.storage.local.get("notificationId");

  if (storedId === notificationId) {
    await chrome.storage.local.remove("notificationId");
  }
});
