/**
 * The settings page: connect design systems, and decide where each one applies.
 *
 * Parsing happens here rather than at use time so a bad file is caught while the designer is
 * looking at it — the page says what it recognised, what it ignored, and shows the palette back,
 * because "connected" is worth nothing if the tokens silently came out empty.
 */
import {
  DETECT,
  defaultSettings,
  makeSystem,
  readSettings,
  refreshSystem,
  writeSettings,
  type Settings,
  type StoredSystem,
} from './storage.js';
import { normalizeDesignTokens } from './tokens.js';
import { notesAsMarkdown, openNoteCount, readAllNotes, writeAllNotes, type NotePage } from './notes.js';
import type { Account } from './account.js';
import type { KeptHandoff } from './sync.js';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const nameInput = el<HTMLInputElement>('name');
const rawInput = el<HTMLTextAreaElement>('raw');
const urlInput = el<HTMLInputElement>('url');
const preview = el<HTMLDivElement>('preview');
const systemsList = el<HTMLDivElement>('systems');
const defaultSelect = el<HTMLSelectElement>('default-system');
const sitesTable = el<HTMLTableElement>('sites');
const sitesEmpty = el<HTMLParagraphElement>('sites-empty');
const autoTable = el<HTMLTableElement>('auto');
const autoEmpty = el<HTMLParagraphElement>('auto-empty');
const relax = el<HTMLInputElement>('relax');
const notesList = el<HTMLDivElement>('notes');
const notesEmpty = el<HTMLParagraphElement>('notes-empty');
const accountPanel = el<HTMLDivElement>('account');
const handoffsList = el<HTMLDivElement>('handoffs');
const handoffsEmpty = el<HTMLParagraphElement>('handoffs-empty');
const tabPaste = el<HTMLButtonElement>('tab-paste');
const tabUrl = el<HTMLButtonElement>('tab-url');

let mode: 'paste' | 'url' = 'paste';
// Starts from the defaults and is replaced by what is stored, so nothing has to await before the
// page's own listeners are wired up.
let settings: Settings = { ...defaultSettings };

function button(label: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.className = className;
  node.textContent = label;
  if (title) node.title = title;
  node.addEventListener('click', onClick);
  return node;
}

function systemOptions(select: HTMLSelectElement, selected: string): void {
  select.replaceChildren(new Option('Detect from the page', DETECT, false, selected === DETECT));
  for (const system of settings.systems) {
    select.append(new Option(system.name, system.id, false, system.id === selected));
  }
}

async function save(next: Settings): Promise<void> {
  settings = next;
  await writeSettings(next);
  render();
}

function swatchRow(system: StoredSystem): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'swatches';
  for (const color of system.tokens?.collections.flatMap((collection) => collection.colors).slice(0, 24) ?? []) {
    const chip = document.createElement('i');
    chip.className = 'swatch';
    chip.style.background = color.value;
    chip.title = `${color.label} · ${color.value}`;
    row.append(chip);
  }
  return row;
}

