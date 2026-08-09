import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Code2,
  Component,
  Crosshair,
  Download,
  ExternalLink,
  FileCode2,
  Gauge,
  History,
  Image as ImageIcon,
  Layers3,
  Link2,
  LoaderCircle,
  Lock,
  Maximize2,
  Pipette,
  Monitor,
  MousePointerClick,
  MousePointer2,
  Palette,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Type,
  Unlink,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  CUSTOM_DESIGN_TOKENS_STORAGE_KEY,
  defaultDeviceForKind,
  inspectorAccessibilityThresholds,
  inspectorDevicePresets,
  inspectorResponsiveBreakpoints,
  inspectorVisualTokens,
  type CustomDesignToken,
  type DeviceKind,
  type DevicePresetId,
} from './inspectorConfig.js';
import { useDesignTokens } from './DesignTokensProvider.js';
import { fallbackDesignTokens } from './detect/defaultTokens.js';
import type { ColorToken as BrandColorToken, RadiusToken, SpacingToken } from './types.js';
import { ensureDesignToolsStyles } from './injectStyles.js';
import { detectFontStacksFromPage, primaryFontFamily } from './detect/detectFromPage.js';
import { buildFontGroups, ensureGoogleFontsLoaded, type FontOption } from './fontCatalog.js';

/**
 * Module-level (not React state): a handful of top-level helper functions below the component
 * (matchToken, findNearestToken) need the active spacing/radius scale but aren't components
 * themselves, so they can't call useDesignTokens(). The component keeps these in sync every
 * render, mirroring how the original single-project version referenced its design system as a
 * plain module constant.
 */
let activeSpacingTokens: readonly SpacingToken[] = fallbackDesignTokens.spacing;
let activeRadiusTokens: readonly RadiusToken[] = fallbackDesignTokens.radius;

type DesignScope = 'free' | 'component';
type ElementKind = 'text' | 'button' | 'link' | 'input' | 'image' | 'layout' | 'form' | 'generic';
type Side = 'top' | 'right' | 'bottom' | 'left';
type ComponentStateId = 'hover' | 'focus' | 'pressed' | 'disabled' | 'loading' | 'error';
type StateOverride = { background: string; color: string; borderColor: string; opacity: number; scale: number };

type StateRule = {
  state: string;
  selector: string;
  declarations: Array<{ property: string; value: string }>;
};

type AssetInfo = {
  id: string;
  type: 'img' | 'svg' | 'background';
  label: string;
  src: string;
  element: Element;
};

type ComponentFamilyInfo = {
  label: string;
  reason: string;
  elements: HTMLElement[];
  matchCount: number;
};

type ElementSnapshot = {
  element: HTMLElement;
  tag: string;
  kind: ElementKind;
  hint: string;
  selector: string;
  domPath: string;
  /** Structural `html > body:nth-child(n) > …` locator that resolves the same node inside a device iframe. */
  uniquePath: string;
  parentSelector: string;
  childCount: number;
  /** Whitespace-collapsed copy for display, measurement and accessibility checks. */
  text: string;
  /** Exactly what the element contains, so editing round-trips without eating spaces. */
  rawText: string;
  /** True when the element wraps markup (a `<br>`, a nested span) that plain-text editing would flatten. */
  hasMarkup: boolean;
  rect: { top: number; right: number; bottom: number; left: number; width: number; height: number };
  styles: Record<string, string>;
  colors: Array<{ property: string; value: string }>;
  attributes: Record<string, string>;
  parentDistances: Record<Side, number>;
  siblingDistances: Partial<Record<Side, number>>;
  stateRules: StateRule[];
  currentStates: string[];
  assets: AssetInfo[];
  cssSnippet: string;
  family: ComponentFamilyInfo;
};

type OriginalState = {
  element: HTMLElement;
  styleAttribute: string | null;
  innerHTML: string;
  textContent: string | null;
  value?: string;
  attributes: Array<[string, string]>;
  parent: Node | null;
  nextSibling: Node | null;
};

type DesignChange = {
  element: HTMLElement;
  selector: string;
  property: string;
  before: string;
  after: string;
  kind: 'css' | 'content' | 'attribute' | 'asset' | 'layout' | 'state' | 'token';
  /** Handoff note explaining what a designer or developer has to do in the source of truth. */
  instruction?: string;
  /** Custom property declaration a token change needs in the design system. */
  cssVariable?: { name: string; value: string };
};

type TokenBinding = {
  property: string;
  label: string;
  value: string;
  category: CustomDesignToken['category'];
  tokenName?: string;
};

type AccessibilityFinding = {
  id: string;
  label: string;
  detail: string;
  status: 'pass' | 'warning' | 'error';
};

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const LENGTH_PROPERTIES = new Set([
  'font-size', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'padding', 'margin', 'gap', 'row-gap', 'column-gap', 'border-width', 'border-radius',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'line-height', 'letter-spacing', 'top', 'right', 'bottom', 'left',
]);
const FONT_SIZES = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '28px', '32px', '40px', '48px', '56px', '64px'];
const STATE_CLASSES = ['active', 'selected', 'disabled', 'open', 'expanded', 'loading', 'error', 'success'];
const TEXT_ALIGNMENTS = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
  { value: 'justify', label: 'Justify', Icon: AlignJustify },
] as const;
const PSEUDO_RE = /:(hover|active|focus-visible|focus-within|focus)(?![\w-])/g;
const COMPONENT_STATES: Array<{ id: ComponentStateId; label: string; Icon: typeof MousePointer2 }> = [
  { id: 'hover', label: 'Hover', Icon: MousePointer2 },
  { id: 'focus', label: 'Focus', Icon: ScanSearch },
  { id: 'pressed', label: 'Pressed', Icon: MousePointerClick },
  { id: 'disabled', label: 'Disabled', Icon: Ban },
  { id: 'loading', label: 'Loading', Icon: LoaderCircle },
  { id: 'error', label: 'Error', Icon: CircleAlert },
];
const STATE_SELECTOR: Record<ComponentStateId, string> = {
  hover: ':hover',
  focus: ':focus-visible',
  pressed: ':active',
  disabled: '[aria-disabled="true"]',
  loading: '[aria-busy="true"]',
  error: '[aria-invalid="true"]',
};

