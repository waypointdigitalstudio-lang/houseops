// hooks/useLowStockCount.ts
// Shared hook that returns the real-time count of low-stock items.
// Used by _layout.tsx to set the tab badge.
//
// v8 - 2026-03-13 — Dismiss-aware counting
// ------------------------------------------
// Counts items where currentQuantity <= minQuantity AND the alert is visible:
//   - Not dismissed (userDismissedAlert is false/undefined), OR
//   - Quantity changed since dismissal (currentQuantity !== userDismissedAlertQuantity)

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";

/**
 * Returns the live count of items that have visible low-stock alerts.
 *
 * An item is counted when:
 *   1. currentQuantity <= minQuantity  AND  minQuantity > 0
 *   2. AND one of:
 *      a. userDismissedAlert is false/undefined (not dismissed)
 *      b. currentQuantity !== userDismissedAlertQuantity (quantity changed since dismiss)
 *
 * @param siteId - The site to filter items by. If falsy, returns 0.
 * @returns The number of visible low-stock alerts.
 */
export function useLowStockCount(siteId?: string | null): number {
  const [count, setCount] = useState(0);

  // Generation counter — incremented on every effect run so stale listeners
  // from a previous mount/run can detect they are outdated and bail out.
  const generationRef = useRef(0);

  useEffect(() => {
    const thisGeneration = ++generationRef.current;

    if (!siteId) {
      setCount(0);
      return;
    }

    const q = query(collection(db, "items"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        // Guard: if a newer effect has started, this listener is stale — bail
        if (generationRef.current !== thisGeneration) {
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

          // Must be low stock first
          if (minQty > 0 && currentQty <= minQty) {
            const dismissed: boolean = data.userDismissedAlert === true;
            const dismissedQty =
              typeof data.userDismissedAlertQuantity === "number"
                ? data.userDismissedAlertQuantity
                : null;

            // Show (count) if: not dismissed, OR quantity changed since dismissal
            if (!dismissed || dismissedQty === null || currentQty !== dismissedQty) {
              lowCount++;
            }
          }
        }

        setCount(lowCount);
      },
      (err) => {
        console.error("[useLowStockCount] Snapshot error:", err);
        if (generationRef.current === thisGeneration) {
          setCount(0);
        }
      }
    );

    return () => unsub();
  }, [siteId]);

  return count;
}
