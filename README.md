# @merakimind/design-inspector

A live, in-browser design inspection and handoff tool. Click any element on your running app,
edit its colour, spacing and typography visually, preview it across device sizes, check
accessibility, and copy out ready-to-paste CSS plus written handoff instructions.

Your source files are never touched — edits are live-preview only. You copy the result out.

---

## Install

### Requirements

Before you start, make sure you have:

| | |
|---|---|
| **Node** | 18 or newer — the package compiles itself when you install it |
| **React** | 18 or 19, already in your project (it's a peer dependency, not bundled) |
| **A bundler** | Vite, Next.js, Webpack, Parcel — anything normal |

### Step 1 — install the package

```bash
npm install github:Itamardesign/Ai-Design-Last-Mile
```

This takes ~40 seconds. It's slower than a normal install because the package builds from
source on your machine. That's expected — wait for it to finish.

Using yarn or pnpm instead:

```bash
yarn add github:Itamardesign/Ai-Design-Last-Mile
```

```bash
pnpm add github:Itamardesign/Ai-Design-Last-Mile
```

### Step 2 — add the component

Render `<HandoffInspector />` **once**, anywhere in your app. Put it at the end of your root
component. There is nothing else to configure — no CSS import, no provider, no setup file.

```tsx
import { HandoffInspector } from '@merakimind/design-inspector';

export default function App() {
  return (
    <>
      {/* ...your whole app... */}
      <HandoffInspector />
    </>
  );
}
```

**Next.js App Router users:** the file you put this in must be a client component. Add
`'use client'` at the very top of that file, or drop `<HandoffInspector />` into one you already
have. Without it Next.js will error, because the inspector uses browser APIs.

### Step 3 — open it

Start your app as usual, then **add `?designmode=true` to the URL**:

```
http://localhost:5173/?designmode=true
```

A floating **"Inspect"** button appears in the corner of the page. Click it, then click any
element on your page to select it.

That's the whole install. If the button doesn't appear, see [Troubleshooting](#troubleshooting).

---

## Using it

- **Click any element** to select it — including elements nested inside other elements.
- **Edit** its content, typography, fill and layout from the panel on the right.
- **Preview** the page at real device sizes from the *Device preview* section.
- **Check accessibility** — contrast, touch targets, readable type, focus states.
- **Copy your changes** from *Designer changes* at the bottom: CSS, or written instructions.
- **`Esc`** deselects the current element; press it again to close the inspector.

Edits apply to the live page only. Refresh and they're gone — copy anything you want to keep.

### It reads your design language automatically

You don't have to configure fonts or colours. When it opens, the inspector reads the page and
picks up:

- **The fonts your site actually uses** — grouped separately from system fonts and the 10 most
  popular Google Fonts, each previewed in its own typeface.
- **Your colour palette** — sorted by role (accent, text, surface, border), shown as swatches.
- **Your type scale** — family, size, weight, line-height and letter-spacing per text style.
- **Your spacing and radius scale**, plus any `--custom-properties` you declare on `:root`
  (those keep your own token names).

---

## Shipping it safely

**The inspector is off unless the URL says otherwise.** Without `?designmode=true` it renders
nothing at all — no button, no event listeners, not even its stylesheet. It is safe to leave
mounted in a production build, and sending a colleague a link with `?designmode=true` is all
they need to start inspecting.

If you'd rather control that yourself, pass `enabled`:

```tsx
<HandoffInspector enabled={import.meta.env.DEV} />                    {/* Vite */}
<HandoffInspector enabled={process.env.NODE_ENV !== 'production'} />  {/* Next.js / CRA */}
```

`enabled` always wins — `enabled={false}` keeps it off even with `?designmode=true` in the URL.

---

## Troubleshooting

**The "Inspect" button doesn't appear.**
Check the URL really ends with `?designmode=true` (lowercase, and `true` — `?designmode=yes`
won't work). If your URL already has a query string, join it with `&`:
`http://localhost:3000/dashboard?tab=1&designmode=true`.

**Next.js: "You're importing a component that needs useState".**
Add `'use client'` to the top of the file containing `<HandoffInspector />`. See Step 2.

**The install seems to hang.**
It's compiling from source. Give it a minute. If it genuinely fails, check you're on Node 18+
with `node -v`.

**`npm error could not determine executable to run` or a build error on install.**
Your npm is likely skipping install scripts. Reinstall without `--ignore-scripts`.

**Some sections are greyed out and won't open.**
That's intended — see below.

---

## Optional: connect your design system

Everything above works with zero configuration. But three features stay **locked** until you
supply real tokens, because detected values are a good guess, not a source of truth:

- **Token binding** — bind a property to a named token
- **Page token audit** — find values that drift from your system
- **"All variants"** — apply one edit to every matching component

Hovering a locked control explains this. To unlock them, wrap your app in
`DesignTokensProvider` and pass tokens:

```tsx
import { DesignTokensProvider, HandoffInspector } from '@merakimind/design-inspector';
import tokens from './design-tokens.json';

<DesignTokensProvider tokens={tokens}>
  {/* ...your app... */}
  <HandoffInspector />
</DesignTokensProvider>
```

If you already keep tokens in a config file, generate them once at build time:

```ts
// scripts/build-inspector-tokens.ts — run with node/tsx, not bundled into your app
import { loadStaticDesignTokens } from '@merakimind/design-inspector/detect/loadStaticConfig.node';

// Finds design-tokens.json / tokens.json, or tailwind.config.{js,cjs,mjs}, in your repo root.
const tokens = await loadStaticDesignTokens();
```

### Where tokens come from, in priority order

1. **The `tokens` prop** on `DesignTokensProvider` — authoritative, and unlocks the features above.
2. **Your `:root` CSS custom properties** — merged with what the page renders, so your own token
   names are kept and any gaps are filled in.
3. **The rendered page** — fonts, colours, spacing and radii read from computed styles.
4. **A generic fallback**, so the inspector never breaks on a page with nothing to read.

`useDesignTokens().source` tells you which is active.

### More than one design language

If your project has two (say marketing and product), pass two entries in `tokens.collections` —
the inspector shows a switcher in its header. With one collection the switcher is hidden.

---

## API

| Export | What it is |
|---|---|
| `<HandoffInspector enabled?>` | The tool itself. Render once. |
| `<DesignTokensProvider tokens?>` | Optional. Supplies your design system. |
| `useDesignTokens()` | Active tokens and their `source`. |
| `detectTypographyFromPage()` | Text styles in use on the page. |
| `detectColorsFromPage()` | Palette by role. |
| `detectFontStacksFromPage()` | Fonts in use, with their full stacks. |
| `resolveDetectedTokens()` | Everything above, as one `DesignTokens`. |
| `DESIGN_MODE_PARAM` | The `'designmode'` string, if you need it. |

One note on privacy: the font picker fetches the 10 Google families **only** when you open it,
so a page that never opens the picker never contacts `fonts.googleapis.com`.