const ICON_LIBRARY = [
  { label: 'Spark', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.6 4.4L6 9l4.4 1.6L12 15l1.6-4.4L18 9l-4.4-1.6L12 3Z"/><path d="m5 15-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15Z"/></svg>' },
  { label: 'Check', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>' },
  { label: 'Heart', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>' },
  { label: 'Arrow', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' },
];

/**
 * Anything on the page can drive the inspector by dispatching this event — the blog walkthrough uses
 * it to open a chapter's tool with the element it is describing already selected.
 */
export const INSPECTOR_REQUEST_EVENT = 'meraki-inspector-request';

/**
 * The inspector swallows clicks on the page so they select instead of activate. Page chrome that has
 * to keep working while the tool is open — the article's own navigation, a "try this" button — opts
 * out with `data-inspector-passthrough` and is never picked, hovered or edited.
 */
const IGNORED_SELECTOR = '[data-inspector-ui], [data-inspector-passthrough]';

export type InspectorRequest = {
  /** Selector for the element to select, resolved in the host document. */
  select?: string;
  /** Open the device preview at this size, or `none` to work straight on the page. */
  device?: DeviceKind | 'none';
  /** Section to expand and scroll to, by the id in `data-hi-section` (e.g. `token-binding`). */
  section?: string;
};

const SESSION_STORAGE_PREFIX = 'meraki-inspector-session:';
/** Kinds that can be reapplied from a selector alone; asset blobs and DOM moves cannot survive a reload. */
const REPLAYABLE_KINDS: Array<DesignChange['kind']> = ['css', 'content', 'attribute', 'token'];

type StoredChange = {
  path: string;
  selector: string;
  property: string;
  before: string;
  after: string;
  kind: DesignChange['kind'];
  instruction?: string;
  cssVariable?: { name: string; value: string };
};

type StoredSession = { savedAt: string; variables: Array<[string, string]>; changes: StoredChange[] };

/**
 * The inspector only ever does anything in a browser, but the module still gets imported and
 * first-rendered on the server (Next.js, Remix, tests). Reading `window` during render would
 * crash that render outright, so every pre-mount storage read goes through here.
 *
 * The try/catch is not just for SSR: `localStorage` also throws in private-mode Safari and in
 * sandboxed iframes, where losing a saved preference is fine but crashing the tool is not.
 */
const isBrowser = typeof window !== 'undefined';

function readStoredPreference(key: string): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionKey() {
  return `${SESSION_STORAGE_PREFIX}${window.location.pathname.replace(/\/+$/, '') || '/'}`;
}

function readStoredSession(): StoredSession | null {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(sessionKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return Array.isArray(parsed?.changes) && parsed.changes.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function round(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

const colorCache = new Map<string, string | null>();
let colorContext: CanvasRenderingContext2D | null | undefined;

/**
 * Tailwind v4 emits `oklch()`, and computed styles hand it straight back. Round-tripping through a
 * canvas resolves every color syntax the browser understands into sRGB bytes; without it any
 * unparseable color silently fell back to a single brand hex and reported itself as tokenised.
 */
function resolveColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (colorCache.has(trimmed)) return colorCache.get(trimmed)!;

  const store = (result: string | null) => { colorCache.set(trimmed, result); return result; };
  const direct = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (direct) {
    const hex = [direct[1], direct[2], direct[3]].map((part) => Math.round(Number(part)).toString(16).padStart(2, '0')).join('');
    return store(`#${hex}${direct[4] === undefined ? '' : Math.round(Number(direct[4]) * 255).toString(16).padStart(2, '0')}`);
  }
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    if (trimmed.length > 5) return store(trimmed.toLowerCase());
    const expanded = trimmed.slice(1).split('').map((part) => part + part).join('');
    return store(`#${expanded.toLowerCase()}`);
  }

  if (colorContext === undefined) colorContext = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const context = colorContext;
  if (!context) return store(null);

  // An invalid color leaves fillStyle untouched, so two different seeds reveal whether it parsed.
  context.fillStyle = '#000000';
  context.fillStyle = trimmed;
  const first = context.fillStyle;
  context.fillStyle = '#ffffff';
  context.fillStyle = trimmed;
  if (first !== context.fillStyle) return store(null);

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = trimmed;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  const channels = [red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('');
  return store(`#${channels}${alpha === 255 ? '' : alpha.toString(16).padStart(2, '0')}`);
}

function toHex(value: string) {
  if (!value) return value;
  return resolveColor(value) ?? value;
}

function toColorInput(value: string) {
  const hex = toHex(value);
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{8}$/i.test(hex)) return hex.slice(0, 7);
  return '#9373ee';
}

function readCustomDesignTokens(): CustomDesignToken[] {
  try {
    const parsed = JSON.parse(readStoredPreference(CUSTOM_DESIGN_TOKENS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTokenValue(value: string, category: CustomDesignToken['category']) {
  if (category === 'color') {
    // Never fall back to a default hex here — that would report unparseable colors as tokenised.
    const resolved = resolveColor(value);
    return resolved ? resolved.slice(0, 7).toLowerCase() : value.trim().toLowerCase();
  }
  if (category === 'spacing' || category === 'radius' || category === 'typography') return `${cssNumber(value)}px`;
  return value.trim().toLowerCase();
}

/** Exact token match for a computed value, shared by the element panel and the page-wide audit. */
function matchToken(category: CustomDesignToken['category'], value: string, colorTokens: readonly BrandColorToken[], customTokens: readonly CustomDesignToken[]) {
  const normalized = normalizeTokenValue(value, category);
  const custom = customTokens.find((token) => token.category === category && normalizeTokenValue(token.value, category) === normalized);
  if (custom) return custom.name;
  if (category === 'color') return colorTokens.find((token) => normalizeTokenValue(token.value, 'color') === normalized)?.label;
  if (category === 'spacing') return activeSpacingTokens.find((token) => normalizeTokenValue(token.value, 'spacing') === normalized)?.name;
  if (category === 'radius') return activeRadiusTokens.find((token) => normalizeTokenValue(token.value, 'radius') === normalized)?.name;
  return FONT_SIZES.includes(normalized) ? `type.${normalized.replace('px', '')}` : undefined;
}

function buildTokenBindings(snapshot: ElementSnapshot, colorTokens: readonly BrandColorToken[], customTokens: readonly CustomDesignToken[]): TokenBinding[] {
  const style = getComputedStyle(snapshot.element);
  const candidates: Array<Omit<TokenBinding, 'tokenName'>> = [
    { property: 'background-color', label: 'Fill', value: toHex(style.backgroundColor), category: 'color' },
    { property: 'color', label: 'Text', value: toHex(style.color), category: 'color' },
    { property: 'border-color', label: 'Stroke', value: toHex(style.borderColor), category: 'color' },
    { property: 'font-size', label: 'Font size', value: style.fontSize, category: 'typography' },
    { property: 'gap', label: 'Gap', value: style.gap, category: 'spacing' },
    { property: 'padding-top', label: 'Padding top', value: style.paddingTop, category: 'spacing' },
    { property: 'padding-right', label: 'Padding right', value: style.paddingRight, category: 'spacing' },
    { property: 'padding-bottom', label: 'Padding bottom', value: style.paddingBottom, category: 'spacing' },
    { property: 'padding-left', label: 'Padding left', value: style.paddingLeft, category: 'spacing' },
    { property: 'border-radius', label: 'Radius', value: style.borderRadius.split(' ')[0], category: 'radius' },
  ];

  return candidates
    .filter((item) => item.value && item.value !== 'normal' && item.value !== 'transparent' && item.value !== '#00000000')
    .map((item) => ({ ...item, tokenName: matchToken(item.category, item.value, colorTokens, customTokens) }));
}

function parseColor(value: string): [number, number, number, number] | null {
  const hex = toHex(value);
  const match = hex.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!match) return null;
  return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), match[2] ? Number.parseInt(match[2], 16) / 255 : 1];
}

function contrastRatio(foreground: string, background: string) {
  const foregroundRgb = parseColor(foreground);
  const backgroundRgb = parseColor(background);
  if (!foregroundRgb || !backgroundRgb) return null;
  const composite = foregroundRgb[3] < 1
    ? foregroundRgb.slice(0, 3).map((channel, index) => channel * foregroundRgb[3] + backgroundRgb[index] * (1 - foregroundRgb[3]))
    : foregroundRgb.slice(0, 3);
  const luminance = (rgb: number[]) => {
    const channels = rgb.map((channel) => {
      const value = channel / 255;
      return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const a = luminance(composite);
  const b = luminance(backgroundRgb.slice(0, 3));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function effectiveBackground(element: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current) {
    const value = getComputedStyle(current).backgroundColor;
    const parsed = parseColor(value);
    if (parsed && parsed[3] > .05) return value;
    current = current.parentElement;
  }
  return '#ffffff';
}

function getAccessibilityFindings(snapshot: ElementSnapshot): AccessibilityFinding[] {
  const element = snapshot.element;
  const style = getComputedStyle(element);
  const interactive = element.matches('button, a[href], input, select, textarea, [role="button"], [role="link"]');
  const accessibleName = normalizeText(element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('alt') || element.textContent || (element instanceof HTMLInputElement ? element.value || element.placeholder : ''));
  const ratio = contrastRatio(style.color, effectiveBackground(element));
  const fontSize = Number.parseFloat(style.fontSize) || 0;
  const requiredContrast = fontSize >= inspectorAccessibilityThresholds.largeTextSize ? inspectorAccessibilityThresholds.minimumLargeTextContrast : inspectorAccessibilityThresholds.minimumContrast;
  const hasFocusStyle = snapshot.stateRules.some((rule) => rule.state.includes('focus')) || ['button', 'input', 'select', 'textarea'].includes(snapshot.tag);
  const findings: AccessibilityFinding[] = [];

  findings.push({ id: 'name', label: 'Accessible name', detail: !interactive || accessibleName ? accessibleName || 'Not required for this element' : 'Interactive element has no readable label', status: !interactive || accessibleName ? 'pass' : 'error' });
  findings.push({ id: 'contrast', label: 'Text contrast', detail: ratio === null ? 'Unable to calculate against this background' : `${ratio.toFixed(2)}:1 · requires ${requiredContrast}:1`, status: ratio === null ? 'warning' : ratio >= requiredContrast ? 'pass' : 'error' });
  findings.push({ id: 'target', label: 'Touch target', detail: interactive ? `${round(snapshot.rect.width)} × ${round(snapshot.rect.height)}px · minimum ${inspectorAccessibilityThresholds.minimumTouchTarget}px` : 'Not an interactive target', status: !interactive || (snapshot.rect.width >= inspectorAccessibilityThresholds.minimumTouchTarget && snapshot.rect.height >= inspectorAccessibilityThresholds.minimumTouchTarget) ? 'pass' : 'warning' });
  findings.push({ id: 'focus', label: 'Visible focus', detail: hasFocusStyle ? 'Focus-visible behavior detected' : 'No readable focus rule was found', status: !interactive || hasFocusStyle ? 'pass' : 'warning' });
  findings.push({ id: 'font', label: 'Readable type', detail: `${fontSize}px · recommended ${inspectorAccessibilityThresholds.minimumReadableText}px or larger`, status: !snapshot.text || fontSize >= inspectorAccessibilityThresholds.minimumReadableText ? 'pass' : fontSize >= 12 ? 'warning' : 'error' });
  if (snapshot.kind === 'image') findings.push({ id: 'alt', label: 'Alternative text', detail: element.getAttribute('alt') || element.getAttribute('aria-label') || 'Image has no alt text', status: element.hasAttribute('alt') || element.hasAttribute('aria-label') ? 'pass' : 'error' });
  return findings;
}

/**
 * Nodes coming out of the device iframe belong to another realm, so `instanceof HTMLElement`
 * is always false for them. These checks work across documents.
 */
function isElementNode(value: unknown): value is HTMLElement {
  return typeof value === 'object' && value !== null && (value as Node).nodeType === 1;
}

function isFieldNode(node: Element): node is HTMLInputElement | HTMLTextAreaElement {
  const tag = node.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}

function computedStyleOf(element: Element) {
  return (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
}

function escapeClass(value: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function getSelector(element: Element) {
  if (element.id) return `#${escapeClass(element.id)}`;
  for (const key of ['data-component', 'data-design-component', 'data-ui', 'data-testid', 'data-test']) {
    const value = element.getAttribute(key);
    if (value) return `[${key}="${value.replace(/"/g, '\\"')}"]`;
  }
  const classes = Array.from(element.classList).filter((name) => name.length < 55).slice(0, 3);
  const classPart = classes.map((name) => `.${escapeClass(name)}`).join('');
  return `${element.tagName.toLowerCase()}${classPart}`;
}

/**
 * Structural locator that survives the trip into a device iframe. The iframe renders the same app
 * without the inspector UI, so nth-child indexes match as long as the markup is identical at that width.
 */
function getUniquePath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`);
    current = parent;
  }
  return parts.length ? `html > ${parts.join(' > ')}` : 'html';
}

function resolveInDocument(doc: Document, snapshot: Pick<ElementSnapshot, 'uniquePath' | 'selector'>) {
  try {
    const exact = doc.querySelector<HTMLElement>(snapshot.uniquePath);
    if (exact) return exact;
  } catch { /* Structure changed at this breakpoint. */ }
  try {
    return doc.querySelector<HTMLElement>(snapshot.selector);
  } catch {
    return null;
  }
}

function getDomPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
      parts.unshift(part);
      break;
    }
    const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((child) => child.tagName === current!.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function classifyElement(element: HTMLElement): { kind: ElementKind; hint: string } {
  const tag = element.tagName.toLowerCase();
  const style = computedStyleOf(element);
  if (tag === 'button' || element.getAttribute('role') === 'button') return { kind: 'button', hint: 'Button' };
  if (tag === 'a') return { kind: 'link', hint: 'Link' };
  if (['input', 'textarea', 'select'].includes(tag)) return { kind: 'input', hint: tag === 'select' ? 'Dropdown' : 'Input' };
  if (tag === 'img' || tag === 'svg' || element.querySelector(':scope > img, :scope > svg')) return { kind: 'image', hint: 'Image / icon' };
  if (tag === 'form') return { kind: 'form', hint: 'Form' };
  if (style.display.includes('flex')) return { kind: 'layout', hint: 'Group / flex' };
  if (style.display.includes('grid')) return { kind: 'layout', hint: 'Group / grid' };
  if (/^(p|span|h[1-6]|label|strong|em|small)$/.test(tag) || element.children.length === 0 && normalizeText(element.textContent)) return { kind: 'text', hint: 'Text' };
  return { kind: 'generic', hint: 'Group' };
}

function visible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest(IGNORED_SELECTOR);
}

function getComponentFamily(selected: HTMLElement, kind: ElementKind): ComponentFamilyInfo {
  let candidates: HTMLElement[] = [];
  let reason = 'Selected element only';
  for (const key of ['data-component', 'data-design-component', 'data-ui', 'data-testid', 'data-test']) {
    const value = selected.getAttribute(key);
    if (value) {
      candidates = Array.from(document.querySelectorAll<HTMLElement>(`[${key}="${value.replace(/"/g, '\\"')}"]`));
      reason = `${key}="${value}"`;
      break;
    }
  }
  if (!candidates.length) {
    const stableClasses = Array.from(selected.classList).filter((name) => name.length < 48 && !name.includes(':')).slice(0, 2);
    if (stableClasses.length) {
      const query = `${selected.tagName.toLowerCase()}${stableClasses.map((name) => `.${escapeClass(name)}`).join('')}`;
      try {
        candidates = Array.from(document.querySelectorAll<HTMLElement>(query));
        reason = `tag + ${stableClasses.join(' + ')}`;
      } catch { candidates = []; }
    }
  }
  if (!candidates.length && selected.getAttribute('role')) {
    candidates = Array.from(document.querySelectorAll<HTMLElement>(`${selected.tagName.toLowerCase()}[role="${selected.getAttribute('role')}"]`));
    reason = 'tag + role';
  }
  if (!candidates.length) candidates = [selected];
  candidates = candidates.filter((element) => visible(element) && classifyElement(element).kind === kind).slice(0, 60);
  if (!candidates.includes(selected)) candidates.unshift(selected);
  else candidates = [selected, ...candidates.filter((element) => element !== selected)];
  return {
    label: selected.getAttribute('data-component') || selected.getAttribute('aria-label') || classifyElement(selected).hint,
    reason,
    elements: candidates,
    matchCount: candidates.length,
  };
}

function getReadableStateRules(element: HTMLElement): StateRule[] {
  const found: StateRule[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && PSEUDO_RE.test(rule.selectorText)) {
        PSEUDO_RE.lastIndex = 0;
        const baseSelector = rule.selectorText.replace(PSEUDO_RE, '').replace(/\s+/g, ' ').trim();
        PSEUDO_RE.lastIndex = 0;
        try {
          if (baseSelector && (element.matches(baseSelector) || Boolean(element.closest(baseSelector)))) {
            const state = Array.from(rule.selectorText.matchAll(PSEUDO_RE)).map((match) => match[1]).join(', ');
            PSEUDO_RE.lastIndex = 0;
            found.push({
              state,
              selector: rule.selectorText,
              declarations: Array.from(rule.style).map((property) => ({ property, value: rule.style.getPropertyValue(property).trim() })),
            });
          }
        } catch { /* Ignore selectors the browser cannot test. */ }
      } else if ('cssRules' in rule) {
        try { visit((rule as CSSGroupingRule).cssRules); } catch { /* Ignore inaccessible nested rules. */ }
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* Cross-origin stylesheet. */ }
  }
  return found.slice(0, 18);
}

function getAssets(element: HTMLElement): AssetInfo[] {
  const assets: AssetInfo[] = [];
  const descendants = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*')).slice(0, 80)];
  let imageIndex = 0;
  let svgIndex = 0;
  let backgroundIndex = 0;
  for (const node of descendants) {
    if (node instanceof HTMLImageElement) {
      assets.push({ id: `img-${imageIndex++}`, type: 'img', label: node.alt || 'Image', src: node.currentSrc || node.src, element: node });
    }
    if (node instanceof SVGSVGElement) {
      const clone = node.cloneNode(true) as SVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const text = new XMLSerializer().serializeToString(clone);
      assets.push({ id: `svg-${svgIndex++}`, type: 'svg', label: node.getAttribute('aria-label') || 'Inline SVG', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, element: node });
    }
    const background = getComputedStyle(node).backgroundImage;
    const match = background.match(/url\(["']?(.+?)["']?\)/);
    if (match) assets.push({ id: `bg-${backgroundIndex++}`, type: 'background', label: 'Background image', src: match[1], element: node });
  }
  return assets;
}

function overlaps(a: DOMRect, b: DOMRect, axis: 'x' | 'y') {
  return axis === 'x' ? Math.max(a.left, b.left) < Math.min(a.right, b.right) : Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}

function getSiblingDistances(element: HTMLElement, rect: DOMRect) {
  const result: Partial<Record<Side, number>> = {};
  const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((sibling): sibling is HTMLElement => sibling instanceof HTMLElement && sibling !== element && visible(sibling)) : [];
  for (const sibling of siblings) {
    const other = sibling.getBoundingClientRect();
    const candidates: Array<[Side, number, boolean]> = [
      ['top', rect.top - other.bottom, overlaps(rect, other, 'x')],
      ['right', other.left - rect.right, overlaps(rect, other, 'y')],
      ['bottom', other.top - rect.bottom, overlaps(rect, other, 'x')],
      ['left', rect.left - other.right, overlaps(rect, other, 'y')],
    ];
    for (const [side, distance, isOverlapping] of candidates) {
      if (isOverlapping && distance >= 0 && (result[side] === undefined || distance < result[side]!)) result[side] = round(distance);
    }
  }
  return result;
}

function createSnapshot(element: HTMLElement): ElementSnapshot {
  const computed = getComputedStyle(element);
  const rawRect = element.getBoundingClientRect();
  const parentRect = element.parentElement?.getBoundingClientRect() ?? rawRect;
  const { kind, hint } = classifyElement(element);
  const styles: Record<string, string> = {
    display: computed.display,
    position: computed.position,
    'flex-direction': computed.flexDirection,
    'align-items': computed.alignItems,
    'justify-content': computed.justifyContent,
    gap: computed.gap,
    'grid-template-columns': computed.gridTemplateColumns,
    margin: computed.margin,
    padding: computed.padding,
    border: `${computed.borderWidth} ${computed.borderStyle} ${toHex(computed.borderColor)}`,
    'border-radius': computed.borderRadius,
    background: toHex(computed.backgroundColor),
    color: toHex(computed.color),
    'font-family': computed.fontFamily,
    'font-size': computed.fontSize,
    'font-weight': computed.fontWeight,
    'line-height': computed.lineHeight,
    'letter-spacing': computed.letterSpacing,
    'text-align': computed.textAlign,
    'box-shadow': computed.boxShadow,
    opacity: computed.opacity,
    filter: computed.filter,
    transform: computed.transform,
    transition: computed.transition,
    'object-fit': computed.objectFit,
    'object-position': computed.objectPosition,
  };
  const colors = [
    { property: 'Text', value: toHex(computed.color) },
    { property: 'Background', value: toHex(computed.backgroundColor) },
    { property: 'Border', value: toHex(computed.borderColor) },
  ].filter((item, index, list) => item.value && item.value !== 'transparent' && item.value !== '#00000000' && list.findIndex((candidate) => candidate.value === item.value) === index);
  const cssProperties = ['width', 'height', 'display', 'position', 'flex-direction', 'align-items', 'justify-content', 'gap', 'margin', 'padding', 'border', 'border-radius', 'background', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'box-shadow', 'opacity', 'filter', 'transform', 'transition'];
  const cssSnippet = `${getSelector(element)} {\n${cssProperties.map((property) => `  ${property}: ${property === 'width' ? `${round(rawRect.width)}px` : property === 'height' ? `${round(rawRect.height)}px` : styles[property]};`).join('\n')}\n}`;
  const attributes = Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]));
  const isField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  const rawText = isField ? element.value : element.textContent ?? '';
  const text = isField ? rawText : normalizeText(rawText);
  return {
    element,
    tag: element.tagName.toLowerCase(),
    kind,
    hint,
    selector: getSelector(element),
    domPath: getDomPath(element),
    uniquePath: getUniquePath(element),
    parentSelector: element.parentElement ? getSelector(element.parentElement) : 'none',
    childCount: element.children.length,
    text,
    rawText,
    hasMarkup: !isField && element.children.length > 0,
    rect: { top: rawRect.top, right: rawRect.right, bottom: rawRect.bottom, left: rawRect.left, width: rawRect.width, height: rawRect.height },
    styles,
    colors,
    attributes,
    parentDistances: {
      top: round(rawRect.top - parentRect.top),
      right: round(parentRect.right - rawRect.right),
      bottom: round(parentRect.bottom - rawRect.bottom),
      left: round(rawRect.left - parentRect.left),
    },
    siblingDistances: getSiblingDistances(element, rawRect),
    stateRules: getReadableStateRules(element),
    currentStates: STATE_CLASSES.filter((state) => element.classList.contains(state) || element.getAttribute(`aria-${state}`) === 'true'),
    assets: getAssets(element),
    cssSnippet,
    family: getComponentFamily(element, kind),
  };
}

function normalizeCssValue(property: string, value: string) {
  const trimmed = value.trim();
  if (LENGTH_PROPERTIES.has(property) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
  return trimmed;
}

function openDesignSystem() {
  const url = new URL(window.location.href);
  url.searchParams.set('design', 'true');
  if (['/ai-design-guide', '/no-ai-slop'].includes(window.location.pathname.replace(/\/+$/, ''))) url.searchParams.set('system', 'guide');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="hi-copy" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1100); }}>{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? 'Copied' : label}</button>;
}

/** `Fill & stroke` → `fill-stroke`, so a section can be addressed from outside the panel. */
function sectionId(title: string) {
  return title.split('·')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function ToolSection({ title, icon: Icon, children, defaultOpen = true, openWhen = false }: { title: string; icon: typeof Layers3; children: ReactNode; defaultOpen?: boolean; openWhen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);
  return <section className="hi-section" data-hi-section={sectionId(title)} data-hi-open={open ? 'true' : 'false'}><button className="hi-section-title" onClick={() => setOpen((current) => !current)}><span><Icon size={14} />{title}</span><ChevronDown size={14} className={open ? 'is-open' : ''} /></button>{open && <div className="hi-section-body">{children}</div>}</section>;
}

function PropertyRow({ label, value, copy = true }: { label: string; value: string; copy?: boolean }) {
  return <div className="hi-property"><span>{label}</span><code dir="ltr">{value || '—'}</code>{copy && value ? <CopyButton value={value} label="" /> : null}</div>;
}

function cssNumber(value: string | number, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : fallback;
}

function DraftNumberInput({ value, onCommit, min, max, step = 1, ariaLabel }: { value: string | number; onCommit: (value: string) => void; min?: number; max?: number; step?: number; ariaLabel: string }) {
  const externalValue = String(cssNumber(value));
  const [draft, setDraft] = useState(externalValue);
  const editingRef = useRef(false);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(externalValue);
  }, [externalValue]);

  const commit = (rawValue: string) => {
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) {
      setDraft(externalValue);
      return;
    }

    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
    const nextValue = String(Math.round(clamped * 100) / 100);
    setDraft(nextValue);
    if (nextValue !== externalValue) onCommit(nextValue);
  };

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={draft}
      min={min}
      max={max}
      step={step}
      onFocus={(event) => {
        editingRef.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        editingRef.current = false;
        if (cancelBlurRef.current) {
          cancelBlurRef.current = false;
          return;
        }
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelBlurRef.current = true;
          setDraft(externalValue);
          event.currentTarget.blur();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') commit(event.currentTarget.value);
      }}
    />
  );
}

/**
 * Holds its own draft while focused. Applying an edit re-snapshots the element, and a controlled
 * textarea bound to that snapshot would rewrite the field mid-keystroke — which silently ate
 * trailing and repeated spaces.
 */
function DraftTextArea({ value, onChange, ariaLabel }: { key?: string; value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  return <textarea
    aria-label={ariaLabel}
    value={draft}
    onFocus={() => { editingRef.current = true; }}
    onBlur={() => { editingRef.current = false; }}
    onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }}
  />;
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix = 'px' }: { label: string; value: string | number; onChange: (value: string) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return <label className="hi-control"><span>{label}</span><div className="hi-number-field"><DraftNumberInput ariaLabel={`${label} ${suffix}`} value={value} min={min} max={max} step={step} onCommit={onChange} /><em>{suffix}</em></div></label>;
}

function BoxSidesField({ label, property, element, onChange }: { label: string; property: 'padding' | 'margin'; element: HTMLElement; onChange: (property: string, value: string) => void }) {
  const style = getComputedStyle(element);
  return <div className="hi-box-sides-control"><span>{label}</span><div>{SIDES.map((side) => <label key={side} title={`${property}-${side}`}><small>{side[0].toUpperCase()}</small><DraftNumberInput ariaLabel={`${label} ${side}`} value={style.getPropertyValue(`${property}-${side}`)} onCommit={(value) => onChange(`${property}-${side}`, value)} /><em>px</em></label>)}</div></div>;
}

/**
 * Font picker that previews each face in itself.
 *
 * A native `<select>` cannot do this reliably — `font-family` on `<option>` is ignored by most
 * browsers — and picking type from a list of names alone is guesswork. Grouping matters as much
 * as previewing: the fonts already on the site are a different kind of choice from a Google face
 * the project would still have to install, and the list says so rather than mixing them.
 */
function FontField({ label, value, projectFonts, onChange }: { label: string; value: string; projectFonts: FontOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => buildFontGroups(projectFonts), [projectFonts]);
  const current = primaryFontFamily(value) || 'Inherited';

  useEffect(() => {
    if (!open) return;
    // Only reaches the network once the user actually opens the list.
    ensureGoogleFontsLoaded();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return <div className="hi-control hi-font-field" ref={rootRef}>
    <span>{label}</span>
    <div className="hi-font-picker">
      <button type="button" className="hi-font-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((state) => !state)}>
        <span className="hi-font-current" style={{ fontFamily: value || undefined }}>{current}</span>
        <ChevronDown size={13} />
      </button>
      {open && <div className="hi-font-menu" role="listbox">
        {groups.map((group) => <section key={group.id}>
          <header><strong>{group.label}</strong><small>{group.hint}</small></header>
          {group.fonts.map((font) => {
            const active = primaryFontFamily(value).toLowerCase() === font.label.toLowerCase();
            return <button
              type="button"
              key={`${group.id}-${font.label}`}
              role="option"
              aria-selected={active}
              className={active ? 'is-active' : ''}
              onClick={() => { onChange(font.stack); setOpen(false); }}
            >
              <span className="hi-font-name">{font.label}</span>
              {/* The preview is the point: it renders in the face being offered, not the panel's. */}
              <span className="hi-font-sample" style={{ fontFamily: font.stack }}>Ag 123</span>
            </button>;
          })}
        </section>)}
      </div>}
    </div>
  </div>;
}

function TokenColorField({ label, value, tokens, onChange }: { label: string; value: string; tokens: readonly BrandColorToken[]; onChange: (value: string) => void }) {
  const hex = toColorInput(value);
  const matched = tokens.find((token) => token.value.toLowerCase() === hex.toLowerCase());

  // Swatches rather than a dropdown: a palette is something you scan, not read. Names still
  // travel with each swatch as a tooltip, so the token behind a colour stays discoverable.
  return <div className="hi-token-field hi-swatch-field">
    <span>{label}</span>
    <div className="hi-swatches">
      {tokens.map((token) => {
        const active = token.value.toLowerCase() === hex.toLowerCase();
        return <button
          type="button"
          key={`${token.label}-${token.value}`}
          className={`hi-swatch ${active ? 'is-active' : ''}`}
          style={{ background: token.value }}
          title={`${token.label} · ${token.value}${token.usage ? ` · ${token.usage}` : ''}`}
          aria-label={`${token.label} ${token.value}`}
          aria-pressed={active}
          onClick={() => onChange(token.value)}
        />;
      })}
      {/* Always available: the palette is a starting point, not a cage. */}
      <label className="hi-swatch hi-swatch-custom" title={`Pick any colour · currently ${toHex(value)}`}>
        <span style={{ background: hex }} />
        <Pipette size={11} />
        <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} aria-label={`${label} custom colour`} />
      </label>
      <output className="hi-swatch-value">{matched ? matched.label : toHex(value)}</output>
    </div>
  </div>;
}

const DEVICE_KIND_ICON: Record<DeviceKind, typeof Monitor> = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };
const ZOOM_STEPS = [0.5, 0.75, 1] as const;

type ResponsiveIssueId = 'hidden' | 'overflow' | 'edge' | 'type' | 'padding' | 'target';
type ResponsiveIssue = { id: ResponsiveIssueId; text: string };

