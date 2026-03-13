// hooks/useLowStockCount.ts
// Shared hook that returns the real-time count of low-stock items.
// Used by _layout.tsx to set the tab badge and by alerts.tsx for consistency.
//
// FIX v2 - 2026-03-13
// --------------------
// - Only uses the canonical `currentQuantity` and `minQuantity` fields from
//   the items collection. No fallback to `quantity` or `min`.
// - Added a listener-generation guard to prevent stale onSnapshot callbacks
//   from updating state after the effect has been cleaned up.
// - Count is always computed fresh from the snapshot (never accumulated).

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";

/**
 * Returns the live count of items that are currently low on stock.
 *
 * An item is considered "low stock" when:
 *   currentQuantity <= minQuantity  AND  minQuantity > 0
 *
 * Items where `userDismissedAlert === true` are excluded from the count.
 *
 * @param siteId - The site to filter items by. If falsy, returns 0.
 * @returns The number of actionable low-stock items.
 */
export function useLowStockCount(siteId?: string | null): number {
  const [count, setCount] = useState(0);

  // Generation counter - incremented on every effect run so stale listeners
  // from a previous mount/run can detect they are outdated and bail out.
  const generationRef = useRef(0);

  useEffect(() => {
    // Bump the generation so any in-flight callback from a prior listener
    // will see a mismatch and skip the setState call.
    const thisGeneration = ++generationRef.current;

    // If no siteId, nothing to count - reset to 0 immediately
    if (!siteId) {
      console.log("[useLowStockCount] No siteId provided - returning 0");
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
        // Guard: if a newer effect has started, this listener is stale - bail
        if (generationRef.current !== thisGeneration) {
          console.log(
            `[useLowStockCount] Stale snapshot callback (gen=${thisGeneration}, current=${generationRef.current}) - ignoring`
          );
          return;
        }

        let lowCount = 0;
        const totalDocs = snapshot.docs.length;

        for (const d of snapshot.docs) {
          const data = d.data();

          // Skip items the user has already dismissed
          if (data.userDismissedAlert === true) {
            console.log(
              `[useLowStockCount]   SKIP (dismissed): ${data.name ?? d.id}`
            );
            continue;
          }

          // Use ONLY the canonical quantity fields - do NOT fall back to
          // `quantity` or `min` which may come from alertsLog-style data.
          const currentQty: number =
            typeof data.currentQuantity === "number"
              ? data.currentQuantity
              : 0;
          const minQty: number =
            typeof data.minQuantity === "number" ? data.minQuantity : 0;

          const isLow = minQty > 0 && currentQty <= minQty;

          if (isLow) {
            lowCount++;
            console.log(
              `[useLowStockCount]   LOW: "${data.name ?? d.id}" qty=${currentQty} min=${minQty}`
            );
          }
        }

        console.log(
          `[useLowStockCount] Snapshot complete (gen=${thisGeneration}): ${totalDocs} items, ${lowCount} low-stock`
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

    // Cleanup: unsubscribe when effect re-runs or component unmounts
    return () => {
      console.log(`[useLowStockCount] Unsubscribing (gen=${thisGeneration})`);
      unsub();
    };
  }, [siteId]);

  return count;
}
