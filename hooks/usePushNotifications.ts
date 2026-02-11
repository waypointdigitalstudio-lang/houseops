import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { auth, db } from "../firebaseConfig";

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => {
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

type PushOptions = {
  saveToFirestore?: boolean;
  siteId?: string | null;
};

export function usePushNotifications(options?: PushOptions) {
  const [token, setToken] = useState<string | null>(null);
  
  // ✅ FIX: Use refs to track options without causing re-renders
  const saveToFirestoreRef = useRef(options?.saveToFirestore);
  const siteIdRef = useRef(options?.siteId);

  // Update refs when options change
  useEffect(() => {
    saveToFirestoreRef.current = options?.saveToFirestore;
    siteIdRef.current = options?.siteId;
  }, [options?.saveToFirestore, options?.siteId]);

  useEffect(() => {
    let mounted = true;

    async function register() {
      try {
        if (!Device.isDevice) return;

        const { status: existingStatus } =
          await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== "granted") return;

        // Android channel - set to HIGH importance for banner notifications
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#FF231F7C",
          });
        }

        const expoToken = (await Notifications.getExpoPushTokenAsync()).data;

        if (!mounted) return;
        setToken(expoToken);

        // Save to Firestore (ONLY if we have user + siteId)
        // ✅ FIX: Use refs instead of options directly
        if (saveToFirestoreRef.current) {
          const user = auth.currentUser;
          const siteId = siteIdRef.current ?? null;

          if (!user || !siteId) {
            console.log("Push token NOT saved (missing user or siteId)");
            return;
          }

          await setDoc(
            doc(db, "devicePushTokens", expoToken),
            {
              token: expoToken,
              uid: user.uid,
              siteId,
              platform: Platform.OS,
              enabled: true,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (e) {
        console.log("usePushNotifications error:", e);
      }
    }

    register();

    // Handle notifications received while app is in foreground
    const notificationListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("📬 Notification received:", notification);
      }
    );

    // Handle user tapping on notification
    const responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("👆 Notification tapped:", response);
        // You can add navigation logic here if needed
      }
    );

    return () => {
      mounted = false;
      notificationListener.remove();
      responseListener.remove();
    };
  }, []); // ✅ FIX: Empty dependency array - only run once

  return token;
}