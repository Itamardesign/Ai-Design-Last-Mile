/**
 * The cloud push, against a Firestore that can say no.
 *
 * A page shared by somebody else is written into *their* workspace, and the day they remove this
 * person the rules refuse it. Every case here is about what that refusal must not do: take the
 * person's own pages down with it, or keep failing on every retry from then on.
 *
 * Run with `node extension/test/sync.test.mjs` (it bundles the module itself, with the Firebase
 * client swapped for an in-memory one).
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'inspector-sync-'));

/*
 * Just enough of the Firestore client: `doc` remembers its path, a batch collects `set`s and
 * commits them together, and a commit into a workspace on the deny list fails the way the rules
 * would, with `code: 'permission-denied'`.
 */
writeFileSync(join(dir, 'firestore.mjs'), `
  const cloud = globalThis.__cloud;
  export const doc = (_db, ...segments) => ({ path: segments.join('/'), workspace: segments[1] });
  export const collection = (_db, ...segments) => ({ path: segments.join('/') });
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => false, data: () => undefined });
  export const deleteDoc = async () => undefined;
  export const setDoc = async (reference, data) => { cloud.writes.push({ path: reference.path, data }); };
  export const query = (source) => source;
  export const orderBy = () => undefined;
  export const limit = () => undefined;
  export const writeBatch = () => {
    const pending = [];
    return {
      set: (reference, data) => pending.push({ path: reference.path, workspace: reference.workspace, data }),
      commit: async () => {
        cloud.commits.push(pending.map((entry) => entry.path));
        const refused = pending.find((entry) => cloud.denied.has(entry.workspace));
        if (refused) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        cloud.writes.push(...pending);
      },
    };
  };
`);
writeFileSync(join(dir, 'storage.mjs'), `
  export const ref = () => ({});
  export const uploadString = async () => undefined;
  export const getDownloadURL = async () => 'https://storage.test/shot.png';
`);
writeFileSync(join(dir, 'firebase.mjs'), `
  export const db = () => ({});
  export const storage = () => ({});
  export const firebaseAuth = () => ({});
  export const currentUser = async () => null;
`);

const out = join(dir, 'sync.mjs');
await build({
  entryPoints: [join(here, '..', 'src', 'sync.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: out,
  logLevel: 'silent',
  plugins: [{
    name: 'fake-firebase',
    setup(api) {
      api.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: join(dir, 'firestore.mjs') }));
      api.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: join(dir, 'storage.mjs') }));
      api.onResolve({ filter: /^\.\/firebase\.js$/ }, () => ({ path: join(dir, 'firebase.mjs') }));
    },
  }],
});

const cloud = { writes: [], commits: [], denied: new Set() };
globalThis.__cloud = cloud;

const local = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(wanted.filter((key) => key in local).map((key) => [key, local[key]]));
      },
      set: async (patch) => { Object.assign(local, patch); },
    },
  },
};

const { pushNotes, pushEdits } = await import(pathToFileURL(out).href);

const ME = 'me-uid';
const OWNER = 'owner-uid';
const MINE = 'https://acme.test/pricing';
const THEIRS = 'https://client.test/home';

const page = (savedAt, notes) => ({ url: 'https://x.test/', title: 'Page', savedAt, notes });
const note = (id) => ({ id, path: 'body > main', selector: 'main', label: 'Main', text: `note ${id}`, createdAt: '2026-09-01T10:00:00.000Z' });

function reset({ shared = true } = {}) {
  cloud.writes.length = 0;
  cloud.commits.length = 0;
  cloud.denied.clear();
  for (const key of Object.keys(local)) delete local[key];
  local.account = { mode: 'cloud', profile: { uid: ME, name: 'Me', email: 'me@acme.test', photo: null } };
  if (shared) local.sharedPages = { [THEIRS]: { workspaceId: OWNER, pageId: 'theirs-doc', role: 'edit' } };
}

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

await check('a private page and a shared page go to their own workspaces, in separate batches', async () => {
  reset();
  const current = { [MINE]: page(1, [note('a')]), [THEIRS]: page(1, [note('b')]) };
  await pushNotes({}, current);
  assert.equal(cloud.commits.length, 2, 'one batch per workspace');
  const paths = cloud.writes.map((entry) => entry.path).sort();
  assert.ok(paths.some((path) => path.startsWith(`workspaces/${ME}/notes/`)));
  assert.equal(paths.filter((path) => path.startsWith(`workspaces/${OWNER}/notes/theirs-doc`)).length, 1);
});

await check('a refused shared page does not take the private pages down with it', async () => {
  reset();
  cloud.denied.add(OWNER);
  const current = { [MINE]: page(1, [note('a')]), [THEIRS]: page(1, [note('b')]) };
  await assert.rejects(pushNotes({}, current), /permission/);
  assert.ok(cloud.writes.some((entry) => entry.path.startsWith(`workspaces/${ME}/notes/`)), 'my own page still landed');
  assert.ok(!cloud.writes.some((entry) => entry.workspace === OWNER), 'nothing landed in the workspace that refused');
});

await check('a refused shared page is forgotten, so the retry lands it in my own workspace', async () => {
  reset();
  cloud.denied.add(OWNER);
  const current = { [THEIRS]: page(1, [note('b')]) };
  await assert.rejects(pushNotes({}, current));
  assert.deepEqual(local.sharedPages, {}, 'the mapping into their workspace is gone');
  cloud.writes.length = 0;
  await pushNotes({}, current);
  assert.equal(cloud.writes.length, 1);
  assert.ok(cloud.writes[0].path.startsWith(`workspaces/${ME}/notes/`), 'the retry went to my own workspace');
});

await check('a refused private page is not forgotten — there is nowhere else for it to go', async () => {
  reset();
  cloud.denied.add(ME);
  await assert.rejects(pushNotes({}, { [MINE]: page(1, [note('a')]) }));
  assert.deepEqual(local.sharedPages, { [THEIRS]: { workspaceId: OWNER, pageId: 'theirs-doc', role: 'edit' } });
});

await check('edits to a page shared for comment only are never sent', async () => {
  reset();
  local.sharedPages[THEIRS].role = 'comment';
  const edits = { url: 'https://x.test/', title: 'Page', savedAt: 1, variables: [], changes: [{ path: 'body', selector: 'body', property: 'color', before: 'red', after: 'blue', kind: 'css' }] };
  await pushEdits({}, { [THEIRS]: edits });
  assert.equal(cloud.writes.length, 0);
  assert.equal(cloud.commits.length, 0);
});

await check('nothing leaves the machine while the account is local', async () => {
  reset();
  local.account = { mode: 'local', profile: null };
  await pushNotes({}, { [MINE]: page(1, [note('a')]) });
  assert.equal(cloud.commits.length, 0);
});

if (failures) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log('\nall passing');