function systemCard(system: StoredSystem): HTMLDivElement {
  const card = document.createElement('div');
  card.className = `system${settings.defaultSystemId === system.id ? ' is-default' : ''}`;

  const head = document.createElement('div');
  head.className = 'between';

  const title = document.createElement('div');
  title.className = 'stack';
  title.style.gap = '2px';
  const heading = document.createElement('div');
  heading.className = 'row';
  const label = document.createElement('h3');
  label.style.fontSize = '12.5px';
  label.textContent = system.name;
  heading.append(label);

  if (settings.defaultSystemId === system.id) {
    const pill = document.createElement('span');
    pill.className = 'pill on';
    pill.textContent = 'Default';
    heading.append(pill);
  }
  if (!system.tokens) {
    const pill = document.createElement('span');
    pill.className = 'pill bad';
    pill.textContent = 'Unreadable';
    heading.append(pill);
  }

  const meta = document.createElement('p');
  meta.className = 'faint';
  const { colors, typography, spacing, radius } = system.counts;
  meta.textContent = system.tokens
    ? `${system.shape} · ${colors} colours · ${typography} text styles · ${spacing} spacing · ${radius} radii · updated ${new Date(system.updatedAt).toLocaleString()}`
    : (system.error ?? 'Nothing token-shaped was found in this file.');

  title.append(heading, meta);

  if (system.source === 'url' && system.url) {
    const source = document.createElement('p');
    source.className = 'faint mono truncate';
    source.textContent = system.url;
    title.append(source);
  }

  const actions = document.createElement('div');
  actions.className = 'row';

  if (settings.defaultSystemId !== system.id) {
    actions.append(
      button('Make default', 'ghost', () => void save({ ...settings, defaultSystemId: system.id })),
    );
  }

  if (system.source === 'url') {
    actions.append(
      button('Refresh', 'ghost', async () => {
        const refreshed = await refreshSystem(system);
        await save({
          ...settings,
          systems: settings.systems.map((entry) => (entry.id === system.id ? refreshed : entry)),
        });
      }),
    );
  }

  actions.append(
    button('Edit', 'ghost', () => {
      mode = system.source;
      setMode(mode);
      nameInput.value = system.name;
      if (system.source === 'url') urlInput.value = system.url ?? '';
      else rawInput.value = system.raw;
      validate();
      nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }),
    button('Remove', 'ghost danger', () => {
      const siteSystems = Object.fromEntries(
        Object.entries(settings.siteSystems).filter(([, id]) => id !== system.id),
      );
      void save({
        ...settings,
        systems: settings.systems.filter((entry) => entry.id !== system.id),
        siteSystems,
        defaultSystemId: settings.defaultSystemId === system.id ? DETECT : settings.defaultSystemId,
      });
    }),
  );

  head.append(title, actions);
  card.append(head);
  if (system.tokens?.collections.some((collection) => collection.colors.length)) card.append(swatchRow(system));

  for (const warning of system.warnings.slice(0, 3)) {
    const note = document.createElement('p');
    note.className = 'faint';
    note.textContent = `· ${warning}`;
    card.append(note);
  }
  return card;
}

function render(): void {
  systemsList.replaceChildren();
  if (!settings.systems.length) {
    const empty = document.createElement('p');
    empty.className = 'faint';
    empty.textContent = 'Nothing connected yet — the inspector reads the design language off each page instead.';
    systemsList.append(empty);
  } else {
    settings.systems.forEach((system) => systemsList.append(systemCard(system)));
  }

  systemOptions(defaultSelect, settings.defaultSystemId);

  const siteEntries = Object.entries(settings.siteSystems);
  sitesTable.replaceChildren();
  sitesEmpty.classList.toggle('hidden', siteEntries.length > 0);
  for (const [origin, systemId] of siteEntries) {
    const row = sitesTable.insertRow();
    const originCell = row.insertCell();
    originCell.className = 'mono truncate';
    originCell.textContent = origin;

    const pickCell = row.insertCell();
    pickCell.className = 'pick';
    const select = document.createElement('select');
    systemOptions(select, systemId);
    select.addEventListener('change', () =>
      void save({ ...settings, siteSystems: { ...settings.siteSystems, [origin]: select.value } }),
    );
    pickCell.append(select);

    const actionCell = row.insertCell();
    actionCell.className = 'act';
    actionCell.append(
      button(
        '✕',
        'ghost',
        () => {
          const { [origin]: _removed, ...rest } = settings.siteSystems;
          void save({ ...settings, siteSystems: rest });
        },
        'Remove this rule',
      ),
    );
  }

  autoTable.replaceChildren();
  autoEmpty.classList.toggle('hidden', settings.autoOrigins.length > 0);
  for (const origin of settings.autoOrigins) {
    const row = autoTable.insertRow();
    const originCell = row.insertCell();
    originCell.className = 'mono truncate';
    originCell.textContent = origin;
    const actionCell = row.insertCell();
    actionCell.className = 'act';
    actionCell.append(
      button(
        '✕',
        'ghost',
        () => void save({ ...settings, autoOrigins: settings.autoOrigins.filter((entry) => entry !== origin) }),
        'Stop starting automatically here',
      ),
    );
  }

  relax.checked = settings.relaxCsp;
}

