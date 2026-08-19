/**
 * Turns whatever a team actually keeps their design system in into the `DesignTokens` shape the
 * inspector needs.
 *
 * In an app, the host imports its own tokens and hands over exactly the right object. An
 * extension has no such luxury: a designer pastes in a file, and it could be the inspector's own
 * shape, a Style Dictionary / DTCG export, a Tokens Studio dump, a Tailwind config, or a flat
 * `{ "colors": { "primary": "#7C3CFF" } }` written by hand. All of those describe the same thing,
 * so all of them are accepted here rather than being turned away for the wrong punctuation.
 */
import type {
  ColorToken,
  DesignSystemCollection,
  DesignTokens,
  RadiusToken,
  SpacingToken,
  TypographyToken,
} from '../../src/types.js';

export type NormalizeResult = {
  tokens: DesignTokens | null;
  /** Human summary of what was recognised, shown in the options page. */
  shape: string;
  /** Anything a designer should know about what was dropped or guessed. */
  warnings: string[];
  counts: { collections: number; colors: number; typography: number; spacing: number; radius: number };
};

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

const COLOR_VALUE = /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|var\(|transparent$|currentcolor$)/i;
const LENGTH_VALUE = /^-?[\d.]+(px|rem|em|%|vw|vh|pt|ch)?$/i;

/** `{ brand: { 500: '#7C3CFF' } }` -> `brand-500`. Tailwind, DTCG and Tokens Studio all nest like this. */
function flatten(value: unknown, prefix: string[], out: Array<{ name: string; value: string }>, depth = 0): void {
  if (depth > 6) return;

  if (typeof value === 'string' || typeof value === 'number') {
    const name = prefix.filter((part) => part && part.toUpperCase() !== 'DEFAULT').join('-') || prefix.join('-');
    if (name) out.push({ name, value: String(value) });
    return;
  }

  if (Array.isArray(value)) {
    // Tailwind writes fontSize as ['1rem', { lineHeight: '1.5' }] — the size is the part we want.
    if (typeof value[0] === 'string') flatten(value[0], prefix, out, depth + 1);
    return;
  }

  if (!isBag(value)) return;

  // A DTCG leaf: { $value, $type } (Tokens Studio drops the `$`).
  const leaf = value.$value ?? value.value;
  if (leaf !== undefined && (typeof leaf === 'string' || typeof leaf === 'number')) {
    flatten(leaf, prefix, out, depth + 1);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || key === 'description' || key === 'type' || key === 'extensions') continue;
    flatten(child, [...prefix, key], out, depth + 1);
  }
}

function pick(source: Bag, ...keys: string[]): unknown {
  for (const key of keys) {
    const hit = Object.keys(source).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (hit !== undefined && source[hit] !== undefined && source[hit] !== null) return source[hit];
  }
  return undefined;
}

/**
 * Guesses what a colour is *for* from its name.
 *
 * The inspector groups swatches by role, and a palette that arrives as a flat list of hexes would
 * otherwise land in one undifferentiated pile. Names are the only signal available, and in
 * practice they are a good one — nobody calls their page background `accent`.
 */
function colorUsage(name: string): string {
  const key = name.toLowerCase();
  if (/(border|outline|divide|stroke|ring)/.test(key)) return 'border';
  if (/(text|fg|foreground|content|ink|body|heading|label)/.test(key)) return 'text';
  if (/(bg|background|surface|canvas|paper|card|elevated|base|neutral|gray|grey|slate|zinc|stone)/.test(key)) return 'surface';
  if (/(accent|primary|brand|action|link|cta|interactive|focus)/.test(key)) return 'accent';
  if (/(success|positive|green|error|danger|negative|red|warning|caution|amber|yellow|info|blue)/.test(key)) return 'status';
  return 'accent';
}

