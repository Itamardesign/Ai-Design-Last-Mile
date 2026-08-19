/** The two conversations the extension has: popup <-> service worker, and service worker <-> page. */
import type { DesignTokens } from '../../src/types.js';

export type TabState = {
  tabId: number;
  /** Null when the tab is a page no extension may touch (chrome://, the Web Store, a PDF viewer). */
  origin: string | null;
  active: boolean;
  /** Name of the connected design system in force here, or null when detecting from the page. */
  systemName: string | null;
  systemId: string;
  autoStart: boolean;
  relaxCsp: boolean;
};

export type PopupRequest =
  | { type: 'state'; tabId: number }
  | { type: 'setActive'; tabId: number; active: boolean }
  | { type: 'toggle'; tabId: number }
  | { type: 'setSite'; tabId: number; systemId: string }
  | { type: 'setAutoStart'; tabId: number; autoStart: boolean }
  | { type: 'setRelaxCsp'; relaxCsp: boolean }
  | { type: 'reload'; tabId: number }
  /** Sent by the options page: is this build talking to Firebase, and as which user? */
  | { type: 'firebase' }
  /** Sent by the page, not the popup: how many notes on it are still open. */
  | { type: 'notes'; open: number }
  /** Sent by the page: photograph this tab for the handoff document. */
  | { type: 'capture' };

export type PageMessage =
  | { type: 'inspector:set'; active: boolean; tokens: DesignTokens | null; systemName: string | null }
  | { type: 'inspector:tokens'; tokens: DesignTokens | null; systemName: string | null };