/**
 * Every page you have left notes on, newest first, each one a click from being a ticket.
 *
 * Copying is markdown rather than a download: a review that needs a file opened is a review that
 * does not get read, and every tool a designer hands work to takes a paste.
 */
/**
 * The account panel: sign in, skip, or see what is syncing.
 *
 * Deliberately three lines and two buttons. The interesting decisions are all in account.ts; what is
 * left here is making the state legible — including the awkward one, where the stored intent says
 * "cloud" and Google has since revoked the token, which reads as signed in everywhere else and is a
 * mirror that has silently stopped.
 */
async function renderAccount(): Promise<void> {
  accountPanel.replaceChildren();

  const card = document.createElement('div');
  card.className = 'system';
  const head = document.createElement('div');
  head.className = 'between';

  const title = document.createElement('div');
  title.className = 'stack';
  title.style.gap = '2px';
  const heading = document.createElement('div');
  heading.className = 'row';
  const label = document.createElement('h3');
  label.style.fontSize = '12.5px';
  label.textContent = 'Checking…';
  heading.append(label);
  const meta = document.createElement('p');
  meta.className = 'faint truncate';
  const detail = document.createElement('p');
  detail.className = 'faint';
  title.append(heading, meta, detail);

  const actions = document.createElement('div');
  actions.className = 'row';
  head.append(title, actions);
  card.append(head);
  accountPanel.append(card);

  const account = (await chrome.runtime.sendMessage({ type: 'account' })) as Account | undefined;
  if (!account) {
    label.textContent = 'Unavailable';
    detail.textContent = 'The extension’s service worker did not answer. Reload the extension and try again.';
    return;
  }

  const signIn = (text: string) =>
    button(text, 'primary', async () => {
      label.textContent = 'Opening Google…';
      actions.replaceChildren();
      await chrome.runtime.sendMessage({ type: 'account:signIn' });
      await renderAccount();
      await renderHandoffs();
      // Signing in merges the cloud copy into this machine, so what is on screen is now stale.
      settings = await readSettings();
      render();
      await renderNotes();
    });

  if (account.mode === 'cloud' && account.profile) {
    const pill = document.createElement('span');
    pill.className = account.error ? 'pill warn' : 'pill on';
    pill.textContent = account.error ? 'not syncing' : 'syncing';
    label.textContent = account.profile.name || account.profile.email || 'Signed in';
    heading.append(pill);
    meta.textContent = account.profile.email ?? '';
    detail.textContent = account.error
      ? account.error
      : account.syncedAt
        ? `Notes, edits and handoffs last saved to your account ${new Date(account.syncedAt).toLocaleString()}.`
        : 'Notes, edits and handoffs will be saved to your account as you work.';
    if (account.error) actions.append(signIn('Sign in again'));
    actions.append(
      button('Sign out', 'ghost', async () => {
        await chrome.runtime.sendMessage({ type: 'account:signOut' });
        await renderAccount();
        await renderHandoffs();
      }, 'Stops syncing. Nothing on this machine is deleted.'),
    );
    return;
  }

  if (account.mode === 'local') {
    label.textContent = 'This machine only';
    meta.textContent = 'Nothing is sent anywhere.';
    // A sign-in that failed leaves its reason on an account still in `local`, and saying nothing here
    // would make the button look like it did nothing at all.
    detail.textContent =
      account.error ?? 'Your notes and edits are kept in extension storage, which survives a site clearing its own.';
    if (account.error) {
      const pill = document.createElement('span');
      pill.className = 'pill warn';
      pill.textContent = 'sign-in failed';
      heading.append(pill);
    }
    actions.append(signIn('Sign in with Google'));
    return;
  }

  label.textContent = 'Not signed in';
  meta.textContent = 'Choose once — you can change it here whenever you like.';
  detail.textContent = account.error ?? 'Sign in to keep your work across machines, or skip to keep it here.';
  actions.append(
    signIn('Sign in with Google'),
    button('Skip', 'ghost', async () => {
      await chrome.runtime.sendMessage({ type: 'account:skip' });
      await renderAccount();
    }, 'Skip — keep everything on this machine'),
  );
}

