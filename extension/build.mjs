/**
 * Bundles the extension into extension/dist/ — the folder you load in chrome://extensions.
 *
 * The inspector's own source is compiled straight from ../src, not from the published package, so
 * the extension and the React component never drift: one edit to HandoffInspector.tsx changes both.
 *
 * Run with `node extension/build.mjs [--watch]`.
 */
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const outdir = join(here, 'dist');
const watch = process.argv.includes('--watch');

/**
 * Points the inspector's `fontCatalog` import at the extension's copy.
 *
 * The only difference is how Google previews are loaded — a `<link>` works in an app and is refused
 * by a strict site's CSP — and rewriting the import here keeps that difference out of the shared
 * component entirely.
 */
const fontCatalogForExtension = {
  name: 'font-catalog-for-extension',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /(^|\/)fontCatalog\.js$/ }, (args) => {
      if (!args.importer.includes('HandoffInspector')) return null;
      return { path: join(here, 'src', 'fontCatalogExt.ts') };
    });
  },
};

const shared = {
  bundle: true,
  format: 'iife',
  target: ['chrome116'],
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  plugins: [fontCatalogForExtension],
  outdir,
};

/** Regenerates src/generated/designToolsCss.ts, which the content script imports as a string. */
function generateStyles() {
  execFileSync(process.execPath, [join(packageRoot, 'scripts', 'gen-styles.mjs')], { stdio: 'inherit' });
}

/** Writes the icons if they are missing, so a fresh clone builds a loadable extension. */
async function ensureIcons() {
  const iconDir = join(here, 'icons');
  const expected = [16, 32, 48, 128].map((size) => join(iconDir, `${size}.png`));
  const missing = await Promise.all(expected.map((path) => readFile(path).then(() => false).catch(() => true)));
  if (missing.some(Boolean)) execFileSync(process.execPath, [join(here, 'make-icons.mjs')], { stdio: 'inherit' });
  await cp(iconDir, join(outdir, 'icons'), { recursive: true });
}

async function copyStatic() {
  const files = ['manifest.json'];
  await Promise.all(files.map((file) => cp(join(here, file), join(outdir, file))));
  await Promise.all(
    ['popup.html', 'options.html', 'ui.css'].map((file) => cp(join(here, 'src', file), join(outdir, file))),
  );
  // Stamp the extension version from the package, so there is one version number to bump.
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const manifestPath = join(outdir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const entryPoints = {
  content: join(here, 'src', 'content.tsx'),
  background: join(here, 'src', 'background.ts'),
  popup: join(here, 'src', 'popup.ts'),
  options: join(here, 'src', 'options.ts'),
};

generateStyles();
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await ensureIcons();
await copyStatic();

if (watch) {
  const builder = await context({ ...shared, entryPoints });
  await builder.watch();
  console.log(`watching — load ${resolve(outdir)} in chrome://extensions`);
} else {
  await build({ ...shared, entryPoints });
  console.log(`built — load ${resolve(outdir)} in chrome://extensions`);
}
