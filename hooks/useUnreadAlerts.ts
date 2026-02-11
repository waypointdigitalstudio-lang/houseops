// hooks/useUnreadAlerts.ts
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";

import { db } from "../firebaseConfig";

type AlertDoc = {
  siteId?: string;
  readBy?: Record<string, boolean>;
};

export function useUnreadAlerts(siteId: string | null, token: string | null) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!siteId || !token) {
      setUnreadCount(0);
      return;
    }

    const q = query(collection(db, "alerts"), where("siteId", "==", siteId));

    const unsub = onSnapshot(
      q,
      (snap) => {
        let count = 0;
        snap.docs.forEach((doc) => {
          const data = doc.data() as AlertDoc;
          const isUnread = !(data.readBy && data.readBy[token]);
          if (isUnread) count++;
        });
        setUnreadCount(count);
      },
      (err) => {
        console.log("Unread alerts count error:", err);
        setUnreadCount(0);
      }
    );

    return () => unsub();
  }, [siteId, token]);

  return unreadCount;
}