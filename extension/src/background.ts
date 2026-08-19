/**
 * The service worker: it decides which tabs the inspector is running on, injects it there, and
 * keeps that decision alive across reloads and navigations.
 *
 * A service worker is evicted whenever Chrome feels like it, so no state lives in module scope
 * that matters — the set of active tabs is kept in `chrome.storage.session`, which survives
 * eviction and is cleared when the browser closes, exactly the lifetime "which tabs am I
 * inspecting" should have.
 */
import {
  DETECT,
  originOf,
  readSettings,
  refreshSystem,
  systemForOrigin,
  writeSettings,
} from './storage.js';
import type { PageMessage, PopupRequest, TabState } from './messages.js';
import type { StoredEdits } from './merge.js';
import type { NotePage } from './notes.js';
import type { DesignTokens } from '../../src/types.js';

const ACTIVE_TABS_KEY = 'activeTabs';
/** Offset that keeps our per-tab header rules clear of any other rule ids. */
const RULE_ID_BASE = 90000;

async function activeTabs(): Promise<number[]> {
  const stored = (await chrome.storage.session.get(ACTIVE_TABS_KEY))[ACTIVE_TABS_KEY];
  return Array.isArray(stored) ? (stored as number[]) : [];
}

async function setTabActive(tabId: number, active: boolean): Promise<void> {
  const current = new Set(await activeTabs());
  if (active) current.add(tabId);
  else current.delete(tabId);
  await chrome.storage.session.set({ [ACTIVE_TABS_KEY]: [...current] });
}

/**
 * Lets the device preview and the font previews work on sites that forbid both.
 *
 * `X-Frame-Options` stops the page from being framed by itself, which is exactly what the device
 * preview does, and a strict `Content-Security-Policy` blocks the webfont requests behind the font
 * picker. The rules are session-scoped and pinned to one tab id, so nothing is relaxed on any page
 * the designer has not deliberately opened the inspector on.
 */
async function setHeaderRules(tabId: number, on: boolean): Promise<void> {
  // Tab ids are unique for the life of the session, so one derived id per tab cannot collide.
  const id = RULE_ID_BASE + tabId;
  const removeRuleIds = [id];
  if (!on) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    return;
  }
  const settings = await readSettings();
  if (!settings.relaxCsp) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    return;
  }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          responseHeaders: [
            { header: 'content-security-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
            { header: 'content-security-policy-report-only', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
            { header: 'x-frame-options', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
          ],
        },
        condition: {
          tabIds: [tabId],
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
            chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
          ],
        },
      },
    ],
  });
}

/**
 * The toolbar icon says two things: whether the inspector is running here, and whether anything is
 * waiting to be answered. An open note count wins, because it is the one that needs a person.
 */
async function paintBadge(tabId: number, active: boolean, openNotes = 0): Promise<void> {
  try {
    const text = !active ? '' : openNotes > 0 ? String(Math.min(openNotes, 99)) : 'ON';
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: openNotes > 0 ? '#E5484D' : '#8B5CF6' });
    await chrome.action.setTitle({
      tabId,
      title: !active
        ? 'Meraki Design Inspector'
        : openNotes > 0
          ? `Meraki Design Inspector — ${openNotes} open note${openNotes === 1 ? '' : 's'} on this page`
          : 'Meraki Design Inspector — running on this tab',
    });
  } catch {
    // The tab went away mid-update; nothing to paint.
  }
}

/** Resolves the tokens to hand a page, refreshing a URL-backed system if it is stale. */
async function tokensFor(origin: string | null): Promise<{ tokens: DesignTokens | null; systemName: string | null }> {
  const settings = await readSettings();
  const system = systemForOrigin(settings, origin);
  if (!system) return { tokens: null, systemName: null };

  const STALE_AFTER = 5 * 60 * 1000;
  if (system.source === 'url' && Date.now() - system.updatedAt > STALE_AFTER) {
    const refreshed = await refreshSystem(system);
    await writeSettings({
      ...settings,
      systems: settings.systems.map((entry) => (entry.id === refreshed.id ? refreshed : entry)),
    });
    return { tokens: refreshed.tokens, systemName: refreshed.name };
  }
  return { tokens: system.tokens, systemName: system.name };
}

async function send(tabId: number, message: PageMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

/** True for pages Chrome refuses to let an extension script — every browser has a few. */
function isRestricted(url: string | undefined): boolean {
  if (!url) return true;
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension|view-source):/i.test(url)
    || /^https:\/\/chromewebstore\.google\.com/i.test(url)
    || /^https:\/\/chrome\.google\.com\/webstore/i.test(url);
}

async function activate(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (isRestricted(tab.url)) return;

  const origin = originOf(tab.url);
  await setHeaderRules(tabId, true);
  const { tokens, systemName } = await tokensFor(origin);
  const payload: PageMessage = { type: 'inspector:set', active: true, tokens, systemName };

  if (!(await send(tabId, payload))) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await send(tabId, payload);
  }
  await setTabActive(tabId, true);
  await paintBadge(tabId, true);
}

