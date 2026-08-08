import type { ColorToken, DesignTokens, DesignTokensSource } from '../types.js';
import { detectTokensFromLiveCss } from './detectFromLiveCss.js';
import { detectColorsFromPage, detectTypographyFromPage } from './detectFromPage.js';
import { auditPageForTokenSuggestions } from './auditForSuggestions.js';
import { fallbackDesignTokens } from './defaultTokens.js';

/**
 * Builds the best available picture of the host site's design system, per category.
 *
 * Neither detector alone is sufficient. CSS custom properties are authoritative when a project
 * declares them — they carry the team's own token *names* — but they never describe typography
 * and are absent entirely on sites styled with utilities or CSS-in-JS. Computed styles always
 * work but can only report values, not intent. So each category takes declared variables when
 * they exist and falls back to what the page actually renders, rather than one source winning
 * outright and dragging generic defaults in with it.
 */
/**
 * Declared variables first, then any rendered colour they don't already cover.
 *
 * Taking declared variables alone would be too literal: a project that defines `--brand-plum`
 * and nothing else would get a two-colour palette with no text, surface or border to bind
 * against, even though the page plainly uses them. Taking rendered colours alone would throw
 * away the team's own names. The union keeps the names where they exist and fills the gaps.
 */
function mergeColors(declared: readonly ColorToken[], rendered: readonly ColorToken[]): ColorToken[] {
  const seen = new Set(declared.map((token) => token.value.trim().toLowerCase()));
  const extra = rendered.filter((token) => !seen.has(token.value.trim().toLowerCase()));
  return [...declared, ...extra];
}

export function resolveDetectedTokens(doc: Document = document): { tokens: DesignTokens; source: DesignTokensSource } {
  const declared = detectTokensFromLiveCss(doc);
  const body = doc.body;

  // Typography is never available from :root variables, so it always comes from the rendered page.
  const typography = detectTypographyFromPage(body);
  const colors = mergeColors(declared?.collections[0]?.colors ?? [], detectColorsFromPage(body));

  let spacing = declared?.spacing.length ? declared.spacing : [];
  let radius = declared?.radius.length ? declared.radius : [];
  if (spacing.length === 0 || radius.length === 0) {
    const measured = auditPageForTokenSuggestions(body);
    if (spacing.length === 0) spacing = measured.spacing;
    if (radius.length === 0) radius = measured.radius;
  }

  if (colors.length === 0 && typography.length === 0) {
    return { tokens: fallbackDesignTokens, source: 'fallback-default' };
  }

  return {
    tokens: {
      collections: [{
        id: 'detected',
        name: declared ? 'Detected from this site' : 'Detected from this page',
        colors,
        typography: typography.length ? typography : fallbackDesignTokens.collections[0].typography,
      }],
      spacing: spacing.length ? spacing : fallbackDesignTokens.spacing,
      radius: radius.length ? radius : fallbackDesignTokens.radius,
    },
    source: declared ? 'detected-live-css' : 'generated-audit',
  };
}
