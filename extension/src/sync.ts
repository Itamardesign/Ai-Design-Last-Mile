/**
 * The cloud mirror: what leaves this machine, and when.
 *
 * Everything lives under one workspace document, and every path starts with it:
 *
 *     workspaces/{workspaceId}/notes/{pageId}      one page's review notes
 *     workspaces/{workspaceId}/edits/{pageId}      one page's unfinished style edits
 *     workspaces/{workspaceId}/handoffs/{docId}    a kept handoff, newest first
 *     handoffs/{workspaceId}/{docId}.png           its screenshot, in Cloud Storage
 *
 * `workspaceId` is the review owner's uid. A collaborator's page mapping redirects only that page's
 * notes and edits into the owner's workspace; their private reviews continue using their own uid.
 *
 * ## The rules this file obeys
 *
 * **Local storage stays the source of truth.** The mirror follows it; nothing in the inspector waits
 * on a network round-trip, and every feature keeps working with the account signed out or the
 * connection gone. A failed push is a retry next time, not an error in a designer's face.
 *
 * **Nothing is pushed unless the mode is `cloud`.** `local` and `undecided` never touch the network.
 * The check is at the top of every entry point in this file rather than at the call sites, because
 * "we forgot to check on that one path" is exactly the bug that would matter here.
 *
 * **The screenshot goes to Cloud Storage, not Firestore.** A Firestore document is capped at 1MiB and
 * a full-page PNG routinely beats that, so the document holds a path and the bytes go in the bucket.
 */
import { doc, getDocs, collection, setDoc, writeBatch, query, orderBy, limit } from 'firebase/firestore';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { markSynced, readAccount, workspaceIdFor, type Account } from './account.js';
import { db, storage } from './firebase.js';
import { changedKeys, docIdFor, mergeEditMaps, mergeNoteMaps, type StoredEdits } from './merge.js';
import { readAllNotes, writeAllNotes, type NotePage } from './notes.js';
import { readAllEdits, writeAllEdits } from './edits.js';
import type { HandoffDocument } from './handoff.js';
import { cloudTargetFor, forgetSharedPage, type SharedPage } from './sharing.js';

/** Resolves the workspace to write into, or null when this install is not syncing. */
async function workspace(): Promise<{ id: string; account: Account } | null> {
  const account = await readAccount();
  if (account.mode !== 'cloud' || !account.profile) return null;
  return { id: workspaceIdFor(account.profile), account };
}

/**
 * One write per page, grouped by the workspace it lands in.
 *
 * A private page goes to this person's own workspace; a page somebody shared with them goes to the
 * owner's. Each workspace gets its own batch, because a batch is atomic: one refused write — the
 * owner removed this person, or turned the link off — would otherwise take every private page down
 * with it, on every retry, for good. A refused *shared* page is forgotten instead, so the next push
 * lands the page in this person's own workspace like any other; a refused private page is left for
 * the caller's retry, since nothing about it can be fixed from here.
 */
