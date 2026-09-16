/**
 * The font catalogue, with one thing changed for the extension: how Google previews are loaded.
 *
 * In an app the picker appends `<link href="fonts.googleapis.com/css2?...">` and the app's own CSP
 * allows it. On a stranger's site that link is refused, so the bytes come in over the extension's
 * own fetch instead (see webfont.ts). Everything else is re-exported untouched, and the build
 * points the inspector's `fontCatalog` import here — the call site never changes.
 */
export { SYSTEM_FONTS, GOOGLE_FONTS, buildFontGroups } from '../../src/fontCatalog.js';
export type { FontOption, FontGroup } from '../../src/fontCatalog.js';

import type { FontOption } from '../../src/fontCatalog.js';
import { loadGoogleFamilies } from './webfont.js';

const loaded = new Set<string>();

/**
 * Fetches a displayed batch of Google families so their previews render in the real face.
 *
 * Called only while the picker is open. The extension fetches only newly displayed families and
 * registers them through FontFace so a host page's content security policy cannot block previews.
 */
export function ensureGoogleFontsLoaded(fonts: FontOption[]): void {
  const pending = fonts.filter((font) => !loaded.has(font.label));
  pending.forEach((font) => loaded.add(font.label));
  if (pending.length) void loadGoogleFamilies(pending.map((font) => font.label));
}
