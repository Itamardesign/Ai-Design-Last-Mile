import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
await mkdir(out, { recursive: true });
await copyFile(path.join(here, 'index.html'), path.join(out, 'index.html'));
await copyFile(path.join(here, 'src', 'styles.css'), path.join(out, 'styles.css'));

const ctx = await context({
  entryPoints: { app: path.join(here, 'src', 'main.tsx') },
  bundle: true,
  sourcemap: true,
  outdir: out,
  loader: { '.png': 'file', '.jpg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  jsx: 'automatic',
});
await ctx.watch();

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.map':'application/json' };
createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    let file = path.resolve(out, safe);
    if (!file.startsWith(path.resolve(out))) throw new Error('invalid path');
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = path.join(out, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('Pixel Poke landing page: http://127.0.0.1:4173'));