async function pushGrouped<T extends { url: string; title: string; savedAt: number }>(
  keys: string[],
  account: Account,
  collectionName: 'notes' | 'edits',
  current: Record<string, T>,
  empty: () => Omit<T, 'url' | 'title' | 'savedAt'>,
  allowed: (destination: SharedPage) => boolean,
): Promise<void> {
  const groups = new Map<string, Array<{ key: string; destination: SharedPage }>>();
  for (const key of keys) {
    const destination = await cloudTargetFor(key, account);
    if (!destination || !allowed(destination)) continue;
    const group = groups.get(destination.workspaceId) ?? [];
    group.push({ key, destination });
    groups.set(destination.workspaceId, group);
  }

  let failure: unknown;
  for (const [workspaceId, entries] of groups) {
    const batch = writeBatch(db());
    for (const { key, destination } of entries) {
      const reference = doc(db(), 'workspaces', workspaceId, collectionName, destination.pageId);
      const page = current[key];
      // A page whose content was all deleted is emptied rather than removed: an empty page is the
      // honest record of "this page has nothing now", and it stops a stale copy on another machine
      // from resurrecting it on the next merge.
      batch.set(reference, page ? { ...page, pageKey: key, workspaceId } : { ...empty(), pageKey: key, workspaceId, url: '', title: '', savedAt: Date.now() });
    }
    try {
      await batch.commit();
    } catch (error) {
      const shared = workspaceId !== workspaceIdFor(account.profile!);
      if (shared && (error as { code?: string }).code === 'permission-denied') {
        await Promise.all(entries.map(({ key }) => forgetSharedPage(key)));
      }
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

/**
 * Pushes the pages whose notes changed.
 *
 * `previous` is what the mirror last saw, so a note added to one page does not rewrite the other
 * forty. Called from the storage listener in the service worker, which already knows both halves.
 */
export async function pushNotes(previous: Record<string, NotePage>, current: Record<string, NotePage>): Promise<void> {
  const target = await workspace();
  if (!target) return;

  const keys = changedKeys(previous, current);
  if (!keys.length) return;

  await pushGrouped(keys, target.account, 'notes', current, (): Pick<NotePage, 'notes'> => ({ notes: [] }), () => true);
  await markSynced();
}

/** The same, for unfinished style edits — which only editors may send to a shared page. */
export async function pushEdits(previous: Record<string, StoredEdits>, current: Record<string, StoredEdits>): Promise<void> {
  const target = await workspace();
  if (!target) return;

  const keys = changedKeys(previous, current);
  if (!keys.length) return;

  await pushGrouped(keys, target.account, 'edits', current, (): Pick<StoredEdits, 'variables' | 'changes'> => ({ variables: [], changes: [] }), (destination) => destination.role === 'edit');
  await markSynced();
}

/**
 * Brings the cloud copy down and merges it into what is on this machine.
 *
 * Run on sign-in, which is also the moment that matters most: a designer who reviewed twenty pages
 * before ever signing in must not lose them, and must not have them replaced by an empty cloud. The
 * merge is a union for notes and last-write-wins for edits — see merge.ts — and the result is written
 * back to *both* sides, so the two agree from here on.
 */
export async function pullEverything(): Promise<{ notes: number; edits: number } | null> {
  const target = await workspace();
  if (!target) return null;

  const [localNotes, localEdits] = await Promise.all([readAllNotes(), readAllEdits()]);

  const remoteNotes: Record<string, NotePage> = {};
  for (const snapshot of (await getDocs(collection(db(), 'workspaces', target.id, 'notes'))).docs) {
    const data = snapshot.data() as NotePage & { pageKey?: string };
    if (data.pageKey && Array.isArray(data.notes) && data.notes.length) remoteNotes[data.pageKey] = data;
  }

  const remoteEdits: Record<string, StoredEdits> = {};
  for (const snapshot of (await getDocs(collection(db(), 'workspaces', target.id, 'edits'))).docs) {
    const data = snapshot.data() as StoredEdits & { pageKey?: string };
    if (data.pageKey && Array.isArray(data.changes) && data.changes.length) remoteEdits[data.pageKey] = data;
  }

  const notes = mergeNoteMaps(localNotes, remoteNotes);
  const edits = mergeEditMaps(localEdits, remoteEdits);

  await Promise.all([writeAllNotes(notes), writeAllEdits(edits)]);
  // Push the merged result back up, so a page that only existed locally is now in both places.
  await Promise.all([pushNotes(remoteNotes, notes), pushEdits(remoteEdits, edits)]);

  return { notes: Object.keys(notes).length, edits: Object.keys(edits).length };
}

export type KeptHandoff = HandoffDocument & {
  id: string;
  workspaceId: string;
  savedAt: number;
  /** Where the screenshot ended up, when there was one. */
  screenshotUrl: string | null;
};

/**
 * Keeps one handoff.
 *
 * The screenshot is uploaded first and the document written second, so a document never claims a
 * picture that is not there. The reverse — document first — leaves a broken image in the history if
 * the upload fails, which is worse than a handoff with no picture.
 */
export async function saveHandoff(document: HandoffDocument): Promise<{ ok: boolean; error?: string }> {
  const target = await workspace();
  if (!target) return { ok: false, error: 'Sign in to keep handoffs in your account.' };

  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    let screenshotUrl: string | null = null;
    if (document.screenshot) {
      const shot = ref(storage(), `handoffs/${target.id}/${id}.png`);
      await uploadString(shot, document.screenshot, 'data_url');
      screenshotUrl = await getDownloadURL(shot);
    }
    const { screenshot: _omitted, ...rest } = document;
    const kept: KeptHandoff = { ...rest, screenshot: null, id, workspaceId: target.id, savedAt: Date.now(), screenshotUrl };
    await setDoc(doc(db(), 'workspaces', target.id, 'handoffs', id), kept);
    await markSynced();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** The kept handoffs, newest first, for the list on the settings page. */
export async function listHandoffs(max = 25): Promise<KeptHandoff[]> {
  const target = await workspace();
  if (!target) return [];
  const snapshot = await getDocs(
    query(collection(db(), 'workspaces', target.id, 'handoffs'), orderBy('savedAt', 'desc'), limit(max)),
  );
  return snapshot.docs.map((entry) => entry.data() as KeptHandoff);
}
