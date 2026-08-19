/**
 * The note mirror is the one part of the extension holding work a person cannot recreate, so it gets
 * its own tests: notes survive the site clearing its storage, resolved notes stop counting, and a
 * review comes out as something you can paste into a ticket.
 *
 * Run with `node extension/test/notes.test.mjs`.
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

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
  return { store, localStore };
}

const note = (id, text, resolved) => ({
  id,
  path: 'html > body:nth-child(2) > main:nth-child(1)',
  selector: 'main',
  label: 'Section',
  text,
  createdAt: '2026-08-18T09:00:00.000Z',
  author: 'Itamar',
  resolved,
});

const out = join(mkdtempSync(join(tmpdir(), 'inspector-notes-')), 'notes.mjs');
const bundled = await build({
  entryPoints: [join(here, '..', 'src', 'notes.ts')],
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
writeFileSync(out, bundled.outputFiles[0].text, 'utf8');
const { startNoteMirror, notesAsMarkdown, openNoteCount, readAllNotes } = await import(pathToFileURL(out).href);

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

await check('notes on the page are copied into extension storage', async () => {
  const world = makeWorld({ local: { 'meraki-inspector-comments:/pricing': JSON.stringify([note('a', 'Too tight')]) } });
  let counted = -1;
  const mirror = startNoteMirror((open) => { counted = open; });
  await mirror.ready;
  const pages = await readAllNotes();
  assert.deepEqual(Object.keys(pages), ['https://acme.test/pricing']);
  assert.equal(pages['https://acme.test/pricing'].notes.length, 1);
  assert.equal(pages['https://acme.test/pricing'].title, 'Pricing — Acme');
  assert.equal(counted, 1);
  mirror.stop();
});

await check('a site that cleared its storage gets its notes back', async () => {
  const world = makeWorld({
    extension: {
      notes: {
        'https://acme.test/pricing': {
          url: 'https://acme.test/pricing/',
          title: 'Pricing — Acme',
          savedAt: Date.now(),
          notes: [note('a', 'Restore me'), note('b', 'And me', true)],
        },
      },
    },
  });
  let counted = -1;
  const mirror = startNoteMirror((open) => { counted = open; });
  await mirror.ready;
  const restored = JSON.parse(world.localStore['meraki-inspector-comments:/pricing']);
  assert.equal(restored.length, 2, 'both notes are written back into the page');
  assert.equal(restored[0].text, 'Restore me');
  assert.equal(counted, 1, 'only the unresolved one is counted');
  mirror.stop();
});

await check('the page wins when it already has notes of its own', async () => {
  const world = makeWorld({
    local: { 'meraki-inspector-comments:/pricing': JSON.stringify([note('new', 'Written just now')]) },
    extension: {
      notes: {
        'https://acme.test/pricing': { url: 'x', title: 'x', savedAt: 1, notes: [note('old', 'Stale copy')] },
      },
    },
  });
  const mirror = startNoteMirror(() => {});
  await mirror.ready;
  const pages = await readAllNotes();
  assert.equal(pages['https://acme.test/pricing'].notes[0].text, 'Written just now');
  assert.equal(JSON.parse(world.localStore['meraki-inspector-comments:/pricing'])[0].id, 'new');
  mirror.stop();
});

await check('a change announced by the inspector is mirrored', async () => {
  makeWorld();
  const mirror = startNoteMirror(() => {});
  await mirror.ready;
  const listener = globalThis.window.listeners['meraki-inspector-comments-change'];
  assert.ok(listener, 'the mirror listens for the inspector announcing a write');
  listener({ detail: { comments: [note('a', 'Added later'), note('b', 'Done', true)] } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const pages = await readAllNotes();
  assert.equal(pages['https://acme.test/pricing'].notes.length, 2);
  mirror.stop();
});

await check('deleting every note removes the page from storage', async () => {
  makeWorld({ local: { 'meraki-inspector-comments:/pricing': JSON.stringify([note('a', 'Bye')]) } });
  const mirror = startNoteMirror(() => {});
  await mirror.ready;
  globalThis.window.listeners['meraki-inspector-comments-change']({ detail: { comments: [] } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(Object.keys(await readAllNotes()), []);
  mirror.stop();
});

await check('open counts ignore resolved notes', () => {
  assert.equal(openNoteCount([note('a', 'x'), note('b', 'y', true), note('c', 'z')]), 2);
});

await check('a review exports as markdown a person can paste', () => {
  const markdown = notesAsMarkdown({
    url: 'https://acme.test/pricing/',
    title: 'Pricing — Acme',
    savedAt: Date.now(),
    notes: [note('a', 'Too tight'), note('b', 'Fixed', true)],
  });
  assert.ok(markdown.startsWith('# Review notes — Pricing — Acme'));
  assert.ok(markdown.includes('https://acme.test/pricing/'));
  assert.ok(markdown.includes('2 notes · 1 open'));
  assert.ok(markdown.includes('- Too tight — _Itamar,'));
  assert.ok(markdown.includes('_(resolved)_'));
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
