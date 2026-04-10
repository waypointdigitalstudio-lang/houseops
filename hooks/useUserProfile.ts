// hooks/useUserProfile.ts
// v2 - 2026-03-16
// FIX: Removed hardcoded DEFAULT_SITE_ID fallback.
// Users without a siteId in Firestore now get null instead of being
// silently assigned "ballys_tiverton". This surfaces the missing
// assignment rather than hiding it with wrong data.
 
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../firebaseConfig";
 
export type UserProfile = {
  siteId: string;
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
 
export function useUserProfile(): Result {
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
 
  useEffect(() => {
    let mounted = true;
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Guard: if the component unmounted before this fired, do nothing.
      if (!mounted) return;

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
          if (!mounted) return;

          if (snap.exists()) {
            const data = (snap.data() || {}) as Partial<UserProfile>;

            // FIX: No longer falls back to a hardcoded site.
            // siteId will be null if not set — surfaces missing assignment.
            const resolved: UserProfile = {
              siteId: (data.siteId as string) ?? "",
              role: (data.role as any) || "staff",
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            };

            setProfile(resolved);
            setSiteId(resolved.siteId || null);
            setLoading(false);
            return;
          }

          // Profile doesn't exist yet — create it with no siteId assigned.
          // User will need to be assigned a site by an admin or via signup.
          const defaultProfile: UserProfile = {
            siteId: "",
            role: "staff",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          try {
            await setDoc(ref, defaultProfile, { merge: true });
          } catch (e) {
            if (__DEV__) console.log("Create default user profile failed:", e);
          }

          if (!mounted) return;
          setProfile(defaultProfile);
          setSiteId(null); // null = not yet assigned
          setLoading(false);
        },
        (err) => {
          if (!mounted) return;
          if (__DEV__) console.log("User profile snapshot error:", err);
          setProfile(null);
          setSiteId(null);
          setLoading(false);
        }
      );
    });

    return () => {
      mounted = false;
      if (unsubProfile) unsubProfile();
      unsubAuth();
    };
  }, []);
 
  return { uid, profile, siteId, loading };
}
