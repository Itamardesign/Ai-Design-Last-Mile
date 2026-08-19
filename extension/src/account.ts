/**
 * Who is using the extension, and whether their work leaves this machine.
 *
 * There are exactly three states, and the third one is the reason this file exists:
 *
 * - `undecided` — nobody has been asked yet. The tool works fully; the settings page offers a choice.
 * - `local` — the designer said no. Nothing is ever sent anywhere. This is a first-class answer, not
 *   a nag to be re-shown: a reviewer poking at a client's staging site has every right to keep that
 *   on their own machine, and the choice is remembered until they change it themselves.
 * - `cloud` — signed in with Google. Notes, edits and handoffs are mirrored to Firestore under their
 *   own id, so a second machine, or a re-installed browser, picks the review up where it was.
 *
 * The decision is kept in `chrome.storage.local`, separately from the Firebase session, so every
 * surface can render the right thing without loading the SDK or waiting on the network. Firebase is
 * the authority on *identity*; this is the authority on *intent*.
 *
 * ## Why Google's token comes from `chrome.identity`
 *
 * `signInWithPopup` needs a web origin to redirect back to, and an extension does not have one. The
 * supported path is `chrome.identity.getAuthToken`, which uses the profile already signed in to
 * Chrome — usually with no password prompt at all — and hands back an OAuth access token that Firebase
 * accepts as a Google credential.
 *
 * That path needs two things set up once, by a human, in the Google Cloud console: an OAuth client of
 * type "Chrome Extension" tied to this extension's id, and that id kept stable by pinning `key` in
 * the manifest. Until `client_id` stops being the placeholder, sign-in reports what is missing rather
 * than failing with a bare OAuth error — see "Signing in" in extension/README.md.
 */
import { GoogleAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { currentUser, firebaseAuth } from './firebase.js';

export type AccountMode = 'undecided' | 'local' | 'cloud';

export type Profile = {
  uid: string;
  name: string | null;
  email: string | null;
  photo: string | null;
};

export type Account = {
  mode: AccountMode;
  profile: Profile | null;
  /** Set when the last sign-in attempt failed, so the settings page can explain rather than shrug. */
  error?: string;
  /** When the mirror last finished a push, for the "everything is saved" line. */
  syncedAt?: number;
};

const KEY = 'account';

/** The scopes the token is asked for: an identity, and nothing else. */
const SCOPES = ['openid', 'email', 'profile'];

const SETUP_MESSAGE =
  'Google sign-in is not set up in this build yet — extension/manifest.json still has the placeholder OAuth client id. See "Signing in" in extension/README.md; it takes about five minutes in the Google Cloud console.';

/**
 * The workspace a document belongs to.
 *
 * Every stored document carries one of these, and today it is always the signer's own uid — which
 * makes the per-user rules trivial. It exists as a separate concept so that sharing a review with a
 * team later is a change of *value* (a real workspace id) rather than a migration of every path.
 */
export const workspaceIdFor = (profile: Profile): string => profile.uid;

export async function readAccount(): Promise<Account> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Account | undefined;
  if (!stored || typeof stored.mode !== 'string') return { mode: 'undecided', profile: null };
  return stored;
}

async function writeAccount(account: Account): Promise<Account> {
  await chrome.storage.local.set({ [KEY]: account });
  return account;
}

export function onAccountChanged(listener: (account: Account) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    listener(changes[KEY].newValue as Account);
  });
}

/** True once the OAuth client id in the manifest is a real one. */
export function oauthConfigured(): boolean {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  return clientId.length > 0 && !clientId.startsWith('REPLACE_ME');
}

/**
 * Chrome's promise form of `getAuthToken` resolves to `{ token }`; the callback form handed back a
 * bare string, and enough builds and type packages still describe it that way to make narrowing here
 * cheaper than being wrong at runtime.
 */
function tokenOf(result: chrome.identity.GetAuthTokenResult | string | undefined): string | undefined {
  if (!result) return undefined;
  return typeof result === 'string' ? result : result.token;
}

