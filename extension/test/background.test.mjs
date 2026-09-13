/**
 * Runs the built service worker against a fake `chrome`, and checks the decisions it makes:
 * inject once, re-inject after a navigation, relax headers only while running, and hand the page the
 * tokens for the site it is on.
 *
 * This exists because the service worker is the one part that cannot be exercised from the harness
 * page — and it is where "the inspector quietly stopped being there" bugs live.
 *
 * Run with `node extension/test/background.test.mjs` (build first).
 */
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'dist', 'background.js'), 'utf8');

/** An in-memory stand-in for the parts of `chrome` the worker touches. */
function makeChrome({ tabUrl = 'https://example.com/dashboard' } = {}) {
  const local = {};
  const session = {};
  const log = { injected: [], sent: [], rules: new Map(), badges: [], reloaded: [], tokensAsked: 0 };
  const listeners = { message: [], updated: [], removed: [], command: [], installed: [], changed: [] };
  // `onChanged` is real here, unlike the earlier version of this harness, because the cloud mirror is
  // driven entirely by it: without dispatch there is nothing to observe.
  const area = (store, name) => ({
    get: async (keys) => {
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in store).map((key) => [key, store[key]]));
    },
    set: async (patch) => {
      const changes = Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [key, { oldValue: store[key], newValue: value }]),
      );
      Object.assign(store, patch);
      listeners.changed.forEach((listener) => listener(changes, name));
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
  });

  const chrome = {
    storage: {
      local: area(local, 'local'),
      session: area(session, 'session'),
      onChanged: { addListener: (listener) => listeners.changed.push(listener) },
    },
    tabs: {
      get: async (id) => ({ id, url: tabUrl }),
      query: async () => [{ id: 7, url: tabUrl }],
      sendMessage: async (tabId, message) => {
        if (!log.injected.includes(tabId)) throw new Error('no receiver');
        log.sent.push({ tabId, message });
      },
      reload: async (tabId) => log.reloaded.push(tabId),
      onUpdated: { addListener: (listener) => listeners.updated.push(listener) },
      onRemoved: { addListener: (listener) => listeners.removed.push(listener) },
    },
    scripting: {
      executeScript: async ({ target, files }) => {
        log.injected.push(target.tabId);
        return [{ result: files }];
      },
    },
    action: {
      setBadgeText: async (details) => log.badges.push(details),
      setBadgeBackgroundColor: async () => undefined,
      setTitle: async () => undefined,
    },
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
      HeaderOperation: { REMOVE: 'remove' },
      ResourceType: { MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame' },
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        removeRuleIds.forEach((id) => log.rules.delete(id));
        addRules.forEach((rule) => log.rules.set(rule.id, rule));
      },
    },
    commands: { onCommand: { addListener: (listener) => listeners.command.push(listener) }, getAll: async () => [] },
    runtime: {
      onMessage: { addListener: (listener) => listeners.message.push(listener) },
      onInstalled: { addListener: (listener) => listeners.installed.push(listener) },
      openOptionsPage: async () => undefined,
      // The placeholder the repo ships with: every account test below is therefore also a test that an
      // unconfigured build explains itself instead of throwing an OAuth error at a designer.
      getManifest: () => ({ oauth2: { client_id: 'REPLACE_ME.apps.googleusercontent.com', scopes: [] } }),
    },
    identity: {
      getAuthToken: async () => {
        log.tokensAsked += 1;
        throw new Error('OAuth2 not granted or revoked.');
      },
      removeCachedAuthToken: async () => undefined,
    },
  };

  const ask = (message) =>
    new Promise((resolve) => {
      listeners.message[0](message, {}, resolve);
    });

  return { chrome, log, listeners, ask, local, session };
}

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

function boot(options) {
  const world = makeChrome(options);
  const context = createContext({
    chrome: world.chrome,
    fetch: async () => ({ ok: false }),
    console,
    URL,
    Date,
    Math,
    // The debounce delay is not what these tests are about, so timers here fire on the next tick. What
    // is under test is that the flush happens at all, and that it does nothing while signed out.
    setTimeout: (run) => setTimeout(run, 0),
    clearTimeout,
    // The Firebase SDK reads `__FIREBASE_DEFAULTS__` off whichever global it can find as it loads, and
    // complains loudly to the console when there is none. There is one now, and it is empty.
    global: {},
  });
  runInContext(source, context);
  return world;
}

