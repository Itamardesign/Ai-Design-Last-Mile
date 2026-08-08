# @merakimind/design-inspector

A live, in-browser design inspection and handoff tool. Select any element on the page, edit its
color/spacing/typography visually, preview it across devices, run an accessibility audit, and
copy out a ready-to-paste CSS diff plus written instructions for adding the change to your
design system.

Extracted from the MERKAI-MIND marketing site's inspector so it can be reused in other projects.

## Install

This currently ships as source (no publish step yet). Two ways to consume it:

1. **Git submodule / subtree** — pull `packages/design-inspector` into another repo and import
   directly; your bundler (Vite, webpack, etc.) transpiles the `.tsx`/`.ts` files like any other
   local source.
2. **Copy** — for a one-off project, copy the `src/` folder in and adjust the import path.

A real npm publish just needs `tsc -p tsconfig.json` run first (emits `dist/` with `.js` + `.d.ts`).

## Usage

```tsx
import { DesignTokensProvider, HandoffInspector } from '@merakimind/design-inspector';
import '@merakimind/design-inspector/design-tools.css';

export default function App() {
  return (
    <DesignTokensProvider tokens={myTokens /* optional — see below */}>
      {/* ...your app... */}
      <HandoffInspector />
    </DesignTokensProvider>
  );
}
```

`HandoffInspector` renders nothing until toggled open — wire that however you like (a query
param, a keyboard shortcut, a dev-only route). It reads/writes the live DOM directly, so it works
against your real rendered app, not a mock.

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
