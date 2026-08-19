# Design Inspector — Chrome extension

The same tool as the React package, on any website. Click the toolbar button, click an element,
edit it, copy the CSS out. Nothing is installed into the site and no source file is touched.

---

## Install it

You need Node 18+ and this repository.

```bash
npm install
```

```bash
npm run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose `packages/design-inspector/extension/dist`

The purple mark appears in the toolbar. Pin it, and you are done.

To hand the folder to someone else, `npm run pack:extension` writes a
`meraki-design-inspector-<version>.zip` beside it — the same file the Chrome Web Store takes.

---

## Use it

| | |
|---|---|
| **Toolbar button** | Opens the popup: turn the inspector on, pick the design system, set it to start automatically here |
| **`Alt` `Shift` `D`** | Toggles the inspector on the current tab, without the popup |
| **The `Inspect` tab** | Appears on the page once the inspector is running — click it to open the panel |
| **`Esc`** | Steps back one layer: an open note, then the selection, then system check, then the tool |

Everything the package does, the extension does: click any element to select it, edit its content,
typography, fill and layout, preview the page at real device sizes, run the accessibility checks,
leave notes, and copy your changes out as CSS or as written handoff instructions.

### System check — where the page leaves the system

The radar button in the panel header draws the design system **on the page**. Every value that is
not a token is outlined where it sits: amber for near a token, red for genuinely one-off. A badge on
each box opens the list of what drifted, and any value close enough to a token carries a
**Snap to <token>** button — one click puts it on the system.

**Snap all** does the whole page at once, and says so with an **Undo** you have nine seconds to
take — undoing puts back exactly what was there, including nothing where there was nothing. Every
snap is also an ordinary tracked change: it shows up in *Designer changes*, copies out as CSS, and
resets with everything else.

The score describes the part of the page it measured. One pass covers 900 elements and draws the 140
busiest spots; past that the HUD says how much it left out, because a partial score stated
confidently is just a wrong number.

Without a connected design system this measures against the values detected from the page, which is
useful for spotting inconsistency but is not the same question. Connect real tokens for the real
answer.

### Notes you can see

Notes are pinned to the elements they are about, and numbered — "note 3" means the same thing in the
panel, on the page and inside the device preview.

- **Hover a pin** and the note opens next to it — the text, who wrote it, when, and an **Open note**
  button. It stays put while you move onto it, so you can read a long note or click through.
- **Click a pin** (or **Open note**) for the whole thread over a dimmed page — read it, reply to it
  and resolve it without leaving. Enter posts, Shift + Enter breaks the line, Esc closes.
- **Resolve** rather than delete, so a review reads as a list of decisions.
- **Sign your notes** once in the composer and every later note carries your name.
- **Pins stay visible with the panel closed**, so walking up to a page shows what has already been said.
- **Notes survive a deploy.** Each one remembers what its element looked like — the tag, its text,
  its stable classes, the nearest named ancestor — so when the markup moves underneath it, the note
  finds its element again and quietly rewrites its own address. Pins also follow the page live: a
  modal opening or a route changing moves them with it.

### The device preview on a real site

The preview loads the page inside itself, and on any site with a feed, an experiment or a
personalised block, the framed copy is simply not the same tree as the page behind it. Picking an
element there used to look up its position in the live page, fail, and refuse to edit — which made
the preview useless on exactly the sites it was most needed for.

It now edits the framed element in place when the live page has no twin for it. One consequence
worth knowing: those edits belong to that frame, so reloading it, rotating it or switching device
starts them over. Edits to elements that exist on both are unaffected.

### Sites that fight back

Plenty of real sites write `!important` in their own stylesheets, and an inline style loses to one —
which used to mean clicking a colour swatch did nothing at all while the tool cheerfully recorded
the change. Every style edit now checks whether the page declares that property `!important` for
that element, and outranks it when it does. The copied CSS carries the same `!important`, so what
you paste reproduces what you saw.

Edits are live-preview only. Reload and they are gone — copy anything you want to keep.

**A badge reading `ON`** means the inspector is running on that tab. It stays on across link clicks
and reloads until you switch it off.

---

## Connect your design system

Without a design system the inspector reads the page: its fonts, its palette, its type scale, its
spacing. That is a good guess and it is enough to work with.

Connecting real tokens does two things: the swatches and text styles become *yours*, and the three
features that need a source of truth unlock — **token binding**, the **page token audit**, and
**apply to all variants**.

Open **Manage design systems** from the popup (or right-click the toolbar icon → Options) and either
paste a tokens file or point at a URL. These are all read:

| Format | Looks like |
|---|---|
| Plain / hand-written | `{ "colors": { "brand-500": "#7C3CFF" }, "spacing": { "md": "16px" } }` |
| DTCG / Style Dictionary | `{ "color": { "brand": { "500": { "$value": "#7C3CFF", "$type": "color" } } } }` |
| Tokens Studio | the same, with or without the `$` |
| Tailwind config (as JSON) | `{ "theme": { "extend": { "colors": … , "borderRadius": … } } }` |
| Inspector tokens | the `DesignTokens` shape the package's `DesignTokensProvider` takes |
| An unlabelled export | anything else — values are classified by what they look like |

The settings page tells you what it read back — how many colours, text styles, spacing steps and
radii, and the palette itself — so a file that parsed but came out empty is obvious immediately.

**A URL system re-fetches itself** when it is more than five minutes old, so a tokens file published
by your build stays current without anyone pressing anything.

**Which system applies where.** One system is the default for every site. Any site can override it
from the popup — useful when the marketing site and the product are different design languages.

---

## What it does to the page

Worth knowing, because it runs on sites you do not own.

- **It only runs where you turn it on.** No content script is registered for all sites; the script
  is injected into the tab you activate, and into sites you explicitly add to "start automatically".
- **The panel is inside a shadow root**, so the site's CSS cannot restyle it and its CSS cannot
  leak onto the site.
- **`Content-Security-Policy` and `X-Frame-Options` are stripped on that tab while it runs.** The
  device preview loads the page inside itself and font previews download webfonts; strict sites
  forbid both. The rule is pinned to the one tab and dropped the moment you switch off — and you can
  turn the whole behaviour off in settings, at the cost of those two features.
- **It writes to the site's `localStorage`** (under `meraki-…` and `design-inspector-…` keys) to keep
  your notes and unsaved edits across a reload — and mirrors the notes into extension storage, so a
  site clearing its own storage cannot take your review with it. The toolbar badge shows how many
  notes on the page are still open, and **Copy review** in the popup puts the whole thing on the
  clipboard as markdown.
- **It contacts `fonts.googleapis.com`** for the panel's own typeface, and again for the ten Google
  families when you open the font picker. Nothing else leaves the machine: tokens, comments and
  edits are all local.

---

## Develop it

```bash
npm run dev:extension
```

Rebuilds on save. Press the reload arrow on the extension card in `chrome://extensions` to pick up
changes to the service worker or the content script.

