/**
 * The extension's own settings: which design systems the designer has connected, and which one
 * applies where.
 *
 * Everything lives in `chrome.storage.local` rather than `sync`, because a real tokens file is
 * routinely tens of kilobytes and `sync` caps a single item at 8KB. The trade-off is that
 * connected systems stay on this machine, which matches how the tool is used — you connect the
 * system you are designing against right now.
 */
import type { DesignTokens } from '../../src/types.js';
import { normalizeDesignTokens, type NormalizeResult } from './tokens.js';

/** Sentinel for "read the design language off the page instead of using a connected system". */
export const DETECT = '__detect__';

export type StoredSystem = {
  id: string;
  name: string;
  /** `paste` keeps the JSON in `raw`; `url` re-fetches from `url` and caches the result in `raw`. */
  source: 'paste' | 'url';
  url?: string;
  raw: string;
  tokens: DesignTokens | null;
  shape: string;
  warnings: string[];
  counts: NormalizeResult['counts'];
  updatedAt: number;
  /** Set when the last refresh of a `url` system failed, so the UI can say so without re-fetching. */
  error?: string;
};

export type Settings = {
  version: 1;
  systems: StoredSystem[];
  /** System applied to any site without its own mapping. `DETECT` means page detection. */
  defaultSystemId: string;
  /** origin -> system id (or `DETECT`). */
  siteSystems: Record<string, string>;
  /** Origins the inspector should mount itself on, without a click. */
  autoOrigins: string[];
  /**
   * Strip `Content-Security-Policy` and `X-Frame-Options` on tabs where the inspector is running.
   *
   * The device preview loads the page in an iframe of itself, and the font picker previews Google
   * families — both of which a strict policy blocks outright. Scoped to the active tab and removed
   * the moment the inspector is switched off, so a site's policy is only relaxed while a designer
   * is looking at it.
   */
  relaxCsp: boolean;
};

export const defaultSettings: Settings = {
  version: 1,
  systems: [],
  defaultSystemId: DETECT,
  siteSystems: {},
  autoOrigins: [],
  relaxCsp: true,
};

const KEY = 'settings';

export async function readSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  if (!stored) return { ...defaultSettings };
  return {
    ...defaultSettings,
    ...stored,
    systems: Array.isArray(stored.systems) ? stored.systems : [],
    siteSystems: stored.siteSystems ?? {},
    autoOrigins: Array.isArray(stored.autoOrigins) ? stored.autoOrigins : [],
  };
}

export async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    listener({ ...defaultSettings, ...(changes[KEY].newValue as Partial<Settings>) });
  });
}

/** Normalises a URL down to the key used for per-site mappings. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) && parsed.protocol !== 'file:') return null;
    return parsed.origin === 'null' ? `${parsed.protocol}//` : parsed.origin;
  } catch {
    return null;
  }
}

/** Which system a given site is designed against: its own mapping first, then the default. */
export function systemForOrigin(settings: Settings, origin: string | null): StoredSystem | null {
  const id = (origin && settings.siteSystems[origin]) || settings.defaultSystemId;
  if (!id || id === DETECT) return null;
  return settings.systems.find((system) => system.id === id) ?? null;
}

export function makeSystem(name: string, raw: string, source: 'paste' | 'url', url?: string): StoredSystem {
  const result = normalizeDesignTokens(raw, name || 'Design system');
  return {
    id: `sys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name || result.tokens?.collections[0]?.name || 'Design system',
    source,
    url,
    raw,
    tokens: result.tokens,
    shape: result.shape,
    warnings: result.warnings,
    counts: result.counts,
    updatedAt: Date.now(),
  };
}

/** Re-reads a `url` system in place, keeping the last good tokens if the fetch fails. */
export async function refreshSystem(system: StoredSystem): Promise<StoredSystem> {
  if (system.source !== 'url' || !system.url) return system;
  try {
    const response = await fetch(system.url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const raw = await response.text();
    const result = normalizeDesignTokens(raw, system.name);
    if (!result.tokens) {
      return { ...system, error: result.warnings[0] ?? 'Nothing token-shaped at that URL.', updatedAt: Date.now() };
    }
    return {
      ...system,
      raw,
      tokens: result.tokens,
      shape: result.shape,
      warnings: result.warnings,
      counts: result.counts,
      updatedAt: Date.now(),
      error: undefined,
    };
  } catch (error) {
    return { ...system, error: (error as Error).message, updatedAt: Date.now() };
  }
}
