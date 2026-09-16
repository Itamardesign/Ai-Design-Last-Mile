/**
 * Host access, asked for one site at a time.
 *
 * The manifest grants only `activeTab`: clicking the toolbar button, the popup or the shortcut
 * hands the extension that one tab for as long as it stays on that origin, and nothing else. That
 * covers everything the inspector does by hand. Two settings need more, because they act without
 * a click — starting automatically on a site, and stripping strict headers before the page loads —
 * and those ask for the origin they need through `optional_host_permissions` the moment the
 * designer turns them on. Chrome shows its own dialog; a refusal simply leaves the setting off.
 *
 * `chrome.permissions.request` only works from an extension page in response to a user gesture, so
 * the asking happens in the popup and the hub, never in the service worker. The worker only checks.
 */

/** The match pattern for one origin, or null for anything Chrome would refuse (file:, null origins). */
export function patternFor(origin: string | null): string | null {
  if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) return null;
  return `${origin}/*`;
}

export async function hasOriginAccess(origin: string | null): Promise<boolean> {
  const pattern = patternFor(origin);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

/** Asks for one origin; true when granted (or already held). Must be called from a user gesture. */
export async function requestOriginAccess(origin: string | null): Promise<boolean> {
  const pattern = patternFor(origin);
  if (!pattern) return false;
  return chrome.permissions.request({ origins: [pattern] });
}

const ALL = '<all_urls>';

export async function hasAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [ALL] });
}

/** Asks for every site — the one setting that cannot know its origins in advance. */
export async function requestAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.request({ origins: [ALL] });
}
