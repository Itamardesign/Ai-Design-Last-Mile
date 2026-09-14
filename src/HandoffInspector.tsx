import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
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
  Cloud,
  Code2,
  Component,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  FileCode2,
  Gauge,
  History,
  Layers,
  Image as ImageIcon,
  Layers3,
  Link2,
  LoaderCircle,
  Lock,
  MessageSquare,
  MoreHorizontal,
  PaintBucket,
  Pipette,
  Monitor,
  MousePointerClick,
  Move,
  MousePointer2,
  Palette,
  PanelLeft,
  PanelRight,
  PenTool,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
  Trash2,
  Type,
  Unlink,
  Unlock,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CUSTOM_DESIGN_TOKENS_STORAGE_KEY,
  defaultDeviceForKind,
  inspectorAccessibilityThresholds,
  inspectorDevicePresets,
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
import { computeSnap, findInsertion, measureBetween, type InsertionPoint, type SnapGuide, type SnapRect, type SnapTarget } from './snap.js';
import { defaultGradient, gradientBar, parseGradient, reverseGradient, sampleGradient, serializeGradient, sortStops, splitHexAlpha, stopColor, type Gradient, type GradientStop, type GradientType } from './gradient.js';

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
  /** True when the site's own CSS had to be outranked to make the edit visible — see `applyStyleTo`. */
  forced?: boolean;
  /** The inline value this edit replaced, so this one edit can be taken back without resetting the rest. */
  inlineBefore?: string;
  priorityBefore?: string;
  /** Attribute undo must distinguish a missing attribute from an explicitly empty one. */
  hadAttributeBefore?: boolean;
  /** How many elements the edit landed on — one, or every variant of a component. */
  appliedTo?: number;
  /** The screen this was decided at — see `ViewportContext`. */
  viewport?: ViewportContext;
  kind: 'css' | 'content' | 'attribute' | 'asset' | 'layout' | 'state' | 'token';
  /** Handoff note explaining what a designer or developer has to do in the source of truth. */
  instruction?: string;
  /** Custom property declaration a token change needs in the design system. */
  cssVariable?: { name: string; value: string };
  /** Previous inline root value for undoing token creation/binding without leaking variables. */
  tokenVariableBefore?: { value: string; priority: string } | null;
  /** Stable selector marker required to make a redone pseudo-state rule match again. */
  stateMark?: string;
  /** Exact DOM snapshots for edits such as assets and reordering that are not scalar CSS values. */
  domBefore?: OriginalState;
  domAfter?: OriginalState;
};

type HistoryEntry = {
  label: string;
  /** Immediate before/after mutations, kept separate from the coalesced handoff log. */
  changes: DesignChange[];
};

function mergeChangeLog(current: DesignChange[], incoming: readonly DesignChange[]): DesignChange[] {
  const next = [...current];
  for (const change of incoming) {
    const existing = next.findIndex((item) => item.element === change.element && item.property === change.property);
    if (existing === -1) next.push(change);
    else next[existing] = {
      ...change,
      before: next[existing].before,
      inlineBefore: next[existing].inlineBefore,
      priorityBefore: next[existing].priorityBefore,
      hadAttributeBefore: next[existing].hadAttributeBefore,
      tokenVariableBefore: next[existing].tokenVariableBefore,
      domBefore: next[existing].domBefore,
    };
  }
  return next;
}

function historyChangeLog(entries: readonly HistoryEntry[]): DesignChange[] {
  return entries.reduce<DesignChange[]>((log, entry) => mergeChangeLog(log, entry.changes), []);
}

function captureOriginalState(element: HTMLElement): OriginalState {
  return {
    element,
    styleAttribute: element.getAttribute('style'),
    innerHTML: element.innerHTML,
    textContent: element.textContent,
    value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : undefined,
    attributes: Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
    parent: element.parentNode,
    nextSibling: element.nextSibling,
  };
}

function restoreCapturedState(original: OriginalState): void {
  const { element } = original;
  Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
  original.attributes.forEach(([name, value]) => element.setAttribute(name, value));
  if (original.styleAttribute === null) element.removeAttribute('style'); else element.setAttribute('style', original.styleAttribute);
  element.innerHTML = original.innerHTML;
  if (original.value !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.value = original.value;
  if (original.parent && element.parentNode !== original.parent) original.parent.insertBefore(element, original.nextSibling);
  else if (original.parent && element.nextSibling !== original.nextSibling) original.parent.insertBefore(element, original.nextSibling);
}

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
/**
 * Sizes offered as a starting point — not a ceiling.
 *
 * These used to be the only sizes the panel would set, which quietly asserted that nothing on any
 * page is larger than 64px. Hero type is. They are presets now; the field takes any number.
 */
const FONT_SIZES = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '28px', '32px', '40px', '48px', '56px', '64px', '80px', '96px', '128px'];

/** Weights named as well as numbered: "600" is a number, "Semibold" is a decision. */
const FONT_WEIGHTS = [
  { value: '300', label: 'Light · 300' },
  { value: '400', label: 'Regular · 400' },
  { value: '500', label: 'Medium · 500' },
  { value: '600', label: 'Semibold · 600' },
  { value: '700', label: 'Bold · 700' },
  { value: '800', label: 'Extrabold · 800' },
  { value: '900', label: 'Black · 900' },
];

const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'none'].map((value) => ({ value, label: value }));

const DISPLAY_MODES = ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'].map((value) => ({ value, label: value }));

const FLEX_DIRECTIONS = [
  { value: 'row', label: 'Row', hint: '→' },
  { value: 'column', label: 'Column', hint: '↓' },
  { value: 'row-reverse', label: 'Row reverse', hint: '←' },
  { value: 'column-reverse', label: 'Column reverse', hint: '↑' },
];

const ALIGN_ITEMS = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'].map((value) => ({ value, label: value }));

const JUSTIFY_CONTENT = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map((value) => ({ value, label: value }));

/** The named elevations, plus whatever the element already has — opening the list must never lose it. */
function shadowOptions(current: string) {
  const named = [
    { value: 'none', label: 'None' },
    { value: '0 1px 2px rgba(0,0,0,.08)', label: 'Subtle' },
    { value: '0 8px 24px rgba(23,18,87,.12)', label: 'Elevated' },
    { value: '0 20px 50px rgba(23,18,87,.18)', label: 'Floating' },
  ];
  if (current && !named.some((option) => option.value === current)) {
    named.push({ value: current, label: 'Current · custom' });
  }
  return named;
}
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
  forced?: boolean;
  inlineBefore?: string;
  priorityBefore?: string;
  hadAttributeBefore?: boolean;
  tokenVariableBefore?: { value: string; priority: string } | null;
};

type StoredSession = { savedAt: string; variables: Array<[string, string]>; changes: StoredChange[] };

/**
 * The screen a decision was made at.
 *
 * Without this, a note written while looking at the phone preview and an edit made on the desktop
 * page arrive in the handoff looking identical — and "the padding is too tight" means different
 * things at 390px and at 1440px. Recorded at the moment of the edit, because it cannot be recovered
 * afterwards: the preview may since have been closed, rotated or switched to another device.
 */
type ViewportContext = { width: number; height: number; label: string };

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

type InspectorMode = 'design' | 'comment' | 'handoff';

/** One note pinned to one element. Elements can carry several. */
type PageComment = {
  id: string;
  path: string;
  selector: string;
  label: string;
  text: string;
  createdAt: string;
  /** Who left it. Blank until someone signs their notes — see `readCommentAuthor`. */
  author?: string;
  /** The screen it was written at — a remark about spacing means different things at 390px and 1440px. */
  viewport?: ViewportContext;
  /** What the element looked like, for finding it again after the markup moves. Absent on older notes. */
  anchor?: CommentAnchor;
  /** Kept rather than deleted, so a review reads as a list of decisions rather than a list of gaps. */
  resolved?: boolean;
};

/**
 * A description of the element a note was left on, independent of where it sat in the tree.
 *
 * The structural path is exact and therefore brittle: one wrapper div added on the next deploy and
 * every note below it points at nothing. What a reviewer actually meant was "this button, the one
 * that says Upgrade plan" — which survives a refactor that `body > div:nth-child(2)` does not.
 */
type CommentAnchor = { tag: string; text: string; classes: string[]; role?: string; ancestor?: string };

const COMMENTS_STORAGE_KEY = 'meraki-inspector-comments';
const COMMENT_AUTHOR_KEY = 'meraki-inspector-author';

const anchorText = (element: Element): string => (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

/** Classes a bundler is unlikely to have generated, so they still mean something next week. */
const stableClasses = (element: Element): string[] =>
  Array.from(element.classList)
    .filter((name) => name.length < 32 && !name.includes(':') && !/^[a-z]{1,3}[-_]?[0-9a-f]{5,}$/i.test(name))
    .slice(0, 4);

function captureAnchor(element: HTMLElement): CommentAnchor {
  // The nearest ancestor a human named — an id, a landmark, a test hook. Narrows the search without
  // pinning the note to the exact depth it was written at.
  let ancestor: string | undefined;
  for (let node = element.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
    if (node.id) { ancestor = `#${CSS.escape(node.id)}`; break; }
    const hook = node.getAttribute('data-testid') ?? node.getAttribute('data-component');
    if (hook) { ancestor = `[data-testid="${hook}"], [data-component="${hook}"]`; break; }
    const named = stableClasses(node)[0];
    if (named) { ancestor = `.${escapeClass(named)}`; break; }
  }

  return {
    tag: element.tagName.toLowerCase(),
    text: anchorText(element),
    classes: stableClasses(element),
    role: element.getAttribute('role') ?? undefined,
    ancestor,
  };
}

/**
 * Finds the element a note was about, when its path no longer matches anything.
 *
 * Scored rather than matched: no single signal is reliable on its own — text changes, classes get
 * renamed, roles are often absent — but agreeing on several of them at once is rarely a coincidence.
 * The threshold is set so that a wrong element is much less likely than no element at all, because a
 * note silently reattached to the wrong button is worse than a note that says it lost its home.
 */
function findByAnchor(doc: Document, anchor: CommentAnchor): HTMLElement | null {
  // Every element of the right kind is a candidate. Scoping the *search* to the remembered ancestor
  // was the obvious optimisation and the wrong one: an element that moved out of that ancestor is
  // exactly the case this exists for. The ancestor is worth a point, not a veto.
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>(anchor.tag)).slice(0, 800);

  let inAncestor: HTMLElement[] = [];
  if (anchor.ancestor) {
    try {
      inAncestor = Array.from(doc.querySelectorAll<HTMLElement>(anchor.ancestor));
    } catch {
      inAncestor = [];
    }
  }

  let best: { element: HTMLElement; score: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.closest(IGNORED_SELECTOR)) continue;
    let score = 0;

    const text = anchorText(candidate);
    if (anchor.text && text) {
      if (text === anchor.text) score += 5;
      else if (text.startsWith(anchor.text.slice(0, 24)) || anchor.text.startsWith(text.slice(0, 24))) score += 3;
    } else if (!anchor.text && !text) score += 1;

    const shared = anchor.classes.filter((name) => candidate.classList.contains(name)).length;
    score += shared * 2;
    if (anchor.role && candidate.getAttribute('role') === anchor.role) score += 2;
    if (inAncestor.some((ancestor) => ancestor.contains(candidate))) score += 1;

    if (!best || score > best.score) best = { element: candidate, score };
  }

  return best && best.score >= 4 ? best.element : null;
}

/** The full search for a note's element: exact path, then selector, then what it looked like. */
function resolveComment(doc: Document, comment: Pick<PageComment, 'path' | 'selector' | 'anchor'>): HTMLElement | null {
  const exact = resolveInDocument(doc, { uniquePath: comment.path, selector: comment.selector });
  if (exact) return exact;
  return comment.anchor ? findByAnchor(doc, comment.anchor) : null;
}

/**
 * Who is reviewing.
 *
 * Asked for once, in the composer, and remembered — a page full of unattributed notes is no use to
 * the person who has to act on them. Empty is allowed and simply means the notes are unsigned.
 */
function readCommentAuthor(): string {
  return readStoredPreference(COMMENT_AUTHOR_KEY) ?? '';
}

function writeCommentAuthor(name: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(COMMENT_AUTHOR_KEY, name);
  } catch {
    // Same reasoning as the comments themselves: losing the name is survivable.
  }
}

/** Every note on one element, numbered in the order the first note on it was written. */
type CommentThread = { path: string; label: string; index: number; comments: PageComment[]; resolved: boolean };
type CommentMarker = CommentThread & { top: number; left: number };

/**
 * Groups notes into threads and numbers them.
 *
 * The number is the whole point of pinning: "see note 3" is something a designer can say out loud,
 * and it has to mean the same thing in the panel, on the page and inside the device preview. It
 * follows the order the conversation started in, so it does not shuffle when a note is resolved.
 */
function groupComments(comments: readonly PageComment[]): CommentThread[] {
  const byPath = new Map<string, PageComment[]>();
  for (const comment of comments) {
    const list = byPath.get(comment.path) ?? [];
    list.push(comment);
    byPath.set(comment.path, list);
  }
  return [...byPath.entries()]
    .map(([path, list]) => ({
      path,
      label: list[0].label,
      comments: list,
      startedAt: list.reduce((earliest, comment) => (comment.createdAt < earliest ? comment.createdAt : earliest), list[0].createdAt),
      resolved: list.every((comment) => comment.resolved),
    }))
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    .map((thread, order) => ({ path: thread.path, label: thread.label, comments: thread.comments, resolved: thread.resolved, index: order + 1 }));
}

/** "2 minutes ago" reads better on a pin than a timestamp nobody can parse at a glance. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Comments are per-page: a note about the pricing table means nothing on the checkout screen. */
function commentsKey(): string {
  return `${COMMENTS_STORAGE_KEY}:${isBrowser ? window.location.pathname.replace(/\/+$/, '') || '/' : '/'}`;
}

function readStoredComments(): PageComment[] {
  try {
    const parsed = JSON.parse(readStoredPreference(commentsKey()) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Announced as well as stored.
 *
 * Storage is the inspector's own business, but something outside it may want to keep a copy — the
 * Chrome extension mirrors notes into extension storage so a review survives the site clearing its
 * `localStorage`, and badges the toolbar with how many are still open. An event costs nothing when
 * nobody is listening, which is the usual case.
 */
const COMMENTS_CHANGE_EVENT = 'meraki-inspector-comments-change';
const SESSION_CHANGE_EVENT = 'meraki-inspector-session-change';

function writeStoredComments(comments: PageComment[]): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(commentsKey(), JSON.stringify(comments));
  } catch {
    // Storage can be full or blocked; losing persistence is survivable, crashing is not.
  }
  try {
    window.dispatchEvent(new CustomEvent(COMMENTS_CHANGE_EVENT, { detail: { comments } }));
  } catch {
    // Older engines without CustomEvent constructors: the notes are still saved.
  }
}

/**
 * The same announcement, for the unfinished session.
 *
 * `null` means the log went empty — everything was undone or reset — and a listener mirroring this
 * has to hear that as clearly as it hears a save, or a page would keep offering to restore edits that
 * no longer exist.
 */
function announceSession(session: StoredSession | null): void {
  if (!isBrowser) return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_CHANGE_EVENT, { detail: { session } }));
  } catch {
    // Older engines without CustomEvent constructors: the session is still saved.
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

/*
 * An inline style loses to an `!important` rule, and a fair number of real sites write them —
 * themes, resets, utility frameworks, anything that has ever lost a specificity argument. Without
 * this, clicking a colour swatch on such a site did nothing at all while the tool cheerfully
 * recorded the change: the single worst way for an editor to fail.
 */
const forcedSelectorCache = new Map<string, string[]>();
let forcedCacheSignature = '';

/**
 * Every selector on the page that declares this property `!important`.
 *
 * Walking every rule in every stylesheet is not something to do on each keystroke of a slider, so
 * the answer is cached per property. The cache is keyed on how many sheets and rules the document
 * has, which is enough to notice a stylesheet being added or swapped without paying to check
 * properly on a path this hot.
 */
function forcedSelectorsFor(doc: Document, property: string): string[] {
  const sheets = Array.from(doc.styleSheets);
  const signature = sheets.map((sheet) => {
    try {
      return sheet.cssRules.length;
    } catch {
      return 'x';
    }
  }).join(',');

  if (signature !== forcedCacheSignature) {
    forcedSelectorCache.clear();
    forcedCacheSignature = signature;
  }

  const cached = forcedSelectorCache.get(property);
  if (cached) return cached;

  const selectors: string[] = [];
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // Cross-origin: unreadable, and the applied-value check downstream still catches it.
    }
    for (const rule of Array.from(rules)) {
      // Media and support blocks hold the declarations that actually apply at this width.
      const nested = rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule ? Array.from(rule.cssRules) : [rule];
      for (const candidate of nested) {
        if (candidate instanceof CSSStyleRule && candidate.style.getPropertyPriority(property) === 'important') {
          selectors.push(candidate.selectorText);
        }
      }
    }
  }

  forcedSelectorCache.set(property, selectors);
  return selectors;
}

/**
 * Does the page declare this property `!important` for this element?
 */
function pageForcesProperty(element: HTMLElement, property: string): boolean {
  return forcedSelectorsFor(element.ownerDocument, property).some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      // Selectors this engine cannot parse (`:has` in older browsers, vendor pseudo-elements).
      return false;
    }
  });
}

/** Did the value actually land? Colours are compared as colours, since `#12A150` computes to `rgb(...)`. */
function valueApplied(element: HTMLElement, property: string, value: string): boolean {
  const computed = getComputedStyle(element).getPropertyValue(property).trim();
  if (!computed) return true;
  const wanted = parseColor(value);
  const got = parseColor(computed);
  if (wanted && got) return wanted.every((channel, index) => Math.abs(channel - got[index]) < 0.02);
  return computed.replace(/["'\s]/g, '').toLowerCase() === value.replace(/["'\s]/g, '').toLowerCase();
}

/**
 * Sets a property so that it is actually visible.
 *
 * Tries the polite way first, because a plain inline value is what a designer expects to see in
 * devtools and what the exported CSS should read like. Only when the page fights back does the edit
 * escalate — and the caller is told, so the copied stylesheet can carry the same `!important` and
 * reproduce what was on screen.
 */
function setPropertyVisibly(element: HTMLElement, property: string, value: string): boolean {
  element.style.setProperty(property, value);
  if (!pageForcesProperty(element, property) && valueApplied(element, property, value)) return false;
  element.style.setProperty(property, value, 'important');
  return true;
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
  const root = element.ownerDocument.documentElement;
  let current: Element | null = element;
  while (current && current !== root) {
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
  const stop = element.ownerDocument.body;
  let current: Element | null = element;
  while (current && current !== stop && parts.length < 6) {
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
      candidates = Array.from(selected.ownerDocument.querySelectorAll<HTMLElement>(`[${key}="${value.replace(/"/g, '\\"')}"]`));
      reason = `${key}="${value}"`;
      break;
    }
  }
  if (!candidates.length) {
    const stableClasses = Array.from(selected.classList).filter((name) => name.length < 48 && !name.includes(':')).slice(0, 2);
    if (stableClasses.length) {
      const query = `${selected.tagName.toLowerCase()}${stableClasses.map((name) => `.${escapeClass(name)}`).join('')}`;
      try {
        candidates = Array.from(selected.ownerDocument.querySelectorAll<HTMLElement>(query));
        reason = `tag + ${stableClasses.join(' + ')}`;
      } catch { candidates = []; }
    }
  }
  if (!candidates.length && selected.getAttribute('role')) {
    candidates = Array.from(selected.ownerDocument.querySelectorAll<HTMLElement>(`${selected.tagName.toLowerCase()}[role="${selected.getAttribute('role')}"]`));
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

function ToolSection({ title, icon: Icon, children, defaultOpen = true, openWhen = false, disabled = false, disabledHint, badge }: { title: string; icon: typeof Layers3; children: ReactNode; defaultOpen?: boolean; openWhen?: boolean; disabled?: boolean; disabledHint?: string; badge?: { text: string; tone: 'alert' | 'ok' } }) {
  const [open, setOpen] = useState(defaultOpen && !disabled);
  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);
  // A disabled section stays visible but never opens: the feature should be discoverable, and the
  // tooltip explains what unlocks it, which a hidden section could not do.
  const isOpen = open && !disabled;
  return <section className={`hi-section ${disabled ? 'is-disabled' : ''}`} data-hi-section={sectionId(title)} data-hi-open={isOpen ? 'true' : 'false'}>
    <button className="hi-section-title" onClick={() => { if (!disabled) setOpen((current) => !current); }} aria-disabled={disabled} title={disabled ? disabledHint : undefined}>
      <span><Icon size={14} />{title}</span>
      <span className="hi-section-meta">
        {/* Carries the state onto the collapsed header, so a problem is visible without opening it. */}
        {badge && <em className={`hi-section-badge is-${badge.tone}`}>{badge.text}</em>}
        {disabled ? <Lock size={12} /> : <ChevronDown size={14} className={isOpen ? 'is-open' : ''} />}
      </span>
    </button>
    {isOpen && <div className="hi-section-body">{children}</div>}
  </section>;
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

/**
 * Drag the label to change the number.
 *
 * The one interaction every design tool has and every inspector-style panel forgets: you should be
 * able to grab a value and pull it, watching the page respond, rather than select-type-tab for every
 * two-pixel adjustment. Pointer capture keeps the drag alive outside the label, Shift moves in tens
 * and Alt in tenths, and a plain click still puts the caret in the field.
 */
function useScrub(value: string | number, step: number, min: number | undefined, max: number | undefined, onChange: (value: string) => void) {
  const state = useRef({ pointer: 0, start: 0, moved: false, dragging: false });

  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      state.current = { pointer: event.clientX, start: cssNumber(value), moved: false, dragging: true };
      // Capture keeps the drag alive past the edge of a 60px label. It can refuse (a pointer that
      // has already been released, a synthetic event), and a drag that works is worth more than a
      // captured one — so the flag above, not the capture, is what says a drag is in progress.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Uncaptured: the drag still tracks while the pointer stays over the label.
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (!state.current.dragging) return;
      const travelled = event.clientX - state.current.pointer;
      // Two pixels of travel per tick: fine enough to land on a value, fast enough to cross a range.
      const ticks = Math.trunc(travelled / 2);
      if (!ticks && !state.current.moved) return;
      state.current.moved = true;
      const scale = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const raw = state.current.start + ticks * step * scale;
      const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, raw));
      onChange(String(Math.round(clamped * 100) / 100));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      state.current.dragging = false;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Nothing to release.
      }
      // A click that never moved belongs to the input, not to the drag.
      if (!state.current.moved) (event.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
    },
    onPointerCancel: () => { state.current.dragging = false; },
  };
}

function NumberField({ label, value, onChange, min, max, step = 1, suffix = 'px' }: { label: string; value: string | number; onChange: (value: string) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const scrub = useScrub(value, step, min, max, onChange);
  return <label className="hi-control hi-control--scrub">
    <span className="hi-scrub-label" title={`Drag to change · Shift ×10 · Alt ×0.1`} {...scrub}>{label}</span>
    <div className="hi-number-field">
      <DraftNumberInput ariaLabel={`${label} ${suffix}`} value={value} min={min} max={max} step={step} onCommit={onChange} />
      <em>{suffix}</em>
    </div>
  </label>;
}

function BoxSidesField({ label, property, element, onChange }: { label: string; property: 'padding' | 'margin'; element: HTMLElement; onChange: (property: string, value: string) => void }) {
  const style = getComputedStyle(element);
  return <div className="hi-box-sides-control"><span>{label}</span><div>{SIDES.map((side) => <label key={side} title={`${property}-${side}`}><small>{side[0].toUpperCase()}</small><DraftNumberInput ariaLabel={`${label} ${side}`} value={style.getPropertyValue(`${property}-${side}`)} onCommit={(value) => onChange(`${property}-${side}`, value)} /><em>px</em></label>)}</div></div>;
}

/**
 * Where to draw a menu so that it is fully visible.
 *
 * Two problems, one answer. The panel body scrolls, and a list drawn inside a scrolling box is
 * clipped by it — which is why these menus arrived cut in half. And a list opening downward from a
 * field near the foot of the panel runs off the screen even when nothing clips it.
 *
 * So the menu is positioned in viewport coordinates, outside the scroll box's reach, measured from
 * the trigger each time it opens and re-measured while the panel scrolls underneath it.
 */
function useMenuAnchor(open: boolean, anchor: { current: HTMLElement | null }, estimatedHeight = 240) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open) { setBox(null); return; }

    const place = () => {
      const node = anchor.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      // Open downward unless the room is genuinely better upward.
      const up = below < Math.min(estimatedHeight, 160) && above > below;
      const maxHeight = Math.max(120, Math.min(estimatedHeight, up ? above : below));
      setBox({
        top: up ? Math.max(gap, rect.top - gap - maxHeight) : rect.bottom + gap,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };

    place();
    // The panel scrolls under the menu, and the window can be resized with it open.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, estimatedHeight]);

  return box;
}

/**
 * Closes a menu when the next press lands somewhere else.
 *
 * `event.target` is the wrong thing to test here. The panel lives in a shadow root, and an event
 * observed from `document` is retargeted to the shadow host — so a press *inside* the open menu
 * looked, from the outside, exactly like a press somewhere else, and the menu closed before the
 * click could land. That was the whole of "the dropdowns do nothing when pressed".
 * `composedPath()` reports the real path through the shadow tree.
 *
 * Several elements count as "inside" because the menu is portalled away from its field.
 */
function useDismissOnOutsidePress(open: boolean, insides: Array<{ current: HTMLElement | null }>, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (insides.some((ref) => ref.current && path.includes(ref.current))) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}

/**
 * Somewhere to draw a menu that the panel cannot clip or capture.
 *
 * The panel is glass: it has a `backdrop-filter` and an entrance `transform`, and either of those
 * makes it the containing block for `position: fixed` descendants — so a menu inside it is measured
 * against the panel, not the screen, and then cropped by the panel's own `overflow: hidden`. That is
 * why the lists arrived cut off. The fix is not to fight the glass but to render outside it, in a
 * plain container at the root of the inspector's shadow tree, where fixed means fixed.
 */
function usePortalTarget(source: { current: HTMLElement | null }, active: boolean): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = source.current;
    if (!node) return;
    const root = node.getRootNode() as ShadowRoot | Document;
    const host = (root as ShadowRoot).querySelector?.('.hi-root') ?? (root as Document).body ?? null;
    if (!host) return;
    let layer = host.querySelector<HTMLElement>(':scope > .hi-menu-layer');
    if (!layer) {
      layer = host.ownerDocument.createElement('div');
      layer.className = 'hi-menu-layer';
      host.appendChild(layer);
    }
    setTarget(layer);
  }, [source, active]);

  return target;
}

/**
 * Hands the report over as a file.
 *
 * The clipboard is fine for a paste into a ticket and useless for anything that wants an
 * attachment. Written through a blob URL and revoked immediately, so nothing is left behind on the
 * page the inspector is a guest on.
 */
