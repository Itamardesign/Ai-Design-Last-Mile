import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
await mkdir(out, { recursive: true });
await mkdir(path.join(out, 'assets'), { recursive: true });

await build({
  entryPoints: { app: path.join(here, 'src', 'main.tsx') },
  bundle: true,
  minify: true,
  sourcemap: true,
  outdir: out,
  loader: { '.png': 'file', '.jpg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  jsx: 'automatic',
});

await copyFile(path.join(here, 'index.html'), path.join(out, 'index.html'));
await copyFile(path.join(here, 'src', 'styles.css'), path.join(out, 'styles.css'));
