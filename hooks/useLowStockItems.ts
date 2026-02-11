import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebaseConfig";

export type LowStockItem = {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
};

export function useLowStockItems() {
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(db, "items");

    const unsub = onSnapshot(ref, (snap) => {
      const all: LowStockItem[] = [];

      snap.forEach((doc) => {
        const d = doc.data() as any;
        all.push({
          id: doc.id,
          name: d.name ?? "Unnamed item",
          currentQuantity: d.currentQuantity ?? 0,
          minQuantity: d.minQuantity ?? 0,
        });
      });

      setItems(all);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const lowItems = useMemo(
    () => items.filter((i) => i.currentQuantity <= i.minQuantity),
    [items]
  );

  return { lowItems, loading };
}