await check('a fresh tab reports itself off, with its origin recognised', async () => {
  const world = boot();
  const state = await world.ask({ type: 'state', tabId: 7 });
  assert.equal(state.origin, 'https://example.com');
  assert.equal(state.active, false);
  assert.equal(state.systemName, null);
});

await check('toggling on injects, messages the page, relaxes headers and badges the tab', async () => {
  const world = boot();
  const state = await world.ask({ type: 'toggle', tabId: 7 });
  assert.equal(state.active, true);
  assert.deepEqual(world.log.injected, [7]);
  assert.equal(world.log.sent.at(-1).message.type, 'inspector:set');
  assert.equal(world.log.sent.at(-1).message.active, true);
  assert.equal(world.log.rules.size, 1);
  const rule = [...world.log.rules.values()][0];
  // Arrays made inside the vm have their own prototype, so compare copies rather than references.
  assert.deepEqual([...rule.condition.tabIds], [7]);
  assert.deepEqual(
    [...rule.action.responseHeaders].map((header) => header.header),
    ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options'],
  );
  assert.equal(world.log.badges.at(-1).text, 'ON');
});

await check('toggling off drops the header rules and the badge', async () => {
  const world = boot();
  await world.ask({ type: 'toggle', tabId: 7 });
  const state = await world.ask({ type: 'toggle', tabId: 7 });
  assert.equal(state.active, false);
  assert.equal(world.log.rules.size, 0);
  assert.equal(world.log.badges.at(-1).text, '');
  assert.equal(world.log.sent.at(-1).message.active, false);
});

await check('a second activation reuses the injected copy instead of adding another', async () => {
  const world = boot();
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  assert.deepEqual(world.log.injected, [7]);
});

await check('a navigation puts the inspector back', async () => {
  const world = boot();
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  world.log.injected.length = 0; // the content script died with the old document
  world.log.sent.length = 0;
  await world.listeners.updated[0](7, { status: 'complete' }, { id: 7, url: 'https://example.com/other' });
  assert.deepEqual(world.log.injected, [7], 're-injected after the navigation');
  assert.equal(world.log.sent.at(-1).message.active, true);
});

await check('an auto-start origin mounts without anyone clicking', async () => {
  const world = boot();
  await world.ask({ type: 'setAutoStart', tabId: 7, autoStart: true });
  await world.listeners.updated[0](7, { status: 'complete' }, { id: 7, url: 'https://example.com/' });
  assert.deepEqual(world.log.injected, [7]);
  const state = await world.ask({ type: 'state', tabId: 7 });
  assert.equal(state.autoStart, true);
  assert.equal(state.active, true);
});

await check('a page Chrome will not let us script is reported as unavailable', async () => {
  const world = boot({ tabUrl: 'chrome://settings' });
  const state = await world.ask({ type: 'state', tabId: 7 });
  assert.equal(state.origin, null);
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  assert.deepEqual(world.log.injected, [], 'nothing injected into a restricted page');
});

await check('a per-site design system is stored and pushed to the page', async () => {
  const world = boot();
  const system = {
    id: 'sys-1',
    name: 'Acme',
    source: 'paste',
    raw: '{}',
    tokens: { collections: [{ id: 'a', name: 'Acme', colors: [], typography: [] }], spacing: [], radius: [] },
    shape: 'design tokens',
    warnings: [],
    counts: { collections: 1, colors: 0, typography: 0, spacing: 0, radius: 0 },
    updatedAt: Date.now(),
  };
  await world.chrome.storage.local.set({
    settings: { version: 1, systems: [system], defaultSystemId: '__detect__', siteSystems: {}, autoOrigins: [], relaxCsp: true },
  });
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  assert.equal(world.log.sent.at(-1).message.tokens, null, 'detects from the page until told otherwise');

  const state = await world.ask({ type: 'setSite', tabId: 7, systemId: 'sys-1' });
  assert.equal(state.systemName, 'Acme');
  assert.equal(world.log.sent.at(-1).message.type, 'inspector:tokens');
  assert.equal(world.log.sent.at(-1).message.tokens.collections[0].name, 'Acme');
  const stored = (await world.chrome.storage.local.get('settings')).settings;
  assert.equal(stored.siteSystems['https://example.com'], 'sys-1');
});

