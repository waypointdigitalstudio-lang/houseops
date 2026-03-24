// hooks/useLowStockCount.ts
// Shared hook that returns the real-time count of low-stock items.
// Used by _layout.tsx to set the tab badge.
//
// v9 - 2026-03-24 — Multi-collection support
// ------------------------------------------
// Now counts low-stock items across all three collections:
//   - items        (uses currentQuantity)
//   - toners       (uses quantity)
//   - radioParts   (uses quantity)
//
// v8 - 2026-03-13 — Dismiss-aware counting
// ------------------------------------------
// Counts items where currentQuantity <= minQuantity AND the alert is visible:
//   - Not dismissed (userDismissedAlert is false/undefined), OR
//   - Quantity changed since dismissal (currentQuantity !== userDismissedAlertQuantity)

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";

// Collections and which field holds the current quantity
const COLLECTIONS: { name: string; qtyField: string }[] = [
  { name: "items",      qtyField: "currentQuantity" },
  { name: "toners",     qtyField: "quantity" },
  { name: "radioParts", qtyField: "quantity" },
];

/**
 * Returns the live count of items that have visible low-stock alerts,
 * across inventory items, toners, and radio parts.
 *
 * An item is counted when:
 *   1. qty <= minQuantity  AND  minQuantity > 0
 *   2. AND one of:
 *      a. userDismissedAlert is false/undefined (not dismissed)
 *      b. qty !== userDismissedAlertQuantity (quantity changed since dismiss)
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

    // Track counts from each collection independently
    const counts: Record<string, number> = {
      items: 0,
      toners: 0,
      radioParts: 0,
    };

    const unsubs = COLLECTIONS.map(({ name, qtyField }) => {
      const q = query(collection(db, name), where("siteId", "==", siteId));

      return onSnapshot(
        q,
        (snapshot) => {
          if (generationRef.current !== thisGeneration) return;

          let lowCount = 0;

          for (const d of snapshot.docs) {
            const data = d.data();

            const currentQty: number =
              typeof data[qtyField] === "number" ? data[qtyField] : 0;
            const minQty: number =
              typeof data.minQuantity === "number" ? data.minQuantity : 0;

            if (minQty > 0 && currentQty <= minQty) {
              const dismissed: boolean = data.userDismissedAlert === true;
              const dismissedQty =
                typeof data.userDismissedAlertQuantity === "number"
                  ? data.userDismissedAlertQuantity
                  : null;

              if (!dismissed || dismissedQty === null || currentQty !== dismissedQty) {
                lowCount++;
              }
            }
          }

          counts[name] = lowCount;
          if (generationRef.current === thisGeneration) {
            setCount(counts.items + counts.toners + counts.radioParts);
          }
        },
        (err) => {
          console.error(`[useLowStockCount] Snapshot error (${name}):`, err);
          if (generationRef.current === thisGeneration) {
            counts[name] = 0;
            setCount(counts.items + counts.toners + counts.radioParts);
          }
        }
      );
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [siteId]);

  return count;
}
