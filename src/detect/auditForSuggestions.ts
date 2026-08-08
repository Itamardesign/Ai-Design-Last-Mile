import type { DesignSystemCollection, DesignTokens } from '../types.js';
import { detectColorsFromPage, detectTypographyFromPage } from './detectFromPage.js';

const SPACING_PROPS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'];

function round(value: number): number {
  // collapse near-duplicates (7px/8px/9px -> 8px) instead of proposing one token per pixel
  return Math.round(value / 2) * 2;
}

function parsePx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Last-resort token generator: when no config file and no CSS variables exist, walk the
 * live page's computed styles and propose a starter design system from values actually
 * in use. This is a draft for a human to review, not something to write to disk unattended —
 * clustering and naming are heuristic, not semantic.
 */
export function auditPageForTokenSuggestions(root: ParentNode = document.body, sampleLimit = 4000): DesignTokens {
  const spacingValues = new Set<number>();
  const radiusValues = new Set<number>();

  const elements = root.querySelectorAll('*');
  const limit = Math.min(elements.length, sampleLimit);

  for (let i = 0; i < limit; i++) {
    const el = elements[i];
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);

    for (const prop of SPACING_PROPS) {
      const px = parsePx(cs.getPropertyValue(prop));
      if (px && px > 0) spacingValues.add(round(px));
    }

    const radiusPx = parsePx(cs.getPropertyValue('border-top-left-radius'));
    if (radiusPx && radiusPx > 0) radiusValues.add(round(radiusPx));

  }

  const collection: DesignSystemCollection = {
    id: 'audit-draft',
    name: 'Draft (generated from page audit)',
    // Role-aware colours and full type signatures (family, weight, line-height — not just size),
    // so the generated draft is something a designer can recognise as their own system.
    colors: detectColorsFromPage(root),
    typography: detectTypographyFromPage(root),
  };

  return {
    collections: [collection],
    spacing: Array.from(spacingValues)
      .sort((a, b) => a - b)
      .map((value) => ({ name: `space-${value}`, value: `${value}px` })),
    radius: Array.from(radiusValues)
      .sort((a, b) => a - b)
      .map((value) => ({ name: `radius-${value}`, value: `${value}px` })),
  };
}
