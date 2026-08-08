import type { ColorToken, TypographyToken } from '../types.js';

/**
 * Reads the design language actually rendered on the page.
 *
 * The CSS-variable detector (detectFromLiveCss) only sees what a project happened to declare as
 * `--custom-properties` on `:root` — it finds nothing on a site styled with plain CSS, Tailwind
 * utilities, or CSS-in-JS, and it never sees typography at all. This module works from computed
 * styles instead, so it reports the fonts and colours a visitor is really looking at regardless
 * of how they were authored.
 *
 * Everything here is heuristic and meant to be reviewed by a human, not trusted blindly.
 */

/** The inspector's own chrome must never be sampled as part of the host page's design. */
const IGNORED = '[data-inspector-ui]';

/** Elements that carry a page's actual typography, in rough order of significance. */
const TEXT_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, a, button, label, small, blockquote, th, td, figcaption, input, textarea';

const TRANSPARENT = new Set(['transparent', 'rgba(0, 0, 0, 0)']);

function isVisible(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
  return el.offsetWidth > 0 || el.offsetHeight > 0;
}

/**
 * Normalises any computed colour to `#rrggbb`.
 *
 * Computed styles always come back as `rgb()`/`rgba()`, which is unreadable in a token list and
 * won't match a hand-written hex palette. Colours carrying real transparency keep their original
 * form — flattening them to hex would silently claim a solid colour the page never renders.
 */
export function normalizeColor(value: string): string | null {
  const input = value.trim();
  if (!input || TRANSPARENT.has(input)) return null;
  if (input.startsWith('#')) return input.toLowerCase();

  const match = /^rgba?\(([^)]+)\)$/i.exec(input);
  if (!match) return input; // oklch(), color(), a named colour — pass through untouched
  const parts = match[1].split(/[,/]/).map((part) => part.trim());
  const [r, g, b] = parts.map(Number);
  if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
  if (Number.isFinite(alpha) && alpha < 0.99) return input;
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}

/** `48.4px` at a 44px font size -> `1.1`. Null when there is nothing meaningful to express. */
function toRatio(lineHeight: string, fontSize: number): string | null {
  const px = Number.parseFloat(lineHeight);
  if (!Number.isFinite(px) || !fontSize) return null; // 'normal' parses to NaN
  return String(Math.round((px / fontSize) * 100) / 100);
}

/** `0.96px` at a 12px font size -> `0.08em`. Null for `normal` and for imperceptible tracking. */
function toEm(letterSpacing: string, fontSize: number): string | null {
  const px = Number.parseFloat(letterSpacing);
  if (!Number.isFinite(px) || !fontSize || Math.abs(px) < 0.01) return null;
  return `${Math.round((px / fontSize) * 1000) / 1000}em`;
}

/** Strips the quoting computed styles add, keeping the fallback stack intact. */
function cleanFontFamily(value: string): string {
  return value.replace(/["']/g, '').trim();
}

/** The first real family in a stack — what a designer would call "the font". */
export function primaryFontFamily(stack: string): string {
  return cleanFontFamily(stack).split(',')[0]?.trim() ?? '';
}

/** True when the element paints text itself, rather than inheriting a colour it never renders. */
function hasOwnText(el: HTMLElement): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim()) return true;
  }
  return false;
}

function sampleElements(root: ParentNode, selector: string, limit: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(root.querySelectorAll(selector))) {
    if (out.length >= limit) break;
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(IGNORED)) continue;
    out.push(node);
  }
  return out;
}

type TypeSignature = {
  family: string;
  size: number;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  transform: string;
  tag: string;
  count: number;
  sample: string;
};

/** Human names for the roles a tag plays, so tokens read like a design system rather than a CSS dump. */
const TAG_LABEL: Record<string, string> = {
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  p: 'Body', li: 'List item', a: 'Link', button: 'Button', label: 'Label', small: 'Small',
  blockquote: 'Quote', th: 'Table header', td: 'Table cell', figcaption: 'Caption',
  input: 'Input', textarea: 'Input',
};

/**
 * Groups the page's text by its full type signature and returns one token per distinct style.
 *
 * Grouping on the whole signature (not just size) is what separates "24px bold display" from
 * "24px regular body" — two different tokens that a size-only pass would collapse into one.
 */
