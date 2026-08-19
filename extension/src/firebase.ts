/**
 * The extension's Firebase connection.
 *
 * Three things about Firebase inside a Manifest V3 extension shape this file:
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
 *    that works in every extension context — popup, options page and worker alike.
 *
 * The `apiKey` is not a secret: a Firebase web key only identifies the project, and every request it
 * signs is still checked against Firestore security rules. Those rules are what actually protects
 * the data, so scope them to `request.auth.uid` before storing anything real.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  signInAnonymously,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

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

/**
 * Gets this install an identity, so Firestore rules have a `uid` to key on.
 *
 * Anonymous sign-in is the right shape for a devtool: nobody wants to make an account to inspect a
 * page, and the account can be upgraded to a real one later without losing its data. It has to be
 * switched on in the Firebase console (Authentication -> Sign-in method -> Anonymous); until it is,
 * this rejects with `auth/operation-not-allowed`.
 */
export async function ensureSignedIn(): Promise<User> {
  const auth = firebaseAuth();
  if (auth.currentUser) return auth.currentUser;
  // A sign-in restored from IndexedDB arrives asynchronously; wait for that before making a new one.
  const restored = await new Promise<User | null>((resolve) => {
    const stop = auth.onAuthStateChanged((user) => {
      stop();
      resolve(user);
    });
  });
  if (restored) return restored;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export type FirebaseStatus = {
  projectId: string;
  connected: boolean;
  uid: string | null;
  error: string | null;
};

/** What the options page shows: is this build actually talking to the project, and as whom. */
export async function firebaseStatus(): Promise<FirebaseStatus> {
  try {
    const user = await ensureSignedIn();
    return { projectId: firebaseConfig.projectId, connected: true, uid: user.uid, error: null };
  } catch (error) {
    return {
      projectId: firebaseConfig.projectId,
      connected: false,
      uid: null,
      error: (error as Error).message,
    };
  }
}
