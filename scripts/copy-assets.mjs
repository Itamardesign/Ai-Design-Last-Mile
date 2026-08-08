// tsc only emits .js/.d.ts — copy the plain CSS asset into dist alongside it so the
// "./design-tools.css" export path in package.json resolves after a build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'design-tools.css');
const to = join(root, 'dist', 'design-tools.css');

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log('copied design-tools.css -> dist/design-tools.css');
