/**
 * The toolbar popup: turn the inspector on here, and say which design system this site is designed
 * against. Anything that needs typing (adding a system) lives in the settings page instead.
 */
import { DETECT, readSettings } from './storage.js';
import { notesAsMarkdown, openNoteCount, readAllNotes, type NotePage } from './notes.js';
import type { PopupRequest, TabState } from './messages.js';
import type { Account } from './account.js';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const toggle = el<HTMLButtonElement>('toggle');
const statusPill = el<HTMLSpanElement>('status');
const statusText = el<HTMLSpanElement>('status-text');
const siteLabel = el<HTMLSpanElement>('site');
const siteDot = el<HTMLElement>('site-dot');
const systemSelect = el<HTMLSelectElement>('system');
const systemDetail = el<HTMLParagraphElement>('system-detail');
const swatches = el<HTMLDivElement>('system-swatches');
const autoToggle = el<HTMLInputElement>('auto');
const controls = el<HTMLDivElement>('controls');
const unsupported = el<HTMLDivElement>('unsupported');
const accountAvatar = el<HTMLSpanElement>('account-avatar');
const accountTitle = el<HTMLElement>('account-title');
const accountDetail = el<HTMLSpanElement>('account-detail');
const accountSignIn = el<HTMLButtonElement>('account-signin');
const accountSkip = el<HTMLButtonElement>('account-skip');

const ask = <T,>(request: PopupRequest): Promise<T> => chrome.runtime.sendMessage(request) as Promise<T>;

/**
 * What this page's review currently says.
 *
 * Shown in the popup because a review is only finished when somebody else has it — one click turns
 * the notes on this page into markdown on the clipboard, without opening the inspector at all.
 */
async function paintNotes(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const row = el<HTMLDivElement>('notes-row');
  const summary = el<HTMLSpanElement>('notes-summary');
  const copy = el<HTMLButtonElement>('copy-notes');
  const dot = el<HTMLElement>('notes-dot');

  const url = tab?.url ? new URL(tab.url) : null;
  const key = url ? `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}` : null;
  const page: NotePage | undefined = key ? (await readAllNotes())[key] : undefined;

  row.classList.toggle('hidden', !page);
  if (!page) return;

  const open = openNoteCount(page.notes);
  dot.classList.toggle('on', open === 0);
  summary.textContent = open
    ? `${open} open note${open === 1 ? '' : 's'} of ${page.notes.length}`
    : `${page.notes.length} note${page.notes.length === 1 ? '' : 's'} · all resolved`;

  copy.onclick = async () => {
    await navigator.clipboard.writeText(notesAsMarkdown(page));
    copy.textContent = 'Copied';
    window.setTimeout(() => { copy.textContent = 'Copy review'; }, 1200);
  };
}

/**
 * The account, in one row.
 *
 * The settings page is where an account is managed; this is where it is *noticed*. Somebody who never
 * opens the settings page should still find out that their work can follow them, and be one click from
 * saying yes or no to it.
 *
 * Signing out is deliberately not here: it is rare, it is not reversible by accident, and a row this
 * small should not carry a button whose worst case is a designer wondering where their sync went.
 */
async function paintAccount(): Promise<void> {
  const account = await ask<Account | undefined>({ type: 'account' });
  const mode = account?.mode ?? 'undecided';

  accountSignIn.classList.toggle('hidden', mode === 'cloud' && !account?.error);
  accountSkip.classList.toggle('hidden', mode !== 'undecided');

  if (mode === 'cloud' && account?.profile) {
    const name = account.profile.name || account.profile.email || 'Signed in';
    accountTitle.textContent = name;
    accountDetail.textContent = account.error ?? (account.syncedAt ? 'Everything is saved to your account' : 'Syncing to your account');
    accountSignIn.textContent = 'Retry';
    // The Google avatar, when there is one, and the initial when there is not.
    if (account.profile.photo) {
      const image = document.createElement('img');
      image.src = account.profile.photo;
      image.alt = '';
      accountAvatar.replaceWith(image);
      image.id = 'account-avatar';
    } else {
      accountAvatar.textContent = name.slice(0, 1).toUpperCase();
    }
    return;
  }

  accountAvatar.textContent = mode === 'local' ? '·' : '?';
  accountTitle.textContent = mode === 'local' ? 'This machine only' : 'Not signed in';
  accountDetail.textContent = account?.error ?? (mode === 'local'
    ? 'Your notes and edits stay here'
    : 'Sign in to keep your notes across machines');
  accountSignIn.textContent = 'Sign in';
}

