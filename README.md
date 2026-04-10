# Nexus

A React Native / Expo mobile app for multi-site operations management. Built for organizations that need to track inventory, toners, printers, radios, asset disposals, and contacts — all in real time, across multiple locations.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native via Expo SDK 54 |
| Router | Expo Router (file-based) |
| Language | TypeScript |
| Database | Google Firestore (real-time listeners) |
| Auth | Firebase Auth (email/password) |
| Cloud Functions | Firebase Functions v2 (Node.js ESM) |
| Push Notifications | Expo Push Notification Service |
| Build / OTA | EAS Build + EAS Update |

---

## Features

- **Inventory tracking** — items with quantity thresholds, barcode scan, CSV import/export
- **Toners & Printers** — toner stock with printer linking and color-coded status
- **Radios & Radio Parts** — radio unit roster + spare parts tracking with low-stock alerts
- **Stock Alerts** — real-time alerts (Low / Out / Restock) with push notifications
- **Activity Log** — chronological history of all stock changes, CSV export
- **Analytics** — 7-day / 30-day / all-time breakdown with top consumed and most alerted charts
- **Asset Disposal** — retirement records that auto-deduct from inventory
- **Vendor Directory** — contacts, vendors, and tech contacts with tap-to-call/email
- **Multi-site isolation** — all data scoped by `siteId`; staff only see their own site
- **Admin panel** — user management, role elevation, site management

---

## Demo Environment

A fully pre-loaded sandbox site is available for evaluating the app without affecting live data.

| Role | Email | Password |
|---|---|---|
| Admin | `demo.admin@waypoint.app` | `Demo1234!` |
| Staff | `demo.staff@waypoint.app` | `Demo1234!` |

The demo site (**Waypoint Demo**) includes 15 inventory items, 8 toners, 4 printers, 6 radios, 6 radio parts, 13 active alerts, ~30 days of activity log history, and a populated directory.

---

## Documentation

| Document | Description |
|---|---|
| [docs/SOP_v2.md](docs/SOP_v2.md) | User-facing standard operating procedures |
| [docs/TECH_DOC_v2.md](docs/TECH_DOC_v2.md) | Technical architecture documentation |

---

## Development

### Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- EAS CLI (`npm install -g eas-cli`)
- Firebase CLI (`npm install -g firebase-tools`)

### Install dependencies

```bash
npm install
cd functions && npm install
```

### Start the dev server

```bash
npx expo start
```

---

## Deployment

### OTA update (JS-only changes)

```bash
eas update --branch production --message "describe what changed"
```

### New native build

```bash
eas build --platform all
```

### Deploy Firestore rules / indexes / functions

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
```

---

## Seed the Demo Site

The demo site is seeded once using `scripts/seedDemo.js`. It requires a Firebase service account key:

1. Go to **Firebase Console → Project Settings → Service Accounts**
2. Click **Generate new private key** and save as `serviceAccount.json` in the project root (gitignored — never commit it)
3. Run from the `functions/` folder:

```bash
cd functions
node ../scripts/seedDemo.js
```

The script is idempotent — it exits early if `waypoint_demo` already exists.

---

## Bundle IDs

- **iOS:** `com.houseops.nexus`
- **Android:** `com.houseops.nexus`
- **EAS Project:** `98f68256-6eef-4add-b46a-42f4564a8cb7`
