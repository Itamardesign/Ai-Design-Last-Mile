/**
 * Checks that the four shapes a real design system arrives in all come out as usable tokens.
 *
 * Run with `node extension/test/tokens.test.mjs` (it bundles the module under test itself, so there
 * is no build step to remember).
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'inspector-tokens-')), 'tokens.mjs');

const bundled = await build({
  entryPoints: [join(here, '..', 'src', 'tokens.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
writeFileSync(out, bundled.outputFiles[0].text, 'utf8');
const { normalizeDesignTokens } = await import(pathToFileURL(out).href);

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

check('plain hand-written tokens', () => {
  const result = normalizeDesignTokens({
    name: 'Acme',
    colors: { 'brand-500': '#7C3CFF', 'text-body': '#172033', surface: '#F6F8FF', 'border-subtle': '#E5E5E8' },
    spacing: { sm: '8px', md: '16px' },
    radius: { card: '12px' },
    typography: { h1: { fontSize: '32px', fontWeight: 600 } },
  });
  assert.equal(result.tokens.collections[0].name, 'Acme');
  assert.equal(result.counts.colors, 4);
  assert.equal(result.counts.spacing, 2);
  assert.equal(result.counts.radius, 1);
  assert.equal(result.tokens.collections[0].typography[0].css, 'font-size: 32px; font-weight: 600');
  const roles = result.tokens.collections[0].colors.map((color) => color.usage);
  assert.deepEqual(roles, ['accent', 'text', 'surface', 'border']);
});

check('DTCG / Style Dictionary $value', () => {
  const result = normalizeDesignTokens({
    color: { brand: { 500: { $value: '#7C3CFF', $type: 'color' }, 600: { $value: '#6D31D8', $type: 'color' } } },
    spacing: { md: { $value: '16px', $type: 'dimension' } },
  });
  assert.equal(result.shape, 'DTCG / Style Dictionary');
  assert.equal(result.counts.colors, 2);
  assert.equal(result.tokens.collections[0].colors[0].label, 'Brand 500');
  assert.equal(result.counts.spacing, 1);
});

check('Tailwind config, including extend and array fontSize', () => {
  const result = normalizeDesignTokens({
    theme: {
      colors: { white: '#ffffff' },
      extend: {
        colors: { brand: { 500: '#7C3CFF', DEFAULT: '#7C3CFF' } },
        borderRadius: { card: '12px' },
        fontSize: { xl: ['24px', { lineHeight: '1.3' }] },
      },
    },
  });
  assert.equal(result.shape, 'Tailwind config');
  assert.ok(result.counts.colors >= 2);
  assert.equal(result.counts.radius, 1);
  assert.equal(result.tokens.collections[0].typography[0].css, 'font-size: 24px; line-height: 1.3');
  // `DEFAULT` is Tailwind's "the group itself" key and must not appear in the name.
  assert.ok(result.tokens.collections[0].colors.some((color) => color.label === 'Brand'));
});

check('inspector tokens pass through untouched', () => {
  const native = {
    collections: [
      {
        id: 'product',
        name: 'Product',
        colors: [{ label: 'Brand', value: '#7C3CFF', usage: 'accent' }],
        typography: [{ label: 'H1', sample: 'Heading', css: 'font-size: 32px' }],
      },
      { id: 'marketing', name: 'Marketing', colors: [], typography: [] },
    ],
    spacing: [{ name: 'md', value: '16px' }],
    radius: [{ name: 'card', value: '12px' }],
  };
  const result = normalizeDesignTokens(native);
  assert.equal(result.shape, 'inspector tokens');
  assert.equal(result.counts.collections, 2);
  assert.deepEqual(result.tokens.collections[0].colors, native.collections[0].colors);
});

check('a JSON string is parsed', () => {
  const result = normalizeDesignTokens('{"colors":{"brand":"#7C3CFF"}}');
  assert.equal(result.counts.colors, 1);
});

check('unlabelled Figma-style export is classified by value', () => {
  const result = normalizeDesignTokens({
    Brand: { Purple: '#7C3CFF', Ink: '#172033' },
    Layout: { Gutter: '24px' },
  });
  assert.equal(result.shape, 'unlabelled tokens');
  assert.equal(result.counts.colors, 2);
  assert.equal(result.counts.spacing, 1);
});

check('broken JSON reports why, and yields nothing', () => {
  const result = normalizeDesignTokens('{ nope');
  assert.equal(result.tokens, null);
  assert.equal(result.shape, 'invalid');
  assert.ok(result.warnings[0].length > 0);
});

check('a file with no tokens in it is refused', () => {
  const result = normalizeDesignTokens({ build: { target: 'es2020' }, plugins: ['react'] });
  assert.equal(result.tokens, null);
  assert.equal(result.shape, 'unrecognised');
});

check('rgb / hsl / oklch / var values all count as colours', () => {
  const result = normalizeDesignTokens({
    colors: {
      a: 'rgb(124 60 255)',
      b: 'hsl(262 83% 62%)',
      c: 'oklch(0.6 0.2 290)',
      d: 'var(--brand)',
      e: 'not-a-colour',
    },
  });
  assert.equal(result.counts.colors, 4);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
