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

import { GOOGLE_FONTS } from '../../src/fontCatalog.js';
import { loadGoogleFamilies } from './webfont.js';

let started = false;

/**
 * Fetches the Google families so their previews render in the real face.
 *
 * Called only when the font picker is first opened, never on mount: this is the one thing the
 * inspector does that reaches the network, and a page that never opens the picker should not pay
 * for it or contact fonts.googleapis.com at all.
 */
export function ensureGoogleFontsLoaded(): void {
  if (started) return;
  started = true;
  void loadGoogleFamilies(GOOGLE_FONTS.map((font) => `${font.label}:wght@400;700`));
}
