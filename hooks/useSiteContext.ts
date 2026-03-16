// hooks/useSiteContext.ts
// Provides the active siteId for the current user.
// - Staff: always their assigned siteId from their profile
// - Admins: can override with any site via setActiveSiteId()
//
// Usage:
//   const { activeSiteId, setActiveSiteId, isAdmin } = useSiteContext();
 
import { useState } from "react";
import { useUserProfile } from "./useUserProfile";
 
export const SITES = [
  { id: "ballys_tiverton", label: "Tiverton" },
  { id: "ballys_lincoln", label: "Lincoln" },
];
 
export function useSiteContext() {
  const { siteId, profile, loading } = useUserProfile();
  const isAdmin = profile?.role === "admin";
 
  // Admins can override which site they're viewing.
  // null means "use their own assigned siteId".
  const [overrideSiteId, setOverrideSiteId] = useState<string | null>(null);
 
  const activeSiteId = isAdmin && overrideSiteId ? overrideSiteId : siteId;
 
  function setActiveSiteId(id: string | null) {
    if (!isAdmin) return; // staff cannot switch
    setOverrideSiteId(id);
  }
 
  const activeSiteLabel =
    SITES.find((s) => s.id === activeSiteId)?.label ?? activeSiteId ?? "Unknown";
 
  return {
    activeSiteId,       // use this everywhere instead of siteId
    activeSiteLabel,    // human-readable label for the active site
    setActiveSiteId,    // admins only — set the active site
    isAdmin,
    loading,
    ownSiteId: siteId,  // the admin's own assigned site (for reference)
  };
}
 