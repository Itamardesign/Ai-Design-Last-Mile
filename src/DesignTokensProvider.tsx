import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DesignTokens, DesignTokensSource } from './types.js';
import { fallbackDesignTokens } from './detect/defaultTokens.js';
import { auditPageForTokenSuggestions } from './detect/auditForSuggestions.js';
import { resolveDetectedTokens } from './detect/resolveTokens.js';

type Detected = { tokens: DesignTokens; source: DesignTokensSource };

/**
 * Runs page detection once, after mount.
 *
 * Deliberately not done during render: reading computed styles for a few thousand elements is
 * measurable work, and on the server there is no page to read at all. Waiting for the effect
 * means the first paint is never blocked and SSR stays identical to the client's first render.
 */
function usePageDetection(active: boolean): Detected | null {
  const [detected, setDetected] = useState<Detected | null>(null);

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    setDetected(resolveDetectedTokens(document));
  }, [active]);

  return active ? detected : null;
}

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
  // Only scan the page when the host has not supplied tokens of its own — otherwise the work is wasted.
  const detected = usePageDetection(!tokens);

  const generateFromPage = useCallback(() => {
    setGenerated(auditPageForTokenSuggestions());
  }, []);

  const value = useMemo<DesignTokensContextValue>(() => {
    if (generated) return { tokens: generated, source: 'generated-audit', generateFromPage };
    if (tokens) return { tokens, source: 'provided', generateFromPage };
    if (detected) return { ...detected, generateFromPage };
    return { tokens: fallbackDesignTokens, source: 'fallback-default', generateFromPage };
  }, [tokens, generated, detected, generateFromPage]);

  return <DesignTokensContext.Provider value={value}>{children}</DesignTokensContext.Provider>;
}

/**
 * Reads the active tokens, detecting them from the live page when there is no provider.
 *
 * The provider is optional by design, and that is the common case — so this path has to detect
 * too. Returning static defaults here would mean the inspector shows a generic palette and
 * generic fonts on a site with a perfectly good design system of its own.
 */
export function useDesignTokens(): DesignTokensContextValue {
  const ctx = useContext(DesignTokensContext);
  const standalone = usePageDetection(ctx === null);
  const [generated, setGenerated] = useState<DesignTokens | null>(null);
  const generateFromPage = useCallback(() => setGenerated(auditPageForTokenSuggestions()), []);

  return useMemo<DesignTokensContextValue>(() => {
    if (ctx) return ctx;
    if (generated) return { tokens: generated, source: 'generated-audit', generateFromPage };
    if (standalone) return { ...standalone, generateFromPage };
    return { tokens: fallbackDesignTokens, source: 'fallback-default', generateFromPage };
  }, [ctx, standalone, generated, generateFromPage]);
}