const RESPONSIVE_ISSUE_LABEL: Record<ResponsiveIssueId, string> = {
  hidden: 'Hidden or collapsed',
  overflow: 'Page scrolls sideways',
  edge: 'No breathing room at the edges',
  type: `Type below ${inspectorAccessibilityThresholds.minimumReadableText}px`,
  padding: 'Control padding too tight for touch',
  target: `Touch target under ${inspectorAccessibilityThresholds.minimumTouchTarget}px`,
};

type DeviceMetrics = {
  found: boolean;
  width: number;
  height: number;
  fontSize: number;
  padding: string;
  issues: ResponsiveIssue[];
};

function measureInFrame(node: HTMLElement, snapshot: ElementSnapshot, viewportWidth: number): DeviceMetrics {
  const rect = node.getBoundingClientRect();
  const style = computedStyleOf(node);
  const fontSize = Number.parseFloat(style.fontSize) || 0;
  const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const documentWidth = node.ownerDocument.documentElement.scrollWidth;
  const control = ['button', 'link', 'input'].includes(snapshot.kind);
  const issues: ResponsiveIssue[] = [];
  if (rect.width === 0 || rect.height === 0) issues.push({ id: 'hidden', text: 'Element is hidden or collapsed at this size.' });
  else {
    if (documentWidth > viewportWidth + 1) issues.push({ id: 'overflow', text: `The page scrolls sideways — content is ${round(documentWidth - viewportWidth)}px wider than the screen.` });
    if (rect.width > viewportWidth - 16) issues.push({ id: 'edge', text: 'This element fills the full width with almost no side margin.' });
    if (snapshot.text && fontSize < inspectorAccessibilityThresholds.minimumReadableText) issues.push({ id: 'type', text: `Typography drops to ${fontSize}px — below the ${inspectorAccessibilityThresholds.minimumReadableText}px minimum.` });
    if (control && horizontalPadding < 24) issues.push({ id: 'padding', text: 'Horizontal control padding is tight for touch.' });
    if (control && (rect.width < inspectorAccessibilityThresholds.minimumTouchTarget || rect.height < inspectorAccessibilityThresholds.minimumTouchTarget)) issues.push({ id: 'target', text: `Touch target is under ${inspectorAccessibilityThresholds.minimumTouchTarget}px.` });
  }
  return {
    found: true,
    width: round(rect.width),
    height: round(rect.height),
    fontSize,
    padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    issues,
  };
}

/** Widths the sweep samples — the common phone/tablet/laptop steps plus the awkward gaps between them. */
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 600, 768, 834, 1024, 1280, 1440];

function nearestPresetForWidth(target: number): DevicePresetId {
  return inspectorDevicePresets.reduce((best, item) => Math.abs(item.width - target) < Math.abs(best.width - target) ? item : best).id;
}

type SweepPoint = { width: number; found: boolean; elementWidth: number; fontSize: number; issues: ResponsiveIssue[] };
type SweepRange = { id: ResponsiveIssueId; label: string; range: string; sample: string };

/** Collapse the sampled widths where a rule failed into readable ranges: `320–414px`, `768px, 1280px`. */
function summariseSweep(points: SweepPoint[]): SweepRange[] {
  const byId = new Map<ResponsiveIssueId, { indexes: number[]; sample: string }>();
  points.forEach((point, index) => {
    for (const issue of point.issues) {
      const entry = byId.get(issue.id) ?? { indexes: [], sample: issue.text };
      entry.indexes.push(index);
      byId.set(issue.id, entry);
    }
  });
  return Array.from(byId.entries()).map(([id, entry]) => {
    const groups: number[][] = [];
    for (const index of entry.indexes) {
      const last = groups[groups.length - 1];
      if (last && index === last[last.length - 1] + 1) last.push(index);
      else groups.push([index]);
    }
    const range = groups
      .map((group) => group.length === 1 ? `${points[group[0]].width}` : `${points[group[0]].width}–${points[group[group.length - 1]].width}`)
      .join(', ');
    return { id, label: RESPONSIVE_ISSUE_LABEL[id], range: `${range}px`, sample: entry.sample };
  });
}

/**
 * Sections on this site reveal with `whileInView`, so anything off-screen sits at inline `opacity: 0`.
 * This stylesheet forces exactly those mid-reveal elements to their resting state — it matches on the
 * inline style motion writes, so it stops applying the moment an element finishes revealing.
 */
const FREEZE_REVEALS_CSS = `[style*="opacity: 0"]:not(html):not(body) { opacity: 1 !important; transform: none !important; }`;
const FREEZE_STYLE_ID = 'meraki-inspector-freeze-reveals';

const STATE_STYLE_ID = 'meraki-inspector-state-rules';
const STATE_MARK_ATTRIBUTE = 'data-hi-state-id';

/**
 * State edits cannot be written as inline styles — `:hover` has no inline form. Without a stylesheet
 * they only ever showed up in the six preview tiles, so editing a hover colour and then hovering the
 * real element did nothing at all. These rules put the edit on the live product, where the point is.
 */
function applyStateRules(doc: Document, css: string) {
  const existing = doc.getElementById(STATE_STYLE_ID);
  if (!css) { existing?.remove(); return; }
  const style = existing ?? doc.createElement('style');
  style.id = STATE_STYLE_ID;
  style.textContent = css;
  if (!existing) doc.head.appendChild(style);
}

function applyFreezeReveals(doc: Document, enabled: boolean) {
  const existing = doc.getElementById(FREEZE_STYLE_ID);
  if (!enabled) { existing?.remove(); return; }
  if (existing) return;
  const style = doc.createElement('style');
  style.id = FREEZE_STYLE_ID;
  style.textContent = FREEZE_REVEALS_CSS;
  doc.head.appendChild(style);
}

/* Direct manipulation — the same edits the panel makes, driven from the canvas instead. */

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const RESIZE_HANDLES: Array<{ id: ResizeDirection; label: string }> = [
  { id: 'nw', label: 'Resize from the top left' },
  { id: 'n', label: 'Resize from the top' },
  { id: 'ne', label: 'Resize from the top right' },
  { id: 'e', label: 'Resize from the right' },
  { id: 'se', label: 'Resize from the bottom right' },
  { id: 's', label: 'Resize from the bottom' },
  { id: 'sw', label: 'Resize from the bottom left' },
  { id: 'w', label: 'Resize from the left' },
];

/** Alt-drag snaps to this grid, in px, regardless of which project's spacing scale is active. */
const CANVAS_SNAP_STEP = 8;
const MIN_CANVAS_SIZE = 8;
const RESIZE_PROPERTIES = ['width', 'height', 'margin-left', 'margin-top'] as const;

type ResizeSession = {
  element: HTMLElement;
  direction: ResizeDirection;
  /** Device-frame zoom, so a drag at 50% still tracks the pointer one-to-one. */
  scale: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startMarginLeft: number;
  startMarginTop: number;
  ratio: number;
  /** Inline values from before the drag, so a cancel — and the commit's "before" — start from the truth. */
  inline: Record<(typeof RESIZE_PROPERTIES)[number], string>;
  /** Twin node inside the device frame, so the preview updates where the designer is actually looking. */
  mirror: HTMLElement | null;
  onUpdate: (() => void) | null;
  width: number;
  height: number;
  marginLeft: number;
  marginTop: number;
  moved: boolean;
};

function pixels(value: number) {
  return `${Math.round(value * 10) / 10}px`;
}

function beginResize(element: HTMLElement, direction: ResizeDirection, event: PointerEvent, scale: number, mirror: HTMLElement | null, onUpdate: (() => void) | null): ResizeSession {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const marginLeft = Number.parseFloat(style.marginLeft) || 0;
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  return {
    element,
    direction,
    scale: scale || 1,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    startMarginLeft: marginLeft,
    startMarginTop: marginTop,
    ratio: rect.height > 0 ? rect.width / rect.height : 1,
    inline: Object.fromEntries(RESIZE_PROPERTIES.map((property) => [property, element.style.getPropertyValue(property)])) as ResizeSession['inline'],
    mirror,
    onUpdate,
    width: rect.width,
    height: rect.height,
    marginLeft,
    marginTop,
    moved: false,
  };
}

function resizeFrame(session: ResizeSession, event: PointerEvent) {
  const dx = (event.clientX - session.startX) / session.scale;
  const dy = (event.clientY - session.startY) / session.scale;
  const horizontal = session.direction.includes('e') ? 1 : session.direction.includes('w') ? -1 : 0;
  const vertical = session.direction.includes('s') ? 1 : session.direction.includes('n') ? -1 : 0;
  let width = horizontal ? session.startWidth + horizontal * dx : session.startWidth;
  let height = vertical ? session.startHeight + vertical * dy : session.startHeight;
  // Shift on a corner keeps the proportion the element started at, the way it does in Figma.
  if (horizontal && vertical && event.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) height = width / session.ratio;
    else width = height * session.ratio;
  }
  const snap = (value: number) => Math.max(MIN_CANVAS_SIZE, event.altKey ? Math.round(value / CANVAS_SNAP_STEP) * CANVAS_SNAP_STEP : Math.round(value));
  session.width = snap(width);
  session.height = snap(height);
  // A left or top handle has to move the box as well as size it, or the opposite edge walks away
  // from the pointer and the drag feels like it is fighting back.
  session.marginLeft = horizontal < 0 ? session.startMarginLeft - (session.width - session.startWidth) : session.startMarginLeft;
  session.marginTop = vertical < 0 ? session.startMarginTop - (session.height - session.startHeight) : session.startMarginTop;
  session.moved = true;
}

/** Only the properties the dragged handle actually touches, so an edge drag never records a stray axis. */
function resizeDeclarations(session: ResizeSession): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (/[ew]/.test(session.direction)) entries.push(['width', pixels(session.width)]);
  if (/[ns]/.test(session.direction)) entries.push(['height', pixels(session.height)]);
  if (session.direction.includes('w')) entries.push(['margin-left', pixels(session.marginLeft)]);
  if (session.direction.includes('n')) entries.push(['margin-top', pixels(session.marginTop)]);
  return entries;
}

function previewResize(session: ResizeSession) {
  const declarations = resizeDeclarations(session);
  [session.element, session.mirror].forEach((node) => {
    if (node) declarations.forEach(([property, value]) => node.style.setProperty(property, value));
  });
  session.onUpdate?.();
}

/** Put the inline styles back exactly as they were — the commit path reads the live DOM for "before". */
function rollbackResize(session: ResizeSession) {
  [session.element, session.mirror].forEach((node) => {
    if (!node) return;
    RESIZE_PROPERTIES.forEach((property) => {
      const value = session.inline[property];
      if (value) node.style.setProperty(property, value);
      else node.style.removeProperty(property);
    });
  });
}

type TextEditSession = { element: HTMLElement; original: string; field: boolean; stop: () => void };

/**
 * Turns an element into an editable box in place. Editing is refused on anything that wraps markup,
 * because the commit writes plain text and would flatten a `<br>` or a nested span without warning.
 */
function beginTextEdit(element: HTMLElement, handlers: { onCommit: () => void; onCancel: () => void }): TextEditSession | null {
  const field = isFieldNode(element);
  if (!field && element.children.length > 0) return null;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const original = field ? (element as HTMLInputElement).value : element.textContent ?? '';
  const previousEditable = element.getAttribute('contenteditable');

  if (field) {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.select();
  } else {
    // `plaintext-only` keeps pasted markup out; browsers without it fall back to full contenteditable.
    element.setAttribute('contenteditable', 'plaintext-only');
    if (element.contentEditable !== 'plaintext-only') element.setAttribute('contenteditable', 'true');
    element.setAttribute('data-hi-editing', '');
    element.focus();
    const range = doc.createRange();
    range.selectNodeContents(element);
    const selection = view?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  // Typing stops at the element: host pages bind their own window shortcuts, and the guide treats
  // space as "next slide", which would otherwise fire on every word.
  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handlers.onCommit(); }
    else if (event.key === 'Escape') { event.preventDefault(); handlers.onCancel(); }
  };
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text/plain');
    if (text === undefined) return;
    event.preventDefault();
    doc.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  };
  const onBlur = () => handlers.onCommit();
  element.addEventListener('keydown', onKeyDown, true);
  element.addEventListener('paste', onPaste);
  element.addEventListener('blur', onBlur);

  return {
    element,
    original,
    field,
    stop: () => {
      element.removeEventListener('keydown', onKeyDown, true);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('blur', onBlur);
      if (!field) {
        if (previousEditable === null) element.removeAttribute('contenteditable');
        else element.setAttribute('contenteditable', previousEditable);
        element.removeAttribute('data-hi-editing');
      }
      element.blur();
    },
  };
}

function readTextEdit(session: TextEditSession) {
  return session.field ? (session.element as HTMLInputElement).value : session.element.textContent ?? '';
}

function revertTextEdit(session: TextEditSession) {
  if (session.field) (session.element as HTMLInputElement).value = session.original;
  else session.element.textContent = session.original;
}

/** The eight grab points, drawn inside whichever selection box is already positioned over the element. */
function CanvasHandles({ size, onStart }: { size: string | null; onStart: (direction: ResizeDirection, event: ReactPointerEvent) => void }) {
  return <>
    {RESIZE_HANDLES.map((handle) => <button
      key={handle.id}
      type="button"
      className={`hi-handle hi-handle--${handle.id}`}
      title={`${handle.label} · Shift keeps the ratio, Alt snaps to ${CANVAS_SNAP_STEP}px`}
      aria-label={handle.label}
      onPointerDown={(event) => onStart(handle.id, event)}
    />)}
    {size && <span className="hi-handle-size">{size}</span>}
  </>;
}