function titleCase(name: string): string {
  return name
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Builds the one-line `css` string a `TypographyToken` carries, from whatever fields are present. */
function typographyCss(source: unknown): string | null {
  if (typeof source === 'string') {
    // Already CSS ("font-size: 24px; font-weight: 600") or a bare font shorthand/size.
    if (source.includes(':')) return source.trim().replace(/;$/, '');
    if (LENGTH_VALUE.test(source.trim())) return `font-size: ${source.trim()}`;
    return `font: ${source.trim()}`;
  }
  if (Array.isArray(source)) {
    const [size, rest] = source;
    const parts: string[] = [];
    if (typeof size === 'string') parts.push(`font-size: ${size}`);
    if (isBag(rest)) {
      const line = pick(rest, 'lineHeight', 'line-height');
      const weight = pick(rest, 'fontWeight', 'font-weight');
      const tracking = pick(rest, 'letterSpacing', 'letter-spacing');
      if (line) parts.push(`line-height: ${line}`);
      if (weight) parts.push(`font-weight: ${weight}`);
      if (tracking) parts.push(`letter-spacing: ${tracking}`);
    }
    return parts.length ? parts.join('; ') : null;
  }
  if (!isBag(source)) return null;

  const nested = source.$value ?? source.value;
  const inner = isBag(nested) ? nested : source;
  const family = pick(inner, 'fontFamily', 'font-family', 'family');
  const size = pick(inner, 'fontSize', 'font-size', 'size');
  const weight = pick(inner, 'fontWeight', 'font-weight', 'weight');
  const line = pick(inner, 'lineHeight', 'line-height', 'leading');
  const tracking = pick(inner, 'letterSpacing', 'letter-spacing', 'tracking');
  const transform = pick(inner, 'textTransform', 'text-transform', 'case');

  const parts: string[] = [];
  if (family) parts.push(`font-family: ${Array.isArray(family) ? family.join(', ') : String(family)}`);
  if (size) parts.push(`font-size: ${typeof size === 'number' ? `${size}px` : String(size)}`);
  if (weight) parts.push(`font-weight: ${String(weight)}`);
  if (line) parts.push(`line-height: ${String(line)}`);
  if (tracking) parts.push(`letter-spacing: ${String(tracking)}`);
  if (transform) parts.push(`text-transform: ${String(transform)}`);
  return parts.length ? parts.join('; ') : null;
}

function toColors(raw: unknown): ColorToken[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw) && raw.every((entry) => isBag(entry))) {
    return (raw as Bag[])
      .map<ColorToken | null>((entry) => {
        const value = pick(entry, 'value', '$value', 'hex', 'color');
        const label = pick(entry, 'label', 'name', 'title', 'id');
        if (typeof value !== 'string') return null;
        const name = typeof label === 'string' ? label : value;
        const usage = pick(entry, 'usage', 'role', 'group');
        return { label: titleCase(name), value, usage: typeof usage === 'string' ? usage : colorUsage(name) };
      })
      .filter((entry): entry is ColorToken => entry !== null);
  }
  const flat: Array<{ name: string; value: string }> = [];
  flatten(raw, [], flat);
  return flat
    .filter(({ value }) => COLOR_VALUE.test(value.trim()))
    .map(({ name, value }) => ({ label: titleCase(name), value: value.trim(), usage: colorUsage(name) }));
}

function toScale(raw: unknown): Array<{ name: string; value: string }> {
  if (raw === undefined) return [];
  if (Array.isArray(raw) && raw.every((entry) => isBag(entry))) {
    return (raw as Bag[])
      .map((entry) => {
        const value = pick(entry, 'value', '$value');
        const name = pick(entry, 'name', 'label', 'id');
        if (value === undefined || value === null) return null;
        return { name: String(name ?? value), value: typeof value === 'number' ? `${value}px` : String(value) };
      })
      .filter((entry): entry is { name: string; value: string } => entry !== null);
  }
  const flat: Array<{ name: string; value: string }> = [];
  flatten(raw, [], flat);
  return flat.filter(({ value }) => LENGTH_VALUE.test(value.trim()) || value.startsWith('calc') || value.startsWith('var'));
}

