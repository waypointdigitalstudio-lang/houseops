// hooks/useLowStockCount.ts
// Shared hook that returns the real-time count of low-stock items.
// Used by _layout.tsx to set the tab badge and by alerts.tsx for consistency.
//
// FIX v3 - 2026-03-13
// --------------------
// - Extracted calculateAlertState() for consistent severity logic with alerts.tsx.
//   Uses minQty * 0.5 (not Math.floor) for CRITICAL threshold.
// - Only uses the canonical `currentQuantity` and `minQuantity` fields from
//   the items collection. No fallback to `quantity` or `min`.
// - Added a listener-generation guard to prevent stale onSnapshot callbacks
//   from updating state after the effect has been cleaned up.
// - Count is always computed fresh from the snapshot (never accumulated).
//
// FIX v4 - 2026-03-13  (Auto-clear dismissed alerts)
// --------------------
// - Dismissal is auto-cleared (alert counted again) if ANY of:
//     1. 24 hours have passed since `userDismissedAlertAt`
//     2. Current quantity > `userDismissedAlertQuantity` (restocked)
//     3. Current severity is worse than dismissed severity (already had this)

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db } from "../firebaseConfig";

/** Returns a numeric severity level for alert states (higher = worse) */
function getSeverityLevel(state: string): number {
  switch (state.toUpperCase()) {
    case "OUT":
      return 3;
    case "CRITICAL":
      return 2;
    case "LOW":
      return 1;
    case "OK":
    default:
      return 0;
  }
}

/**
 * Calculates the alert severity from actual quantity values.
 * Must stay in sync with the same function in alerts.tsx.
 *
 * - OUT:      currentQuantity <= 0
 * - CRITICAL: currentQuantity > 0 AND currentQuantity <= (minQuantity * 0.5)
 * - LOW:      currentQuantity > (minQuantity * 0.5) AND currentQuantity <= minQuantity
 * - OK:       currentQuantity > minQuantity
 */
function calculateAlertState(currentQty: number, minQty: number): string {
  if (currentQty <= 0) return "OUT";
  if (currentQty <= minQty * 0.5) return "CRITICAL";
  if (currentQty <= minQty) return "LOW";
  return "OK";
}

/** Auto-clear dismissed alerts after this many milliseconds (24 hours) */
const DISMISS_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the live count of items that are currently low on stock.
 *
 * An item is considered "low stock" when:
 *   currentQuantity <= minQuantity  AND  minQuantity > 0
 *
 * Items where `userDismissedAlert === true` are excluded from the count,
 * UNLESS the dismissal is auto-cleared by any of:
 *   1. 24 hours have passed since `userDismissedAlertAt`
 *   2. Current quantity > `userDismissedAlertQuantity` (item restocked)
 *   3. Current severity is worse than dismissed severity
 *
 * @param siteId - The site to filter items by. If falsy, returns 0.
 * @returns The number of actionable low-stock items.
 */
export function useLowStockCount(siteId?: string | null): number {
  const [count, setCount] = useState(0);

  // Generation counter — incremented on every effect run so stale listeners
  // from a previous mount/run can detect they are outdated and bail out.
  const generationRef = useRef(0);

  useEffect(() => {
    // Bump the generation so any in-flight callback from a prior listener
    // will see a mismatch and skip the setState call.
    const thisGeneration = ++generationRef.current;

    // If no siteId, nothing to count — reset to 0 immediately
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
        const totalDocs = snapshot.docs.length;

        for (const d of snapshot.docs) {
          const data = d.data();

          // Use ONLY the canonical quantity fields — do NOT fall back to
          // `quantity` or `min` which may come from alertsLog-style data.
          const currentQty: number =
            typeof data.currentQuantity === "number"
              ? data.currentQuantity
              : 0;
          const minQty: number =
            typeof data.minQuantity === "number" ? data.minQuantity : 0;

          const isLow = minQty > 0 && currentQty <= minQty;

          if (isLow) {
            // Determine current alert severity using shared logic
            const alertState = calculateAlertState(currentQty, minQty);

            // Auto-clear logic: If dismissed, check if dismissal should be cleared.
            // Count the item if ANY auto-clear condition is met.
            if (data.userDismissedAlert === true) {
              const dismissedState = typeof data.userDismissedAlertState === "string"
                ? data.userDismissedAlertState
                : "OK"; // fallback for legacy dismissals without state
              let autoClearReason: string | null = null;

              // Check 1: Time-based expiry (24 hours)
              const dismissedAt = data.userDismissedAlertAt;
              if (dismissedAt) {
                let dismissedTime = 0;
                if (typeof dismissedAt.toDate === "function") {
                  dismissedTime = dismissedAt.toDate().getTime();
                } else if (typeof dismissedAt.getTime === "function") {
                  dismissedTime = dismissedAt.getTime();
                }
                if (dismissedTime > 0 && Date.now() - dismissedTime >= DISMISS_EXPIRY_MS) {
                  autoClearReason = `24h expired`;
                }
              }

              // Check 2: Restock detection (quantity increased since dismissal)
              const dismissedQty = data.userDismissedAlertQuantity;
              if (
                !autoClearReason &&
                typeof dismissedQty === "number" &&
                currentQty > dismissedQty
              ) {
                autoClearReason = `restocked (was ${dismissedQty}, now ${currentQty})`;
              }

              // Check 3: Severity worsened
              if (!autoClearReason && getSeverityLevel(alertState) > getSeverityLevel(dismissedState)) {
                autoClearReason = `severity worsened (${dismissedState} → ${alertState})`;
              }

              if (autoClearReason) {
                console.log(
                  `[useLowStockCount]   AUTO-CLEAR (${autoClearReason}): "${data.name ?? d.id}"`
                );
                // Fall through — count the item
              } else {
                console.log(
                  `[useLowStockCount]   SKIP (dismissed at ${dismissedState}, now ${alertState}): ${data.name ?? d.id}`
                );
                continue;
              }
            }

            lowCount++;
            console.log(
              `[useLowStockCount]   LOW: "${data.name ?? d.id}" qty=${currentQty} min=${minQty} state=${alertState}`
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
