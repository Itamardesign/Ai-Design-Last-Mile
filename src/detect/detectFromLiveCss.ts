import type { DesignSystemCollection, DesignTokens, RadiusToken, SpacingToken } from '../types';

const HEX_OR_FUNC_COLOR = /^(#|rgb|hsl|oklch|lab|lch|color\()/i;

function isColorValue(value: string): boolean {
  return HEX_OR_FUNC_COLOR.test(value.trim());
}

function isLengthValue(value: string): boolean {
  return /^-?\d*\.?\d+(px|rem|em)$/.test(value.trim());
}

/**
 * Reads every `--custom-property` declared on `:root` across same-origin stylesheets
 * (cross-origin sheets throw on `.cssRules` access and are skipped) and buckets them into
 * colors / spacing / radius by shape. Used when a project has CSS variables but no
 * tokens file the static detector can parse.
 */
export function detectTokensFromLiveCss(doc: Document = document): DesignTokens | null {
  const found = new Map<string, string>();

  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet, can't introspect
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!/:root/.test(rule.selectorText)) continue;
      const style = rule.style;
      for (let i = 0; i < style.length; i++) {
        const prop = style.item(i);
        if (!prop.startsWith('--')) continue;
        const value = style.getPropertyValue(prop).trim();
        if (value) found.set(prop, value);
      }
    }
  }

  if (found.size === 0) return null;

  const colors: { label: string; value: string }[] = [];
  const spacing: SpacingToken[] = [];
  const radius: RadiusToken[] = [];

  for (const [prop, value] of found) {
    const name = prop.replace(/^--/, '');
    if (isColorValue(value)) {
      colors.push({ label: name, value });
    } else if (isLengthValue(value)) {
      if (/radius/i.test(name)) radius.push({ name, value });
      else spacing.push({ name, value });
    }
  }

  if (colors.length === 0 && spacing.length === 0 && radius.length === 0) return null;

  const collection: DesignSystemCollection = {
    id: 'live-css',
    name: 'Detected from page CSS',
    colors,
    typography: [],
  };

  return {
    collections: [collection],
    spacing,
    radius,
  };
}