function toTypography(raw: unknown): TypographyToken[] {
  if (raw === undefined) return [];

  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? (raw as unknown[]).map((entry, index) => {
        const name = isBag(entry) ? pick(entry, 'label', 'name', 'id') : undefined;
        return [typeof name === 'string' ? name : `Style ${index + 1}`, entry];
      })
    : isBag(raw)
      ? Object.entries(raw)
      : [];

  const out: TypographyToken[] = [];
  for (const [name, value] of entries) {
    if (name.startsWith('$')) continue;
    const css = typographyCss(value);
    if (css) {
      const sample = isBag(value) ? pick(value, 'sample', 'preview') : undefined;
      out.push({ label: titleCase(name), sample: typeof sample === 'string' ? sample : titleCase(name), css });
      continue;
    }
    // A group of styles ({ heading: { xl: {...}, lg: {...} } }) — go one level deeper.
    if (isBag(value)) {
      for (const [childName, childValue] of Object.entries(value)) {
        const childCss = typographyCss(childValue);
        if (childCss) {
          out.push({ label: titleCase(`${name} ${childName}`), sample: titleCase(`${name} ${childName}`), css: childCss });
        }
      }
    }
  }
  return out;
}

/** True when the input is already exactly what the inspector wants. */
function isNativeShape(input: Bag): boolean {
  const collections = input.collections;
  return Array.isArray(collections) && collections.some((entry) => isBag(entry) && Array.isArray((entry as Bag).colors));
}

/**
 * Finds the object that actually holds the tokens.
 *
 * Real files wrap them: Tailwind under `theme` (and again under `theme.extend`), Style Dictionary
 * exports under `global`, Figma variable exports under the collection name. Unwrapping first means
 * one set of rules below handles every source.
 */
function unwrap(input: Bag): Bag {
  let current = input;
  for (let depth = 0; depth < 4; depth += 1) {
    const inner = pick(current, 'theme', 'tokens', 'global', 'default', 'core', 'primitives');
    if (isBag(inner) && Object.keys(inner).length) {
      // Tailwind's `extend` sits beside the base theme; merge so both are visible.
      const extend = pick(inner, 'extend');
      current = isBag(extend) ? { ...inner, ...extend } : inner;
      continue;
    }
    break;
  }
  const extend = pick(current, 'extend');
  return isBag(extend) ? { ...current, ...extend } : current;
}

/**
 * Last resort: nothing was named recognisably, so classify every leaf by its value.
 *
 * A Figma variables export names its groups after the design, not after CSS — `Brand/Purple` is a
 * colour and `Layout/Gutter` is a spacing, and only the values say so.
 */
function classifyByValue(input: Bag): { colors: ColorToken[]; spacing: SpacingToken[] } {
  const flat: Array<{ name: string; value: string }> = [];
  flatten(input, [], flat);
  const colors: ColorToken[] = [];
  const spacing: SpacingToken[] = [];
  for (const { name, value } of flat) {
    const trimmed = value.trim();
    if (COLOR_VALUE.test(trimmed)) colors.push({ label: titleCase(name), value: trimmed, usage: colorUsage(name) });
    else if (LENGTH_VALUE.test(trimmed) && /(space|spacing|gap|pad|margin|size|gutter|inset)/i.test(name)) {
      spacing.push({ name, value: trimmed });
    }
  }
  return { colors, spacing };
}

