/**
 * Reconciling what is on this machine with what is in the cloud.
 *
 * Kept apart from sync.ts, which does the talking, because every hard question about syncing is here
 * and none of it needs a network to answer — so all of it can be tested directly.
 *
 * The two rules, and why they differ:
 *
 * - **Notes merge, per note.** A review is additive: two people, or one person on two machines, leave
 *   different notes and both sets are wanted. Ids are unique per note, so the union is well defined.
 *   When the *same* note exists on both sides — the resolved tick was moved somewhere else — the copy
 *   from the more recently saved page wins.
 * - **Edits do not merge; the newer page replaces the older.** Two machines that both set
 *   `padding` on the same button have no correct union: the values are alternatives, not additions.
 *   Last write wins for the whole page, which is at least a state a designer recognises, rather than
 *   a half-and-half nobody produced.
 */
import type { NotePage, StoredNote } from './notes.js';

/**
 * A Firestore document id for one of our page keys.
 *
 * Page keys are URLs (`https://acme.test/pricing`) and document ids may not contain `/`, may not be
 * `.` or `..`, and may not be wrapped in double underscores. Percent-encoding handles the reserved
 * characters, and the leftover `/` and `.` are escaped to `~xx` — reversible, stable across runs, and
 * still readable enough to find a document by eye in the Firebase console.
 */
export function docIdFor(pageKey: string): string {
  return encodeURIComponent(pageKey).replace(/[/.~*[\]]/g, (char) => `~${char.charCodeAt(0).toString(16)}`);
}

export function pageKeyFromDocId(docId: string): string {
  return decodeURIComponent(docId.replace(/~([0-9a-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

/** One page's notes, merged. See the rules at the top of the file. */
export function mergeNotePages(local: NotePage | undefined, remote: NotePage | undefined): NotePage | undefined {
  if (!local) return remote;
  if (!remote) return local;

  const newer = remote.savedAt > local.savedAt ? remote : local;
  const older = newer === remote ? local : remote;

  const byId = new Map<string, StoredNote>();
  for (const note of older.notes) byId.set(note.id, note);
  for (const note of newer.notes) byId.set(note.id, note);

  return {
    // The title and url travel with whichever save is newer: a page that was renamed should read as
    // its current name, not whichever machine happened to see it first.
    url: newer.url,
    title: newer.title,
    savedAt: Math.max(local.savedAt, remote.savedAt),
    notes: [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

/** Every page, merged. Pages present on only one side come through untouched. */
export function mergeNoteMaps(
  local: Record<string, NotePage>,
  remote: Record<string, NotePage>,
): Record<string, NotePage> {
  const merged: Record<string, NotePage> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const page = mergeNotePages(local[key], remote[key]);
    if (page) merged[key] = page;
  }
  return merged;
}

/** Shape mirrored from the inspector's saved session. Structural on purpose. */
export type StoredEdits = {
  url: string;
  title: string;
  savedAt: number;
  variables: [string, string][];
  changes: {
    path: string;
    selector: string;
    property: string;
    before: string;
    after: string;
    kind: string;
    instruction?: string;
    cssVariable?: string;
  }[];
};

/** Style edits for one page: the newer save wins outright. */
export function mergeEditPages(local: StoredEdits | undefined, remote: StoredEdits | undefined): StoredEdits | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return remote.savedAt > local.savedAt ? remote : local;
}

export function mergeEditMaps(
  local: Record<string, StoredEdits>,
  remote: Record<string, StoredEdits>,
): Record<string, StoredEdits> {
  const merged: Record<string, StoredEdits> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const page = mergeEditPages(local[key], remote[key]);
    if (page) merged[key] = page;
  }
  return merged;
}

/**
 * Which page keys differ between two maps, so a push sends the pages that changed instead of all of
 * them. Compared by `savedAt` and note count rather than deep equality: both move on every real
 * change, and a false positive here only costs one redundant write.
 */
export function changedKeys(
  before: Record<string, { savedAt: number; notes?: unknown[]; changes?: unknown[] }>,
  after: Record<string, { savedAt: number; notes?: unknown[]; changes?: unknown[] }>,
): string[] {
  const size = (page: { notes?: unknown[]; changes?: unknown[] } | undefined) =>
    (page?.notes?.length ?? 0) + (page?.changes?.length ?? 0);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => {
    const one = before[key];
    const two = after[key];
    if (!one || !two) return true;
    return one.savedAt !== two.savedAt || size(one) !== size(two);
  });
}
