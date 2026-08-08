// Runs automatically on `npm install`, on `npm pack`/`npm publish`, and — critically —
// when someone installs this package straight from GitHub. `dist/` is not committed,
// so without this hook a git install would produce a package whose "main" points at a
// file that does not exist, and every import would fail at runtime.
//
// Registry tarballs already ship a built `dist/` and contain no `src/`, so in that case
// there is nothing to do.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(root, 'src'))) {
  console.log('[design-inspector] no src/ — using the prebuilt dist/, skipping build.');
  process.exit(0);
}

execSync('npm run build', { cwd: root, stdio: 'inherit' });
