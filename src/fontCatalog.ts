import { GOOGLE_FONT_FAMILIES } from './googleFontsCatalog.js';

/**
 * The fonts the picker offers, beyond the ones already on the page.
 *
 * Kept as data (not markup) so the picker can group and preview them uniformly, and so the
 * Google list can be swapped without touching the component.
 */

export type FontOption = {
  /** The family on its own — what a designer calls the font. */
  label: string;
  /** The full stack applied to the element, fallbacks intact. */
  stack: string;
  /** Google Fonts' broad classification, used for the fallback and future filtering. */
  category?: string;
};

export type FontGroup = {
  id: 'project' | 'system' | 'google';
  label: string;
  hint: string;
  fonts: FontOption[];
};

/**
 * Faces that render without downloading anything.
 *
 * These are safe to preview offline and safe to ship: every one resolves to something already
 * installed, so choosing one never introduces a webfont request into the host project.
 */
export const SYSTEM_FONTS: FontOption[] = [
  { label: 'System UI', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  { label: 'Trebuchet MS', stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { label: 'Palatino', stack: '"Palatino Linotype", Palatino, serif' },
  { label: 'Courier New', stack: '"Courier New", Courier, monospace' },
];

const GOOGLE_FALLBACKS: Record<string, string> = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Monospace: 'monospace',
  Handwriting: 'cursive',
  Display: 'sans-serif',
};

/** Every family in Google's public catalogue, generated from its metadata endpoint. */
export const GOOGLE_FONTS: FontOption[] = GOOGLE_FONT_FAMILIES.map(([label, category]) => ({
  label,
  category,
  stack: `${JSON.stringify(label)}, ${GOOGLE_FALLBACKS[category] ?? 'sans-serif'}`,
}));

const loadedGoogleFonts = new Set<string>();
let googleFontBatch = 0;

/**
 * Fetches a displayed batch of Google families so their previews render in the real face.
 *
 * Called only while the font picker is open, never on mount. Keeping the full catalogue as local
 * data and loading only visible rows avoids thousands of requests when somebody opens the picker.
 */
export function ensureGoogleFontsLoaded(fonts: FontOption[]): void {
  if (typeof document === 'undefined') return;
  const pending = fonts.filter((font) => !loadedGoogleFonts.has(font.label));
  pending.forEach((font) => loadedGoogleFonts.add(font.label));

  // Short URLs are more reliable across browsers and proxies than one catalogue-sized request.
  for (let index = 0; index < pending.length; index += 12) {
    const families = pending.slice(index, index + 12)
      .map((font) => `family=${encodeURIComponent(font.label).replace(/%20/g, '+')}`)
      .join('&');
    const link = document.createElement('link');
    link.id = `merakimind-design-inspector-google-fonts-${googleFontBatch++}`;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }
}

/** Groups the page's own fonts first — those are the ones a designer should reach for by default. */
export function buildFontGroups(projectFonts: FontOption[]): FontGroup[] {
  const groups: FontGroup[] = [];
  if (projectFonts.length) {
    groups.push({ id: 'project', label: 'Project fonts', hint: 'Already used on this site', fonts: projectFonts });
  }
  groups.push({ id: 'system', label: 'System fonts', hint: 'Installed everywhere · no download', fonts: SYSTEM_FONTS });
  groups.push({ id: 'google', label: 'Google Fonts', hint: `${GOOGLE_FONTS.length} families · previews load as needed`, fonts: GOOGLE_FONTS });
  return groups;
}
