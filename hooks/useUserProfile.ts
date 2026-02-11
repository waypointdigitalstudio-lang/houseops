// hooks/useUserProfile.ts
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../firebaseConfig";

export type UserProfile = {
  siteId: string; // e.g. "ballys_tiverton"
  role?: "admin" | "staff";
  createdAt?: any;
  updatedAt?: any;
};

type Result = {
  uid: string | null;
  profile: UserProfile | null;
  siteId: string | null;
  loading: boolean;
};

const DEFAULT_SITE_ID = "ballys_tiverton"; // <-- change if you want a different default

export function useUserProfile(): Result {
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // cleanup old listener when auth changes
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!user) {
        setUid(null);
        setProfile(null);
        setSiteId(null);
        setLoading(false);
        return;
      }

      setUid(user.uid);
      setLoading(true);

      const ref = doc(db, "users", user.uid);

      unsubProfile = onSnapshot(
        ref,
        async (snap) => {
          // If profile exists, BUT missing siteId, patch it.
          if (snap.exists()) {
            const data = (snap.data() || {}) as Partial<UserProfile>;

            const patched: UserProfile = {
              siteId: (data.siteId as string) || DEFAULT_SITE_ID,
              role: (data.role as any) || "staff",
              createdAt: data.createdAt ?? serverTimestamp(),
              updatedAt: serverTimestamp(),
            };

            // If it was missing siteId, write it back so the DB matches UI
            if (!data.siteId) {
              try {
                await setDoc(ref, patched, { merge: true });
              } catch (e) {
                console.log("Patch user profile failed:", e);
              }
            }

            setProfile(patched);
            setSiteId(patched.siteId);
            setLoading(false);
            return;
          }

          // If profile doesn't exist, create it
          const defaultProfile: UserProfile = {
            siteId: DEFAULT_SITE_ID,
            role: "staff",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          try {
            await setDoc(ref, defaultProfile, { merge: true });
          } catch (e) {
            console.log("Create default user profile failed:", e);
          }

          setProfile(defaultProfile);
          setSiteId(defaultProfile.siteId);
          setLoading(false);
        },
        (err) => {
          console.log("User profile snapshot error:", err);
          setProfile(null);
          setSiteId(null);
          setLoading(false);
        }
      );
    });

    return () => {
      if (unsubProfile) unsubProfile();
      unsubAuth();
    };
  }, []);

  return { uid, profile, siteId, loading };
}