/** The kept handoffs. Empty and silent when there is no account — there is nothing to have kept. */
async function renderHandoffs(): Promise<void> {
  handoffsList.replaceChildren();
  const answer = (await chrome.runtime.sendMessage({ type: 'handoffs' })) as { handoffs?: KeptHandoff[] } | undefined;
  const handoffs = answer?.handoffs ?? [];
  handoffsEmpty.classList.toggle('hidden', handoffs.length > 0);

  for (const handoff of handoffs) {
    const card = document.createElement('div');
    card.className = 'system';

    const head = document.createElement('div');
    head.className = 'between';
    const title = document.createElement('div');
    title.className = 'stack';
    title.style.gap = '2px';

    const label = document.createElement('h3');
    label.style.fontSize = '12.5px';
    label.textContent = handoff.title || handoff.url;

    const meta = document.createElement('p');
    meta.className = 'faint mono truncate';
    meta.textContent = handoff.url;

    const when = document.createElement('p');
    when.className = 'faint';
    const by = handoff.author ? `${handoff.author} · ` : '';
    when.textContent = `${by}${handoff.changeCount} change${handoff.changeCount === 1 ? '' : 's'} · ${handoff.noteCount} note${handoff.noteCount === 1 ? '' : 's'} · ${handoff.issueCount} a11y · ${new Date(handoff.savedAt).toLocaleString()}`;

    title.append(label, meta, when);

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.append(
      button('Copy markdown', 'ghost', () => void navigator.clipboard.writeText(handoff.markdown)),
      button('Open page', 'ghost', () => void chrome.tabs.create({ url: handoff.url })),
    );
    if (handoff.screenshotUrl) {
      const shot = handoff.screenshotUrl;
      actions.append(button('Screenshot', 'ghost', () => void chrome.tabs.create({ url: shot })));
    }

    head.append(title, actions);
    card.append(head);
    handoffsList.append(card);
  }
}

async function renderNotes(): Promise<void> {
  const pages = await readAllNotes();
  const entries = Object.entries(pages).sort(([, a], [, b]) => b.savedAt - a.savedAt);

  notesList.replaceChildren();
  notesEmpty.classList.toggle('hidden', entries.length > 0);

  for (const [key, page] of entries) {
    const card = document.createElement('div');
    card.className = 'system';

    const head = document.createElement('div');
    head.className = 'between';

    const title = document.createElement('div');
    title.className = 'stack';
    title.style.gap = '2px';

    const heading = document.createElement('div');
    heading.className = 'row';
    const label = document.createElement('h3');
    label.style.fontSize = '12.5px';
    label.textContent = page.title || page.url;
    heading.append(label);

    const open = openNoteCount(page.notes);
    const pill = document.createElement('span');
    pill.className = open ? 'pill warn' : 'pill on';
    pill.textContent = open ? `${open} open` : 'all resolved';
    heading.append(pill);

    const meta = document.createElement('p');
    meta.className = 'faint mono truncate';
    meta.textContent = page.url;

    const when = document.createElement('p');
    when.className = 'faint';
    when.textContent = `${page.notes.length} note${page.notes.length === 1 ? '' : 's'} · last saved ${new Date(page.savedAt).toLocaleString()}`;

    title.append(heading, meta, when);

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.append(
      button('Open page', 'ghost', () => void chrome.tabs.create({ url: page.url })),
      button('Copy as markdown', 'ghost', async () => {
        await navigator.clipboard.writeText(notesAsMarkdown(page));
        pill.textContent = 'copied';
        window.setTimeout(() => renderNotes(), 900);
      }),
      button('Delete', 'ghost danger', async () => {
        const next = await readAllNotes();
        delete next[key];
        await writeAllNotes(next);
        await renderNotes();
      }),
    );

    head.append(title, actions);
    card.append(head);

    const preview = document.createElement('div');
    preview.className = 'stack';
    preview.style.gap = '3px';
    for (const note of page.notes.slice(0, 3)) {
      const line = document.createElement('p');
      line.className = 'faint truncate';
      line.textContent = `${note.resolved ? '✓' : '·'} ${note.label}: ${note.text}`;
      preview.append(line);
    }
    if (page.notes.length > 3) {
      const more = document.createElement('p');
      more.className = 'faint';
      more.textContent = `+${page.notes.length - 3} more`;
      preview.append(more);
    }
    card.append(preview);
    notesList.append(card);
  }
}

