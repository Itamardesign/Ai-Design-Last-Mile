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
  const store = { settings: undefined, account: { mode: 'undecided', profile: null } };
  // ?demo fills the hub the way a week of use would, so its layout can be judged with content in it.
  if (new URLSearchParams(location.search).has('demo')) {
    const now = Date.now();
    store.settings = {
      version: 1,
      defaultSystemId: 'sys-acme',
      siteSystems: { 'https://app.acme.com': 'sys-acme', 'https://staging.acme.com': '__detect__' },
      autoOrigins: ['https://staging.acme.com'],
      relaxCsp: true,
      systems: [{
        id: 'sys-acme', name: 'Acme product system', source: 'paste', raw: '{}', shape: 'plain', warnings: [],
        counts: { colors: 14, typography: 6, spacing: 8, radius: 3 }, updatedAt: now - 864e5 * 3,
        tokens: { collections: [{ id: 'p', name: 'Product', colors: ['#0d99ff','#0b6fc2','#1e1e1e','#6e6e6e','#f5f3ee','#ff5511','#12a150','#e5484d','#ffd266','#7c3cff'].map(function (value, i) { return { label: 'c' + i, value: value }; }), typography: [] }], spacing: [], radius: [] },
      }],
    };
    store.notes = {
      'https://app.acme.com/pricing': { url: 'https://app.acme.com/pricing', title: 'Pricing — Acme', savedAt: now - 36e5,
        notes: [{ id: '1', path: '', selector: 'h1', label: 'note 1', text: 'Headline wraps on 1280 — tighten tracking', createdAt: new Date(now - 36e5).toISOString(), author: 'Itamar' },
                { id: '2', path: '', selector: '.cta', label: 'note 2', text: 'CTA should be brand/500, not the old purple', createdAt: new Date(now - 30e5).toISOString(), resolved: true }] },
      'https://app.acme.com/': { url: 'https://app.acme.com/', title: 'Acme — Home', savedAt: now - 864e5,
        notes: [{ id: '3', path: '', selector: 'nav', label: 'note 1', text: 'Nav height 64 → 56 to match the system', createdAt: new Date(now - 864e5).toISOString() }] },
    };
    store.handoffs = [
      { id: 'h1', workspaceId: 'w', url: 'https://app.acme.com/pricing', title: 'Pricing — Acme', author: 'Itamar', changeCount: 12, noteCount: 2, issueCount: 1, savedAt: now - 2 * 36e5, markdown: '# Pricing', screenshotUrl: null },
      { id: 'h2', workspaceId: 'w', url: 'https://app.acme.com/', title: 'Acme — Home', author: 'Itamar', changeCount: 4, noteCount: 1, issueCount: 0, savedAt: now - 3 * 864e5, markdown: '# Home', screenshotUrl: null },
    ];
    store.account = { mode: 'cloud', profile: { uid: 'u', name: 'Itamar', email: 'itamar@acme.com', photo: null }, syncedAt: now - 6e4 };
  }
  const noop = async () => undefined;
  const tabState = (active) => ({
    tabId: 1,
    origin: 'https://example.com',
    active,
    systemName: null,
    systemId: '__detect__',
    autoStart: false,
    relaxCsp: true,
  });
  /*
   * The account, as far as a browser tab can model it.
   *
   * Skip is the whole flow and works here. Signing in cannot: it needs chrome.identity and a real
   * OAuth client, so it answers with the same message a build that has not been set up yet would give
   * — which is the state most people looking at this page will actually be in.
   */
  const account = async (message) => {
    if (message.type === 'account:skip') store.account = { mode: 'local', profile: null };
    if (message.type === 'account:signOut') store.account = { mode: 'local', profile: null };
    if (message.type === 'account:signIn') {
      store.account = {
        ...store.account,
        error: 'Google sign-in needs the real extension: this preview has no chrome.identity.',
      };
    }
    return store.account;
  };
  window.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
      onChanged: { addListener: noop },
    },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/pricing' }], create: noop },
    runtime: {
      id: 'harness',
      sendMessage: async (message) => {
        if (message.type === 'state' || message.type === 'toggle') return tabState(message.type === 'toggle');
        if (message.type.startsWith('account')) return account(message);
        if (message.type === 'handoffs') return { handoffs: store.handoffs ?? [] };
        return { ok: true };
      },
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
        .replaceAll(/href="(\w+\.css)"/g, 'href="/dist/$1"')
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
