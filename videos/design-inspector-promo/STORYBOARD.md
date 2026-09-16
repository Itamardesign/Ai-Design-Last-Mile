---
format: 1920x1080
duration: 15s
message: "Inspect any interface, tune it live, and hand developers implementation-ready design decisions"
arc: "Demo Loop — inspect → tune → hand off"
audience: "product designers and frontend developers"
mode: autonomous
music: none
---

## Video direction

Use the frame system's white canvas, deep ink, Meraki violet accent, blue selection state,
and green success state; display/body type uses the adopted interface roles and code uses the
mono role. Motion is precise and smooth with long-tail settles: every interaction reveals the
next piece rather than loading the whole UI at once. Frame 1 establishes and locks the target;
Frame 2 is the high-energy edit couple; Frame 3 decelerates into a held, readable result.
Everything stays inside the top 83% safe region. No photography, screenshot plates, browser
recordings, generic gradient blobs, lazy breathing, bouncy entrances, slideshow front-loading,
or screensaver-like independent drift. The final copied state holds still.

## Frame 1 — Inspect the interface

- status: animated
- src: compositions/frames/01-inspect.html
- duration: 4.5s
- transition_in: cut
- scene: A live browser-like product page becomes selectable as the inspector enters.
- poster: 3.2s
- type: product_intro
- blueprint: cursor-ui-demo (Adapt)
- asset_candidates: assets/ui-source.txt — reference-only source for live DOM reconstruction
- focal: "reconstructed browser page and selected hero button"
- roles: "reconstructed HTML/DOM UI = foreground product surface"
- handoff_out: "selected button at x=520, y=604, scale=1, opacity=1, motion direction=stationary, speed=0; inspector panel at x=1450, y=80, scale=1, opacity=1, motion direction=stationary, speed=0"

Open directly on useful work: a polished page is already alive. A cursor targets the hero
button, a violet selection frame locks on, and the inspector panel slides in. On-screen copy:
“Inspect any interface.”

Adapt: keep the cursor-led surface introduction and hover-inspect signature; replace the
tracking mini-panel with the product's docked inspector so the real workflow is legible.

Scene 1 (0.0–1.2s): the reconstructed product page fills a soft white browser surface on a
deep-ink stage; only the large hero statement and violet action button settle into a rule-of-thirds
layout, primary surface over two depth layers. A custom violet cursor glides in with a smooth
long-tail arrival (`cursor-click-ripple` approach, no click yet).

Scene 2 (1.2–2.7s): the cursor crosses the hero and the interface answers sequentially: a thin
violet hover outline traces the heading, then the button; selection chrome draws around the button
with its compact `.cta` label (`svg-path-draw`, `dynamic-content-sequencing`). The camera stays
locked so the product interaction—not a chase—carries the eye.

Scene 3 (2.7–4.5s): the cursor presses the selected button with a restrained ripple
(`cursor-click-ripple`); the inspector panel slides from the right and its header, Inspect tab,
and “button.cta” target row reveal in sequence (`card-morph-anchor`, `waterfall-entry`). The line
“Inspect any interface.” rises in the upper-left and the whole two-surface composition settles,
holding the selected button and docked panel at the handoff geometry.

## Frame 2 — Tune it live

- status: animated
- src: compositions/frames/02-tune.html
- duration: 6.5s
- transition_in: cut
- scene: Inspector controls and the selected button update together in a tightly coupled edit loop.
- poster: 4.0s
- type: feature_showcase
- blueprint: panel-edit-live-sync (Reproduce)
- asset_candidates: assets/ui-source.txt — reference-only source for live DOM reconstruction
- focal: "selected hero button bound to the inspector controls"
- roles: "reconstructed HTML/DOM UI = foreground product surface"
- handoff_in: "selected button at x=520, y=604, scale=1, opacity=1, motion direction=stationary, speed=0; inspector panel at x=1450, y=80, scale=1, opacity=1, motion direction=stationary, speed=0"
- handoff_out: "selected violet button at x=520, y=604, scale=1, opacity=1, motion direction=stationary, speed=0; inspector handoff tab at x=1450, y=80, scale=1, opacity=1, motion direction=stationary, speed=0"

Keep the selected element and inspector bound in one view. The cursor scrubs radius and spacing,
chooses the violet design token, and the target updates immediately. A compact accessibility
status flips to pass. On-screen copy: “Tune it live.”

Reproduce: use the live-sync couple exactly—the same selected button and the same bound panel
change together on every edit beat; keep both visible for the whole shot.

Scene 1 (0.0–1.2s): begin on the exact handoff geometry. The selected button holds left while
the inspector's Layout group expands right; redline spacing chips pop in one after another around
the target (`spring-pop-entrance`). “Tune it live.” reveals above the page in display type.

Scene 2 (1.2–3.0s): the cursor grabs the radius field and scrubs `8 → 24`; the readout and all
four button corners update simultaneously (`control-target-sync`, `counting-dynamic-scale`). The
framing remains asymmetric 70/30 with both control and target co-visible.

Scene 3 (3.0–4.8s): the cursor scrubs horizontal padding `20 → 32`; the button stretches in the
same beat and the measurement chips update to `32` (`control-target-sync`). The panel scrolls just
enough to reveal Fill while the camera stays locked.

Scene 4 (4.8–5.8s): the violet `brand/500` swatch is selected; its checkmark lands and the target
fill snaps to the exact same token while a bound-token pill appears (`dynamic-content-sequencing`,
`scale-swap-transition`).

Scene 5 (5.8–6.5s): accessibility flips from “Checking” to a green “AA · Pass” state and the
Handoff tab becomes active. The edit couple settles and holds without drift.

## Frame 3 — Hand off the decision

- status: animated
- src: compositions/frames/03-handoff.html
- duration: 4s
- transition_in: cut
- scene: The panel transforms into a clean handoff card with CSS, token names, and a copied state.
- poster: 2.7s
- type: cta
- blueprint: cta-morph-press (Adapt)
- asset_candidates: assets/ui-source.txt — reference-only source for live DOM reconstruction
- focal: "developer handoff code card and Copy handoff control"
- roles: "reconstructed HTML/DOM UI = foreground product surface"
- handoff_in: "selected violet button at x=520, y=604, scale=1, opacity=1, motion direction=stationary, speed=0; inspector handoff tab at x=1450, y=80, scale=1, opacity=1, motion direction=stationary, speed=0"

The edited button compresses into the handoff tab. CSS lines type in, a “Copy handoff” control
changes to “Copied,” and the final lockup lands: “Design decisions. Ready to ship.”

Adapt: keep the same-center morph and human-aimed press signature; the inspector panel becomes
the centered handoff card, and the copied state becomes the closing brand action.

Scene 1 (0.0–1.0s): continue from the exact incoming geometry. The inspector's content switches
to Handoff and the selected page gently dims; the panel scales toward center while preserving its
anchor (`card-morph-anchor`).

Scene 2 (1.0–2.2s): the centered handoff card reveals `button.cta`, then three CSS lines type in
sequentially—`padding: 14px 32px`, `border-radius: 24px`, `background: var(--brand-500)`—using
the mono role (`discrete-text-sequence`). The outgoing page is now fully cleared.

Scene 3 (2.2–3.0s): the handoff card condenses at the same center into a violet “Copy handoff”
control (`scale-swap-transition`); the cursor arrives off-center with a decelerating path and presses
cursor and control together (`physics-press-reaction`).

Scene 4 (3.0–4.0s): the button becomes green “Copied ✓” with a restrained ripple, then the final
line reveals above it: “Design decisions. Ready to ship.” The state holds rock-steady to frame 15.0s.
