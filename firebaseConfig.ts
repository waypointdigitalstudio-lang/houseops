// firebaseConfig.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import { getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyA-yFt19bskSyEEHuarglJUqRDOtJb634I",
  authDomain: "houseops-55490.firebaseapp.com",
  projectId: "houseops-55490",
  storageBucket: "houseops-55490.firebasestorage.app",
  messagingSenderId: "954807448148",
  appId: "1:954807448148:web:a88b179f2b51ee59cb33c1",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firestore
export const db = getFirestore(app);

// Auth (platform-safe: AsyncStorage persistence on device, default on web)
export const auth =
  Platform.OS === "web"
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

export default app;
