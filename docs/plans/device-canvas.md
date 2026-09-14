# Plan: the device frame becomes the workspace

Status: Phase 1 shipped. Phase 2.1–2.2 (move, snapping, guides) and Phase 4 (layers) shipped, plus flip/rotate/duplicate/hide from the keyboard map; 2.3 (resize snapping), 2.4 (Alt-measure) and Phase 3 (panel restructure) remain · Scope: `src/HandoffInspector.tsx`, `src/design-tools.css` (the extension picks both up unchanged)

## Why

Today the tool opens on the live page with a floating panel over it. The panel covers the page, the
selection chrome fights the site's own hover states, and fixed headers scroll under the overlay. The
device preview (`DeviceOverlay`) already solves all of that: the page runs inside an iframe on a
stage, the panel sits beside it, nothing overlaps. It is the right workspace — it is just dressed
as a secondary "responsive check" dialog, with a toolbar, a footer readout, a health banner and a
sweep report stacked around it.

The goal is Figma's workspace, one to one:

```
┌──────────────────────────────────────────────────────┬──────────────┐
│  [ 📱 💻 🖥  Desktop 1440 ▾  ⟳ ]        (top-centre)   │              │
│                                                      │  Properties  │
│                                                      │  panel       │
│              ┌────────────────────────┐              │  (flush,     │
│              │                        │              │   full       │
│              │   the page, framed     │              │   height,    │
│              │                        │              │   280px)     │
│              └────────────────────────┘              │              │
│                                                      │              │
│        [ Move V | Comment C | Hand ␣ ]  [ 100% ▾ ]   │              │
└──────────────────────────────────────────────────────┴──────────────┘
```

Three surfaces, nothing else persistent: **canvas**, **one panel**, **one tool pill**. Everything
that is not one of those three either moves into the panel or goes.

Design principles the implementing agent should hold to:

1. **Canvas is quiet.** Flat grey, no gradient, no blur. The only colour on the canvas is the
   selection blue and the snap-guide red. Status is never a banner on the canvas.
2. **One place for information about the selection: the panel.** Dimensions, padding, font size,
   issues — the panel already has fields for all of these. Do not repeat them in a readout.
3. **Text explains on hover, not on screen.** Hints ("drag the handles…", "pick an element…")
   become tooltips or go away. The empty state is one line.
4. **Hide what does not apply.** A section that cannot act on the selected element is not shown
   collapsed — it is not shown.
5. **Figma's keys and gestures, verbatim,** where the DOM allows the same meaning.

---

## Phase 1 — Make the frame the default, strip it to a canvas

### 1.1 Open into the frame

- `toggleInspector` (≈ line 3506): back to `openDevice('desktop')` on open. The comment above it
  ("The live page is the canvas…") is reversed — rewrite it.
