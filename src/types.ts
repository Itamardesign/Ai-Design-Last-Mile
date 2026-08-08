/**
 * Generic token shapes the inspector needs from a host project's design system.
 * Any project can satisfy this by hand, by static detection (see detect/loadStaticConfig),
 * or by live-scanning CSS custom properties (see detect/detectFromLiveCss).
 */

export type ColorToken = { label: string; value: string; usage?: string };
export type SpacingToken = { name: string; value: string };
export type RadiusToken = { name: string; value: string };
export type TypographyToken = { label: string; sample: string; css: string };

/** One switchable design language (a brand can offer more than one, e.g. "marketing" vs "product"). */
export type DesignSystemCollection = {
  id: string;
  name: string;
  colors: readonly ColorToken[];
  typography: readonly TypographyToken[];
};

export type DesignTokens = {
  /** The collection being edited against. Provide 2+ to enable the inspector's collection switcher. */
  collections: readonly DesignSystemCollection[];
  spacing: readonly SpacingToken[];
  radius: readonly RadiusToken[];
};

/** Where a DesignTokens value came from — surfaced in the inspector UI so users know what they're editing against. */
export type DesignTokensSource = 'provided' | 'detected-static' | 'detected-live-css' | 'generated-audit' | 'fallback-default';
