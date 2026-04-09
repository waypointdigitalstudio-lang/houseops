/**
 * One-time patch: rename `name` → `company` on waypoint_demo vendor docs.
 * Run from the functions folder: node patchVendors.js
 */
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const saPath = resolve(__dirname, "../serviceAccount.json");
const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const snap = await db.collection("vendors").where("siteId", "==", "waypoint_demo").get();

let count = 0;
for (const doc of snap.docs) {
  const data = doc.data();
  if (data.name && !data.company) {
    await doc.ref.update({ company: data.name });
    console.log(`  patched: ${data.name}`);
    count++;
  }
}

console.log(`\n✅  Done — patched ${count} vendor(s).`);