function DeviceOverlay({ presetId, onPresetChange, snapshot, dock, hidden, editVersion, canvasEdit, canvasSize, canvasBusyRef, onCanvasResize, onCanvasText, onFrameDocument, onSelectPath, onReplay, onClose, onExit }: {
  presetId: DevicePresetId;
  onPresetChange: (id: DevicePresetId) => void;
  snapshot: ElementSnapshot | null;
  dock: 'left' | 'right';
  hidden: boolean;
  editVersion: number;
  canvasEdit: boolean;
  canvasSize: string | null;
  /** Set while a canvas drag owns the pointer, so Escape cancels the drag instead of closing the preview. */
  canvasBusyRef: { current: boolean };
  onCanvasResize: (direction: ResizeDirection, event: ReactPointerEvent, scale: number, onUpdate: () => void) => void;
  onCanvasText: (path: string, value: string) => void;
  onFrameDocument: (doc: Document | null) => void;
  onSelectPath: (path: string) => boolean;
  onReplay: (doc: Document) => void;
  onClose: () => void;
  /** The overlay fills the screen, so its X is read as "close the tool", not "close this one pane". */
  onExit: () => void;
}) {
  const preset = inspectorDevicePresets.find((item) => item.id === presetId) ?? inspectorDevicePresets[1];
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  // Mirrors whatever direction the host page is actually in, so a Hebrew or Arabic site previews
  // right-to-left. The manual LTR/RTL toggle that used to sit in the toolbar is gone; following
  // the page is the behaviour that was worth keeping.
  const direction = isBrowser && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  const [freezeReveals, setFreezeReveals] = useState(true);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [picking, setPicking] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [sweepProgress, setSweepProgress] = useState(0);
  const [sweep, setSweep] = useState<{ points: SweepPoint[]; ranges: SweepRange[] } | null>(null);
  const sweepRef = useRef<HTMLIFrameElement>(null);
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [hoverBox, setHoverBox] = useState<{ top: number; left: number; width: number; height: number; label: string } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [metrics, setMetrics] = useState<DeviceMetrics | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameDocumentRef = useRef(onFrameDocument);
  const replayRef = useRef(onReplay);
  const frameEditRef = useRef<TextEditSession | null>(null);
  const canvasTextRef = useRef(onCanvasText);
  frameDocumentRef.current = onFrameDocument;
  replayRef.current = onReplay;
  canvasTextRef.current = onCanvasText;

  const width = orientation === 'portrait' ? preset.width : preset.height;
  const height = orientation === 'portrait' ? preset.height : preset.width;
  const bezel = preset.chrome === 'browser' ? 0 : preset.chrome === 'phone' ? 13 : 17;
  const chromeBar = preset.chrome === 'browser' ? 36 : 0;
  const shellWidth = width + bezel * 2;
  const shellHeight = height + bezel * 2 + chromeBar;
  const fitScale = stageSize.width && stageSize.height ? Math.min(1, stageSize.width / shellWidth, stageSize.height / shellHeight) : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;

  const previewUrl = (() => {
    const url = new URL(window.location.href);
    ['inspect', 'design', 'system', 'responsiveSelector', 'responsiveBreakpoint'].forEach((parameter) => url.searchParams.delete(parameter));
    return url.toString();
  })();

  const measureStage = useCallback(() => {
    const node = stageRef.current;
    if (!node) return;
    setStageSize((current) => {
      const next = { width: node.clientWidth - 24, height: node.clientHeight - 24 };
      return current.width === next.width && current.height === next.height ? current : next;
    });
  }, []);

  useEffect(() => {
    measureStage();
    const node = stageRef.current;
    // ResizeObserver is the accurate signal, but it is only delivered while the page renders,
    // so a resize listener and the mount measurement keep the fit scale correct either way.
    const observer = node ? new ResizeObserver(measureStage) : null;
    if (node && observer) observer.observe(node);
    window.addEventListener('resize', measureStage);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureStage);
    };
  }, [measureStage]);

  // The footer grows once measurements and issues arrive, which shortens the stage.
  useEffect(() => { measureStage(); }, [measureStage, presetId, orientation, dock, metrics, note]);

  useEffect(() => () => frameDocumentRef.current(null), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A canvas drag or an inline text edit owns Escape first — closing the preview underneath it
      // would strand the edit half-applied.
      if (canvasBusyRef.current) return;
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key.toLowerCase() === 'p' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setPicking((current) => !current); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canvasBusyRef, onClose]);

  /** Keep the drawn overlays and the measurement in sync with whatever the frame is currently showing. */
  const sync = useCallback(() => {
    if (!frameDoc || !snapshot) { setSelectionBox(null); setMetrics(null); return; }
    const node = resolveInDocument(frameDoc, snapshot);
    if (!node) {
      setSelectionBox(null);
      setMetrics({ found: false, width: 0, height: 0, fontSize: 0, padding: '—', issues: [{ id: 'hidden', text: 'This element is not rendered at this screen size.' }] });
      return;
    }
    const rect = node.getBoundingClientRect();
    setSelectionBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    setMetrics(measureInFrame(node, snapshot, width));
  }, [frameDoc, snapshot, width]);

  useEffect(() => { sync(); }, [sync, editVersion]);

  useEffect(() => {
    if (!frameDoc) return;
    const view = frameDoc.defaultView;
    if (!view) return;
    const onScrollOrResize = () => { sync(); setHoverBox(null); };
    view.addEventListener('scroll', onScrollOrResize, true);
    view.addEventListener('resize', onScrollOrResize);
    return () => {
      view.removeEventListener('scroll', onScrollOrResize, true);
      view.removeEventListener('resize', onScrollOrResize);
    };
  }, [frameDoc, sync]);

  // Only scroll when the element is actually off-screen, and never smoothly — a smooth scroll
  // re-triggers every reveal animation it passes on the way.
  useEffect(() => {
    if (!frameDoc || !snapshot || hidden) return;
    const node = resolveInDocument(frameDoc, snapshot);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const viewportHeight = frameDoc.documentElement.clientHeight;
    if (rect.bottom > 0 && rect.top < viewportHeight) return;
    node.scrollIntoView({ block: 'center', inline: 'center' });
  }, [frameDoc, snapshot, hidden]);

  useEffect(() => {
    if (!frameDoc) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !canvasBusyRef.current) onClose(); };
    frameDoc.addEventListener('keydown', onKey, true);
    return () => frameDoc.removeEventListener('keydown', onKey, true);
  }, [canvasBusyRef, frameDoc, onClose]);

  // Mirroring the site's Hebrew direction is a supported review mode, not a cosmetic flip.
  useEffect(() => {
    if (!frameDoc) return;
    frameDoc.documentElement.setAttribute('dir', direction);
    const settle = window.setTimeout(sync, 140);
    return () => window.clearTimeout(settle);
  }, [frameDoc, direction, sync]);

  useEffect(() => {
    if (!frameDoc) return;
    applyFreezeReveals(frameDoc, freezeReveals);
    const settle = window.setTimeout(sync, 120);
    return () => window.clearTimeout(settle);
  }, [frameDoc, freezeReveals, sync]);

  useEffect(() => { setSweep(null); }, [presetId, orientation, direction, snapshot]);

  /**
   * Sweeps a throwaway off-screen frame across every sampled width and records which rules fail where,
   * so the answer is "it breaks from 320 to 414px", not "toggle three devices and squint".
   */
  const runSweep = async () => {
    const frame = sweepRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc || !snapshot) { setSweeping(false); return; }
    doc.documentElement.setAttribute('dir', direction);
    applyFreezeReveals(doc, freezeReveals);
    const settle = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const points: SweepPoint[] = [];
    for (const [index, sweepWidth] of SWEEP_WIDTHS.entries()) {
      frame.style.width = `${sweepWidth}px`;
      await settle(70);
      // Reapply the live edits at each width: the markup can differ per breakpoint, so a single
      // replay at load would miss elements that only exist at some sizes.
      replayRef.current(doc);
      // Sections animate in on scroll, so bring the element into view before measuring it.
      resolveInDocument(doc, snapshot)?.scrollIntoView({ block: 'center' });
      await settle(90);
      const node = resolveInDocument(doc, snapshot);
      if (!node) points.push({ width: sweepWidth, found: false, elementWidth: 0, fontSize: 0, issues: [{ id: 'hidden', text: 'Not rendered at this width.' }] });
      else {
        const measured = measureInFrame(node, snapshot, sweepWidth);
        points.push({ width: sweepWidth, found: true, elementWidth: measured.width, fontSize: measured.fontSize, issues: measured.issues });
      }
      setSweepProgress(index + 1);
    }
    setSweep({ points, ranges: summariseSweep(points) });
    setSweeping(false);
  };

  const startSweep = () => { setSweep(null); setSweepProgress(0); setSweeping(true); };

  useEffect(() => {
    if (!frameDoc || !picking) { setHoverBox(null); return; }
    const onMove = (event: PointerEvent) => {
      const target = frameDoc.elementFromPoint(event.clientX, event.clientY);
      if (!isElementNode(target) || target.closest(IGNORED_SELECTOR)) return setHoverBox(null);
      const rect = target.getBoundingClientRect();
      setHoverBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, label: `${classifyElement(target).hint} · ${round(rect.width)} × ${round(rect.height)}` });
    };
    const onLeave = () => setHoverBox(null);
    const onClickCapture = (event: MouseEvent) => {
      const target = frameDoc.elementFromPoint(event.clientX, event.clientY);
      // Page chrome inside the frame — the article's own navigation — has to keep working, so the
      // picker leaves it alone rather than turning every click into a selection.
      if (!isElementNode(target) || target.closest(IGNORED_SELECTOR)) return;
      // Clicks inside the box being retyped belong to the caret, not to the picker.
      const editing = frameEditRef.current?.element;
      if (editing && (editing === target || editing.contains(target))) return;
      event.preventDefault();
      event.stopPropagation();
      setNote(onSelectPath(getUniquePath(target)) ? null : 'That element only exists at this screen size, so it cannot be edited from the panel yet.');
    };
    frameDoc.addEventListener('pointermove', onMove, true);
    frameDoc.addEventListener('pointerleave', onLeave, true);
    frameDoc.addEventListener('click', onClickCapture, true);
    return () => {
      frameDoc.removeEventListener('pointermove', onMove, true);
      frameDoc.removeEventListener('pointerleave', onLeave, true);
      frameDoc.removeEventListener('click', onClickCapture, true);
    };
  }, [frameDoc, picking, onSelectPath]);

  /**
   * Double-click retypes text right inside the device. The frame node is edited live so the designer
   * sees the result at the size they are reviewing, then the value is committed against the element in
   * the host document — that is where the change log, the CSS diff and the mirror all hang off.
   */
  useEffect(() => {
    if (!frameDoc || !canvasEdit) return;

    const finish = (commit: boolean) => {
      const session = frameEditRef.current;
      if (!session) return;
      frameEditRef.current = null;
      canvasBusyRef.current = false;
      session.stop();
      const next = readTextEdit(session);
      revertTextEdit(session);
      if (!commit || normalizeText(next) === normalizeText(session.original)) return;
      canvasTextRef.current(getUniquePath(session.element), next);
    };

    const onDoubleClick = (event: MouseEvent) => {
      const target = frameDoc.elementFromPoint(event.clientX, event.clientY);
      if (!isElementNode(target) || target.closest(IGNORED_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
      if (frameEditRef.current?.element === target) return;
      finish(true);
      const session = beginTextEdit(target, { onCommit: () => finish(true), onCancel: () => finish(false) });
      if (!session) {
        setNote('That element wraps other elements — edit its text from the Content section in the panel.');
        return;
      }
      setNote(null);
      frameEditRef.current = session;
      canvasBusyRef.current = true;
    };

    frameDoc.addEventListener('dblclick', onDoubleClick, true);
    return () => {
      frameDoc.removeEventListener('dblclick', onDoubleClick, true);
      finish(false);
    };
  }, [canvasBusyRef, canvasEdit, frameDoc]);

  const handleLoad = () => {
    const doc = frameRef.current?.contentDocument ?? null;
    setFrameDoc(doc);
    frameDocumentRef.current(doc);
    // `load` can beat the app's first paint, so give the tree a moment before replaying edits onto it.
    if (doc) window.setTimeout(() => replayRef.current(doc), 80);
  };

  const kinds: DeviceKind[] = ['mobile', 'tablet', 'desktop'];
  const modelsForKind = inspectorDevicePresets.filter((item) => item.kind === preset.kind);

  return <div className={`hi-device-overlay hi-device-overlay--${dock} ${hidden ? 'is-hidden' : ''}`} role="dialog" aria-modal={!hidden} aria-hidden={hidden} aria-label={`${preset.label} preview`}>
    <div className="hi-device-toolbar">
      <div className="hi-device-kinds" role="group" aria-label="Device type">
        {kinds.map((kind) => {
          const Icon = DEVICE_KIND_ICON[kind];
          return <button key={kind} className={preset.kind === kind ? 'is-active' : ''} aria-pressed={preset.kind === kind} onClick={() => onPresetChange(defaultDeviceForKind[kind])}><Icon size={15} />{kind}</button>;
        })}
      </div>
      <select className="hi-device-model" aria-label="Device model" value={preset.id} onChange={(event) => onPresetChange(event.target.value as DevicePresetId)}>
        {modelsForKind.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.width}×{item.height}</option>)}
      </select>
      <span className="hi-device-size">{width} × {height}</span>
      <div className="hi-device-actions">
        <button className={picking ? 'is-active' : ''} aria-pressed={picking} title="Pick an element inside the device (Ctrl/Cmd + P)" onClick={() => setPicking((current) => !current)}><Crosshair size={15} /></button>
        <button title="Rotate" onClick={() => setOrientation((current) => current === 'portrait' ? 'landscape' : 'portrait')}><RotateCw size={15} /></button>
        <button className={freezeReveals ? 'is-active' : ''} aria-pressed={freezeReveals} title={freezeReveals ? 'Reveal animations are frozen — click to watch them play' : 'Freeze reveal animations so sections stay visible'} onClick={() => setFreezeReveals((current) => !current)}><Sparkles size={15} /></button>
        <button title="Reload the device frame" onClick={() => { setReloadKey((current) => current + 1); setFrameDoc(null); }}><RefreshCw size={15} /></button>
        <div className="hi-device-zoom" role="group" aria-label="Zoom">
          <button className={zoom === 'fit' ? 'is-active' : ''} onClick={() => setZoom('fit')}>Fit</button>
          {ZOOM_STEPS.map((step) => <button key={step} className={zoom === step ? 'is-active' : ''} onClick={() => setZoom(step)}>{step * 100}%</button>)}
        </div>
        <button className="hi-device-close" title="Close the design tool (Esc)" onClick={onExit}><X size={16} /></button>
      </div>
    </div>

    <div className="hi-device-stage" ref={stageRef}>
      <div className="hi-device-sizer" style={{ width: shellWidth * scale, height: shellHeight * scale }}>
        <div className={`hi-device-shell hi-device-shell--${preset.chrome}`} style={{ width: shellWidth, height: shellHeight, transform: `scale(${scale})`, padding: bezel, borderRadius: preset.radius + bezel }}>
          {preset.chrome === 'browser' && <div className="hi-device-chrome" style={{ height: chromeBar }}><i /><i /><i /><span>{window.location.host}{window.location.pathname}</span></div>}
          <div className="hi-device-viewport" style={{ width, height, borderRadius: preset.radius }}>
            <iframe key={reloadKey} ref={frameRef} title={`${preset.label} live preview`} src={previewUrl} onLoad={handleLoad} style={{ width, height }} />
            {selectionBox && <span className="hi-device-marker is-selected" style={{ top: selectionBox.top, left: selectionBox.left, width: selectionBox.width, height: selectionBox.height }}>
              {canvasEdit && snapshot && <CanvasHandles size={canvasSize} onStart={(direction, event) => onCanvasResize(direction, event, scale, sync)} />}
            </span>}
            {picking && hoverBox && <span className="hi-device-marker" style={{ top: hoverBox.top, left: hoverBox.left, width: hoverBox.width, height: hoverBox.height }}><b>{hoverBox.label}</b></span>}
          </div>
          {preset.chrome === 'phone' && <><em className="hi-device-notch" /><em className="hi-device-home" /></>}
        </div>
      </div>
    </div>

    <div className="hi-device-footer">
      <div className="hi-device-readout">
        {snapshot ? <><strong>{snapshot.family.label}</strong>{metrics?.found ? <small>{metrics.width} × {metrics.height}px · {metrics.fontSize}px type · padding {metrics.padding}</small> : <small>{metrics ? 'Not rendered at this size' : 'Measuring…'}</small>}</> : <small>Pick an element inside the device to start editing it in the panel.</small>}
        {canvasEdit && <span className="hi-canvas-hint"><Maximize2 size={12} />Drag the handles to resize · double-click text to retype</span>}
        {snapshot && <button className="hi-sweep-run" disabled={sweeping} onClick={startSweep}><Gauge size={14} />{sweeping ? `Sweeping ${sweepProgress}/${SWEEP_WIDTHS.length}…` : 'Run breakpoint sweep'}</button>}
      </div>
      {note && <p className="hi-device-note"><CircleAlert size={14} />{note}</p>}
      {metrics?.found && !sweep && <div className={`hi-responsive-result ${metrics.issues.length ? 'has-issues' : 'is-clear'}`}>{metrics.issues.length ? <><CircleAlert size={15} /><span>{metrics.issues.map((issue) => <small key={issue.id}>{issue.text}</small>)}</span></> : <><CheckCircle2 size={15} /><span><strong>Looks healthy</strong><small>Width, spacing and typography fit this screen.</small></span></>}</div>}

      {sweep && <div className="hi-sweep-report">
        <div className="hi-sweep-strip" role="group" aria-label="Sweep results by width">
          {sweep.points.map((point) => <button key={point.width} className={point.issues.length ? 'has-issues' : 'is-clear'} title={`${point.issues.map((issue) => issue.text).join('\n') || 'No issues at this width'}\n\nClick to jump to the closest device.`} onClick={() => onPresetChange(nearestPresetForWidth(point.width))}>
            <em>{point.width}</em><small>{point.found ? `${point.elementWidth}px · ${point.fontSize}px` : 'absent'}</small>
          </button>)}
        </div>
        {sweep.ranges.length
          ? <div className="hi-sweep-ranges">{sweep.ranges.map((entry) => <div key={entry.id}><CircleAlert size={14} /><span><strong>{entry.label}</strong><small>{entry.sample}</small></span><code>{entry.range}</code></div>)}</div>
          : <div className="hi-responsive-result is-clear"><CheckCircle2 size={15} /><span><strong>Clean from {SWEEP_WIDTHS[0]}px to {SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1]}px</strong><small>No overflow, undersized type or small touch targets at any sampled width.</small></span></div>}
        <div className="hi-sweep-actions">
          <CopyButton label="Copy sweep report" value={`Breakpoint sweep · ${snapshot?.selector ?? ''}\n${sweep.ranges.length ? sweep.ranges.map((entry) => `- ${entry.label}: ${entry.range}`).join('\n') : `- No issues between ${SWEEP_WIDTHS[0]}px and ${SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1]}px`}`} />
          <button onClick={() => setSweep(null)}>Clear</button>
        </div>
      </div>}
    </div>

    {sweeping && <iframe ref={sweepRef} className="hi-sweep-frame" title="Breakpoint sweep" src={previewUrl} onLoad={runSweep} style={{ width: SWEEP_WIDTHS[0], height }} />}
  </div>;
}

function ResponsiveLauncher({ activeKind, onOpen }: { activeKind: DeviceKind | null; onOpen: (kind: DeviceKind) => void }) {
  return <div className="hi-responsive-tool">
    <div className="hi-responsive-launcher">
      {inspectorResponsiveBreakpoints.map((item) => {
        const Icon = DEVICE_KIND_ICON[item.id as DeviceKind];
        return <button key={item.id} className={activeKind === item.id ? 'is-active' : ''} onClick={() => onOpen(item.id as DeviceKind)}>
          <Icon size={17} /><span>{item.label}</span><small>{item.width} × {item.height}</small>
        </button>;
      })}
    </div>
    <p className="hi-empty-note">Opens the page at real device size over the canvas. Edits you make in this panel apply live inside it, and you can click any element in the device to select it here.</p>
  </div>;
}

type TokenSuggestion = { name: string; value: string; distance: number };

