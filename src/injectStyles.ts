import { designToolsCss } from './generated/designToolsCss.js';

const STYLE_ELEMENT_ID = 'merakimind-design-inspector-styles';

let injected = false;

/**
 * Adds the inspector stylesheet to the document once, on first render.
 *
 * This exists so consumers don't have to wire up a CSS import (and so the package can be
 * imported in Node/SSR/test environments, where there is no document and this is a no-op).
 * The id guard also keeps things sane if two copies of the package end up on the page.
 */
export function ensureDesignToolsStyles(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;

  injected = true;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = designToolsCss;
  document.head.appendChild(style);
}
