/**
 * The extension's Firebase connection: the app, and the three services built on it.
 *
 * Four things about Firebase inside a Manifest V3 extension shape this file:
 *
 * 1. The SDK is *bundled* by esbuild, never fetched. MV3 forbids remote code, so any approach that
 *    loads gtag.js or the compat scripts from a CDN is dead on arrival — which is also why
 *    `firebase/analytics` is absent here: it injects a remote script and needs a `document`, and the
 *    service worker has neither. Use your own events (or Firestore writes) if you want telemetry.
 * 2. The service worker is evicted whenever Chrome likes, so nothing may live in module scope that
 *    matters. Everything below is lazy and re-derived on demand; `getApps()` keeps a second
 *    `initializeApp` after a restart from throwing.
 * 3. Auth's default persistence reaches for `localStorage`, which a service worker does not have.
 *    `initializeAuth` with IndexedDB persistence and no popup/redirect resolver is the combination
 *    that works in every extension context — popup, options page and worker alike. It also means a
 *    sign-in survives the worker being killed, which is the whole point of signing in.
 * 4. Sign-in itself cannot use `signInWithPopup`: the redirect lands on a web origin an extension
 *    does not have. Google's token comes from `chrome.identity` and is exchanged for a Firebase
 *    credential — see account.ts.
 *
 * The `apiKey` is not a secret: a Firebase web key only identifies the project, and every request it
 * signs is still checked against security rules. The rules in `firebase/firestore.rules` and
 * `firebase/storage.rules` are what actually protects the data.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, indexedDBLocalPersistence, initializeAuth, type Auth, type User } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: 'AIzaSyADi6OtFT5b4Tg1vSLtny1_STLnXHfuznY',
  authDomain: 'ai-last-mile.firebaseapp.com',
  projectId: 'ai-last-mile',
  storageBucket: 'ai-last-mile.firebasestorage.app',
  messagingSenderId: '328403266454',
  appId: '1:328403266454:web:e18e9f3559ad164fb2cbb7',
  measurementId: 'G-T87V2RJ7CB',
} as const;

const APP_NAME = 'meraki-design-inspector';

/** The initialised app, created once per worker lifetime and reused after that. */
export function firebaseApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === APP_NAME);
  return existing ?? initializeApp(firebaseConfig, APP_NAME);
}

let authInstance: Auth | null = null;

/**
 * Auth wired for extension contexts.
 *
 * `initializeAuth` rather than `getAuth` because the latter picks a persistence chain that starts at
 * `localStorage`; leaving `popupRedirectResolver` unset drops the sign-in-with-popup machinery,
 * which cannot work from a service worker anyway.
 */
export function firebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = firebaseApp();
  try {
    authInstance = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  } catch {
    // Already initialised for this app — the context handed us a live instance, so ask for it.
    authInstance = getAuth(getApp(APP_NAME));
  }
  return authInstance;
}

let firestoreInstance: Firestore | null = null;

export function db(): Firestore {
  firestoreInstance ??= getFirestore(firebaseApp());
  return firestoreInstance;
}

let storageInstance: FirebaseStorage | null = null;

/** Cloud Storage, for the one thing Firestore cannot hold: the handoff screenshot. */
export function storage(): FirebaseStorage {
  storageInstance ??= getStorage(firebaseApp());
  return storageInstance;
}

/**
 * The signed-in user, or null — waiting for a persisted session to be read back if it has not been.
 *
 * `auth.currentUser` is null for the first tick after a worker restart even when a sign-in is sitting
 * in IndexedDB, so reading it directly would report "signed out" to anything that asked early. One
 * `onAuthStateChanged` is the documented way to wait for that answer.
 */
export async function currentUser(): Promise<User | null> {
  const auth = firebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  return new Promise<User | null>((resolve) => {
    const stop = auth.onAuthStateChanged(
      (user) => {
        stop();
        resolve(user);
      },
      () => {
        stop();
        resolve(null);
      },
    );
  });
}
