# Nexus — Standard Operating Procedures
**Version 2.1.0 | Effective: March 2026 | Updated: April 2026**

> **Demo Environment Available** — See [Section 2.4](#24-demo-environment) to try Nexus with pre-loaded sample data before going live.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Inventory Management](#3-inventory-management)
4. [Toners & Printers](#4-toners--printers)
5. [Radios & Radio Parts](#5-radios--radio-parts)
6. [Barcode Scanner](#6-barcode-scanner)
7. [CSV Import & Export](#7-csv-import--export)
8. [Stock Alerts & Analytics](#8-stock-alerts)
9. [Asset Disposal](#9-asset-disposal)
10. [Vendor Directory](#10-vendor-directory)
11. [Settings](#11-settings)
12. [Admin Functions](#12-admin-functions)
13. [Roles & Permissions](#13-roles--permissions)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

**Nexus** is a site-scoped operations management app for tracking inventory, toners, printers, radios, contacts, and asset disposals. All data is stored in real time to the cloud, meaning every device on your site sees the same up-to-date information instantly.

**Key principles:**
- All data is scoped to your assigned site — staff at different sites cannot see each other's data.
- Changes are live — no refresh needed.
- Admins have full access across the system; staff have write access within their own site.

---

## 2. Getting Started

### 2.1 Creating an Account

1. Open Nexus and tap **Sign Up**.
2. Enter your **full name**.
3. Enter the **username part** of your work email (e.g. `john.doe`) and select your **email domain** from the dropdown (`@ballystiverton.com` or `@ballyslincoln.com`).
4. Choose a password (minimum 6 characters) and confirm it.
5. Select your **site** (Tiverton or Lincoln).
6. Tap **Create Account**.
7. Your account will be created with the **Staff** role.

> **Note:** Only approved company email domains are accepted at sign-up. If you require Admin privileges, contact one of your site administrators to have your account elevated.

### 2.2 Signing In

1. Open the app and enter your work email and password.
2. Tap **Sign In**.
3. If you forget your password, tap **Forgot Password** and follow the instructions sent to your email.

### 2.3 First-Time Setup (Admin)

After your site is created by an admin:
1. Sign in to the app.
2. Navigate to the **Admin** tab.
3. Confirm your site name appears correctly in Site Management.
4. Begin adding inventory, toners, printers, and contacts.

### 2.4 Demo Environment

The **Waypoint Demo** site is a fully pre-loaded sandbox environment for evaluating Nexus before going live. It contains realistic sample data across all modules — inventory, toners, printers, radios, contacts, vendors, and a 30-day activity log.

**Demo credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | `demo.admin@waypoint.app` | `Demo1234!` |
| Staff | `demo.staff@waypoint.app` | `Demo1234!` |

**What's included in the demo:**
- 15 inventory items across multiple locations (some low/out of stock)
- 8 toners for 4 printer models (including out-of-stock scenarios)
- 4 printers with IP addresses and asset numbers
- 6 radios (Motorola DP4400, Kenwood TK-3401)
- 6 radio parts with low-stock alerts
- 13 active stock alerts (inventory, toner, and radio part alerts)
- ~30 activity log entries spread over 30 days (populated Analytics view)
- 3 internal contacts + 3 vendors + 1 Tech Contact in the Directory

> **Note:** The demo site is shared. Any changes made by demo users will be visible to anyone else using the demo credentials. The demo site is intended for exploration only — do not store real operational data under these accounts.

---

## 3. Inventory Management

The **Inventory** tab is the home screen of Nexus. It shows all tracked items at your site.

### 3.1 Viewing Inventory

- Items are listed by name (A–Z) by default.
- Each card shows:
  - **Item name**
  - **Current quantity** (red if at or below minimum, green if healthy)
  - **Location** (if set)
  - **Notes** (if set)
  - **LOW / OUT** badge when stock is critical
- Use the **search bar** at the top to filter by name.
- Tap the **LOW** toggle button to show only low-stock items.
- Tap the **sort icon** to switch between Name and Stock sorting.

### 3.2 Adding an Item

1. Tap the **+** button in the top-right area of the Inventory tab.
2. Fill in the following fields:
   - **Name** (required)
   - **Current Quantity** — how many are on hand right now
   - **Minimum Quantity** — the threshold that triggers a low-stock alert
   - **Location** — shelf, room, or area where the item lives
   - **Barcode** — optional, used for scanner lookup
   - **Notes** — any additional info
3. Tap **Add Item** to save.

### 3.3 Editing an Item

1. Tap the **clock/history icon** on any inventory card to open the edit panel.
2. Update any fields as needed.
3. Tap **Save Changes**.

> The item's stock status (OK / LOW / OUT) updates automatically based on the quantity and minimum you set.

### 3.4 Adjusting Quantity

Use the **+ / −** buttons directly on the inventory card to increment or decrement quantity without opening the edit modal.

- A **5-second undo banner** appears at the bottom after any adjustment — tap **Undo** to reverse it.

### 3.5 Deleting an Item

1. Open the edit panel by tapping the clock icon.
2. Scroll down and tap **Delete Item**.
3. Confirm the deletion in the prompt.

> Deletions are permanent. Use disposal instead if the item is being retired from service.

---

## 4. Toners & Printers

Access the **Toners** subtab from inside the Inventory tab by tapping the **Toners** button in the tab row.

### 4.1 Toners Subtab

#### Adding a Toner
1. Tap **+** in the Toners list.
2. Fill in: Model, Color, Quantity, Minimum Quantity, Compatible Printer, Notes.
3. Tap **Add Toner**.

#### Editing a Toner
- Tap any toner card to open the toner detail page, where you can adjust stock and edit all fields.

#### Deleting a Toner
- Tap the **trash icon** on the toner card. A 5-second undo banner appears.

### 4.2 Printers Subtab

1. Tap **Printers** in the toner sub-tab row.
2. Each printer card shows name, location, IP address, and the live stock count of its linked toner (color-coded: green/orange/red).

#### Adding a Printer
1. Tap **+** in the Printers list.
2. Fill in: Name, Location, IP Address, Asset Number, Serial, Toner Series, Barcode, Notes.
3. Tap **Add Printer**.

#### Linking a Toner to a Printer
1. Tap the **link icon** on a printer card.
2. Search for and select the toner model to associate.
3. The printer card will now show a live stock badge for that toner.

---

## 5. Radios & Radio Parts

Access the **Radios** subtab from inside the Inventory tab by tapping the **Radios** button in the tab row.

### 5.1 Radio Parts Subtab

The **Parts** subtab opens by default. Tracks spare parts and accessories (batteries, antennas, chargers, etc.) with quantity and minimum threshold tracking.

#### Adding a Radio Part
1. Tap **+** and fill in: Name, Compatible Model, Quantity, Minimum Quantity, Location, Notes.
2. Tap **Add Part**.

#### Editing a Radio Part
- Tap any radio part card to open the part detail page, where you can adjust stock and edit all fields.

> Radio parts trigger low-stock alerts and appear in the Alerts tab badge when quantity falls at or below the minimum.

### 5.2 Radios Subtab

Tap **Radios** in the sub-tab row to switch to the radio units list. Tracks individual radio units assigned across your site.

#### Adding a Radio
1. Tap **+** in the Radios list.
2. Fill in:
   - **Model** (required)
   - **Serial Number**
   - **Channel**
   - **Assigned To** — person or role the radio is issued to
   - **Location** — where it's stored or deployed
   - **Condition** — Good / Fair / Poor / Out of Service
   - **Notes**
3. Tap **Add Radio**.

#### Condition Color Codes
| Condition | Color |
|---|---|
| Good | Green |
| Fair | Amber |
| Poor | Red |
| Out of Service | Gray |

---

## 6. Barcode Scanner

The barcode scanner is built into the Inventory tab — no separate tab needed.

### 6.1 Using the Scanner

1. In the Inventory tab, tap the **barcode icon** button (next to the + button).
2. Grant camera permission if prompted (one-time only).
3. Point the camera at a barcode or QR code.
4. The app searches for a matching item or toner:
   - **Match found** → the item's detail screen opens automatically.
   - **No match** → an alert informs you the barcode was not found.
5. Tap **Scan Again** to scan another item, or **Close** to dismiss.

> The scanner has a built-in duplicate-prevention delay — the same barcode scanned within 2 seconds will not trigger a second lookup.

---

## 7. CSV Import & Export

All major data sections support CSV import and export, making bulk setup and data backup easy.

### 7.1 Supported Sections
| Section | Import | Export |
|---|---|---|
| Inventory Items | Yes | — |
| Toners | Yes | — |
| Printers | Yes | — |
| Radios | Yes | Yes |
| Radio Parts | Yes | Yes |
| Contacts (Directory) | Yes | Yes |
| Activity Log (Alerts tab) | — | Yes |

### 7.2 Importing Data

1. Navigate to the relevant subtab (e.g., Radios, Parts, Directory).
2. Tap **Import CSV**.
3. Select the CSV file from your device (Google Drive, Files app, email attachment, etc.).
4. The app processes the file and shows a confirmation with the number of records imported.

> If a record with the same name already exists, it will be **updated** rather than duplicated (upsert behavior).

#### Column names are flexible — the importer recognizes common variations:

**Inventory Items:** `Name / Item / Description`, `Qty / Quantity / Stock`, `Min / Minimum`, `Location / Loc`, `Barcode / SKU`, `Notes`

**Toners:** `Model / Name / Toner`, `Color / Colour / Type`, `Qty / Quantity`, `Min / Minimum`, `Printer / Compatible`, `Notes`

**Printers:** `Name`, `Location`, `IP / IPAddress`, `Asset / AssetNumber`, `Serial`, `TonerSeries`, `Barcode`, `Notes`

**Radios:** `Model / Name / Radio`, `Serial / SerialNumber / SN`, `Channel / Chan`, `Assigned / AssignedTo / Person`, `Location`, `Condition / Status`, `Notes`

**Radio Parts:** `Name / Part / Item`, `Compatible / Model / CompatibleModel`, `Qty / Quantity`, `Min / Minimum / MinQty`, `Location`, `Notes`

**Contacts:** `Name / Contact / FullName`, `Company / Organization`, `Phone / Tel / Mobile`, `Email / Mail`, `Category / Type`, `Notes`

### 7.3 Exporting Data

1. Navigate to the relevant section.
2. Tap **Export CSV**.
3. The native share sheet opens — save to Files, send via email, or share to another app.

---

## 8. Stock Alerts & Analytics

The **Alerts** tab has three views — **Alerts**, **Activity**, and **Analytics** — selectable via the buttons at the top of the screen.

### 8.1 Alert Types

Alerts are generated for **inventory items, toners, and radio parts**.

| Type | Meaning |
|---|---|
| **Out of Stock** | Quantity dropped to 0 |
| **Low Stock** | Quantity is at or below the set minimum |
| **Restocked** | Item was replenished back above the minimum |

### 8.2 Reading Alerts

- Each alert card shows: item name, item type (Toner or Radio Part badge where applicable), status, current and minimum quantity, and timestamp.
- Alerts are color-coded by severity: red for Out, orange for Critical, amber for Low, green for restock.

### 8.3 Dismissing an Alert

Tap **Dismiss** on an alert card to hide it. The alert will reappear (and the tab badge will re-increment) if the quantity changes again after dismissal.

### 8.4 Filtering

Use the filter chips at the top of the Alerts tab:
- **All** — shows everything
- **Low** — low stock alerts only
- **Out** — out-of-stock alerts only
- **Restock** — restock confirmations only

### 8.5 Activity Log

Tap the **Activity** button in the view selector to see a full chronological history of all changes across inventory items, toners, and radio parts at your site. Filter by date range (Today / 7 Days / 30 Days / All) and by action type (Added, Edited, Deleted, Deducted, etc.).

- Tap **Export CSV** in the Activity Log to save a full log to your device.

### 8.6 Analytics

Tap the **Analytics** button in the view selector to see a usage summary for your site.

1. Use the period selector to choose a time range: **7 Days**, **30 Days**, or **All**.
2. The view shows:
   - **Activity Breakdown** — count of each action type (Added, Deducted, Edited, Deleted, etc.) for the selected period.
   - **Top Consumed** — the 5 items with the highest total deduction volume, shown with progress bars.
   - **Most Alerted** — the 5 items that most frequently triggered Low, Critical, or Out of Stock alerts.

> Analytics data is based on up to 500 activity log entries for the selected time period.

### 8.7 Push Notifications

Nexus sends push notifications to your device when:
- An item goes **out of stock**
- An item drops to **low stock**
- An item is **restocked**

Notifications are sent to all devices registered to your site. Enable them in your device settings if prompted.

---

## 9. Asset Disposal

The **Disposal** tab tracks items that are being retired from service.

### 9.1 Creating a Disposal Record

1. Tap the **Disposal** tab.
2. Tap **+** to create a new disposal record.
3. Fill in: Item name, quantity being disposed, reason, and any notes.
4. Tap **Submit Disposal**.

> Submitting a disposal **subtracts** the disposed quantity from the item's current stock in Inventory — you do not need to manually adjust inventory separately.
> If only some units are being disposed (e.g., 2 of 5 chairs), the remaining units stay in inventory.

### 9.2 Viewing Disposal History

All disposal records remain visible in the Disposal tab for auditing purposes. Admins can delete records if needed.

---

## 10. Vendor Directory

The **Directory** tab stores contact information for vendors, IT support, maintenance teams, and other key contacts.

### 10.1 Adding a Contact

1. Tap **+** in the Directory tab.
2. Fill in:
   - **Name** (required)
   - **Company / Organization**
   - **Phone**
   - **Email**
   - **Category** — Vendor / IT Support / Maintenance / Facilities / Other
   - **Notes**
3. Tap **Add Contact**.

### 10.2 Using the Directory

- **Search** by name, company, phone, or email using the search bar.
- **Filter by category** using the chips below the search bar.
- Tap the **phone icon** on a contact card to dial directly.
- Tap the **mail icon** to open a pre-addressed email.
- Tap the contact name to edit the record.
- Tap the **trash icon** to delete a contact (confirmation required).

---

## 11. Settings

The **Settings** tab allows each user to manage their personal app preferences.

- **Dark / Light Mode** — toggle the app theme.
- **Notification preferences** — manage push notification settings (sound, vibration).
- **Device Registration** — register this device to receive push notifications. Enter a label (e.g., your name or "Front Desk") and tap **Save Device**. Use **Reset Device Token** when changing phones or if notifications stop working.
- **Account information** — view your email, site, and role.
- **Sign Out** — logs you out of the app.

---

## 12. Admin Functions

The **Admin** tab is only visible to users with the Admin role.

### 12.1 User Management

- View all users registered to your site.
- **Elevate a user** from Staff to Admin.
- **Remove a user** — deletes both their app profile and their login credentials. This action is permanent.

### 12.2 Site Management

- View and edit site details.
- Assign users to sites.

### 12.3 Best Practices for Admins

- When an employee leaves, remove their account from the Admin tab promptly.
- Periodically review the Activity Log for any unusual patterns.
- Use CSV export to back up inventory data before making bulk changes.
- Only grant Admin access to users who need full system access.

---

## 13. Roles & Permissions

| Action | Staff | Admin |
|---|---|---|
| View own site's inventory | Yes | Yes |
| Add / edit inventory items | Yes | Yes |
| Delete inventory items | No | Yes |
| View own site's alerts | Yes | Yes |
| Mark alerts as read | Yes | Yes |
| Add / edit disposals | Yes | Yes |
| Delete disposals | Yes | Yes |
| View / add / edit contacts | Yes | Yes |
| Delete contacts | Yes | Yes |
| View / add / edit radios | Yes | Yes |
| Add / edit toners & printers | Yes | Yes |
| View other sites' data | No | Yes |
| Manage users | No | Yes |
| Delete items & records | No | Yes |

---

## 14. Troubleshooting

### I can't log in
- Confirm you are using your work email address.
- Use **Forgot Password** to reset your credentials.
- Contact an admin if your account has been removed.

### I can see my site's data but it looks empty
- Check that your user profile has a site assigned (visible in Settings).
- Contact an admin to confirm your `siteId` is set correctly.

### The barcode scanner doesn't work
- Check that camera permission is granted for Nexus in your device Settings > Apps > Nexus > Permissions.
- Ensure the barcode exists in inventory with the matching barcode field filled in.

### I'm not receiving push notifications
- Check that notifications are enabled for Nexus in your device settings.
- Go to **Settings → Reset Device Token**, fully close and reopen the app, then re-enter your device label and tap **Save Device**.
- Contact your admin to confirm your device token is enabled in the system.

### My CSV import failed
- Ensure the file is saved as `.csv` (comma, semicolon, or pipe-delimited).
- Confirm a **Name** (or equivalent) column is present — this is required for all imports.
- Check for blank rows or special characters in the file.
- The file must contain at least one header row and one data row.

### Changes I made aren't showing up for other users
- Data syncs in real time via cloud — if another user isn't seeing your changes, ask them to check their internet connection.
- If the issue persists, have them sign out and back in.

---

*Nexus v2.1.0 — For support, contact your site administrator.*  
*SOP last updated: April 2026*
