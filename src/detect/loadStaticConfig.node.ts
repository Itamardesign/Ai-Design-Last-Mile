/**
 * Node-only. Not imported by the browser bundle (entry point is `index.ts`, which never
 * pulls this file in) — run it from a small setup script or CLI in the *consuming* project
 * to generate a tokens file once, rather than re-parsing config on every page load.
 *
 * Detection order:
 *   1. design-tokens.json / tokens.json (W3C-ish {name, value} shape)
 *   2. tailwind.config.{js,ts,cjs,mjs} (theme.colors / theme.spacing / theme.borderRadius)
 *   3. null — caller should fall back to live-CSS detection or the audit generator at runtime
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { ColorToken, DesignTokens, RadiusToken, SpacingToken } from '../types';

function fromTokensJson(path: string): DesignTokens | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf-8'));

  const colors: ColorToken[] = Object.entries(raw.colors ?? raw.color ?? {}).map(([label, value]) => ({
    label,
    value: String(value),
  }));
  const spacing: SpacingToken[] = Object.entries(raw.spacing ?? raw.space ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  const radius: RadiusToken[] = Object.entries(raw.radius ?? raw.borderRadius ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
  }));

  if (colors.length === 0 && spacing.length === 0 && radius.length === 0) return null;

  return {
    collections: [{ id: 'static-tokens-json', name: 'Detected tokens.json', colors, typography: [] }],
    spacing,
    radius,
  };
}

function flattenTailwindScale(scale: unknown, prefix = ''): { name: string; value: string }[] {
  if (!scale || typeof scale !== 'object') return [];
  const out: { name: string; value: string }[] = [];
  for (const [key, value] of Object.entries(scale as Record<string, unknown>)) {
    const name = prefix ? `${prefix}-${key}` : key;
    if (typeof value === 'string') out.push({ name, value });
    else if (typeof value === 'object' && value !== null) out.push(...flattenTailwindScale(value, name));
  }
  return out;
}

async function fromTailwindConfig(projectRoot: string): Promise<DesignTokens | null> {
  const candidates = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'];
  const found = candidates.map((f) => join(projectRoot, f)).find(existsSync);
  if (!found) return null;

  // Only .js/.cjs/.mjs are directly importable at runtime without a TS loader; .ts configs
  // should be pre-parsed by the consuming project's own tooling and passed via tokens.json instead.
  if (found.endsWith('.ts')) return null;

  const mod = await import(pathToFileURL(found).href);
  const config = mod.default ?? mod;
  const theme = config.theme?.extend ?? config.theme ?? {};

  const colors = flattenTailwindScale(theme.colors).map(({ name, value }) => ({ label: name, value }));
  const spacing = flattenTailwindScale(theme.spacing);
  const radius = flattenTailwindScale(theme.borderRadius);

  if (colors.length === 0 && spacing.length === 0 && radius.length === 0) return null;

  return {
    collections: [{ id: 'static-tailwind', name: 'Detected tailwind.config', colors, typography: [] }],
    spacing,
    radius,
  };
}

/** Try each known config format in order; returns null if none of them exist or parse. */
export async function loadStaticDesignTokens(projectRoot: string = process.cwd()): Promise<DesignTokens | null> {
  return (
    fromTokensJson(join(projectRoot, 'design-tokens.json')) ??
    fromTokensJson(join(projectRoot, 'tokens.json')) ??
    (await fromTailwindConfig(projectRoot))
  );
}
