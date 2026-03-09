# Control Deck (HouseOps)

Control Deck is a multi-site inventory and asset management app focused on printers, toners, and general IT assets. It helps teams track stock levels, receive alerts, and audit disposals across locations.

---

## Features

### ✅ Core Inventory & Logic
- **Multi-Site Architecture**  
  - All data is scoped by `siteId`.  
  - Users only see items belonging to their assigned site.
- **Inventory CRUD**  
  - Add, update, view items in real time.
- **Smart Stock States**  
  - Items track stock state: **OK**, **LOW**, **OUT**.
- **Toner-to-Printer Linking**  
  - Each printer can be linked to a specific toner SKU.
  - Linking is done via a “LINK TONER” flow on the Printers tab.
- **Live Toner Badges**  
  - `TonerStockBadge` shows current toner status right in the printer list.
- **Asset Disposal Tracking**  
  - Dedicated **Asset Disposal** screen.
  - Records include reason (Broken, Obsolete, Lost, Damaged, Other), quantity, who disposed it, and when.
  - Supports CSV **Import** and **Export** for audit and reporting.

---

### 📷 Scanning & Hardware
- **Barcode Scanner Integration**  
  - Fast barcode scanning using device camera.
  - Scanner automatically pauses when not active to save battery.
- **Scan → Lookup**  
  - Scanning known barcodes jumps directly to item details.
- **Scan → Add Flow**  
  - Unknown barcodes open a prefilled “Add Item” form.
- **Camera Lifecycle Safety**  
  - Camera is properly mounted/unmounted to avoid background usage issues.

---

### 🔔 Alerts & Notifications
- **Live Alerts Tab**  
  - Dedicated Alerts screen showing LOW/OUT items in real time.
- **Push Notifications**  
  - Expo push notifications for:
    - LOW stock
    - OUT of stock
    - RESTOCK events
- **Cloud Functions for Automation**  
  - Firebase Cloud Functions evaluate stock state changes and trigger alerts.
- **Device Registration**  
  - Expo push tokens stored per user/device for targeted notifications.

---

### 🔐 Security & Roles

- **Firestore Security Rules**
  - All reads/writes scoped by `siteId`.
  - Staff can only access data for their own site.
  - Append-only logs for certain collections (e.g. `movements`, `alertsLog`).
- **Roles**
  - **Admin**
    - Full access to sites, items, printers, toners, disposals.
    - Can manage user profiles (including deleting users).
    - Can export/import disposal logs.
  - **Staff**
    - Restricted to their own `siteId`.
    - Can view/manage inventory within their site according to rules.

- **Admin Delete User (Backend)**
  - Cloud Function `deleteUserAsAdmin`:
    - Ensures caller is authenticated and is an Admin.
    - Deletes the user’s Firestore profile (`/users/{uid}`).
    - Deletes the corresponding Firebase Auth user.
  - Exposed to the app via a callable function that Admin-only UI calls.

---

## Current Status

### What’s Done ✅
- Inventory CRUD with real-time Firestore sync.
- Site-scoped inventory, printers, and toners.
- Stock state tracking (OK / LOW / OUT).
- Toner-to-printer linking + live toner badges in the Printers tab.
- Alerts tab with live low-stock/critical view.
- Push notifications (LOW / OUT / RESTOCK) via Firebase Cloud Functions.
- Expo push token registration and device management.
- Barcode scanner with safe camera lifecycle.
- Asset Disposal screen with:
  - site-based filter
  - CSV Import (append/update by stable ID)
  - CSV Export (for audit / reporting)
- Android builds tested.
- iOS tested via Expo Go.
- Firestore rules hardened for:
  - multi-site access
  - append-only logs
  - admin-only destructive actions (items, alertsLog, user delete, etc.).
- EAS Update configured for OTA JS updates.

---

### In Progress 🛠️
- Additional UI polish on:
  - Alerts history screens
  - Asset Disposal and Inventory cards
  - Button colors and contrast for light/dark themes.
- IP Quick Actions:
  - Tapping a printer’s IP address will open the printer’s web UI.
- Undo workflows:
  - Smooth, animated “Undo” banners for destructive actions (delete/deduct).

---

### Next Up 🔜
- **Audit Log Screen**
  - Read-only timeline of inventory changes and important events.
- **Import Preview**
  - Staging area for CSV imports with validation before commit.
- **Scanner UX Enhancements**
  - Better “Add new item” prefill and error handling for unknown codes.
- **Production iOS Build**
  - EAS configuration finalized for App Store deployment.
- **Basic Analytics**
  - Site-level statistics for consumption rates and frequent alerts.

---

## Tech Stack

- **Frontend**: React Native with Expo (SDK 54)
- **Backend**: Firebase
  - Firestore
  - Firebase Auth
  - Cloud Functions
- **Push & Updates**
  - Expo Push Notifications
  - EAS Build
  - EAS Update (OTA JS updates)

---

## Development

### Prerequisites
- Node.js (LTS)
- Yarn or npm
- Expo CLI
- Firebase project configured with:
  - Firestore
  - Auth
  - Functions
  - Push notifications (Expo)

### Basic Commands

```bash
# Install dependencies
yarn install
# or
npm install

# Run in development
npx expo start

# Android dev build
npx eas build --platform android --profile preview

# Push an OTA JS update to preview channel
npx eas update --branch preview --message "Some change description"