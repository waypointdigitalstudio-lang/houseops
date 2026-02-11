// notifications/savePushToken.ts
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { Platform } from "react-native";
import { auth, db } from "../firebaseConfig";

export async function savePushToken(
  token: string,
  siteId: string,
  label?: string
): Promise<void> {
  const user = auth.currentUser;

  if (!user) {
    console.log("❌ savePushToken: no signed-in user");
    return;
  }

  const cleanSiteId = String(siteId ?? "").trim();
  if (!cleanSiteId) {
    console.log("❌ savePushToken: missing siteId");
    return;
  }

  const ref = doc(db, "devicePushTokens", token);

  try {
    // If doc exists, make sure we don't accidentally "take over" another user's token doc
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const data = existing.data() as any;

      const existingUid = data.uid;
      const existingSiteId = data.siteId;

      // If it already belongs to someone else, stop (prevents weird mismatches)
      if (existingUid && existingUid !== user.uid) {
        console.log("❌ savePushToken: token belongs to another uid");
        return;
      }

      // If it has a different siteId, also stop (you can decide if you want to allow auto-fix)
      if (existingSiteId && existingSiteId !== cleanSiteId) {
        console.log("⚠️ savePushToken: token siteId mismatch; not overwriting", {
          existingSiteId,
          cleanSiteId,
        });
        return;
      }
    }

    await setDoc(
      ref,
      {
        token,
        uid: user.uid,
        siteId: cleanSiteId,
        label: label?.trim() ? label.trim() : null,
        platform: Platform.OS,
        enabled: true,
        updatedAt: serverTimestamp(),

        // keep createdAt stable (only set if missing)
        createdAt: existing.exists() ? existing.data().createdAt ?? serverTimestamp() : serverTimestamp(),
      },
      { merge: true }
    );

    console.log("🔥 Push token saved:", { token, uid: user.uid, siteId: cleanSiteId });
  } catch (e) {
    console.log("❌ savePushToken failed:", e);
  }
}