function dedupe<T>(entries: T[], key: (entry: T) => string): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = key(entry);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Parses and normalizes a pasted or fetched design system into `DesignTokens`. */
export function normalizeDesignTokens(input: unknown, fallbackName = 'Design system'): NormalizeResult {
  const empty: NormalizeResult['counts'] = { collections: 0, colors: 0, typography: 0, spacing: 0, radius: 0 };

  let parsed: unknown = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return { tokens: null, shape: 'empty', warnings: [], counts: empty };
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        tokens: null,
        shape: 'invalid',
        warnings: [`That isn't valid JSON: ${(error as Error).message}`],
        counts: empty,
      };
    }
  }

  if (!isBag(parsed)) {
    return { tokens: null, shape: 'invalid', warnings: ['Expected a JSON object at the top level.'], counts: empty };
  }

  const warnings: string[] = [];

  if (isNativeShape(parsed)) {
    const tokens = parsed as unknown as DesignTokens;
    const collections = tokens.collections.map((collection, index) => ({
      id: collection.id ?? `collection-${index + 1}`,
      name: collection.name ?? `Collection ${index + 1}`,
      colors: collection.colors ?? [],
      typography: collection.typography ?? [],
    })) as DesignSystemCollection[];
    return {
      tokens: { collections, spacing: tokens.spacing ?? [], radius: tokens.radius ?? [] },
      shape: 'inspector tokens',
      warnings,
      counts: {
        collections: collections.length,
        colors: collections.reduce((total, collection) => total + collection.colors.length, 0),
        typography: collections.reduce((total, collection) => total + collection.typography.length, 0),
        spacing: tokens.spacing?.length ?? 0,
        radius: tokens.radius?.length ?? 0,
      },
    };
  }

  const source = unwrap(parsed);
  const asText = JSON.stringify(parsed);
  let shape = 'design tokens';
  if (pick(parsed, 'theme') !== undefined) shape = 'Tailwind config';
  else if (asText.includes('"$value"')) shape = 'DTCG / Style Dictionary';
  else if (asText.includes('"$type"')) shape = 'Tokens Studio';

  let colors = dedupe(toColors(pick(source, 'colors', 'color', 'palette', 'fill', 'fills')), (entry) => `${entry.label}:${entry.value}`);
  let spacing = dedupe(toScale(pick(source, 'spacing', 'space', 'spacings', 'size', 'sizes', 'gap')), (entry) => entry.name);
  const radius = dedupe(
    toScale(pick(source, 'radius', 'borderRadius', 'border-radius', 'radii', 'cornerRadius')),
    (entry) => entry.name,
  );
  const typography = dedupe(
    [
      ...toTypography(pick(source, 'typography', 'textStyles', 'text', 'type', 'fonts')),
      ...toTypography(pick(source, 'fontSize', 'font-size', 'fontSizes')),
    ],
    (entry) => entry.label,
  );

  if (!colors.length && !spacing.length && !radius.length && !typography.length) {
    const guessed = classifyByValue(source);
    colors = dedupe(guessed.colors, (entry) => `${entry.label}:${entry.value}`);
    spacing = dedupe(guessed.spacing, (entry) => entry.name);
    if (colors.length || spacing.length) {
      shape = 'unlabelled tokens';
      warnings.push('No `colors` / `spacing` groups were found, so values were classified by what they look like.');
    }
  }

  if (!colors.length && !typography.length && !spacing.length && !radius.length) {
    return {
      tokens: null,
      shape: 'unrecognised',
      warnings: ['Nothing token-shaped was found. Expected colours, typography, spacing or radii — see the examples below.'],
      counts: empty,
    };
  }

  if (!colors.length) warnings.push('No colours were found — the palette will stay detected from the page.');
  if (!typography.length) warnings.push('No text styles were found — typography will stay detected from the page.');

  const named = pick(parsed, 'name', 'title');
  const collectionName = typeof named === 'string' && named.trim() ? named.trim() : fallbackName;

  return {
    tokens: {
      collections: [{ id: 'primary', name: collectionName, colors, typography }],
      spacing: spacing as SpacingToken[],
      radius: radius as RadiusToken[],
    },
    shape,
    warnings,
    counts: {
      collections: 1,
      colors: colors.length,
      typography: typography.length,
      spacing: spacing.length,
      radius: radius.length,
    },
  };
}
