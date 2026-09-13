/**
 * The same treatment notes get, for unfinished style edits.
 *
 * The inspector keeps an in-progress session in the page's own `localStorage` so a reload offers to
 * put the work back. On a stranger's site that storage is the site's to clear, and an edit pass is
 * just as unrecreatable as a note — so it is mirrored into extension storage too, and from there to
 * the cloud when there is an account to sync with.
 *
 * Restoring is the reason this runs *before* the inspector mounts: the restore prompt reads
 * `localStorage` once, on open, and a mirror written a tick later would be found by nobody until the
 * next reload.
 */
import type { StoredEdits } from './merge.js';

export type { StoredEdits };

const EDITS_KEY = 'edits';
const SESSION_CHANGE_EVENT = 'meraki-inspector-session-change';
const SESSION_STORAGE_PREFIX = 'meraki-inspector-session:';

/** The inspector keys a session by path; the mirror keys it by origin + path, since it spans sites. */
export function editKeyFor(location: Location): string {
  return `${location.origin}${location.pathname.replace(/\/+$/, '') || '/'}`;
}

function pageStorageKey(location: Location): string {
  return `${SESSION_STORAGE_PREFIX}${location.pathname.replace(/\/+$/, '') || '/'}`;
}

export async function readAllEdits(): Promise<Record<string, StoredEdits>> {
  const stored = (await chrome.storage.local.get(EDITS_KEY))[EDITS_KEY];
  return (stored && typeof stored === 'object' ? stored : {}) as Record<string, StoredEdits>;
}

export async function writeAllEdits(pages: Record<string, StoredEdits>): Promise<void> {
  await chrome.storage.local.set({ [EDITS_KEY]: pages });
}

/** The component stores `savedAt` as an ISO string; the mirror sorts and merges on numbers. */
type AnnouncedSession = {
  savedAt: string;
  variables: [string, string][];
  changes: StoredEdits['changes'];
};

function toStored(session: AnnouncedSession, location: Location, title: string): StoredEdits {
  const parsed = Date.parse(session.savedAt);
  return {
    url: location.href,
    title,
    savedAt: Number.isFinite(parsed) ? parsed : Date.now(),
    variables: Array.isArray(session.variables) ? session.variables : [],
    changes: Array.isArray(session.changes) ? session.changes : [],
  };
}

/**
 * Wires a page up to the edits mirror.
 *
 * `ready` resolves once any restore has been written back into the page, so the inspector can be
 * mounted after the session is in place. `stop` removes the listener, so a re-injection cannot leave
 * two of them fighting over the same key.
 */
export function startEditMirror(): { ready: Promise<void>; stop: () => void } {
  const key = editKeyFor(window.location);
  const pageKey = pageStorageKey(window.location);

  const readLocal = (): AnnouncedSession | null => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pageKey) ?? 'null');
      return parsed && Array.isArray(parsed.changes) && parsed.changes.length ? (parsed as AnnouncedSession) : null;
    } catch {
      return null;
    }
  };

  const save = async (session: AnnouncedSession | null) => {
    const pages = await readAllEdits();
    if (session && session.changes.length) pages[key] = toStored(session, window.location, document.title);
    else delete pages[key];
    await writeAllEdits(pages);
  };

  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<{ session?: AnnouncedSession | null }>).detail;
    void save(detail?.session ?? null);
  };

  window.addEventListener(SESSION_CHANGE_EVENT, onChange);

  const ready = (async () => {
    const pages = await readAllEdits();
    const mirrored = pages[key];
    const local = readLocal();
    if (mirrored?.changes.length && !local) {
      try {
        window.localStorage.setItem(
          pageKey,
          JSON.stringify({
            savedAt: new Date(mirrored.savedAt).toISOString(),
            variables: mirrored.variables,
            changes: mirrored.changes,
          }),
        );
      } catch {
        // Blocked storage: the edits still exist in the mirror, and the next save keeps them.
      }
      return;
    }
    if (local) await save(local);
  })();

  return { ready, stop: () => window.removeEventListener(SESSION_CHANGE_EVENT, onChange) };
}
