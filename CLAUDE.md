# Nexus — Claude Code Project Guide

## Project Overview

**Nexus** is a React Native / Expo (SDK 54) mobile app for multi-site operations management. Built with TypeScript, Firebase Firestore, Firebase Auth, and Expo Router.

---

## Tech Stack

- **Framework:** React Native via Expo SDK 54
- **Router:** Expo Router (file-based, `app/` directory)
- **Language:** TypeScript
- **Database:** Google Firestore (real-time `onSnapshot` listeners)
- **Auth:** Firebase Auth (email/password)
- **Cloud Functions:** Firebase Functions v2 (Node.js ESM) in `functions/index.js`
- **Build/OTA:** EAS Build + EAS Update

---

## Key Conventions

### Theme

- **Never use `theme.tint` as a button background.** In dark mode `theme.tint = "#ffffff"`, producing a white-on-white invisible button.
- **Use `theme.primary` (`"#00b894"`) for all action/primary buttons.** This is the canonical green across all screens.
- `useAppTheme()` is in `constants/theme.ts`. Always destructure theme tokens — never hardcode colors in components.
- Theme tokens: `background`, `card`, `text`, `mutedText`, `border`, `tint`, `icon`, `primary`.

### Firestore Queries

- Every collection (except `users` and `sites`) is scoped by `siteId`. Always include `where("siteId", "==", siteId)` in queries.
- Activity/analytics queries on `alertsLog` use `orderBy("createdAt", "desc")`. This requires the composite index `siteId ASC + createdAt DESC` — defined in `firestore.indexes.json`.
- Date-range filtering uses `Timestamp.fromDate(cutoff)` — never JavaScript Date objects directly.
- Analytics data uses a **dedicated** `analyticsActivities` state + `useEffect` (limit 500), separate from the activity log's `activities` state (limit 100). Do not merge these.

### State Patterns

- `siteId` comes from `useUserProfile()` → `profile.siteId`.
- `useEffect` listeners that depend on `siteId` must have `siteId` in their dependency array and guard with `if (!siteId) { ...; return; }`.
- Firestore `onSnapshot` unsubscribers must be returned from `useEffect` cleanup.

### Null Safety

- `siteId` and `uid` from `useUserProfile` can be `null` before the profile loads. Guard all Firestore writes and reads.
- State setters typed as `string` must never receive `null | undefined`. Use `|| ""` fallback when assigning optional Firestore fields.

---

## Known Issues / False Alarms

### `firebaseConfig.ts` TypeScript Error

```
Module '"firebase/auth"' has no exported member 'getReactNativePersistence'
```

- **This is a false alarm.** The runtime works correctly. The type definitions in Firebase SDK v12 lag behind the actual exports.
- Do not attempt to fix this with type assertions or workarounds — it will resolve in a future Firebase SDK update.
- This is the **only** remaining `tsc --noEmit` error in the project as of April 2026.

---

## File Map (Key Files)

| File | Purpose |
|---|---|
| `app/(tabs)/index.tsx` | Inventory, Toners, Printers, Radios, Scanner |
| `app/(tabs)/alerts.tsx` | Stock alerts + Activity Log + Analytics |
| `app/(tabs)/explore.tsx` | Vendor / Contact directory |
| `app/(tabs)/disposal.tsx` | Asset disposal records |
| `app/(tabs)/settings.tsx` | User settings, notifications, sign-out |
| `app/(tabs)/admin.tsx` | Admin: user & site management |
| `app/item/[id].tsx` | Inventory item detail + stock adjust |
| `app/toners/[id].tsx` | Toner detail + stock adjust |
| `app/radiopart/[id].tsx` | Radio part detail + stock adjust |
| `constants/theme.ts` | `useAppTheme()` — light/dark theme tokens |
| `constants/branding.ts` | `BRAND` — app name, accent colors |
| `hooks/useUserProfile.ts` | Auth state + Firestore user doc |
| `hooks/useLowStockCount.ts` | Real-time low-stock badge count |
| `firebaseConfig.ts` | Firebase app init + `db` export |
| `functions/index.js` | Cloud Functions (ESM) |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Composite index definitions |
| `docs/SOP_v2.md` | User-facing standard operating procedures |
| `docs/TECH_DOC_v2.md` | Technical architecture documentation |

---

## Alerts Tab Architecture (`app/(tabs)/alerts.tsx`)

Three views managed by `activeView` state:

```ts
type ActiveView = "alerts" | "activity" | "analytics";
```

- **Alerts** — real-time `alerts` collection, filterable by type
- **Activity** — `alertsLog` collection, limit 100, date-range + action-type filters, CSV export
- **Analytics** — dedicated query on `alertsLog`, limit 500, period selector (7 days / 30 days / All), shows Activity Breakdown chips, Top Consumed (HBar), Most Alerted (HBar)

Analytics uses its own state:
- `analyticsActivities` — separate from `activities` (the activity log state)
- `loadingAnalytics` — separate loading flag
- `analyticsPeriod: "7days" | "30days" | "all"` — drives Firestore-level date filter

---

## Deployment Commands

```bash
# OTA update (JS-only changes)
eas update --branch production --message "describe what changed"

# Native build
eas build --platform all

# Deploy Firestore rules/indexes/functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```
