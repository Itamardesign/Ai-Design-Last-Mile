/**
 * Keeps review notes safe, and counts them where they can be seen.
 *
 * The inspector stores notes in the page's own `localStorage`, which is the right default in an app
 * — but on a stranger's site that storage belongs to the site: it clears on logout, on a cookie
 * banner's "reject all", or whenever the site feels like it. A reviewer losing an afternoon of notes
 * to somebody else's storage policy is not acceptable, so every write is mirrored into extension
 * storage, and a page that comes back empty is restored from that mirror.
 *
 * The count of unresolved notes is pushed to the service worker, which paints it on the toolbar —
 * so you can see there is something to answer without opening anything.
 */

/** Shape mirrored from the inspector. Kept structural on purpose: this file must not fight the component's type. */
export type StoredNote = {
  id: string;
  path: string;
  selector: string;
  label: string;
  text: string;
  createdAt: string;
  author?: string;
  resolved?: boolean;
};

export type NotePage = { url: string; title: string; savedAt: number; notes: StoredNote[] };

const NOTES_KEY = 'notes';
const COMMENTS_CHANGE_EVENT = 'meraki-inspector-comments-change';
const COMMENTS_STORAGE_PREFIX = 'meraki-inspector-comments';

/** The inspector keys notes by path; the mirror keys them by origin + path, since it spans sites. */
export function noteKeyFor(location: Location): string {
  return `${location.origin}${location.pathname.replace(/\/+$/, '') || '/'}`;
}

function pageStorageKey(location: Location): string {
  return `${COMMENTS_STORAGE_PREFIX}:${location.pathname.replace(/\/+$/, '') || '/'}`;
}

export async function readAllNotes(): Promise<Record<string, NotePage>> {
  const stored = (await chrome.storage.local.get(NOTES_KEY))[NOTES_KEY];
  return (stored && typeof stored === 'object' ? stored : {}) as Record<string, NotePage>;
}

export async function writeAllNotes(pages: Record<string, NotePage>): Promise<void> {
  await chrome.storage.local.set({ [NOTES_KEY]: pages });
}

export const openNoteCount = (notes: readonly StoredNote[]): number => notes.filter((note) => !note.resolved).length;

/**
 * Renders one page's notes as something a person can paste into a ticket.
 *
 * Markdown rather than JSON: the point of a review is to be read by whoever has to act on it, and
 * every tool a designer hands work to takes markdown.
 */
export function notesAsMarkdown(page: NotePage): string {
  const byElement = new Map<string, StoredNote[]>();
  for (const note of page.notes) {
    const list = byElement.get(note.path) ?? [];
    list.push(note);
    byElement.set(note.path, list);
  }

  const blocks = [...byElement.values()].map((list, index) => {
    const head = `${index + 1}. **${list[0].label}** — \`${list[0].selector}\``;
    const lines = list.map((note) => {
      const who = note.author ? `${note.author}, ` : '';
      const state = note.resolved ? ' _(resolved)_' : '';
      return `   - ${note.text} — _${who}${new Date(note.createdAt).toLocaleString()}_${state}`;
    });
    return [head, ...lines].join('\n');
  });

  return [
    `# Review notes — ${page.title || page.url}`,
    page.url,
    `${page.notes.length} note${page.notes.length === 1 ? '' : 's'} · ${openNoteCount(page.notes)} open`,
    '',
    ...blocks,
  ].join('\n');
}

/**
 * Wires a page up to the mirror.
 *
 * Runs in the content script: restores anything the site lost, then follows every change the
 * inspector announces.
 *
 * `ready` resolves once any restore has been written back, so the inspector can be told to mount
 * *after* the notes are in place — mounting first would read an empty page and show nothing until a
 * reload. `stop` removes the listener, so a re-injection cannot end up with two of them.
 */
export function startNoteMirror(onCount: (open: number) => void): { ready: Promise<void>; stop: () => void } {
  const key = noteKeyFor(window.location);
  const pageKey = pageStorageKey(window.location);

  const readLocal = (): StoredNote[] => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pageKey) ?? '[]');
      return Array.isArray(parsed) ? (parsed as StoredNote[]) : [];
    } catch {
      return [];
    }
  };

  const save = async (notes: StoredNote[]) => {
    const pages = await readAllNotes();
    if (notes.length) {
      pages[key] = { url: window.location.href, title: document.title, savedAt: Date.now(), notes };
    } else {
      delete pages[key];
    }
    await writeAllNotes(pages);
    onCount(openNoteCount(notes));
  };

  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<{ comments?: StoredNote[] }>).detail;
    void save(Array.isArray(detail?.comments) ? detail.comments : readLocal());
  };

  window.addEventListener(COMMENTS_CHANGE_EVENT, onChange);

  // Restore first: if the site wiped its storage, the inspector must find the notes already there
  // when it reads them on mount.
  const ready = (async () => {
    const pages = await readAllNotes();
    const mirrored = pages[key]?.notes ?? [];
    const local = readLocal();
    if (mirrored.length && !local.length) {
      try {
        window.localStorage.setItem(pageKey, JSON.stringify(mirrored));
      } catch {
        // Blocked storage: the notes still exist in the mirror, and the next save will keep them.
      }
      onCount(openNoteCount(mirrored));
      return;
    }
    if (local.length) await save(local);
    else onCount(0);
  })();

  return { ready, stop: () => window.removeEventListener(COMMENTS_CHANGE_EVENT, onChange) };
}
