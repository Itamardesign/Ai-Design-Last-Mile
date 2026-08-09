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

/**
 * The ten most-used families on Google Fonts.
 *
 * Ten is a deliberate cap: the point is a quick way to try a different direction, not a browsable
 * catalogue of thousands. Anything more specific belongs in the project's own CSS.
 */
export const GOOGLE_FONTS: FontOption[] = [
  { label: 'Roboto', stack: 'Roboto, sans-serif' },
  { label: 'Open Sans', stack: '"Open Sans", sans-serif' },
  { label: 'Montserrat', stack: 'Montserrat, sans-serif' },
  { label: 'Lato', stack: 'Lato, sans-serif' },
  { label: 'Poppins', stack: 'Poppins, sans-serif' },
  { label: 'Inter', stack: 'Inter, sans-serif' },
  { label: 'Roboto Condensed', stack: '"Roboto Condensed", sans-serif' },
  { label: 'Oswald', stack: 'Oswald, sans-serif' },
  { label: 'Raleway', stack: 'Raleway, sans-serif' },
  { label: 'Nunito', stack: 'Nunito, sans-serif' },
];

const GOOGLE_LINK_ID = 'merakimind-design-inspector-google-fonts';

/**
 * Fetches the Google families so their previews render in the real face.
 *
 * Called only when the font picker is first opened, never on mount: this is the one thing the
 * inspector does that reaches the network, and a page that never opens the picker should not pay
 * for it or contact fonts.googleapis.com at all.
 */
export function ensureGoogleFontsLoaded(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(GOOGLE_LINK_ID)) return;

  const families = GOOGLE_FONTS.map((font) => `family=${font.label.replace(/ /g, '+')}:wght@400;700`).join('&');
  const link = document.createElement('link');
  link.id = GOOGLE_LINK_ID;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}

/** Groups the page's own fonts first — those are the ones a designer should reach for by default. */
export function buildFontGroups(projectFonts: FontOption[]): FontGroup[] {
  const groups: FontGroup[] = [];
  if (projectFonts.length) {
    groups.push({ id: 'project', label: 'Project fonts', hint: 'Already used on this site', fonts: projectFonts });
  }
  groups.push({ id: 'system', label: 'System fonts', hint: 'Installed everywhere · no download', fonts: SYSTEM_FONTS });
  groups.push({ id: 'google', label: 'Google Fonts', hint: 'Ten most popular · needs adding to your project', fonts: GOOGLE_FONTS });
  return groups;
}
