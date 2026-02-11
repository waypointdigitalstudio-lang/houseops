import {
    collection,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";

export type AlertState = "OK" | "LOW" | "OUT";

export interface AlertLog {
  id: string;
  createdAt?: Timestamp | null;
  itemId: string;
  itemName: string;
  prevState: AlertState;
  nextState: AlertState;
  qty: number;
  min: number;
  status?: string; // "sent" etc
  tokenCount?: number;
}

export function useAlertsHistory(limitCount: number = 50) {
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(db, "alertsLog");

    // NOTE: if you later want to limit results, we can add `limit(limitCount)`
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AlertLog[] = [];

        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;

          list.push({
            id: docSnap.id,
            createdAt: d.createdAt ?? null,
            itemId: String(d.itemId ?? ""),
            itemName: String(d.itemName ?? "Unnamed item"),
            prevState: (d.prevState ?? "OK") as AlertState,
            nextState: (d.nextState ?? "OK") as AlertState,
            qty: Number(d.qty ?? 0),
            min: Number(d.min ?? 0),
            status: d.status,
            tokenCount: d.tokenCount,
          });
        });

        // cheap guard: keep it from growing forever in app memory
        setAlerts(list.slice(0, limitCount));
        setLoading(false);
      },
      (err) => {
        console.error("alertsLog listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [limitCount]);

  return { alerts, loading };
}
