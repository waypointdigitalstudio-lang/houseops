const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ---- helpers ----
function getState(qty, min) {
  const q = Number(qty ?? 0);
  const m = Number(min ?? 0);
  if (q <= 0) return "OUT";
  if (q <= m) return "LOW";
  return "OK";
}

function minutesSince(ts) {
  if (!ts) return Infinity;
  const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
  return (Date.now() - ms) / 60000;
}

async function getEnabledTokens(siteId) {
  const snap = await db
    .collection("devicePushTokens")
    .where("enabled", "==", true)
    .where("siteId", "==", siteId)
    .get();

  return snap.docs.map((d) => d.data().token).filter(Boolean);
}

async function disableToken(token, reason) {
  try {
    await db
      .collection("devicePushTokens")
      .doc(token)
      .set(
        {
          enabled: false,
          disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          disableReason: reason ?? "unknown",
        },
        { merge: true }
      );
  } catch (e) {
    logger.warn("Failed to disable token", { token, error: String(e) });
  }
}

async function sendExpoPush(messages) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Expo push failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// ---- main ----
exports.notifyLowStock = onDocumentUpdated("items/{itemId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const itemId = event.params.itemId;

  if (!before || !after) return;

  const beforeQty = Number(before.currentQuantity ?? 0);
  const afterQty = Number(after.currentQuantity ?? 0);
  const minQty = Number(after.minQuantity ?? 0);

  // only care when quantity changes
  if (beforeQty === afterQty) return;

  const prevState = getState(beforeQty, minQty);
  const nextState = getState(afterQty, minQty);

  // state didn't change = no alert
  if (prevState === nextState) return;

  // ---- cooldown ----
  const COOLDOWN_MINUTES = 10;
  const lastAlertAt = after.lastAlertAt ?? null;
  const lastAlertState = after.lastAlertState ?? null;
  const mins = minutesSince(lastAlertAt);

  if (lastAlertState === nextState && mins < COOLDOWN_MINUTES) {
    await event.data.after.ref.set({ alertState: nextState }, { merge: true });
    return;
  }

  // update item alert markers
  await event.data.after.ref.set(
    {
      alertState: nextState,
      lastAlertAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAlertState: nextState,
    },
    { merge: true }
  );

  const itemSiteId = after.siteId;
  console.log("🔍 Item siteId:", itemSiteId);
  console.log("🔍 Item name:", after.name);
  console.log("🔍 State change:", prevState, "→", nextState);
  
  const tokens = await getEnabledTokens(itemSiteId);
  console.log("🔍 Found tokens:", tokens.length, "for siteId:", itemSiteId);
  
  const itemName = after.name ?? "Unnamed item";

  // ---- message text ----
  let title = "Stock update";
  let body = `${itemName} changed.`;

  if (nextState === "OUT") {
    title = "Out of stock";
    body = `${itemName} is OUT (0 left).`;
  } else if (nextState === "LOW") {
    title = "Low stock";
    body = `${itemName} is LOW (${afterQty} left, min ${minQty}).`;
  } else if (nextState === "OK") {
    title = "Restocked";
    body = `${itemName} was restocked (${afterQty} now in stock).`;
  }

  console.log("📧 Notification:", title, "-", body);

  // ---- audit log (existing system) ----
  const logRef = db.collection("alertsLog").doc();
  await logRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    itemId,
    itemName,
    prevState,
    nextState,
    qty: afterQty,
    min: minQty,
    tokenCount: tokens.length,
    status: tokens.length ? "sending" : "no_tokens",
  });

  // ---- NEW: app-facing alerts collection ----
  const type =
    nextState === "OUT" ? "out" : nextState === "LOW" ? "low" : "restock";

  await db.collection("alerts").add({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    type,
    title,
    body,
    itemId,
    itemName,
    qty: afterQty,
    min: minQty,
    siteId: itemSiteId,
    readBy: {},
  });

  if (!tokens.length) {
    console.log("⚠️ No tokens found - skipping notification send");
    return;
  }

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    priority: "high",
    channelId: "default",
    data: { itemId, state: nextState, qty: afterQty, min: minQty },
  }));

  console.log("🚀 Sending notifications to", messages.length, "devices");

  try {
    const result = await sendExpoPush(messages);
    console.log("✅ Notifications sent successfully");
    await logRef.set({ status: "sent" }, { merge: true });

    const tickets = result?.data ?? [];
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (t?.status === "error") {
        const reason = t?.details?.error || t?.message || "unknown";
        const token = messages[i]?.to;
        console.log("❌ Token error:", token, reason);
        if (reason === "DeviceNotRegistered") await disableToken(token, reason);
      }
    }
  } catch (err) {
    console.log("❌ Send failed:", err);
    await logRef.set({ status: "error", error: String(err) }, { merge: true });
    throw err;
  }
});