await check('turning off the CSP relaxation stops the rules being added', async () => {
  const world = boot();
  await world.ask({ type: 'setRelaxCsp', relaxCsp: false });
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  assert.equal(world.log.rules.size, 0);
  const state = await world.ask({ type: 'state', tabId: 7 });
  assert.equal(state.relaxCsp, false);
  assert.equal(state.active, true, 'the inspector still runs, it just cannot reframe the page');
});

await check('closing a tab clears its rules', async () => {
  const world = boot();
  await world.ask({ type: 'setActive', tabId: 7, active: true });
  await world.listeners.removed[0](7, {});
  assert.equal(world.log.rules.size, 0);
  const state = await world.ask({ type: 'state', tabId: 7 });
  assert.equal(state.active, false);
});

await check('the keyboard command toggles the active tab', async () => {
  const world = boot();
  await world.listeners.command[0]('toggle-inspector');
  assert.deepEqual(world.log.injected, [7]);
  await world.listeners.command[0]('toggle-inspector');
  assert.equal(world.log.sent.at(-1).message.active, false);
});

/** Lets a scheduled flush run before the assertion looks at what it did. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

await check('a fresh install has not been asked about an account yet', async () => {
  const world = boot();
  const account = await world.ask({ type: 'account' });
  assert.equal(account.mode, 'undecided');
  assert.equal(account.profile, null);
  assert.equal(world.log.tokensAsked, 0, 'nothing may reach for a token before anybody asks it to');
});

await check('skip is a decision, and it is remembered', async () => {
  const world = boot();
  assert.equal((await world.ask({ type: 'account:skip' })).mode, 'local');
  assert.equal((await world.ask({ type: 'account' })).mode, 'local', 'the settings page must stop asking');
  assert.equal(world.log.tokensAsked, 0, 'skipping must never contact Google');
});

await check('a build with no OAuth client id explains what is missing', async () => {
  const world = boot();
  const account = await world.ask({ type: 'account:signIn' });
  assert.match(account.error, /client id/i);
  assert.match(account.error, /README/, 'the message has to say where to look');
  assert.equal(account.mode, 'undecided', 'a failed sign-in must not claim an account');
  assert.equal(world.log.tokensAsked, 0, 'there is no point asking Chrome for a token we cannot use');
});

await check('keeping a handoff without an account says so rather than failing silently', async () => {
  const world = boot();
  await world.ask({ type: 'account:skip' });
  const answer = await world.ask({
    type: 'handoff:save',
    document: { url: 'https://acme.test/', title: 'Acme', author: 'Dana', markdown: '#', css: '', changeCount: 1, noteCount: 0, issueCount: 0, screenshot: null },
  });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /Sign in/);
});

await check('the kept handoff list is empty, not broken, with no account', async () => {
  const world = boot();
  await world.ask({ type: 'account:skip' });
  assert.equal((await world.ask({ type: 'handoffs' })).handoffs.length, 0);
});

await check('a note saved while local is never pushed anywhere', async () => {
  const world = boot();
  await world.ask({ type: 'account:skip' });
  await world.chrome.storage.local.set({
    notes: { 'https://acme.test/': { url: 'https://acme.test/', title: 'Acme', savedAt: 1, notes: [{ id: 'a', text: 'tighter' }] } },
  });
  await settle();
  // The flush ran, found no account, and cleared its own dirty marker. A push would have needed a
  // network this context does not have, and would have thrown rather than tidied up after itself.
  assert.equal(world.session.syncDirty, undefined);
});

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
