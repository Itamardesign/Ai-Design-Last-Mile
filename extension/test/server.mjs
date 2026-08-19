/**
 * Serves the extension folder over http so the harness page can load the real bundle.
 *
 * `file://` will not do: the harness pulls in `../dist/content.js`, and the whole point is to run
 * the actual built content script rather than a copy of it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT ?? 5177);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

/**
 * A `chrome` good enough to render the popup and the settings page outside an extension.
 *
 * Both pages are plain DOM over `chrome.storage`, so a fake storage area and a couple of stub
 * tabs are the whole surface — enough to look at them, click through them, and see a connected
 * system appear.
 */
const CHROME_SHIM = `<script>
  const store = { settings: undefined };
  const noop = async () => undefined;
  window.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
      onChanged: { addListener: noop },
    },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/pricing' }] },
    runtime: {
      sendMessage: async (message) =>
        message.type === 'state' || message.type === 'toggle'
          ? {
              tabId: 1,
              origin: 'https://example.com',
              active: message.type === 'toggle',
              systemName: null,
              systemId: '__detect__',
              autoStart: false,
              relaxCsp: true,
            }
          : { ok: true },
      openOptionsPage: noop,
    },
    commands: { getAll: async () => [{ name: 'toggle-inspector', shortcut: 'Alt+Shift+D' }] },
  };
</script>`;

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);

  // /preview/options and /preview/popup serve the built pages with the shim in front of them.
  const preview = /^\/preview\/(options|popup)$/.exec(path);
  if (preview) {
    const page = await readFile(join(root, 'dist', `${preview[1]}.html`), 'utf8');
    response.writeHead(200, { 'content-type': TYPES['.html'] });
    response.end(
      page
        // The pages live at the root of the packed extension; here they are served out of dist/.
        .replaceAll('href="ui.css"', 'href="/dist/ui.css"')
        .replaceAll(/src="(\w+\.js)"/g, 'src="/dist/$1"')
        .replace(/<script src=/, `${CHROME_SHIM}<script src=`),
    );
    return;
  }

  const target = join(root, normalize(path === '/' ? '/test/harness.html' : path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(target);
    // Open to any origin: the harness is also used to drop the built bundle onto a real site, to
    // check the inspector against markup nobody wrote for it.
    response.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  }
}).listen(port, () => console.log(`harness on http://localhost:${port}/`));