function downloadFile(name: string, contents: string | Blob, type = 'text/markdown') {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately would race the download in some builds; a tick is enough.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A screenshot of the page, when something can take one.
 *
 * Only the extension can: a page cannot photograph itself, and the service worker's
 * `captureVisibleTab` is the one thing here that needs a privilege the component does not have. The
 * capability is published by the extension's content script onto the window it shares with this
 * code, so the button appears where it works and is absent where it does not — rather than being
 * offered everywhere and failing on half of them.
 */
type CaptureHost = typeof window & { __merakiInspectorCapture?: () => Promise<string | null> };

const captureAvailable = () => typeof window !== 'undefined' && typeof (window as CaptureHost).__merakiInspectorCapture === 'function';

/**
 * Keeping a handoff needs an account, which is the extension's business and not this component's.
 *
 * Published the same way as the screenshot capability, and for the same reason: the button appears
 * where there is somewhere to save to, and is absent — not broken, not offering to sign anybody in —
 * when the component is rendered by an app or by a designer who chose to stay local.
 */
export type HandoffDocument = {
  url: string;
  title: string;
  author: string;
  markdown: string;
  css: string;
  changeCount: number;
  noteCount: number;
  issueCount: number;
  /** A PNG data URL, when one was captured. Uploaded separately; it is far too big for a document. */
  screenshot: string | null;
};

type CloudHost = typeof window & {
  __merakiInspectorCloud?: { save: (doc: HandoffDocument) => Promise<{ ok: boolean; error?: string }> };
};

const cloudAvailable = () => typeof window !== 'undefined' && typeof (window as CloudHost).__merakiInspectorCloud?.save === 'function';

/**
 * The third published capability: the way to wherever the host keeps everything else.
 *
 * In the extension that is the settings page — connected systems, every page's notes, kept handoffs,
 * the account. An app rendering this component has its own settings screen and no need of ours, so the
 * button is absent there rather than pointing somewhere that does not exist.
 */
type HubHost = typeof window & { __merakiInspectorHub?: () => void };

const hubAvailable = () => typeof window !== 'undefined' && typeof (window as HubHost).__merakiInspectorHub === 'function';

/**
 * A short name for an element, for the handoff report.
 *
 * Cheaper on purpose than the panel's component-family lookup, which queries the whole document per
 * element — this only has to be recognisable, not authoritative.
 */
function describeElement(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const className = Array.from(element.classList).find((name) => name.length < 24 && !name.includes(':'));
  if (className) return `${tag}.${className}`;
  const role = element.getAttribute('role') ?? element.getAttribute('data-testid');
  return role ? `${tag}[${role}]` : tag;
}

/* ===========================================================================
   The handoff report.

   Everything the session produced, arranged the way the person receiving it
   reads: by element. What was said about it, what changed on it, and what is
   wrong with it — together, rather than in three separate lists that have to be
   cross-referenced by selector.
   =========================================================================== */

type HandoffChange = DesignChange & { token?: string };

type HandoffGroup = {
  element: HTMLElement;
  selector: string;
  label: string;
  changes: HandoffChange[];
  notes: PageComment[];
  issues: AccessibilityFinding[];
  /** The screens this element's work was decided at, narrowest first. */
  viewports: string[];
};

type HandoffReport = {
  groups: HandoffGroup[];
  css: string;
  markdown: string;
  changeCount: number;
  noteCount: number;
  issueCount: number;
};

/** "390px · iPhone 15", or just the width when it was the browser window. */
function viewportLabel(viewport: ViewportContext | undefined): string | undefined {
  if (!viewport) return undefined;
  return viewport.label === 'Browser window' ? `${viewport.width}px` : `${viewport.width}px · ${viewport.label}`;
}

/**
 * Every screen the work on one element was decided at.
 *
 * Worth stating on the group as well as the row: "this button was reviewed at 390 and at 1440" is
 * the sentence a developer needs before they read a word of the detail.
 */
function viewportsFor(group: { changes: readonly DesignChange[]; notes: readonly PageComment[] }): string[] {
  const seen = new Map<number, string>();
  for (const entry of [...group.changes, ...group.notes]) {
    const label = viewportLabel(entry.viewport);
    if (entry.viewport && label) seen.set(entry.viewport.width, label);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
}

/** Which token, if any, a value is — so the handoff can say `brand/500` instead of only `#7C3CFF`. */
function tokenNameFor(property: string, value: string, colorTokens: readonly BrandColorToken[], customTokens: readonly CustomDesignToken[]): string | undefined {
  const category: CustomDesignToken['category'] | null = /color$/.test(property) ? 'color'
    : /radius/.test(property) ? 'radius'
    : /padding|margin|gap/.test(property) ? 'spacing'
    : /font-size/.test(property) ? 'typography'
    : null;
  if (!category) return undefined;
  return matchToken(category, value, colorTokens, customTokens);
}

/**
 * One rule per selector, not one rule per edit.
 *
 * The old export emitted a fresh block for every property changed, so twenty edits on one button
 * produced twenty `button.cta { … }` rules that whoever received them had to merge by hand. Edits
 * are grouped by the selector they belong to and written once, in the order they were made.
 */
function mergedCss(groups: readonly HandoffGroup[]): string {
  return groups
    .map((group) => {
      const declarations = group.changes.filter((change) => change.kind === 'css');
      if (!declarations.length) return '';
      const body = declarations
        .map((change) => {
          // The annotation is a comment rather than a media query on purpose: the edit was applied to
          // the element at every width, and inventing a breakpoint the designer never asked for
          // would be the tool putting words in their mouth. It says where it was decided; the
          // developer decides whether that makes it conditional.
          const notes = [change.token, viewportLabel(change.viewport) && `at ${viewportLabel(change.viewport)}`].filter(Boolean).join(' · ');
          return `  ${change.property}: ${change.after}${change.forced ? ' !important' : ''};${notes ? ` /* ${notes} */` : ''}`;
        })
        .join('\n');
      return `${group.selector} {\n${body}\n}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The whole session as markdown.
 *
 * Markdown rather than plain text because of where this ends up: a ticket, a pull request, a chat
 * message. All three render it, and none of them render a wall of indented text.
 */
function handoffMarkdown(report: Omit<HandoffReport, 'markdown'>, extras: { url: string; author: string; tokenCss: string; stateCss: string }): string {
  const lines: string[] = [
    `# Design handoff`,
    '',
    `**Page:** ${extras.url}  `,
    `**Prepared:** ${new Date().toLocaleString()}${extras.author ? ` by ${extras.author}` : ''}  `,
    `**Summary:** ${report.changeCount} change${report.changeCount === 1 ? '' : 's'} · ${report.noteCount} note${report.noteCount === 1 ? '' : 's'} · ${report.issueCount} accessibility issue${report.issueCount === 1 ? '' : 's'}`,
    '',
  ];

  for (const [index, group] of report.groups.entries()) {
    lines.push(`## ${index + 1}. ${group.label}`, '', `\`${group.selector}\``, '');
    if (group.viewports.length) lines.push(`_Reviewed at ${group.viewports.join(', ')}_`, '');

    if (group.notes.length) {
      lines.push('**Notes**', '');
      for (const note of group.notes) {
        const who = note.author ? `${note.author}, ` : '';
        const at = viewportLabel(note.viewport);
        lines.push(`- ${note.resolved ? '~~' : ''}${note.text}${note.resolved ? '~~' : ''} — _${who}${relativeTime(note.createdAt)}${at ? `, at ${at}` : ''}_${note.resolved ? ' (resolved)' : ''}`);
      }
      lines.push('');
    }

    if (group.changes.length) {
      lines.push('**Changes**', '');
      for (const change of group.changes) {
        const scope = change.appliedTo && change.appliedTo > 1 ? ` · applied to ${change.appliedTo} matching elements` : '';
        const token = change.token ? ` — token \`${change.token}\`` : '';
        const at = viewportLabel(change.viewport);
        lines.push(`- \`${change.property}\`: ${change.before || '—'} → **${change.after}**${token}${at ? ` · decided at ${at}` : ''}${scope}`);
        if (change.instruction) lines.push(`  - ${change.instruction}`);
      }
      lines.push('');
    }

    if (group.issues.length) {
      lines.push('**Accessibility**', '');
      for (const issue of group.issues) {
        lines.push(`- ${issue.status === 'error' ? '❌' : '⚠️'} ${issue.label}: ${issue.detail}`);
      }
      lines.push('');
    }
  }

  const css = [extras.tokenCss, report.css, extras.stateCss].filter(Boolean).join('\n\n');
  if (css) lines.push('## CSS', '', '```css', css, '```', '');

  return lines.join('\n');
}

/**
 * Gathers the session into one document.
 *
 * Grouped by element rather than by kind: a developer picking this up wants everything about the
 * button in one place, not a list of colours followed by a list of comments they have to match up
 * by selector.
 */
function buildHandoff(
  changes: readonly DesignChange[],
  comments: readonly PageComment[],
  colorTokens: readonly BrandColorToken[],
  extras: { url: string; author: string; tokenCss: string; stateCss: string },
): HandoffReport {
  const customTokens = readCustomDesignTokens();
  const groups = new Map<HTMLElement, HandoffGroup>();

  const groupFor = (element: HTMLElement, selector: string, label: string) => {
    const existing = groups.get(element);
    if (existing) return existing;
    const created: HandoffGroup = { element, selector, label, changes: [], notes: [], issues: [], viewports: [] };
    groups.set(element, created);
    return created;
  };

  for (const change of changes) {
    const group = groupFor(change.element, change.selector, describeElement(change.element));
    group.changes.push({ ...change, token: change.kind === 'css' ? tokenNameFor(change.property, change.after, colorTokens, customTokens) : undefined });
  }

  for (const comment of comments) {
    const element = resolveComment(document, comment);
    if (!element) continue;
    const group = groupFor(element, comment.selector, comment.label);
    group.notes.push(comment);
  }

  // Accessibility is computed once per element that already earned a place in the report: a page-wide
  // audit would bury the findings that are actually about the work being handed over.
  for (const group of groups.values()) {
    if (!group.element.isConnected) continue;
    try {
      group.issues = getAccessibilityFindings(createSnapshot(group.element)).filter((finding) => finding.status !== 'pass');
    } catch {
      // An element that cannot be measured contributes no findings rather than breaking the report.
    }
  }

  for (const group of groups.values()) group.viewports = viewportsFor(group);

  const ordered = [...groups.values()];
  const partial: Omit<HandoffReport, 'markdown'> = {
    groups: ordered,
    css: mergedCss(ordered),
    changeCount: changes.length,
    noteCount: comments.length,
    issueCount: ordered.reduce((total, group) => total + group.issues.length, 0),
  };

  return { ...partial, markdown: handoffMarkdown(partial, extras) };
}

/**
 * The handoff tab.
 *
 * Deliberately not a section inside the design panel: handing work over is a different job from
 * doing it, wants the whole width, and reads top to bottom rather than per-selection. Everything
 * here is grouped by element, and every row is reversible — a change you disown should not require
 * resetting the fourteen you meant.
 */
function HandoffTab({ report, author, onSelect, onUndoChange, onToggleResolved, onDeleteNote, onAuthorChange }: {
  report: HandoffReport;
  author: string;
  onSelect: (element: HTMLElement) => void;
  onUndoChange: (change: DesignChange) => void;
  onToggleResolved: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onAuthorChange: (name: string) => void;
}) {
  const [shot, setShot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState<string | null>(null);

  const keep = async () => {
    setKeeping(true);
    setKept(null);
    try {
      const answer = await (window as CloudHost).__merakiInspectorCloud?.save({
        url: window.location.href,
        title: document.title,
        author,
        markdown: report.markdown,
        css: report.css,
        changeCount: report.changeCount,
        noteCount: report.noteCount,
        issueCount: report.issueCount,
        // Whatever is on screen goes with it: a handoff read next week is far more use with the
        // picture of what was being handed over than without it.
        screenshot: shot,
      });
      setKept(answer?.ok ? 'Saved to your account.' : (answer?.error ?? 'Could not save.'));
    } catch (error) {
      setKept((error as Error).message);
    } finally {
      setKeeping(false);
    }
  };

  const capture = async () => {
    setCapturing(true);
    try {
      const dataUrl = await (window as CaptureHost).__merakiInspectorCapture?.();
      setShot(dataUrl ?? null);
    } finally {
      setCapturing(false);
    }
  };

  if (!report.groups.length) {
    return <div className="hi-handoff-empty">
      <div><Code2 size={22} /></div>
      <h2>Nothing to hand over yet</h2>
      <p>Edit something, or leave a note on it. Everything you do collects here as a document grouped by element — changes, notes and accessibility findings together.</p>
    </div>;
  }

  const fileStem = `handoff-${window.location.hostname}-${new Date().toISOString().slice(0, 10)}`;

  return <div className="hi-handoff">
    <header className="hi-handoff-head">
      <div className="hi-handoff-summary">
        <strong>{report.changeCount}</strong><span>change{report.changeCount === 1 ? '' : 's'}</span>
        <strong>{report.noteCount}</strong><span>note{report.noteCount === 1 ? '' : 's'}</span>
        <strong className={report.issueCount ? 'is-alert' : ''}>{report.issueCount}</strong><span>a11y</span>
      </div>
      <label className="hi-comment-signature" title="Signs the document you hand over">
        <span>By</span>
        <input value={author} placeholder="your name" aria-label="Your name on this handoff" onChange={(event) => onAuthorChange(event.target.value)} />
      </label>
    </header>

    <div className="hi-handoff-exports">
      <CopyButton value={report.markdown} label="Copy as Markdown" />
      <CopyButton value={report.css} label="Copy CSS" />
      <button onClick={() => downloadFile(`${fileStem}.md`, report.markdown)}><Download size={13} />Download .md</button>
      {captureAvailable() && <button onClick={capture} disabled={capturing}><ImageIcon size={13} />{capturing ? 'Capturing…' : 'Screenshot'}</button>}
      {cloudAvailable() && <button onClick={keep} disabled={keeping}><Cloud size={13} />{keeping ? 'Saving…' : 'Save to my account'}</button>}
    </div>
    {kept && <p className="hi-handoff-kept">{kept}</p>}

    {shot && <figure className="hi-handoff-shot">
      <img src={shot} alt="The page as handed over" />
      <figcaption>
        <span>Captured {new Date().toLocaleTimeString()}</span>
        <button onClick={() => downloadFile(`${fileStem}.png`, dataUrlToBlob(shot), 'image/png')}><Download size={12} />Save PNG</button>
        <button onClick={() => setShot(null)}><X size={12} /></button>
      </figcaption>
    </figure>}

    <div className="hi-handoff-groups">
      {report.groups.map((group, index) => <section key={index} className="hi-handoff-group">
        <header>
          <span className="hi-handoff-index">{index + 1}</span>
          <button className="hi-handoff-target" onClick={() => group.element.isConnected && onSelect(group.element)} title="Select this element">
            <strong>{group.label}</strong>
            <code>{group.selector}</code>
          </button>
          {group.viewports.length > 0 && <span className="hi-handoff-screens" title={`Reviewed at ${group.viewports.join(', ')}`}>
            <Monitor size={11} />{group.viewports.join(' · ')}
          </span>}
        </header>

        {group.notes.length > 0 && <div className="hi-handoff-notes">
          {group.notes.map((note) => <article key={note.id} className={note.resolved ? 'is-resolved' : ''}>
            <p>{note.text}</p>
            <footer>
              <span>{note.author || 'Unsigned'} · {relativeTime(note.createdAt)}{viewportLabel(note.viewport) ? ` · ${viewportLabel(note.viewport)}` : ''}</span>
              <button title={note.resolved ? 'Reopen' : 'Mark resolved'} aria-pressed={Boolean(note.resolved)} onClick={() => onToggleResolved(note.id)}><Check size={12} /></button>
              <button title="Delete this note" onClick={() => onDeleteNote(note.id)}><Trash2 size={12} /></button>
            </footer>
          </article>)}
        </div>}

        {group.changes.length > 0 && <ul className="hi-handoff-changes">
          {group.changes.map((change, changeIndex) => <li key={`${change.property}-${changeIndex}`}>
            <span className="hi-handoff-property">{change.property}</span>
            <span className="hi-handoff-value"><del>{change.before || '—'}</del> {change.after}</span>
            {change.token && <em className="hi-handoff-token" title="This value is a token in the connected design system">{change.token}</em>}
            {viewportLabel(change.viewport) && <em className="hi-handoff-at" title={`Decided while looking at ${viewportLabel(change.viewport)}`}>{change.viewport!.width}px</em>}
            {change.appliedTo && change.appliedTo > 1 && <em className="hi-handoff-scope" title="This edit was applied to every matching variant">×{change.appliedTo}</em>}
            <button className="hi-handoff-undo" title="Undo just this change" onClick={() => onUndoChange(change)}><X size={12} /></button>
            {change.instruction && <p className="hi-handoff-instruction"><Wand2 size={11} />{change.instruction}</p>}
          </li>)}
        </ul>}

        {group.issues.length > 0 && <ul className="hi-handoff-issues">
          {group.issues.map((issue) => <li key={issue.id} className={issue.status}>
            <CircleAlert size={12} />
            <span><strong>{issue.label}</strong><small>{issue.detail}</small></span>
          </li>)}
        </ul>}
      </section>)}
    </div>

    {report.css && <div className="hi-code"><CopyButton value={report.css} label="Copy CSS" /><pre>{report.css}</pre></div>}
  </div>;
}

/** A captured tab arrives as a data URL; saving it as a file needs the bytes. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, encoded] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

/**
 * A list you can pick from, built rather than borrowed.
 *
 * A native `<select>` renders its list in the operating system, outside the panel's world: it cannot
 * be given the panel's type, spacing, blur or accent, it cannot show a check beside what is set, and
 * on Windows it arrives as a grey box that belongs to 1998. Every dropdown in the panel is this
 * instead — same trigger shape as the other fields, a floating card for the list, arrow keys and
 * Enter and Escape where you would expect them.
 */
function SelectField({ label, value, options, onChange, compact, title }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
  /** Narrow label column, for fields that sit two to a row. */
  compact?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBox = useMenuAnchor(open, triggerRef, Math.min(264, options.length * 31 + 16));
  const portal = usePortalTarget(triggerRef, open);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useDismissOnOutsidePress(open, [rootRef, menuRef], useCallback(() => setOpen(false), []));

  const choose = (next: string) => { onChange(next); setOpen(false); };

  return <div className={`hi-control hi-select-field ${compact ? 'hi-compact-control' : ''}`} ref={rootRef} title={title}>
    <span>{label}</span>
    <div className="hi-select" ref={triggerRef}>
      <button
        type="button"
        className={`hi-select-trigger ${open ? 'is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => setOpen((state) => !state)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setOpen(true); return; }
            setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
          }
          if (open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(options[active].value); }
          if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); }
        }}
      >
        <span>{current?.label ?? value ?? '—'}</span>
        <ChevronDown size={12} />
      </button>
      {open && menuBox && portal && createPortal(<div
        ref={menuRef}
        className="hi-select-menu"
        role="listbox"
        aria-label={label}
        style={{ top: menuBox.top, left: menuBox.left, width: menuBox.width, maxHeight: menuBox.maxHeight }}
      >
        {options.map((option, index) => <button
          type="button"
          key={option.value}
          role="option"
          aria-selected={option.value === value}
          className={`${option.value === value ? 'is-active' : ''} ${index === active ? 'is-cursor' : ''}`}
          onPointerEnter={() => setActive(index)}
          onClick={() => choose(option.value)}
        >
          <Check size={12} />
          <span>{option.label}</span>
          {option.hint && <small>{option.hint}</small>}
        </button>)}
      </div>, portal)}
    </div>
  </div>;
}

/**
 * A size you can type, drag, or pick — with no ceiling.
 *
 * This was a dropdown of fourteen sizes ending at 64px, which quietly decided that nothing on any
 * page is ever bigger than that. A hero headline is. The value is now a real field: type 120, drag
 * the label, or take one of the presets from the list, and the presets are a starting point rather
 * than the whole of what is allowed.
 */
function SizeField({ label, value, presets, unit = 'px', min = 0, onChange, compact }: {
  label: string;
  value: string;
  presets: string[];
  unit?: string;
  min?: number;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBox = useMenuAnchor(open, controlRef, Math.min(264, presets.length * 31 + 16));
  const portal = usePortalTarget(controlRef, open);
  const scrub = useScrub(value, 1, min, undefined, (next) => onChange(`${next}${unit}`));

  useDismissOnOutsidePress(open, [rootRef, menuRef], useCallback(() => setOpen(false), []));

  return <div className={`hi-control hi-size-field ${compact ? 'hi-compact-control' : ''}`} ref={rootRef}>
    <span className="hi-scrub-label" title="Drag to change · Shift ×10 · Alt ×0.1" {...scrub}>{label}</span>
    <div className="hi-size-control" ref={controlRef}>
      <div className="hi-number-field">
        <DraftNumberInput ariaLabel={`${label} ${unit}`} value={value} min={min} onCommit={(next) => onChange(`${next}${unit}`)} />
        <em>{unit}</em>
      </div>
      <button
        type="button"
        className={`hi-size-presets ${open ? 'is-open' : ''}`}
        aria-label={`${label} presets`}
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
      ><ChevronDown size={12} /></button>
      {open && menuBox && portal && createPortal(<div
        ref={menuRef}
        className="hi-select-menu hi-size-menu"
        role="listbox"
        aria-label={`${label} presets`}
        style={{ top: menuBox.top, left: menuBox.left, width: Math.max(menuBox.width, 148), maxHeight: menuBox.maxHeight }}
      >
        {presets.map((preset) => <button
          type="button"
          key={preset}
          role="option"
          aria-selected={preset === value}
          className={preset === value ? 'is-active' : ''}
          onClick={() => { onChange(preset); setOpen(false); }}
        >
          <Check size={12} />
          <span>{preset}</span>
          {/* Each preset shown at its own size: picking type from numbers alone is guesswork. */}
          <small style={{ fontSize: `min(${preset}, 19px)` }}>Ag</small>
        </button>)}
      </div>, portal)}
    </div>
  </div>;
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
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBox = useMenuAnchor(open, pickerRef, 320);
  const portal = usePortalTarget(pickerRef, open);
  const groups = useMemo(() => buildFontGroups(projectFonts), [projectFonts]);
  const current = primaryFontFamily(value) || 'Inherited';

  useDismissOnOutsidePress(open, [rootRef, menuRef], useCallback(() => setOpen(false), []));

  useEffect(() => {
    if (!open) return;
    // Only reaches the network once the user actually opens the list.
    ensureGoogleFontsLoaded();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return <div className="hi-control hi-font-field" ref={rootRef}>
    <span>{label}</span>
    <div className="hi-font-picker" ref={pickerRef}>
      <button type="button" className="hi-font-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((state) => !state)}>
        <span className="hi-font-current" style={{ fontFamily: value || undefined }}>{current}</span>
        <ChevronDown size={13} />
      </button>
      {open && menuBox && portal && createPortal(<div
        ref={menuRef}
        className="hi-font-menu"
        role="listbox"
        style={{ top: menuBox.top, left: menuBox.left, width: Math.max(menuBox.width, 232), maxHeight: menuBox.maxHeight }}
      >
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
      </div>, portal)}
    </div>
  </div>;
}

/* Colour with opacity, gradients and patterns with opacity, and blur as a filter part. */

/** 0–100 from the alpha byte of an 8-digit hex; a colour without one is opaque. */
function colorAlpha(value: string) {
  const hex = toHex(value);
  if (/^#[0-9a-f]{8}$/i.test(hex)) return Math.round((Number.parseInt(hex.slice(7, 9), 16) / 255) * 100);
  return value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value) ? 0 : 100;
}

/** The colour with its alpha set, as hex — six digits when fully opaque, eight otherwise. */
function withAlpha(value: string, alphaPercent: number) {
  const base = toColorInput(value);
  const alpha = Math.max(0, Math.min(100, Math.round(alphaPercent)));
  if (alpha >= 100) return base;
  return `${base}${Math.round((alpha / 100) * 255).toString(16).padStart(2, '0')}`;
}

const COLOR_TOKEN_RE = /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\btransparent\b)/gi;

/**
 * Sets a gradient's (or pattern's) overall opacity by scaling every colour stop, keeping the
 * shape of a fade: the most opaque stop lands on the requested value and the rest follow.
 */
function scaleGradientAlpha(image: string, alphaPercent: number) {
  const stops = image.match(COLOR_TOKEN_RE) ?? [];
  const peak = Math.max(1, ...stops.map(colorAlpha));
  return image.replace(COLOR_TOKEN_RE, (token) => {
    const current = colorAlpha(token);
    const scaled = (current / peak) * alphaPercent;
    const hex = toColorInput(token);
    return token.toLowerCase() === 'transparent' ? token : withAlpha(hex, scaled);
  });
}

/** The strongest stop in a gradient: what its opacity reads as. */
function gradientAlpha(image: string) {
  const stops = image.match(COLOR_TOKEN_RE) ?? [];
  return stops.length ? Math.max(...stops.map(colorAlpha)) : 100;
}

const IMAGE_OVERLAY_RE = /^linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\), rgba\(\1, \2, \3, \4\)\), (.*)$/;

/**
 * A picture cannot be made translucent by CSS alone, so its opacity is a veil of the fill colour
 * laid over it — which is what a faded image over that fill looks like. Reads back from the veil.
 */
function readImageOpacity(image: string) {
  const match = image.match(IMAGE_OVERLAY_RE);
  return match ? Math.round((1 - Number.parseFloat(match[4])) * 100) : 100;
}

function withImageOpacity(image: string, fill: string, alphaPercent: number) {
  const match = image.match(IMAGE_OVERLAY_RE);
  const picture = match ? match[5] : image;
  if (alphaPercent >= 100) return picture;
  const hex = toColorInput(fill);
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const veil = `rgba(${r}, ${g}, ${b}, ${Math.round((1 - alphaPercent / 100) * 100) / 100})`;
  return `linear-gradient(${veil}, ${veil}), ${picture}`;
}

/** Repeating patterns drawn with gradients; opacity applies to them like any gradient. */
const PATTERN_PRESETS = [
  { label: 'Dots', image: 'radial-gradient(circle, #00000040 1px, transparent 1.5px)', size: '12px 12px' },
  { label: 'Grid', image: 'linear-gradient(#00000026 1px, transparent 1px), linear-gradient(90deg, #00000026 1px, transparent 1px)', size: '16px 16px' },
  { label: 'Stripes', image: 'repeating-linear-gradient(45deg, #00000026 0 6px, transparent 6px 12px)', size: 'auto' },
  { label: 'Checks', image: 'linear-gradient(45deg, #00000022 25%, transparent 25% 75%, #00000022 75%), linear-gradient(45deg, #00000022 25%, transparent 25% 75%, #00000022 75%)', size: '16px 16px', position: '0 0, 8px 8px' },
];

/** The list of filter functions, from the inline style when it has one, else computed. */
function filterParts(element: HTMLElement, property: 'filter' | 'backdrop-filter'): string[] {
  const inline = element.style.getPropertyValue(property).trim();
  const source = inline || getComputedStyle(element).getPropertyValue(property);
  if (!source || source === 'none') return [];
  return source.match(/[a-zA-Z-]+\([^)]*\)/g) ?? [];
}

function readFilterPart(element: HTMLElement, property: 'filter' | 'backdrop-filter', name: string) {
  const part = filterParts(element, property).find((item) => item.startsWith(`${name}(`));
  return part ? Number.parseFloat(part.slice(name.length + 1)) || 0 : 0;
}

/** Replaces one filter function, or adds it, leaving the others as they are. */
function withFilterPart(element: HTMLElement, property: 'filter' | 'backdrop-filter', name: string, value: string | null) {
  const parts = filterParts(element, property).filter((item) => !item.startsWith(`${name}(`));
  if (value) parts.push(`${name}(${value})`);
  return parts.join(' ') || 'none';
}

/**
 * One colour: a swatch, the hex, and its opacity, with the system's palette a click away.
 * Every fill, stroke and text colour is this same control, so there is no tab to land on wrong.
 */
function ColorField({ label, value, tokens, onChange, alpha = true }: { label: string; value: string; tokens: readonly BrandColorToken[]; onChange: (value: string) => void; alpha?: boolean }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const hex = toColorInput(value);
  const opacity = colorAlpha(value);
  const matched = tokens.find((token) => toColorInput(token.value).toLowerCase() === hex.toLowerCase());
  const commitHex = (next: string) => {
    const trimmed = next.trim();
    if (!/^#?[0-9a-f]{6}$/i.test(trimmed) && !toHex(trimmed).startsWith('#')) return;
    onChange(withAlpha(trimmed.startsWith('#') ? trimmed : toHex(trimmed), opacity));
  };
  return <div className="hi-color-field">
    <div className="hi-color-field-row">
      <span className="hi-color-field-label">{label}</span>
      <label className="hi-color-field-swatch" title={matched ? `${matched.label} · ${matched.value}` : 'Pick any colour'}>
        <i style={{ background: withAlpha(hex, opacity) }} />
        <input type="color" value={hex} onChange={(event) => onChange(withAlpha(event.target.value, opacity))} aria-label={`${label} colour`} />
      </label>
      <input key={hex} className="hi-color-field-hex" defaultValue={matched ? matched.label : hex.toUpperCase()} aria-label={`${label} hex`} spellCheck={false}
        onFocus={(event) => { if (matched) event.target.value = hex.toUpperCase(); event.target.select(); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { commitHex(event.currentTarget.value); event.currentTarget.blur(); } }}
        onBlur={(event) => { if (event.target.value.trim().toUpperCase() !== hex.toUpperCase() && event.target.value.trim() !== matched?.label) commitHex(event.target.value); }} />
      {alpha && <div className="hi-number-field hi-color-field-alpha"><DraftNumberInput ariaLabel={`${label} opacity`} value={opacity} min={0} max={100} onCommit={(next) => onChange(withAlpha(hex, Number(next) || 0))} /><em>%</em></div>}
      {tokens.length > 0 && <button type="button" className={`hi-color-field-palette ${paletteOpen ? 'is-active' : ''}`} title="Design system colours" aria-label="Design system colours" aria-expanded={paletteOpen} onClick={() => setPaletteOpen((open) => !open)}><Palette size={13} /></button>}
    </div>
    {paletteOpen && tokens.length > 0 && <div className="hi-color-grid">
      {tokens.map((token) => {
        const on = toColorInput(token.value).toLowerCase() === hex.toLowerCase();
        return <button type="button" key={`${token.label}-${token.value}`} className={`hi-swatch ${on ? 'is-active' : ''}`} style={{ background: token.value }} title={`${token.label} · ${token.value}${token.usage ? ` · ${token.usage}` : ''}`} aria-label={`${token.label} ${token.value}`} aria-pressed={on} onClick={() => onChange(withAlpha(token.value, opacity))} />;
      })}
    </div>}
  </div>;
}

const FLEX_DIRECTION_ICONS: Array<{ value: string; label: string; Icon: typeof ArrowRight }> = [
  { value: 'row', label: 'Row', Icon: ArrowRight },
  { value: 'column', label: 'Column', Icon: ArrowDown },
  { value: 'row-reverse', label: 'Row reverse', Icon: ArrowLeft },
  { value: 'column-reverse', label: 'Column reverse', Icon: ArrowUp },
];

const ALIGN_ROW_ACTIONS: Array<{ id: AlignAction; label: string; Icon: typeof AlignLeft }> = [
  { id: 'left', label: 'Align left', Icon: AlignStartVertical },
  { id: 'center', label: 'Align horizontal centres', Icon: AlignCenterVertical },
  { id: 'right', label: 'Align right', Icon: AlignEndVertical },
  { id: 'top', label: 'Align top', Icon: AlignStartHorizontal },
  { id: 'middle', label: 'Align vertical centres', Icon: AlignCenterHorizontal },
  { id: 'bottom', label: 'Align bottom', Icon: AlignEndHorizontal },
];
type AlignAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Computed alignment keywords folded onto the three the grid draws. */
function normalizeAlign(value: string) {
  if (value === 'start' || value === 'normal' || value === 'stretch' || value === 'baseline' || value === 'left') return 'flex-start';
  if (value === 'end' || value === 'right') return 'flex-end';
  return value;
}

/** The nine positions of Figma's auto-layout alignment grid, as align-items × justify-content. */
const AUTO_LAYOUT_GRID = ['flex-start', 'center', 'flex-end'];

const BACKGROUND_FITS = [
  { value: 'cover', label: 'Fill' },
  { value: 'contain', label: 'Fit' },
  { value: 'auto', label: 'Actual size' },
];
const BACKGROUND_POSITIONS = [
  { value: 'center', label: 'Centre' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];
/** A handful of starting points for the builder; the colours are meant to be swapped for the system's own. */
const GRADIENT_PRESETS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.6) 100%)',
];

/** The first url() in a background-image, or nothing. */
function backgroundUrl(image: string) {
  const match = image.match(/url\((['"]?)(.*?)\1\)/);
  return match ? match[2] : '';
}

/** The computed position, folded onto the one-word option that means the same thing. */
function backgroundPositionOption(position: string) {
  const match = BACKGROUND_POSITIONS.find((item) => position === item.value || position === `${item.value} center` || position === `center ${item.value}`);
  return match?.value ?? 'center';
}

const GRADIENT_TYPES: Array<{ value: GradientType; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'conic', label: 'Angular' },
];

/**
 * The gradient builder — Figma's, on CSS.
 *
 * The presets were a menu of six looks; a gradient is a thing to make. So: a bar showing the
 * stops as handles that drag, a click on the bar to add one where the pointer is, the selected
 * stop's colour, opacity and position as fields, the type and the angle above. Everything is
 * written straight to `background-image`, so the handoff reads the same CSS the page paints.
 */
function GradientBuilder({ image, fill, tokens, onChange }: { image: string; fill: string; tokens: readonly BrandColorToken[]; onChange: (value: string) => void }) {
  const gradient = useMemo(() => parseGradient(image, resolveColor), [image]);
  const [selected, setSelected] = useState(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);

  const stops = gradient?.stops ?? [];
  const current = Math.min(selected, Math.max(0, stops.length - 1));
  const stop = stops[current];

  const commit = (next: Gradient) => onChange(serializeGradient(next));
  // The computed value comes back as rgb(), so a preset is matched by what it means, not how it is spelt.
  const presetOn = (preset: string) => { const parsed = parseGradient(preset); return Boolean(gradient && parsed && serializeGradient(parsed) === serializeGradient(gradient)); };
  const updateStop = (index: number, patch: Partial<GradientStop>) => {
    if (!gradient) return;
    commit({ ...gradient, stops: gradient.stops.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  };
  const positionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  const addStop = (clientX: number) => {
    if (!gradient) return;
    const position = positionAt(clientX);
    const sample = sampleGradient(gradient, position);
    commit({ ...gradient, stops: [...gradient.stops, { ...sample, position }] });
    setSelected(gradient.stops.length);
  };
  const removeStop = (index: number) => {
    if (!gradient || gradient.stops.length <= 2) return;
    commit({ ...gradient, stops: gradient.stops.filter((_, at) => at !== index) });
    setSelected(Math.max(0, index - 1));
  };
  const setType = (type: GradientType) => {
    if (type === gradient?.type) return;
    commit(gradient ? { ...gradient, type } : { ...defaultGradient(fill, resolveColor), type });
    setSelected(0);
  };

  return <div className="hi-gradient">
    <div className="hi-segmented hi-gradient-types" aria-label="Gradient type">
      {GRADIENT_TYPES.map((type) => <button key={type.value} type="button" className={gradient?.type === type.value ? 'is-active' : ''} aria-pressed={gradient?.type === type.value} onClick={() => setType(type.value)}>{type.label}</button>)}
    </div>
    {gradient && stop && <>
      <div
        ref={barRef}
        className="hi-gradient-bar"
        role="group"
        aria-label="Gradient stops · click to add a stop"
        onPointerDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); addStop(event.clientX); } }}
      >
        <i style={{ backgroundImage: gradientBar(gradient) }} />
        {gradient.stops.map((item, index) => <button
          key={index}
          type="button"
          className={`hi-gradient-stop ${index === current ? 'is-active' : ''}`}
          style={{ left: `${item.position}%` }}
          title={`${stopColor(item)} · ${item.position}%`}
          aria-label={`Stop ${index + 1}: ${stopColor(item)} at ${item.position}%`}
          aria-pressed={index === current}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { index, moved: false };
            setSelected(index);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.index !== index) return;
            drag.current.moved = true;
            const position = positionAt(event.clientX);
            if (position !== item.position) updateStop(index, { position });
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            const moved = drag.current?.moved;
            drag.current = null;
            // Settle a drag that crossed another stop: sorted order, same stop still selected.
            if (moved) { const sorted = sortStops(gradient); commit(sorted); setSelected(sorted.stops.indexOf(item)); }
          }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); removeStop(index); }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
              updateStop(index, { position: Math.min(100, Math.max(0, item.position + step)) });
            }
          }}
        ><i style={{ background: stopColor(item) }} /></button>)}
      </div>
      <div className="hi-gradient-stop-fields">
        <ColorField label="Stop" value={stopColor(stop)} tokens={tokens} onChange={(value) => { const hex = resolveColor(value); if (hex) updateStop(current, splitHexAlpha(hex)); }} />
        <div className="hi-gradient-stop-row">
          <NumberField label="Position" value={stop.position} min={0} max={100} suffix="%" onChange={(value) => updateStop(current, { position: Number(value) || 0 })} />
          <button type="button" className="hi-gradient-action" title="Remove stop" aria-label="Remove stop" disabled={gradient.stops.length <= 2} onClick={() => removeStop(current)}><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="hi-gradient-stop-row">
        {gradient.type !== 'radial'
          ? <NumberField label="Angle" value={gradient.angle} min={0} max={360} suffix="°" onChange={(value) => commit({ ...gradient, angle: ((Number(value) || 0) % 360 + 360) % 360 })} />
          : <span className="hi-gradient-note">Radial, from the centre</span>}
        {gradient.type !== 'radial' && <button type="button" className="hi-gradient-action" title="Rotate 45°" aria-label="Rotate gradient 45 degrees" onClick={() => commit({ ...gradient, angle: (gradient.angle + 45) % 360 })}><RotateCw size={13} /></button>}
        <button type="button" className="hi-gradient-action" title="Reverse stops" aria-label="Reverse gradient" onClick={() => commit(reverseGradient(gradient))}><FlipHorizontal2 size={13} /></button>
      </div>
    </>}
    <div className="hi-gradient-presets" aria-label="Gradient presets">
      {GRADIENT_PRESETS.map((preset) => <button key={preset} type="button" title="Start from this gradient" aria-label="Start from this gradient" className={presetOn(preset) ? 'is-active' : ''} style={{ backgroundImage: preset }} onClick={() => { onChange(preset); setSelected(0); }} />)}
    </div>
  </div>;
}

/**
 * Background image, on top of the fill colour: a picture by URL or upload, a gradient, or none —
 * with how it sits in the box. Written as ordinary CSS so it lands in the handoff like everything else.
 */
function BackgroundField({ mode, image, size, position, repeat, fill, tokens, onChange, onBatch }: { mode: 'gradient' | 'image' | 'pattern'; image: string; size: string; position: string; repeat: string; fill: string; tokens: readonly BrandColorToken[]; onChange: (property: string, value: string) => void; onBatch: (label: string, apply: () => void) => void }) {
  const url = backgroundUrl(image);
  const hasImage = image !== 'none' && image !== '';
  const opacity = !hasImage ? 100 : url ? readImageOpacity(image) : gradientAlpha(image);
  const setOpacity = (value: number) => onChange('background-image', url ? withImageOpacity(image, fill, value) : scaleGradientAlpha(image, value));
  const setUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onChange('background-image', `url("${trimmed.replace(/"/g, '%22')}")`);
  };
  const onFile = (file?: File) => {
    if (!file) return;
    if (file.type === 'image/svg+xml') file.text().then((text) => setUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`));
    else setUrl(URL.createObjectURL(file));
  };
  const opacityField = <NumberField label="Opacity" value={opacity} min={0} max={100} suffix="%" onChange={(value) => setOpacity(Number(value) || 0)} />;
  if (mode === 'image') {
    return <div className="hi-background">
      <div className="hi-background-row">
        <span className="hi-background-thumb" style={{ backgroundImage: url ? image : undefined }} aria-hidden>{!url && <ImageIcon size={14} />}</span>
        <input
          key={url}
          defaultValue={url}
          placeholder="Image URL…"
          aria-label="Background image URL"
          onKeyDown={(event) => { if (event.key === 'Enter') setUrl(event.currentTarget.value); }}
          onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== url) setUrl(event.target.value); }}
        />
        <label className="hi-background-upload" title="Upload an image or SVG"><input type="file" accept="image/*,.svg" onChange={(event) => onFile(event.target.files?.[0])} /><Upload size={13} /></label>
        {url && <button className="hi-background-clear" title="Remove image" aria-label="Remove image" onClick={() => onChange('background-image', 'none')}><X size={13} /></button>}
      </div>
      {url && <div className="hi-control-pair">
        <SelectField label="Fit" compact value={BACKGROUND_FITS.some((fit) => fit.value === size) ? size : 'auto'} options={BACKGROUND_FITS} onChange={(value) => onChange('background-size', value)} />
        <SelectField label="Align" compact value={backgroundPositionOption(position)} options={BACKGROUND_POSITIONS} onChange={(value) => onChange('background-position', value)} />
      </div>}
      {url && <div className="hi-control-pair">
        {opacityField}
        <label className="hi-control hi-control--check"><span>Repeat</span><input type="checkbox" checked={repeat !== 'no-repeat'} onChange={(event) => onChange('background-repeat', event.target.checked ? 'repeat' : 'no-repeat')} /></label>
      </div>}
      {!url && <p className="hi-empty-note">Paste an image address or upload one.</p>}
    </div>;
  }
  if (mode === 'gradient') {
    return <div className="hi-background">
      <GradientBuilder image={image} fill={fill} tokens={tokens} onChange={(value) => onChange('background-image', value)} />
      {hasImage && opacityField}
    </div>;
  }
  return <div className="hi-background">
    <div className="hi-gradient-presets hi-pattern-presets" aria-label="Pattern presets">
      {PATTERN_PRESETS.map((pattern) => <button key={pattern.label} title={`${pattern.label} pattern`} aria-label={`${pattern.label} pattern`} className={isPattern(image) && image.includes(pattern.image.includes('repeating') ? 'repeating' : pattern.image.split('(')[0]) ? 'is-current' : ''} style={{ backgroundImage: pattern.image, backgroundSize: pattern.size, backgroundPosition: pattern.position }} onClick={() => onBatch(`Apply ${pattern.label.toLowerCase()} pattern`, () => { onChange('background-image', pattern.image); onChange('background-size', pattern.size); onChange('background-position', pattern.position ?? '0 0'); })} />)}
    </div>
    {hasImage && opacityField}
  </div>;
}

type FillType = 'solid' | 'gradient' | 'image' | 'pattern' | 'none';
const FILL_TYPES: Array<{ value: FillType; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'none', label: 'None' },
];

/** Repeating gradients and layered hairline gradients are patterns, not fades. */
function isPattern(image: string) {
  return image !== 'none' && !backgroundUrl(image) && (image.includes('repeating-') || parseGradient(image, resolveColor) === null);
}

/** What kind of fill the element has, read from its background. */
function detectFillType(image: string, color: string): FillType {
  if (backgroundUrl(image)) return 'image';
  if (isPattern(image)) return 'pattern';
  if (image !== 'none' && image !== '') return 'gradient';
  return colorAlpha(color) === 0 ? 'none' : 'solid';
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
type DeviceOrientation = 'portrait' | 'landscape';

/**
 * Which device, which way round, and the frame options — one group on the canvas toolbar, so
 * choosing a screen sits next to choosing a tool instead of floating in its own bar.
 */
function DeviceControls({ presetId, orientation, freezeReveals, onPresetChange, onOrientationChange, onFreezeRevealsChange, onReload, onLivePage }: {
  presetId: DevicePresetId;
  orientation: DeviceOrientation;
  freezeReveals: boolean;
  onPresetChange: (id: DevicePresetId) => void;
  onOrientationChange: (orientation: DeviceOrientation) => void;
  onFreezeRevealsChange: (value: boolean) => void;
  onReload: () => void;
  onLivePage: () => void;
}) {
  const preset = inspectorDevicePresets.find((item) => item.id === presetId) ?? inspectorDevicePresets[1];
  const kinds: DeviceKind[] = ['mobile', 'tablet', 'desktop'];
  const modelsForKind = inspectorDevicePresets.filter((item) => item.kind === preset.kind);
  return <>
    <div className="hi-device-kinds" role="group" aria-label="Device type">
      {kinds.map((kind) => {
        const Icon = DEVICE_KIND_ICON[kind];
        return <button key={kind} title={kind[0].toUpperCase() + kind.slice(1)} aria-label={kind} className={preset.kind === kind ? 'is-active' : ''} aria-pressed={preset.kind === kind} onClick={() => onPresetChange(defaultDeviceForKind[kind])}><Icon size={15} /></button>;
      })}
    </div>
    <select className="hi-device-model" aria-label="Device model" value={preset.id} onChange={(event) => onPresetChange(event.target.value as DevicePresetId)}>
      {modelsForKind.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.width}</option>)}
    </select>
    {preset.kind !== 'desktop' && <button title="Rotate device" aria-label="Rotate device" onClick={() => onOrientationChange(orientation === 'portrait' ? 'landscape' : 'portrait')}><RotateCw size={15} /></button>}
    <details className="hi-device-menu">
      <summary title="Frame options" aria-label="Frame options"><MoreHorizontal size={16} /></summary>
      <div>
        <button onClick={onReload}><RefreshCw size={14} />Reload</button>
        <label><input type="checkbox" checked={freezeReveals} onChange={(event) => onFreezeRevealsChange(event.target.checked)} />Freeze reveals</label>
        <button onClick={onLivePage}><ExternalLink size={14} />Live page</button>
      </div>
    </details>
  </>;
}
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

/** Edge-size snapping follows the common 8px spacing scale. */
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
  fromCenter: boolean;
  moved: boolean;
  /** Geometry of the box the designer is looking at, and what its dragged edge can snap to. */
  startRect: SnapRect;
  targets: SnapTarget[];
  threshold: number;
  guides: SnapGuide[];
};

function pixels(value: number) {
  return `${Math.round(value * 10) / 10}px`;
}

function beginResize(element: HTMLElement, direction: ResizeDirection, event: PointerEvent, scale: number, mirror: HTMLElement | null, onUpdate: (() => void) | null): ResizeSession {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const marginLeft = Number.parseFloat(style.marginLeft) || 0;
  const marginTop = Number.parseFloat(style.marginTop) || 0;
  const view = mirror ?? element;
  return {
    element,
    direction,
    startRect: snapRectOf(view),
    targets: gatherSnapTargets(view),
    threshold: SNAP_THRESHOLD / Math.max(scale || 1, .01),
    guides: [],
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
    fromCenter: false,
    moved: false,
  };
}

function resizeFrame(session: ResizeSession, event: PointerEvent) {
  const dx = (event.clientX - session.startX) / session.scale;
  const dy = (event.clientY - session.startY) / session.scale;
  const horizontal = session.direction.includes('e') ? 1 : session.direction.includes('w') ? -1 : 0;
  const vertical = session.direction.includes('s') ? 1 : session.direction.includes('n') ? -1 : 0;
  const multiplier = event.altKey ? 2 : 1;
  let width = horizontal ? session.startWidth + horizontal * dx * multiplier : session.startWidth;
  let height = vertical ? session.startHeight + vertical * dy * multiplier : session.startHeight;
  // Shift on a corner keeps the proportion the element started at, the way it does in Figma.
  if (horizontal && vertical && event.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) height = width / session.ratio;
    else width = height * session.ratio;
  }
  const snapToScale = event.shiftKey && !(horizontal && vertical);
  const snap = (value: number) => Math.max(MIN_CANVAS_SIZE, snapToScale ? Math.round(value / CANVAS_SNAP_STEP) * CANVAS_SNAP_STEP : Math.round(value));
  session.width = snap(width);
  session.height = snap(height);
  session.fromCenter = event.altKey;
  // The dragged edge snaps to the siblings' edges and centres, as a moved box does. Shift and Alt
  // already mean something on a handle (ratio, from centre), so geometry snapping steps aside for them.
  session.guides = [];
  if (!event.shiftKey && !event.altKey) {
    const rect = session.startRect;
    if (horizontal) {
      const left = rect.left + (horizontal < 0 ? session.startWidth - session.width : 0);
      const edge = horizontal > 0 ? left + session.width : left;
      const result = computeSnap({ left: edge, top: rect.top, width: 0, height: rect.height }, session.targets, session.threshold, { lockY: true, gaps: false });
      if (result.dx) { session.width = Math.max(MIN_CANVAS_SIZE, session.width + horizontal * result.dx); session.guides.push(...result.guides); }
    }
    if (vertical) {
      const top = rect.top + (vertical < 0 ? session.startHeight - session.height : 0);
      const edge = vertical > 0 ? top + session.height : top;
      const result = computeSnap({ left: rect.left, top: edge, width: rect.width, height: 0 }, session.targets, session.threshold, { lockX: true, gaps: false });
      if (result.dy) { session.height = Math.max(MIN_CANVAS_SIZE, session.height + vertical * result.dy); session.guides.push(...result.guides); }
    }
  }
  // A left or top handle has to move the box as well as size it, or the opposite edge walks away
  // from the pointer and the drag feels like it is fighting back.
  session.marginLeft = event.altKey && horizontal
    ? session.startMarginLeft - (session.width - session.startWidth) / 2
    : horizontal < 0 ? session.startMarginLeft - (session.width - session.startWidth) : session.startMarginLeft;
  session.marginTop = event.altKey && vertical
    ? session.startMarginTop - (session.height - session.startHeight) / 2
    : vertical < 0 ? session.startMarginTop - (session.height - session.startHeight) : session.startMarginTop;
  session.moved = true;
}

/** Only the properties the dragged handle actually touches, so an edge drag never records a stray axis. */
function resizeDeclarations(session: ResizeSession): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (/[ew]/.test(session.direction)) entries.push(['width', pixels(session.width)]);
  if (/[ns]/.test(session.direction)) entries.push(['height', pixels(session.height)]);
  if (session.direction.includes('w') || (session.fromCenter && /[ew]/.test(session.direction))) entries.push(['margin-left', pixels(session.marginLeft)]);
  if (session.direction.includes('n') || (session.fromCenter && /[ns]/.test(session.direction))) entries.push(['margin-top', pixels(session.marginTop)]);
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

/* Drag to move — reorder inside a flex or grid parent, free move with snapping anywhere else. */

/** Pointer travel before a press turns into a drag; below this it is a click. */
const MOVE_DEAD_ZONE = 4;
/** Screen pixels within which an edge, centre or equal gap pulls the box in. */
const SNAP_THRESHOLD = 5;
/** The most siblings worth measuring for guides; past this a page is a list, not a layout. */
const MAX_SNAP_TARGETS = 40;

type MoveSession = {
  /** The element edits are recorded against. */
  element: HTMLElement;
  /** The node the designer is looking at — the frame twin when there is one. Geometry comes from here. */
  view: HTMLElement;
  mirror: HTMLElement | null;
  mode: 'reorder' | 'free';
  startX: number;
  startY: number;
  startRect: SnapRect;
  targets: SnapTarget[];
  threshold: number;
  /** Everything moving together: the primary first, then the rest of a multi-selection, each from its own start. */
  members: MoveMember[];
  /** The snapped travel since the press, shared by every member. */
  delta: [number, number];
  /** Reorder: the visible siblings, their boxes, and where the drag currently says to drop. */
  siblingPaths: string[];
  siblingRects: SnapRect[];
  flow: 'row' | 'column';
  currentIndex: number;
  insertion: InsertionPoint | null;
  guides: SnapGuide[];
  moved: boolean;
  onUpdate: (() => void) | null;
};

type MoveMember = {
  element: HTMLElement;
  mirror: HTMLElement | null;
  /** `margin-*` in flow, `left`/`top` once the element is positioned — whichever actually moves it. */
  offsetProperties: [string, string];
  startOffsets: [number, number];
  inline: Record<string, string>;
};

/** How an element is moved and where it starts from, read once at the press. */
function moveMember(element: HTMLElement, mirror: HTMLElement | null): MoveMember {
  const style = getComputedStyle(element);
  const positioned = style.position === 'absolute' || style.position === 'fixed';
  const offsetProperties: [string, string] = positioned ? ['left', 'top'] : ['margin-left', 'margin-top'];
  return {
    element,
    mirror,
    offsetProperties,
    startOffsets: [Number.parseFloat(style.getPropertyValue(offsetProperties[0])) || 0, Number.parseFloat(style.getPropertyValue(offsetProperties[1])) || 0],
    inline: Object.fromEntries(offsetProperties.map((property) => [property, element.style.getPropertyValue(property)])),
  };
}

function snapRectOf(node: Element): SnapRect {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** The boxes a drag lines up against: the visible siblings and the parent's content box. */
function gatherSnapTargets(view: HTMLElement): SnapTarget[] {
  const parent = view.parentElement;
  if (!parent) return [];
  const targets: SnapTarget[] = [];
  const style = getComputedStyle(parent);
  const rect = parent.getBoundingClientRect();
  const padding = ['Top', 'Right', 'Bottom', 'Left'].map((side) => Number.parseFloat(style[`padding${side}` as 'paddingTop']) || 0);
  targets.push({ kind: 'parent', rect: { left: rect.left + padding[3], top: rect.top + padding[0], width: rect.width - padding[1] - padding[3], height: rect.height - padding[0] - padding[2] } });
  for (const sibling of Array.from(parent.children)) {
    if (targets.length > MAX_SNAP_TARGETS) break;
    // `instanceof HTMLElement` is false for a node from the frame's realm; check the node type instead.
    if (sibling === view || !isElementNode(sibling) || !visible(sibling)) continue;
    targets.push({ kind: 'sibling', rect: snapRectOf(sibling) });
  }
  return targets;
}

function beginMove(element: HTMLElement, view: HTMLElement, event: PointerEvent, zoom: number, mirror: HTMLElement | null, members: MoveMember[], onUpdate: (() => void) | null): MoveSession {
  const parent = view.parentElement;
  const parentStyle = parent ? getComputedStyle(parent) : null;
  const style = getComputedStyle(view);
  const positioned = style.position === 'absolute' || style.position === 'fixed';
  const inFlow = parentStyle ? parentStyle.display.includes('flex') || parentStyle.display.includes('grid') : false;
  // Alt asks for a free move even inside a flex row — the way Alt-drag ignores auto layout in
  // Figma — and a multi-selection always moves freely: there is no one row to reorder within.
  const mode: MoveSession['mode'] = inFlow && !positioned && !event.altKey && members.length === 1 ? 'reorder' : 'free';
  const siblings = parent ? Array.from(parent.children).filter((node): node is HTMLElement => isElementNode(node) && visible(node)) : [];
  const flow: MoveSession['flow'] = parentStyle && (parentStyle.flexDirection.startsWith('column') || (parentStyle.display.includes('grid') && parentStyle.gridAutoFlow.startsWith('column')) || (parentStyle.display.includes('grid') && parentStyle.gridTemplateColumns.split(' ').length <= 1)) ? 'column' : 'row';
  return {
    element,
    view,
    mirror,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    startRect: snapRectOf(view),
    targets: gatherSnapTargets(view),
    threshold: SNAP_THRESHOLD / Math.max(zoom, .01),
    members,
    delta: [0, 0],
    siblingPaths: siblings.map(getUniquePath),
    siblingRects: siblings.map(snapRectOf),
    flow,
    currentIndex: siblings.indexOf(view),
    insertion: null,
    guides: [],
    moved: false,
    onUpdate,
  };
}

/** Applies the pointer to the session. Returns false while still inside the dead zone. */
function moveFrame(session: MoveSession, event: PointerEvent) {
  const dx = event.clientX - session.startX;
  const dy = event.clientY - session.startY;
  if (!session.moved && Math.hypot(dx, dy) < MOVE_DEAD_ZONE) return false;
  session.moved = true;
  if (session.mode === 'reorder') {
    session.insertion = findInsertion({ x: event.clientX, y: event.clientY }, session.siblingRects, session.flow, session.currentIndex);
    session.guides = session.insertion ? [session.insertion.guide] : [];
    return true;
  }
  const candidate = { ...session.startRect, left: session.startRect.left + dx, top: session.startRect.top + dy };
  // Shift switches snapping off for the gesture, Figma's convention.
  const snap = event.shiftKey ? { dx: 0, dy: 0, guides: [] } : computeSnap(candidate, session.targets, session.threshold);
  session.delta = [Math.round(dx + snap.dx), Math.round(dy + snap.dy)];
  session.guides = snap.guides;
  return true;
}

/** Where a member lands: its own start plus the shared travel. */
function memberOffsets(member: MoveMember, delta: [number, number]): [string, string] {
  return [pixels(member.startOffsets[0] + delta[0]), pixels(member.startOffsets[1] + delta[1])];
}

function previewMove(session: MoveSession) {
  if (session.mode !== 'free') return;
  session.members.forEach((member) => {
    const [x, y] = memberOffsets(member, session.delta);
    const nodes = new Set([member.element, member.mirror, member.element === session.element ? session.view : null]);
    nodes.forEach((node) => {
      if (!node) return;
      node.style.setProperty(member.offsetProperties[0], x);
      node.style.setProperty(member.offsetProperties[1], y);
    });
  });
  session.onUpdate?.();
}

function rollbackMove(session: MoveSession) {
  session.members.forEach((member) => {
    const nodes = new Set([member.element, member.mirror, member.element === session.element ? session.view : null]);
    nodes.forEach((node) => {
      if (!node) return;
      member.offsetProperties.forEach((property) => {
        const value = member.inline[property];
        if (value) node.style.setProperty(property, value);
        else node.style.removeProperty(property);
      });
    });
  });
}

/* Flip and rotate — composed onto whatever transform the element already carries. */

/** The transform as a list of functions, from the inline style when there is one, else the computed matrix. */
function transformParts(element: HTMLElement): string[] {
  const inline = element.style.transform.trim();
  const source = inline || getComputedStyle(element).transform;
  if (!source || source === 'none') return [];
  return source.match(/[a-zA-Z0-9]+\([^)]*\)/g) ?? [];
}

/** Adds the function when absent, removes it when present — a flip is its own inverse. */
function toggleTransformPart(element: HTMLElement, part: string) {
  const parts = transformParts(element);
  const index = parts.indexOf(part);
  if (index >= 0) parts.splice(index, 1); else parts.push(part);
  return parts.join(' ') || 'none';
}

/** Replaces the rotate() function, or adds one, leaving flips and translations alone. */
function withRotation(element: HTMLElement, degrees: number) {
  const parts = transformParts(element).filter((part) => !/^rotate(Z)?\(/.test(part));
  if (degrees % 360 !== 0) parts.push(`rotate(${degrees}deg)`);
  return parts.join(' ') || 'none';
}

/** The current angle: from rotate() when the transform is readable, else recovered from the matrix. */
function readRotation(element: HTMLElement) {
  const inline = element.style.transform;
  const rotate = inline.match(/rotate(?:Z)?\(\s*(-?[\d.]+)deg\s*\)/);
  if (rotate) return Number.parseFloat(rotate[1]);
  // An inline transform that says nothing about rotation is not rotated, whatever its matrix looks like.
  if (inline.trim() && inline.trim() !== 'none') return 0;
  const matrix = getComputedStyle(element).transform.match(/^matrix\(([^)]+)\)/);
  if (!matrix) return 0;
  const [a, b, c, d] = matrix[1].split(',').map((value) => Number.parseFloat(value));
  // A negative determinant is a mirror; its angle is not a rotation the designer set.
  if (a * d - b * c < 0) return 0;
  return Math.round(Math.atan2(b, a) * (180 / Math.PI));
}

function isFlipped(element: HTMLElement, axis: 'x' | 'y') {
  return transformParts(element).includes(axis === 'x' ? 'scaleX(-1)' : 'scaleY(-1)');
}

/* Layers — the page as a tree, the way Figma lists what is on the canvas. */

/** Tags that render nothing and would only be noise in the tree. */
const LAYER_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'HEAD', 'BR', 'WBR']);
/** Past this many rows the tree is a list of everything; nothing is gained by drawing more. */
const MAX_LAYER_ROWS = 2000;

type LayerRow = {
  path: string;
  element: HTMLElement;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  hidden: boolean;
  label: string;
  detail: string;
  kind: ElementKind;
};

function layerChildren(element: Element): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => isElementNode(child) && !LAYER_SKIP_TAGS.has(child.tagName) && !child.matches(IGNORED_SELECTOR));
}

/** What to call a row: an id, the first class, or the tag — with a snippet of text where there is some. */
function layerLabel(element: HTMLElement) {
  const tag = element.tagName.toLowerCase();
  const name = element.id ? `#${element.id}` : element.classList[0] ? `.${element.classList[0]}` : '';
  const own = Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? '').join(' ');
  const text = normalizeText(own || (element.children.length === 0 ? element.textContent ?? '' : ''));
  const attribute = element instanceof HTMLImageElement ? element.alt : element instanceof HTMLInputElement ? element.placeholder || element.value : '';
  return { label: `${tag}${name}`, detail: text ? `“${text.slice(0, 40)}${text.length > 40 ? '…' : ''}”` : attribute ? `“${attribute.slice(0, 40)}”` : '' };
}

/** Flattens the tree from `root` into the rows that are currently unfolded. */
function flattenLayers(root: Element, expanded: ReadonlySet<string>, hiddenBy: (element: HTMLElement) => boolean): LayerRow[] {
  const rows: LayerRow[] = [];
  const walk = (element: HTMLElement, depth: number) => {
    if (rows.length >= MAX_LAYER_ROWS) return;
    const children = layerChildren(element);
    const path = getUniquePath(element);
    const open = expanded.has(path);
    const { label, detail } = layerLabel(element);
    rows.push({ path, element, depth, hasChildren: children.length > 0, expanded: open, hidden: hiddenBy(element), label, detail, kind: classifyElement(element).kind });
    if (open) children.forEach((child) => walk(child, depth + 1));
  };
  layerChildren(root).forEach((child) => walk(child, 0));
  return rows;
}

const LAYER_ICONS: Record<ElementKind, typeof Type> = {
  text: Type,
  button: MousePointerClick,
  link: Link2,
  input: Square,
  image: ImageIcon,
  layout: Layers3,
  form: Component,
  generic: Square,
};

/**
 * The layers panel: a left column with the DOM from body down.
 *
 * Hover outlines the element on the canvas, click selects it, the chevron unfolds it, and the eye
 * hides or shows it as a recorded edit. The tree follows the selection — picking something on the
 * canvas unfolds its ancestors and scrolls its row into view — so the two are one selection, not two.
 */
function LayersPanel({ root, side, selectedPath, editVersion, onHover, onSelect, onToggleHidden, onClose }: {
  root: Document | null;
  /** Opposite the properties panel, so the canvas sits between the two. */
  side: 'left' | 'right';
  selectedPath: string | null;
  editVersion: number;
  onHover: (path: string | null) => void;
  onSelect: (path: string) => void;
  onToggleHidden: (path: string, hidden: boolean) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const body = root?.body ?? null;

  // A fresh document starts with its first two levels open, which is where the page's regions live.
  useEffect(() => {
    if (!body) return;
    const initial = new Set<string>();
    layerChildren(body).forEach((child) => {
      initial.add(getUniquePath(child));
      layerChildren(child).forEach((grandchild) => initial.add(getUniquePath(grandchild)));
    });
    setExpanded(initial);
  }, [body]);

  // Selecting on the canvas unfolds the way down to the selection.
  useEffect(() => {
    if (!selectedPath || !root) return;
    let node: HTMLElement | null = null;
    try { node = root.querySelector<HTMLElement>(selectedPath); } catch { node = null; }
    if (!node) return;
    setExpanded((current) => {
      const next = new Set(current);
      let ancestor = node!.parentElement;
      while (ancestor && ancestor !== root.body) { next.add(getUniquePath(ancestor)); ancestor = ancestor.parentElement; }
      return next.size === current.size ? current : next;
    });
    window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }), 40);
  }, [root, selectedPath]);

  const rows = useMemo(() => body ? flattenLayers(body, expanded, (element) => getComputedStyle(element).display === 'none') : [], [body, expanded, editVersion]);

  const toggle = (path: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  return <aside className={`hi-layers hi-layers--${side}`} aria-label="Layers" onMouseLeave={() => onHover(null)}>
    <header><Layers size={14} /><strong>Layers</strong><button title="Close layers (Ctrl+Shift+L)" aria-label="Close layers" onClick={onClose}><X size={14} /></button></header>
    <div className="hi-layers-list" ref={listRef} role="tree">
      {rows.map((row) => {
        const Icon = LAYER_ICONS[row.kind];
        return <div
          key={row.path}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={row.hasChildren ? row.expanded : undefined}
          aria-selected={row.path === selectedPath}
          className={`hi-layer ${row.path === selectedPath ? 'is-selected' : ''} ${row.hidden ? 'is-hidden' : ''}`}
          style={{ '--hi-layer-depth': row.depth } as CSSProperties}
          onMouseEnter={() => onHover(row.path)}
          onClick={() => onSelect(row.path)}
        >
          <button className="hi-layer-fold" tabIndex={-1} aria-label={row.expanded ? 'Collapse' : 'Expand'} disabled={!row.hasChildren} onClick={(event) => { event.stopPropagation(); toggle(row.path); }}>{row.hasChildren && <ChevronDown size={12} style={{ transform: row.expanded ? undefined : 'rotate(-90deg)' }} />}</button>
          <Icon size={12} />
          <span className="hi-layer-name">{row.label}{row.detail && <small>{row.detail}</small>}</span>
          <button className="hi-layer-eye" title={row.hidden ? 'Show' : 'Hide'} aria-label={row.hidden ? `Show ${row.label}` : `Hide ${row.label}`} aria-pressed={row.hidden} onClick={(event) => { event.stopPropagation(); onToggleHidden(row.path, !row.hidden); }}>{row.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
        </div>;
      })}
      {rows.length >= MAX_LAYER_ROWS && <p className="hi-layers-more">Showing the first {MAX_LAYER_ROWS} layers.</p>}
      {!rows.length && <p className="hi-layers-more">Nothing on the page yet.</p>}
    </div>
  </aside>;
}

/** Alignment and insertion lines drawn over the canvas while a drag is in progress. */
function GuideLayer({ guides, scale = 1, live = false }: { guides: readonly SnapGuide[]; scale?: number; live?: boolean }) {
  if (!guides.length) return null;
  const chromeScale = 1 / Math.max(scale, .01);
  return <div className={`hi-guides ${live ? 'is-live' : ''}`} style={{ '--hi-chrome-scale': chromeScale } as CSSProperties} aria-hidden>
    {guides.map((guide, index) => guide.axis === 'x'
      ? <span key={index} className={`hi-guide hi-guide--${guide.kind} is-x`} style={{ left: guide.at, top: guide.from, height: Math.max(0, guide.to - guide.from) }}>{guide.label && <b>{guide.label}</b>}</span>
      : <span key={index} className={`hi-guide hi-guide--${guide.kind} is-y`} style={{ top: guide.at, left: guide.from, width: Math.max(0, guide.to - guide.from) }}>{guide.label && <b>{guide.label}</b>}</span>)}
  </div>;
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
    doc.execCommand('insertText', false, text);
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
function CanvasHandles({ size, onStart, onRotateStart }: { size: string | null; onStart: (direction: ResizeDirection, event: ReactPointerEvent) => void; onRotateStart?: (event: ReactPointerEvent) => void }) {
  return <>
    {/* The rotate grips sit just outside each corner, where Figma's cursor turns into an arc. */}
    {onRotateStart && (['nw', 'ne', 'se', 'sw'] as const).map((corner) => <button
      key={`rotate-${corner}`}
      type="button"
      className={`hi-rotate-grip hi-rotate-grip--${corner}`}
      title="Drag to rotate · Shift snaps to 15°"
      aria-label="Rotate"
      onPointerDown={onRotateStart}
    />)}
    {RESIZE_HANDLES.map((handle) => <button
      key={handle.id}
      type="button"
      className={`hi-handle hi-handle--${handle.id}`}
      title={`${handle.label} · Shift keeps the ratio · Alt resizes from centre`}
      aria-label={handle.label}
      onPointerDown={(event) => onStart(handle.id, event)}
    />)}
    {size && <span className="hi-handle-size">{size}</span>}
  </>;
}

type ChromeRect = { top: number; left: number; width: number; height: number };

/** One selection treatment for the live page and the framed canvas. */
function SelectionChrome({ rect, scale = 1, handles, label, parentRect, className = '', children }: {
  rect: ChromeRect;
  scale?: number;
  handles?: ReactNode;
  label?: string | null;
  parentRect?: ChromeRect | null;
  className?: string;
  children?: ReactNode;
}) {
  const chromeScale = 1 / Math.max(scale, .01);
  const style = { top: rect.top, left: rect.left, width: rect.width, height: rect.height, '--hi-chrome-scale': chromeScale } as CSSProperties;
  return <>
    {parentRect && <span className="hi-selection-parent hi-selection-parent--canvas" style={{ top: parentRect.top, left: parentRect.left, width: parentRect.width, height: parentRect.height, '--hi-chrome-scale': chromeScale } as CSSProperties} />}
    <span className={`hi-selection-chrome ${className}`} style={style}>
      {handles}
      {label && <span className="hi-selection-size">{label}</span>}
      {children}
    </span>
  </>;
}

function DeviceOverlay({ presetId, orientation, freezeReveals, reloadKey, snapshot, dock, hidden, layers, editVersion, comments, tool, canvasEdit, canvasSize, canvasBusyRef, swallowClickRef, guides, hoverPath, onCanvasResize, onCanvasRotate, onCanvasMove, onCanvasKey, onCanvasText, onFrameDocument, onSelectPath, onReplay, onComment, onUndo, onRedo, onNotice }: {
  presetId: DevicePresetId;
  /** Frame settings live with the toolbar that changes them — see `DeviceControls`. */
  orientation: DeviceOrientation;
  freezeReveals: boolean;
  reloadKey: number;
  snapshot: ElementSnapshot | null;
  dock: 'left' | 'right';
  hidden: boolean;
  /** The layers column is open on the far side, so the stage keeps clear of it. */
  layers: boolean;
  editVersion: number;
  /** Threads to pin inside the frame — the preview is where most reviewing actually happens. */
  comments: readonly PageComment[];
  tool: 'move' | 'comment' | 'hand';
  canvasEdit: boolean;
  canvasSize: string | null;
  /** Set while a canvas drag owns the pointer, so Escape cancels the drag instead of closing the preview. */
  canvasBusyRef: { current: boolean };
  /** Set by a drag that moved something, so the click that ends it does not reselect underneath. */
  swallowClickRef: { current: boolean };
  /** Alignment and drop lines from the drag in progress, in frame coordinates. */
  guides: readonly SnapGuide[];
  /** An element the layers panel is pointing at, to outline it here as if hovered. */
  hoverPath: string | null;
  onCanvasResize: (direction: ResizeDirection, event: ReactPointerEvent, scale: number, onUpdate: () => void) => void;
  onCanvasRotate: (event: ReactPointerEvent) => void;
  /** A press inside the selection: the frame node under the pointer, the event that started it. */
  onCanvasMove: (view: HTMLElement, event: PointerEvent, scale: number, onUpdate: () => void) => void;
  /** Keys typed with the frame focused — nudge, flip, duplicate — handled by the same code as the page. */
  onCanvasKey: (event: KeyboardEvent) => boolean;
  onCanvasText: (path: string, value: string) => void;
  onFrameDocument: (doc: Document | null) => void;
  onSelectPath: (path: string) => boolean;
  onReplay: (doc: Document) => void;
  /** Selects the element a pin belongs to and puts the caret in the composer. */
  onComment: (path: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNotice: (message: string) => void;
}) {
  const preset = inspectorDevicePresets.find((item) => item.id === presetId) ?? inspectorDevicePresets[1];
  // Mirrors whatever direction the host page is actually in, so a Hebrew or Arabic site previews
  // right-to-left. The manual LTR/RTL toggle that used to sit in the toolbar is gone; following
  // the page is the behaviour that was worth keeping.
  const direction = isBrowser && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  // A reload swaps the iframe out; the old document must not be inspected while the new one boots.
  const lastReloadRef = useRef(reloadKey);
  useEffect(() => {
    if (lastReloadRef.current === reloadKey) return;
    lastReloadRef.current = reloadKey;
    setFrameDoc(null);
  }, [reloadKey]);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [hoverBox, setHoverBox] = useState<ChromeRect | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [parentBox, setParentBox] = useState<ChromeRect | null>(null);
  /** Alt-hover: distances from the selection to whatever is under the pointer. */
  const [measure, setMeasure] = useState<SnapGuide[]>([]);
  const selectionBoxRef = useRef<ChromeRect | null>(null);
  selectionBoxRef.current = selectionBox;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameDocumentRef = useRef(onFrameDocument);
  const replayRef = useRef(onReplay);
  const frameEditRef = useRef<TextEditSession | null>(null);
  const canvasTextRef = useRef(onCanvasText);
  const spaceHeldRef = useRef(false);
  const panSessionRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  frameDocumentRef.current = onFrameDocument;
  replayRef.current = onReplay;
  canvasTextRef.current = onCanvasText;

  const width = orientation === 'portrait' ? preset.width : preset.height;
  const bezel = preset.chrome === 'browser' ? 0 : preset.chrome === 'phone' ? 13 : 17;
  const chromeBar = preset.chrome === 'browser' ? 36 : 0;
  const shellWidth = width + bezel * 2;
  // A phone or tablet has a real height. A browser window does not, so when it is fitted it runs
  // the full height of the stage - the same height as the panel beside it - and shows more page.
  const widthScale = stageSize.width ? Math.min(1, stageSize.width / shellWidth) : 1;
  const fillsStage = preset.chrome === 'browser' && zoom === 'fit' && stageSize.height > 0;
  const height = fillsStage
    ? Math.max(320, Math.round(stageSize.height / widthScale) - chromeBar)
    : orientation === 'portrait' ? preset.height : preset.width;
  const shellHeight = height + bezel * 2 + chromeBar;
  const fitScale = stageSize.width && stageSize.height ? Math.min(1, stageSize.width / shellWidth, stageSize.height / shellHeight) : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;

  const previewUrl = (() => {
    const url = new URL(window.location.href);
    // The preview must load the product, not another copy of this tool. Leaving the opt-in flag
    // on booted a second inspector inside the iframe, and its capture listeners swallowed the
    // typing, clicks and navigation that review mode exists to exercise.
    [DESIGN_MODE_PARAM, 'inspect', 'design', 'system', 'responsiveSelector', 'responsiveBreakpoint'].forEach((parameter) => url.searchParams.delete(parameter));
    return url.toString();
  })();

  const measureStage = useCallback(() => {
    const node = stageRef.current;
    if (!node) return;
    // The content box: the stage's padding is the gap that lines the frame up with the panel.
    const style = getComputedStyle(node);
    setStageSize((current) => {
      const next = {
        width: node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
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

  useEffect(() => { measureStage(); }, [measureStage, presetId, orientation, dock]);

  useEffect(() => () => frameDocumentRef.current(null), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.code === 'Space' && !editing) spaceHeldRef.current = event.type === 'keydown';
      if (event.type !== 'keydown' || editing || canvasBusyRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key === '0') { event.preventDefault(); setZoom('fit'); setPan({ x: 0, y: 0 }); }
      if ((event.metaKey || event.ctrlKey) && event.key === '1') { event.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); }
      if ((event.metaKey || event.ctrlKey) && ['=', '+', '-'].includes(event.key)) {
        event.preventDefault();
        const steps = [.5, 1, 2];
        const current = zoom === 'fit' ? fitScale : zoom;
        const index = steps.reduce((closest, step, item) => Math.abs(step - current) < Math.abs(steps[closest] - current) ? item : closest, 0);
        setZoom(steps[Math.max(0, Math.min(steps.length - 1, index + (event.key === '-' ? -1 : 1)))]);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') spaceHeldRef.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); };
  }, [canvasBusyRef, fitScale, zoom]);

  /** Keep the drawn overlays and the measurement in sync with whatever the frame is currently showing. */
  const sync = useCallback(() => {
    if (!frameDoc || !snapshot) { setSelectionBox(null); setParentBox(null); return; }
    const node = resolveInDocument(frameDoc, snapshot);
    if (!node) {
      setSelectionBox(null);
      setParentBox(null);
      return;
    }
    const rect = node.getBoundingClientRect();
    setSelectionBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    const parent = node.parentElement?.getBoundingClientRect();
    setParentBox(parent ? { top: parent.top, left: parent.left, width: parent.width, height: parent.height } : null);
  }, [frameDoc, snapshot, width]);

  useEffect(() => { sync(); }, [sync, editVersion]);

  /**
   * Comment pins, resolved against the framed document.
   *
   * The same numbers as on the page, because the preview *is* the page — a reviewer reading "note 3"
   * in the panel has to find note 3 here. Positions come from the frame's own coordinates, which is
   * exactly what the selection marker beside them uses, so both stay put when the frame scrolls.
   */
  const [pins, setPins] = useState<Array<CommentThread & { top: number; left: number }>>([]);

  const syncPins = useCallback(() => {
    if (!frameDoc) { setPins([]); return; }
    const next: Array<CommentThread & { top: number; left: number }> = [];
    for (const thread of groupComments(comments)) {
      const node = resolveComment(frameDoc, thread.comments[0]);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      next.push({ ...thread, top: rect.top, left: rect.left + rect.width });
    }
    setPins(next);
  }, [comments, frameDoc]);

  useEffect(() => { syncPins(); }, [syncPins, editVersion]);

  useEffect(() => {
    const view = frameDoc?.defaultView;
    if (!view) return;
    view.addEventListener('scroll', syncPins, true);
    view.addEventListener('resize', syncPins);
    return () => {
      view.removeEventListener('scroll', syncPins, true);
      view.removeEventListener('resize', syncPins);
    };
  }, [frameDoc, syncPins]);

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
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (!editing && event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) onRedo(); else onUndo();
        return;
      }
      if (!editing && event.key === 'Escape' && !canvasBusyRef.current) {
        const selected = snapshot ? resolveInDocument(frameDoc, snapshot) : null;
        const parent = selected?.parentElement;
        if (parent && parent !== frameDoc.body && !parent.closest(IGNORED_SELECTOR)) {
          event.preventDefault();
          event.stopPropagation();
          onSelectPath(getUniquePath(parent));
        }
        return;
      }
      // Everything else — arrows, flips, duplicate — is one shortcut map shared with the live page.
      if (!editing && !canvasBusyRef.current && onCanvasKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    frameDoc.addEventListener('keydown', onKey, true);
    return () => frameDoc.removeEventListener('keydown', onKey, true);
  }, [canvasBusyRef, frameDoc, onCanvasKey, onRedo, onSelectPath, onUndo, snapshot]);

  // The layers panel points at things; the frame shows what it is pointing at.
  useEffect(() => {
    if (!frameDoc || !hoverPath) return;
    let node: HTMLElement | null = null;
    try { node = frameDoc.querySelector<HTMLElement>(hoverPath); } catch { node = null; }
    if (!node) { setHoverBox(null); return; }
    setHoverBox(snapRectOf(node));
    return () => setHoverBox(null);
  }, [frameDoc, hoverPath, editVersion]);

  /**
   * A press inside the selected element starts a drag. Nothing happens until the pointer has
   * actually travelled — a plain click still selects — so the press is handed over and the move
   * session decides. The frame's own coordinates are used throughout: the iframe reports them in
   * its layout pixels regardless of the zoom the shell is drawn at.
   */
  useEffect(() => {
    if (!frameDoc || !canvasEdit || !snapshot) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || spaceHeldRef.current) return;
      const target = frameDoc.elementFromPoint(event.clientX, event.clientY);
      if (!isElementNode(target) || target.closest(IGNORED_SELECTOR)) return;
      const editing = frameEditRef.current?.element;
      if (editing && (editing === target || editing.contains(target))) return;
      const selected = resolveInDocument(frameDoc, snapshot);
      if (!selected || (selected !== target && !selected.contains(target))) return;
      // Text would otherwise start selecting under the drag.
      event.preventDefault();
      onCanvasMove(selected, event, scale, sync);
    };
    frameDoc.addEventListener('pointerdown', onPointerDown, true);
    return () => frameDoc.removeEventListener('pointerdown', onPointerDown, true);
  }, [canvasEdit, frameDoc, onCanvasMove, scale, snapshot, sync]);

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

  useEffect(() => {
    if (!frameDoc || tool === 'hand') { setHoverBox(null); return; }
    const onMove = (event: PointerEvent) => {
      const target = frameDoc.elementFromPoint(event.clientX, event.clientY);
      if (!isElementNode(target) || target.closest(IGNORED_SELECTOR)) { setHoverBox(null); setMeasure([]); return; }
      const rect = target.getBoundingClientRect();
      setHoverBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      // Alt over another element reads the distance to it, without changing anything.
      const selection = selectionBoxRef.current;
      setMeasure(event.altKey && selection && (rect.top !== selection.top || rect.left !== selection.left) ? measureBetween(selection, snapRectOf(target)) : []);
    };
    const onLeave = () => { setHoverBox(null); setMeasure([]); };
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
      // The click that ends a drag is the drag's, not a new selection.
      if (swallowClickRef.current) { swallowClickRef.current = false; return; }
      // A selected container owns ordinary clicks inside it, so it can be dragged by any part of
      // itself. Ctrl/Cmd-click or double-click reaches the child — Figma's group convention.
      const selected = snapshot ? resolveInDocument(frameDoc, snapshot) : null;
      if (selected && selected !== target && selected.contains(target) && !event.metaKey && !event.ctrlKey) return;
      if (!onSelectPath(getUniquePath(target))) onNotice('That element only exists at this screen size.');
    };
    frameDoc.addEventListener('pointermove', onMove, true);
    frameDoc.addEventListener('pointerleave', onLeave, true);
    frameDoc.addEventListener('click', onClickCapture, true);
    return () => {
      frameDoc.removeEventListener('pointermove', onMove, true);
      frameDoc.removeEventListener('pointerleave', onLeave, true);
      frameDoc.removeEventListener('click', onClickCapture, true);
    };
  }, [frameDoc, onNotice, onSelectPath, snapshot, swallowClickRef, tool]);

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
        onNotice('Edit nested text from the Text section.');
        return;
      }
      frameEditRef.current = session;
      canvasBusyRef.current = true;
    };

    frameDoc.addEventListener('dblclick', onDoubleClick, true);
    return () => {
      frameDoc.removeEventListener('dblclick', onDoubleClick, true);
      finish(false);
    };
  }, [canvasBusyRef, canvasEdit, frameDoc, onNotice]);

  const handleLoad = () => {
    const doc = frameRef.current?.contentDocument ?? null;
    setFrameDoc(doc);
    frameDocumentRef.current(doc);
    // `load` can beat the app's first paint, so give the tree a moment before replaying edits onto it.
    if (doc) window.setTimeout(() => replayRef.current(doc), 80);
  };

  const changeZoom = (value: 'fit' | number) => { setZoom(value); if (value === 'fit') setPan({ x: 0, y: 0 }); };
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spaceHeldRef.current && tool !== 'hand') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panSessionRef.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = panSessionRef.current;
    if (!session) return;
    setPan({ x: session.originX + event.clientX - session.x, y: session.originY + event.clientY - session.y });
  };
  const stopPanning = () => { panSessionRef.current = null; };
  const onStageWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    const current = zoom === 'fit' ? fitScale : zoom;
    setZoom(Math.max(.25, Math.min(4, Number((current * (event.deltaY > 0 ? .9 : 1.1)).toFixed(2)))));
  };

  return <div className={`hi-device-overlay hi-device-overlay--${dock} ${hidden ? 'is-hidden' : ''} ${layers ? 'has-layers' : ''}`} role="dialog" aria-modal={!hidden} aria-hidden={hidden} aria-label={`${preset.label} preview`}>
    <div className={`hi-device-stage ${panSessionRef.current ? 'is-panning' : ''}`} ref={stageRef} onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove} onPointerUp={stopPanning} onPointerCancel={stopPanning} onWheel={onStageWheel}>
      <div className="hi-device-sizer" style={{ width: shellWidth * scale, height: shellHeight * scale, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <div className={`hi-device-shell hi-device-shell--${preset.chrome}`} style={{ width: shellWidth, height: shellHeight, transform: `scale(${scale})`, padding: bezel, borderRadius: preset.radius + bezel }}>
          {preset.chrome === 'browser' && <div className="hi-device-chrome" style={{ height: chromeBar }}><i /><i /><i /><span>{window.location.host}{window.location.pathname}</span></div>}
          <div className="hi-device-viewport" style={{ width, height, borderRadius: preset.radius }}>
            <iframe key={reloadKey} ref={frameRef} name={DESIGN_PREVIEW_FRAME_NAME} title={`${preset.label} live preview`} src={previewUrl} onLoad={handleLoad} style={{ width, height }} />
            {selectionBox && <SelectionChrome rect={selectionBox} parentRect={parentBox} scale={scale} className="is-selected" label={canvasSize ?? `${round(selectionBox.width)} × ${round(selectionBox.height)}`} handles={canvasEdit && snapshot ? <CanvasHandles size={null} onStart={(direction, event) => onCanvasResize(direction, event, scale, sync)} onRotateStart={onCanvasRotate} /> : null} />}
            {tool !== 'hand' && hoverBox && (!selectionBox || hoverBox.top !== selectionBox.top || hoverBox.left !== selectionBox.left) && <SelectionChrome rect={hoverBox} scale={scale} className="is-hovered" />}
            <GuideLayer guides={measure.length ? [...guides, ...measure] : guides} scale={scale} />
            {/* Counter-scaled so a pin stays legible at 50% zoom instead of shrinking with the shell. */}
            {pins.map((pin) => <button
              key={pin.path}
              className={`hi-device-pin ${pin.resolved ? 'is-resolved' : ''}`}
              style={{ top: pin.top, left: pin.left, transform: `scale(${1 / scale}) translate(-6px, -8px)` }}
              title={`Note ${pin.index}: ${pin.comments[0].text}`}
              onClick={() => onComment(pin.path)}
            >{pin.resolved ? <Check size={11} /> : <MessageSquare size={11} />}{pin.index}</button>)}
          </div>
          {preset.chrome === 'phone' && <><em className="hi-device-notch" /><em className="hi-device-home" /></>}
        </div>
      </div>
    </div>
    <label className="hi-device-zoom-pill" title="Canvas zoom">
      <select value={zoom === 'fit' ? 'fit' : String(zoom)} onChange={(event) => changeZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
        <option value="fit">Fit</option>
        {ZOOM_STEPS.map((step) => <option key={step} value={step}>{step * 100}%</option>)}
      </select>
      <ChevronDown size={12} />
    </label>
  </div>;
}

function ResponsivePanel({ presetId, snapshot, frameDocument, editVersion, onPresetChange, onReplay }: {
  presetId: DevicePresetId;
  snapshot: ElementSnapshot;
  frameDocument: Document | null;
  editVersion: number;
  onPresetChange: (id: DevicePresetId) => void;
  onReplay: (doc: Document) => void;
}) {
  const [sweeping, setSweeping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sweep, setSweep] = useState<{ points: SweepPoint[]; ranges: SweepRange[] } | null>(null);
  const sweepRef = useRef<HTMLIFrameElement>(null);
  const preset = inspectorDevicePresets.find((item) => item.id === presetId) ?? inspectorDevicePresets[1];
  const direction = isBrowser && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  const previewUrl = (() => {
    const url = new URL(window.location.href);
    [DESIGN_MODE_PARAM, 'inspect', 'design', 'system', 'responsiveSelector', 'responsiveBreakpoint'].forEach((parameter) => url.searchParams.delete(parameter));
    return url.toString();
  })();
  const metrics = useMemo(() => {
    const node = frameDocument ? resolveInDocument(frameDocument, snapshot) : null;
    return node ? measureInFrame(node, snapshot, preset.width) : null;
    // editVersion deliberately invalidates DOM measurements after live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVersion, frameDocument, preset.width, snapshot]);

  useEffect(() => { setSweep(null); }, [presetId, snapshot.uniquePath]);

  const runSweep = async () => {
    const frame = sweepRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) { setSweeping(false); return; }
    doc.documentElement.setAttribute('dir', direction);
    applyFreezeReveals(doc, true);
    const settle = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const points: SweepPoint[] = [];
    for (const [index, width] of SWEEP_WIDTHS.entries()) {
      frame.style.width = `${width}px`;
      await settle(70);
      onReplay(doc);
      resolveInDocument(doc, snapshot)?.scrollIntoView({ block: 'center' });
      await settle(90);
      const node = resolveInDocument(doc, snapshot);
      if (!node) points.push({ width, found: false, elementWidth: 0, fontSize: 0, issues: [{ id: 'hidden', text: 'Not rendered at this width.' }] });
      else {
        const measured = measureInFrame(node, snapshot, width);
        points.push({ width, found: true, elementWidth: measured.width, fontSize: measured.fontSize, issues: measured.issues });
      }
      setProgress(index + 1);
    }
    setSweep({ points, ranges: summariseSweep(points) });
    setSweeping(false);
  };

  return <div className="hi-responsive-panel">
    {metrics?.issues.length ? <ul className="hi-responsive-issues">{metrics.issues.map((issue) => <li key={issue.id}>{issue.text}</li>)}</ul> : null}
    <button className="hi-sweep-run" disabled={sweeping} onClick={() => { setSweep(null); setProgress(0); setSweeping(true); }}><Gauge size={14} />{sweeping ? `${progress}/${SWEEP_WIDTHS.length}` : 'Sweep breakpoints'}</button>
    {sweep && <div className="hi-sweep-report">
      <div className="hi-sweep-strip" role="group" aria-label="Sweep results by width">{sweep.points.map((point) => <button key={point.width} className={point.issues.length ? 'has-issues' : 'is-clear'} title={point.issues.map((issue) => issue.text).join('\n') || 'No issues'} onClick={() => onPresetChange(nearestPresetForWidth(point.width))}><em>{point.width}</em><small>{point.issues.length || '✓'}</small></button>)}</div>
      {sweep.ranges.length > 0 && <div className="hi-sweep-ranges">{sweep.ranges.map((entry) => <div key={entry.id}><CircleAlert size={14} /><span><strong>{entry.label}</strong><small>{entry.sample}</small></span><code>{entry.range}</code></div>)}</div>}
      <div className="hi-sweep-actions"><CopyButton label="Copy sweep report" value={`Breakpoint sweep · ${snapshot.selector}\n${sweep.ranges.length ? sweep.ranges.map((entry) => `- ${entry.label}: ${entry.range}`).join('\n') : '- No sampled issues'}`} /><button onClick={() => setSweep(null)}>Clear</button></div>
    </div>}
    {sweeping && <iframe ref={sweepRef} name={DESIGN_PREVIEW_FRAME_NAME} className="hi-sweep-frame" title="Breakpoint sweep" src={previewUrl} onLoad={runSweep} style={{ width: SWEEP_WIDTHS[0], height: preset.height }} />}
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
  /**
   * One section, not four.
   *
   * Size, distances, computed CSS and the DOM path all answer the same question — what is this
   * element — and split across four collapsed accordions the answer was never anywhere in
   * particular. Grouped under labelled sub-headings they read as one reference instead.
   */
  return <ToolSection title="Inspect element" icon={Component} defaultOpen={false}>
    <div className="hi-inspect-group">
      <h4>Box model</h4>
      <div className="hi-key-grid"><PropertyRow label="Size" value={`${round(snapshot.rect.width)} × ${round(snapshot.rect.height)} px`} /><PropertyRow label="Display" value={snapshot.styles.display} /><PropertyRow label="Position" value={snapshot.styles.position} /><PropertyRow label="Radius" value={snapshot.styles['border-radius']} /><PropertyRow label="Border" value={snapshot.styles.border} /><PropertyRow label="Padding" value={snapshot.styles.padding} /><PropertyRow label="Gap" value={snapshot.styles.gap} /></div><BoxModel snapshot={snapshot} />
    </div>
    <div className="hi-inspect-group">
      <h4>Distances</h4>
      <div className="hi-distance-group"><span>Parent edges</span><div>{SIDES.map((side) => <button key={side} onClick={() => navigator.clipboard.writeText(`${snapshot.parentDistances[side]}px`)}><small>{side}</small><strong>{snapshot.parentDistances[side]} px</strong></button>)}</div></div><div className="hi-distance-group"><span>Nearest siblings</span><div>{SIDES.map((side) => <button key={side} disabled={snapshot.siblingDistances[side] === undefined} onClick={() => navigator.clipboard.writeText(`${snapshot.siblingDistances[side]}px`)}><small>{side}</small><strong>{snapshot.siblingDistances[side] === undefined ? '—' : `${snapshot.siblingDistances[side]} px`}</strong></button>)}</div></div>
    </div>
    <div className="hi-inspect-group">
      <h4>Computed CSS <em>(the whole element, not just your edits)</em></h4>
      <div className="hi-code"><CopyButton value={snapshot.cssSnippet} label="Copy all CSS" /><pre dir="ltr">{snapshot.cssSnippet}</pre></div><ul className="hi-limitations"><li>Computed styles do not retain every CSS variable name.</li><li>JavaScript states appear only when reflected in DOM or attributes.</li><li>Cross-origin style rules may be inaccessible.</li><li>Complex animations are summarized, not simulated.</li></ul>
    </div>
    <div className="hi-inspect-group">
      <h4>Identity</h4>
      <PropertyRow label="Selector" value={snapshot.selector} /><PropertyRow label="DOM path" value={snapshot.domPath} /><PropertyRow label="Parent" value={snapshot.parentSelector} /><PropertyRow label="Children" value={String(snapshot.childCount)} /><div className="hi-code"><CopyButton value={technical} label="Copy JSON" /><pre dir="ltr">{technical}</pre></div>
    </div>
  </ToolSection>;
}

function HandoffInspectorPanel() {
  // Only reached when the design-mode gate is open, so a production bundle never pays for the
  // stylesheet injection.
  ensureDesignToolsStyles();

  const { tokens: designTokens, source: designTokensSource } = useDesignTokens();
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
  const [selectedElements, setSelectedElements] = useState<HTMLElement[]>([]);
  const [changes, setChanges] = useState<DesignChange[]>([]);
  const [stateResetSignal, setStateResetSignal] = useState(0);
  const [devicePreset, setDevicePreset] = useState<DevicePresetId>('iphone-15');
  const [deviceOrientation, setDeviceOrientation] = useState<DeviceOrientation>('portrait');
  const [freezeReveals, setFreezeReveals] = useState(true);
  const [deviceReloadKey, setDeviceReloadKey] = useState(0);
  const [deviceOpen, setDeviceOpen] = useState(false);
  /** The one confirmation on screen, if any. Ids let a repeat gesture restart its own timer. */
  const [toast, setToast] = useState<{ id: number; label: string } | null>(null);
  // The frame stays mounted after the first open so reopening does not reboot the app and replay every reveal.
  const [deviceMounted, setDeviceMounted] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const [restorable, setRestorable] = useState<StoredSession | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  // --- comments -------------------------------------------------------------
  const [comments, setComments] = useState<PageComment[]>(readStoredComments);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentAuthor, setCommentAuthor] = useState(readCommentAuthor);
  /** Which pin has its thread open on the page. Only ever one — two open bubbles fight for space. */
  const [openThread, setOpenThread] = useState<string | null>(null);

  /**
   * The tool does one job at a time.
   *
   * Design, comment and review want different things from the same page — one needs to swallow
   * clicks to edit, one only needs to know which element a note is about, and one needs the page
   * to behave normally so it can be navigated and resized. Running them together is what made
   * the panel long and the page unpredictable, so the mode is explicit and exclusive, and the
   * panel shows only the sections that mode can act on.
   */
  const [mode, setMode] = useState<InspectorMode>('design');
  const [canvasTool, setCanvasTool] = useState<'move' | 'comment' | 'hand'>('move');
  const commentMode = mode === 'comment' && canvasTool === 'comment';

  /**
   * Canvas editing is what design mode means, so there is no separate switch for it. The state
   * remains because leaving comment or review has to put the handles back.
   */
  const canvasEdit = mode === 'design' && canvasTool === 'move';
  /** Bumped to ask the Comments section to open and put the caret in the composer. */
  const [focusComposer, setFocusComposer] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Put the caret in the composer when the on-page Comment chip asks for it.
  useEffect(() => {
    if (!focusComposer) return;
    const id = window.setTimeout(() => composerRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [focusComposer, snapshot]);

  /** Live geometry while a handle is being dragged — the snapshot only catches up once the drag commits. */
  const [canvasRect, setCanvasRect] = useState<ElementSnapshot['rect'] | null>(null);
  const [canvasSize, setCanvasSize] = useState<string | null>(null);
  const [canvasNote, setCanvasNote] = useState<string | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const moveRef = useRef<MoveSession | null>(null);
  /** What `display` was before Hide, so Show puts back flex rather than guessing block. */
  const hiddenDisplayRef = useRef(new Map<HTMLElement, string>());
  // The frame binds its listeners once; these refs let it reach the latest handlers without rebinding.
  const canvasKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const canvasMoveRef = useRef<(view: HTMLElement, event: PointerEvent, zoom: number, onUpdate: (() => void) | null) => void>(() => undefined);
  const onCanvasKey = useCallback((event: KeyboardEvent) => canvasKeyRef.current(event), []);
  const onCanvasMove = useCallback((view: HTMLElement, event: PointerEvent, zoom: number, onUpdate: (() => void) | null) => canvasMoveRef.current(view, event, zoom, onUpdate), []);
  /** The click that ends a drag arrives after the drag; this tells the pickers to let it pass. */
  const swallowClickRef = useRef(false);
  /** Guides from the drag in progress, in the coordinates of whichever document is being dragged in. */
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  /** The element the layers panel is hovering, as a structural path so both documents can show it. */
  const [layerHoverPath, setLayerHoverPath] = useState<string | null>(null);
  /** Alt-hover distances on the live page; the frame keeps its own. */
  const [measureGuides, setMeasureGuides] = useState<SnapGuide[]>([]);
  /** Position & size: W and H move together while this is on. */
  const [ratioLocked, setRatioLocked] = useState(false);
  /** A fill type chosen in the panel before it has a value to show for itself (Image with no picture yet). */
  const [fillTypeChoice, setFillTypeChoice] = useState<FillType | null>(null);
  const [layersOpen, setLayersOpen] = useState(() => isBrowser && window.localStorage.getItem('meraki-inspector-layers') === 'open');
  const textEditRef = useRef<TextEditSession | null>(null);
  const canvasBusyRef = useRef(false);
  const stateMarkRef = useRef(1);
  const panelRef = useRef<HTMLElement>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const selectedElementsRef = useRef<HTMLElement[]>([]);
  const hoverRef = useRef<HTMLElement | null>(null);
  const originalsRef = useRef(new Map<HTMLElement, OriginalState>());
  const rafRef = useRef<number | null>(null);
  const deviceDocRef = useRef<Document | null>(null);
  const [deviceDocument, setDeviceDocument] = useState<Document | null>(null);
  const tokenVariablesRef = useRef(new Map<string, string>());
  const tokenVariableOriginalsRef = useRef(new Map<string, { value: string; priority: string } | null>());
  const changesRef = useRef<DesignChange[]>([]);
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const historyBatchRef = useRef<{ label: string; changes: DesignChange[] } | null>(null);
  const hasSavedRef = useRef(false);
  // Canvas gestures outlive the render that started them, so they read the selection through refs.
  const snapshotRef = useRef<ElementSnapshot | null>(null);
  const scopeRef = useRef<DesignScope>('free');
  changesRef.current = changes;
  selectedElementsRef.current = selectedElements;
  snapshotRef.current = snapshot;
  scopeRef.current = scope;
  const openDevice = (kind: DeviceKind) => { setDevicePreset(defaultDeviceForKind[kind]); setDeviceOpen(true); setDeviceMounted(true); };
  // The framed device is the default workspace; the live page remains available from frame options.
  const toggleInspector = () => {
    if (open) { setOpen(false); return; }
    openDevice('desktop');
    setOpen(true);
  };
  const hasSecondCollection = designTokens.collections.length > 1;
  const [secondaryCollectionActive, setSecondaryCollectionActive] = useState(false);
  /** The collection currently being edited against — the one the header names. */
  const activeCollection = designTokens.collections[secondaryCollectionActive ? 1 : 0] ?? designTokens.collections[0];
  const colorTokens = secondaryCollectionActive ? aiGuideColorTokens : brandColorTokens;
  const typePresets = secondaryCollectionActive ? aiGuideTypographyRecipes : typographyRecipes;

  /**
   * The font list is read from the page rather than hard-coded.
   *
   * This dropdown used to name the fonts of the site the inspector was extracted from, so on any
   * other project every option applied a font that did not exist there. Sampling the live page
   * means the choices are always the fonts the site actually loaded.
   */
  /**
   * Detected tokens are a good guess, not a system. Features that only make sense against a real
   * one — editing every matching component variant, binding and auditing tokens — stay locked
   * until the host actually supplies tokens, rather than pretending a heuristic palette is a
   * source of truth.
   */
  const designSystemConnected = designTokensSource === 'provided' || designTokensSource === 'detected-static';

  const accessibilityBadge = useMemo(() => {
    if (!snapshot) return undefined;
    const failing = getAccessibilityFindings(snapshot).filter((finding) => finding.status !== 'pass').length;
    return failing ? { text: `${failing} issue${failing > 1 ? 's' : ''}`, tone: 'alert' as const } : { text: 'Pass', tone: 'ok' as const };
  }, [snapshot]);

  const pageFonts = useMemo(() => {
    if (!open || typeof document === 'undefined') return [];
    // Keeps the authored stack so the fallback survives, e.g. `Georgia, serif`.
    return detectFontStacksFromPage(document.body);
  }, [open]);

  /**
   * Screen positions for the comment pins.
   *
   * Held as state rather than derived at render because they depend on scroll position and live
   * layout, neither of which React re-renders for on its own.
   */
  const [commentMarkers, setCommentMarkers] = useState<CommentMarker[]>([]);

  const syncCommentMarkers = useCallback(() => {
    if (typeof document === 'undefined') return;
    const next: CommentMarker[] = [];
    /** Threads whose element moved: their stored path is stale and worth rewriting once. */
    const healed: Array<{ path: string; to: string }> = [];

    for (const thread of groupComments(comments)) {
      const first = thread.comments[0];
      const element = resolveComment(document, first);
      if (!element) continue; // the element may not exist on this render of the page
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const current = getUniquePath(element);
      if (current !== thread.path) healed.push({ path: thread.path, to: current });
      next.push({ ...thread, top: rect.top, left: rect.left + rect.width });
    }

    setCommentMarkers(next);

    // Re-anchoring is worth persisting: a note that found its element through its description should
    // not have to do that search again on every scroll, and the healed path is what makes the panel,
    // the device preview and the exported review agree.
    if (healed.length) {
      setComments((current) => current.map((comment) => {
        const move = healed.find((entry) => entry.path === comment.path);
        return move ? { ...comment, path: move.to } : comment;
      }));
    }
  }, [comments]);

  useEffect(() => {
    // Pins are drawn whether or not the panel is open: walking up to a page and seeing that three
    // people have already said something about the header is the whole point of pinning them.
    syncCommentMarkers();
    window.addEventListener('scroll', syncCommentMarkers, true);
    window.addEventListener('resize', syncCommentMarkers);

    /**
     * Follow the page, not just the viewport.
     *
     * Scroll and resize were the only triggers, which is fine for a static page and wrong for
     * everything else: a modal opening, a route changing, a list loading — all of them move the
     * elements notes are pinned to, and the pins stayed where they were. This is also what gives
     * re-anchoring a chance to run when markup changes underneath a review.
     */
    let settle = 0;
    const observer = new MutationObserver((records) => {
      // Our own overlays mutate constantly; reacting to them would be an infinite loop.
      if (records.every((record) => record.target instanceof Element && record.target.closest(IGNORED_SELECTOR))) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(syncCommentMarkers, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      window.removeEventListener('scroll', syncCommentMarkers, true);
      window.removeEventListener('resize', syncCommentMarkers);
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [open, syncCommentMarkers]);

  /**
   * The screen the tool is currently speaking about.
   *
   * The device preview is the honest answer whenever it is open — that is the width being looked at,
   * whatever size the browser window happens to be. Otherwise it is the page itself.
   */
  const currentViewport = useCallback((): ViewportContext => {
    const preset = inspectorDevicePresets.find((item) => item.id === devicePreset);
    if (deviceOpen && preset) return { width: preset.width, height: preset.height, label: preset.label };
    return { width: window.innerWidth, height: window.innerHeight, label: 'Browser window' };
  }, [deviceOpen, devicePreset]);

  const addComment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !snapshot) return;
    setComments((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path: snapshot.uniquePath,
      selector: snapshot.selector,
      label: snapshot.family.label,
      anchor: captureAnchor(snapshot.element),
      text: trimmed,
      createdAt: new Date().toISOString(),
      author: commentAuthor.trim() || undefined,
      viewport: currentViewport(),
    }]);
    setCommentDraft('');
  }, [commentAuthor, currentViewport, snapshot]);

  const removeComment = useCallback((id: string) => {
    setComments((current) => current.filter((comment) => comment.id !== id));
  }, []);

  /**
   * Adds a note to an existing thread.
   *
   * Deliberately not routed through `addComment`, which posts against the current selection — a
   * reply typed into a pin is about that pin's element, whatever happens to be selected at the time.
   */
  const addCommentToThread = useCallback((thread: CommentThread, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const parent = thread.comments[0];
    setComments((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path: parent.path,
      selector: parent.selector,
      label: parent.label,
      anchor: parent.anchor,
      text: trimmed,
      createdAt: new Date().toISOString(),
      author: readCommentAuthor().trim() || undefined,
      viewport: currentViewport(),
    }]);
  }, [currentViewport]);

  const toggleCommentResolved = useCallback((id: string) => {
    setComments((current) => current.map((comment) => (comment.id === id ? { ...comment, resolved: !comment.resolved } : comment)));
  }, []);

  /**
   * Selects whatever a pin is attached to.
   *
   * Pins are the one part of the tool that points *into* the page from outside it, so they need a
   * way back to a selection — clicking a note should put you on the thing the note is about.
   */
  const commitSelection = useCallback((elements: HTMLElement[], primary = elements[elements.length - 1], scroll = false) => {
    const next = elements.filter((element, index) => element.isConnected && !element.closest(IGNORED_SELECTOR) && elements.indexOf(element) === index);
    const selected = primary && next.includes(primary) ? primary : next[next.length - 1] ?? null;
    selectedElementsRef.current = next;
    setSelectedElements(next);
    selectedRef.current = selected;
    hoverRef.current = selected;
    setLocked(Boolean(selected));
    setSnapshot(selected ? createSnapshot(selected) : null);
    if (scroll && selected) selected.scrollIntoView({ block: 'center' });
  }, []);

  const selectByPath = useCallback((path: string, comment?: Pick<PageComment, 'path' | 'selector' | 'anchor'>) => {
    const element = comment
      ? resolveComment(document, comment)
      : resolveInDocument(document, { uniquePath: path, selector: '' });
    if (!element) return;
    commitSelection([element], element);
  }, [commitSelection]);

  const refresh = useCallback((element = selectedRef.current || hoverRef.current) => {
    if (element && element.isConnected) setSnapshot(createSnapshot(element));
  }, []);

  useEffect(() => {
    if (!open) return;
    const findTarget = (event: PointerEvent) => document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
    const onMove = (event: PointerEvent) => {
      if (mode === 'handoff') return;
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      if (locked) return;
      const target = findTarget(event);
      if (!target || target === hoverRef.current) return;
      hoverRef.current = target;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setSnapshot(createSnapshot(target)));
    };
    const onClick = (event: MouseEvent) => {
      if (mode === 'handoff') return;
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      // Clicks inside the box being retyped place the caret; they are not a new selection.
      const editing = textEditRef.current?.element;
      if (editing && event.target instanceof Node && (editing === event.target || editing.contains(event.target))) return;
      const deepest = findTarget(event as PointerEvent);
      const eventTarget = event.target instanceof HTMLElement && !event.target.closest(IGNORED_SELECTOR) ? event.target : deepest;
      const target = event.metaKey || event.ctrlKey ? deepest : eventTarget;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      // The click that ends a drag is the drag's, not a new selection.
      if (swallowClickRef.current) { swallowClickRef.current = false; return; }
      if (event.shiftKey) {
        const current = selectedElementsRef.current;
        const next = current.includes(target)
          ? current.filter((element) => element !== target)
          // Never edit an ancestor and its descendant as one selection: text and layout mutations
          // would be applied twice to the same subtree. Multi-select is intentionally sibling-like.
          : [...current.filter((element) => !element.contains(target) && !target.contains(element)), target];
        commitSelection(next, next.includes(target) ? target : next[next.length - 1]);
        return;
      }
      // A selected container owns ordinary clicks inside it. Double-click or Cmd/Ctrl-click drills
      // into the child, mirroring Figma's group-selection convention.
      const current = selectedRef.current;
      if (locked && current && current !== target && current.contains(target) && !event.metaKey && !event.ctrlKey) return;
      commitSelection([target], target);
    };
    const onKey = (event: KeyboardEvent) => {
      if (deviceOpen) return;
      const keyTarget = event.target;
      if (keyTarget instanceof HTMLElement && (keyTarget.closest('[data-inspector-ui]') || keyTarget.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(keyTarget.tagName))) return;
      // A drag or an inline edit consumes Escape itself; unlocking underneath it would lose the element.
      if (canvasBusyRef.current) return;
      const selected = selectedRef.current;
      if (mode === 'handoff' && event.key !== 'Escape') return;
      if (event.key === 'Enter' && selected) {
        const child = Array.from(selected.children).find((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
        if (child) { event.preventDefault(); event.stopPropagation(); commitSelection([child], child); }
        return;
      }
      if (event.key === 'Tab' && selected?.parentElement) {
        const siblings = Array.from(selected.parentElement.children).filter((node): node is HTMLElement => node instanceof HTMLElement && !node.closest(IGNORED_SELECTOR));
        const index = siblings.indexOf(selected);
        if (index >= 0 && siblings.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          const offset = event.shiftKey ? -1 : 1;
          const sibling = siblings[(index + offset + siblings.length) % siblings.length];
          commitSelection([sibling], sibling);
        }
        return;
      }
      if (event.key !== 'Escape') return;
      // Escape peels one layer at a time, innermost first — an open note, then the selection, then
      // the tool. Closing the whole thing because a bubble was open is a small betrayal of the key
      // everyone reaches for.
      if (openThread) { setOpenThread(null); return; }
      if (locked && selected) {
        event.preventDefault();
        event.stopPropagation();
        const parent = selected.parentElement;
        if (parent && parent !== document.body && !parent.closest(IGNORED_SELECTOR)) commitSelection([parent], parent);
        else commitSelection([]);
      }
      else setOpen(false);
    };
    const onViewport = () => refresh();
    // A press inside the selection may become a drag; the move session waits for the pointer to travel.
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || mode !== 'design' || !locked || deviceOpen) return;
      if (event.target instanceof Element && event.target.closest(IGNORED_SELECTOR)) return;
      const selected = selectedRef.current;
      if (!selected || !(event.target instanceof Node) || (selected !== event.target && !selected.contains(event.target))) return;
      const editing = textEditRef.current?.element;
      if (editing && (editing === event.target || editing.contains(event.target))) return;
      event.preventDefault();
      canvasMoveRef.current(selected, event, 1, null);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onViewport, true);
    window.addEventListener('resize', onViewport);
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onViewport, true);
      window.removeEventListener('resize', onViewport);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [commitSelection, deviceOpen, locked, mode, open, openThread, refresh]);

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

  useEffect(() => {
    window.localStorage.setItem('meraki-inspector-layers', layersOpen ? 'open' : 'closed');
  }, [layersOpen]);

  // Alt + hover on the live page: the distance from the selection to the element under the pointer.
  useEffect(() => {
    if (!open || deviceOpen || !locked || mode === 'handoff') { setMeasureGuides([]); return; }
    let shown = false;
    const clear = () => { if (shown) { shown = false; setMeasureGuides([]); } };
    const onMove = (event: PointerEvent) => {
      const selected = selectedRef.current;
      if (!event.altKey || !selected) return clear();
      const target = document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => isElementNode(node) && !node.closest(IGNORED_SELECTOR));
      if (!target || target === selected) return clear();
      shown = true;
      setMeasureGuides(measureBetween(snapRectOf(selected), snapRectOf(target)));
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Alt') clear(); };
    document.addEventListener('pointermove', onMove, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { document.removeEventListener('pointermove', onMove, true); window.removeEventListener('keyup', onKeyUp, true); };
  }, [deviceOpen, locked, mode, open]);

  useEffect(() => { writeStoredComments(comments); }, [comments]);



  const storeOriginal = (element: HTMLElement) => {
    if (originalsRef.current.has(element)) return;
    originalsRef.current.set(element, captureOriginalState(element));
  };

  /** Component scope only widens an edit when the element being edited *is* the current selection. */
  const targetsFor = (element: HTMLElement) => {
    const current = snapshotRef.current;
    if (current && current.element === element && scopeRef.current === 'component') return current.family.elements;
    if (current && current.element === element && scopeRef.current === 'free' && selectedElementsRef.current.length > 1) return selectedElementsRef.current;
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
        // An element that already lives in the frame is the thing being edited, not a copy of it;
        // mirroring onto itself would apply every edit twice.
        if (element.ownerDocument === doc) return;
        const node = doc.querySelector<HTMLElement>(getUniquePath(element));
        if (node) run(node, element);
      });
    }
    setEditVersion((current) => current + 1);
  }, []);

  const restoreInDevice = (node: HTMLElement, source: HTMLElement) => {
    Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
    Array.from(source.attributes).forEach((attribute) => node.setAttribute(attribute.name, attribute.value));
    node.innerHTML = source.innerHTML;
    if (isFieldNode(node) && isFieldNode(source)) node.value = source.value;
  };

  /** Re-apply every live edit after the device frame reloads or the device changes. */
  const replayIntoDevice = useCallback((doc: Document) => {
    tokenVariablesRef.current.forEach((value, name) => doc.documentElement.style.setProperty(name, value));
    changesRef.current.forEach((change) => {
      if (!change.element.isConnected) return;
      const node = doc.querySelector<HTMLElement>(getUniquePath(change.element));
      if (!node) return;
      if (change.kind === 'css') node.style.setProperty(change.property, change.after, change.forced ? 'important' : '');
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
    setDeviceDocument(doc);
    setEditVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const key = sessionKey();
    const storable = changes.filter((change) => REPLAYABLE_KINDS.includes(change.kind) && change.element.isConnected);
    // Only clear once this session has actually written something. Mount runs with an empty log —
    // and StrictMode runs them twice — so clearing unconditionally would delete the saved session
    // before the restore prompt ever sees it.
    if (!storable.length) {
      if (hasSavedRef.current) {
        window.localStorage.removeItem(key);
        hasSavedRef.current = false;
        announceSession(null);
      }
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
        forced: change.forced,
        inlineBefore: change.inlineBefore,
        priorityBefore: change.priorityBefore,
        hadAttributeBefore: change.hadAttributeBefore,
        tokenVariableBefore: change.tokenVariableBefore,
      })),
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
      hasSavedRef.current = true;
    } catch { /* Storage is full or blocked. */ }
    announceSession(payload);
  }, [changes]);

  useEffect(() => {
    if (!open || changesRef.current.length) return;
    setRestorable(readStoredSession());
  }, [open]);

  const restoreSession = (session: StoredSession) => {
    session.changes.forEach((entry) => {
      if (entry.kind === 'token' && entry.cssVariable && !tokenVariableOriginalsRef.current.has(entry.cssVariable.name)) {
        tokenVariableOriginalsRef.current.set(entry.cssVariable.name, entry.tokenVariableBefore ?? null);
      }
    });
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
      const inlineBefore = entry.kind === 'css' ? element.style.getPropertyValue(entry.property) : entry.inlineBefore;
      const priorityBefore = entry.kind === 'css' ? element.style.getPropertyPriority(entry.property) : entry.priorityBefore;
      const hadAttributeBefore = entry.kind === 'attribute' ? element.hasAttribute(entry.property.replace(/^@/, '')) : entry.hadAttributeBefore;
      if (entry.kind === 'css') setPropertyVisibly(element, entry.property, entry.after);
      if (entry.kind === 'content') { if (isFieldNode(element)) element.value = entry.after; else element.textContent = entry.after; }
      if (entry.kind === 'attribute') element.setAttribute(entry.property.replace(/^@/, ''), entry.after);
      restored.push({
        element, selector: entry.selector, property: entry.property, before: entry.before, after: entry.after,
        kind: entry.kind, instruction: entry.instruction, cssVariable: entry.cssVariable,
        forced: entry.forced, inlineBefore, priorityBefore, hadAttributeBefore,
        tokenVariableBefore: entry.tokenVariableBefore,
      });
    });
    changesRef.current = restored;
    setChanges(restored);
    undoStackRef.current = restored.length ? [{ label: 'restored session', changes: restored }] : [];
    redoStackRef.current = [];
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
    commitSelection([element], element, true);
  }, [commitSelection]);

  /**
   * Selects what was clicked inside the device preview.
   *
   * The path is looked up in the live page first, because editing there is what the designer sees
   * behind the preview and what the exported CSS describes. When it does not resolve — which is the
   * normal case on any real site, where a feed, an experiment or a personalised block means the
   * framed copy is simply not the same tree — the element inside the frame is selected instead and
   * edited in place. Refusing to edit at all, which is what happened before, made the preview
   * useless on exactly the sites it was most needed for.
   */
  const selectFromDevice = useCallback((path: string) => {
    let element: HTMLElement | null = null;
    try { element = document.querySelector<HTMLElement>(path); } catch { element = null; }
    if (!element || element.closest(IGNORED_SELECTOR)) {
      const doc = deviceDocRef.current;
      try { element = doc?.querySelector<HTMLElement>(path) ?? null; } catch { element = null; }
    }
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

  const recordChanges = (incoming: DesignChange[], label = incoming[0]?.property ?? 'Edit') => {
    if (!incoming.length) return;
    const next = mergeChangeLog(changesRef.current, incoming);
    changesRef.current = next;
    setChanges(next);
    if (historyBatchRef.current) historyBatchRef.current.changes.push(...incoming);
    else undoStackRef.current.push({ label, changes: incoming });
    redoStackRef.current = [];
  };

  const recordChange = (change: DesignChange, label?: string) => recordChanges([change], label);

  const beginHistoryBatch = (label: string) => { historyBatchRef.current = { label, changes: [] }; };
  const finishHistoryBatch = () => {
    const batch = historyBatchRef.current;
    historyBatchRef.current = null;
    if (batch?.changes.length) undoStackRef.current.push(batch);
  };

  const applyStyleTo = (targets: HTMLElement[], property: string, rawValue: string) => {
    const value = normalizeCssValue(property, rawValue);
    const applied: DesignChange[] = [];
    targets.forEach((element) => {
      storeOriginal(element);
      const before = getComputedStyle(element).getPropertyValue(property);
      const inlineBefore = element.style.getPropertyValue(property);
      const priorityBefore = element.style.getPropertyPriority(property);
      const forced = setPropertyVisibly(element, property, value);
      applied.push({
        element,
        selector: getSelector(element),
        property,
        before,
        after: value,
        kind: 'css',
        forced,
        inlineBefore,
        priorityBefore,
        appliedTo: targets.length,
        viewport: currentViewport(),
      });
    });
    recordChanges(applied, `Set ${property}`);
    mirrorToDevice(targets, (node) => setPropertyVisibly(node, property, value));
    window.setTimeout(() => refresh(snapshotRef.current?.element), 0);
  };

  const applyStyle = (property: string, rawValue: string) => applyStyleTo(currentTargets(), property, rawValue);

  const applyHistoryChange = (change: DesignChange, direction: 'undo' | 'redo') => {
    const element = change.element;
    if (change.property === 'layout:duplicate' && isElementNode(change.domAfter?.parent)) {
      // A duplicate's "before" is absence: undo takes the copy off the page, redo re-inserts it.
      const parent = change.domAfter.parent;
      if (direction === 'undo') element.remove();
      else parent.insertBefore(element, change.domAfter.nextSibling?.isConnected ? change.domAfter.nextSibling : null);
      mirrorToDevice([parent], restoreInDevice);
      return;
    }
    if (!element.isConnected && change.kind !== 'token') return;
    if (change.domBefore && change.domAfter) {
      restoreCapturedState(direction === 'undo' ? change.domBefore : change.domAfter);
      // Reordering changes the element's structural path. Mirroring the parent keeps the framed DOM
      // in the same order; scalar asset replacements can still resolve and copy the element itself.
      const mirrorTarget = change.kind === 'layout' ? element.parentElement : element;
      if (mirrorTarget) mirrorToDevice([mirrorTarget], restoreInDevice);
      return;
    }
    if (direction === 'undo') {
      if (change.kind === 'css') {
        if (change.inlineBefore) element.style.setProperty(change.property, change.inlineBefore, change.priorityBefore || '');
        else element.style.removeProperty(change.property);
        mirrorToDevice([element], (node) => {
          if (change.inlineBefore) node.style.setProperty(change.property, change.inlineBefore, change.priorityBefore || '');
          else node.style.removeProperty(change.property);
        });
      } else if (change.kind === 'content') {
        if (isFieldNode(element)) element.value = change.before;
        else element.textContent = change.before;
        mirrorToDevice([element], (node) => { if (isFieldNode(node)) node.value = change.before; else node.textContent = change.before; });
      } else if (change.kind === 'attribute') {
        const property = change.property.replace(/^@/, '');
        if (change.hadAttributeBefore === false) element.removeAttribute(property);
        else element.setAttribute(property, change.before);
        mirrorToDevice([element], (node) => {
          if (change.hadAttributeBefore === false) node.removeAttribute(property);
          else node.setAttribute(property, change.before);
        });
      }
    } else if (change.kind === 'css') {
      element.style.setProperty(change.property, change.after, change.forced ? 'important' : '');
      mirrorToDevice([element], (node) => node.style.setProperty(change.property, change.after, change.forced ? 'important' : ''));
    } else if (change.kind === 'content') {
      if (isFieldNode(element)) element.value = change.after;
      else element.textContent = change.after;
      mirrorToDevice([element], (node) => { if (isFieldNode(node)) node.value = change.after; else node.textContent = change.after; });
    } else if (change.kind === 'attribute') {
      const property = change.property.replace(/^@/, '');
      element.setAttribute(property, change.after);
      mirrorToDevice([element], (node) => node.setAttribute(property, change.after));
    } else if (change.kind === 'state' && change.stateMark) {
      element.setAttribute(STATE_MARK_ATTRIBUTE, change.stateMark);
      mirrorToDevice([element], (node) => node.setAttribute(STATE_MARK_ATTRIBUTE, change.stateMark!));
    }
    if (change.kind === 'token' && change.cssVariable) {
      const root = document.documentElement;
      const frameRoot = deviceDocRef.current?.documentElement;
      if (direction === 'undo') {
        if (change.tokenVariableBefore) {
          root.style.setProperty(change.cssVariable.name, change.tokenVariableBefore.value, change.tokenVariableBefore.priority);
          frameRoot?.style.setProperty(change.cssVariable.name, change.tokenVariableBefore.value, change.tokenVariableBefore.priority);
          tokenVariablesRef.current.set(change.cssVariable.name, change.tokenVariableBefore.value);
        } else {
          root.style.removeProperty(change.cssVariable.name);
          frameRoot?.style.removeProperty(change.cssVariable.name);
          tokenVariablesRef.current.delete(change.cssVariable.name);
        }
      } else {
        root.style.setProperty(change.cssVariable.name, change.cssVariable.value);
        frameRoot?.style.setProperty(change.cssVariable.name, change.cssVariable.value);
        tokenVariablesRef.current.set(change.cssVariable.name, change.cssVariable.value);
      }
    }
  };

  const syncInactiveStateMarks = (active: readonly DesignChange[]) => {
    originalsRef.current.forEach((original, element) => {
      const elementChanges = active.filter((change) => change.element === element);
      if (!elementChanges.some((change) => change.kind === 'state')) {
        const originalMark = original.attributes.find(([name]) => name === STATE_MARK_ATTRIBUTE)?.[1];
        if (element.hasAttribute(STATE_MARK_ATTRIBUTE) || originalMark !== undefined) {
          if (originalMark === undefined) element.removeAttribute(STATE_MARK_ATTRIBUTE);
          else element.setAttribute(STATE_MARK_ATTRIBUTE, originalMark);
          mirrorToDevice([element], (node) => {
            if (originalMark === undefined) node.removeAttribute(STATE_MARK_ATTRIBUTE);
            else node.setAttribute(STATE_MARK_ATTRIBUTE, originalMark);
          });
        }
      }
    });
  };

  const syncActiveTokenVariables = (active: readonly DesignChange[]) => {
    const activeVariables = new Map<string, string>();
    active.forEach((change) => {
      if (change.kind === 'token' && change.cssVariable) activeVariables.set(change.cssVariable.name, change.cssVariable.value);
    });
    tokenVariablesRef.current.clear();
    activeVariables.forEach((value, name) => tokenVariablesRef.current.set(name, value));
  };

  const syncHistoryLog = () => {
    const next = historyChangeLog(undoStackRef.current);
    syncInactiveStateMarks(next);
    syncActiveTokenVariables(next);
    changesRef.current = next;
    setChanges(next);
    window.setTimeout(syncStateRules, 0);
    window.setTimeout(() => refresh(snapshotRef.current?.element), 0);
  };

  const undoHistory = () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    [...entry.changes].reverse().forEach((change) => applyHistoryChange(change, 'undo'));
    redoStackRef.current.push(entry);
    syncHistoryLog();
    setToast({ id: Date.now(), label: `Undid ${entry.label}` });
  };

  const redoHistory = () => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    entry.changes.forEach((change) => applyHistoryChange(change, 'redo'));
    undoStackRef.current.push(entry);
    syncHistoryLog();
    setToast({ id: Date.now(), label: `Redid ${entry.label}` });
  };

  /** Takes back every historical edit to this property without disturbing unrelated work. */
  const undoChange = (change: DesignChange) => {
    applyHistoryChange(change, 'undo');
    undoStackRef.current = undoStackRef.current
      .map((entry) => ({ ...entry, changes: entry.changes.filter((item) => !(item.element === change.element && item.property === change.property)) }))
      .filter((entry) => entry.changes.length);
    redoStackRef.current = [];
    const next = changesRef.current.filter((entry) => !(entry.element === change.element && entry.property === change.property));
    syncInactiveStateMarks(next);
    syncActiveTokenVariables(next);
    if (change.kind === 'token' && change.cssVariable && !next.some((entry) => entry.kind === 'token' && entry.cssVariable?.name === change.cssVariable!.name)) {
      tokenVariableOriginalsRef.current.delete(change.cssVariable.name);
    }
    changesRef.current = next;
    setChanges(next);
    window.setTimeout(syncStateRules, 0);
    setToast({ id: Date.now(), label: `${change.property} put back` });
    window.setTimeout(() => refresh(snapshotRef.current?.element), 0);
  };

  const applyTokenBinding = (payload: { property: string; label: string; from: string; tokenName: string; tokenValue: string; variable: string; created: boolean }) => {
    if (!snapshot) return;
    beginHistoryBatch(`Bind ${payload.tokenName}`);
    const previousVariable = document.documentElement.style.getPropertyValue(payload.variable);
    const tokenVariableBefore = previousVariable
      ? { value: previousVariable, priority: document.documentElement.style.getPropertyPriority(payload.variable) }
      : null;
    if (!tokenVariableOriginalsRef.current.has(payload.variable)) tokenVariableOriginalsRef.current.set(payload.variable, tokenVariableBefore);
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
      tokenVariableBefore,
    });
    finishHistoryBatch();
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
    const applied: DesignChange[] = [];
    targets.forEach((element) => {
      storeOriginal(element);
      if (!element.getAttribute(STATE_MARK_ATTRIBUTE)) element.setAttribute(STATE_MARK_ATTRIBUTE, `s${stateMarkRef.current++}`);
      applied.push({ element, selector: getSelector(element), property: `state:${state}:${cssProperty}`, before, after: cssValue, kind: 'state', stateMark: element.getAttribute(STATE_MARK_ATTRIBUTE) ?? undefined });
    });
    recordChanges(applied, `Set ${state} ${cssProperty}`);
    // The mark has to reach the device frame too, or the rule there matches nothing.
    mirrorToDevice(targets, (node, source) => {
      const mark = source.getAttribute(STATE_MARK_ATTRIBUTE);
      if (mark) node.setAttribute(STATE_MARK_ATTRIBUTE, mark);
    });
    // recordChange is async through state; rebuild once React has the new entry.
    window.setTimeout(syncStateRules, 0);
  };

  const applyTextTo = (targets: HTMLElement[], value: string) => {
    const applied: DesignChange[] = [];
    targets.forEach((element) => {
      storeOriginal(element);
      const before = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? '';
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = value;
      else element.textContent = value;
      applied.push({ element, selector: getSelector(element), property: 'textContent', before, after: value, kind: 'content' });
    });
    recordChanges(applied, 'Edit text');
    mirrorToDevice(targets, (node) => {
      if (isFieldNode(node)) node.value = value;
      else node.textContent = value;
    });
    refresh(snapshotRef.current?.element ?? targets[0]);
  };

  const applyText = (value: string) => applyTextTo(currentTargets(), value);

  const applyAttribute = (property: string, value: string) => {
    const targets = currentTargets();
    const applied: DesignChange[] = [];
    targets.forEach((element) => {
      storeOriginal(element);
      const hadAttributeBefore = element.hasAttribute(property);
      const before = element.getAttribute(property) ?? '';
      element.setAttribute(property, value);
      applied.push({ element, selector: getSelector(element), property: `@${property}`, before, after: value, kind: 'attribute', hadAttributeBefore });
    });
    recordChanges(applied, `Set ${property}`);
    mirrorToDevice(targets, (node) => node.setAttribute(property, value));
    refresh(snapshot?.element);
  };

  /** Lock onto an element without scrolling — the pointer is already on it. */
  const lockTo = (element: HTMLElement) => {
    commitSelection([element], element);
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
    if (!commit || next === session.original) { refresh(session.element); return; }
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
      setGuides(active.guides);
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
      setGuides([]);
      if (!active) return;
      rollbackResize(active);
      if (!commit || !active.moved) {
        active.onUpdate?.();
        setCanvasRect(null);
        return;
      }
      const targets = targetsFor(active.element);
      beginHistoryBatch('Resize selection');
      // Width and height do not bite on an inline box, so make the switch explicit and log it.
      if (getComputedStyle(active.element).display === 'inline') applyStyleTo(targets, 'display', 'inline-block');
      resizeDeclarations(active).forEach(([property, value]) => applyStyleTo(targets, property, value));
      finishHistoryBatch();
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

  /**
   * Rotation by hand: the angle from the box's centre to the pointer, relative to where the press
   * began, added to whatever rotation the element already had. The centre is read from the selection
   * chrome in this document, so it is right at any zoom and in the frame alike.
   */
  const startRotate = (element: HTMLElement, event: ReactPointerEvent) => {
    if (moveRef.current || resizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    finishTextEdit(true);
    const chrome = (event.currentTarget as HTMLElement).parentElement;
    if (!chrome) return;
    const box = chrome.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const angleTo = (x: number, y: number) => Math.atan2(y - centre.y, x - centre.x) * (180 / Math.PI);
    const startAngle = angleTo(event.clientX, event.clientY);
    const startRotation = readRotation(element);
    const inline = element.style.transform;
    const mirror = deviceDocRef.current?.querySelector<HTMLElement>(getUniquePath(element)) ?? null;
    let rotation = startRotation;
    let moved = false;
    canvasBusyRef.current = true;
    const handle = event.currentTarget as HTMLElement;
    try { handle.setPointerCapture(event.pointerId); } catch { /* The pointer went away before capture. */ }
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      moved = true;
      let next = startRotation + angleTo(moveEvent.clientX, moveEvent.clientY) - startAngle;
      if (moveEvent.shiftKey) next = Math.round(next / 15) * 15;
      next = Math.round(((next % 360) + 540) % 360 - 180);
      rotation = next;
      const value = withRotation(element, next);
      [element, mirror].forEach((node) => node?.style.setProperty('transform', value));
      setCanvasSize(`${next}°`);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      canvasBusyRef.current = false;
      setCanvasSize(null);
      [element, mirror].forEach((node) => { if (!node) return; if (inline) node.style.setProperty('transform', inline); else node.style.removeProperty('transform'); });
      if (!commit || !moved || rotation === startRotation) { setEditVersion((current) => current + 1); return; }
      swallowClickRef.current = true;
      window.setTimeout(() => { swallowClickRef.current = false; }, 250);
      applyStyleTo(targetsFor(element), 'transform', withRotation(element, rotation));
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  };

  /**
   * A press inside the selection. `view` is the node under the pointer's document — the frame twin
   * when the canvas is the frame — and the edit is recorded against the element in this document
   * that it stands for. Listeners go on the window the press came from, so the iframe's own
   * coordinates are used from start to finish.
   */
  const startMove = (view: HTMLElement, event: PointerEvent, zoom: number, onUpdate: (() => void) | null) => {
    if (moveRef.current || resizeRef.current) return;
    finishTextEdit(true);
    const path = getUniquePath(view);
    let element: HTMLElement | null = null;
    if (view.ownerDocument === document) element = view;
    else { try { element = document.querySelector<HTMLElement>(path); } catch { element = null; } }
    if (!element || element.closest(IGNORED_SELECTOR)) element = view;
    const mirror = view === element ? (deviceDocRef.current?.querySelector<HTMLElement>(path) ?? null) : view;
    // The rest of a multi-selection travels with the primary, each from its own margins.
    const twinOf = (node: HTMLElement) => {
      if (node === element) return mirror === element ? null : mirror;
      try { return deviceDocRef.current?.querySelector<HTMLElement>(getUniquePath(node)) ?? null; } catch { return null; }
    };
    const members = [element, ...targetsFor(element).filter((node) => node !== element)].map((node) => moveMember(node, twinOf(node)));
    const session = beginMove(element, view, event, zoom, mirror === element ? null : mirror, members, onUpdate);
    if (session.mode === 'reorder' && session.siblingRects.length < 2) session.mode = 'free';
    moveRef.current = session;
    const win = view.ownerDocument.defaultView ?? window;
    const captureTarget = event.target instanceof Element ? event.target : view;
    try { captureTarget.setPointerCapture(event.pointerId); } catch { /* Capture is a nicety; the window listeners still run. */ }

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const active = moveRef.current;
      if (!active) return;
      if (!moveFrame(active, moveEvent)) return;
      if (!canvasBusyRef.current) { canvasBusyRef.current = true; setCanvasNote(null); }
      moveEvent.preventDefault();
      previewMove(active);
      setGuides(active.guides);
      if (active.mode === 'free') {
        const rect = active.element.getBoundingClientRect();
        setCanvasRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height });
      }
    };

    const finish = (commit: boolean) => {
      const active = moveRef.current;
      win.removeEventListener('pointermove', onMove, true);
      win.removeEventListener('pointerup', onUp, true);
      win.removeEventListener('pointercancel', onCancel, true);
      win.removeEventListener('keydown', onKey, true);
      if (win !== window) window.removeEventListener('pointerup', onUp, true);
      moveRef.current = null;
      canvasBusyRef.current = false;
      setGuides([]);
      if (!active) return;
      try { captureTarget.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
      rollbackMove(active);
      if (!active.moved) return;
      // The click that follows this pointerup is the drag's. If none follows — the pointer was let
      // go outside the frame — the flag must not lie in wait for the next real click.
      swallowClickRef.current = true;
      window.setTimeout(() => { swallowClickRef.current = false; }, 250);
      setCanvasRect(null);
      if (!commit) { active.onUpdate?.(); return; }
      if (active.mode === 'free') {
        beginHistoryBatch('Move selection');
        active.members.forEach((member) => {
          const [x, y] = memberOffsets(member, active.delta);
          applyStyleTo([member.element], member.offsetProperties[0], x);
          applyStyleTo([member.element], member.offsetProperties[1], y);
        });
        finishHistoryBatch();
        return;
      }
      const insertion = active.insertion;
      const parent = active.element.parentElement;
      if (!insertion || !parent || insertion.index === active.currentIndex) { active.onUpdate?.(); return; }
      // Siblings are addressed by structural path so the drop lands on the same node in this
      // document as the one the pointer was over in the frame.
      const doc = active.element.ownerDocument;
      const remaining = active.siblingPaths.filter((_, index) => index !== active.currentIndex);
      const referencePath = remaining[insertion.index];
      let reference: Element | null = null;
      if (referencePath) { try { reference = doc.querySelector(referencePath); } catch { reference = null; } }
      if (reference && reference.parentElement !== parent) reference = null;
      storeOriginal(active.element);
      const domBefore = captureOriginalState(active.element);
      parent.insertBefore(active.element, referencePath ? reference : null);
      recordChange({ element: active.element, selector: getSelector(active.element), property: 'layout:order', before: 'Original order', after: `Moved to position ${insertion.index + 1}`, kind: 'layout', domBefore, domAfter: captureOriginalState(active.element) }, 'Reorder selection');
      mirrorToDevice([parent], restoreInDevice);
      refresh(active.element);
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };

    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onCancel, true);
    win.addEventListener('keydown', onKey, true);
    // Should the frame lose the pointer to the stage around it, the outer window still ends the drag.
    if (win !== window) window.addEventListener('pointerup', onUp, true);
  };

  /** Text retyped inside the device frame, committed against the matching element in this document. */
  const applyTextFromDevice = (path: string, value: string) => {
    let element: HTMLElement | null = null;
    try { element = document.querySelector<HTMLElement>(path); } catch { element = null; }
    if (!element || element.closest(IGNORED_SELECTOR)) {
      // Same fallback as selecting: edit the element in the frame when the live page has no twin.
      const doc = deviceDocRef.current;
      try { element = doc?.querySelector<HTMLElement>(path) ?? null; } catch { element = null; }
    }
    if (!element || element.closest(IGNORED_SELECTOR)) {
      setCanvasNote('That element only exists at this screen size, so the edit could not be recorded.');
      return;
    }
    lockTo(element);
    storeOriginal(element);
    applyTextTo(targetsFor(element), value);
  };


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
      const targetSnapshot = createSnapshot(target);
      if (['text', 'button', 'link', 'input'].includes(targetSnapshot.kind) && !targetSnapshot.hasMarkup) startTextEdit(target);
      else {
        // Containers use the same gesture to enter the group. `elementsFromPoint` is ordered deepest
        // first, so choose the first descendant under the pointer rather than flattening its markup.
        const child = document.elementsFromPoint(event.clientX, event.clientY).find((node): node is HTMLElement => node instanceof HTMLElement && node !== target && target.contains(node) && !node.closest(IGNORED_SELECTOR));
        if (child) lockTo(child);
        else setCanvasNote('This container has no selectable child at that point.');
      }
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

  useEffect(() => {
    if (!open) return;
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z') {
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redoHistory(); else undoHistory();
        return;
      }
      if (target instanceof HTMLElement && (target.closest('[data-inspector-ui]') || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!event.altKey && !command && !event.shiftKey) {
        const tool = event.key.toLowerCase();
        if (tool === 'v' || tool === 'c' || tool === 'h' || tool === 'i') {
          event.preventDefault();
          event.stopPropagation();
          if (tool === 'v') { setCanvasTool('move'); setMode('design'); }
          else if (tool === 'c') { setCanvasTool('comment'); setMode('comment'); }
          else setCanvasTool('hand');
          return;
        }
      }
      if (command && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        event.stopPropagation();
        setMode('handoff');
        return;
      }
      if (handleCanvasKey(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onShortcut, true);
    return () => window.removeEventListener('keydown', onShortcut, true);
  });

  /* Selection commands — the same whether the key was typed over the page or inside the frame. */

  const nudge = (key: string, step: number) => {
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const targets = currentTargets();
    beginHistoryBatch(`Nudge ${key.replace('Arrow', '').toLowerCase()} ${step}px`);
    targets.forEach((element) => {
      // A positioned element moves by its offsets; anything in flow moves by its margins.
      const style = getComputedStyle(element);
      const positioned = style.position === 'absolute' || style.position === 'fixed';
      const property = positioned ? (horizontal ? 'left' : 'top') : (horizontal ? 'margin-left' : 'margin-top');
      const current = Number.parseFloat(style.getPropertyValue(property)) || 0;
      applyStyleTo([element], property, `${current + sign * step}px`);
    });
    finishHistoryBatch();
  };

  const flip = (axis: 'x' | 'y') => {
    const element = selectedRef.current;
    if (!element) return;
    beginHistoryBatch(axis === 'x' ? 'Flip horizontal' : 'Flip vertical');
    applyStyleTo(currentTargets(), 'transform', toggleTransformPart(element, axis === 'x' ? 'scaleX(-1)' : 'scaleY(-1)'));
    finishHistoryBatch();
  };

  const rotate = (degrees: number) => {
    const element = selectedRef.current;
    if (!element) return;
    applyStyleTo(currentTargets(), 'transform', withRotation(element, Math.round(degrees)));
  };

  /** `display: none`, recorded like any other edit, so Undo and the layers panel both bring it back. */
  const hideElements = (targets: HTMLElement[]) => {
    if (!targets.length) return;
    beginHistoryBatch('Hide');
    targets.forEach((element) => {
      if (getComputedStyle(element).display === 'none') return;
      hiddenDisplayRef.current.set(element, getComputedStyle(element).display);
      applyStyleTo([element], 'display', 'none');
    });
    finishHistoryBatch();
  };

  const showElements = (targets: HTMLElement[]) => {
    if (!targets.length) return;
    beginHistoryBatch('Show');
    targets.forEach((element) => {
      if (getComputedStyle(element).display !== 'none') return;
      // What it was before it was hidden here; a site-hidden element has no record, so block is the guess.
      applyStyleTo([element], 'display', hiddenDisplayRef.current.get(element) ?? 'block');
    });
    finishHistoryBatch();
  };

  /** A copy right after the original, selected, as Ctrl+D does in Figma. */
  const duplicateSelection = () => {
    const element = selectedRef.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-hi-editing');
    clone.removeAttribute('contenteditable');
    parent.insertBefore(clone, element.nextSibling);
    // A duplicate has no "before" on the page; undo removes it, redo puts it back where it was.
    recordChange({ element: clone, selector: getSelector(clone), property: 'layout:duplicate', before: 'Not on the page', after: 'Copy inserted after the original', kind: 'layout', domBefore: { ...captureOriginalState(clone), parent: null }, domAfter: captureOriginalState(clone) }, 'Duplicate');
    mirrorToDevice([parent], restoreInDevice);
    selectElement(clone);
  };

  /** The element a structural path names — in this document first, else the framed copy. */
  const elementForPath = (path: string): HTMLElement | null => {
    let element: HTMLElement | null = null;
    try { element = document.querySelector<HTMLElement>(path); } catch { element = null; }
    if (!element || element.closest(IGNORED_SELECTOR)) {
      try { element = deviceDocRef.current?.querySelector<HTMLElement>(path) ?? null; } catch { element = null; }
    }
    return element && !element.closest(IGNORED_SELECTOR) ? element : null;
  };

  const toggleLayerHidden = (path: string, hidden: boolean) => {
    const element = elementForPath(path);
    if (!element) return;
    if (hidden) hideElements([element]); else showElements([element]);
  };

  /* Fill: one type at a time. */

  useEffect(() => { setFillTypeChoice(null); }, [snapshot?.uniquePath]);
  const fillType: FillType = snapshot
    ? (fillTypeChoice ?? detectFillType(getComputedStyle(snapshot.element).backgroundImage, getComputedStyle(snapshot.element).backgroundColor))
    : 'solid';

  /** Switching type clears what the other types put there, so what is shown is what is painted. */
  const setFillType = (type: FillType) => {
    if (!snapshot) return;
    setFillTypeChoice(type);
    const style = getComputedStyle(snapshot.element);
    const image = style.backgroundImage;
    const color = style.backgroundColor;
    beginHistoryBatch(`Fill: ${type}`);
    if (type === 'solid') {
      if (image !== 'none') applyStyle('background-image', 'none');
      if (colorAlpha(color) === 0) applyStyle('background-color', '#ffffff');
    } else if (type === 'gradient') {
      if (!parseGradient(image, resolveColor)) applyStyle('background-image', serializeGradient(defaultGradient(colorAlpha(color) === 0 ? '#7c3cff' : color, resolveColor)));
    } else if (type === 'image') {
      if (!backgroundUrl(image) && image !== 'none') applyStyle('background-image', 'none');
    } else if (type === 'pattern') {
      if (!isPattern(image)) { const pattern = PATTERN_PRESETS[0]; applyStyle('background-image', pattern.image); applyStyle('background-size', pattern.size); applyStyle('background-position', pattern.position ?? '0 0'); }
    } else {
      if (image !== 'none') applyStyle('background-image', 'none');
      if (colorAlpha(color) !== 0) applyStyle('background-color', 'transparent');
    }
    finishHistoryBatch();
  };

  /* The Position & size and Align sections read and write through these. */

  const parentIsFlexOrGrid = Boolean(snapshot?.element.parentElement && /flex|grid/.test(getComputedStyle(snapshot.element.parentElement).display));
  const isPositioned = Boolean(snapshot && /^(absolute|fixed)$/.test(getComputedStyle(snapshot.element).position));
  /** X and Y are the offsets that actually move the element: left/top when positioned, margins otherwise. */
  const positionProperty = (axis: 'x' | 'y') => (isPositioned ? (axis === 'x' ? 'left' : 'top') : (axis === 'x' ? 'margin-left' : 'margin-top'));
  const positionValue = (axis: 'x' | 'y') => (snapshot ? Math.round(Number.parseFloat(getComputedStyle(snapshot.element).getPropertyValue(positionProperty(axis))) || 0) : 0);

  /** W and H from the panel; with the ratio locked the other side follows. */
  const resizeTo = (dimension: 'width' | 'height', value: number) => {
    if (!snapshot || !Number.isFinite(value) || value <= 0) return;
    const targets = currentTargets();
    beginHistoryBatch(`Set ${dimension}`);
    if (getComputedStyle(snapshot.element).display === 'inline') applyStyleTo(targets, 'display', 'inline-block');
    applyStyleTo(targets, dimension, `${Math.round(value)}px`);
    if (ratioLocked && snapshot.rect.width > 0 && snapshot.rect.height > 0) {
      const ratio = snapshot.rect.width / snapshot.rect.height;
      applyStyleTo(targets, dimension === 'width' ? 'height' : 'width', `${Math.round(dimension === 'width' ? value / ratio : value * ratio)}px`);
    }
    finishHistoryBatch();
  };

  /**
   * Align within the parent. Horizontally, auto margins do it in block and flex parents alike;
   * vertically only a flex or grid parent has a say, through align-self.
   */
  const alignSelection = (action: AlignAction) => {
    if (!snapshot) return;
    const targets = currentTargets();
    const style = getComputedStyle(snapshot.element);
    beginHistoryBatch(`Align ${action}`);
    if (action === 'left' || action === 'center' || action === 'right') {
      // An inline box has no margins to push against; give it a block of its own width first.
      if (/inline/.test(style.display)) { applyStyleTo(targets, 'display', 'block'); applyStyleTo(targets, 'width', 'fit-content'); }
      applyStyleTo(targets, 'margin-left', action === 'left' ? '0px' : 'auto');
      applyStyleTo(targets, 'margin-right', action === 'right' ? '0px' : 'auto');
    } else {
      const grid = snapshot.element.parentElement ? getComputedStyle(snapshot.element.parentElement).display.includes('grid') : false;
      const value = action === 'top' ? (grid ? 'start' : 'flex-start') : action === 'middle' ? 'center' : (grid ? 'end' : 'flex-end');
      applyStyleTo(targets, 'align-self', value);
    }
    finishHistoryBatch();
  };

  /** Returns true when the key was a selection command and has been carried out. */
  const handleCanvasKey = (event: KeyboardEvent): boolean => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.shiftKey && event.key.toLowerCase() === 'l') { setLayersOpen((current) => !current); return true; }
    if (!canvasEdit || !selectedRef.current) return false;
    if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'd') { duplicateSelection(); return true; }
    if (!command && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) { hideElements(currentTargets()); return true; }
    if (!command && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'h') { flip('x'); return true; }
    if (!command && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'v') { flip('y'); return true; }
    if (!command && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { nudge(event.key, event.shiftKey ? 10 : 1); return true; }
    return false;
  };
  canvasKeyRef.current = handleCanvasKey;
  canvasMoveRef.current = startMove;

  const restoreOriginal = (original: OriginalState) => {
    restoreCapturedState(original);
  };

  const restoreTokenVariable = (name: string) => {
    const original = tokenVariableOriginalsRef.current.get(name);
    if (original) {
      document.documentElement.style.setProperty(name, original.value, original.priority);
      deviceDocRef.current?.documentElement.style.setProperty(name, original.value, original.priority);
    } else {
      document.documentElement.style.removeProperty(name);
      deviceDocRef.current?.documentElement.style.removeProperty(name);
    }
  };

  /** Duplicates have no original to restore; a reset simply takes them off the page. */
  const removeDuplicates = (entries: readonly DesignChange[]) => {
    entries.forEach((change) => {
      if (change.property !== 'layout:duplicate') return;
      const parent = change.element.parentElement;
      change.element.remove();
      if (parent) mirrorToDevice([parent], restoreInDevice);
    });
  };

  const resetElement = () => {
    if (!snapshot) return;
    const targets = currentTargets();
    const layoutTargets = new Set(changesRef.current.filter((change) => change.kind === 'layout' && targets.includes(change.element)).map((change) => change.element));
    removeDuplicates(changesRef.current.filter((change) => targets.includes(change.element)));
    targets.forEach((element) => { const original = originalsRef.current.get(element); if (original) { restoreOriginal(original); originalsRef.current.delete(element); } });
    undoStackRef.current = undoStackRef.current
      .map((entry) => ({ ...entry, changes: entry.changes.filter((change) => !targets.includes(change.element)) }))
      .filter((entry) => entry.changes.length);
    redoStackRef.current = [];
    const next = changesRef.current.filter((change) => !targets.includes(change.element));
    const removedVariables = changesRef.current
      .filter((change) => targets.includes(change.element) && change.kind === 'token' && change.cssVariable)
      .map((change) => change.cssVariable!.name);
    removedVariables.forEach((name) => {
      if (next.some((change) => change.kind === 'token' && change.cssVariable?.name === name)) return;
      restoreTokenVariable(name);
      tokenVariableOriginalsRef.current.delete(name);
    });
    syncActiveTokenVariables(next);
    changesRef.current = next;
    setChanges(next);
    setStateResetSignal((current) => current + 1);
    const layoutParents = Array.from(new Set(Array.from(layoutTargets).map((element) => element.parentElement).filter((parent): parent is HTMLElement => Boolean(parent))));
    mirrorToDevice(layoutParents, restoreInDevice);
    mirrorToDevice(targets, restoreInDevice);
    window.setTimeout(syncStateRules, 0);
    refresh(snapshot.element);
  };

  const resetAll = () => {
    const touched = Array.from(originalsRef.current.keys());
    const layoutTargets = new Set(changesRef.current.filter((change) => change.kind === 'layout').map((change) => change.element));
    removeDuplicates(changesRef.current);
    originalsRef.current.forEach(restoreOriginal);
    originalsRef.current.clear();
    tokenVariableOriginalsRef.current.forEach((_, name) => restoreTokenVariable(name));
    tokenVariablesRef.current.clear();
    tokenVariableOriginalsRef.current.clear();
    changesRef.current = [];
    undoStackRef.current = [];
    redoStackRef.current = [];
    setChanges([]);
    setStateResetSignal((current) => current + 1);
    applyStateRules(document, '');
    if (deviceDocRef.current) applyStateRules(deviceDocRef.current, '');
    const layoutParents = Array.from(new Set(Array.from(layoutTargets).map((element) => element.parentElement).filter((parent): parent is HTMLElement => Boolean(parent))));
    mirrorToDevice(layoutParents, restoreInDevice);
    mirrorToDevice(touched, restoreInDevice);
    refresh(snapshot?.element);
  };

  const applyAsset = (asset: AssetInfo, value: string, label: string) => {
    const target = asset.element as HTMLElement;
    storeOriginal(target);
    const domBefore = captureOriginalState(target);
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
    recordChange({ element: target, selector: getSelector(target), property: `asset:${asset.id}`, before: asset.src, after: label, kind: 'asset', domBefore, domAfter: captureOriginalState(target) }, 'Replace asset');
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

  /** Removes the rendered asset without severing its DOM identity, so Undo/Redo and Reset can restore it. */
  const removeAsset = (asset: AssetInfo) => {
    const target = asset.element as HTMLElement;
    storeOriginal(target);
    const domBefore = captureOriginalState(target);
    if (asset.type === 'background') target.style.setProperty('background-image', 'none', 'important');
    else target.setAttribute('hidden', '');
    const domAfter = captureOriginalState(target);
    recordChange({
      element: target,
      selector: getSelector(target),
      property: `asset:${asset.id}`,
      before: asset.src,
      after: 'Removed from canvas',
      kind: 'asset',
      domBefore,
      domAfter,
      instruction: asset.type === 'background' ? 'Remove this background image.' : 'Remove this asset from the component.',
    }, 'Remove asset');
    mirrorToDevice([target], restoreInDevice);
    setToast({ id: Date.now(), label: `${asset.label} removed` });
    refresh(snapshot?.element);
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
    const domBefore = captureOriginalState(element);
    if (direction < 0) parent.insertBefore(element, sibling); else parent.insertBefore(sibling, element);
    recordChange({ element, selector: getSelector(element), property: 'layout:order', before: 'Original order', after: direction < 0 ? 'Moved earlier' : 'Moved later', kind: 'layout', domBefore, domAfter: captureOriginalState(element) }, 'Reorder selection');
    mirrorToDevice([parent], restoreInDevice);
    refresh(element);
  };

  const unlock = () => { finishTextEdit(true); commitSelection([]); };
  // A page can swap out what it renders under the tool — a slide change, a route change. Once the
  // selected node leaves the document its rect is a lie, so stop drawing on top of whatever replaced it.
  const overlaySnapshot = snapshot?.element.isConnected && snapshot.element.ownerDocument === document ? snapshot : null;
  const overlayRect = canvasRect ?? overlaySnapshot?.rect ?? null;
  const liveSelection = selectedElements.filter((element) => element.isConnected);
  const parentRect = locked && selectedRef.current?.ownerDocument === document && selectedRef.current.parentElement && selectedRef.current.parentElement !== document.body
    ? selectedRef.current.parentElement.getBoundingClientRect()
    : null;
  // Resize handles are a design-mode tool; in comment mode the outline only says what a note is about.
  const canvasHandlesVisible = mode === 'design' && canvasEdit && locked && !deviceOpen && Boolean(overlaySnapshot);
  const designChanges = changes.filter((change) => {
    if (!snapshot) return false;
    return scope === 'component' ? snapshot.family.elements.includes(change.element) : liveSelection.includes(change.element);
  });
  // `!important` is carried through: these are the edits the page's own CSS was overriding, and CSS
  // copied without it would not reproduce what the designer is looking at.
  const directCssDiff = changes.filter((change) => change.kind === 'css').map((change) => `${change.selector} {\n  ${change.property}: ${change.after}${change.forced ? ' !important' : ''};\n}`).join('\n\n');
  const stateCssDiff = changes.filter((change) => change.kind === 'state').map((change) => {
    const [, state, ...propertyParts] = change.property.split(':');
    return `${change.selector}${STATE_SELECTOR[state as ComponentStateId]} {\n  ${propertyParts.join(':')}: ${change.after};\n}`;
  }).join('\n\n');
  const tokenChanges = changes.filter((change) => change.kind === 'token');
  const tokenDeclarations = Array.from(new Map(tokenChanges.filter((change) => change.cssVariable).map((change) => [change.cssVariable!.name, change.cssVariable!.value])).entries());
  const tokenCssDiff = tokenDeclarations.length ? `:root {\n${tokenDeclarations.map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}` : '';
  const cssDiff = [tokenCssDiff, directCssDiff, stateCssDiff].filter(Boolean).join('\n\n');
  const elementComments = snapshot ? comments.filter((comment) => comment.path === snapshot.uniquePath) : [];
  const otherComments = snapshot ? comments.filter((comment) => comment.path !== snapshot.uniquePath) : comments;
  const selectedCommentCount = elementComments.length;
  const instructions = changes.filter((change) => change.instruction).map((change, index) => `${index + 1}. ${change.instruction}`).join('\n');
  /**
   * Comments grouped by the element they sit on, named the way the panel names it, so a
   * developer reading the handoff knows which thing each note is about without the page open.
   */
  const commentsReport = (() => {
    if (!comments.length) return '';
    const byPath = new Map<string, PageComment[]>();
    for (const comment of comments) {
      const list = byPath.get(comment.path) ?? [];
      list.push(comment);
      byPath.set(comment.path, list);
    }
    return Array.from(byPath.values()).map((list) => {
      const head = `${list[0].label} · ${list[0].selector}`;
      return `${head}\n${list.map((comment) => `  - ${comment.text}  (${new Date(comment.createdAt).toLocaleString()})`).join('\n')}`;
    }).join('\n\n');
  })();

  const handoffText = (changes.length || comments.length) ? [
    `Design handoff · ${window.location.pathname} · ${new Date().toLocaleString()}`,
    [changes.length && `${changes.length} change${changes.length === 1 ? '' : 's'}`, comments.length && `${comments.length} comment${comments.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
    instructions && `\nINSTRUCTIONS\n${instructions}`,
    changes.length && `\nCHANGES\n${changes.map((change) => `- ${change.selector} · ${change.property}: ${change.before || '—'} → ${change.after}`).join('\n')}`,
    commentsReport && `\nCOMMENTS\n${commentsReport}`,
    cssDiff && `\nCSS\n${cssDiff}`,
  ].filter(Boolean).join('\n') : '';
  /**
   * The document the session produces.
   *
   * Rebuilt from the same state the panel already holds rather than accumulated separately, so it
   * cannot drift from what is actually on the page — an export that disagrees with the screen is
   * worse than no export.
   */
  const handoffReport = useMemo(
    () => buildHandoff(changes, comments, colorTokens, {
      url: `${window.location.origin}${window.location.pathname}`,
      author: commentAuthor,
      tokenCss: tokenCssDiff,
      stateCss: stateCssDiff,
    }),
    // `changes` carries live element references, so a version counter is what says "something moved".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changes, comments, colorTokens, commentAuthor, tokenCssDiff, stateCssDiff, editVersion],
  );

  const liveStyle = snapshot ? getComputedStyle(snapshot.element) : null;
  // The layers panel's hover, drawn on the live page; the frame draws its own from the same path.
  const layerHoverRect = (() => {
    if (deviceOpen || !layerHoverPath) return null;
    let node: HTMLElement | null = null;
    try { node = document.querySelector<HTMLElement>(layerHoverPath); } catch { node = null; }
    return node && !node.closest(IGNORED_SELECTOR) ? snapRectOf(node) : null;
  })();
  // Only the selected node and its nearest useful ancestors belong in the narrow header.
  const breadcrumbNodes = snapshot
    ? [snapshot.element.parentElement?.parentElement, snapshot.element.parentElement, snapshot.element].filter((node): node is HTMLElement => Boolean(node && node !== document.body && node !== document.documentElement))
    : [];
  const responsiveIssueCount = snapshot && deviceDocument
    ? (() => { const node = resolveInDocument(deviceDocument, snapshot); return node ? measureInFrame(node, snapshot, inspectorDevicePresets.find((item) => item.id === devicePreset)?.width ?? 1440).issues.length : 1; })()
    : 0;

  return <div data-inspector-ui className="hi-root" dir="ltr" style={{
    '--hi-canvas': '#f5f5f5',
    '--hi-panel': '#ffffff',
    '--hi-surface': '#ffffff',
    '--hi-surface-strong': '#f7f7f7',
    '--hi-border': '#e5e5e5',
    '--hi-border-strong': '#b3b3b3',
    '--hi-text': '#1e1e1e',
    '--hi-muted': '#6e6e6e',
    '--hi-faint': '#9e9e9e',
    '--hi-accent': '#0d99ff',
    '--hi-accent-soft': '#e5f4ff',
    '--hi-selected': '#0d99ff',
    '--hi-selected-soft': '#e5f4ff',
    '--hi-success': inspectorVisualTokens.success,
  } as CSSProperties}>
    {/* Only the way in. Closing is the header's X — two controls for one job, both on screen
        at once, is what made the corner busy. */}
    {!open && <button className="hi-launcher" onClick={toggleInspector} aria-label="Open inspector"><ScanSearch size={16} /><span>Inspect</span></button>}

    {/* Pins live outside the panel so they sit over the page, next to what they refer to. */}
    {toast && <InspectorToast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}

    {!deviceOpen && commentMarkers.length > 0 && <CommentPinLayer
      markers={commentMarkers}
      openPath={openThread}
      author={commentAuthor}
      onOpenPath={setOpenThread}
      onSelect={(path) => { setOpen(true); selectByPath(path); }}
      onPost={addCommentToThread}
      onOpenInPanel={(path) => { setOpen(true); selectByPath(path); setMode('comment'); setFocusComposer((count) => count + 1); setOpenThread(null); }}
      onToggleResolved={toggleCommentResolved}
      onDelete={removeComment}
    />}
    {open && <>
      {open && layersOpen && mode !== 'handoff' && <LayersPanel
        root={deviceOpen ? deviceDocument : document}
        side={dock === 'left' ? 'right' : 'left'}
        selectedPath={snapshot?.uniquePath ?? null}
        editVersion={editVersion}
        onHover={setLayerHoverPath}
        onSelect={(path) => { if (!selectFromDevice(path)) setToast({ id: Date.now(), label: 'That element could not be selected.' }); }}
        onToggleHidden={toggleLayerHidden}
        onClose={() => setLayersOpen(false)}
      />}
      {!deviceOpen && layerHoverRect && <SelectionChrome rect={layerHoverRect} className="hi-selection is-live is-hovered" />}
      {deviceMounted && <DeviceOverlay
        presetId={devicePreset}
        orientation={deviceOrientation}
        freezeReveals={freezeReveals}
        reloadKey={deviceReloadKey}
        snapshot={snapshot}
        dock={dock}
        hidden={!deviceOpen}
        layers={layersOpen}
        editVersion={editVersion}
        comments={comments}
        tool={canvasTool}
        canvasEdit={canvasEdit}
        canvasSize={canvasSize}
        canvasBusyRef={canvasBusyRef}
        swallowClickRef={swallowClickRef}
        guides={guides}
        hoverPath={layerHoverPath}
        onCanvasResize={(direction, event, scale, onUpdate) => { if (snapshot) startResize(snapshot.element, direction, event, scale, onUpdate); }}
        onCanvasRotate={(event) => { if (snapshot) startRotate(snapshot.element, event); }}
        onCanvasMove={onCanvasMove}
        onCanvasKey={onCanvasKey}
        onCanvasText={applyTextFromDevice}
        onFrameDocument={registerDeviceDocument}
        onSelectPath={selectFromDevice}
        onComment={(path) => { selectByPath(path); setMode('comment'); setFocusComposer((count) => count + 1); }}
        onReplay={replayIntoDevice}
        onUndo={undoHistory}
        onRedo={redoHistory}
        onNotice={(label) => setToast({ id: Date.now(), label })}
      />}
      {!deviceOpen && <GuideLayer guides={measureGuides.length ? [...guides, ...measureGuides] : guides} live />}
      {!deviceOpen && mode !== 'handoff' && parentRect && <div className="hi-selection-parent" style={{ top: parentRect.top, left: parentRect.left, width: parentRect.width, height: parentRect.height }} />}
      {!deviceOpen && mode !== 'handoff' && locked && liveSelection.filter((element) => element.ownerDocument === document && element !== overlaySnapshot?.element).map((element) => {
        const rect = element.getBoundingClientRect();
        return <div key={getUniquePath(element)} className="hi-selection hi-selection--peer is-locked" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />;
      })}
      {!deviceOpen && mode !== 'handoff' && overlaySnapshot && overlayRect && <SelectionChrome rect={overlayRect} className={`hi-selection is-live ${locked ? 'is-locked' : ''} ${canvasSize ? 'is-resizing' : ''}`} label={`${liveSelection.length > 1 ? `${liveSelection.length} layers · ` : ''}${round(overlayRect.width)} × ${round(overlayRect.height)}`} handles={canvasHandlesVisible ? <CanvasHandles size={null} onStart={(direction, event) => startResize(overlaySnapshot.element, direction, event, 1, null)} onRotateStart={(event) => startRotate(overlaySnapshot.element, event)} /> : null}>
        {/* Offered right where the selection is, so commenting is one click from picking rather
            than a hunt down the panel — but only in the tab where commenting is the job. */}
        {locked && commentMode && <button
          className="hi-selection-comment"
          title={selectedCommentCount ? `${selectedCommentCount} comment${selectedCommentCount > 1 ? 's' : ''} — open the thread` : 'Comment on this element'}
          onClick={(event) => { event.stopPropagation(); setFocusComposer((count) => count + 1); }}
        ><MessageSquare size={11} />{selectedCommentCount || 'Comment'}</button>}
      </SelectionChrome>}
      {!deviceOpen && mode !== 'handoff' && locked && !canvasSize && overlaySnapshot && <div className="hi-measurements">{SIDES.map((side) => overlaySnapshot.siblingDistances[side] !== undefined ? <span key={side} className={`hi-measure hi-measure-${side}`} style={{ top: side === 'top' ? overlaySnapshot.rect.top - 22 : side === 'bottom' ? overlaySnapshot.rect.bottom + 6 : overlaySnapshot.rect.top + overlaySnapshot.rect.height / 2, left: side === 'left' ? overlaySnapshot.rect.left - 42 : side === 'right' ? overlaySnapshot.rect.right + 7 : overlaySnapshot.rect.left + overlaySnapshot.rect.width / 2 }}>{overlaySnapshot.siblingDistances[side]}px</span> : null)}</div>}
      <nav className={`hi-canvas-toolbar ${deviceOpen ? 'is-device' : ''} hi-canvas-toolbar--${dock} ${layersOpen ? 'has-layers' : ''}`} aria-label="Canvas tools">
        <button className={canvasTool === 'move' && mode === 'design' ? 'is-active' : ''} aria-pressed={canvasTool === 'move' && mode === 'design'} title="Design — select and edit (V)" onClick={() => { setCanvasTool('move'); setMode('design'); }}><PenTool size={16} /><span>Design</span><kbd>V</kbd></button>
        <button className={canvasTool === 'comment' && mode === 'comment' ? 'is-active' : ''} aria-pressed={canvasTool === 'comment' && mode === 'comment'} title="Comment (C)" onClick={() => { setCanvasTool('comment'); setMode('comment'); }}><MessageSquare size={16} /><span>Comment</span><kbd>C</kbd></button>
        <button className={canvasTool === 'hand' ? 'is-active' : ''} aria-pressed={canvasTool === 'hand'} title="Interact — use the page as a visitor, drag to pan (I / hold Space)" onClick={() => setCanvasTool('hand')}><MousePointerClick size={16} /><span>Interact</span><kbd>I</kbd></button>
        <i />
        <button className={mode === 'handoff' ? 'is-active' : ''} aria-pressed={mode === 'handoff'} title="Open handoff (Ctrl+Shift+H)" onClick={() => setMode('handoff')}><Code2 size={16} /><span>Handoff</span></button>
        {deviceOpen && <>
          <i />
          <DeviceControls
            presetId={devicePreset}
            orientation={deviceOrientation}
            freezeReveals={freezeReveals}
            onPresetChange={setDevicePreset}
            onOrientationChange={setDeviceOrientation}
            onFreezeRevealsChange={setFreezeReveals}
            onReload={() => setDeviceReloadKey((current) => current + 1)}
            onLivePage={() => setDeviceOpen(false)}
          />
        </>}
      </nav>
      <aside ref={panelRef} className={`hi-panel hi-panel--${dock} ${deviceOpen ? 'hi-panel--workspace' : ''}`}>
        <header className="hi-header">
          <div className="hi-mode-tabs" role="tablist" aria-label="Inspector mode">
            <button role="tab" aria-selected={mode === 'design'} className={mode === 'design' ? 'is-active' : ''} onClick={() => { setMode('design'); setCanvasTool('move'); }}>Design</button>
            <button role="tab" aria-selected={mode === 'comment'} className={mode === 'comment' ? 'is-active' : ''} onClick={() => { setMode('comment'); setCanvasTool('comment'); }}>Comment</button>
            <button role="tab" aria-selected={mode === 'handoff'} className={mode === 'handoff' ? 'is-active' : ''} onClick={() => setMode('handoff')}>Handoff</button>
          </div>
          <details className="hi-panel-menu">
            <summary title="Inspector options" aria-label="Inspector options"><MoreHorizontal size={16} /></summary>
            <div>
              <button onClick={() => setDock(dock === 'left' ? 'right' : 'left')}>{dock === 'left' ? <PanelRight size={14} /> : <PanelLeft size={14} />}Dock {dock === 'left' ? 'right' : 'left'}</button>
              {hasSecondCollection && <button onClick={() => setSecondaryCollectionActive((current) => !current)}><Component size={14} />{secondaryCollectionActive ? designTokens.collections[0]?.name : designTokens.collections[1]?.name}</button>}
              {hubAvailable() && <button onClick={() => (window as HubHost).__merakiInspectorHub?.()}><Settings size={14} />Settings</button>}
              <button onClick={() => setLayersOpen((current) => !current)}><Layers size={14} />{layersOpen ? 'Hide layers' : 'Show layers'}<kbd>Ctrl+Shift+L</kbd></button>
              {deviceOpen ? <button onClick={() => setDeviceOpen(false)}><ExternalLink size={14} />Live page</button> : <button onClick={() => openDevice('desktop')}><Monitor size={14} />Device canvas</button>}
              {locked && <button onClick={unlock}><Unlock size={14} />Clear selection</button>}
              <button onClick={() => setOpen(false)}><X size={14} />Close</button>
            </div>
          </details>
        </header>
        {mode !== 'handoff' && <nav className="hi-breadcrumb" aria-label="Selection breadcrumb">
          {breadcrumbNodes.length ? breadcrumbNodes.map((node, index) => <span key={getUniquePath(node)}>{index > 0 && <i>›</i>}<button title={getSelector(node)} onClick={() => selectElement(node)}>{node.tagName.toLowerCase()}{node.classList[0] ? `.${node.classList[0]}` : ''}</button></span>) : <small>Click anything to select it</small>}
        </nav>}
        {restorable && !changes.length && <div className="hi-restore">
          <History size={17} />
          <span><strong>{restorable.changes.length} edit{restorable.changes.length === 1 ? '' : 's'} from your last session</strong><small>Saved {new Date(restorable.savedAt).toLocaleString()} on this page.</small></span>
          <div><button className="is-primary" onClick={() => restoreSession(restorable)}>Restore</button><button onClick={discardSession}>Discard</button></div>
        </div>}
        {restoreNote && <div className="hi-restore is-note"><CircleAlert size={16} /><span><small>{restoreNote}</small></span><div><button onClick={() => setRestoreNote(null)}>Dismiss</button></div></div>}
        <div className="hi-scroll">
          {mode === 'handoff' ? <HandoffTab
            report={handoffReport}
            author={commentAuthor}
            onSelect={selectElement}
            onUndoChange={undoChange}
            onToggleResolved={toggleCommentResolved}
            onDeleteNote={removeComment}
            onAuthorChange={(name) => { setCommentAuthor(name); writeCommentAuthor(name.trim()); }}
          />
          : !snapshot ? <div className="hi-onboarding hi-onboarding--quiet"><MousePointer2 size={16} /><span>Click anything to select it</span></div>
            : <div className="hi-design">
              {mode === 'design' && <><div className="hi-design-cluster"><div className="hi-design-heading"><div><h2>{snapshot.family.label}</h2></div><span className="hi-live-dot">Live</span></div>
              {/* Editing every matching variant at once is only meaningful against a real design
                  system — without one there is nothing that defines what a "component" is, so the
                  control is shown but locked, with the reason on hover. */}
              <div className={`hi-scope ${designSystemConnected ? '' : 'is-locked'}`} title={designSystemConnected ? undefined : DESIGN_SYSTEM_REQUIRED}>
                <button className={scope === 'free' ? 'is-active' : ''} aria-disabled={!designSystemConnected} onClick={() => designSystemConnected && setScope('free')}>Single</button>
                <button className={scope === 'component' ? 'is-active' : ''} aria-disabled={!designSystemConnected} onClick={() => designSystemConnected && setScope('component')}>All variants</button>
                {!designSystemConnected && <Lock size={11} />}
              </div></div>
              {canvasNote && <div className="hi-restore is-note"><CircleAlert size={16} /><span><small>{canvasNote}</small></span><div><button onClick={() => setCanvasNote(null)}>Dismiss</button></div></div>}
              <div className="hi-reset-row"><button onClick={resetElement} disabled={!currentTargets().some((element) => changes.some((change) => change.element === element))}><RotateCcw size={13} />Reset selection</button><button onClick={resetAll} disabled={!changes.length}><RotateCcw size={13} />Reset all</button></div></>}
              {commentMode && <ToolSection title={`Comments · ${elementComments.length}`} icon={MessageSquare} openWhen={commentMode || focusComposer > 0 || elementComments.length > 0}>
                <div className="hi-comment-composer">
                  <textarea
                    ref={composerRef}
                    value={commentDraft}
                    placeholder={`Leave a note on ${snapshot.family.label}…`}
                    aria-label="New comment"
                    onChange={(event) => setCommentDraft(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter sends, Shift+Enter breaks the line — the convention everywhere else.
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); addComment(commentDraft); }
                    }}
                  />
                  <div className="hi-comment-composer-actions">
                    {/* Signing is a one-off: type it once and every later note carries it. Unsigned
                        notes are still allowed, because a solo review needs no byline. */}
                    <label className="hi-comment-signature" title="Notes you post are signed with this name">
                      <span>Signed</span>
                      <input
                        value={commentAuthor}
                        placeholder="your name"
                        aria-label="Your name, shown on notes you post"
                        onChange={(event) => setCommentAuthor(event.target.value)}
                        onBlur={(event) => writeCommentAuthor(event.target.value.trim())}
                      />
                    </label>
                    <button disabled={!commentDraft.trim()} onClick={() => addComment(commentDraft)}>Post</button>
                  </div>
                  <small className="hi-comment-hint">Enter to post · Shift + Enter for a new line</small>
                </div>
                {elementComments.length > 0 && <div className="hi-comment-list">
                  {elementComments.map((comment) => <article key={comment.id} className={comment.resolved ? 'is-resolved' : ''}>
                    <p>{comment.text}</p>
                    <footer>
                      <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>
                        {comment.author ? `${comment.author} · ` : ''}{relativeTime(comment.createdAt)}
                      </time>
                      <button
                        title={comment.resolved ? 'Reopen this note' : 'Mark resolved'}
                        aria-label={comment.resolved ? 'Reopen this note' : 'Mark resolved'}
                        aria-pressed={Boolean(comment.resolved)}
                        className={comment.resolved ? 'is-active' : ''}
                        onClick={() => toggleCommentResolved(comment.id)}
                      ><Check size={12} /></button>
                      <button title="Delete comment" aria-label="Delete comment" onClick={() => removeComment(comment.id)}><Trash2 size={12} /></button>
                    </footer>
                  </article>)}
                </div>}
                {otherComments.length > 0 && <div className="hi-comment-elsewhere">
                  <strong>{otherComments.length} comment{otherComments.length > 1 ? 's' : ''} on other elements</strong>
                  {otherComments.map((comment) => <button
                    key={comment.id}
                    title={`Go to ${comment.label}`}
                    onClick={() => {
                      const element = resolveComment(document, comment);
                      if (!element) return;
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      selectedRef.current = element;
                      hoverRef.current = element;
                      setLocked(true);
                      setSnapshot(createSnapshot(element));
                    }}
                  ><span>{comment.label}</span><small>{comment.text}</small></button>)}
                </div>}
              </ToolSection>}
              {mode === 'design' && <>
              {/* The panel in Figma's shape: what applies to the selection is shown, what does not is not. */}
              <div className="hi-align-row" role="toolbar" aria-label="Align">
                {ALIGN_ROW_ACTIONS.map(({ id, label, Icon }) => {
                  const vertical = id === 'top' || id === 'middle' || id === 'bottom';
                  const disabled = vertical && !parentIsFlexOrGrid;
                  return <button key={id} title={disabled ? `${label} — needs a flex or grid parent` : label} aria-label={label} disabled={disabled} onClick={() => alignSelection(id)}><Icon size={14} /></button>;
                })}
              </div>
              <ToolSection title="Position & size" icon={Move}>
                <div className="hi-control-pair">
                  <NumberField label="X" value={positionValue('x')} onChange={(value) => applyStyle(positionProperty('x'), value)} />
                  <NumberField label="Y" value={positionValue('y')} onChange={(value) => applyStyle(positionProperty('y'), value)} />
                </div>
                <div className="hi-control-pair hi-control-pair--lock">
                  <NumberField label="W" value={round(snapshot.rect.width)} min={1} onChange={(value) => resizeTo('width', Number(value))} />
                  <button className={`hi-ratio-lock ${ratioLocked ? 'is-active' : ''}`} title={ratioLocked ? 'Unlock proportions' : 'Lock proportions'} aria-pressed={ratioLocked} onClick={() => setRatioLocked((locked) => !locked)}>{ratioLocked ? <Link2 size={12} /> : <Unlink size={12} />}</button>
                  <NumberField label="H" value={round(snapshot.rect.height)} min={1} onChange={(value) => resizeTo('height', Number(value))} />
                </div>
                <div className="hi-control-pair">
                  <NumberField label="Rotate" value={readRotation(snapshot.element)} step={1} suffix="°" onChange={(value) => rotate(Number.parseFloat(value) || 0)} />
                  <div className="hi-segmented hi-segmented--flip" aria-label="Flip">
                    <button title="Flip horizontal (Shift+H)" aria-label="Flip horizontal" aria-pressed={isFlipped(snapshot.element, 'x')} className={isFlipped(snapshot.element, 'x') ? 'is-active' : ''} onClick={() => flip('x')}><FlipHorizontal2 size={14} /></button>
                    <button title="Flip vertical (Shift+V)" aria-label="Flip vertical" aria-pressed={isFlipped(snapshot.element, 'y')} className={isFlipped(snapshot.element, 'y') ? 'is-active' : ''} onClick={() => flip('y')}><FlipVertical2 size={14} /></button>
                  </div>
                </div>
                <div className="hi-segmented hi-segmented--display" aria-label="Display">
                  {DISPLAY_MODES.map(({ value, label }) => <button key={value} title={value === 'none' ? 'Hidden' : label} aria-pressed={snapshot.styles.display === value} className={snapshot.styles.display === value ? 'is-active' : ''} onClick={() => applyStyle('display', value)}>{value === 'none' ? 'hidden' : label}</button>)}
                </div>
                <BoxSidesField label="Margin" property="margin" element={snapshot.element} onChange={applyStyle} />
                <div className="hi-reorder"><button onClick={() => reorder(-1)}><ArrowLeft size={13} /><ArrowUp size={13} />Earlier</button><button onClick={() => reorder(1)}>Later<ArrowDown size={13} /><ArrowRight size={13} /></button></div>
                <div className="hi-reorder"><button title="Duplicate (Ctrl+D)" onClick={duplicateSelection}><Copy size={13} />Duplicate</button><button title="Hide (Delete) · the layers panel or Undo brings it back" onClick={() => hideElements(currentTargets())}><EyeOff size={13} />Hide</button></div>
              </ToolSection>
              {(snapshot.styles.display.includes('flex') || snapshot.styles.display.includes('grid')) && <ToolSection title="Auto layout" icon={Layers3}>
                {snapshot.styles.display.includes('flex') && <div className="hi-control"><span>Direction</span><div className="hi-segmented" aria-label="Direction">{FLEX_DIRECTION_ICONS.map(({ value, label, Icon }) => <button key={value} title={label} aria-label={label} aria-pressed={snapshot.styles['flex-direction'] === value} className={snapshot.styles['flex-direction'] === value ? 'is-active' : ''} onClick={() => applyStyle('flex-direction', value)}><Icon size={14} /></button>)}</div></div>}
                {snapshot.styles.display.includes('grid') && <label className="hi-control"><span>Columns</span><input defaultValue={snapshot.styles['grid-template-columns']} onBlur={(event) => applyStyle('grid-template-columns', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyStyle('grid-template-columns', event.currentTarget.value); }} /></label>}
                <div className="hi-control-pair">
                  <NumberField label="Gap" value={liveStyle?.gap ?? 0} min={0} onChange={(value) => applyStyle('gap', value)} />
                  {snapshot.styles.display.includes('flex') && <label className="hi-control hi-control--check"><span>Wrap</span><input type="checkbox" checked={liveStyle?.flexWrap === 'wrap'} onChange={(event) => applyStyle('flex-wrap', event.target.checked ? 'wrap' : 'nowrap')} /></label>}
                </div>
                <div className="hi-control">
                  <span>Align</span>
                  <div className="hi-align-grid" role="grid" aria-label="Alignment">
                    {AUTO_LAYOUT_GRID.map((row) => AUTO_LAYOUT_GRID.map((column) => {
                      const on = normalizeAlign(liveStyle?.alignItems ?? '') === row && normalizeAlign(liveStyle?.justifyContent ?? '') === column;
                      return <button key={`${row}-${column}`} role="gridcell" aria-label={`${column} ${row}`} aria-pressed={on} className={on ? 'is-active' : ''} onClick={() => { beginHistoryBatch('Align items'); applyStyle('align-items', row); applyStyle('justify-content', column); finishHistoryBatch(); }}><i /></button>;
                    }))}
                  </div>
                </div>
                <div className="hi-control"><span>Distribute</span><SelectField label="Distribute" compact value={liveStyle?.justifyContent ?? 'flex-start'} options={JUSTIFY_CONTENT} onChange={(value) => applyStyle('justify-content', value)} /></div>
                <BoxSidesField label="Padding" property="padding" element={snapshot.element} onChange={applyStyle} />
              </ToolSection>}
              {!(snapshot.styles.display.includes('flex') || snapshot.styles.display.includes('grid')) && <ToolSection title="Padding" icon={Square} defaultOpen={false}>
                <BoxSidesField label="Padding" property="padding" element={snapshot.element} onChange={applyStyle} />
              </ToolSection>}
              <ToolSection title="Fill" icon={PaintBucket}>
                {/* One kind of fill at a time, as a Figma fill has a type — a colour under a gradient under a picture is not a choice anyone makes on purpose. */}
                <div className="hi-segmented hi-fill-types" role="tablist" aria-label="Fill type">
                  {FILL_TYPES.map((type) => <button key={type.value} role="tab" aria-selected={fillType === type.value} className={fillType === type.value ? 'is-active' : ''} onClick={() => setFillType(type.value)}>{type.label}</button>)}
                </div>
                {fillType === 'solid' && <ColorField label="Colour" value={liveStyle?.backgroundColor ?? snapshot.styles.background} tokens={colorTokens} onChange={(value) => applyStyle('background-color', value)} />}
                {fillType === 'none' && <p className="hi-empty-note">No fill — the element shows what is behind it.</p>}
                {(fillType === 'gradient' || fillType === 'image' || fillType === 'pattern') && <BackgroundField mode={fillType} image={liveStyle?.backgroundImage ?? 'none'} size={liveStyle?.backgroundSize ?? 'auto'} position={liveStyle?.backgroundPosition ?? 'center'} repeat={liveStyle?.backgroundRepeat ?? 'repeat'} fill={liveStyle?.backgroundColor ?? snapshot.styles.background} tokens={colorTokens} onChange={applyStyle} onBatch={(label, apply) => { beginHistoryBatch(label); apply(); finishHistoryBatch(); }} />}
                {(fillType === 'gradient' || fillType === 'image' || fillType === 'pattern') && <ColorField label="Behind it" value={liveStyle?.backgroundColor ?? snapshot.styles.background} tokens={colorTokens} onChange={(value) => applyStyle('background-color', value)} />}
                {snapshot.kind === 'image' && <NumberField label="Image opacity" value={cssNumber(snapshot.styles.opacity, 1) * 100} min={0} max={100} suffix="%" onChange={(value) => applyStyle('opacity', String(Number(value) / 100))} />}
              </ToolSection>
              <ToolSection title="Stroke" icon={Square} defaultOpen={Boolean(liveStyle && Number.parseFloat(liveStyle.borderWidth) > 0 && liveStyle.borderStyle !== 'none')}>
                <ColorField label="Colour" value={liveStyle?.borderColor ?? snapshot.styles.border} tokens={colorTokens} onChange={(value) => applyStyle('border-color', value)} />
                <div className="hi-control-pair"><NumberField label="Width" value={liveStyle?.borderWidth ?? 0} min={0} onChange={(value) => { beginHistoryBatch('Set stroke'); applyStyle('border-width', value); if ((liveStyle?.borderStyle ?? 'none') === 'none' && Number(value) > 0) applyStyle('border-style', 'solid'); finishHistoryBatch(); }} /><SelectField label="Style" compact value={liveStyle?.borderStyle ?? 'solid'} options={BORDER_STYLES} onChange={(value) => applyStyle('border-style', value)} /></div>
              </ToolSection>
              <ToolSection title="Effects" icon={Sparkles}>
                <SelectField label="Shadow" value={snapshot.styles['box-shadow']} options={shadowOptions(snapshot.styles['box-shadow'])} onChange={(value) => applyStyle('box-shadow', value)} />
                <div className="hi-control-pair">
                  <NumberField label="Radius" value={snapshot.styles['border-radius']} min={0} onChange={(value) => applyStyle('border-radius', value)} />
                  <NumberField label="Opacity" value={cssNumber(snapshot.styles.opacity, 1) * 100} min={0} max={100} suffix="%" onChange={(value) => applyStyle('opacity', String(Number(value) / 100))} />
                </div>
                <div className="hi-control-pair">
                  <NumberField label="Layer blur" value={readFilterPart(snapshot.element, 'filter', 'blur')} min={0} onChange={(value) => applyStyle('filter', withFilterPart(snapshot.element, 'filter', 'blur', Number(value) > 0 ? `${Number(value)}px` : null))} />
                  <NumberField label="Backdrop blur" value={readFilterPart(snapshot.element, 'backdrop-filter', 'blur')} min={0} onChange={(value) => applyStyle('backdrop-filter', withFilterPart(snapshot.element, 'backdrop-filter', 'blur', Number(value) > 0 ? `${Number(value)}px` : null))} />
                </div>
                <div className="hi-control-pair">
                  <NumberField label="Brightness" value={Math.round((readFilterPart(snapshot.element, 'filter', 'brightness') || 1) * 100)} min={0} max={300} suffix="%" onChange={(value) => applyStyle('filter', withFilterPart(snapshot.element, 'filter', 'brightness', Number(value) === 100 ? null : `${Number(value) / 100}`))} />
                  <NumberField label="Saturate" value={Math.round((readFilterPart(snapshot.element, 'filter', 'saturate') || 1) * 100)} min={0} max={300} suffix="%" onChange={(value) => applyStyle('filter', withFilterPart(snapshot.element, 'filter', 'saturate', Number(value) === 100 ? null : `${Number(value) / 100}`))} />
                </div>
                <label className="hi-control"><span>Filter</span><input value={snapshot.styles.filter} onChange={(event) => applyStyle('filter', event.target.value)} /></label>
                <label className="hi-control"><span>Transform</span><input value={snapshot.styles.transform} onChange={(event) => applyStyle('transform', event.target.value)} /></label>
              </ToolSection>
              {['text', 'button', 'link', 'input'].includes(snapshot.kind) && <ToolSection title="Text" icon={Type}>
                <FontField label="Font" value={snapshot.styles['font-family']} projectFonts={pageFonts} onChange={(value) => applyStyle('font-family', value)} />
                <div className="hi-control-pair"><SizeField label="Size" compact value={snapshot.styles['font-size']} presets={FONT_SIZES} onChange={(value) => applyStyle('font-size', value)} /><SelectField label="Weight" compact value={String(cssNumber(snapshot.styles['font-weight'], 400))} options={FONT_WEIGHTS} onChange={(value) => applyStyle('font-weight', value)} /></div>
                <div className="hi-control-pair"><NumberField label="Line" value={snapshot.styles['line-height']} onChange={(value) => applyStyle('line-height', value)} /><NumberField label="Track" value={snapshot.styles['letter-spacing']} step={0.1} onChange={(value) => applyStyle('letter-spacing', value)} /></div>
                <div className="hi-segmented" aria-label="Text alignment">{TEXT_ALIGNMENTS.map(({ value, label, Icon }) => <button key={value} title={label} aria-label={label} className={snapshot.styles['text-align'] === value ? 'is-active' : ''} onClick={() => applyStyle('text-align', value)}><Icon size={14} /></button>)}</div>
                <ColorField label="Colour" value={liveStyle?.color ?? snapshot.styles.color} tokens={colorTokens} onChange={(value) => applyStyle('color', value)} />
                <div className="hi-type-presets">{typePresets.map((recipe) => <button key={recipe.label} onClick={() => recipe.css.split(';').filter(Boolean).forEach((part) => { const [property, ...value] = part.split(':'); applyStyle(property.trim(), value.join(':').trim()); })}>{recipe.label}</button>)}</div>
                <label className="hi-control hi-control-stack"><span>{snapshot.kind === 'input' ? 'Value' : 'Content'}</span><DraftTextArea key={snapshot.uniquePath} ariaLabel={snapshot.kind === 'input' ? 'Value' : 'Text'} value={snapshot.rawText} onChange={applyText} /></label>
                {snapshot.hasMarkup && <p className="hi-empty-note hi-content-warning"><CircleAlert size={13} />This element wraps markup (line breaks, nested spans). Editing the text here replaces all of it with plain text.</p>}
                {snapshot.kind === 'link' && <label className="hi-control"><span>Link</span><input defaultValue={snapshot.attributes.href || ''} onBlur={(event) => applyAttribute('href', event.target.value)} /></label>}
                {snapshot.kind === 'input' && <><label className="hi-control"><span>Placeholder</span><input defaultValue={snapshot.attributes.placeholder || ''} onBlur={(event) => applyAttribute('placeholder', event.target.value)} /></label><label className="hi-control"><span>ARIA label</span><input defaultValue={snapshot.attributes['aria-label'] || ''} onBlur={(event) => applyAttribute('aria-label', event.target.value)} /></label></>}
              </ToolSection>}
              </>}
              {mode === 'design' && deviceOpen && <ToolSection title="Responsive" icon={Monitor} defaultOpen={false} badge={responsiveIssueCount ? { text: String(responsiveIssueCount), tone: 'alert' } : undefined}><ResponsivePanel presetId={devicePreset} snapshot={snapshot} frameDocument={deviceDocument} editVersion={editVersion} onPresetChange={setDevicePreset} onReplay={replayIntoDevice} /></ToolSection>}
              {mode === 'design' && <>{snapshot.assets.length > 0 && <ToolSection title={`Assets · ${snapshot.assets.length}`} icon={ImageIcon} defaultOpen={false}><div className="hi-design-assets">{snapshot.assets.map((asset) => <article key={asset.id}><div className="hi-asset-head"><img src={asset.src} alt="" /><span><strong>{asset.label}</strong><small>{asset.type} · {asset.id}</small></span><div className="hi-asset-actions"><a href={asset.src} download={`${asset.id}.${asset.type === 'svg' ? 'svg' : 'png'}`} title="Download asset" aria-label={`Download ${asset.label}`}><Download size={14} /></a><button className="is-danger" title="Remove from canvas · Undo restores it" aria-label={`Remove ${asset.label}`} onClick={() => removeAsset(asset)}><Trash2 size={14} /></button></div></div><label><span>Replace by URL</span><input placeholder="https://…" onKeyDown={(event) => { if (event.key === 'Enter') applyAsset(asset, event.currentTarget.value, 'URL replacement'); }} /></label><label className="hi-upload"><input type="file" accept="image/*,.svg" onChange={(event) => onAssetFile(asset, event.target.files?.[0])} />Upload image or SVG</label>{asset.type === 'svg' && <div className="hi-icon-library">{ICON_LIBRARY.map((icon) => <button key={icon.label} title={icon.label} onClick={() => applyAsset(asset, icon.svg, `${icon.label} icon`)} dangerouslySetInnerHTML={{ __html: icon.svg }} />)}</div>}</article>)}</div></ToolSection>}
              <ToolSection title="Component states · 6" icon={MousePointer2} defaultOpen={false}>
                <ComponentStatesEditor snapshot={snapshot} colorTokens={colorTokens} resetSignal={stateResetSignal} onStateChange={recordStateChange} />
                {snapshot.currentStates.length > 0 && <div className="hi-state-chips">{snapshot.currentStates.map((state) => <span key={state}>{state}</span>)}</div>}
                {/* What the stylesheet already declares, so an override is not written on top of a rule that agrees with it. */}
                {snapshot.stateRules.length ? snapshot.stateRules.map((rule, index) => <div className="hi-state-rule" key={`${rule.selector}-${index}`}><span>{rule.state}</span><code>{rule.selector} {'{'}{rule.declarations.map((item) => `\n  ${item.property}: ${item.value};`).join('')}\n{'}'}</code><CopyButton value={`${rule.selector} {\n${rule.declarations.map((item) => `  ${item.property}: ${item.value};`).join('\n')}\n}`} /></div>) : <p className="hi-empty-note">No readable pseudo-state rules matched this element.</p>}
              </ToolSection>
              <ToolSection title="Accessibility check" icon={ShieldCheck} badge={accessibilityBadge} defaultOpen={false}><AccessibilityPanel snapshot={snapshot} /></ToolSection>
              <MeasurementDetails snapshot={snapshot} />
              <ToolSection title="Token binding" icon={Link2} defaultOpen={false} disabled={!designSystemConnected} disabledHint={DESIGN_SYSTEM_REQUIRED}><TokenBindingPanel snapshot={snapshot} colorTokens={colorTokens} onBind={applyTokenBinding} /></ToolSection>
              <ToolSection title="Page token audit" icon={ScanSearch} defaultOpen={false} disabled={!designSystemConnected} disabledHint={DESIGN_SYSTEM_REQUIRED}><PageTokenAudit colorTokens={colorTokens} onSelect={selectElement} /></ToolSection></>}
              {<ToolSection title={mode === 'comment' ? `Notes · ${comments.length}` : `Designer changes · ${changes.length + comments.length}`} icon={Code2} defaultOpen openWhen={changes.length + comments.length > 0}>{(changes.length || comments.length) ? <>
                <div className="hi-handoff-actions">
                  <CopyButton value={handoffText} label="Copy everything" />
                  {cssDiff && <CopyButton value={cssDiff} label="Copy changed CSS" />}
                  {instructions && <CopyButton value={instructions} label="Copy instructions" />}
                  {commentsReport && <CopyButton value={commentsReport} label="Copy comments" />}
                </div>
                {designChanges.length < changes.length && <p className="hi-empty-note">Showing all {changes.length} edits on this page. {designChanges.length} of them {designChanges.length === 1 ? 'is' : 'are'} on the current selection.</p>}
                <div className="hi-change-log">{changes.map((change, index) => <div key={`${change.selector}-${change.property}-${index}`} className={`${change.instruction ? 'has-instruction' : ''} ${designChanges.includes(change) ? 'is-current' : ''}`}>
                  <span>{change.kind}</span><strong>{change.property}</strong><small><del>{change.before || '—'}</del> → {change.after}</small>
                  <button className="hi-change-selector" title="Select this element" onClick={() => change.element.isConnected && selectElement(change.element)}>{change.selector}</button>
                  {change.instruction && <p className="hi-change-instruction"><Wand2 size={12} /><span>{change.instruction}</span></p>}
                </div>)}</div>
                {cssDiff && <div className="hi-code"><CopyButton value={cssDiff} label="Copy CSS" /><pre>{cssDiff}</pre></div>}
              </> : <p className="hi-empty-note">Edits will appear here as a handoff-ready change log.</p>}</ToolSection>}
            </div>}
        </div>
        <footer className="hi-credit">
          Design editor built by{' '}
          <a href="https://itamar-katan-protfolio.vercel.app/" target="_blank" rel="noopener noreferrer">Itamar Katan</a>
        </footer>
      </aside>
    </>}
  </div>;
}

/**
 * A short-lived confirmation with a way out of it.
 *
 * Some gestures change more than the eye can follow — snapping a whole page onto the system moves
 * thirty values at once. `Reset all` could always undo that, but only if you knew it existed and
 * were willing to lose every other edit with it. This says what happened and offers to take back
 * exactly that, for as long as anyone is plausibly still looking at it.
 */
function InspectorToast({ toast, onDismiss }: {
  toast: { id: number; label: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 9000);
    return () => window.clearTimeout(timer);
    // Keyed by id at the call site, so a new toast restarts the clock rather than inheriting it.
  }, [toast.id, onDismiss]);

  return <div className="hi-toast" role="status">
    <Check size={13} />
    <span>{toast.label}</span>
    <button className="hi-toast-close" aria-label="Dismiss" onClick={onDismiss}><X size={12} /></button>
  </div>;
}

/**
 * The notes, on the page, readable without opening anything.
 *
 * A pin that only says "3" is a promise of information, not information — you still have to click
 * into the panel to find out what the note said, and that is three clicks between a reviewer's
 * remark and a designer understanding it. Hovering a pin peeks at the note; clicking opens the
 * whole thread where it is pinned, with the two actions a thread ever needs.
 */
function CommentPinLayer({ markers, openPath, author, onOpenPath, onSelect, onPost, onOpenInPanel, onToggleResolved, onDelete }: {
  markers: CommentMarker[];
  openPath: string | null;
  /** Who the reply will be signed as, so the bubble can say it before you commit to posting. */
  author: string;
  onOpenPath: (path: string | null) => void;
  onSelect: (path: string) => void;
  onPost: (thread: CommentThread, text: string) => void;
  onOpenInPanel: (path: string) => void;
  onToggleResolved: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [peeked, setPeeked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const leaveTimer = useRef(0);

  // A draft belongs to the thread it was typed into; switching pins must not carry it along.
  useEffect(() => { setDraft(''); }, [openPath]);

  /**
   * Hovering a pin opens its note and *keeps it open* long enough to reach.
   *
   * A preview that vanishes the moment the pointer leaves the pin is a preview you can look at but
   * never touch — you cannot scroll a long note, select a line of it, or click through to the
   * thread. The grace period is the difference between a tooltip and something usable.
   */
  const hold = (path: string) => {
    window.clearTimeout(leaveTimer.current);
    setPeeked(path);
  };

  const release = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setPeeked(null), 260);
  };

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  return <div className="hi-comment-pins">
    {markers.map((marker) => {
      const open = openPath === marker.path;
      const peeking = !open && peeked === marker.path;
      // Bubbles near the right edge would otherwise open off-screen.
      const flip = marker.left > window.innerWidth - 320;
      return <div
        key={marker.path}
        className={`hi-comment-pin-anchor ${flip ? 'is-flipped' : ''}`}
        style={{ top: marker.top, left: marker.left }}
        onMouseEnter={() => hold(marker.path)}
        onMouseLeave={release}
      >
        <button
          className={`hi-comment-pin ${marker.resolved ? 'is-resolved' : ''} ${open ? 'is-open' : ''}`}
          title={marker.resolved ? `Note ${marker.index} · resolved` : `Note ${marker.index} on ${marker.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPath(open ? null : marker.path);
            onSelect(marker.path);
          }}
        >
          {marker.resolved ? <Check size={11} /> : <MessageSquare size={11} />}
          {marker.index}
          {marker.comments.length > 1 && <em>{marker.comments.length}</em>}
        </button>

        {peeking && <div className="hi-comment-peek" onMouseEnter={() => hold(marker.path)} onMouseLeave={release}>
          <header>
            <strong>Note {marker.index}</strong>
            <span>{marker.resolved ? 'Resolved' : marker.label}</span>
          </header>
          {marker.comments.slice(0, 2).map((comment) => <article key={comment.id}>
            <p>{comment.text}</p>
            <small>{comment.author || 'Unsigned'} · {relativeTime(comment.createdAt)}</small>
          </article>)}
          {marker.comments.length > 2 && <small className="hi-comment-peek-more">+{marker.comments.length - 2} more in this thread</small>}
          <button onClick={(event) => { event.stopPropagation(); onOpenPath(marker.path); onSelect(marker.path); }}>
            <MessageSquare size={12} />Open note
          </button>
        </div>}

        {open && <div className="hi-comment-scrim" onClick={() => onOpenPath(null)} />}
        {open && <div className="hi-comment-bubble" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <strong>Note {marker.index}</strong>
            <span title={marker.label}>{marker.label}</span>
            <button title="Close" onClick={() => onOpenPath(null)}><X size={12} /></button>
          </header>
          <div className="hi-comment-bubble-list">
            {marker.comments.map((comment) => <article key={comment.id} className={comment.resolved ? 'is-resolved' : ''}>
              <p>{comment.text}</p>
              <footer>
                <span>{comment.author || 'Unsigned'} · {relativeTime(comment.createdAt)}</span>
                <button
                  title={comment.resolved ? 'Reopen this note' : 'Mark resolved'}
                  aria-pressed={Boolean(comment.resolved)}
                  onClick={() => onToggleResolved(comment.id)}
                ><Check size={12} /></button>
                <button title="Delete this note" onClick={() => onDelete(comment.id)}><Trash2 size={12} /></button>
              </footer>
            </article>)}
          </div>
          {/* Replying where you are reading is the whole point of a thread; being sent to a panel
              on the other side of the screen to type is how a conversation stops happening. */}
          <div className="hi-comment-bubble-composer">
            <textarea
              value={draft}
              rows={2}
              placeholder={`Reply${author ? ` as ${author}` : ''}…`}
              aria-label="Reply to this note"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (draft.trim()) { onPost(marker, draft); setDraft(''); }
                }
              }}
            />
            <div className="hi-comment-bubble-actions">
              <button className="is-quiet" title="Open this thread in the panel" onClick={() => onOpenInPanel(marker.path)}><PanelRight size={12} />Panel</button>
              <button disabled={!draft.trim()} onClick={() => { onPost(marker, draft); setDraft(''); }}>Reply</button>
            </div>
          </div>
        </div>}
      </div>;
    })}
  </div>;
}

