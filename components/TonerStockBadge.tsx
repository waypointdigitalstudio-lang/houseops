import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import inventoryStyles from "../constants/inventoryStyles";
import { db } from "../firebaseConfig";

export default function TonerStockBadge({ tonerId, theme }: { tonerId: string; theme: any }) {
  const [stock, setStock] = useState<number | null>(null);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (!tonerId) return;
    const unsub = onSnapshot(
      doc(db, "toners", tonerId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          setStock(data.quantity ?? data.stock ?? 0);
          setName(data.model || data.name || "Toner");
        }
      },
      (err) => { if (__DEV__) console.error("TonerStockBadge error:", err); }
    );
    return () => unsub();
  }, [tonerId]);

  if (stock === null) return null;

  const color = stock <= 0 ? "#ef4444" : stock <= 2 ? "#f97316" : "#22c55e";

  return (
    <View style={[inventoryStyles.stockBadge, { backgroundColor: color + "20", borderColor: color }]}>
      <Text style={[inventoryStyles.stockText, { color }]}>
        {name}: {stock}
      </Text>
    </View>
  );
}
