# Control Deck

**Version 2.0.0**
A mobile operations management app built with React Native / Expo and Firebase.

Control Deck helps site teams track inventory, toners, printers, radios, asset disposals, and vendor contacts — all synced in real time across every device on a site.

---

## Features

- **Inventory** — Track items with quantity, minimum thresholds, location, and barcode. Low/out-of-stock items are flagged automatically with +/− quick-adjust buttons and a 5-second undo.
- **Toners & Printers** — Manage toner stock by model and color. Link toners to printers for live stock badges on each printer card.
- **Radios & Radio Parts** — Track radio units by serial number, channel, assigned user, and condition (Good / Fair / Poor / Out of Service). Manage spare parts with quantity tracking.
- **Barcode Scanner** — Built into the Inventory tab. Tap to scan any barcode; auto-navigates to the matching item or toner.
- **Stock Alerts** — Real-time push notifications and an in-app alert feed when items go low, out, or are restocked. Badge on the tab icon shows live low-stock count.
- **Activity Log** — Full chronological history of every inventory change at your site, exportable as CSV.
- **Asset Disposal** — Log disposals with quantity and reason; automatically subtracts from inventory stock. Partial disposals leave the remainder in inventory.
- **Vendor Directory** — Store and search vendor, IT, maintenance, and facilities contacts. Tap the phone icon to dial or the mail icon to email directly from the app.
- **CSV Import / Export** — Bulk import any section from a spreadsheet (flexible column name matching). Export to CSV via the native share sheet.
- **Multi-site** — All data is scoped by `siteId`. Staff only see their own site; admins have full access.
- **Admin Panel** — Manage users, elevate roles, and remove accounts. Removing a user deletes both their Firestore profile and their Firebase Auth credentials.

---

## Tech Stack

| | |
|---|---|
| Framework | React Native + Expo SDK |
| Router | Expo Router (file-based) |
| Language | TypeScript |
| Database | Google Firestore (real-time `onSnapshot`) |
| Auth | Firebase Authentication (email/password) |
| Cloud Functions | Firebase Functions v2 (Node.js ESM) |
| Push Notifications | Expo Push Notification Service |
| File I/O | expo-file-system + expo-sharing + expo-document-picker |
| Camera | expo-camera (CameraView) |
| Build / OTA | EAS Build + EAS Update |

---

## Project Structure

```
app/
  (auth)/          # Login & sign-up screens
  (tabs)/
    _layout.tsx    # Tab bar config, low-stock badge, push token registration
    index.tsx      # Inventory / Toners / Printers / Radios / Scanner
    alerts.tsx     # Stock alerts + activity log
    explore.tsx    # Vendor & contact directory
    disposal.tsx   # Asset disposal records
    settings.tsx   # User settings & sign-out
    admin.tsx      # Admin: user & site management
constants/
  branding.ts      # BRAND constant (app name, accent colors)
  theme.ts         # useAppTheme hook (light/dark tokens)
hooks/
  useUserProfile.ts       # Auth state + Firestore user doc
  useLowStockCount.ts     # Real-time low-stock badge count
  usePushNotifications.ts # Expo push token registration
functions/
  index.js         # Cloud Functions: notifyLowStock, deleteAuthUserOnRemoval
docs/
  SOP_v2.md        # End-user Standard Operating Procedures
  TECH_DOC_v2.md   # Technical reference
firestore.rules    # Firestore security rules
firestore.indexes.json
```

---

## Tab Order

| Position | Tab | Description |
|---|---|---|
| 1 | Inventory | Items, toners, printers, radios, scanner |
| 2 | Alerts | Stock alerts + activity log |
| 3 | Directory | Vendor & contact directory |
| 4 | Disposal | Asset disposal records |
| 5 | Settings | User preferences & sign-out |
| 6 | Admin | Admin only — user & site management |

---

## Roles

| Action | Staff | Admin |
|---|---|---|
| View & edit own site's data | Yes | Yes |
| Delete items | No | Yes |
| Manage users | No | Yes |
| Access other sites' data | No | Yes |

New accounts are created as **Staff** by default. An admin must elevate the role via the Admin tab.

> Use your **work email** when signing up. Contact an admin if you need elevated access.

---

## Getting Started

### Prerequisites

- Node.js 18+
- EAS CLI — `npm install -g eas-cli`
- Firebase CLI — `npm install -g firebase-tools`

### Install

```bash
npm install
cd functions && npm install && cd ..
```

### Run locally

```bash
npx expo start
```

---

## Deployment

### OTA update (JS-only changes)
```bash
eas update --branch production --message "describe change"
```

> OTA updates only reach devices on the same `runtimeVersion`. Since the policy is `appVersion`, bumping the version in `app.json` requires a new native build before OTA updates reach users on that version.

### New native build
```bash
eas build --platform all
eas submit --platform ios
eas submit --platform android
```

### Firestore rules
```bash
firebase deploy --only firestore:rules
```

### Cloud Functions
```bash
firebase deploy --only functions
```

---

## Firestore Indexes Required

| Collection | Fields |
|---|---|
| `alertsLog` | `siteId` ASC + `createdAt` DESC |

Firestore will throw an error with a direct creation link on first use if the index is missing.

---

## Known Constraints

- **CSV batch limit:** Firestore batches cap at 500 operations — CSV files with 500+ rows will fail without chunking.
- **Runtime version:** Bumping `app.json` version creates a new OTA channel. Existing users need the new store build before receiving future OTA updates.

---

## Documentation

- [`docs/SOP_v2.md`](docs/SOP_v2.md) — End-user operating procedures
- [`docs/TECH_DOC_v2.md`](docs/TECH_DOC_v2.md) — Technical reference (data models, security rules, Cloud Functions, deployment)
