# @merakimind/design-inspector

A live, in-browser design inspection and handoff tool. Select any element on the page, edit its
color/spacing/typography visually, preview it across devices, run an accessibility audit, and
copy out a ready-to-paste CSS diff plus written instructions for adding the change to your
design system.

Extracted from the MERKAI-MIND marketing site's inspector so it can be reused in other projects.

## Install

```bash
npm install github:Itamardesign/Ai-Design-Last-Mile
```

`react` and `react-dom` (18 or 19) are peer dependencies and must already be in your project.
Node 18+ is required to install, because the package builds itself from source on install.

## Usage

Render `<HandoffInspector />` once, anywhere in your app. That's the whole setup — no CSS
import, no provider, no configuration:

```tsx
import { HandoffInspector } from '@merakimind/design-inspector';

export default function App() {
  return (
    <>
      {/* ...your app... */}
      <HandoffInspector />
    </>
  );
}
```

### How you actually see it

A floating **"Inspect"** button appears in the bottom corner of your running app. Click it to
open the panel, then hover and click any element on the page to select it. From there you can
edit its color, spacing and typography, preview it across device sizes, run an accessibility
audit, and copy out the resulting CSS.

`Esc` deselects the current element, and closes the inspector when nothing is selected.

It reads and writes the live DOM, so it works against your real rendered app, not a mock. Your
edits are visual only — nothing is written back to your source files; you copy the CSS out and
apply it yourself.

### Two things worth knowing

**Styles load themselves** on first render, so there is nothing to import. (The raw stylesheet
is still exported as `@merakimind/design-inspector/design-tools.css` if you'd rather bundle it.)

**It ships to production if you let it.** The component renders that launcher button for every
visitor. Gate it if you don't want that:

```tsx
{import.meta.env.DEV && <HandoffInspector />}   // Vite
{process.env.NODE_ENV !== 'production' && <HandoffInspector />}   // Next.js / CRA
```

### Optional: give it your design tokens

Wrapping in `DesignTokensProvider` lets the inspector suggest bindings against your own design
system instead of guessing. It is entirely optional — without it, the inspector detects your CSS
variables automatically and falls back to sensible defaults.

```tsx
import { DesignTokensProvider, HandoffInspector } from '@merakimind/design-inspector';

<DesignTokensProvider tokens={myTokens}>
  {/* ...your app... */}
  <HandoffInspector />
</DesignTokensProvider>
```

## Where its tokens come from

The inspector needs to know your project's design system (colors, spacing, radius, type scale)
to suggest bindings and write correct handoff CSS. It resolves that in priority order:

1. **`tokens` prop on `DesignTokensProvider`** — pass this if you already have a token source.
   Optionally generate it once at build time from a config file you already have:

   ```ts
   // scripts/build-inspector-tokens.ts (run with tsx/node, not bundled into your app)
   import { loadStaticDesignTokens } from '@merakimind/design-inspector/detect/loadStaticConfig.node';
   // Detects design-tokens.json / tokens.json, or tailwind.config.{js,cjs,mjs}, in your repo root.
   const tokens = await loadStaticDesignTokens();
   ```

2. **Live CSS custom properties** — if you don't pass `tokens`, the provider scans same-origin
   stylesheets for `--custom-properties` declared on `:root` and buckets them into colors /
   spacing / radius by shape. Works out of the box for any project already using CSS variables.

3. **Generated from page audit** — if neither of the above finds anything, the header shows a
   "Generate design system" button. Clicking it walks the live page's computed styles, clusters
   the colors/spacing/radius/font-sizes actually in use, and proposes a draft token set. This is
   a starting point for a human to review, not something to trust blindly — naming and
   clustering are heuristic.

4. **Generic fallback** — a small built-in placeholder token set, so the inspector never crashes
   even with zero setup.

The `source` field from `useDesignTokens()` tells you which of these is active.

## Two design-system collections

If your project has more than one design language (e.g. marketing vs. product), pass 2 entries
in `tokens.collections` — the inspector shows a switcher in its header. With 0 or 1 collections
the switcher is hidden.