async function deactivate(tabId: number): Promise<void> {
  await send(tabId, { type: 'inspector:set', active: false, tokens: null, systemName: null });
  await setHeaderRules(tabId, false);
  await setTabActive(tabId, false);
  await paintBadge(tabId, false);
}

async function stateFor(tabId: number): Promise<TabState> {
  const [tab, settings, tabs] = await Promise.all([chrome.tabs.get(tabId), readSettings(), activeTabs()]);
  const origin = isRestricted(tab.url) ? null : originOf(tab.url);
  const system = systemForOrigin(settings, origin);
  return {
    tabId,
    origin,
    active: tabs.includes(tabId),
    systemName: system?.name ?? null,
    systemId: (origin && settings.siteSystems[origin]) || settings.defaultSystemId || DETECT,
    autoStart: origin ? settings.autoOrigins.includes(origin) : false,
    relaxCsp: settings.relaxCsp,
  };
}

chrome.runtime.onMessage.addListener((message: PopupRequest & { type: string }, _sender, respond) => {
  // Every branch is async, so the listener returns true and answers through `respond`.
  (async () => {
    switch (message.type) {
      case 'state':
        respond(await stateFor(message.tabId));
        return;
      case 'setActive':
        if (message.active) await activate(message.tabId);
        else await deactivate(message.tabId);
        respond(await stateFor(message.tabId));
        return;
      case 'toggle': {
        const current = await activeTabs();
        if (current.includes(message.tabId)) await deactivate(message.tabId);
        else await activate(message.tabId);
        respond(await stateFor(message.tabId));
        return;
      }
      case 'setSite': {
        const settings = await readSettings();
        const tab = await chrome.tabs.get(message.tabId);
        const origin = originOf(tab.url);
        if (origin) {
          await writeSettings({ ...settings, siteSystems: { ...settings.siteSystems, [origin]: message.systemId } });
          const { tokens, systemName } = await tokensFor(origin);
          await send(message.tabId, { type: 'inspector:tokens', tokens, systemName });
        }
        respond(await stateFor(message.tabId));
        return;
      }
      case 'setAutoStart': {
        const settings = await readSettings();
        const tab = await chrome.tabs.get(message.tabId);
        const origin = originOf(tab.url);
        if (origin) {
          const autoOrigins = message.autoStart
            ? [...new Set([...settings.autoOrigins, origin])]
            : settings.autoOrigins.filter((entry) => entry !== origin);
          await writeSettings({ ...settings, autoOrigins });
        }
        respond(await stateFor(message.tabId));
        return;
      }
      case 'setRelaxCsp': {
        const settings = await readSettings();
        await writeSettings({ ...settings, relaxCsp: message.relaxCsp });
        // Re-apply for every tab already running, so the switch takes effect without a re-activate.
        for (const tabId of await activeTabs()) await setHeaderRules(tabId, true);
        respond({ ok: true });
        return;
      }
      case 'capture': {
        // A page cannot photograph itself; the service worker can, and only for the tab that asked.
        const windowId = _sender.tab?.windowId;
        try {
          const dataUrl = windowId === undefined
            ? await chrome.tabs.captureVisibleTab({ format: 'png' })
            : await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
          respond({ dataUrl });
        } catch {
          // Restricted pages, a tab that lost focus mid-capture, or a quota hit: the handoff simply
          // has no picture in it.
          respond({ dataUrl: null });
        }
        return;
      }
      case 'notes': {
        const tabId = _sender.tab?.id;
        if (tabId !== undefined) {
          const running = (await activeTabs()).includes(tabId);
          await paintBadge(tabId, running, message.open);
        }
        respond({ ok: true });
        return;
      }
      /*
       * The account, and everything that depends on it.
       *
       * All four of these live in the worker rather than in the page that asked, for one reason: there
       * is one identity per install and one mirror pushing on its behalf, and both have to outlive the
       * settings page being closed mid-handshake.
       *
       * `./account.js` and `./sync.js` are imported inside the cases, not at the top of the file,
       * because the Firebase SDK does real work as it loads and the worker is started again for every
       * navigation and every badge repaint — almost none of which have anything to do with the cloud.
       * esbuild keeps the modules in this same bundle and only evaluates them on the first `await`.
       */
      case 'account': {
        const { resolveAccount } = await import('./account.js');
        respond(await resolveAccount());
        return;
      }
      case 'account:signIn': {
        const { signInWithGoogle } = await import('./account.js');
        const account = await signInWithGoogle();
        // Merge straight away. Signing in and then finding your own machine's review missing until
        // some later event would be the worst possible first impression of the feature.
        if (account.mode === 'cloud' && !account.error) {
          const { pullEverything } = await import('./sync.js');
          await pullEverything().catch((): null => null);
        }
        respond(account);
        return;
      }
      case 'account:skip': {
        const { stayLocal } = await import('./account.js');
        respond(await stayLocal());
        return;
      }
      case 'account:signOut': {
        const { signOutAccount } = await import('./account.js');
        respond(await signOutAccount());
        return;
      }
      case 'handoff:save': {
        const { saveHandoff } = await import('./sync.js');
        respond(await saveHandoff(message.document));
        return;
      }
      case 'handoffs': {
        const { listHandoffs } = await import('./sync.js');
        respond({ handoffs: await listHandoffs() });
        return;
      }
      case 'reload':
        await chrome.tabs.reload(message.tabId);
        respond({ ok: true });
        return;
      default:
        respond({ ok: false });
    }
  })().catch((error) => respond({ error: (error as Error).message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-inspector') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const current = await activeTabs();
  if (current.includes(tab.id)) await deactivate(tab.id);
  else await activate(tab.id);
});

/**
 * Puts the inspector back after a navigation.
 *
 * A content script dies with the document, so without this every link click or refresh would
 * silently drop the tool while the badge still claimed it was running. Auto-start origins are
 * picked up in the same place, since "should this page have it" is the same question.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || isRestricted(tab.url)) return;
  const origin = originOf(tab.url);
  const settings = await readSettings();
  const wasActive = (await activeTabs()).includes(tabId);
  const shouldRun = wasActive || (origin !== null && settings.autoOrigins.includes(origin));
  if (!shouldRun) return;
  await activate(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await setTabActive(tabId, false);
  await setHeaderRules(tabId, false);
});

/* ===========================================================================
   The cloud mirror.

   Extension storage is the source of truth and this only follows it, so every
   feature works identically with the account signed out. Two problems shape the
   code below.

   A burst. One drag of a slider commits many edits, and each one rewrites the
   same page — so pushes are coalesced on a short timer and the *oldest* baseline
   in the burst is the one compared against, which is what makes the push send
   one document instead of thirty.

   Eviction. A service worker can be killed between the change and the flush,
   taking the timer with it and losing the push silently. So the intent to push
   is recorded in `chrome.storage.session` first and only cleared once the push
   lands; a worker waking up with that flag still set pushes everything rather
   than leaving a machine quietly out of date.
   =========================================================================== */

const DIRTY_KEY = 'syncDirty';
const PUSH_DELAY = 1200;

/** The oldest value seen since the last flush — the baseline a burst is diffed against. */
let noteBaseline: Record<string, NotePage> | undefined;
let editBaseline: Record<string, StoredEdits> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

async function flushMirror(): Promise<void> {
  flushTimer = undefined;
  const notesFrom = noteBaseline;
  const editsFrom = editBaseline;
  noteBaseline = undefined;
  editBaseline = undefined;
  if (!notesFrom && !editsFrom) return;

  const { readAccount } = await import('./account.js');
  if ((await readAccount()).mode !== 'cloud') {
    await chrome.storage.session.remove(DIRTY_KEY);
    return;
  }

  const sync = await import('./sync.js');
  const stored = await chrome.storage.local.get(['notes', 'edits']);
  try {
    if (notesFrom) await sync.pushNotes(notesFrom, (stored.notes ?? {}) as Record<string, NotePage>);
    if (editsFrom) await sync.pushEdits(editsFrom, (stored.edits ?? {}) as Record<string, StoredEdits>);
    await chrome.storage.session.remove(DIRTY_KEY);
  } catch {
    // Offline, or rules refused the write. The dirty flag stays set, so the next change — or the next
    // time this worker starts — sends everything. Nothing is lost locally either way.
  }
}

function scheduleMirror(): void {
  void chrome.storage.session.set({ [DIRTY_KEY]: true });
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushMirror(), PUSH_DELAY);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.notes && !changes.edits) return;
  if (changes.notes) noteBaseline ??= (changes.notes.oldValue ?? {}) as Record<string, NotePage>;
  if (changes.edits) editBaseline ??= (changes.edits.oldValue ?? {}) as Record<string, StoredEdits>;
  scheduleMirror();
});

/**
 * A push that was lost to eviction, sent now.
 *
 * Runs on every worker start, which is often — the storage read is two keys and the whole thing exits
 * immediately unless a previous flush actually failed to land.
 */
void (async () => {
  if (!(await chrome.storage.session.get(DIRTY_KEY))[DIRTY_KEY]) return;
  // No baseline survived, so everything is compared against nothing and every page with content is
  // re-sent. Wasteful once, correct always.
  noteBaseline = {};
  editBaseline = {};
  await flushMirror();
})();

chrome.runtime.onInstalled.addListener(async (details) => {
  await writeSettings(await readSettings());
  if (details.reason === 'install') await chrome.runtime.openOptionsPage();
});
