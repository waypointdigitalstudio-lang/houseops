/**
 * One-time migration: prepend "401-618-" to any contact phone/phone2
 * that exists but doesn't already start with "401-618-".
 *
 * Run from the project root:
 *   node scripts/fix-phone-numbers.mjs
 */

import admin from "../functions/node_modules/firebase-admin/lib/index.js";

admin.initializeApp({ projectId: "houseops-55490" });
const db = admin.firestore();

const PREFIX = "401-618-";

function fixNumber(val) {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(PREFIX)) return null; // already correct
  return PREFIX + trimmed;
}

async function run() {
  const snap = await db.collection("contacts").get();
  if (snap.empty) { console.log("No contacts found."); return; }

  const batch = db.batch();
  let count = 0;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const update = {};

    const newPhone  = fixNumber(data.phone);
    const newPhone2 = fixNumber(data.phone2);

    if (newPhone)  update.phone  = newPhone;
    if (newPhone2) update.phone2 = newPhone2;

    if (Object.keys(update).length > 0) {
      batch.update(docSnap.ref, update);
      console.log(`  ${data.name}: ${JSON.stringify(update)}`);
      count++;
    }
  });

  if (count === 0) {
    console.log("All phone numbers already have the prefix — nothing to update.");
    return;
  }

  await batch.commit();
  console.log(`\nDone. Updated ${count} contact${count !== 1 ? "s" : ""}.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