- The live-page mode stays as an escape hatch, not a default: keep the `Device` button's inverse
  (a `Live page` action in the frame-preset pill's overflow menu, see 1.3). Everything gated on
  `!deviceOpen` (lines ≈ 4761–4813) keeps working there; do not delete that path in this phase.
- **Esc no longer closes the overlay.** Remove `onClose` from both Escape handlers in
  `DeviceOverlay` (≈ 2730 and 2824). Esc inside the frame follows the same ladder as the live page:
  open note → deselect/select parent → nothing. Closing the tool is the panel's X or `Alt+Shift+D`.
- `hidden` (the "mounted but invisible" state) remains for the live-page escape hatch.

### 1.2 Overlay layout

`.hi-device-overlay` (css ≈ 789):

- `background`: flat. Use the tokens the canvas toolbar already uses — `#1e1e1e` canvas,
  `#2c2c2c` chrome, `#444` borders, `#0d99ff` accent. Remove `backdrop-filter`, remove the radial
  gradient, remove `hi-device-enter` animation (a workspace does not slide in).
- Grid becomes two columns, one row: `grid-template-columns: minmax(0,1fr) var(--hi-panel-width)`
  with `--hi-panel-width: 280px`. Drop the `padding-right: 484px` / `padding-left: 514px` trick and
  the `min-width: 1120px` media query. The panel (`aside.hi-panel`) renders **inside** the overlay
  as the second column when `deviceOpen`, flush to the edge, full height, no border-radius, no
  shadow, no enter animation. Dock-left is the same grid with the columns swapped.
- Stage: no padding beyond 24px; `place-items: center`; the device shell keeps its shadow, but
  reduce it (`0 8px 32px rgba(0,0,0,.4)`) — it is a frame on a canvas, not a hero card.

### 1.3 Delete the toolbar row; replace with a top-centre preset pill

Remove `.hi-device-toolbar` and its contents (JSX ≈ 2969–2991). Replace with a floating pill,
`position: absolute; top: 12px; left: 50%`, same visual language as `.hi-canvas-toolbar`
(css ≈ 2088):

| Keep | As |
|---|---|
| Kind buttons (mobile/tablet/desktop) | Icon-only, 32px, no label; tooltip has the name |
| Model `<select>` | A `SelectField` (the tool's own dropdown, css already exists) showing `iPhone 15 · 393` |
| Rotate | Icon button, only rendered for phone/tablet presets |
| Reload, Freeze reveals, Live page | A `…` overflow menu on the pill. Freeze is a checkbox row. |

| Remove | Because |
|---|---|
| `{width} × {height}` label | It is the model's own label now |
| Pick toggle (`Crosshair`, Ctrl+P) | Picking *is* the Move tool. Interaction with the page is the Hand tool (1.5). Delete `picking` state; the hover/click effects are gated on `tool === 'move'` instead. |
| Zoom group | Moves to a bottom-right zoom pill (1.6) |
| Close X | The panel header already has one |

### 1.4 Delete the footer

Remove `.hi-device-footer` entirely (JSX ≈ 3017–3040, css ≈ 866–873). Where each piece goes:

| Was in the footer | Goes to |
|---|---|
| `Group / grid · 1189 × 232px · 16px type · padding …` | Nowhere. The selection label (1.7) shows W × H; the panel shows the rest. |
| `Drag the handles to resize · double-click text to retype` | Delete. Tooltip on the resize handle: "Drag · Shift keeps ratio · Alt from centre". |
| `Run breakpoint sweep` + `hi-sweep-report` | A **Responsive** section in the panel (Phase 3), collapsed, with the button and the strip inside it. `runSweep`, `SWEEP_WIDTHS`, `summariseSweep` are unchanged; only the JSX moves. |
| `Looks healthy` / issues banner | Delete the "healthy" state outright. Issues become a count badge on the Responsive section title (`ToolSection` already supports `badge`), and the list inside it. |
| `hi-device-note` (yellow note) | `InspectorToast` (≈ 4658 area) — transient, dismissable. |

`measureStage` no longer depends on `metrics`/`note` (≈ 2721) — simplify.

### 1.5 Tools pill (bottom centre) — shared by frame and live page

Move `.hi-canvas-toolbar` (JSX ≈ 4813) out of the `!deviceOpen` gate so it renders in both.
Contents:

- **Move** `V` — select, drag, resize, nudge (today's `mode === 'design'`).
- **Comment** `C`.
- **Hand** `H` / hold `Space` — the page receives pointer events; no hover box, no selection.
  This replaces the old Pick toggle and gives reviewers a way to open the site's menus.
- separator
- **Handoff** — no single-letter key anymore (`H` is Hand, as in Figma). `Ctrl+Shift+H` if a key is
  wanted. Opens the Handoff document in the panel as today.

Labels: icon + `kbd` only at ≥1280px wide; icon-only below. Tooltip carries the full name.

### 1.6 Zoom pill (bottom right, inside the stage)

`Fit` · `50` · `100` · `200` in a small dropdown showing the current percentage, plus:
`Ctrl+0` fit, `Ctrl+1` 100%, `Ctrl+=`/`Ctrl+-` step, `Ctrl+wheel` over the stage zooms around
the pointer (transform-origin math on `.hi-device-shell`; the sizer already scales). Space+drag
pans the stage when the shell is larger than it (`overflow: hidden` on the stage → track a
translate offset in state). Keep it simple: no minimap, no rulers.

### 1.7 Selection chrome inside the frame — match the live page, match Figma

`.hi-device-marker` (css ≈ 855–857) and its JSX (≈ 2999–3002):

- Hover: 1px `#0d99ff` outline, **no label**. Delete `hoverBox.label` and `classifyElement` in
  `onMove` (≈ 2888). Figma shows nothing on hover but the outline.
- Selected: 1px `#0d99ff` outline; 8 handles (corners 8px squares, edges as hit areas only);
  handles and outline counter-scaled by `1/scale` the way pins already are, so they stay 1px/8px at
  50%. Size label: a blue pill centred **below** the box, `W × H` rounded, 10px, also
  counter-scaled. Parent: 1px dashed `rgba(13,153,255,.5)` — reuse `hi-selection-parent`.
- Multi-select: each element gets the outline; the group bounding box gets the handles.

Extract one `SelectionChrome` component used by both the live-page overlay and the frame, taking
`{ rect, scale, handles, label, parentRect }`. Today they are two separate implementations.

---

## Phase 2 — Drag with snapping (move, keep tight, centre, proportions)

All of this lives in the canvas gesture layer (`beginResize`/`resizeFrame` ≈ 2453–2530 and the
`startResize` wiring ≈ 4394). Add a sibling `beginMove` with the same session shape.

### 2.1 Drag to move

Pointer-down inside the selection box (not on a handle) + 4px of travel starts a move.

- **Parent is flex or grid (the normal case):** the drag *reorders* — a 2px blue insertion line is
  drawn between the siblings nearest the pointer (respecting `flex-direction`/`grid-auto-flow`),
  and on release the element is moved there. Commit through the existing `reorder` path
  (≈ 4645: `domBefore`/`domAfter`, `layout:order`), generalised from ±1 to "before sibling N".
- **Parent is block/inline flow, or Alt is held:** free move via `margin-left`/`margin-top` deltas,
  exactly what the `n`/`w` handles already write. Commit through `recordChange` with the two
  margin properties, batched as one history entry `Move`.
- Escape mid-drag cancels (`canvasBusyRef` already guards this).

### 2.2 Snapping and smart guides (applies to move **and** resize)

A pure function `computeSnap(candidate: Rect, targets: SnapTarget[], threshold)` →
`{ rect, guides: Guide[] }`, unit-testable, threshold `4 / scale` px. Targets, gathered once at
gesture start from the parent and the visible siblings (max ~40, skip `IGNORED_SELECTOR`):

| Snap to | Guide drawn | Covers the request |
|---|---|---|
| Sibling left/right/top/bottom edges | Red line along the shared edge | edges line up |
| Sibling horizontal/vertical centres | Red line through both centres | "keep them in the middle" (relative to each other) |
| Parent centre X / centre Y | Red line through the parent's centre | "keep in the middle" of the container |
| Parent content-box edges (inside padding) | Red line on the padding edge | stays inside the safe area |
| Equal gaps: distance to previous sibling == distance to next | Pink `#ff24bd` gap ticks with the px value on both gaps | "keep things tight" / even spacing |
| Gap = 0 (touching a sibling) and gap = the design system's spacing tokens | Red edge line + gap label | "keep things tight" on the system's scale |
| Alt-drag: 8px grid (existing) | none | unchanged |

Guides render in a `hi-guides` layer above the frame, counter-scaled, with the distance label
(`12`) in a red pill at the midpoint. They disappear on release. Shift disables snapping for the
gesture (Figma's convention), Ctrl toggles "snap to geometry" persistently in the `…` menu.

### 2.3 Resize modifiers

`resizeFrame` (≈ 2480) already does Shift = keep ratio on corners. Add:

- **Alt = resize from centre** — both opposite edges move; `marginLeft/Top` shift by half.
- **Shift on an edge handle** — snap the size to the spacing scale rather than ratio.
- Ratio lock in the panel (a small link icon between W and H, as Figma) makes ratio the default
  for that element without holding Shift.
- Snap the dragged edge with the same `computeSnap` (edges/centres/equal gaps), guides included.

### 2.4 Alt-hover measure

With something selected and Alt held, hovering any other element (in frame or on the live page)
draws red distance lines between the two boxes on each axis with px labels. Reuse `computeSnap`'s
target rects. This is read-only; no state is written.

### 2.5 Nudge

Already there (≈ 4526). Ensure `Shift+arrow` = 10px and that nudging a flex child in the cross axis
writes `margin-*`, in the main axis offers reorder (arrow = reorder when parent is flex/grid, Alt+arrow
= margin). Batch as one history entry per key-repeat run (existing `beginHistoryBatch`).

---

## Phase 3 — The panel, in Figma's shape

`aside.hi-panel` (JSX from ≈ 4820). Visual: 280px, `#2c2c2c` background, `#444` 1px section
dividers, no card, no blur, no gradients, 11px labels `#b3b3b3`, values `#fff` 11px, inputs 24px
tall with `#383838` fill on hover/focus and `#0d99ff` focus ring. Two-column numeric grid
(`grid-template-columns: 1fr 1fr; gap: 8px`). Section titles 11px semibold with a `+`/`−` on the
right only when the section has an optional feature to add (Figma style); otherwise the title is
the toggle.

### 3.1 Header

Replace the product header (logo, "Design Inspector", "Selection locked" subtitle, collection
switch, dock switch, unlock, settings, close) with:

- Row 1: a tab strip — **Design · Comment · Handoff** — bound to `mode`. (The bottom tool pill
  still switches tools; both control the same state. Handoff is only reachable here and via the
  pill's last button.)
- Row 2 (Design/Comment only): the selection breadcrumb — `section › div.card › button.cta` —
  each crumb clickable = select that ancestor. Replaces the "DOM path" property row. When nothing
  is selected: one line, `Click anything to select it`, muted.
- Overflow `…` at the right of row 1: dock left/right, design-system collection switch, settings,
  Live page, Close. These were six always-visible icons for things used once a session.

### 3.2 Sections and order (Design mode)

Render in this order; sections marked ⊘ are **not rendered** when they do not apply.

1. **Align** — one row of six icons: align left / centre / right / top / middle / bottom, relative
   to the parent. Implementation: in a flex parent, writes `align-self` / `margin-*: auto`; in a
   block parent, `margin-left/right: auto` for horizontal, `text-align` for inline content. Each
   click is a normal `recordChange`.
2. **Position & size** — `X Y` (margin-left/top, scrubbable), `W H` with ratio lock, rotation ⊘
   (only if `transform` is already present). Below it a single row of icon toggles for `display`
   (block / flex / grid / hidden), which is what decides whether section 3 exists.
3. **Auto layout** ⊘ (only when `display` is flex/grid) — direction (4 icons), gap (one field, or
   two when row/column gap differ), padding (one field; expand to four via a small icon, as
   Figma's independent-padding toggle), alignment as the 3×3 dot grid, wrap toggle. Replaces the
   `<select>`s in today's Layout section (`FLEX_DIRECTIONS`, `ALIGN_ITEMS`, `JUSTIFY_CONTENT`).
4. **Fill** — background colour swatch + hex + opacity in one row; token chip on the right when
   the value matches one (`tokenBindings`). Eyedropper via `window.EyeDropper` on the swatch's
   context. Background image ⊘ shows as a thumbnail row.
5. **Stroke** — border colour/width/style in one row; ⊘ unless a border exists, otherwise the
   section shows only a `+` to add one.
6. **Effects** — box-shadow (`shadowOptions`), radius (one field, expandable to four), opacity.
7. **Text** ⊘ (only when the element has its own text node) — font family (`FontField`), weight
   and size on one row, line height and letter spacing on one row, align icons, colour with token
   chip, then the content textarea (`DraftTextArea`) last.
8. **Tokens** — collapsed by default. Existing `TokenBindingPanel`.
9. **States** — collapsed. Existing `ComponentStatesEditor`.
10. **Responsive** — collapsed; badge with the issue count from `measureInFrame`; holds the sweep
    button, strip and ranges moved out of the footer (1.4).
11. **Accessibility** — collapsed; badge with the finding count.
12. **Assets** ⊘ — as today, only with assets.
13. **Edits on this page** — the changes list, collapsed, with Reset selection / Reset all.

Removed from the panel: the "Preview mode · click to select" status bar (`hi-status`), the
restore banner (`hi-restore`) becomes a toast with an Undo action, the Device preview launcher
section (`ResponsiveLauncher`, ≈ 3046 and 4973 — the preset pill replaces it), the "Showing all N
edits" sentence (`hi-empty-note`) → a count in the section title, the `Measurements`/`Technical`
JSON dump → a `Copy JSON` item in the header's `…` menu.

### 3.3 Cognitive-load rules for the panel

- Every field is label-less where Figma is: `X Y W H` use the letter as the scrub label (already
  the pattern in `NumberField`). Everywhere else the label is an icon with a tooltip, or a 11px
  word at most.
- No sentences inside the panel. Any explanatory copy in a section body becomes that section's
  tooltip. The one exception is the empty-state line in the header.
- Only one highlight colour (blue). Warnings are a number in a badge, never a coloured box, until
  the section is opened.
- Scope switch (free / component) becomes a single segmented control at the top of section 13,
  not a banner.

---

## Phase 4 (optional) — Layers

A left column, 240px, toggled with `Ctrl+Shift+L` / the `…` menu, same grid: rows are the DOM
tree from `body` down, labelled `kind · .class` via `classifyElement`/`getSelector`, hover
highlights in the frame, click selects, `▸` expands, eye icon toggles `display:none` as a recorded
change. Only children that are `visible()` and not `IGNORED_SELECTOR` are listed. Virtualise if
the tree exceeds ~2000 rows. This is last because everything above is usable without it.

---

## Keyboard map (final)

| Key | Does |
|---|---|
| `V` / `C` / `H` | Move / Comment / Hand |
| `Space` (hold) | Hand while held; Space+drag pans the stage |
| Click · Shift+click · Ctrl+click · double-click | Select · add · deep select · enter child (text → edit) |
| `Esc` / `Enter` / `Tab` / `Shift+Tab` | Parent / first child / next / previous sibling (existing) |
| Arrows / `Shift`+arrows | Nudge 1 / 10px; in a flex parent along the main axis, reorder |
| Drag | Reorder (flex/grid) or move; `Alt` forces free move; `Shift` disables snapping |
| Handle drag | Resize; `Shift` ratio; `Alt` from centre |
| `Alt` + hover | Measure to hovered element |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo (existing) |
| `Ctrl+D` / `Delete` / `Ctrl+Shift+H` | Duplicate / hide / show (new; hide = `display:none` recorded) |
| `Ctrl+Alt+C` / `Ctrl+Alt+V` | Copy / paste styles (new) |
| `Ctrl+0` / `Ctrl+1` / `Ctrl+=` / `Ctrl+-` / `Ctrl+wheel` | Fit / 100% / zoom |
| `Alt+Shift+D` | Toggle the tool (extension) |

---

## Order of work and acceptance

1. **Phase 1.1–1.4** — open into the frame, flat canvas, no toolbar row, no footer. *Accept:*
   opening the tool shows only stage + panel; nothing overlaps the page; Esc never closes the
   overlay; the sweep and issues are reachable from the panel.
2. **Phase 1.5–1.7** — tool pill shared, zoom pill, shared `SelectionChrome`. *Accept:* hover shows
   a bare outline; selection shows 8 handles and a size pill at every zoom; Hand tool lets the
   site's own menus open.
3. **Phase 2.1–2.2** — move + `computeSnap` with guides. *Accept:* dragging a card in a flex row
   reorders it with an insertion line; dragging in a block parent shows red guides at sibling edges,
   centres and the parent's centre; equal-gap guides appear when three siblings are evenly spaced;
   `computeSnap` has unit tests in `extension/test/` for edge, centre, equal-gap and threshold.
4. **Phase 2.3–2.5** — resize modifiers, Alt-measure, nudge/reorder unification.
5. **Phase 3** — panel restructure. Do it section by section; each section is a self-contained
   commit. *Accept:* a selected button shows Align, Position, Fill, Stroke, Effects, Text and
   nothing else expanded; a `div` with `display:flex` gains Auto layout; a `div` without text has
   no Text section.
6. **Phase 4** — layers, if wanted.

Every phase keeps `npm run build:extension` and `npm test` green, and keeps the live-page escape
hatch working. Nothing in the handoff document format changes.