/** Live feedback on the pasted JSON — what was recognised, and anything that was guessed. */
function validate(): void {
  if (mode === 'url') {
    preview.classList.add('hidden');
    return;
  }
  const text = rawInput.value.trim();
  if (!text) {
    preview.classList.add('hidden');
    return;
  }
  const result = normalizeDesignTokens(text, nameInput.value || 'Design system');
  preview.classList.remove('hidden');
  preview.className = `notice ${result.tokens ? 'good' : 'bad'}`;
  const { colors, typography, spacing, radius } = result.counts;
  preview.textContent = result.tokens
    ? `Read as ${result.shape}: ${colors} colours, ${typography} text styles, ${spacing} spacing, ${radius} radii.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`
    : result.warnings.join(' ');
}

function setMode(next: 'paste' | 'url'): void {
  mode = next;
  tabPaste.setAttribute('aria-selected', String(next === 'paste'));
  tabUrl.setAttribute('aria-selected', String(next === 'url'));
  el('paste-field').classList.toggle('hidden', next !== 'paste');
  el('url-field').classList.toggle('hidden', next !== 'url');
  validate();
}

tabPaste.addEventListener('click', () => setMode('paste'));
tabUrl.addEventListener('click', () => setMode('url'));
rawInput.addEventListener('input', validate);
nameInput.addEventListener('input', validate);

el('clear').addEventListener('click', () => {
  nameInput.value = '';
  rawInput.value = '';
  urlInput.value = '';
  preview.classList.add('hidden');
});

el('connect').addEventListener('click', async () => {
  const name = nameInput.value.trim();

  if (mode === 'url') {
    const url = urlInput.value.trim();
    if (!url) return;
    const stub = makeSystem(name || 'Design system', '{}', 'url', url);
    const fetched = await refreshSystem(stub);
    if (!fetched.tokens) {
      preview.classList.remove('hidden');
      preview.className = 'notice bad';
      preview.textContent = fetched.error ?? 'Nothing token-shaped at that URL.';
      return;
    }
    await connect(fetched);
    return;
  }

  const raw = rawInput.value.trim();
  if (!raw) return;
  const system = makeSystem(name, raw, 'paste');
  if (!system.tokens) {
    validate();
    return;
  }
  await connect(system);
});

/** Adds the system, replacing one of the same name so "Edit" updates rather than duplicates. */
async function connect(system: StoredSystem): Promise<void> {
  const existing = settings.systems.find((entry) => entry.name === system.name);
  const merged = existing ? { ...system, id: existing.id } : system;
  const systems = existing
    ? settings.systems.map((entry) => (entry.id === existing.id ? merged : entry))
    : [...settings.systems, merged];

  // The first system a designer connects is what they mean to use; don't make them also pick it.
  const defaultSystemId = settings.defaultSystemId === DETECT && !existing ? merged.id : settings.defaultSystemId;

  await save({ ...settings, systems, defaultSystemId });
  nameInput.value = '';
  rawInput.value = '';
  urlInput.value = '';
  preview.classList.remove('hidden');
  preview.className = 'notice good';
  preview.textContent = `“${merged.name}” connected · ${merged.counts.colors} colours · ${merged.counts.typography} text styles.`;
}

defaultSelect.addEventListener('change', () => void save({ ...settings, defaultSystemId: defaultSelect.value }));

relax.addEventListener('change', async () => {
  await save({ ...settings, relaxCsp: relax.checked });
  await chrome.runtime.sendMessage({ type: 'setRelaxCsp', relaxCsp: relax.checked });
});

void (async () => {
  settings = await readSettings();
  render();
  await renderNotes();
  await renderAccount();
  await renderHandoffs();
})();

// Notes arrive while the page is open — a review happening in another tab should show up here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.notes) void renderNotes();
  // The mirror stamps `syncedAt` on the account as it pushes, so the “last saved” line stays
  // true while this page is open in another tab.
  if (area === 'local' && changes.account) void renderAccount();
});
