/**
 * One-time migration: prepend "401-618-" to any contact phone/phone2
 * that exists but doesn't already start with "401-618-".
 *
 * Run from the project root:
 *   node scripts/fix-phone-numbers.mjs
 */

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, writeBatch } from "firebase/firestore";
import * as readline from "readline";

const firebaseConfig = {
  apiKey: "AIzaSyA-yFt19bskSyEEHuarglJUqRDOtJb634I",
  authDomain: "houseops-55490.firebaseapp.com",
  projectId: "houseops-55490",
  storageBucket: "houseops-55490.firebasestorage.app",
  messagingSenderId: "954807448148",
  appId: "1:954807448148:web:a88b179f2b51ee59cb33c1",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const PREFIX = "401-618-";

function fixNumber(val) {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(PREFIX)) return null;
  return PREFIX + trimmed;
}

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function run() {
  const email    = await prompt("Firebase email: ");
  const password = await prompt("Password: ");

  console.log("Signing in...");
  await signInWithEmailAndPassword(auth, email, password);
  console.log("Signed in.\n");

  const snap = await getDocs(collection(db, "contacts"));
  if (snap.empty) { console.log("No contacts found."); return; }

  const batch = writeBatch(db);
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
  process.exit(0);
}

run().catch((err) => { console.error(err.message); process.exit(1); });
