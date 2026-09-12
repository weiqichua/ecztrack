/**
 * Firebase initialisation.
 *
 * Firebase is OPTIONAL. The app is local-first: AsyncStorage is the source of
 * truth and everything works with no Firebase project at all. Firebase only
 * provides off-device backup and occasional second-device sync.
 *
 * Nothing here runs at import time, and every accessor is guarded by
 * `isFirebaseConfigured()`. This is deliberate: the previous Supabase client
 * called createClient() at module scope, which threw on an empty URL and
 * killed the whole app on startup once its credentials were gone. Do not
 * reintroduce that pattern.
 *
 * TODO(user): fill the six EXPO_PUBLIC_FIREBASE_* values in .env.local to
 * enable backup — see docs/FIREBASE-SETUP.md. Until then the app runs
 * normally and simply has no backup.
 */

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore, getFirestore,
  persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import {
  initializeAuth, getAuth,
  browserLocalPersistence, type Auth,
  // `getReactNativePersistence` exists at runtime in this installed version
  // (firebase@12.17.1 / @firebase/auth@1.13.4) — `firebase/auth` re-exports
  // it from @firebase/auth's react-native build. But its *type* is not
  // reachable via either `firebase/auth` or `firebase/auth/react-native`
  // (the latter subpath does not exist in this version's exports map):
  // both `firebase`'s and `@firebase/auth`'s package.json `exports` list a
  // top-level "types" condition ahead of the platform-specific
  // "react-native" condition, so it wins the resolution even with
  // `customConditions: ["react-native"]` set in tsconfig — verified via
  // `tsc --traceResolution`. Suppressing here; the JS export is unaffected.
  // @ts-expect-error — see comment above
  getReactNativePersistence,
} from "firebase/auth";

const config = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const isWeb = Platform.OS === "web";

/**
 * Whether a usable Firebase config is present.
 *
 * apiKey, projectId and appId are the three initializeApp genuinely needs;
 * the rest are only used by services this app does not touch.
 */
export function isFirebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

function assertConfigured() {
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase is not configured. Set the EXPO_PUBLIC_FIREBASE_* values in " +
        ".env.local — see docs/FIREBASE-SETUP.md.",
    );
  }
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export function getApp(): FirebaseApp {
  assertConfigured();
  if (!app) app = getApps().length ? getApps()[0] : initializeApp(config);
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  try {
    db = initializeFirestore(getApp(), {
      // Web: IndexedDB-backed durable cache. Native: memory only —
      // durability comes from AsyncStorage, which is the source of truth.
      localCache: isWeb
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
      // Expo's networking stack does not reliably support Firestore's
      // default streaming transport.
      ...(isWeb ? {} : { experimentalForceLongPolling: true }),
    });
  } catch {
    // Already initialised (fast refresh).
    db = getFirestore(getApp());
  }
  return db;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  try {
    auth = initializeAuth(getApp(), {
      persistence: isWeb
        ? browserLocalPersistence
        : getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(getApp());
  }
  return auth;
}
