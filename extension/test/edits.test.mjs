/**
 * The edits mirror: an unfinished style pass is as unrecreatable as a note, and it lives in storage
 * that belongs to somebody else's site.
 *
 * The cases here are the three that lose work: a save that never reaches extension storage, a page
 * whose site wiped its `localStorage` between visits, and a reset that leaves a stale session behind
 * to be offered back later.
 *
 * Run with `node extension/test/edits.test.mjs`.
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

const SESSION_CHANGE_EVENT = 'meraki-inspector-session-change';
const PAGE_KEY = 'meraki-inspector-session:/pricing';
const MIRROR_KEY = 'https://acme.test/pricing';

/** A page: its own localStorage, a document title, and the extension storage behind it. */
function makeWorld({ local = {}, extension = {} } = {}) {
  const store = { ...extension };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (patch) => Object.assign(store, patch),
      },
    },
  };
  const localStore = { ...local };
  globalThis.window = {
    location: { origin: 'https://acme.test', pathname: '/pricing/', href: 'https://acme.test/pricing/' },
    localStorage: {
      getItem: (key) => localStore[key] ?? null,
      setItem: (key, value) => { localStore[key] = value; },
    },
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener(type) { delete this.listeners[type]; },
  };
  globalThis.document = { title: 'Pricing — Acme' };
  globalThis.CustomEvent = class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  return { store, localStore };
}

/** What the inspector announces when it saves: `savedAt` is an ISO string on the way in. */
const session = (savedAt, after) => ({
  savedAt,
  variables: [['--brand', '#7C3CFF']],
  changes: [
    {
      path: 'html > body:nth-child(2) > main:nth-child(1) > button:nth-child(1)',
      selector: 'button.cta',
      property: 'padding',
      before: '12px 20px',
      after,
      kind: 'css',
    },
  ],
});

const out = join(mkdtempSync(join(tmpdir(), 'inspector-edits-')), 'edits.mjs');
const bundled = await build({
  entryPoints: [join(here, '..', 'src', 'edits.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
writeFileSync(out, bundled.outputFiles[0].text, 'utf8');
const { startEditMirror, readAllEdits, editKeyFor } = await import(pathToFileURL(out).href);

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

/** Hands the mirror the event the inspector dispatches, and waits for its write. */
async function announce(world, detail) {
  globalThis.window.listeners[SESSION_CHANGE_EVENT]({ type: SESSION_CHANGE_EVENT, detail });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

await check('a page key spans sites, unlike the inspector’s own', () => {
  // The inspector keys a session by path alone, so two sites with a /pricing page would share one
  // entry in a mirror that spans every site. The origin is what keeps them apart.
  assert.equal(editKeyFor({ origin: 'https://acme.test', pathname: '/pricing/' }), MIRROR_KEY);
  assert.equal(editKeyFor({ origin: 'https://other.test', pathname: '/pricing' }), 'https://other.test/pricing');
  assert.equal(editKeyFor({ origin: 'https://acme.test', pathname: '/' }), 'https://acme.test/');
});

await check('an announced save is copied into extension storage', async () => {
  const world = makeWorld();
  const mirror = startEditMirror();
  await mirror.ready;
  await announce(world, { session: session('2026-08-19T09:00:00.000Z', '24px') });

  const page = (await readAllEdits())[MIRROR_KEY];
  assert.equal(page.changes[0].after, '24px');
  assert.equal(page.url, 'https://acme.test/pricing/');
  assert.equal(page.title, 'Pricing — Acme');
  assert.equal(page.savedAt, Date.parse('2026-08-19T09:00:00.000Z'), 'the ISO stamp becomes a number the merge can compare');
  assert.deepEqual(page.variables, [['--brand', '#7C3CFF']], 'token edits ride along, or a restore puts back the wrong colours');
});

await check('edits the site threw away are restored from the mirror', async () => {
  const world = makeWorld({
    extension: {
      edits: {
        [MIRROR_KEY]: { url: 'https://acme.test/pricing/', title: 'Pricing — Acme', savedAt: 1_700_000_000_000, variables: [], changes: session('x', '32px').changes },
      },
    },
  });
  const mirror = startEditMirror();
  await mirror.ready;

  const restored = JSON.parse(world.localStore[PAGE_KEY]);
  assert.equal(restored.changes[0].after, '32px');
  assert.equal(restored.savedAt, new Date(1_700_000_000_000).toISOString(), 'the inspector reads an ISO stamp back');
});

await check('a session already on the page wins over the mirror', async () => {
  const world = makeWorld({
    local: { [PAGE_KEY]: JSON.stringify(session('2026-08-19T10:00:00.000Z', '40px')) },
    extension: {
      edits: {
        [MIRROR_KEY]: { url: 'u', title: 't', savedAt: 1, variables: [], changes: session('x', '8px').changes },
      },
    },
  });
  const mirror = startEditMirror();
  await mirror.ready;

  assert.equal(JSON.parse(world.localStore[PAGE_KEY]).changes[0].after, '40px', 'the page is the source of truth while it has one');
  assert.equal((await readAllEdits())[MIRROR_KEY].changes[0].after, '40px', 'and the mirror is corrected to match it');
});

await check('resetting everything clears the mirror too', async () => {
  const world = makeWorld();
  const mirror = startEditMirror();
  await mirror.ready;
  await announce(world, { session: session('2026-08-19T09:00:00.000Z', '24px') });
  assert.ok((await readAllEdits())[MIRROR_KEY], 'saved first');

  // What the inspector announces when the change log goes empty.
  await announce(world, { session: null });
  assert.equal((await readAllEdits())[MIRROR_KEY], undefined, 'a page with nothing to restore must not be offered a restore');
});

await check('a second injection does not leave two listeners on the same key', async () => {
  const world = makeWorld();
  const first = startEditMirror();
  await first.ready;
  first.stop();
  assert.equal(globalThis.window.listeners[SESSION_CHANGE_EVENT], undefined);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
