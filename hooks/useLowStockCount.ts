// hooks/useLowStockCount.ts
// Shared hook that returns the real-time count of low-stock items.
// Used by _layout.tsx to set the tab badge.
//
// SIMPLIFIED v7 - 2026-03-13
// ---------------------------
// - REMOVED all dismiss/auto-clear logic entirely
// - Simply counts items where currentQuantity <= minQuantity
// - Clean, reliable, no sync issues

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";

/**
 * Returns the live count of items that are currently low on stock.
 *
 * An item is considered "low stock" when:
 *   currentQuantity <= minQuantity  AND  minQuantity > 0
 *
 * No dismiss filtering — if it's low stock, it counts.
 *
 * @param siteId - The site to filter items by. If falsy, returns 0.
 * @returns The number of low-stock items.
 */
export function useLowStockCount(siteId?: string | null): number {
  const [count, setCount] = useState(0);

  // Generation counter — incremented on every effect run so stale listeners
  // from a previous mount/run can detect they are outdated and bail out.
  const generationRef = useRef(0);

  useEffect(() => {
    const thisGeneration = ++generationRef.current;

    if (!siteId) {
      console.log("[useLowStockCount] No siteId provided — returning 0");
      setCount(0);
      return;
    }

    console.log(
      `[useLowStockCount] Subscribing to items (siteId="${siteId}", gen=${thisGeneration})`
    );

    const q = query(collection(db, "items"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        // Guard: if a newer effect has started, this listener is stale — bail
        if (generationRef.current !== thisGeneration) {
          console.log(
            `[useLowStockCount] Stale snapshot callback (gen=${thisGeneration}, current=${generationRef.current}) — ignoring`
          );
          return;
        }

        let lowCount = 0;

        for (const d of snapshot.docs) {
          const data = d.data();

          const currentQty: number =
            typeof data.currentQuantity === "number"
              ? data.currentQuantity
              : 0;
          const minQty: number =
            typeof data.minQuantity === "number" ? data.minQuantity : 0;

          if (minQty > 0 && currentQty <= minQty) {
            lowCount++;
          }
        }

        console.log(
          `[useLowStockCount] Snapshot (gen=${thisGeneration}): ${snapshot.docs.length} items, ${lowCount} low-stock`
        );

        setCount(lowCount);
      },
      (err) => {
        console.error("[useLowStockCount] Snapshot error:", err);
        if (generationRef.current === thisGeneration) {
          setCount(0);
        }
      }
    );

    return () => {
      console.log(`[useLowStockCount] Unsubscribing (gen=${thisGeneration})`);
      unsub();
    };
  }, [siteId]);

  return count;
}