function colorDistance(a: string, b: string) {
  const first = parseColor(a);
  const second = parseColor(b);
  if (!first || !second) return null;
  return Math.sqrt((first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2 + (first[2] - second[2]) ** 2);
}

/** The nearest existing token, so a near-miss value gets rebound instead of minting yet another local token. */
function findNearestToken(binding: Pick<TokenBinding, 'category' | 'value'>, colorTokens: readonly BrandColorToken[], customTokens: readonly CustomDesignToken[]): TokenSuggestion | null {
  const pick = (pool: Array<{ name: string; value: string }>, measure: (value: string) => number | null, tolerance: number) => {
    let best: TokenSuggestion | null = null;
    for (const token of pool) {
      const distance = measure(token.value);
      if (distance === null) continue;
      if (!best || distance < best.distance) best = { name: token.name, value: token.value, distance };
    }
    return best && best.distance > 0 && best.distance <= tolerance ? best : null;
  };

  if (binding.category === 'color') {
    const pool = [
      ...customTokens.filter((token) => token.category === 'color').map((token) => ({ name: token.name, value: token.value })),
      ...colorTokens.map((token) => ({ name: token.label, value: token.value })),
    ];
    return pick(pool, (value) => colorDistance(binding.value, value), 46);
  }
  if (binding.category === 'spacing' || binding.category === 'radius') {
    const scale = binding.category === 'spacing' ? activeSpacingTokens : activeRadiusTokens;
    const current = cssNumber(binding.value);
    return pick(scale.map((token) => ({ name: token.name, value: token.value })), (value) => Math.abs(cssNumber(value) - current), 4);
  }
  return null;
}

function tokenVariableName(name: string) {
  return `--${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

/** `Text` on a color becomes `local.color.text`, `Radius` on a radius stays `local.radius`. */
function suggestTokenName(binding: TokenBinding, existing: readonly CustomDesignToken[]) {
  const slug = binding.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = slug && slug !== binding.category ? `local.${binding.category}.${slug}` : `local.${binding.category}`;
  const taken = existing.find((token) => token.name === base);
  if (!taken || taken.value === normalizeTokenValue(binding.value, binding.category)) return base;
  let suffix = 2;
  while (existing.some((token) => token.name === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Paste-ready source for `src/designSystem.ts`, so local tokens can actually reach the repo. */
function buildTokenExport(tokens: readonly CustomDesignToken[]) {
  if (!tokens.length) return '';
  const scale = (category: CustomDesignToken['category']) => tokens.filter((token) => token.category === category);
  const blocks: string[] = [`// Captured with the Meraki inspector on ${window.location.pathname} — add to src/designSystem.ts`];
  const colors = scale('color');
  if (colors.length) {
    blocks.push(`export const localColorTokens: readonly BrandColorToken[] = [\n${colors.map((token) => `  { label: '${token.name}', value: '${token.value}', usage: 'Captured from ${token.property}' },`).join('\n')}\n] as const;`);
  }
  for (const [category, name] of [['spacing', 'localSpacingTokens'], ['radius', 'localRadiusTokens'], ['typography', 'localTypographyTokens']] as const) {
    const entries = scale(category);
    if (entries.length) blocks.push(`export const ${name} = [\n${entries.map((token) => `  { name: '${token.name}', value: '${token.value}' },`).join('\n')}\n] as const;`);
  }
  blocks.push(`/* CSS custom properties */\n:root {\n${tokens.map((token) => `  ${tokenVariableName(token.name)}: ${token.value};`).join('\n')}\n}`);
  return blocks.join('\n\n');
}

type AuditEntry = { key: string; category: CustomDesignToken['category']; value: string; count: number; tokenName?: string; nearest: TokenSuggestion | null; sample: HTMLElement };
type AuditGroup = { category: CustomDesignToken['category']; label: string; total: number; bound: number; near: number; loose: number; entries: AuditEntry[] };

const AUDIT_GROUP_LABEL: Record<CustomDesignToken['category'], string> = { color: 'Colors', spacing: 'Spacing', radius: 'Radii', typography: 'Type sizes' };

/**
 * Walks the whole page and buckets every distinct visual value, so a system owner sees
 * "23 distinct colors, 8 tokenised, 4 within a hair of an existing token" instead of one element at a time.
 */
function auditPage(colorTokens: readonly BrandColorToken[], customTokens: readonly CustomDesignToken[]): { scanned: number; groups: AuditGroup[] } {
  const entries = new Map<string, AuditEntry>();
  const add = (category: CustomDesignToken['category'], rawValue: string, element: HTMLElement) => {
    if (!rawValue || rawValue === 'normal' || rawValue === 'none' || rawValue === 'auto') return;
    const value = category === 'color' ? toHex(rawValue) : `${cssNumber(rawValue)}px`;
    if (category === 'color' && (value === 'transparent' || value.length === 9 && value.endsWith('00'))) return;
    const key = `${category}:${normalizeTokenValue(value, category)}`;
    const existing = entries.get(key);
    if (existing) { existing.count += 1; return; }
    entries.set(key, {
      key,
      category,
      value,
      count: 1,
      tokenName: matchToken(category, value, colorTokens, customTokens),
      nearest: findNearestToken({ category, value }, colorTokens, customTokens),
      sample: element,
    });
  };

  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter((element) => !element.closest(IGNORED_SELECTOR)).slice(0, 1500);
  let scanned = 0;
  for (const element of all) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    scanned += 1;
    add('color', style.color, element);
    const background = parseColor(style.backgroundColor);
    if (background && background[3] > 0.02) add('color', style.backgroundColor, element);
    if ((Number.parseFloat(style.borderTopWidth) || 0) > 0) add('color', style.borderTopColor, element);
    add('typography', style.fontSize, element);
    add('radius', style.borderTopLeftRadius, element);
    for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) add('spacing', style[side], element);
    if (style.gap && style.gap !== 'normal') add('spacing', style.gap.split(' ')[0], element);
  }

  const groups = (['color', 'spacing', 'radius', 'typography'] as const).map((category) => {
    const list = Array.from(entries.values()).filter((entry) => entry.category === category).sort((a, b) => b.count - a.count);
    return {
      category,
      label: AUDIT_GROUP_LABEL[category],
      total: list.length,
      bound: list.filter((entry) => entry.tokenName).length,
      near: list.filter((entry) => !entry.tokenName && entry.nearest).length,
      loose: list.filter((entry) => !entry.tokenName && !entry.nearest).length,
      entries: list,
    };
  }).filter((group) => group.total > 0);

  return { scanned, groups };
}