```bash
npm run test:extension
```

Builds, then runs the token-format tests, the note-mirror tests (restore after a site clears its
storage, open counts, markdown export) and the service-worker tests (injection, re-injection after a
navigation, header rules, per-site tokens).

There is also a harness page for looking at the panel without installing anything — a deliberately
hostile host page with its own resets, fonts and `!important` rules:

```bash
node extension/test/server.mjs
```

Then open `http://localhost:5177/` and press **inspector: on**. `/preview/options` and
`/preview/popup` render the extension's own two pages against a fake `chrome`.

### How it is put together

| File | What it does |
|---|---|
| `src/content.tsx` | Mounts the React inspector into a shadow root on the page |
| `src/background.ts` | Decides which tabs it runs on; injects, re-injects, and scopes the header rules |
| `src/tokens.ts` | Turns any of the accepted token formats into the shape the inspector needs |
| `src/storage.ts` | Connected systems and where they apply |
| `src/popup.*`, `src/options.*` | The extension's own two pages |
| `src/webfont.ts` | Loads webfonts as bytes, so a strict site's CSP cannot block previews |
| `src/notes.ts` | Mirrors review notes into extension storage, counts open ones, exports markdown |
| `src/coach.ts` | The one-time "the inspector is on" card shown on first activation |
| `build.mjs` | esbuild bundle; compiles `../src` directly, so component and extension never drift |

The inspector itself is not forked or copied: `content.tsx` imports `../../src/HandoffInspector.tsx`,
the same file the npm package ships. One edit changes both.