/** Shown wherever a feature needs a real design system behind it, rather than detected values. */
const DESIGN_SYSTEM_REQUIRED = 'Connect a design system to use this feature — pass tokens to DesignTokensProvider.';

/**
 * Marks the inspector's own preview frames.
 *
 * Stripping the URL flag stops a nested inspector only for hosts that opt in through the URL;
 * anyone gating with `enabled` would still boot a second copy inside the preview, which then
 * eats the very clicks and keystrokes the preview exists to test. The frame names itself, and
 * the component refuses to mount when it sees that name.
 */
const DESIGN_PREVIEW_FRAME_NAME = 'merakimind-design-preview';

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
  const [insidePreview, setInsidePreview] = useState(false);

  // Read after mount for the same reason as the URL flag: the server has no window to ask.
  useEffect(() => {
    setInsidePreview(typeof window !== 'undefined' && window.name === DESIGN_PREVIEW_FRAME_NAME);
  }, []);

  useEffect(() => {
    if (enabled !== undefined) return;
    const read = () => setUrlEnabled(designModeInUrl());
    read();
    // Client-side navigation can add or drop the flag without a page load.
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [enabled]);

  if (insidePreview) return null;
  if (!(enabled ?? urlEnabled)) return null;
  return <HandoffInspectorPanel />;
}