accountSignIn.addEventListener('click', async () => {
  accountSignIn.disabled = true;
  accountTitle.textContent = 'Opening Google…';
  // The chooser is a native window and closing this popup does not stop it: the worker owns the
  // exchange, so reopening the popup shows however it ended.
  await ask({ type: 'account:signIn' });
  accountSignIn.disabled = false;
  await paintAccount();
});

accountSkip.addEventListener('click', async () => {
  await ask({ type: 'account:skip' });
  await paintAccount();
});

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Shows what the connected system actually contains, so "connected" is never taken on trust. */
async function paintSystem(state: TabState): Promise<void> {
  const settings = await readSettings();

  systemSelect.replaceChildren();
  const detect = new Option('Detect from this page', DETECT, false, state.systemId === DETECT);
  systemSelect.append(detect);
  for (const system of settings.systems) {
    systemSelect.append(new Option(system.name, system.id, false, system.id === state.systemId));
  }

  const active = settings.systems.find((system) => system.id === state.systemId);
  swatches.replaceChildren();

  if (!active) {
    systemDetail.textContent = settings.systems.length
      ? 'Editing against the fonts, colours and spacing read off the page.'
      : 'No design system connected yet — values are read off the page.';
    return;
  }

  if (!active.tokens) {
    systemDetail.textContent = active.error ?? 'That system could not be read; the page is being detected instead.';
    return;
  }

  const { colors, typography, spacing, radius } = active.counts;
  systemDetail.textContent = `${active.shape} · ${colors} colours · ${typography} text styles · ${spacing} spacing · ${radius} radii`;
  for (const color of active.tokens.collections[0]?.colors.slice(0, 14) ?? []) {
    const chip = document.createElement('i');
    chip.className = 'swatch';
    chip.style.background = color.value;
    chip.title = `${color.label} · ${color.value}`;
    swatches.append(chip);
  }
}

function paint(state: TabState): void {
  const supported = state.origin !== null;

  siteLabel.textContent = state.origin ?? 'This page cannot be inspected';
  siteDot.classList.toggle('on', state.active);
  statusPill.classList.toggle('on', state.active);
  statusPill.querySelector('.dot')?.classList.toggle('on', state.active);
  statusText.textContent = state.active ? 'Running' : 'Off';

  toggle.disabled = !supported;
  toggle.textContent = state.active ? 'Stop inspecting' : 'Inspect this page';
  toggle.classList.toggle('primary', !state.active);

  controls.classList.toggle('hidden', !supported);
  unsupported.classList.toggle('hidden', supported);
  autoToggle.checked = state.autoStart;

  void paintSystem(state);
}

async function refresh(): Promise<void> {
  // The account first, and outside the early return below: a popup opened on a chrome:// tab can do
  // nothing about that page, but it can still sign you in.
  await paintAccount();
  const tab = await currentTab();
  if (!tab?.id) return;
  paint(await ask<TabState>({ type: 'state', tabId: tab.id }));
  await paintNotes(tab);
}

toggle.addEventListener('click', async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  toggle.disabled = true;
  paint(await ask<TabState>({ type: 'toggle', tabId: tab.id }));
});

systemSelect.addEventListener('change', async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  paint(await ask<TabState>({ type: 'setSite', tabId: tab.id, systemId: systemSelect.value }));
});

autoToggle.addEventListener('change', async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  paint(await ask<TabState>({ type: 'setAutoStart', tabId: tab.id, autoStart: autoToggle.checked }));
});

el('options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});

el('reload').addEventListener('click', async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  await ask({ type: 'reload', tabId: tab.id });
  window.close();
});

// The user may have rebound the shortcut; show what it actually is.
void chrome.commands.getAll().then((commands) => {
  const bound = commands.find((command) => command.name === 'toggle-inspector')?.shortcut;
  if (!bound) return;
  const keys = bound.split('+');
  el('shortcut').parentElement?.replaceChildren(
    document.createTextNode('Toggle anywhere with '),
    ...keys.flatMap((key) => {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      return [kbd, document.createTextNode(' ')];
    }),
  );
});

void refresh();
