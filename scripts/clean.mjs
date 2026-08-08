// Remove the build output. Kept as a script file (rather than `node -e`) so it
// behaves the same on Windows shells and under `"type": "module"`.
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
rmSync(join(root, 'dist'), { recursive: true, force: true });
