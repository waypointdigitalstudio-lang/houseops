# ControlDeck — Inventory & Asset Management

A React Native / Expo mobile app for managing inventory, tracking stock levels, and logging asset disposals across multiple sites. Built for internal operations teams at Bally's Tiverton and Bally's Lincoln.

---

## Features

### Inventory
- View all inventory items with real-time Firestore sync
- Dashboard summary cards — total items, low stock count, out-of-stock count, toner count
- Search by name and filter by stock status (Low Stock toggle)
- Sort A–Z or by stock level
- Add items manually or import from CSV
- Hide items from the main list without deleting them
- Tap the clock icon on any item to view its full alert history

### Alerts (Stock Alerts)
- Real-time feed of low-stock and out-of-stock items
- Badge on the tab icon shows live count of items needing attention
- Filter by alert state (OUT / CRITICAL / LOW)
- Generate a Reorder List as a CSV export, sorted by severity

### Scan & Update
- Barcode scanner to quickly look up and update item quantities

### Asset Disposal
- Log disposed assets with reason, quantity, notes, and who disposed them
- Import disposal records from CSV
- Export disposal records to CSV for audit/reporting
- After export, prompted to delete all records in one tap (auto-clear)
- Standalone "Delete All" button for manual clearing

### Item History Screen
- Tap the clock icon on any inventory item to open its detail screen
- Shows the last 50 alert history entries from Firestore (`alertsLog`)
- Displays action type, state transitions (e.g. OK → LOW), quantity, and timestamp

### Settings
- Full inventory CSV export
- Theme and app preferences

### Admin (admin role only)
- View all users across both sites
- Reassign a user to a different site
- Optionally update the user's push notification tokens to match the new site
- Change user role (staff / admin)
- Send password reset email
- Delete user profile and associated device tokens

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo (Expo Router) |
| Backend | Firebase Firestore (real-time `onSnapshot`) |
| Auth | Firebase Auth |
| Push Notifications | Expo Push Notifications |
| File Export | Expo FileSystem + Expo Sharing |
| OTA Updates | EAS Update |

---

## Project Structure

```
app/
  (tabs)/
    index.tsx       — Inventory list
    explore.tsx     — Barcode scanner
    alerts.tsx      — Stock alerts + Reorder List export
    disposal.tsx    — Asset disposal log
    settings.tsx    — Settings + full inventory export
    admin.tsx       — Admin user management
  item/
    [id].tsx        — Item detail + alert history screen
hooks/
  useUserProfile.ts     — Current user profile + siteId
  useSiteContext.ts     — Active site (staff = own site, admin = switchable)
  useLowStockCount.ts   — Live badge count for Alerts tab
  useLowStockItems.ts   — Low stock item list
  usePushNotifications.ts
constants/
  branding.ts       — App name, colors (BRAND)
  theme.ts          — Light/dark theme tokens
```

---

## Sites

| Site ID | Label |
|---|---|
| `ballys_tiverton` | Tiverton |
| `ballys_lincoln` | Lincoln |

Each user is assigned to one site. All Firestore queries are scoped by `siteId`.

---

## Firestore Indexes Required

The following composite indexes must exist in Firestore for queries to work:

| Collection | Fields |
|---|---|
| `alertsLog` | `siteId` ↑ + `createdAt` ↓ |
| `alertsLog` | `itemId` ↑ + `createdAt` ↓ |
| `disposals` | `siteId` ↑ + `disposedAt` ↓ |

---

## Development

```bash
npm install
npx expo start
```

## OTA Deploy

```bash
eas update --branch production --message "your message here"
```
