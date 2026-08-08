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

Styles are injected automatically on first render — there is no CSS import to remember. (The
raw stylesheet is still exported as `@merakimind/design-inspector/design-tools.css` if you'd
rather bundle it yourself.)

```tsx
import { DesignTokensProvider, HandoffInspector } from '@merakimind/design-inspector';

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
