import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebaseConfig";

export type Item = {
  id: string;
  name: string;
  currentQuantity: number;
  minQuantity: number;
};

export function useLowStockItems() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const itemsRef = collection(db, "items");

    const unsub = onSnapshot(
      itemsRef,
      (snap) => {
        const list: Item[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || "Unnamed item",
            currentQuantity: data.currentQuantity ?? 0,
            minQuantity: data.minQuantity ?? 0,
          };
        });

        setItems(list);
        setLoading(false);
      },
      (err) => {
        console.error("Low stock listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const lowItems = useMemo(
    () => items.filter((i) => i.currentQuantity <= i.minQuantity),
    [items]
  );

  return { lowItems, loading };
}

