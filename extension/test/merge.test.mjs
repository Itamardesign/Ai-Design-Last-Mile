/**
 * The merge rules, tested directly.
 *
 * This is where syncing can lose work that a person cannot recreate: the moment a designer who has
 * been reviewing locally for a week signs in, an empty cloud must not win. Every case below is one
 * that would be a bug report rather than a wrong pixel.
 *
 * Run with `node extension/test/merge.test.mjs` (it bundles the module itself, so there is no build
 * step to remember).
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'inspector-merge-')), 'merge.mjs');

await build({
  entryPoints: [join(here, '..', 'src', 'merge.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: out,
  logLevel: 'silent',
});

const { docIdFor, pageKeyFromDocId, mergeNotePages, mergeNoteMaps, mergeEditPages, changedKeys } = await import(
  pathToFileURL(out).href
);

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const note = (id, text, extra = {}) => ({
  id,
  path: 'body > main > button',
  selector: 'button.cta',
  label: 'Button',
  text,
  createdAt: `2026-08-1${id.length}T10:00:00.000Z`,
  ...extra,
});

const page = (savedAt, notes, extra = {}) => ({
  url: 'https://acme.test/pricing',
  title: 'Pricing',
  savedAt,
  notes,
  ...extra,
});

await check('a page key survives the round trip through a document id', () => {
  for (const key of ['https://acme.test/pricing', 'https://acme.test/', 'file:///c/Users/a.b/index.html', 'https://x.test/~tilde/a*b']) {
    const id = docIdFor(key);
    assert.ok(!id.includes('/'), `document ids may not contain a slash: ${id}`);
    assert.ok(id !== '.' && id !== '..');
    assert.equal(pageKeyFromDocId(id), key);
  }
});

await check('a document id is stable across calls', () => {
  assert.equal(docIdFor('https://acme.test/pricing'), docIdFor('https://acme.test/pricing'));
});

await check('signing in with a local review and an empty cloud keeps the review', () => {
  const local = { 'https://acme.test/pricing': page(2000, [note('a', 'too tight')]) };
  const merged = mergeNoteMaps(local, {});
  assert.deepEqual(merged, local);
});

await check('notes from two machines are both kept', () => {
  const merged = mergeNotePages(page(1000, [note('a', 'from the laptop')]), page(2000, [note('bb', 'from the desktop')]));
  assert.deepEqual(merged.notes.map((entry) => entry.text), ['from the laptop', 'from the desktop']);
  assert.equal(merged.savedAt, 2000, 'the merged page is as new as its newest half');
});

await check('the same note edited in both places takes the newer save', () => {
  const older = page(1000, [note('a', 'too tight')]);
  const newer = page(2000, [note('a', 'too tight', { resolved: true })]);
  assert.equal(mergeNotePages(older, newer).notes[0].resolved, true);
  assert.equal(mergeNotePages(newer, older).notes[0].resolved, true, 'argument order must not decide it');
});

await check('a page renamed on the newer side reads as its new name', () => {
  const merged = mergeNotePages(page(1000, [note('a', 'one')]), { ...page(2000, [note('bb', 'two')]), title: 'Plans' });
  assert.equal(merged.title, 'Plans');
});

await check('a page only one side has ever seen comes through untouched', () => {
  const merged = mergeNoteMaps(
    { 'https://acme.test/a': page(1000, [note('a', 'local only')]) },
    { 'https://acme.test/b': page(1000, [note('bb', 'cloud only')]) },
  );
  assert.deepEqual(Object.keys(merged).sort(), ['https://acme.test/a', 'https://acme.test/b']);
});

await check('style edits do not interleave — the newer page wins whole', () => {
  const local = { url: 'u', title: 't', savedAt: 1000, variables: [], changes: [{ property: 'padding', after: '8px' }] };
  const remote = { url: 'u', title: 't', savedAt: 2000, variables: [], changes: [{ property: 'padding', after: '24px' }] };
  assert.equal(mergeEditPages(local, remote).changes[0].after, '24px');
  assert.equal(mergeEditPages(local, remote).changes.length, 1, 'two values for one property are alternatives, not a union');
});

await check('a push sends only the pages that changed', () => {
  const before = {
    'https://acme.test/a': page(1000, [note('a', 'one')]),
    'https://acme.test/b': page(1000, [note('bb', 'two')]),
  };
  const after = {
    ...before,
    'https://acme.test/b': page(3000, [note('bb', 'two'), note('ccc', 'three')]),
  };
  assert.deepEqual(changedKeys(before, after), ['https://acme.test/b']);
});

await check('a page that lost all of its notes counts as changed', () => {
  const before = { 'https://acme.test/a': page(1000, [note('a', 'one')]) };
  assert.deepEqual(changedKeys(before, {}), ['https://acme.test/a']);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
