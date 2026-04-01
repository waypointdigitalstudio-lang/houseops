import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { StockStatus } from "../types/inventory";

export function getStockStatus(qty: number, min: number): StockStatus {
  if (qty <= 0) return "OUT";
  if (qty <= min) return "LOW";
  return "OK";
}

export async function logActivity(params: {
  siteId: string;
  itemName: string;
  itemId: string;
  qty: number;
  min: number;
  prevState: StockStatus;
  nextState: StockStatus;
  action: string;
  itemType: "inventory" | "toner" | "printer";
}): Promise<void> {
  const { siteId, itemName, itemId, qty, min, prevState, nextState, action, itemType } = params;
  try {
    await addDoc(collection(db, "alertsLog"), {
      siteId,
      itemName,
      itemId,
      qty,
      min,
      prevState,
      nextState,
      status: nextState,
      action,
      itemType,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Error logging activity:", err);
  }
}
