import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/** Use static `process.env.NEXT_PUBLIC_*` reads so the client bundle inlines values (dynamic `process.env[key]` is often empty in the browser). */
export function isFirebaseConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_APP_ID)
  );
}

function readConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };
}

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local and add your keys.");
  }
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(readConfig());
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}
