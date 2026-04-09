/**
 * Waypoint Demo — Firestore Seed Script
 *
 * Creates the "waypoint_demo" site with realistic data and two demo accounts.
 *
 * SETUP:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" and save as serviceAccount.json
 *      in the project root (it is .gitignored — do NOT commit it)
 *   3. From the project root, run:
 *        node scripts/seedDemo.js
 *
 * DEMO ACCOUNTS:
 *   demo.admin@waypoint.app  /  Demo1234!   (admin role)
 *   demo.staff@waypoint.app  /  Demo1234!   (staff role)
 *
 * Safe to re-run — skips if waypoint_demo site already exists.
 */

import admin from "firebase-admin";
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// ── Load service account ───────────────────────────────────────────────────
const saPath = resolve(projectRoot, "serviceAccount.json");
if (!existsSync(saPath)) {
  console.error(
    "\n❌  serviceAccount.json not found in project root.\n" +
    "   Download it from Firebase Console → Project Settings → Service Accounts.\n"
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

const SITE_ID = "waypoint_demo";
const DEMO_PASSWORD = "Demo1234!";
const NOW = new Date();

function daysAgo(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return admin.firestore.Timestamp.fromDate(d);
}

// ── Guard: skip if already seeded ─────────────────────────────────────────
const existing = await db.collection("sites").doc(SITE_ID).get();
if (existing.exists) {
  console.log("✅  waypoint_demo already exists — nothing to do.");
  process.exit(0);
}

console.log("🌱  Seeding Waypoint Demo site...\n");

// ─────────────────────────────────────────────────────────────────────────
// 1. Site
// ─────────────────────────────────────────────────────────────────────────
await db.collection("sites").doc(SITE_ID).set({
  name: "Waypoint Demo",
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
console.log("✓  Site created");

// ─────────────────────────────────────────────────────────────────────────
// 2. Demo Auth users + Firestore profiles
// ─────────────────────────────────────────────────────────────────────────
async function createDemoUser(email, name, role) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`  (existing) ${email}`);
  } catch {
    user = await auth.createUser({ email, password: DEMO_PASSWORD, displayName: name });
    console.log(`  created    ${email}`);
  }
  await db.collection("users").doc(user.uid).set({
    name,
    email,
    role,
    siteId: SITE_ID,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return user.uid;
}

await createDemoUser("demo.admin@waypoint.app", "Alex Rivera", "admin");
await createDemoUser("demo.staff@waypoint.app", "Jordan Lee", "staff");
console.log("✓  Demo users created\n");

// ─────────────────────────────────────────────────────────────────────────
// 3. Inventory items
// ─────────────────────────────────────────────────────────────────────────
const items = [
  { name: "Copy Paper (Letter)", currentQuantity: 45, minQuantity: 20, location: "Storage Room A", barcode: "CP-LETTER-001", notes: "" },
  { name: "Pens (Blue, Box of 12)", currentQuantity: 4, minQuantity: 10, location: "Supply Closet", barcode: "", notes: "Pilot G2" },
  { name: "Sticky Notes 3x3", currentQuantity: 0, minQuantity: 8, location: "Supply Closet", barcode: "", notes: "" },
  { name: "Staples (Box)", currentQuantity: 14, minQuantity: 5, location: "Supply Closet", barcode: "", notes: "" },
  { name: "Hand Sanitizer (Gallon)", currentQuantity: 2, minQuantity: 4, location: "Janitorial Closet", barcode: "HS-GAL-001", notes: "" },
  { name: "Paper Towels (Case)", currentQuantity: 18, minQuantity: 8, location: "Janitorial Closet", barcode: "", notes: "12 rolls/case" },
  { name: "Trash Bags 55gal (Box)", currentQuantity: 3, minQuantity: 6, location: "Janitorial Closet", barcode: "", notes: "" },
  { name: "Cleaning Solution (Gallon)", currentQuantity: 5, minQuantity: 3, location: "Janitorial Closet", barcode: "", notes: "" },
  { name: "AA Batteries (8-pack)", currentQuantity: 0, minQuantity: 5, location: "Maintenance Room", barcode: "", notes: "" },
  { name: "Safety Vests (Hi-Vis)", currentQuantity: 12, minQuantity: 6, location: "Dock Area", barcode: "", notes: "One size fits most" },
  { name: "Box Cutter Blades (Box)", currentQuantity: 25, minQuantity: 10, location: "Dock Area", barcode: "", notes: "" },
  { name: "Printer Paper (Legal)", currentQuantity: 3, minQuantity: 10, location: "Storage Room A", barcode: "PP-LEGAL-001", notes: "" },
  { name: "Rubber Gloves (Box M)", currentQuantity: 6, minQuantity: 4, location: "Janitorial Closet", barcode: "", notes: "" },
  { name: "Zip Ties Assorted (Bag)", currentQuantity: 30, minQuantity: 10, location: "Maintenance Room", barcode: "", notes: "" },
  { name: "Extension Cord 25ft", currentQuantity: 2, minQuantity: 2, location: "Maintenance Room", barcode: "", notes: "" },
];

const itemRefs = [];
for (const item of items) {
  const state = item.currentQuantity <= 0 ? "OUT" : item.currentQuantity <= item.minQuantity ? "LOW" : "OK";
  const ref = await db.collection("items").add({
    ...item,
    siteId: SITE_ID,
    alertState: state,
    lastAlertAt: state !== "OK" ? daysAgo(Math.floor(Math.random() * 5) + 1) : null,
    lastAlertState: state !== "OK" ? state : null,
    userDismissedAlert: false,
    userDismissedAlertQuantity: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  itemRefs.push({ id: ref.id, name: item.name, qty: item.currentQuantity, min: item.minQuantity, state });
}
console.log(`✓  ${items.length} inventory items`);

// ─────────────────────────────────────────────────────────────────────────
// 4. Toners
// ─────────────────────────────────────────────────────────────────────────
const PRINTERS_LINKED = ["HP LaserJet Pro M404dn", "Canon imageRUNNER 2630i", "Brother HL-L3270CDW", "Xerox WorkCentre 3345"];

const toners = [
  { model: "HP LaserJet Pro M404dn", color: "Black", quantity: 3, minQuantity: 2, printer: "HP LaserJet Pro M404dn" },
  { model: "HP LaserJet Pro M404dn", color: "Cyan", quantity: 0, minQuantity: 1, printer: "HP LaserJet Pro M404dn" },
  { model: "Canon imageRUNNER 2630i", color: "Black", quantity: 2, minQuantity: 2, printer: "Canon imageRUNNER 2630i" },
  { model: "Canon imageRUNNER 2630i", color: "Magenta", quantity: 1, minQuantity: 2, printer: "Canon imageRUNNER 2630i" },
  { model: "Brother HL-L3270CDW", color: "Black", quantity: 5, minQuantity: 2, printer: "Brother HL-L3270CDW" },
  { model: "Brother HL-L3270CDW", color: "Yellow", quantity: 0, minQuantity: 1, printer: "Brother HL-L3270CDW" },
  { model: "Xerox WorkCentre 3345", color: "Black", quantity: 4, minQuantity: 2, printer: "Xerox WorkCentre 3345" },
  { model: "Lexmark MS810dn", color: "Black", quantity: 1, minQuantity: 2, printer: "", notes: "Spare unit — storage" },
];

const tonerRefs = [];
for (const toner of toners) {
  const state = toner.quantity <= 0 ? "OUT" : toner.quantity <= toner.minQuantity ? "LOW" : "OK";
  const ref = await db.collection("toners").add({
    ...toner,
    siteId: SITE_ID,
    alertState: state,
    lastAlertAt: state !== "OK" ? daysAgo(Math.floor(Math.random() * 7) + 1) : null,
    lastAlertState: state !== "OK" ? state : null,
    userDismissedAlert: false,
    userDismissedAlertQuantity: null,
    barcode: "",
    notes: toner.notes || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  tonerRefs.push({ id: ref.id, name: `${toner.model} (${toner.color})`, qty: toner.quantity, min: toner.minQuantity, state });
}
console.log(`✓  ${toners.length} toners`);

// ─────────────────────────────────────────────────────────────────────────
// 5. Printers
// ─────────────────────────────────────────────────────────────────────────
const printers = [
  { name: "HP LaserJet Pro M404dn", location: "Office B — 2nd Floor", ipAddress: "192.168.1.101", serial: "VNB3K12345", assetNumber: "AST-0041" },
  { name: "Canon imageRUNNER 2630i", location: "Main Office", ipAddress: "192.168.1.102", serial: "IRX7290011", assetNumber: "AST-0042" },
  { name: "Brother HL-L3270CDW", location: "HR Department", ipAddress: "192.168.1.103", serial: "U63884F201", assetNumber: "AST-0043" },
  { name: "Xerox WorkCentre 3345", location: "Shipping Dock", ipAddress: "192.168.1.104", serial: "XRX0019922", assetNumber: "AST-0044" },
];

for (const printer of printers) {
  await db.collection("printers").add({ ...printer, siteId: SITE_ID, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
console.log(`✓  ${printers.length} printers`);

// ─────────────────────────────────────────────────────────────────────────
// 6. Radios
// ─────────────────────────────────────────────────────────────────────────
const radios = [
  { name: "Radio 001", model: "Motorola DP4400", serial: "MOT001122", location: "Front Desk", notes: "" },
  { name: "Radio 002", model: "Motorola DP4400", serial: "MOT001123", location: "Dock Area", notes: "" },
  { name: "Radio 003", model: "Kenwood TK-3401", serial: "KEN445501", location: "Security", notes: "Primary security unit" },
  { name: "Radio 004", model: "Kenwood TK-3401", serial: "KEN445502", location: "Storage Room A", notes: "" },
  { name: "Radio 005", model: "Motorola DP4400", serial: "MOT001124", location: "Charging Station", notes: "Backup unit" },
  { name: "Radio 006", model: "Kenwood TK-3401", serial: "KEN445503", location: "HR Department", notes: "" },
];

for (const radio of radios) {
  await db.collection("radios").add({ ...radio, siteId: SITE_ID, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
console.log(`✓  ${radios.length} radios`);

// ─────────────────────────────────────────────────────────────────────────
// 7. Radio Parts
// ─────────────────────────────────────────────────────────────────────────
const radioParts = [
  { name: "Motorola Battery Pack (PMNN4477)", compatibleModel: "Motorola DP4400", quantity: 4, minQuantity: 3, location: "Charging Station", barcode: "PMNN4477" },
  { name: "Kenwood Belt Clip (KBH-10)", compatibleModel: "Kenwood TK-3401", quantity: 1, minQuantity: 4, location: "Parts Drawer", barcode: "KBH10" },
  { name: "Motorola Antenna (PMAD4148)", compatibleModel: "Motorola DP4400", quantity: 6, minQuantity: 2, location: "Parts Drawer", barcode: "PMAD4148" },
  { name: "Universal Earpiece (Single Wire)", compatibleModel: "Universal", quantity: 1, minQuantity: 5, location: "Parts Drawer", barcode: "" },
  { name: "Charging Cradle (6-bay)", compatibleModel: "Motorola DP4400", quantity: 2, minQuantity: 1, location: "Charging Station", barcode: "" },
  { name: "Motorola Micro-USB Charger", compatibleModel: "Motorola DP4400", quantity: 0, minQuantity: 3, location: "Charging Station", barcode: "" },
];

const radioPartRefs = [];
for (const part of radioParts) {
  const state = part.quantity <= 0 ? "OUT" : part.quantity <= part.minQuantity ? "LOW" : "OK";
  const ref = await db.collection("radioParts").add({
    ...part,
    siteId: SITE_ID,
    alertState: state,
    lastAlertAt: state !== "OK" ? daysAgo(Math.floor(Math.random() * 7) + 1) : null,
    lastAlertState: state !== "OK" ? state : null,
    userDismissedAlert: false,
    notes: "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  radioPartRefs.push({ id: ref.id, name: part.name, qty: part.quantity, min: part.minQuantity, state });
}
console.log(`✓  ${radioParts.length} radio parts`);

// ─────────────────────────────────────────────────────────────────────────
// 8. Active Alerts  (low/out items that should appear in the Alerts tab)
// ─────────────────────────────────────────────────────────────────────────
function makeAlert({ itemId, itemName, type, qty, min, location = "", itemType = "inventory", daysBack = 1 }) {
  const titles = { out: "Out of stock", low: "Low stock" };
  const bodies = {
    out: `${itemName} is OUT (0 left).`,
    low: `${itemName} is LOW (${qty} left, min ${min}).`,
  };
  return {
    createdAt: daysAgo(daysBack),
    type,
    title: titles[type],
    body: bodies[type],
    itemId,
    itemName,
    location,
    qty,
    min,
    siteId: SITE_ID,
    itemType,
    readBy: {},
  };
}

const alertsToCreate = [
  // Inventory
  { itemId: itemRefs.find(i => i.name === "Sticky Notes 3x3")?.id || "x", itemName: "Sticky Notes 3x3", type: "out", qty: 0, min: 8, location: "Supply Closet", itemType: "inventory", daysBack: 2 },
  { itemId: itemRefs.find(i => i.name === "AA Batteries (8-pack)")?.id || "x", itemName: "AA Batteries (8-pack)", type: "out", qty: 0, min: 5, location: "Maintenance Room", itemType: "inventory", daysBack: 1 },
  { itemId: itemRefs.find(i => i.name === "Pens (Blue, Box of 12)")?.id || "x", itemName: "Pens (Blue, Box of 12)", type: "low", qty: 4, min: 10, location: "Supply Closet", itemType: "inventory", daysBack: 3 },
  { itemId: itemRefs.find(i => i.name === "Hand Sanitizer (Gallon)")?.id || "x", itemName: "Hand Sanitizer (Gallon)", type: "low", qty: 2, min: 4, location: "Janitorial Closet", itemType: "inventory", daysBack: 1 },
  { itemId: itemRefs.find(i => i.name === "Trash Bags 55gal (Box)")?.id || "x", itemName: "Trash Bags 55gal (Box)", type: "low", qty: 3, min: 6, location: "Janitorial Closet", itemType: "inventory", daysBack: 4 },
  { itemId: itemRefs.find(i => i.name === "Printer Paper (Legal)")?.id || "x", itemName: "Printer Paper (Legal)", type: "low", qty: 3, min: 10, location: "Storage Room A", itemType: "inventory", daysBack: 2 },
  // Toners
  { itemId: tonerRefs.find(t => t.name.includes("Cyan"))?.id || "x", itemName: "HP LaserJet Pro M404dn (Cyan)", type: "out", qty: 0, min: 1, location: "Office B — 2nd Floor", itemType: "toner", daysBack: 3 },
  { itemId: tonerRefs.find(t => t.name.includes("Brother") && t.name.includes("Yellow"))?.id || "x", itemName: "Brother HL-L3270CDW (Yellow)", type: "out", qty: 0, min: 1, location: "HR Department", itemType: "toner", daysBack: 1 },
  { itemId: tonerRefs.find(t => t.name.includes("Canon") && t.name.includes("Magenta"))?.id || "x", itemName: "Canon imageRUNNER 2630i (Magenta)", type: "low", qty: 1, min: 2, location: "Main Office", itemType: "toner", daysBack: 5 },
  { itemId: tonerRefs.find(t => t.name.includes("Lexmark"))?.id || "x", itemName: "Lexmark MS810dn (Black)", type: "low", qty: 1, min: 2, location: "", itemType: "toner", daysBack: 2 },
  // Radio parts
  { itemId: radioPartRefs.find(r => r.name.includes("Motorola Micro-USB"))?.id || "x", itemName: "Motorola Micro-USB Charger", type: "out", qty: 0, min: 3, location: "Charging Station", itemType: "radioPart", daysBack: 1 },
  { itemId: radioPartRefs.find(r => r.name.includes("Kenwood Belt"))?.id || "x", itemName: "Kenwood Belt Clip (KBH-10)", type: "low", qty: 1, min: 4, location: "Parts Drawer", itemType: "radioPart", daysBack: 3 },
  { itemId: radioPartRefs.find(r => r.name.includes("Universal Earpiece"))?.id || "x", itemName: "Universal Earpiece (Single Wire)", type: "low", qty: 1, min: 5, location: "Parts Drawer", itemType: "radioPart", daysBack: 2 },
];

for (const a of alertsToCreate) {
  await db.collection("alerts").add(makeAlert(a));
}
console.log(`✓  ${alertsToCreate.length} active alerts`);

// ─────────────────────────────────────────────────────────────────────────
// 9. Activity Log (alertsLog) — ~35 realistic entries over past 30 days
// ─────────────────────────────────────────────────────────────────────────
const logEntries = [
  // Week 1 restocks & deductions
  { itemName: "Copy Paper (Letter)", itemId: itemRefs.find(i => i.name === "Copy Paper (Letter)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OK", qty: 45, min: 20, action: "added", daysBack: 28 },
  { itemName: "Safety Vests (Hi-Vis)", itemId: itemRefs.find(i => i.name === "Safety Vests (Hi-Vis)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "OK", qty: 12, min: 6, action: "added", daysBack: 27 },
  { itemName: "HP LaserJet Pro M404dn (Black)", itemId: tonerRefs.find(t => t.name.includes("M404dn") && t.name.includes("Black"))?.id || "x", itemType: "toner", prevState: "LOW", nextState: "OK", qty: 3, min: 2, action: "added", daysBack: 26 },
  { itemName: "Trash Bags 55gal (Box)", itemId: itemRefs.find(i => i.name === "Trash Bags 55gal (Box)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "LOW", qty: 3, min: 6, action: "deducted", daysBack: 25 },
  { itemName: "Cleaning Solution (Gallon)", itemId: itemRefs.find(i => i.name === "Cleaning Solution (Gallon)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "OK", qty: 5, min: 3, action: "deducted", daysBack: 24 },
  // Week 2
  { itemName: "Canon imageRUNNER 2630i (Black)", itemId: tonerRefs.find(t => t.name.includes("Canon") && t.name.includes("Black"))?.id || "x", itemType: "toner", prevState: "OK", nextState: "LOW", qty: 2, min: 2, action: "deducted", daysBack: 22 },
  { itemName: "Pens (Blue, Box of 12)", itemId: itemRefs.find(i => i.name === "Pens (Blue, Box of 12)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "LOW", qty: 4, min: 10, action: "deducted", daysBack: 21 },
  { itemName: "Paper Towels (Case)", itemId: itemRefs.find(i => i.name === "Paper Towels (Case)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OK", qty: 18, min: 8, action: "added", daysBack: 20 },
  { itemName: "Motorola Battery Pack (PMNN4477)", itemId: radioPartRefs.find(r => r.name.includes("Motorola Battery"))?.id || "x", itemType: "radioPart", prevState: "LOW", nextState: "OK", qty: 4, min: 3, action: "added", daysBack: 19 },
  { itemName: "AA Batteries (8-pack)", itemId: itemRefs.find(i => i.name === "AA Batteries (8-pack)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OUT", qty: 0, min: 5, action: "deducted", daysBack: 18 },
  { itemName: "Printer Paper (Legal)", itemId: itemRefs.find(i => i.name === "Printer Paper (Legal)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "LOW", qty: 3, min: 10, action: "deducted", daysBack: 17 },
  // Week 3
  { itemName: "HP LaserJet Pro M404dn (Cyan)", itemId: tonerRefs.find(t => t.name.includes("Cyan"))?.id || "x", itemType: "toner", prevState: "LOW", nextState: "OUT", qty: 0, min: 1, action: "deducted", daysBack: 16 },
  { itemName: "Box Cutter Blades (Box)", itemId: itemRefs.find(i => i.name === "Box Cutter Blades (Box)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OK", qty: 25, min: 10, action: "added", daysBack: 15 },
  { itemName: "Zip Ties Assorted (Bag)", itemId: itemRefs.find(i => i.name === "Zip Ties Assorted (Bag)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "OK", qty: 30, min: 10, action: "added", daysBack: 14 },
  { itemName: "Universal Earpiece (Single Wire)", itemId: radioPartRefs.find(r => r.name.includes("Universal Earpiece"))?.id || "x", itemType: "radioPart", prevState: "OK", nextState: "LOW", qty: 1, min: 5, action: "deducted", daysBack: 13 },
  { itemName: "Rubber Gloves (Box M)", itemId: itemRefs.find(i => i.name === "Rubber Gloves (Box M)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OK", qty: 6, min: 4, action: "added", daysBack: 12 },
  { itemName: "Hand Sanitizer (Gallon)", itemId: itemRefs.find(i => i.name === "Hand Sanitizer (Gallon)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "LOW", qty: 2, min: 4, action: "deducted", daysBack: 11 },
  // Week 4
  { itemName: "Brother HL-L3270CDW (Yellow)", itemId: tonerRefs.find(t => t.name.includes("Brother") && t.name.includes("Yellow"))?.id || "x", itemType: "toner", prevState: "LOW", nextState: "OUT", qty: 0, min: 1, action: "deducted", daysBack: 9 },
  { itemName: "Xerox WorkCentre 3345 (Black)", itemId: tonerRefs.find(t => t.name.includes("Xerox"))?.id || "x", itemType: "toner", prevState: "LOW", nextState: "OK", qty: 4, min: 2, action: "added", daysBack: 8 },
  { itemName: "Canon imageRUNNER 2630i (Magenta)", itemId: tonerRefs.find(t => t.name.includes("Magenta"))?.id || "x", itemType: "toner", prevState: "OK", nextState: "LOW", qty: 1, min: 2, action: "deducted", daysBack: 7 },
  { itemName: "Kenwood Belt Clip (KBH-10)", itemId: radioPartRefs.find(r => r.name.includes("Kenwood Belt"))?.id || "x", itemType: "radioPart", prevState: "OK", nextState: "LOW", qty: 1, min: 4, action: "deducted", daysBack: 6 },
  { itemName: "Motorola Micro-USB Charger", itemId: radioPartRefs.find(r => r.name.includes("Micro-USB"))?.id || "x", itemType: "radioPart", prevState: "LOW", nextState: "OUT", qty: 0, min: 3, action: "deducted", daysBack: 5 },
  { itemName: "Copy Paper (Letter)", itemId: itemRefs.find(i => i.name === "Copy Paper (Letter)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "OK", qty: 45, min: 20, action: "added", daysBack: 5 },
  // Last few days
  { itemName: "Sticky Notes 3x3", itemId: itemRefs.find(i => i.name === "Sticky Notes 3x3")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "OUT", qty: 0, min: 8, action: "deducted", daysBack: 3 },
  { itemName: "Staples (Box)", itemId: itemRefs.find(i => i.name === "Staples (Box)")?.id || "x", itemType: "inventory", prevState: "OK", nextState: "OK", qty: 14, min: 5, action: "added", daysBack: 2 },
  { itemName: "Lexmark MS810dn (Black)", itemId: tonerRefs.find(t => t.name.includes("Lexmark"))?.id || "x", itemType: "toner", prevState: "OK", nextState: "LOW", qty: 1, min: 2, action: "deducted", daysBack: 2 },
  { itemName: "AA Batteries (8-pack)", itemId: itemRefs.find(i => i.name === "AA Batteries (8-pack)")?.id || "x", itemType: "inventory", prevState: "OUT", nextState: "OUT", qty: 0, min: 5, action: "deducted", daysBack: 1 },
  { itemName: "Pens (Blue, Box of 12)", itemId: itemRefs.find(i => i.name === "Pens (Blue, Box of 12)")?.id || "x", itemType: "inventory", prevState: "LOW", nextState: "LOW", qty: 4, min: 10, action: "deducted", daysBack: 1 },
  { itemName: "Motorola Antenna (PMAD4148)", itemId: radioPartRefs.find(r => r.name.includes("Antenna"))?.id || "x", itemType: "radioPart", prevState: "OK", nextState: "OK", qty: 6, min: 2, action: "added", daysBack: 1 },
];

for (const entry of logEntries) {
  await db.collection("alertsLog").add({
    createdAt: daysAgo(entry.daysBack),
    siteId: SITE_ID,
    itemId: entry.itemId,
    itemName: entry.itemName,
    itemType: entry.itemType,
    prevState: entry.prevState,
    nextState: entry.nextState,
    qty: entry.qty,
    min: entry.min,
    action: entry.action,
    dismissed: false,
    userDismissed: false,
    tokenCount: 0,
    status: "no_tokens",
  });
}
console.log(`✓  ${logEntries.length} activity log entries`);

// ─────────────────────────────────────────────────────────────────────────
// 10. Contacts
// ─────────────────────────────────────────────────────────────────────────
const contacts = [
  { name: "Sarah Mitchell", title: "Facilities Manager", phone: "(401) 555-0182", email: "s.mitchell@waypointdemo.com", notes: "Primary contact for building/facilities issues", siteId: SITE_ID },
  { name: "James Turner", title: "IT Support", phone: "(401) 555-0247", email: "j.turner@waypointdemo.com", notes: "On-site IT — printers, network, workstations", siteId: SITE_ID },
  { name: "Maria Lopez", title: "Safety Officer", phone: "(401) 555-0391", email: "m.lopez@waypointdemo.com", notes: "Safety compliance and PPE inventory", siteId: SITE_ID },
];

for (const contact of contacts) {
  await db.collection("contacts").add({ ...contact, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
console.log(`✓  ${contacts.length} contacts`);

// ─────────────────────────────────────────────────────────────────────────
// 11. Vendors
// ─────────────────────────────────────────────────────────────────────────
const vendors = [
  { name: "Office Depot Business", phone: "(800) 463-3768", email: "orders@officedepot.com", website: "www.officedepot.com", notes: "Office supplies, paper, pens — account #WPT-4421", siteId: SITE_ID },
  { name: "Grainger Industrial Supply", phone: "(800) 472-4643", email: "service@grainger.com", website: "www.grainger.com", notes: "Maintenance, safety gear, batteries — account #GRA-8801", siteId: SITE_ID },
  { name: "Staples Business Advantage", phone: "(800) 693-8080", email: "advantage@staples.com", website: "www.staplesadvantage.com", notes: "Backup office supply vendor", siteId: SITE_ID },
];

for (const vendor of vendors) {
  await db.collection("vendors").add({ ...vendor, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
console.log(`✓  ${vendors.length} vendors`);

// ─────────────────────────────────────────────────────────────────────────
// 12. Lincoln Techs
// ─────────────────────────────────────────────────────────────────────────
const lincolnTechs = [
  { name: "TechPro Solutions", phone: "(401) 555-0500", email: "support@techprodemo.com", notes: "Primary radio/equipment repair — 2-day turnaround", siteId: SITE_ID },
];

for (const tech of lincolnTechs) {
  await db.collection("lincolnTechs").add({ ...tech, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}
console.log(`✓  ${lincolnTechs.length} Lincoln Tech`);

// ── Done ───────────────────────────────────────────────────────────────────
console.log("\n✅  Waypoint Demo seed complete!\n");
console.log("   demo.admin@waypoint.app  /  Demo1234!  (admin)");
console.log("   demo.staff@waypoint.app  /  Demo1234!  (staff)");
console.log("");
