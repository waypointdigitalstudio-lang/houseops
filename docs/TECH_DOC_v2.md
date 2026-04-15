# Nexus — Technical Documentation
**Version 2.1.0 | March 2026 | Updated: April 2026**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Firebase Architecture](#4-firebase-architecture)
5. [Firestore Data Models](#5-firestore-data-models)
6. [Firestore Security Rules](#6-firestore-security-rules)
7. [Cloud Functions](#7-cloud-functions)
8. [Authentication & User Roles](#8-authentication--user-roles)
9. [Push Notifications](#9-push-notifications)
10. [CSV Import / Export](#10-csv-import--export)
11. [Navigation & Routing](#11-navigation--routing)
12. [Key Hooks](#12-key-hooks)
13. [Theming](#13-theming)
14. [Deployment](#14-deployment)
15. [Environment & Config Files](#15-environment--config-files)
16. [Known Constraints & Notes](#16-known-constraints--notes)

---

## 1. Project Overview

**Nexus** is a React Native / Expo mobile application for operations management. It is built for multi-site organizations and supports inventory tracking, toner/printer management, radio tracking, asset disposal, push notifications, and a vendor contact directory.

All application data is persisted in **Google Firestore** with real-time listeners. Authentication is handled by **Firebase Auth**. Push notifications are delivered via **Expo Push Notification Service** (EPN), triggered by **Firebase Cloud Functions**.

**Bundle ID (iOS):** `com.houseops.nexus`
**Package (Android):** `com.houseops.nexus`
**EAS Project ID:** `98f68256-6eef-4add-b46a-42f4564a8cb7`

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native via Expo SDK |
| Router | Expo Router (file-based, React Navigation under the hood) |
| Language | TypeScript |
| Database | Google Firestore (real-time, NoSQL) |
| Authentication | Firebase Auth (email/password) |
| Cloud Functions | Firebase Functions v2 (Node.js, ESM) |
| Push Notifications | Expo Push Notification Service |
| File I/O | expo-file-system (legacy API) |
| Document Picker | expo-document-picker |
| File Sharing | expo-sharing |
| Camera / Scanner | expo-camera (CameraView + useCameraPermissions) |
| Build & OTA | EAS Build + EAS Update |
| Runtime Version | appVersion policy |

---

## 3. Project Structure

```
houseops/
├── app/
│   ├── (auth)/              # Login / Sign-up screens
│   ├── (tabs)/
│   │   ├── _layout.tsx      # Tab bar configuration & badge logic
│   │   ├── index.tsx        # Inventory, Toners, Printers, Radios, Scanner
│   │   ├── alerts.tsx       # Stock alerts + activity log
│   │   ├── explore.tsx      # Vendor / Contact directory
│   │   ├── disposal.tsx     # Asset disposal records
│   │   ├── settings.tsx     # User settings & sign-out
│   │   └── admin.tsx        # Admin: user & site management
│   ├── item/
│   │   └── [id].tsx         # Inventory item detail screen (full-screen edit + stock adjust)
│   ├── toners/
│   │   └── [id].tsx         # Toner detail screen (full-screen edit + stock adjust)
│   ├── radiopart/
│   │   └── [id].tsx         # Radio part detail screen (full-screen edit + stock adjust)
│   └── _layout.tsx          # Root layout (auth gate)
├── constants/
│   ├── branding.ts          # App name, colors (BRAND constant)
│   └── theme.ts             # useAppTheme hook (light/dark)
├── hooks/
│   ├── useUserProfile.ts    # Auth state + Firestore user doc
│   ├── useLowStockCount.ts  # Real-time low stock badge count
│   ├── usePushNotifications.ts  # Expo push token registration
│   └── useUnreadAlerts.ts   # (legacy, replaced by useLowStockCount)
├── firebaseConfig.ts        # Firebase app init + db export
├── functions/
│   └── index.js             # Cloud Functions (ESM)
├── scripts/
│   └── seedDemo.js          # One-time seed script: creates waypoint_demo site + demo accounts
├── docs/
│   ├── SOP_v2.md
│   └── TECH_DOC_v2.md
├── app.json                 # Expo config (version, bundle IDs, plugins)
├── package.json
├── firestore.rules
└── firestore.indexes.json
```

---

## 4. Firebase Architecture

### 4.1 Services Used

| Service | Purpose |
|---|---|
| Firebase Auth | User sign-up, sign-in, password reset |
| Firestore | All application data, real-time listeners |
| Cloud Functions v2 | `notifyLowStock`, `deleteAuthUserOnRemoval` |
| Firebase Admin SDK | Used inside Cloud Functions for privileged writes |

### 4.2 Multi-Site Isolation

Every document in every collection (except `users` and `sites`) carries a `siteId` field. All Firestore queries and security rules enforce `siteId` equality, so each site's data is fully isolated at the query and rules layer.

The available sites are declared in `hooks/useSiteContext.ts` as the `SITES` array (used in the Admin panel site selector):

```ts
export const SITES = [
  { id: "ballys_tiverton",  label: "Tiverton" },
  { id: "ballys_lincoln",   label: "Lincoln" },
  { id: "waypoint_demo",    label: "Waypoint Demo" },
];
```

### 4.3 Demo Site (`waypoint_demo`)

A pre-seeded sandbox site exists in the live Firebase project for demonstration and onboarding purposes.

| Account | Email | Password | Role |
|---|---|---|---|
| Demo Admin | `demo.admin@waypoint.app` | `Demo1234!` | admin |
| Demo Staff | `demo.staff@waypoint.app` | `Demo1234!` | staff |

The site is seeded by `scripts/seedDemo.js` (run once from the `functions/` folder via `node ../scripts/seedDemo.js`). The script is idempotent — it checks for the existing `sites/waypoint_demo` document and exits early if already seeded.

**Seeded data summary:**

| Collection | Count |
|---|---|
| items | 15 |
| toners | 8 |
| printers | 4 |
| radios | 6 |
| radioParts | 6 |
| alerts | 13 |
| alertsLog | ~30 (spread over 30 days) |
| contacts | 3 |
| vendors | 3 |
| lincolnTechs | 1 |

> The demo site uses the same Firebase project and Firestore database as production sites. It is isolated only by `siteId`. Do not run the seed script more than once without first manually deleting the `waypoint_demo` site document.

---

## 5. Firestore Data Models

### 5.1 `users/{uid}`

```ts
{
  uid: string;
  email: string;
  role: "staff" | "admin";
  siteId: string;
  createdAt: Timestamp;
}
```

### 5.2 `sites/{siteId}`

```ts
{
  name: string;
  createdAt: Timestamp;
}
```

### 5.3 `items/{itemId}`

```ts
{
  name: string;
  currentQuantity: number;
  minQuantity: number;
  location?: string;
  barcode?: string;
  notes?: string;
  siteId: string;
  alertState?: "OK" | "LOW" | "OUT";
  lastAlertAt?: Timestamp;
  lastAlertState?: string | null;
  userDismissedAlert?: boolean;
  userDismissedAlertQuantity?: number | null;
  importedAt?: string;         // ISO date string, set on CSV import
}
```

> **Stable ID on import:** `${siteId}_${name}` lowercased, non-alphanumeric replaced with `_`, truncated to 100 chars. This ensures re-importing the same CSV updates existing records rather than creating duplicates.

### 5.4 `items/{itemId}/movements/{movementId}` *(append-only)*

```ts
{
  type: "disposal" | "adjustment";
  delta: number;                  // negative = stock removed, positive = stock added
  previousQuantity: number;
  newQuantity: number;
  by: string;                     // display name or email of the person making the change
  note: string;                   // free-text note (required for disposals, optional for adjustments)
  siteId: string;
  isLowStock: boolean;            // true if newQuantity <= minQuantity at time of write
  createdAt: Timestamp;
}
```

### 5.5 `toners/{tonerId}`

```ts
{
  model: string;
  color: "Black" | "Cyan" | "Magenta" | "Yellow" | "Other";
  quantity: number;
  minQuantity: number;
  printer?: string;
  partNumber?: string;
  supplier?: string;
  notes?: string;
  siteId: string;
  importedAt?: string;
  userDismissedAlert?: boolean;
  userDismissedAlertQuantity?: number | null;
}
```

> **Stable ID on import:** `${siteId}_${model}_${color}`

### 5.6 `printers/{printerId}`

```ts
{
  name: string;
  location?: string;
  ipAddress?: string;
  assetNumber?: string;
  serial?: string;
  tonerSeries?: string;
  barcode?: string;
  notes?: string;
  tonerId?: string;         // links to a toners/{tonerId} doc
  siteId: string;
  importedAt?: string;
}
```

### 5.7 `radios/{radioId}`

```ts
{
  model: string;
  serialNumber?: string;
  channel?: string;
  assignedTo?: string;
  location?: string;
  condition?: "Good" | "Fair" | "Poor" | "Out of Service";
  notes?: string;
  siteId: string;
  importedAt?: string;
}
```

> **Stable ID on import:** `${siteId}_${model}_${serialNumber || rowIndex}`

### 5.8 `radioParts/{partId}`

```ts
{
  name: string;
  compatibleModel?: string;
  quantity: number;
  minQuantity: number;
  location?: string;
  notes?: string;
  siteId: string;
  importedAt?: string;
  userDismissedAlert?: boolean;
  userDismissedAlertQuantity?: number | null;
}
```

> **Stable ID on import:** `${siteId}_${name}`

### 5.9 `contacts/{contactId}`

```ts
{
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  category?: "Vendor" | "IT Support" | "Maintenance" | "Facilities" | "Other";
  notes?: string;
  siteId: string;
  createdAt?: Timestamp;
  importedAt?: string;
}
```

> **Stable ID on import:** `${siteId}_${name}`

### 5.10 `disposals/{disposalId}`

```ts
{
  itemName: string;
  quantity: number;
  reason?: string;
  notes?: string;
  siteId: string;
  createdAt: Timestamp;
  uid: string;
}
```

### 5.11 `alerts/{alertId}`

Created exclusively by the `notifyLowStock` Cloud Function. Client can only **update** `readBy` and `updatedAt`.

```ts
{
  type: "low" | "out" | "restock";
  title: string;
  body: string;
  itemId: string;
  itemName: string;
  qty: number;
  min: number;
  siteId: string;
  readBy: Record<string, boolean>;   // { [uid]: true }
  createdAt: Timestamp;
}
```

### 5.12 `alertsLog/{logId}`

Append-only. Written by Cloud Function and also by client-side `logActivity()` calls.

```ts
{
  siteId: string;
  itemName: string;
  itemId: string;
  qty: number;
  min: number;
  prevState: "OK" | "LOW" | "OUT";
  nextState: "OK" | "LOW" | "OUT";
  status: string;
  action: "added" | "deducted" | "edited" | "deleted" | "linked" | "unlinked" | "disposed";
  itemType: "inventory" | "toner" | "radioPart" | "printer";
  createdAt: Timestamp;
  // Fields present on client-written movement entries (source: "movement"):
  by?: string;                    // display name or email of the person who made the change
  note?: string | null;           // optional note entered at time of adjustment
  source?: "movement";            // distinguishes client writes from Cloud Function writes
  // Fields present on Cloud Function entries only:
  dismissed?: boolean;
  userDismissed?: boolean;
  tokenCount?: number;
}
```

> **Required Firestore composite index:** `alertsLog` on `siteId ASC` + `createdAt DESC`. Defined in `firestore.indexes.json` and deployed via `firebase deploy --only firestore:indexes`.

### 5.13 `devicePushTokens/{tokenId}`

```ts
{
  token: string;           // Expo push token
  uid: string;
  siteId: string;
  enabled: boolean;
  createdAt: Timestamp;
  disabledAt?: Timestamp;
  disableReason?: string;
}
```

### 5.14 `vendors/{vendorId}`

```ts
{
  company: string;         // Primary display field — NOT `name`
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  siteId: string;
  createdAt?: Timestamp;
}
```

> **Important:** The vendor sort in `explore.tsx` uses `company` as the sort key. Always use `company` (not `name`) when writing vendor documents — a missing `company` field causes a TypeError in the sort and renders the Directory tab blank.

### 5.15 `lincolnTechs/{techId}`

```ts
{
  name: string;            // Company or tech name
  phone?: string;
  email?: string;
  notes?: string;
  siteId: string;
  createdAt?: Timestamp;
}
```

---

## 6. Firestore Security Rules

Rules are in `firestore.rules`. Key design decisions:

### Helper Functions

```js
isSignedIn()      // request.auth != null
myUid()           // request.auth.uid
myUserPath()      // path to /users/{myUid}
myUserExists()    // user doc exists in Firestore
myUserDoc()       // gets the user document (1 read)
mySiteId()        // myUserDoc().data.siteId
isAdmin()         // myUserDoc().data.role == "admin"
sameSite(data)    // data.siteId == mySiteId()
```

### Access Pattern Summary

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| users | self or admin | self (staff only) | self (no role/site change) or admin | admin |
| sites | any signed-in | admin | admin | admin |
| items | admin or sameSite | admin or sameSite create | admin or sameSite (no siteId change) | admin |
| items/movements | admin or parent sameSite | admin or sameSite | false | false |
| toners | admin or sameSite | admin or sameSite | admin or sameSite | admin or sameSite |
| printers | admin or sameSite | admin or sameSite | admin or sameSite | admin or sameSite |
| radios | admin or sameSite | admin or sameSite | admin or sameSite | admin or sameSite |
| radioParts | admin or sameSite | admin or sameSite | admin or sameSite | admin or sameSite |
| contacts | admin or sameSite | admin or sameSite | admin or sameSite | admin or sameSite |
| disposals | admin or sameSite | admin or sameSite | false | admin or sameSite |
| alerts | admin or sameSite | false (CF only) | readBy + updatedAt only | false |
| alertsLog | admin or sameSite | admin or sameSite | false | false |
| devicePushTokens | admin or own uid | admin or own uid+siteId | admin or own uid+siteId | admin |

---

## 7. Cloud Functions

Located in `functions/index.js` (ESM, Firebase Functions v2).

### 7.1 `notifyLowStock` / `notifyLowToner` / `notifyLowRadioPart`

Three separate functions share the same `handleLowStockUpdate` logic, each triggered by a different collection:

| Function | Trigger | qty field |
|---|---|---|
| `notifyLowStock` | `items/{itemId}` | `currentQuantity` |
| `notifyLowToner` | `toners/{tonerId}` | `quantity` |
| `notifyLowRadioPart` | `radioParts/{partId}` | `quantity` |

**Trigger:** one of the above

**Logic:**
1. Compares `before.currentQuantity` vs `after.currentQuantity`.
2. Computes `prevState` and `nextState` using `getState(qty, min)`:
   - `qty <= 0` → `"OUT"`
   - `qty <= min` → `"LOW"`
   - otherwise → `"OK"`
3. If state has not changed, exits early.
4. Applies a **10-minute cooldown** per state: if `lastAlertState === nextState` and less than 10 minutes have elapsed since `lastAlertAt`, skips the notification (but still updates `alertState`).
5. Updates the item doc with `alertState`, `lastAlertAt`, `lastAlertState`.
6. On restock (`nextState === "OK"`), clears `userDismissedAlert` and `userDismissedAlertQuantity`.
7. Writes to `alertsLog`.
8. Writes to `alerts` collection.
9. Fetches enabled Expo push tokens for the item's `siteId`.
10. Sends notifications via `https://exp.host/--/api/v2/push/send`.
11. On `DeviceNotRegistered` error from Expo, calls `disableToken()` to set `enabled: false` on the token doc.

### 7.2 `deleteAuthUserOnRemoval`

**Trigger:** `onDocumentDeleted("users/{uid}")`

**Logic:**
- Calls `admin.auth().deleteUser(uid)` to remove the Firebase Auth account when a user document is deleted from Firestore.
- Logs a warning (does not throw) if the auth user is already gone.

---

## 8. Authentication & User Roles

### 8.1 Auth Flow

- Email/password via Firebase Auth.
- On sign-up, a user document is created at `users/{uid}` with `role: "staff"`.
- The root `_layout.tsx` gates navigation based on auth state from `useUserProfile`.
- Admins can elevate users via the Admin tab, which updates `users/{uid}.role` to `"admin"`.

**Email domain restriction:** The sign-up screen splits the email field into a free-text username input and a domain dropdown. Allowed domains are declared in `app/signup.tsx` as the `EMAIL_DOMAINS` constant:

```ts
const EMAIL_DOMAINS = [
  "@ballystiverton.com",
  "@ballyslincoln.com",
];
```

To add a new domain, add it to this array. This is a client-side UI constraint only — it does not prevent API-level account creation with other domains.

### 8.2 useUserProfile Hook

Returns:
```ts
{
  uid: string | null;
  profile: { role: string; siteId: string; email: string } | null;
  siteId: string | null;
  loading: boolean;
}
```

Uses `onAuthStateChanged` + `onSnapshot` on the user document for real-time role/site updates.

---

## 9. Push Notifications

### 9.1 Registration Flow (`usePushNotifications` hook)

1. Requests `Notifications.requestPermissionsAsync()`.
2. Gets the Expo push token via `Notifications.getExpoPushTokenAsync({ projectId })`.
3. Writes/updates the token to `devicePushTokens/{token}` with `enabled: true`, `uid`, and `siteId`.
4. Sets up a foreground notification handler and a notification-tap response handler.

### 9.2 Delivery Flow

```
Item qty updated in Firestore
  → notifyLowStock Cloud Function triggers
    → Fetches enabled tokens for siteId
      → POST to exp.host push API
        → Expo delivers to device
```

### 9.3 Token Lifecycle

- Tokens are written on every app launch (upsert).
- Tokens with `DeviceNotRegistered` errors are automatically disabled by the Cloud Function.
- Admins can delete stale token documents from the Admin panel or directly in Firestore.

### 9.4 FCM V1 Credentials (Required for Android)

Expo Push uses Firebase Cloud Messaging V1 (HTTP v1 API) for Android delivery. A **Google Service Account JSON** must be uploaded to EAS credentials for push notifications to reach Android devices.

```bash
eas credentials --platform android
# → Google Service Account
# → Manage your Google Service Account Key for Push Notifications (FCM V1)
# → Set up a Google Service Account Key for Push Notifications (FCM V1)
```

The Service Account JSON is downloaded from:
**Firebase Console → Project Settings → Service Accounts → Generate new private key**

Use the `firebase-adminsdk-...` service account. This only needs to be done once per EAS project.

---

## 10. CSV Import / Export

### 10.1 Import Architecture

All imports follow the same pattern:

1. `DocumentPicker.getDocumentAsync()` — user picks a `.csv` file.
2. `FileSystem.readAsStringAsync(uri)` — reads the raw text.
3. `parseCSV(content)` — splits by newline, then auto-detects delimiter (`,`, `;`, or `|`).
4. Headers are normalized: lowercased, whitespace removed.
5. Column indices are resolved with a `col(aliases[])` helper that fuzzy-matches header names.
6. A `writeBatch` is built with `setDoc(..., { merge: true })` using stable deterministic document IDs (based on `siteId + name/model`).
7. Batch is committed; count is shown in an Alert.

**Upsert behavior:** Because document IDs are deterministic, re-importing the same file updates existing records without creating duplicates.

### 10.2 Export Architecture

1. Data array is formatted as CSV with quoted fields (double-quote escaping).
2. `FileSystem.writeAsStringAsync()` writes to the cache directory.
3. `Sharing.shareAsync()` opens the native share sheet.

---

## 11. Navigation & Routing

Uses **Expo Router** with file-based routing.

### Tab Order (bottom bar)
1. `index` — Inventory
2. `alerts` — Alerts (with low-stock badge)
3. `explore` — Directory
4. `disposal` — Disposal
5. `settings` — Settings
6. `admin` — Admin *(hidden for staff via `href: null`)*

### Internal Tab Modes (`index.tsx`)

The Inventory screen manages its own sub-navigation via `activeTab` state:

```ts
type TabMode = "inventory" | "toners" | "radios";
type TonerSubTab = "toners" | "printers";
type RadioSubTab = "radios" | "parts";
```

Rendered as a ternary chain:
```tsx
{activeTab === "inventory" ? <InventoryList>
  : activeTab === "toners" ? <TonersView>
  : activeTab === "radios" ? <RadiosView>
  : null}
```

### Detail Screens

Tapping an existing item, toner, or radio part card navigates to a dedicated full-screen detail route:

| Card type | Route |
|---|---|
| Inventory item | `app/item/[id].tsx` → `/item/:id` |
| Toner | `app/toners/[id].tsx` → `/toners/:id` |
| Radio part | `app/radiopart/[id].tsx` → `/radiopart/:id` |

Each detail screen has the same layout: a status banner (OK/LOW), a Stock section with two rows of `±1/5/10/25` adjustment buttons that write directly to Firestore and append an `alertsLog` entry, and a Details section with editable fields plus Save Changes and Delete buttons. The **Add New** flow for toners and radio parts still uses a `pageSheet` slide-up modal from `index.tsx`.

---

## 12. Key Hooks

### `useUserProfile`
- Subscribes to Firebase Auth and the user's Firestore document.
- Returns `{ uid, profile, siteId, loading }`.

### `useLowStockCount(siteId)`
- Three parallel real-time Firestore listeners on `items`, `toners`, and `radioParts`, all filtered by `siteId`.
- Returns the combined count of documents where qty ≤ `minQuantity` and the alert has not been dismissed (or quantity has changed since dismissal).
- Used to drive the badge on the Alerts tab icon.

### `usePushNotifications({ saveToFirestore, siteId })`
- Registers the device, saves token to Firestore.
- Returns the Expo push token string.

---

## 13. Theming

Defined in `constants/theme.ts` via `useAppTheme()`.

Returns a theme object with properties:
- `background`, `card`, `text`, `mutedText`, `border`, `tint`, `icon`, `primary`

> **`primary`** (`"#00b894"`) is the canonical action-button color used across all screens. Do **not** use `tint` as a button background — in dark mode `tint` resolves to `"#ffffff"`, producing an invisible white-on-white button.

Supports automatic light/dark mode switching via `useColorScheme()`.

Brand constants (app name, accent colors) live in `constants/branding.ts` as the `BRAND` object.

---

## 14. Deployment

### 14.1 OTA Update (JS-only changes)

```bash
eas update --branch production --message "describe what changed"
```

> OTA updates are delivered to devices running the **same `runtimeVersion`** as the update. Since `runtimeVersion.policy` is `"appVersion"`, any version bump requires a new native build before OTA updates reach users on that version.

### 14.2 New Native Build

Required when:
- The app version is bumped (e.g., 2.1.0 → 2.2.0)
- Native dependencies change (new Expo modules, etc.)
- `app.json` native config changes (permissions, bundle ID, etc.)

```bash
# Build for both platforms
eas build --platform all

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

### 14.3 Firestore Rules Deployment

```bash
firebase deploy --only firestore:rules
```

### 14.4 Cloud Functions Deployment

```bash
firebase deploy --only functions
```

### 14.5 Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

---

## 15. Environment & Config Files

| File | Purpose | In Git |
|---|---|---|
| `app.json` | Expo config, bundle IDs, version, plugins | Yes |
| `firebaseConfig.ts` | Firebase project config (API keys) | Yes (public config) |
| `GoogleService-Info.plist` | iOS Firebase config | No (gitignored) |
| `google-services.json` | Android Firebase config | No (gitignored) |
| `firestore.rules` | Firestore security rules | Yes |
| `firestore.indexes.json` | Composite index definitions | Yes |
| `functions/index.js` | Cloud Functions source | Yes |

---

## 16. Known Constraints & Notes

### Runtime Version & OTA
Because `runtimeVersion` uses the `appVersion` policy, bumping the version in `app.json` creates a new runtime channel. Users on older builds will not receive OTA updates until they install the new build from the store.

### Firestore Read Costs (`myUserDoc()`)
The `myUserDoc()` helper in security rules calls `get()` on the user document. This counts as an extra read per evaluated rule. With the current rule structure, some operations (e.g., write to `items`) trigger 1–2 additional reads. This is acceptable at current scale but should be monitored as the user base grows.

### `writeBatch` Limit
Firestore batches are limited to **500 operations**. All CSV importers chunk rows into batches of 499 and commit sequentially, so imports of any size are supported.

### `alertsLog` Composite Index
The `alertsLog` query filters by `siteId` and orders by `createdAt DESC`. This requires a composite index. Firestore will return an error with a console link to create it on first use.

The Analytics view in `alerts.tsx` uses a **second, independent** query on `alertsLog` with `limit(500)` and an optional `createdAt >= cutoff` date filter. This query uses the same composite index. Client-side aggregation (`useMemo`) computes top consumed items, most alerted items, and action-type breakdowns from the returned data.

### `firebaseConfig.ts` TypeScript Error (False Alarm)

```
Module '"firebase/auth"' has no exported member 'getReactNativePersistence'
```

This error is reported by `tsc --noEmit` but is **not a runtime bug**. `getReactNativePersistence` is a valid export used correctly; the Firebase SDK v12 type definitions simply lag behind the actual exports. This is the only remaining TypeScript error in the project. Do not attempt to suppress it with casts — it will resolve in a future Firebase SDK type-definition update.

### Expo Camera on Android
The `CameraView` component from `expo-camera` requires the `android.permission.CAMERA` permission, which is declared in `app.json`. On Android 13+, the permission dialog is shown once; if denied, the user must manually enable it in device settings.

### `expo-file-system` Legacy API
The import uses `expo-file-system/legacy`. If upgrading to a newer Expo SDK, verify whether the modern API (`expo-file-system`) has breaking changes for `readAsStringAsync` and `writeAsStringAsync`.

---

*Nexus v2.1.0 — Technical Documentation*
*Last updated: April 2026*