const profileOf = (user: {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}): Profile => ({ uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL });

/**
 * Asks Chrome for a Google token and trades it for a Firebase session.
 *
 * `interactive: true` is what allows the account chooser to appear. A token Chrome has cached can
 * still be dead server-side — revoked from the Google account page, or expired past its grace — so a
 * rejected exchange clears it from the cache before reporting. Skipping that is what makes a second
 * attempt fail identically to the first, forever.
 */
export async function signInWithGoogle(): Promise<Account> {
  if (!oauthConfigured()) return writeAccount({ ...(await readAccount()), error: SETUP_MESSAGE });

  let token: string | undefined;
  try {
    token = tokenOf(await chrome.identity.getAuthToken({ interactive: true, scopes: SCOPES }));
    if (!token) throw new Error('Chrome returned no token.');
    const result = await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(null, token));
    return writeAccount({ mode: 'cloud', profile: profileOf(result.user), error: undefined });
  } catch (error) {
    if (token) await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    const message = (error as Error)?.message ?? String(error);
    return writeAccount({
      ...(await readAccount()),
      error: /not granted or revoked|did not approve|canceled|cancelled/i.test(message)
        ? 'Sign-in was cancelled.'
        : message,
    });
  }
}

/** "Skip" — a decision, recorded so the settings page stops asking. */
export async function stayLocal(): Promise<Account> {
  return writeAccount({ mode: 'local', profile: null });
}

/**
 * Signs out of both halves: Firebase, and Chrome's own token cache.
 *
 * Forgetting the second half is the classic bug here — Firebase drops the user, `getAuthToken` hands
 * back the same cached token, and "Sign in" appears to sign the same person straight back in with no
 * chooser. Nothing local is deleted: the notes on this machine are the designer's, and leaving a
 * mirror is not a request to throw them away.
 */
export async function signOutAccount(): Promise<Account> {
  try {
    const token = tokenOf(await chrome.identity.getAuthToken({ interactive: false }).catch((): undefined => undefined));
    if (token) await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
  } catch {
    // No identity API, or nothing cached. Firebase is still signed out below.
  }
  try {
    await signOut(firebaseAuth());
  } catch {
    // Already signed out.
  }
  return writeAccount({ mode: 'local', profile: null });
}

/**
 * The account as it really is, reconciling intent against the live Firebase session.
 *
 * The two can disagree: a token can be revoked from the Google account page, or IndexedDB cleared,
 * and then a stored `cloud` is a lie. Rather than let the settings page claim a sync that is not
 * happening, one silent `getAuthToken` is tried first — the common case, where Chrome is still signed
 * in and the Firebase session simply needs rebuilding after a browser restart.
 */
export async function resolveAccount(): Promise<Account> {
  const stored = await readAccount();
  if (stored.mode !== 'cloud') return stored;

  const user = await currentUser();
  if (user) return writeAccount({ ...stored, profile: profileOf(user), error: undefined });

  if (!oauthConfigured()) return writeAccount({ ...stored, error: SETUP_MESSAGE });
  try {
    const token = tokenOf(await chrome.identity.getAuthToken({ interactive: false, scopes: SCOPES }));
    if (!token) throw new Error('no cached token');
    const result = await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(null, token));
    return writeAccount({ mode: 'cloud', profile: profileOf(result.user), error: undefined });
  } catch {
    // Chrome cannot renew it without a person present. Stay in `cloud`, so the mirror resumes the
    // moment they sign in again, but say plainly that it is not running.
    return writeAccount({ ...stored, error: 'Signed out by Google. Sign in again to resume syncing.' });
  }
}

/** Records that the mirror finished a push, for the settings page's "last synced" line. */
export async function markSynced(at = Date.now()): Promise<void> {
  const account = await readAccount();
  if (account.mode !== 'cloud') return;
  await writeAccount({ ...account, syncedAt: at });
}
