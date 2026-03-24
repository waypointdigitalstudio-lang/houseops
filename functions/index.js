import { onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import admin from "firebase-admin";

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

// Delete Firebase Auth account when a user document is removed
export const deleteAuthUserOnRemoval = onDocumentDeleted("users/{uid}", async (event) => {
  const uid = event.params.uid;
  try {
    await admin.auth().deleteUser(uid);
    logger.info(`Auth account deleted for user ${uid}`);
  } catch (err) {
    // Auth user may already be gone — log and move on
    logger.warn(`Could not delete Auth user ${uid}: ${err}`);
  }
});

// Shared logic for low-stock notification across collections
async function handleLowStockUpdate({ event, itemId, itemType, getQty, getMin, getName }) {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;

  const beforeQty = Number(getQty(before));
  const afterQty = Number(getQty(after));
  const minQty = Number(getMin(after));

  if (beforeQty === afterQty) return;

  const prevState = getState(beforeQty, minQty);
  const nextState = getState(afterQty, minQty);
  if (prevState === nextState) return;

  const COOLDOWN_MINUTES = 10;
  const lastAlertAt = after.lastAlertAt ?? null;
  const lastAlertState = after.lastAlertState ?? null;
  const mins = minutesSince(lastAlertAt);

  if (lastAlertState === nextState && mins < COOLDOWN_MINUTES) {
    await event.data.after.ref.set({ alertState: nextState }, { merge: true });
    return;
  }

  const alertMarkers = {
    alertState: nextState,
    lastAlertAt: admin.firestore.FieldValue.serverTimestamp(),
    lastAlertState: nextState === "OK" ? null : nextState,
  };
  if (nextState === "OK") {
    alertMarkers.userDismissedAlert = false;
    alertMarkers.userDismissedAlertQuantity = null;
  }
  await event.data.after.ref.set(alertMarkers, { merge: true });

  const itemSiteId = after.siteId;
  const itemName = getName(after);
  logger.info(`[${itemType}] ${prevState} → ${nextState}: ${itemName}`);

  const tokens = await getEnabledTokens(itemSiteId);

  let title = "Stock update";
  let body = `${itemName} changed.`;
  if (nextState === "OUT") { title = "Out of stock"; body = `${itemName} is OUT (0 left).`; }
  else if (nextState === "LOW") { title = "Low stock"; body = `${itemName} is LOW (${afterQty} left, min ${minQty}).`; }
  else if (nextState === "OK") { title = "Restocked"; body = `${itemName} was restocked (${afterQty} now in stock).`; }

  const action = nextState === "OK" ? "added" : "deducted";
  const logRef = db.collection("alertsLog").doc();
  await logRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    siteId: itemSiteId, itemId, itemName, prevState, nextState,
    qty: afterQty, min: minQty, action, itemType,
    dismissed: false, userDismissed: false,
    tokenCount: tokens.length, status: tokens.length ? "sending" : "no_tokens",
  });

  const type = nextState === "OUT" ? "out" : nextState === "LOW" ? "low" : "restock";
  await db.collection("alerts").add({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    type, title, body, itemId, itemName,
    qty: afterQty, min: minQty, siteId: itemSiteId, readBy: {},
  });

  if (!tokens.length) return;

  const messages = tokens.map((to) => ({
    to, sound: "default", title, body, priority: "high", channelId: "default",
    data: { itemId, state: nextState, qty: afterQty, min: minQty },
  }));

  try {
    const result = await sendExpoPush(messages);
    await logRef.set({ status: "sent" }, { merge: true });
    const tickets = result?.data ?? [];
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (t?.status === "error") {
        const reason = t?.details?.error || t?.message || "unknown";
        if (reason === "DeviceNotRegistered") await disableToken(messages[i]?.to, reason);
      }
    }
  } catch (err) {
    await logRef.set({ status: "error", error: String(err) }, { merge: true });
    throw err;
  }
}

export const notifyLowStock = onDocumentUpdated("items/{itemId}", async (event) => {
  await handleLowStockUpdate({
    event,
    itemId: event.params.itemId,
    itemType: "inventory",
    getQty: (d) => d.currentQuantity ?? 0,
    getMin: (d) => d.minQuantity ?? 0,
    getName: (d) => d.name ?? "Unnamed item",
  });
});

export const notifyLowToner = onDocumentUpdated("toners/{tonerId}", async (event) => {
  await handleLowStockUpdate({
    event,
    itemId: event.params.tonerId,
    itemType: "toner",
    getQty: (d) => d.quantity ?? 0,
    getMin: (d) => d.minQuantity ?? 0,
    getName: (d) => `${d.model ?? "Unknown toner"} (${d.color ?? ""})`.trim(),
  });
});

export const notifyLowRadioPart = onDocumentUpdated("radioParts/{partId}", async (event) => {
  await handleLowStockUpdate({
    event,
    itemId: event.params.partId,
    itemType: "radioPart",
    getQty: (d) => d.quantity ?? 0,
    getMin: (d) => d.minQuantity ?? 0,
    getName: (d) => d.name ?? "Unnamed part",
  });
});
