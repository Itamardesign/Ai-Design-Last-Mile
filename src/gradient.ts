/**
 * The gradient behind the gradient builder — the Figma model, on CSS.
 *
 * A gradient here is a type, an angle and a row of stops, each stop a colour with its own
 * opacity and a place along the bar. Pure string work: nothing reads the document, so it is
 * testable and the same maths reads a computed `background-image` back and writes one out.
 */

export type GradientType = 'linear' | 'radial' | 'conic';

export type GradientStop = {
  /** Six-digit lowercase hex; opacity is kept apart so it can be edited on its own. */
  color: string;
  /** 0–100. */
  alpha: number;
  /** 0–100, where along the bar the stop sits. */
  position: number;
};

export type Gradient = {
  type: GradientType;
  /** Degrees, CSS convention: 0 points up, 90 to the right. Ignored by radial gradients. */
  angle: number;
  /** In CSS order — not sorted, so a stop keeps its identity while it is dragged past another. */
  stops: GradientStop[];
};

/** Resolves any CSS colour to `#rrggbb` or `#rrggbbaa`; hex and rgb() are handled without one. */
export type ColorResolver = (value: string) => string | null;

const DIRECTIONS: Record<string, number> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** Splits on commas that are not inside parentheses. */
export function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === separator && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Hex in any length, or rgb()/rgba() — the forms a computed style and a preset produce. */
function resolveBasicColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'transparent') return '#00000000';
  const hex = trimmed.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const digits = hex[1];
    return `#${digits.length <= 4 ? digits.split('').map((d) => d + d).join('') : digits}`;
  }
  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (!rgb) return null;
  const channel = (part: string) => clamp(Math.round(Number(part)), 0, 255).toString(16).padStart(2, '0');
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}${alpha >= 1 ? '' : Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0')}`;
}

/** Splits `#rrggbb[aa]` into the builder's colour and percentage opacity. */
export function splitHexAlpha(hex: string): { color: string; alpha: number } {
  const lower = hex.toLowerCase();
  return { color: lower.slice(0, 7), alpha: lower.length === 9 ? Math.round((Number.parseInt(lower.slice(7, 9), 16) / 255) * 100) : 100 };
}

/** The stop's colour, and its opacity, as one CSS colour. */
export function stopColor(stop: GradientStop): string {
  const alpha = clamp(Math.round(stop.alpha), 0, 100);
  return alpha >= 100 ? stop.color : `${stop.color}${Math.round((alpha / 100) * 255).toString(16).padStart(2, '0')}`;
}

/**
 * Reads a single `linear-`, `radial-` or `conic-gradient()` back into the model. Anything else —
 * a picture, a repeating gradient, a stack of layers, `none` — is not the builder's to edit.
 */