function PageTokenAudit({ colorTokens, onSelect }: { colorTokens: readonly BrandColorToken[]; onSelect: (element: HTMLElement) => void }) {
  const [report, setReport] = useState<{ scanned: number; groups: AuditGroup[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [expanded, setExpanded] = useState<CustomDesignToken['category'] | null>('color');

  const scan = () => {
    setScanning(true);
    // Yield so the button paints its busy state before the synchronous walk. A timeout rather than
    // rAF, which never fires while the page is not compositing (background tab, hidden preview).
    window.setTimeout(() => {
      setReport(auditPage(colorTokens, readCustomDesignTokens()));
      setScanning(false);
    }, 0);
  };

  if (!report) {
    return <div className="hi-token-audit">
      <p className="hi-empty-note">Scans every visible element on this page and groups the colors, spacing, radii and type sizes it finds — then tells you how many are already tokens, how many are a near miss, and how many are genuinely one-off.</p>
      <button className="hi-open-system" disabled={scanning} onClick={scan}><ScanSearch size={13} />{scanning ? 'Scanning the page…' : 'Scan this page'}</button>
    </div>;
  }

  const summaryText = report.groups.map((group) => `${group.label}: ${group.total} distinct · ${group.bound} tokenised · ${group.near} near a token · ${group.loose} one-off`).join('\n');

  return <div className="hi-token-audit">
    <div className="hi-audit-summary">{report.groups.map((group) => <button key={group.category} className={expanded === group.category ? 'is-active' : ''} onClick={() => setExpanded(expanded === group.category ? null : group.category)}>
      <strong>{group.total}</strong><span>{group.label}</span><small>{group.bound} bound · {group.near} near · {group.loose} loose</small>
      <i style={{ '--audit-bound': `${group.total ? group.bound / group.total * 100 : 0}%`, '--audit-near': `${group.total ? (group.bound + group.near) / group.total * 100 : 0}%` } as CSSProperties} />
    </button>)}</div>

    {expanded && report.groups.filter((group) => group.category === expanded).map((group) => <div key={group.category} className="hi-audit-list">
      {group.entries.slice(0, 24).map((entry) => <button key={entry.key} className={entry.tokenName ? 'is-bound' : entry.nearest ? 'is-near' : 'is-loose'} onClick={() => onSelect(entry.sample)} title="Select the first element using this value">
        {entry.category === 'color' ? <i style={{ background: entry.value }} /> : <i className="hi-audit-metric">{cssNumber(entry.value)}</i>}
        <span>
          <strong>{entry.value}</strong>
          <small>{entry.tokenName ? `Bound to ${entry.tokenName}` : entry.nearest ? `Near ${entry.nearest.name} · ${entry.nearest.value}` : 'One-off value'}</small>
        </span>
        <code>×{entry.count}</code>
      </button>)}
      {group.entries.length > 24 && <p className="hi-empty-note">Showing the 24 most used of {group.entries.length} distinct {group.label.toLowerCase()}.</p>}
    </div>)}

    <div className="hi-sweep-actions">
      <CopyButton label="Copy audit" value={`Token audit · ${window.location.pathname} · ${report.scanned} elements\n${summaryText}`} />
      <button onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Rescan'}</button>
    </div>
  </div>;
}

function TokenBindingPanel({ snapshot, colorTokens, onBind }: {
  snapshot: ElementSnapshot;
  colorTokens: readonly BrandColorToken[];
  onBind: (payload: { property: string; label: string; from: string; tokenName: string; tokenValue: string; variable: string; created: boolean }) => void;
}) {
  const [customTokens, setCustomTokens] = useState<CustomDesignToken[]>(readCustomDesignTokens);
  const [showExport, setShowExport] = useState(false);
  const bindings = buildTokenBindings(snapshot, colorTokens, customTokens);
  const connected = bindings.filter((binding) => binding.tokenName).length;

  const persist = (next: CustomDesignToken[]) => {
    window.localStorage.setItem(CUSTOM_DESIGN_TOKENS_STORAGE_KEY, JSON.stringify(next));
    setCustomTokens(next);
    window.dispatchEvent(new CustomEvent('meraki-design-tokens-change'));
  };

  const createToken = (binding: TokenBinding) => {
    const normalizedValue = normalizeTokenValue(binding.value, binding.category);
    const token: CustomDesignToken = {
      id: `${binding.category}-${binding.property}-${Date.now()}`,
      name: suggestTokenName(binding, customTokens),
      category: binding.category,
      property: binding.property,
      value: normalizedValue,
      createdAt: new Date().toISOString(),
    };
    persist([...customTokens, token]);
    onBind({ property: binding.property, label: binding.label, from: binding.value, tokenName: token.name, tokenValue: normalizedValue, variable: tokenVariableName(token.name), created: true });
  };

  const bindExisting = (binding: TokenBinding, suggestion: TokenSuggestion) => {
    onBind({ property: binding.property, label: binding.label, from: binding.value, tokenName: suggestion.name, tokenValue: suggestion.value, variable: tokenVariableName(suggestion.name), created: false });
  };

  const removeToken = (name: string) => persist(customTokens.filter((token) => token.name !== name));

  return <div className="hi-token-audit">
    <div className="hi-token-score"><span><strong>{connected}/{bindings.length}</strong><small>values connected</small></span><i style={{ '--token-progress': `${bindings.length ? connected / bindings.length * 100 : 100}%` } as CSSProperties} /></div>
    {connected < bindings.length && <div className="hi-token-warning"><Unlink size={15} /><span><strong>{bindings.length - connected} local values</strong><small>Promote reusable decisions instead of leaving one-off values. Every token you create is written into Designer changes with the exact instruction to apply it.</small></span></div>}
    <div className="hi-binding-list">{bindings.map((binding) => {
      const custom = customTokens.find((token) => token.name === binding.tokenName);
      const suggestion = binding.tokenName ? null : findNearestToken(binding, colorTokens, customTokens);
      return <div key={binding.property} className={binding.tokenName ? 'is-bound' : 'is-local'}>
        <div className="hi-binding-head">
          <span>{binding.tokenName ? <Link2 size={13} /> : <Unlink size={13} />}<strong>{binding.label}</strong><code>{binding.value}</code></span>
          {binding.tokenName
            ? <div className="hi-bound-token"><small>{binding.tokenName}</small>{custom && <button aria-label={`Remove ${custom.name}`} title="Remove local token" onClick={() => removeToken(custom.name)}><X size={11} /></button>}</div>
            : <button onClick={() => createToken(binding)}><Plus size={12} />Create token</button>}
        </div>
        {suggestion && <button className="hi-token-suggest" onClick={() => bindExisting(binding, suggestion)}>
          <Wand2 size={13} />
          <span><strong>Almost {suggestion.name}</strong><small>{binding.category === 'color' ? `${suggestion.value} is a near match — bind instead of adding a new token.` : `${suggestion.value} is ${round(Math.abs(cssNumber(suggestion.value) - cssNumber(binding.value)))}px away — snap to the scale.`}</small></span>
          {binding.category === 'color' && <i style={{ background: suggestion.value }} />}
        </button>}
      </div>;
    })}</div>
    {customTokens.length > 0 && <div className="hi-token-export">
      <button className="hi-token-export-toggle" aria-expanded={showExport} onClick={() => setShowExport((current) => !current)}>
        <FileCode2 size={13} /><span>Export {customTokens.length} local token{customTokens.length === 1 ? '' : 's'} for designSystem.ts</span><ChevronDown size={13} className={showExport ? 'is-open' : ''} />
      </button>
      {showExport && <div className="hi-code"><CopyButton value={buildTokenExport(customTokens)} label="Copy source" /><pre dir="ltr">{buildTokenExport(customTokens)}</pre></div>}
    </div>}
    <button className="hi-open-system" onClick={openDesignSystem}>Review tokens in Design System<ExternalLink size={13} /></button>
  </div>;
}

function StatePreviewTile({ snapshot, state, style, active, onClick }: { key?: ComponentStateId; snapshot: ElementSnapshot; state: ComponentStateId; style: StateOverride; active: boolean; onClick: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateMeta = COMPONENT_STATES.find((item) => item.id === state)!;
  useEffect(() => {
    if (!hostRef.current) return;
    hostRef.current.innerHTML = '';
    const clone = snapshot.element.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.setAttribute('aria-hidden', 'true');
    clone.style.setProperty('pointer-events', 'none', 'important');
    clone.style.setProperty('max-width', '100%', 'important');
    clone.style.setProperty('background', style.background, 'important');
    clone.style.setProperty('color', style.color, 'important');
    clone.style.setProperty('border-color', style.borderColor, 'important');
    clone.style.setProperty('opacity', String(style.opacity / 100), 'important');
    const transform = state === 'hover' ? `translateY(-2px) scale(${style.scale})` : `scale(${style.scale})`;
    clone.style.setProperty('transform', transform, 'important');
    if (state === 'focus') clone.style.setProperty('box-shadow', `0 0 0 4px ${inspectorVisualTokens.accent}33`, 'important');
    if (state === 'error') clone.style.setProperty('box-shadow', '0 0 0 3px rgba(220, 38, 38, .14)', 'important');
    if (state === 'disabled') clone.setAttribute('aria-disabled', 'true');
    if (state === 'loading') clone.setAttribute('aria-busy', 'true');
    if (state === 'error') clone.setAttribute('aria-invalid', 'true');
    hostRef.current.appendChild(clone);
  }, [snapshot, state, style]);
  const Icon = stateMeta.Icon;
  return <button className={`hi-state-tile ${active ? 'is-active' : ''}`} onClick={onClick}><span><Icon size={13} />{stateMeta.label}</span><div ref={hostRef} />{state === 'loading' && <LoaderCircle className="hi-state-spinner" size={15} />}</button>;
}

function ComponentStatesEditor({ snapshot, colorTokens, resetSignal, onStateChange }: { snapshot: ElementSnapshot; colorTokens: readonly BrandColorToken[]; resetSignal: number; onStateChange: (state: ComponentStateId, property: keyof StateOverride, value: string | number) => void }) {
  const [activeState, setActiveState] = useState<ComponentStateId>('hover');
  const [overrides, setOverrides] = useState<Partial<Record<ComponentStateId, Partial<StateOverride>>>>({});
  useEffect(() => setOverrides({}), [snapshot.selector, resetSignal]);
  const style = getComputedStyle(snapshot.element);
  const stateValue = (state: ComponentStateId): StateOverride => ({
    background: overrides[state]?.background ?? toHex(style.backgroundColor),
    color: overrides[state]?.color ?? toHex(style.color),
    borderColor: overrides[state]?.borderColor ?? toHex(style.borderColor),
    opacity: overrides[state]?.opacity ?? (state === 'disabled' ? 45 : state === 'loading' ? 72 : 100),
    scale: overrides[state]?.scale ?? (state === 'pressed' ? .97 : 1),
  });
  const update = <K extends keyof StateOverride>(property: K, value: StateOverride[K]) => {
    setOverrides((current) => ({ ...current, [activeState]: { ...current[activeState], [property]: value } }));
    onStateChange(activeState, property, value);
  };
  const activeValue = stateValue(activeState);
  return <div className="hi-state-editor">
    <div className="hi-state-grid">{COMPONENT_STATES.map(({ id }) => <StatePreviewTile key={id} snapshot={snapshot} state={id} style={stateValue(id)} active={activeState === id} onClick={() => setActiveState(id)} />)}</div>
    <div className="hi-state-controls"><span className="hi-state-edit-label">Editing {COMPONENT_STATES.find((item) => item.id === activeState)?.label}</span><TokenColorField label="Fill" value={activeValue.background} tokens={colorTokens} onChange={(value) => update('background', value)} /><TokenColorField label="Text" value={activeValue.color} tokens={colorTokens} onChange={(value) => update('color', value)} /><TokenColorField label="Stroke" value={activeValue.borderColor} tokens={colorTokens} onChange={(value) => update('borderColor', value)} /><div className="hi-control-pair"><NumberField label="Opacity" value={activeValue.opacity} min={0} max={100} suffix="%" onChange={(value) => update('opacity', Number(value))} /><NumberField label="Scale" value={activeValue.scale} min={.5} max={1.5} step={.01} suffix="×" onChange={(value) => update('scale', Number(value))} /></div></div>
  </div>;
}

function AccessibilityPanel({ snapshot }: { snapshot: ElementSnapshot }) {
  const findings = getAccessibilityFindings(snapshot);
  const issues = findings.filter((finding) => finding.status !== 'pass');
  return <div className="hi-a11y-panel">
    <div className={`hi-a11y-score ${issues.length ? 'has-issues' : 'is-clear'}`}>{issues.length ? <CircleAlert size={20} /> : <ShieldCheck size={20} />}<span><strong>{issues.length ? `${issues.length} issues to review` : 'Accessibility looks good'}</strong><small>{findings.length - issues.length} of {findings.length} checks passed</small></span></div>
    <div className="hi-a11y-list">{findings.map((finding) => <div key={finding.id} className={`is-${finding.status}`}>{finding.status === 'pass' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}<span><strong>{finding.label}</strong><small>{finding.detail}</small></span></div>)}</div>
  </div>;
}

function BoxModel({ snapshot }: { snapshot: ElementSnapshot }) {
  const style = getComputedStyle(snapshot.element);
  const values = (prefix: 'margin' | 'padding') => SIDES.map((side) => style.getPropertyValue(`${prefix}-${side}`).replace('px', '') || '0');
  const margin = values('margin');
  const padding = values('padding');
  return <div className="hi-box-model" dir="ltr"><span className="hi-box-label">margin · {margin.join('  ')}</span><div><span className="hi-box-label">border · {style.borderWidth}</span><div><span className="hi-box-label">padding · {padding.join('  ')}</span><div className="hi-box-content">{round(snapshot.rect.width)} × {round(snapshot.rect.height)}</div></div></div></div>;
}

/**
 * The read-only half of the old Inspect tab. Everything the design controls already expose live —
 * typography, colours, assets, the element preview — was dropped when the tab went; what is left is
 * the measurement and handoff detail that has no editor equivalent.
 */
function MeasurementDetails({ snapshot }: { snapshot: ElementSnapshot }) {
  const technical = JSON.stringify({ tag: snapshot.tag, kind: snapshot.kind, selector: snapshot.selector, domPath: snapshot.domPath, parent: snapshot.parentSelector, childCount: snapshot.childCount, rect: snapshot.rect, styles: snapshot.styles, attributes: snapshot.attributes, currentStates: snapshot.currentStates }, null, 2);
  return <>
    <ToolSection title="Layer & box model" icon={Layers3} defaultOpen={false}><div className="hi-key-grid"><PropertyRow label="Size" value={`${round(snapshot.rect.width)} × ${round(snapshot.rect.height)} px`} /><PropertyRow label="Display" value={snapshot.styles.display} /><PropertyRow label="Position" value={snapshot.styles.position} /><PropertyRow label="Radius" value={snapshot.styles['border-radius']} /><PropertyRow label="Border" value={snapshot.styles.border} /><PropertyRow label="Padding" value={snapshot.styles.padding} /><PropertyRow label="Gap" value={snapshot.styles.gap} /></div><BoxModel snapshot={snapshot} /></ToolSection>
    <ToolSection title="Distances" icon={ScanSearch} defaultOpen={false}><div className="hi-distance-group"><span>Parent edges</span><div>{SIDES.map((side) => <button key={side} onClick={() => navigator.clipboard.writeText(`${snapshot.parentDistances[side]}px`)}><small>{side}</small><strong>{snapshot.parentDistances[side]} px</strong></button>)}</div></div><div className="hi-distance-group"><span>Nearest siblings</span><div>{SIDES.map((side) => <button key={side} disabled={snapshot.siblingDistances[side] === undefined} onClick={() => navigator.clipboard.writeText(`${snapshot.siblingDistances[side]}px`)}><small>{side}</small><strong>{snapshot.siblingDistances[side] === undefined ? '—' : `${snapshot.siblingDistances[side]} px`}</strong></button>)}</div></div></ToolSection>
    <ToolSection title="CSS handoff" icon={Code2} defaultOpen={false}><div className="hi-code"><CopyButton value={snapshot.cssSnippet} label="Copy CSS" /><pre dir="ltr">{snapshot.cssSnippet}</pre></div><ul className="hi-limitations"><li>Computed styles do not retain every CSS variable name.</li><li>JavaScript states appear only when reflected in DOM or attributes.</li><li>Cross-origin style rules may be inaccessible.</li><li>Complex animations are summarized, not simulated.</li></ul></ToolSection>
    <ToolSection title="Selection details" icon={Component} defaultOpen={false}><PropertyRow label="Selector" value={snapshot.selector} /><PropertyRow label="DOM path" value={snapshot.domPath} /><PropertyRow label="Parent" value={snapshot.parentSelector} /><PropertyRow label="Children" value={String(snapshot.childCount)} /><div className="hi-code"><CopyButton value={technical} label="Copy JSON" /><pre dir="ltr">{technical}</pre></div></ToolSection>
  </>;
}

function HandoffInspectorPanel() {
  // Only reached when the design-mode gate is open, so a production bundle never pays for the
  // stylesheet injection.
  ensureDesignToolsStyles();

  const { tokens: designTokens, source: designTokensSource, generateFromPage: generateDesignSystemFromPage } = useDesignTokens();
  const brandColorTokens = designTokens.collections[0]?.colors ?? [];
  const aiGuideColorTokens = designTokens.collections[1]?.colors ?? brandColorTokens;
  const typographyRecipes = designTokens.collections[0]?.typography ?? [];
  const aiGuideTypographyRecipes = designTokens.collections[1]?.typography ?? typographyRecipes;
  const inspectorSpacingTokens = designTokens.spacing;
  const inspectorRadiusTokens = designTokens.radius;
  // Keep the module-level mirrors (read by matchToken/findNearestToken, which sit outside the
  // component) in sync every render — see the comment near their declaration above.
  activeSpacingTokens = inspectorSpacingTokens;
  activeRadiusTokens = inspectorRadiusTokens;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<DesignScope>('free');
  const [dock, setDock] = useState<'left' | 'right'>(() => readStoredPreference('meraki-inspector-dock') === 'left' ? 'left' : 'right');
  const [locked, setLocked] = useState(false);
  const [snapshot, setSnapshot] = useState<ElementSnapshot | null>(null);
  const [changes, setChanges] = useState<DesignChange[]>([]);
  const [stateResetSignal, setStateResetSignal] = useState(0);
  const [devicePreset, setDevicePreset] = useState<DevicePresetId>('iphone-15');
  const [deviceOpen, setDeviceOpen] = useState(false);
  // The frame stays mounted after the first open so reopening does not reboot the app and replay every reveal.
  const [deviceMounted, setDeviceMounted] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const [restorable, setRestorable] = useState<StoredSession | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [canvasEdit, setCanvasEdit] = useState(() => readStoredPreference('meraki-inspector-canvas-edit') !== 'off');
  /** Live geometry while a handle is being dragged — the snapshot only catches up once the drag commits. */
  const [canvasRect, setCanvasRect] = useState<ElementSnapshot['rect'] | null>(null);
  const [canvasSize, setCanvasSize] = useState<string | null>(null);
  const [canvasNote, setCanvasNote] = useState<string | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const textEditRef = useRef<TextEditSession | null>(null);
  const canvasBusyRef = useRef(false);
  const stateMarkRef = useRef(1);
  const panelRef = useRef<HTMLElement>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const hoverRef = useRef<HTMLElement | null>(null);
  const originalsRef = useRef(new Map<HTMLElement, OriginalState>());
  const rafRef = useRef<number | null>(null);
  const deviceDocRef = useRef<Document | null>(null);
  const tokenVariablesRef = useRef(new Map<string, string>());
  const changesRef = useRef<DesignChange[]>([]);
  const hasSavedRef = useRef(false);
  // Canvas gestures outlive the render that started them, so they read the selection through refs.
  const snapshotRef = useRef<ElementSnapshot | null>(null);
  const scopeRef = useRef<DesignScope>('free');
  changesRef.current = changes;
  snapshotRef.current = snapshot;
  scopeRef.current = scope;
  const activeDeviceKind = deviceOpen ? inspectorDevicePresets.find((item) => item.id === devicePreset)?.kind ?? null : null;
  const openDevice = (kind: DeviceKind) => { setDevicePreset(defaultDeviceForKind[kind]); setDeviceOpen(true); setDeviceMounted(true); };
  // There is one mode now, so opening the inspector means landing in the desktop preview ready to edit.
  const toggleInspector = () => {
    if (open) { setOpen(false); return; }
    openDevice('desktop');
    setOpen(true);
  };
  const hasSecondCollection = designTokens.collections.length > 1;
  const [secondaryCollectionActive, setSecondaryCollectionActive] = useState(false);
  const colorTokens = secondaryCollectionActive ? aiGuideColorTokens : brandColorTokens;
  const typePresets = secondaryCollectionActive ? aiGuideTypographyRecipes : typographyRecipes;

  /**
   * The font list is read from the page rather than hard-coded.
   *
   * This dropdown used to name the fonts of the site the inspector was extracted from, so on any
   * other project every option applied a font that did not exist there. Sampling the live page
   * means the choices are always the fonts the site actually loaded.
   */
  const pageFonts = useMemo(() => {
    if (!open || typeof document === 'undefined') return [];
    // Keeps the authored stack so the fallback survives, e.g. `Georgia, serif`.
    return detectFontStacksFromPage(document.body);
  }, [open]);

  const refresh = useCallback((element = selectedRef.current || hoverRef.current) => {
    if (element && element.isConnected) setSnapshot(createSnapshot(element));
  }, []);

  useEffect(() => {
    if (!open) return;
    const findTarget = (event: PointerEvent) => document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
    const onMove = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      if (locked) return;
      const target = findTarget(event);
      if (!target || target === hoverRef.current) return;
      hoverRef.current = target;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setSnapshot(createSnapshot(target)));
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      // Clicks inside the box being retyped place the caret; they are not a new selection.
      const editing = textEditRef.current?.element;
      if (editing && event.target instanceof Node && (editing === event.target || editing.contains(event.target))) return;
      const target = document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectedRef.current = target;
      hoverRef.current = target;
      setLocked(true);
      setSnapshot(createSnapshot(target));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (deviceOpen) return;
      // A drag or an inline edit consumes Escape itself; unlocking underneath it would lose the element.
      if (canvasBusyRef.current) return;
      if (locked) { setLocked(false); selectedRef.current = null; }
      else setOpen(false);
    };
    const onViewport = () => refresh();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onViewport, true);
    window.addEventListener('resize', onViewport);
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onViewport, true);
      window.removeEventListener('resize', onViewport);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [deviceOpen, locked, open, refresh]);

  useEffect(() => {
    if (open) return;
    setDeviceOpen(false);
    setDeviceMounted(false);
  }, [open]);

  /**
   * Host pages bind their own keyboard shortcuts to `window` — the guide, for one, treats space as
   * "next slide" and calls preventDefault, which made typing a space inside the panel impossible.
   * Keys typed inside the inspector stop at `document`, after React's delegated handlers have run
   * but before anything listening on `window` sees them. Escape still passes through.
   */
  useEffect(() => {
    if (!open) return;
    const guard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      const target = event.target;
      // Strictly the panel, not passthrough page chrome — a page's own nav must keep its shortcuts.
      if (target instanceof HTMLElement && target.closest('[data-inspector-ui]')) event.stopPropagation();
    };
    const types: Array<keyof DocumentEventMap> = ['keydown', 'keyup', 'keypress'];
    types.forEach((type) => document.addEventListener(type, guard as EventListener));
    return () => types.forEach((type) => document.removeEventListener(type, guard as EventListener));
  }, [open]);

  useEffect(() => {
    window.localStorage.setItem('meraki-inspector-dock', dock);
  }, [dock]);

  const storeOriginal = (element: HTMLElement) => {
    if (originalsRef.current.has(element)) return;
    originalsRef.current.set(element, {
      element,
      styleAttribute: element.getAttribute('style'),
      innerHTML: element.innerHTML,
      textContent: element.textContent,
      value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : undefined,
      attributes: Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
      parent: element.parentNode,
      nextSibling: element.nextSibling,
    });
  };

  /** Component scope only widens an edit when the element being edited *is* the current selection. */
  const targetsFor = (element: HTMLElement) => {
    const current = snapshotRef.current;
    if (current && current.element === element && scopeRef.current === 'component') return current.family.elements;
    return [element];
  };

  const currentTargets = () => (snapshot ? targetsFor(snapshot.element) : []);

  /**
   * The device overlay renders the same app from the same origin, so edits are mirrored by
   * resolving each edited element's structural path inside the frame document.
   */
  const mirrorToDevice = useCallback((elements: HTMLElement[], run: (node: HTMLElement, source: HTMLElement) => void) => {
    const doc = deviceDocRef.current;
    if (doc) {
      elements.forEach((element) => {
        const node = doc.querySelector<HTMLElement>(getUniquePath(element));
        if (node) run(node, element);
      });
    }
    setEditVersion((current) => current + 1);
  }, []);

  const restoreInDevice = (node: HTMLElement, source: HTMLElement) => {
    const style = source.getAttribute('style');
    if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
    node.innerHTML = source.innerHTML;
  };

  /** Re-apply every live edit after the device frame reloads or the device changes. */
  const replayIntoDevice = useCallback((doc: Document) => {
    tokenVariablesRef.current.forEach((value, name) => doc.documentElement.style.setProperty(name, value));
    changesRef.current.forEach((change) => {
      if (!change.element.isConnected) return;
      const node = doc.querySelector<HTMLElement>(getUniquePath(change.element));
      if (!node) return;
      if (change.kind === 'css') node.style.setProperty(change.property, change.after);
      if (change.kind === 'content') {
        if (isFieldNode(node)) node.value = change.after;
        else node.textContent = change.after;
      }
      if (change.kind === 'attribute') node.setAttribute(change.property.replace(/^@/, ''), change.after);
      // Carry the state marker across so the replayed stylesheet has something to match.
      const mark = change.element.getAttribute(STATE_MARK_ATTRIBUTE);
      if (mark) node.setAttribute(STATE_MARK_ATTRIBUTE, mark);
    });
    const stateCss = changesRef.current
      .filter((change) => change.kind === 'state' && change.element.getAttribute(STATE_MARK_ATTRIBUTE))
      .map((change) => {
        const [, state, ...propertyParts] = change.property.split(':');
        return `[${STATE_MARK_ATTRIBUTE}="${change.element.getAttribute(STATE_MARK_ATTRIBUTE)}"]${STATE_SELECTOR[state as ComponentStateId]} { ${propertyParts.join(':')}: ${change.after} !important; }`;
      }).join('\n');
    applyStateRules(doc, stateCss);
  }, []);

  const registerDeviceDocument = useCallback((doc: Document | null) => {
    deviceDocRef.current = doc;
    setEditVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const key = sessionKey();
    const storable = changes.filter((change) => REPLAYABLE_KINDS.includes(change.kind) && change.element.isConnected);
    // Only clear once this session has actually written something. Mount runs with an empty log —
    // and StrictMode runs them twice — so clearing unconditionally would delete the saved session
    // before the restore prompt ever sees it.
    if (!storable.length) {
      if (hasSavedRef.current) { window.localStorage.removeItem(key); hasSavedRef.current = false; }
      return;
    }
    const payload: StoredSession = {
      savedAt: new Date().toISOString(),
      variables: Array.from(tokenVariablesRef.current.entries()),
      changes: storable.map((change) => ({
        path: getUniquePath(change.element),
        selector: change.selector,
        property: change.property,
        before: change.before,
        after: change.after,
        kind: change.kind,
        instruction: change.instruction,
        cssVariable: change.cssVariable,
      })),
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
      hasSavedRef.current = true;
    } catch { /* Storage is full or blocked. */ }
  }, [changes]);

  useEffect(() => {
    if (!open || changesRef.current.length) return;
    setRestorable(readStoredSession());
  }, [open]);

  const restoreSession = (session: StoredSession) => {
    session.variables.forEach(([name, value]) => {
      document.documentElement.style.setProperty(name, value);
      deviceDocRef.current?.documentElement.style.setProperty(name, value);
      tokenVariablesRef.current.set(name, value);
    });
    const restored: DesignChange[] = [];
    let missing = 0;
    session.changes.forEach((entry) => {
      let element: HTMLElement | null = null;
      try { element = document.querySelector<HTMLElement>(entry.path); } catch { element = null; }
      if (!element || element.closest(IGNORED_SELECTOR)) { missing += 1; return; }
      storeOriginal(element);
      if (entry.kind === 'css') element.style.setProperty(entry.property, entry.after);
      if (entry.kind === 'content') { if (isFieldNode(element)) element.value = entry.after; else element.textContent = entry.after; }
      if (entry.kind === 'attribute') element.setAttribute(entry.property.replace(/^@/, ''), entry.after);
      restored.push({ element, selector: entry.selector, property: entry.property, before: entry.before, after: entry.after, kind: entry.kind, instruction: entry.instruction, cssVariable: entry.cssVariable });
    });
    changesRef.current = restored;
    setChanges(restored);
    setRestorable(null);
    setRestoreNote(missing ? `${missing} edit${missing === 1 ? '' : 's'} could not be matched — the page markup changed.` : null);
    if (deviceDocRef.current) replayIntoDevice(deviceDocRef.current);
    setEditVersion((current) => current + 1);
    // Land on the first restored element so the change log is visible instead of an empty panel.
    const firstRestored = restored.find((change) => change.kind !== 'token')?.element ?? restored[0]?.element;
    if (firstRestored) selectElement(firstRestored);
    else refresh(selectedRef.current ?? undefined);
  };

  const discardSession = () => {
    window.localStorage.removeItem(sessionKey());
    setRestorable(null);
  };

  const selectElement = useCallback((element: HTMLElement) => {
    selectedRef.current = element;
    hoverRef.current = element;
    setLocked(true);
    setSnapshot(createSnapshot(element));
    element.scrollIntoView({ block: 'center' });
  }, []);

  const selectFromDevice = useCallback((path: string) => {
    let element: HTMLElement | null = null;
    try { element = document.querySelector<HTMLElement>(path); } catch { element = null; }
    if (!element || element.closest(IGNORED_SELECTOR)) return false;
    selectElement(element);
    return true;
  }, [selectElement]);

  /** Expand a panel section and bring it into view, addressed by its `data-hi-section` id. */
  const focusSection = (id: string) => {
    const node = panelRef.current?.querySelector<HTMLElement>(`[data-hi-section="${id}"]`);
    if (!node) return;
    if (node.getAttribute('data-hi-open') === 'false') node.querySelector('button')?.click();
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    node.classList.add('is-spotlit');
    window.setTimeout(() => node.classList.remove('is-spotlit'), 1800);
  };

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<InspectorRequest>).detail ?? {};
      setOpen(true);
      if (detail.device === 'none') setDeviceOpen(false);
      else if (detail.device) openDevice(detail.device);
      // The panel has to mount before an element can be selected into it, and the device frame needs
      // a beat to resolve the same node, so the rest is queued instead of run inside this tick.
      window.setTimeout(() => {
        if (detail.select) {
          let element: HTMLElement | null = null;
          try { element = document.querySelector<HTMLElement>(detail.select); } catch { element = null; }
          if (element) selectElement(element);
        }
        if (detail.section) window.setTimeout(() => focusSection(detail.section!), 260);
      }, 80);
    };
    window.addEventListener(INSPECTOR_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(INSPECTOR_REQUEST_EVENT, onRequest);
    // `openDevice` and `focusSection` only touch setters and refs, so re-binding buys nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectElement]);

  const recordChange = (change: DesignChange) => {
    setChanges((current) => {
      const existing = current.findIndex((item) => item.element === change.element && item.property === change.property);
      if (existing === -1) return [...current, change];
      const next = [...current];
      next[existing] = { ...change, before: current[existing].before };
      return next;
    });
  };

  const applyStyleTo = (targets: HTMLElement[], property: string, rawValue: string) => {
    const value = normalizeCssValue(property, rawValue);
    targets.forEach((element) => {
      storeOriginal(element);
      const before = getComputedStyle(element).getPropertyValue(property);
      element.style.setProperty(property, value);
      recordChange({ element, selector: getSelector(element), property, before, after: value, kind: 'css' });
    });
    mirrorToDevice(targets, (node) => node.style.setProperty(property, value));
    window.setTimeout(() => refresh(snapshotRef.current?.element), 0);
  };

  const applyStyle = (property: string, rawValue: string) => applyStyleTo(currentTargets(), property, rawValue);

  const applyTokenBinding = (payload: { property: string; label: string; from: string; tokenName: string; tokenValue: string; variable: string; created: boolean }) => {
    if (!snapshot) return;
    document.documentElement.style.setProperty(payload.variable, payload.tokenValue);
    deviceDocRef.current?.documentElement.style.setProperty(payload.variable, payload.tokenValue);
    tokenVariablesRef.current.set(payload.variable, payload.tokenValue);
    applyStyle(payload.property, `var(${payload.variable})`);
    const scopeNote = scope === 'component' ? ` Apply it to all ${snapshot.family.matchCount} matching variants, not just this one.` : '';
    const instruction = payload.created
      ? `Add ${payload.variable}: ${payload.tokenValue}; to the design system as "${payload.tokenName}", then replace the hard-coded ${payload.property} (${payload.from}) on ${snapshot.selector} with var(${payload.variable}).${scopeNote}`
      : `Do not add a new token. Replace the one-off ${payload.property} (${payload.from}) on ${snapshot.selector} with the existing "${payload.tokenName}" token (${payload.tokenValue}), exposed as var(${payload.variable}).${scopeNote}`;
    recordChange({
      element: snapshot.element,
      selector: snapshot.selector,
      property: `token:${payload.property}`,
      before: payload.from,
      after: payload.tokenName,
      kind: 'token',
      instruction,
      cssVariable: { name: payload.variable, value: payload.tokenValue },
    });
  };

  /**
   * Rebuilds the live state stylesheet from the change log. Each edited element is marked with a
   * unique attribute so the rule targets exactly it, rather than every element sharing its classes.
   */
  const syncStateRules = useCallback(() => {
    const rules = changesRef.current.filter((change) => change.kind === 'state' && change.element.isConnected);
    const css = rules.map((change) => {
      const mark = change.element.getAttribute(STATE_MARK_ATTRIBUTE);
      if (!mark) return '';
      const [, state, ...propertyParts] = change.property.split(':');
      const pseudo = STATE_SELECTOR[state as ComponentStateId];
      return `[${STATE_MARK_ATTRIBUTE}="${mark}"]${pseudo} { ${propertyParts.join(':')}: ${change.after} !important; }`;
    }).filter(Boolean).join('\n');
    applyStateRules(document, css);
    if (deviceDocRef.current) applyStateRules(deviceDocRef.current, css);
  }, []);

  const recordStateChange = (state: ComponentStateId, property: keyof StateOverride, value: string | number) => {
    if (!snapshot) return;
    const cssProperty = property === 'background' ? 'background-color' : property === 'borderColor' ? 'border-color' : property === 'scale' ? 'transform' : property;
    const cssValue = property === 'scale' ? `scale(${value})` : property === 'opacity' ? String(Number(value) / 100) : String(value);
    const before = snapshot.stateRules.find((rule) => rule.state.includes(state === 'pressed' ? 'active' : state))?.declarations.find((declaration) => declaration.property === cssProperty)?.value ?? 'default';
    const targets = currentTargets();
    targets.forEach((element) => {
      storeOriginal(element);
      if (!element.getAttribute(STATE_MARK_ATTRIBUTE)) element.setAttribute(STATE_MARK_ATTRIBUTE, `s${stateMarkRef.current++}`);
      recordChange({ element, selector: getSelector(element), property: `state:${state}:${cssProperty}`, before, after: cssValue, kind: 'state' });
    });
    // The mark has to reach the device frame too, or the rule there matches nothing.
    mirrorToDevice(targets, (node, source) => {
      const mark = source.getAttribute(STATE_MARK_ATTRIBUTE);
      if (mark) node.setAttribute(STATE_MARK_ATTRIBUTE, mark);
    });
    // recordChange is async through state; rebuild once React has the new entry.
    window.setTimeout(syncStateRules, 0);
  };

  const applyTextTo = (targets: HTMLElement[], value: string) => {
    targets.forEach((element) => {
      storeOriginal(element);
      const before = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : normalizeText(element.textContent);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = value;
      else element.textContent = value;
      recordChange({ element, selector: getSelector(element), property: 'textContent', before, after: value, kind: 'content' });
    });
    mirrorToDevice(targets, (node) => {
      if (isFieldNode(node)) node.value = value;
      else node.textContent = value;
    });
    refresh(snapshotRef.current?.element ?? targets[0]);
  };

  const applyText = (value: string) => applyTextTo(currentTargets(), value);

  const applyAttribute = (property: string, value: string) => {
    const targets = currentTargets();
    targets.forEach((element) => {
      storeOriginal(element);
      const before = element.getAttribute(property) ?? '';
      element.setAttribute(property, value);
      recordChange({ element, selector: getSelector(element), property: `@${property}`, before, after: value, kind: 'attribute' });
    });
    mirrorToDevice(targets, (node) => node.setAttribute(property, value));
    refresh(snapshot?.element);
  };

  /** Lock onto an element without scrolling — the pointer is already on it. */
  const lockTo = (element: HTMLElement) => {
    selectedRef.current = element;
    hoverRef.current = element;
    setLocked(true);
    setSnapshot(createSnapshot(element));
  };

  const finishTextEdit = (commit: boolean) => {
    const session = textEditRef.current;
    if (!session) return;
    textEditRef.current = null;
    canvasBusyRef.current = false;
    session.stop();
    const next = readTextEdit(session);
    // Put the original back before committing: applyTextTo reads the live DOM to record the "before",
    // and the element is currently holding the value that was just typed into it.
    revertTextEdit(session);
    if (!commit || normalizeText(next) === normalizeText(session.original)) { refresh(session.element); return; }
    applyTextTo(targetsFor(session.element), next);
  };

  const startTextEdit = (element: HTMLElement) => {
    if (textEditRef.current?.element === element) return;
    finishTextEdit(true);
    storeOriginal(element);
    const session = beginTextEdit(element, { onCommit: () => finishTextEdit(true), onCancel: () => finishTextEdit(false) });
    if (!session) {
      setCanvasNote('That element wraps other elements. Edit its text in the Content section so the markup inside it survives.');
      return;
    }
    setCanvasNote(null);
    textEditRef.current = session;
    canvasBusyRef.current = true;
  };

  const startResize = (element: HTMLElement, direction: ResizeDirection, event: ReactPointerEvent, scale: number, onUpdate: (() => void) | null) => {
    event.preventDefault();
    event.stopPropagation();
    finishTextEdit(true);
    const doc = deviceDocRef.current;
    const mirror = doc ? doc.querySelector<HTMLElement>(getUniquePath(element)) : null;
    const session = beginResize(element, direction, event.nativeEvent, scale, mirror, onUpdate);
    resizeRef.current = session;
    canvasBusyRef.current = true;
    setCanvasSize(`${round(session.startWidth)} × ${round(session.startHeight)}`);
    const handle = event.currentTarget as HTMLElement;
    try { handle.setPointerCapture(event.pointerId); } catch { /* The pointer went away before capture. */ }

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      moveEvent.preventDefault();
      resizeFrame(active, moveEvent);
      previewResize(active);
      // Read the box back rather than trusting the requested size: a flex child or a wrapping
      // paragraph settles somewhere else, and the overlay has to sit on what actually rendered.
      const rect = active.element.getBoundingClientRect();
      setCanvasRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height });
      setCanvasSize(`${round(rect.width)} × ${round(rect.height)}`);
    };

    const finish = (commit: boolean) => {
      const active = resizeRef.current;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      resizeRef.current = null;
      canvasBusyRef.current = false;
      setCanvasSize(null);
      if (!active) return;
      rollbackResize(active);
      if (!commit || !active.moved) {
        active.onUpdate?.();
        setCanvasRect(null);
        return;
      }
      const targets = targetsFor(active.element);
      // Width and height do not bite on an inline box, so make the switch explicit and log it.
      if (getComputedStyle(active.element).display === 'inline') applyStyleTo(targets, 'display', 'inline-block');
      resizeDeclarations(active).forEach(([property, value]) => applyStyleTo(targets, property, value));
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  };

  /** Text retyped inside the device frame, committed against the matching element in this document. */
  const applyTextFromDevice = (path: string, value: string) => {
    let element: HTMLElement | null = null;
    try { element = document.querySelector<HTMLElement>(path); } catch { element = null; }
    if (!element || element.closest(IGNORED_SELECTOR)) {
      setCanvasNote('That element only exists at this screen size, so the edit could not be recorded.');
      return;
    }
    lockTo(element);
    storeOriginal(element);
    applyTextTo(targetsFor(element), value);
  };

  useEffect(() => {
    window.localStorage.setItem('meraki-inspector-canvas-edit', canvasEdit ? 'on' : 'off');
  }, [canvasEdit]);

  // The live drag box is only true for the snapshot it was measured against.
  useEffect(() => { setCanvasRect(null); }, [snapshot]);

  useEffect(() => {
    if (!open || !canvasEdit || deviceOpen) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      const target = document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
      if (!target || textEditRef.current?.element === target) return;
      event.preventDefault();
      event.stopPropagation();
      lockTo(target);
      startTextEdit(target);
    };
    document.addEventListener('dblclick', onDoubleClick, true);
    return () => {
      document.removeEventListener('dblclick', onDoubleClick, true);
      finishTextEdit(true);
    };
    // `lockTo`, `startTextEdit` and `finishTextEdit` only read refs and setters, so re-binding on every
    // render would churn the listener without changing what it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEdit, deviceOpen, open]);

  const restoreOriginal = (original: OriginalState) => {
    const { element } = original;
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    original.attributes.forEach(([name, value]) => element.setAttribute(name, value));
    if (original.styleAttribute === null) element.removeAttribute('style'); else element.setAttribute('style', original.styleAttribute);
    element.innerHTML = original.innerHTML;
    if (original.value !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.value = original.value;
    if (original.parent && element.parentNode !== original.parent) original.parent.insertBefore(element, original.nextSibling);
    else if (original.parent && element.nextSibling !== original.nextSibling) original.parent.insertBefore(element, original.nextSibling);
  };

  const resetElement = () => {
    if (!snapshot) return;
    const targets = currentTargets();
    targets.forEach((element) => { const original = originalsRef.current.get(element); if (original) { restoreOriginal(original); originalsRef.current.delete(element); } });
    setChanges((current) => current.filter((change) => !targets.includes(change.element)));
    setStateResetSignal((current) => current + 1);
    mirrorToDevice(targets, restoreInDevice);
    window.setTimeout(syncStateRules, 0);
    refresh(snapshot.element);
  };

  const resetAll = () => {
    const touched = Array.from(originalsRef.current.keys());
    originalsRef.current.forEach(restoreOriginal);
    originalsRef.current.clear();
    tokenVariablesRef.current.forEach((_, name) => {
      document.documentElement.style.removeProperty(name);
      deviceDocRef.current?.documentElement.style.removeProperty(name);
    });
    tokenVariablesRef.current.clear();
    changesRef.current = [];
    setChanges([]);
    setStateResetSignal((current) => current + 1);
    applyStateRules(document, '');
    if (deviceDocRef.current) applyStateRules(deviceDocRef.current, '');
    mirrorToDevice(touched, restoreInDevice);
    refresh(snapshot?.element);
  };

  const applyAsset = (asset: AssetInfo, value: string, label: string) => {
    const target = asset.element as HTMLElement;
    storeOriginal(target);
    if (asset.type === 'img' && target instanceof HTMLImageElement) {
      target.src = value; target.removeAttribute('srcset'); target.removeAttribute('sizes');
    } else if (asset.type === 'background') {
      target.style.setProperty('background-image', `url("${value.replace(/"/g, '%22')}")`, 'important');
    } else if (asset.type === 'svg' && target instanceof SVGElement) {
      const parsed = new DOMParser().parseFromString(value, 'image/svg+xml').documentElement;
      if (parsed.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return;
      parsed.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
      parsed.querySelectorAll('*').forEach((node) => Array.from(node.attributes).filter((attribute) => attribute.name.toLowerCase().startsWith('on')).forEach((attribute) => node.removeAttribute(attribute.name)));
      const keep = new Set(['class', 'style', 'width', 'height', 'aria-label', 'role']);
      Array.from(target.attributes).filter((attribute) => !keep.has(attribute.name)).forEach((attribute) => target.removeAttribute(attribute.name));
      Array.from(parsed.attributes).forEach((attribute) => target.setAttribute(attribute.name, attribute.value));
      target.innerHTML = parsed.innerHTML;
    }
    recordChange({ element: target, selector: getSelector(target), property: `asset:${asset.id}`, before: asset.src, after: label, kind: 'asset' });
    mirrorToDevice([target], (node, source) => {
      if (source instanceof HTMLImageElement && node.tagName.toLowerCase() === 'img') {
        (node as HTMLImageElement).src = source.src;
        node.removeAttribute('srcset');
        node.removeAttribute('sizes');
      } else restoreInDevice(node, source);
    });
    refresh(snapshot?.element);
  };

  const onAssetFile = (asset: AssetInfo, file?: File) => {
    if (!file) return;
    if (file.type === 'image/svg+xml') file.text().then((text) => asset.type === 'svg' ? applyAsset(asset, text, file.name) : applyAsset(asset, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, file.name));
    else applyAsset(asset, URL.createObjectURL(file), file.name);
  };

  const reorder = (direction: -1 | 1) => {
    if (!snapshot?.element.parentElement) return;
    const element = snapshot.element;
    const parent = element.parentElement;
    const display = getComputedStyle(parent).display;
    if (!display.includes('flex') && !display.includes('grid')) return;
    const sibling = direction < 0 ? element.previousElementSibling : element.nextElementSibling;
    if (!(sibling instanceof HTMLElement)) return;
    storeOriginal(element);
    if (direction < 0) parent.insertBefore(element, sibling); else parent.insertBefore(sibling, element);
    recordChange({ element, selector: getSelector(element), property: 'layout:order', before: 'Original order', after: direction < 0 ? 'Moved earlier' : 'Moved later', kind: 'layout' });
    mirrorToDevice([parent], restoreInDevice);
    refresh(element);
  };

  const unlock = () => { finishTextEdit(true); setLocked(false); selectedRef.current = null; };
  // A page can swap out what it renders under the tool — a slide change, a route change. Once the
  // selected node leaves the document its rect is a lie, so stop drawing on top of whatever replaced it.
  const overlaySnapshot = snapshot?.element.isConnected ? snapshot : null;
  const overlayRect = canvasRect ?? overlaySnapshot?.rect ?? null;
  const canvasHandlesVisible = canvasEdit && locked && !deviceOpen && Boolean(overlaySnapshot);
  const designChanges = changes.filter((change) => {
    if (!snapshot) return false;
    return scope === 'component' ? snapshot.family.elements.includes(change.element) : change.element === snapshot.element;
  });
  const directCssDiff = changes.filter((change) => change.kind === 'css').map((change) => `${change.selector} {\n  ${change.property}: ${change.after};\n}`).join('\n\n');
  const stateCssDiff = changes.filter((change) => change.kind === 'state').map((change) => {
    const [, state, ...propertyParts] = change.property.split(':');
    return `${change.selector}${STATE_SELECTOR[state as ComponentStateId]} {\n  ${propertyParts.join(':')}: ${change.after};\n}`;
  }).join('\n\n');
  const tokenChanges = changes.filter((change) => change.kind === 'token');
  const tokenDeclarations = Array.from(new Map(tokenChanges.filter((change) => change.cssVariable).map((change) => [change.cssVariable!.name, change.cssVariable!.value])).entries());
  const tokenCssDiff = tokenDeclarations.length ? `:root {\n${tokenDeclarations.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}` : '';
  const cssDiff = [tokenCssDiff, directCssDiff, stateCssDiff].filter(Boolean).join('\n\n');
  const instructions = changes.filter((change) => change.instruction).map((change, index) => `${index + 1}. ${change.instruction}`).join('\n');
  const handoffText = changes.length ? [
    `Design handoff · ${window.location.pathname} · ${new Date().toLocaleString()}`,
    `${changes.length} change${changes.length === 1 ? '' : 's'}`,
    instructions && `\nINSTRUCTIONS\n${instructions}`,
    `\nCHANGES\n${changes.map((change) => `- ${change.selector} · ${change.property}: ${change.before || '—'} → ${change.after}`).join('\n')}`,
    cssDiff && `\nCSS\n${cssDiff}`,
  ].filter(Boolean).join('\n') : '';
  const liveStyle = snapshot ? getComputedStyle(snapshot.element) : null;

  return <div data-inspector-ui className="hi-root" dir="ltr" style={{
    '--hi-canvas': inspectorVisualTokens.canvas,
    '--hi-panel': inspectorVisualTokens.panel,
    '--hi-surface': inspectorVisualTokens.surface,
    '--hi-surface-strong': inspectorVisualTokens.surfaceStrong,
    '--hi-border': inspectorVisualTokens.border,
    '--hi-border-strong': inspectorVisualTokens.borderStrong,
    '--hi-text': inspectorVisualTokens.text,
    '--hi-muted': inspectorVisualTokens.muted,
    '--hi-faint': inspectorVisualTokens.faint,
    '--hi-accent': inspectorVisualTokens.accent,
    '--hi-accent-soft': inspectorVisualTokens.accentSoft,
    '--hi-selected': inspectorVisualTokens.selected,
    '--hi-selected-soft': inspectorVisualTokens.selectedSoft,
    '--hi-success': inspectorVisualTokens.success,
  } as CSSProperties}>
    <button className={`hi-launcher ${open ? 'is-open' : ''}`} onClick={toggleInspector} aria-label={open ? 'Hide inspector' : 'Open inspector'}><ScanSearch size={16} /><span>Inspect</span></button>
    {open && <>
      {deviceMounted && <DeviceOverlay
        presetId={devicePreset}
        onPresetChange={setDevicePreset}
        snapshot={snapshot}
        dock={dock}
        hidden={!deviceOpen}
        editVersion={editVersion}
        canvasEdit={canvasEdit}
        canvasSize={canvasSize}
        canvasBusyRef={canvasBusyRef}
        onCanvasResize={(direction, event, scale, onUpdate) => { if (snapshot) startResize(snapshot.element, direction, event, scale, onUpdate); }}
        onCanvasText={applyTextFromDevice}
        onFrameDocument={registerDeviceDocument}
        onSelectPath={selectFromDevice}
        onReplay={replayIntoDevice}
        onClose={() => setDeviceOpen(false)}
        onExit={() => setOpen(false)}
      />}
      {!deviceOpen && overlaySnapshot && overlayRect && <div className={`hi-selection ${locked ? 'is-locked' : ''} ${canvasSize ? 'is-resizing' : ''}`} style={{ top: overlayRect.top, left: overlayRect.left, width: overlayRect.width, height: overlayRect.height }}>
        <span>{overlaySnapshot.family.label} · {round(overlayRect.width)} × {round(overlayRect.height)}</span>
        {locked && !canvasHandlesVisible && <i><Lock size={10} /></i>}
        {canvasHandlesVisible && <CanvasHandles size={canvasSize} onStart={(direction, event) => startResize(overlaySnapshot.element, direction, event, 1, null)} />}
      </div>}
      {!deviceOpen && locked && !canvasSize && overlaySnapshot && <div className="hi-measurements">{SIDES.map((side) => overlaySnapshot.siblingDistances[side] !== undefined ? <span key={side} className={`hi-measure hi-measure-${side}`} style={{ top: side === 'top' ? overlaySnapshot.rect.top - 22 : side === 'bottom' ? overlaySnapshot.rect.bottom + 6 : overlaySnapshot.rect.top + overlaySnapshot.rect.height / 2, left: side === 'left' ? overlaySnapshot.rect.left - 42 : side === 'right' ? overlaySnapshot.rect.right + 7 : overlaySnapshot.rect.left + overlaySnapshot.rect.width / 2 }}>{overlaySnapshot.siblingDistances[side]}px</span> : null)}</div>}
      <aside ref={panelRef} className={`hi-panel hi-panel--${dock}`}>
        <header className="hi-header">
          <div className="hi-product"><span className="hi-logo"><Sparkles size={13} /></span><div><strong>Design Inspector</strong><small>{locked ? 'Selection locked' : 'Preview mode · click to select'}</small></div></div>
          <div className="hi-header-tools">
            {hasSecondCollection && (
              <div className="hi-dock-switch" role="group" aria-label="Design system collection">
                <button className={!secondaryCollectionActive ? 'is-active' : ''} aria-pressed={!secondaryCollectionActive} onClick={() => setSecondaryCollectionActive(false)} title={designTokens.collections[0]?.name}>{designTokens.collections[0]?.name ?? 'Primary'}</button>
                <button className={secondaryCollectionActive ? 'is-active' : ''} aria-pressed={secondaryCollectionActive} onClick={() => setSecondaryCollectionActive(true)} title={designTokens.collections[1]?.name}>{designTokens.collections[1]?.name ?? 'Secondary'}</button>
              </div>
            )}
            {(designTokensSource === 'fallback-default' || designTokensSource === 'detected-live-css') && (
              <button className="hi-header-actions" onClick={generateDesignSystemFromPage} title="No design system was provided — generate a draft from the colors, spacing and type sizes actually used on this page">
                <Wand2 size={13} /> Generate design system
              </button>
            )}
            <div className="hi-dock-switch" role="group" aria-label="Panel side">
              <button className={dock === 'left' ? 'is-active' : ''} aria-pressed={dock === 'left'} onClick={() => setDock('left')} title="Move panel to left"><PanelLeft size={15} /></button>
              <button className={dock === 'right' ? 'is-active' : ''} aria-pressed={dock === 'right'} onClick={() => setDock('right')} title="Move panel to right"><PanelRight size={15} /></button>
            </div>
            <div className="hi-header-actions">{deviceOpen && <button className="is-active" onClick={() => setDeviceOpen(false)} title="Close device preview"><Smartphone size={15} /></button>}{locked &&<button onClick={unlock} title="Unlock"><Unlock size={15} /></button>}<button onClick={() => setOpen(false)} title="Close"><X size={15} /></button></div>
          </div>
        </header>
        <div className={`hi-status ${locked ? 'is-locked' : ''}`}><i />{locked ? <><Lock size={12} /> Selected element</> : <><MousePointer2 size={12} /> Move to preview · click to lock</>}</div>
        {restorable && !changes.length && <div className="hi-restore">
          <History size={17} />
          <span><strong>{restorable.changes.length} edit{restorable.changes.length === 1 ? '' : 's'} from your last session</strong><small>Saved {new Date(restorable.savedAt).toLocaleString()} on this page.</small></span>
          <div><button className="is-primary" onClick={() => restoreSession(restorable)}>Restore</button><button onClick={discardSession}>Discard</button></div>
        </div>}
        {restoreNote && <div className="hi-restore is-note"><CircleAlert size={16} /><span><small>{restoreNote}</small></span><div><button onClick={() => setRestoreNote(null)}>Dismiss</button></div></div>}
        <div className="hi-scroll">
          {!snapshot ? <div className="hi-onboarding"><div><MousePointer2 size={24} /></div><h2>Select something on the canvas</h2><p>Move over the page to preview an element. Click to lock it, then edit it here or straight on the canvas.</p><div><span>ESC</span> unlock or close</div></div>
            : <div className="hi-design">
              <div className="hi-design-heading"><div><span>DESIGN MODE</span><h2>{snapshot.family.label}</h2><p>Live preview edits. Source files stay untouched.</p></div><span className="hi-live-dot">Live</span></div>
              <div className="hi-scope"><button className={scope === 'free' ? 'is-active' : ''} onClick={() => setScope('free')}>Free change<small>Selected part only</small></button><button className={scope === 'component' ? 'is-active' : ''} onClick={() => setScope('component')}>Component change<small>{snapshot.family.matchCount} matching variants</small></button></div>
              <div className="hi-canvas-switch">
                <button className={canvasEdit ? 'is-active' : ''} aria-pressed={canvasEdit} onClick={() => { if (canvasEdit) finishTextEdit(true); setCanvasEdit((current) => !current); }}>
                  <Maximize2 size={13} />Direct canvas editing
                </button>
                <small>Drag the handles to resize · double-click text to retype it in place. Shift keeps the ratio, Alt snaps to {CANVAS_SNAP_STEP}px, Esc cancels.</small>
              </div>
              {canvasNote && <div className="hi-restore is-note"><CircleAlert size={16} /><span><small>{canvasNote}</small></span><div><button onClick={() => setCanvasNote(null)}>Dismiss</button></div></div>}
              <div className="hi-reset-row"><button onClick={resetElement} disabled={!currentTargets().some((element) => originalsRef.current.has(element))}><RotateCcw size={13} />Reset selection</button><button onClick={resetAll} disabled={!changes.length}><RotateCcw size={13} />Reset all</button></div>
              <ToolSection title="Device preview" icon={Monitor}><ResponsiveLauncher activeKind={activeDeviceKind} onOpen={openDevice} /></ToolSection>
              <ToolSection title="Token binding" icon={Link2} defaultOpen={false}><TokenBindingPanel snapshot={snapshot} colorTokens={colorTokens} onBind={applyTokenBinding} /></ToolSection>
              <ToolSection title="Page token audit" icon={ScanSearch} defaultOpen={false}><PageTokenAudit colorTokens={colorTokens} onSelect={selectElement} /></ToolSection>
              {['text', 'button', 'link', 'input'].includes(snapshot.kind) && <ToolSection title="Content" icon={Type}><label className="hi-control hi-control-stack"><span>{snapshot.kind === 'input' ? 'Value' : 'Text'}</span><DraftTextArea key={snapshot.uniquePath} ariaLabel={snapshot.kind === 'input' ? 'Value' : 'Text'} value={snapshot.rawText} onChange={applyText} /></label>{snapshot.hasMarkup && <p className="hi-empty-note hi-content-warning"><CircleAlert size={13} />This element wraps markup (line breaks, nested spans). Editing the text here replaces all of it with plain text.</p>}{snapshot.kind === 'link' && <label className="hi-control"><span>Link</span><input defaultValue={snapshot.attributes.href || ''} onBlur={(event) => applyAttribute('href', event.target.value)} /></label>}{snapshot.kind === 'input' && <><label className="hi-control"><span>Placeholder</span><input defaultValue={snapshot.attributes.placeholder || ''} onBlur={(event) => applyAttribute('placeholder', event.target.value)} /></label><label className="hi-control"><span>ARIA label</span><input defaultValue={snapshot.attributes['aria-label'] || ''} onBlur={(event) => applyAttribute('aria-label', event.target.value)} /></label></>}</ToolSection>}
              <ToolSection title="Layout" icon={Layers3}>
                <label className="hi-control"><span>Display</span><select value={snapshot.styles.display} onChange={(event) => applyStyle('display', event.target.value)}><option>block</option><option>inline</option><option>inline-block</option><option>flex</option><option>grid</option><option>none</option></select></label>
                <div className="hi-control-pair"><NumberField label="W" value={snapshot.rect.width} onChange={(value) => applyStyle('width', value)} /><NumberField label="H" value={snapshot.rect.height} onChange={(value) => applyStyle('height', value)} /></div>
                {snapshot.styles.display.includes('flex') && <><label className="hi-control"><span>Direction</span><select value={snapshot.styles['flex-direction']} onChange={(event) => applyStyle('flex-direction', event.target.value)}><option>row</option><option>column</option><option>row-reverse</option><option>column-reverse</option></select></label><label className="hi-control"><span>Align items</span><select value={snapshot.styles['align-items']} onChange={(event) => applyStyle('align-items', event.target.value)}><option>stretch</option><option>flex-start</option><option>center</option><option>flex-end</option><option>baseline</option></select></label><label className="hi-control"><span>Justify</span><select value={snapshot.styles['justify-content']} onChange={(event) => applyStyle('justify-content', event.target.value)}><option>flex-start</option><option>center</option><option>flex-end</option><option>space-between</option><option>space-around</option><option>space-evenly</option></select></label></>}
                <NumberField label="Gap" value={liveStyle?.gap ?? 0} onChange={(value) => applyStyle('gap', value)} />
                <BoxSidesField label="Padding" property="padding" element={snapshot.element} onChange={applyStyle} />
                <BoxSidesField label="Margin" property="margin" element={snapshot.element} onChange={applyStyle} />
                <div className="hi-reorder"><button onClick={() => reorder(-1)}><ArrowLeft size={13} /><ArrowUp size={13} />Earlier</button><button onClick={() => reorder(1)}>Later<ArrowDown size={13} /><ArrowRight size={13} /></button></div>
              </ToolSection>
              <ToolSection title="Fill & stroke" icon={Palette}>
                <TokenColorField label="Fill" value={snapshot.styles.background} tokens={colorTokens} onChange={(value) => applyStyle('background-color', value)} />
                {['text', 'button', 'link', 'input'].includes(snapshot.kind) && <TokenColorField label="Text" value={snapshot.styles.color} tokens={colorTokens} onChange={(value) => applyStyle('color', value)} />}
                <TokenColorField label="Stroke" value={liveStyle?.borderColor ?? snapshot.styles.border} tokens={colorTokens} onChange={(value) => applyStyle('border-color', value)} />
                <div className="hi-control-pair"><NumberField label="Stroke" value={liveStyle?.borderWidth ?? 0} min={0} onChange={(value) => applyStyle('border-width', value)} /><label className="hi-control hi-compact-control"><span>Style</span><select value={liveStyle?.borderStyle ?? 'solid'} onChange={(event) => applyStyle('border-style', event.target.value)}><option>solid</option><option>dashed</option><option>dotted</option><option>double</option><option>none</option></select></label></div>
                <NumberField label="Corner radius" value={snapshot.styles['border-radius']} min={0} onChange={(value) => applyStyle('border-radius', value)} />
                <NumberField label="Opacity" value={cssNumber(snapshot.styles.opacity, 1) * 100} min={0} max={100} suffix="%" onChange={(value) => applyStyle('opacity', String(Number(value) / 100))} />
              </ToolSection>
              {['text', 'button', 'link', 'input'].includes(snapshot.kind) && <ToolSection title="Typography" icon={Type}>
                <FontField label="Font" value={snapshot.styles['font-family']} projectFonts={pageFonts} onChange={(value) => applyStyle('font-family', value)} />
                <div className="hi-control-pair"><label className="hi-control hi-compact-control"><span>Size</span><select value={snapshot.styles['font-size']} onChange={(event) => applyStyle('font-size', event.target.value)}>{FONT_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label><label className="hi-control hi-compact-control"><span>Weight</span><select value={snapshot.styles['font-weight']} onChange={(event) => applyStyle('font-weight', event.target.value)}>{['300', '400', '500', '600', '700', '800', '900'].map((weight) => <option key={weight}>{weight}</option>)}</select></label></div>
                <div className="hi-control-pair"><NumberField label="Line" value={snapshot.styles['line-height']} onChange={(value) => applyStyle('line-height', value)} /><NumberField label="Track" value={snapshot.styles['letter-spacing']} step={0.1} onChange={(value) => applyStyle('letter-spacing', value)} /></div>
                <div className="hi-segmented" aria-label="Text alignment">{TEXT_ALIGNMENTS.map(({ value, label, Icon }) => <button key={value} title={label} aria-label={label} className={snapshot.styles['text-align'] === value ? 'is-active' : ''} onClick={() => applyStyle('text-align', value)}><Icon size={14} /></button>)}</div>
                <div className="hi-type-presets">{typePresets.map((recipe) => <button key={recipe.label} onClick={() => recipe.css.split(';').filter(Boolean).forEach((part) => { const [property, ...value] = part.split(':'); applyStyle(property.trim(), value.join(':').trim()); })}>{recipe.label}</button>)}</div>
              </ToolSection>}
              <ToolSection title="Effects" icon={Sparkles} defaultOpen={false}>
                <label className="hi-control"><span>Shadow</span><select value={snapshot.styles['box-shadow']} onChange={(event) => applyStyle('box-shadow', event.target.value)}><option value="none">None</option><option value="0 1px 2px rgba(0,0,0,.08)">Subtle</option><option value="0 8px 24px rgba(23,18,87,.12)">Elevated</option><option value="0 20px 50px rgba(23,18,87,.18)">Floating</option><option value={snapshot.styles['box-shadow']}>Current / custom</option></select></label>
                <label className="hi-control"><span>Filter</span><input value={snapshot.styles.filter} onChange={(event) => applyStyle('filter', event.target.value)} /></label>
                <label className="hi-control"><span>Transform</span><input value={snapshot.styles.transform} onChange={(event) => applyStyle('transform', event.target.value)} /></label>
              </ToolSection>
              {snapshot.assets.length > 0 && <ToolSection title={`Assets · ${snapshot.assets.length}`} icon={ImageIcon}><div className="hi-design-assets">{snapshot.assets.map((asset) => <article key={asset.id}><div className="hi-asset-head"><img src={asset.src} alt="" /><span><strong>{asset.label}</strong><small>{asset.type} · {asset.id}</small></span><a href={asset.src} download={`${asset.id}.${asset.type === 'svg' ? 'svg' : 'png'}`} title="Download the current asset"><Download size={14} /></a></div><label><span>Replace by URL</span><input placeholder="https://…" onKeyDown={(event) => { if (event.key === 'Enter') applyAsset(asset, event.currentTarget.value, 'URL replacement'); }} /></label><label className="hi-upload"><input type="file" accept="image/*,.svg" onChange={(event) => onAssetFile(asset, event.target.files?.[0])} />Upload image or SVG</label>{asset.type === 'svg' && <div className="hi-icon-library">{ICON_LIBRARY.map((icon) => <button key={icon.label} title={icon.label} onClick={() => applyAsset(asset, icon.svg, `${icon.label} icon`)} dangerouslySetInnerHTML={{ __html: icon.svg }} />)}</div>}</article>)}</div></ToolSection>}
              <ToolSection title="Component states · 6" icon={MousePointer2} defaultOpen={false}>
                <ComponentStatesEditor snapshot={snapshot} colorTokens={colorTokens} resetSignal={stateResetSignal} onStateChange={recordStateChange} />
                {snapshot.currentStates.length > 0 && <div className="hi-state-chips">{snapshot.currentStates.map((state) => <span key={state}>{state}</span>)}</div>}
                {/* What the stylesheet already declares, so an override is not written on top of a rule that agrees with it. */}
                {snapshot.stateRules.length ? snapshot.stateRules.map((rule, index) => <div className="hi-state-rule" key={`${rule.selector}-${index}`}><span>{rule.state}</span><code>{rule.selector} {'{'}{rule.declarations.map((item) => `\n  ${item.property}: ${item.value};`).join('')}\n{'}'}</code><CopyButton value={`${rule.selector} {\n${rule.declarations.map((item) => `  ${item.property}: ${item.value};`).join('\n')}\n}`} /></div>) : <p className="hi-empty-note">No readable pseudo-state rules matched this element.</p>}
              </ToolSection>
              <ToolSection title="Accessibility check" icon={ShieldCheck}><AccessibilityPanel snapshot={snapshot} /></ToolSection>
              <MeasurementDetails snapshot={snapshot} />
              <ToolSection title={`Designer changes · ${changes.length}`} icon={Code2} defaultOpen={changes.length > 0} openWhen={changes.length > 0}>{changes.length ? <>
                <div className="hi-handoff-actions">
                  <CopyButton value={handoffText} label="Copy everything" />
                  {cssDiff && <CopyButton value={cssDiff} label="Copy CSS" />}
                  {instructions && <CopyButton value={instructions} label="Copy instructions" />}
                </div>
                {designChanges.length < changes.length && <p className="hi-empty-note">Showing all {changes.length} edits on this page. {designChanges.length} of them {designChanges.length === 1 ? 'is' : 'are'} on the current selection.</p>}
                <div className="hi-change-log">{changes.map((change, index) => <div key={`${change.selector}-${change.property}-${index}`} className={`${change.instruction ? 'has-instruction' : ''} ${designChanges.includes(change) ? 'is-current' : ''}`}>
                  <span>{change.kind}</span><strong>{change.property}</strong><small><del>{change.before || '—'}</del> → {change.after}</small>
                  <button className="hi-change-selector" title="Select this element" onClick={() => change.element.isConnected && selectElement(change.element)}>{change.selector}</button>
                  {change.instruction && <p className="hi-change-instruction"><Wand2 size={12} /><span>{change.instruction}</span></p>}
                </div>)}</div>
                {cssDiff && <div className="hi-code"><CopyButton value={cssDiff} label="Copy CSS" /><pre>{cssDiff}</pre></div>}
              </> : <p className="hi-empty-note">Edits will appear here as a handoff-ready change log.</p>}</ToolSection>
            </div>}
        </div>
      </aside>
    </>}
  </div>;
}

/** Query-string flag that opts a page into the inspector. */
export const DESIGN_MODE_PARAM = 'designmode';

/** True when the current URL carries `?designmode=true`. */
function designModeInUrl(): boolean {
  if (!isBrowser) return false;
  try {
    return new URLSearchParams(window.location.search).get(DESIGN_MODE_PARAM)?.toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export type HandoffInspectorProps = {
  /**
   * Force the inspector on or off, bypassing the URL check — e.g. `enabled={import.meta.env.DEV}`
   * to have it always available locally. Omit to use `?designmode=true`.
   */
  enabled?: boolean;
};

/**
 * Renders the inspector only when the page opts in with `?designmode=true`.
 *
 * The gate exists because this component mounts a visible launcher button and binds global
 * pointer/key listeners — without it, dropping `<HandoffInspector />` into an app ships a design
 * tool to every real visitor. Defaulting to off means shipping it is a deliberate act.
 *
 * The flag is deliberately read after mount rather than during render: the server has no URL to
 * read, so deciding during render would make the server and client disagree and trip a hydration
 * mismatch in Next.js/Remix.
 */
export default function HandoffInspector({ enabled }: HandoffInspectorProps = {}) {
  const [urlEnabled, setUrlEnabled] = useState(false);

  useEffect(() => {
    if (enabled !== undefined) return;
    const read = () => setUrlEnabled(designModeInUrl());
    read();
    // Client-side navigation can add or drop the flag without a page load.
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [enabled]);

  if (!(enabled ?? urlEnabled)) return null;
  return <HandoffInspectorPanel />;
}
