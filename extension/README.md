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

### The Handoff tab

The third tab is the document the session produces, arranged the way the person receiving it reads:
**by element**. What was said about it, what changed on it, and what is wrong with it — together,
rather than three lists to cross-reference by selector.

- **One CSS rule per selector.** Twenty edits on a button come out as one `button.cta { … }` block,
  not twenty, with `!important` where the site's CSS had to be outranked.
- **Token names in the output** — `background-color: #7C3CFF; /* brand/500 */` — so a value that is
  on the system says so.
- **Undo one change** without resetting the rest: hover any row and press ×.
- **Accessibility findings** for every element in the report, because contrast and target size are
  exactly what a developer needs handed to them.
- **Markdown out**, for a ticket or a pull request, or **Download .md** for an attachment. On top of
  that the extension can **capture the tab** and save the screenshot beside it.
- Edits applied to every variant of a component are marked with the count they reached.

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
**apply to all variants**. The handoff then names the token behind each value it hands over.

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

## Your account, or not

The extension asks once, on the settings page, and both answers are real answers:

- **Sign in with Google** — review notes, unfinished style edits and kept handoffs are mirrored to
  Firebase under your own id. Open the same page on another machine, signed in as the same person, and
  the review is there.
- **Skip** — nothing ever leaves the machine. Notes and edits are still kept in extension storage, so a
  site clearing its own `localStorage` cannot take them; they just stay here. The choice is remembered,
  not re-asked, and you can change it on the settings page whenever you like.

Everything works identically either way. Local storage is the source of truth and the cloud follows
it — nothing in the panel waits on a network round-trip, and a failed push is retried rather than
shown to you as an error.

### What syncs

| | Synced | Why |
| --- | --- | --- |
| Review notes | yes | The one thing you cannot recreate. Notes from two machines are merged, never replaced. |
| Unfinished style edits | yes | So a half-finished pass resumes where you left it. |
| Kept handoffs | yes | **Save to my account** in the Handoff tab keeps the document as it read when you handed it over, with its screenshot. |
| Connected design systems | no | They are tens of kilobytes of tokens and usually come from a URL your build already publishes; the settings page is the right place to connect them per machine. |

**How a conflict is settled.** Notes merge per note: two machines that each left different notes end up
with both. When the *same* note differs — a resolved tick moved elsewhere — the more recently saved copy
wins. Style edits do not merge; the newer page replaces the older, because two values for the same
`padding` are alternatives rather than additions and half of each is a state nobody produced. The rules
live in `extension/src/merge.ts` and are tested in `extension/test/merge.test.mjs`.

**Signing in never costs you work.** Reviewing twenty pages before you ever sign in is the expected
path: on sign-in the cloud copy is merged into this machine and the result pushed back, so an empty
account cannot wipe a week of notes.

### Signing in — the one-time setup

Google sign-in needs an OAuth client, and an OAuth client is tied to a fixed extension id. Neither can
be created from the repo, so `extension/manifest.json` ships a placeholder and the settings page says
so plainly until it is replaced. **Skip works immediately; only sign-in is gated on this.**

1. **Fix the extension id.** Load `extension/dist` unpacked at `chrome://extensions` and copy the id.
   To keep that id across machines and reinstalls, press **Pack extension** once, keep the generated
   `.pem` somewhere safe, and add its public key to the manifest as `key`:

   ```bash
   openssl rsa -in your-extension.pem -pubout -outform DER | openssl base64 -A
   ```

2. **Create the OAuth client** in the Google Cloud console for **the same project as Firebase**
   (`ai-last-mile`) — Firebase only accepts a Google token whose audience is a client in its own
   project. *APIs & Services → Credentials → Create credentials → OAuth client ID*, application type
   **Chrome Extension**, item id the one from step 1.
3. **Paste the client id** into `oauth2.client_id` in `extension/manifest.json`, replacing
   `REPLACE_ME.apps.googleusercontent.com`.
4. **Enable the provider** in the Firebase console: *Authentication → Sign-in method → Google*.
5. **Deploy the security rules** (below). Do this before anybody signs in, not after.

Sign-in uses `chrome.identity.getAuthToken`, which reuses the Google account already signed in to
Chrome — usually no password prompt at all — and trades that token for a Firebase credential.
`signInWithPopup` is not an option: it needs a web origin to redirect back to, and an extension does
not have one.

### The rules are the security

The `apiKey` in `extension/src/firebase.ts` is not a secret — every Firebase web key is public, and all
it does is identify the project. What actually protects one designer's review from everyone else is:

```bash
firebase deploy --only firestore:rules,storage
```

`firebase/firestore.rules` and `firebase/storage.rules` allow a signed-in user to read and write their
own workspace and nothing else. Both files carry the reasoning inline, including the one line that
changes when a workspace becomes a shared, team-wide thing.

### The shape of it

    workspaces/{workspaceId}/notes/{pageId}      one page's review notes
    workspaces/{workspaceId}/edits/{pageId}      one page's unfinished style edits
    workspaces/{workspaceId}/handoffs/{docId}    a kept handoff
    handoffs/{workspaceId}/{docId}.png           its screenshot, in Cloud Storage

`workspaceId` is your own uid today. It exists as a named concept rather than `users/{uid}` so that
sharing a review with a team later changes what that value *is*, not the shape of any path — a value
change and one rules function, instead of migrating every document.

Four constraints shape the code, all of them Manifest V3:

- The SDK is **bundled**, never fetched — MV3 forbids remote code. That is also why
  `firebase/analytics` is not used: it injects a remote script and needs a `document`, and the service
  worker has neither.
- **Auth uses `initializeAuth` with IndexedDB persistence**, because the default persistence chain
  starts at `localStorage`, which a service worker does not have.
- **The worker imports Firebase lazily.** It restarts for every navigation and badge repaint, almost
  none of which have anything to do with the cloud.
- **The screenshot goes to Cloud Storage, not Firestore.** A document is capped at 1MiB and a
  full-page PNG routinely beats that.

Pushes are coalesced on a short timer, because one drag of a slider commits many edits to the same
page. A worker evicted between the change and the push leaves a marker in `chrome.storage.session`, and
the next worker to start finds it and sends everything — so an eviction costs a redundant write rather
than a machine that is quietly out of date.

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
  families when you open the font picker.
- **It sends your notes, edits and kept handoffs to Firebase** — only if you signed in, and only your
  own. Skip on the settings page and nothing leaves the machine at all. Connected design systems are
  never uploaded either way.

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