export function parseGradient(image: string, resolve: ColorResolver = resolveBasicColor): Gradient | null {
  const match = image.trim().match(/^(linear|radial|conic)-gradient\((.*)\)$/is);
  // One layer only: a gradient stacked over a picture would swallow the picture here.
  if (!match || splitTopLevel(image).length !== 1) return null;
  const type = match[1] as GradientType;
  const parts = splitTopLevel(match[2]);
  const readStop = (part: string) => {
    const head = part.match(/^(#[0-9a-f]{3,8}|[a-z]+\([^)]*\)|[a-z]+)\s*(.*)$/i);
    if (!head) return null;
    const hex = resolveBasicColor(head[1]) ?? resolve(head[1]);
    if (!hex || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
    const percent = head[2].match(/(-?[\d.]+)%/);
    return { ...splitHexAlpha(hex), position: percent ? Number(percent[1]) : Number.NaN };
  };

  let angle = type === 'linear' ? 180 : 0;
  const first = parts[0] ? readStop(parts[0]) : null;
  if (parts.length && !first) {
    // The first argument is a direction or shape rather than a stop.
    const head = parts[0].toLowerCase();
    const degrees = head.match(/(-?[\d.]+)deg/);
    const turns = head.match(/(-?[\d.]+)turn/);
    const direction = head.match(/to\s+[a-z ]+/)?.[0].replace(/\s+/g, ' ').trim();
    if (degrees) angle = Number(degrees[1]);
    else if (turns) angle = Number(turns[1]) * 360;
    else if (direction && DIRECTIONS[direction] !== undefined) angle = DIRECTIONS[direction];
    parts.shift();
  }

  const stops = parts.map(readStop);
  if (stops.length < 2 || stops.some((stop) => !stop)) return null;
  const resolved = stops as Array<{ color: string; alpha: number; position: number }>;

  // Missing positions spread evenly between the neighbours that have one, as CSS does.
  if (Number.isNaN(resolved[0].position)) resolved[0].position = 0;
  if (Number.isNaN(resolved[resolved.length - 1].position)) resolved[resolved.length - 1].position = 100;
  for (let index = 1; index < resolved.length - 1; index += 1) {
    if (!Number.isNaN(resolved[index].position)) continue;
    let end = index + 1;
    while (Number.isNaN(resolved[end].position)) end += 1;
    const from = resolved[index - 1].position;
    const to = resolved[end].position;
    const span = end - index + 1;
    for (let fill = index; fill < end; fill += 1) resolved[fill].position = from + ((to - from) * (fill - index + 1)) / span;
  }

  return {
    type,
    angle: round(((angle % 360) + 360) % 360),
    stops: resolved.map((stop) => ({ color: stop.color, alpha: stop.alpha, position: round(clamp(stop.position, 0, 100)) })),
  };
}

/** The model as a `background-image` value. */
export function serializeGradient(gradient: Gradient): string {
  const stops = gradient.stops.map((stop) => `${stopColor(stop)} ${round(stop.position)}%`).join(', ');
  if (gradient.type === 'radial') return `radial-gradient(circle at center, ${stops})`;
  if (gradient.type === 'conic') return `conic-gradient(from ${round(gradient.angle)}deg at center, ${stops})`;
  return `linear-gradient(${round(gradient.angle)}deg, ${stops})`;
}

/** The same stops laid left to right, for drawing the bar the handles sit on. */
export function gradientBar(gradient: Gradient): string {
  return serializeGradient({ type: 'linear', angle: 90, stops: gradient.stops });
}

/** The colour the gradient shows at a point along the bar — what a stop added there should start as. */
export function sampleGradient(gradient: Gradient, position: number): { color: string; alpha: number } {
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
  if (position <= sorted[0].position) return { color: sorted[0].color, alpha: sorted[0].alpha };
  const last = sorted[sorted.length - 1];
  if (position >= last.position) return { color: last.color, alpha: last.alpha };
  const after = sorted.findIndex((stop) => stop.position >= position);
  const before = sorted[after - 1];
  const next = sorted[after];
  const t = next.position === before.position ? 0 : (position - before.position) / (next.position - before.position);
  const channel = (offset: number) => {
    const a = Number.parseInt(before.color.slice(offset, offset + 2), 16);
    const b = Number.parseInt(next.color.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
  };
  return { color: `#${channel(1)}${channel(3)}${channel(5)}`, alpha: Math.round(before.alpha + (next.alpha - before.alpha) * t) };
}

/** Flips the bar end for end, keeping the same look from the other side. */
export function reverseGradient(gradient: Gradient): Gradient {
  return { ...gradient, stops: gradient.stops.map((stop) => ({ ...stop, position: round(100 - stop.position) })).reverse() };
}

/** A two-stop starting gradient: the fill colour into its own transparent, or into a partner. */
export function defaultGradient(fromColor: string, resolve: ColorResolver = resolveBasicColor): Gradient {
  const hex = resolveBasicColor(fromColor) ?? resolve(fromColor) ?? '#9373ee';
  const { color } = splitHexAlpha(hex);
  return {
    type: 'linear',
    angle: 180,
    stops: [
      { color, alpha: 100, position: 0 },
      { color, alpha: 0, position: 100 },
    ],
  };
}
