// hooks/useUnreadAlertsCount.ts
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";

type AlertDoc = {
  readBy?: Record<string, boolean>;
};

export function useUnreadAlertsCount(
  token: string | null,
  siteId: string | null
) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!token || !siteId) {
      setCount(0);
      return;
    }

    const q = query(
      collection(db, "alerts"),
      where("siteId", "==", siteId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        let c = 0;

        snap.forEach((docSnap) => {
          const data = docSnap.data() as AlertDoc;
          const isRead = Boolean(data.readBy?.[token]);
          if (!isRead) c++;
        });

        setCount(c);
      },
      (err) => {
        console.log("Unread alerts count snapshot error:", err);
        setCount(0);
      }
    );

    return () => unsub();
  }, [token, siteId]);

  return count;
}
