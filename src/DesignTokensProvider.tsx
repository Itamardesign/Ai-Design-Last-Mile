import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DesignTokens, DesignTokensSource } from './types.js';
import { fallbackDesignTokens } from './detect/defaultTokens.js';
import { detectTokensFromLiveCss } from './detect/detectFromLiveCss.js';
import { auditPageForTokenSuggestions } from './detect/auditForSuggestions.js';

type DesignTokensContextValue = {
  tokens: DesignTokens;
  source: DesignTokensSource;
  /** Re-run the DOM audit and adopt its result as the active tokens (user-triggered — see HandoffInspector's "Generate design system" action). */
  generateFromPage: () => void;
};

const DesignTokensContext = createContext<DesignTokensContextValue | null>(null);

export type DesignTokensProviderProps = {
  children: ReactNode;
  /**
   * Tokens already known to the host project — e.g. produced ahead of time by
   * `loadStaticDesignTokens()` (see detect/loadStaticConfig.node.ts) and imported as JSON.
   * When omitted, the provider detects live CSS variables, and falls back to generic defaults.
   */
  tokens?: DesignTokens;
};

/**
 * Resolves tokens in priority order: explicit `tokens` prop -> live CSS custom properties on
 * the current page -> built-in generic fallback. Wrap your app (or just the inspector) in this
 * once; `HandoffInspector` reads from it via `useDesignTokens()`.
 */
export function DesignTokensProvider({ children, tokens }: DesignTokensProviderProps) {
  const [generated, setGenerated] = useState<DesignTokens | null>(null);

  const generateFromPage = useCallback(() => {
    setGenerated(auditPageForTokenSuggestions());
  }, []);

  const value = useMemo<DesignTokensContextValue>(() => {
    if (generated) return { tokens: generated, source: 'generated-audit', generateFromPage };
    if (tokens) return { tokens, source: 'provided', generateFromPage };
    const live = typeof document !== 'undefined' ? detectTokensFromLiveCss() : null;
    if (live) return { tokens: live, source: 'detected-live-css', generateFromPage };
    return { tokens: fallbackDesignTokens, source: 'fallback-default', generateFromPage };
  }, [tokens, generated, generateFromPage]);

  return <DesignTokensContext.Provider value={value}>{children}</DesignTokensContext.Provider>;
}

/** Falls back to generic defaults (no live detection) when used outside a provider, so the inspector never crashes if someone forgets to wrap it. */
export function useDesignTokens(): DesignTokensContextValue {
  const ctx = useContext(DesignTokensContext);
  if (ctx) return ctx;
  return { tokens: fallbackDesignTokens, source: 'fallback-default', generateFromPage: () => {} };
}
