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
})();

// Notes arrive while the page is open — a review happening in another tab should show up here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.notes) void renderNotes();
});