export function detectTypographyFromPage(root: ParentNode = document.body, maxTokens = 8): TypographyToken[] {
  const groups = new Map<string, TypeSignature>();

  for (const el of sampleElements(root, TEXT_SELECTOR, 1200)) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;

    const size = Number.parseFloat(cs.fontSize);
    if (!Number.isFinite(size) || size <= 0) continue;

    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const tag = el.tagName.toLowerCase();
    // Inputs legitimately have no text content; everything else needs some to prove it renders type.
    if (!text && tag !== 'input' && tag !== 'textarea') continue;

    const family = cleanFontFamily(cs.fontFamily);
    const key = [family, size, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      // Headings win ties: a signature shared by an h1 and a div is really the heading style.
      if (TAG_LABEL[tag] && !TAG_LABEL[existing.tag]) existing.tag = tag;
      continue;
    }
    groups.set(key, {
      family, size, weight: cs.fontWeight, lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing, transform: cs.textTransform,
      tag, count: 1, sample: text.slice(0, 60),
    });
  }

  const ranked = Array.from(groups.values())
    // Biggest type first: a design system is read from display size down to fine print.
    .sort((a, b) => b.size - a.size || b.count - a.count)
    .slice(0, maxTokens);

  const used = new Map<string, number>();
  return ranked.map((entry) => {
    const base = TAG_LABEL[entry.tag] ?? 'Text';
    const seen = (used.get(base) ?? 0) + 1;
    used.set(base, seen);

    const declarations = [
      `font-family: ${entry.family}`,
      `font-size: ${Math.round(entry.size * 100) / 100}px`,
      `font-weight: ${entry.weight}`,
    ];
    // Computed styles report both of these in absolute px. Re-expressing them relative to the
    // font size is what makes a token reusable at another size — `line-height: 1.1` scales,
    // `line-height: 48.4px` silently breaks the moment the size changes.
    const ratio = toRatio(entry.lineHeight, entry.size);
    if (ratio) declarations.push(`line-height: ${ratio}`);
    const tracking = toEm(entry.letterSpacing, entry.size);
    if (tracking) declarations.push(`letter-spacing: ${tracking}`);
    if (entry.transform && entry.transform !== 'none') declarations.push(`text-transform: ${entry.transform}`);

    return {
      label: seen === 1 ? base : `${base} ${seen}`,
      sample: entry.sample || 'Sample text',
      css: `${declarations.join('; ')};`,
    };
  });
}

/**
 * Distinct fonts in use, most-used first.
 *
 * `label` is the family on its own (what a designer calls the font); `stack` keeps the authored
 * fallback list, so applying it can't strip `, serif` and change how the page degrades.
 */
export function detectFontStacksFromPage(root: ParentNode = document.body): Array<{ label: string; stack: string }> {
  const counts = new Map<string, { stack: string; count: number }>();
  for (const el of sampleElements(root, TEXT_SELECTOR, 1200)) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;
    const stack = cleanFontFamily(cs.fontFamily);
    const label = primaryFontFamily(stack);
    if (!label) continue;
    const existing = counts.get(label);
    if (existing) existing.count += 1;
    else counts.set(label, { stack, count: 1 });
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([label, { stack }]) => ({ label, stack }));
}

/** Distinct font families in use, most-used first — the "what fonts does this site use" answer. */
export function detectFontFamiliesFromPage(root: ParentNode = document.body): string[] {
  return detectFontStacksFromPage(root).map((font) => font.label);
}

type ColorRole = 'text' | 'surface' | 'border' | 'accent';

const ROLE_LABEL: Record<ColorRole, string> = { text: 'Text', surface: 'Surface', border: 'Border', accent: 'Accent' };
const ROLE_USAGE: Record<ColorRole, string> = {
  text: 'Text colour',
  surface: 'Background or card surface',
  border: 'Borders and dividers',
  accent: 'Links, buttons and primary actions',
};

/**
 * Reports the page's palette split by the job each colour does.
 *
 * Role matters more than raw frequency here: the inspector suggests bindings per property, so a
 * flat "top 12 colours" list would happily offer a body-text grey as a button background. Links
 * and buttons are read separately because that is where a brand's accent colour actually lives.
 */
export function detectColorsFromPage(root: ParentNode = document.body, maxPerRole = 4): ColorToken[] {
  const counts = new Map<ColorRole, Map<string, number>>([
    ['text', new Map()], ['surface', new Map()], ['border', new Map()], ['accent', new Map()],
  ]);
  const bump = (role: ColorRole, value: string | null) => {
    if (!value) return;
    const bucket = counts.get(role)!;
    bucket.set(value, (bucket.get(value) ?? 0) + 1);
  };

  for (const el of sampleElements(root, '*', 2500)) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;

    const tag = el.tagName.toLowerCase();
    const isAction = tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button';
    const background = normalizeColor(cs.backgroundColor);

    // A colour only counts as text when the element renders text of its own. Layout wrappers
    // inherit a `color` they never paint, and counting those makes the inherited default (usually
    // black) outrank the colours the page actually uses.
    if (hasOwnText(el)) {
      // On a filled control the foreground is contrast, not brand — white on a teal button is
      // not a second accent. Only an unfilled action (a plain link) reveals the accent via text.
      bump(isAction && !background ? 'accent' : 'text', normalizeColor(cs.color));
    }

    if (background) bump(isAction ? 'accent' : 'surface', background);

    // Only count a border colour when a border is actually drawn.
    if (Number.parseFloat(cs.borderTopWidth) > 0 || Number.parseFloat(cs.borderBottomWidth) > 0) {
      bump('border', normalizeColor(cs.borderTopColor));
    }
  }

  const out: ColorToken[] = [];
  const claimed = new Set<string>();
  for (const role of ['accent', 'text', 'surface', 'border'] as ColorRole[]) {
    const ranked = Array.from(counts.get(role)!.entries()).sort((a, b) => b[1] - a[1]);
    let index = 0;
    for (const [value, count] of ranked) {
      if (index >= maxPerRole) break;
      // A colour is listed under one role only — the first, most specific one that claimed it.
      if (claimed.has(value)) continue;
      claimed.add(value);
      index += 1;
      out.push({
        label: index === 1 ? ROLE_LABEL[role] : `${ROLE_LABEL[role]} ${index}`,
        value,
        usage: `${ROLE_USAGE[role]} · seen ${count}×`,
      });
    }
  }
  return out;
}
