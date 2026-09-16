---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Inspect any interface, tune it live, and hand developers implementation-ready design decisions"
destination: website
aspect: 1920x1080
language: en
audience: "product designers and frontend developers"
length: 15s
angle: "inspect → tune → hand off"
narration: no
---

## Intent

A fast product showcase of the Meraki Mind Design Inspector Chrome extension. The
extension's interface is the hero: begin on a polished webpage, select a real UI
element, reveal the inspector, adjust design values live, and finish on a concise
developer handoff. The visual language should feel precise, premium, and kinetic.

## Assets

- The existing React and extension HTML/CSS in this repository — visual source of truth for the inspector UI.

## Customizations

- Reconstruct the product as live HTML/DOM layers and animate cursor movement, selection bounds, controls, tokens, and handoff code.
- Use crisp interface choreography and one continuous focus move from webpage to inspector to output.

## Notes

- Exactly 15 seconds.
- Fully silent: no narration, music, or sound effects.
- Do not use static photos, screenshots, or photographic media.
- Avoid a generic logo-first SaaS montage; lead with the product doing useful work.

---

# Landing page — Pixel Poke (Chrome extension)

Name: **Pixel Poke** (two words in prose; `pixel-poke` in code and URLs). Its own brand — not
presented as a Meraki Mind product. Scope: the Chrome extension only. The npm package is not
mentioned on this page.

One job: **Add to Chrome**. Until the Web Store listing is live, the same button reads
**Join the waitlist**.

Tone: friendly, precise, no jargon. Short sentences. Every claim below is true of the
extension as built today — do not add features to the copy that are not in
`extension/README.md`.

## Nav

Pixel Poke · Features · About · GitHub · **[Add to Chrome]**

## Hero

**Headline:** Poke any UI. Hand off real CSS.

**Sub:** Pixel Poke is a Chrome extension that lets you click any element on any website, edit
it live the way you would in Figma, and copy out clean CSS plus written handoff notes.
Nothing is installed into the site. No source file is touched.

**Primary CTA:** Add to Chrome — it's free
**Secondary CTA:** Watch it work (15s) → scrolls to / plays the promo video

**Under the video:** Works on any site — yours, a competitor's, staging, production, a page
nobody has the source to.

## Three steps (the video's arc)

1. **Inspect.** Click the toolbar button, click an element. A selection frame locks on and the
   panel slides in.
2. **Tune.** Drag, resize, recolour, retype. Snapping guides, measurements and undo — Figma's
   gestures on a live page.
3. **Hand off.** One CSS rule per element, token names included, accessibility findings
   attached. Copy as Markdown or download it.

## About

Pixel Poke closes the last mile between a design and the thing that ships.

Every product team has the same loop: a designer spots something off on the live site, opens
DevTools, fiddles with values they can't save, takes a screenshot, writes "can we make this
16px?" in a ticket, and the developer re-derives it all from scratch. Pixel Poke replaces that
loop with one session. You edit the real page, by hand, with the tools you already know. When
it looks right, the CSS that made it look right is already written — and the note explaining
why is pinned to the element it's about.

It's built for product designers and frontend developers who share a page but
not a codebase. It is live-preview only: reload the tab and the site is exactly as it was.
Everything you did is in the handoff.

## Main features

**Select anything, on any site.**
Click an element to select it. Shift-click adds to the selection, double-click reaches inside
a group, and the Layers column (`Ctrl Shift L`) shows the page as a tree with hover outlines
and hide/show eyes.

**Edit by hand, like Figma.**
Drag to move — inside a flex or grid parent it reorders, with a blue line showing where it will
land. Handles resize, corners rotate, arrows nudge 1px / 10px. Red guides snap to sibling edges
and centres; pink ticks tell you when gaps came out equal. `Alt`-hover measures the distance to
anything. Undo, redo, duplicate, flip, hide — all the keys you expect.

**A panel that only shows what applies.**
Align, Position & size, Auto layout (for flex/grid), Fill, Stroke, Effects and Text — laid out
the way Figma's Design tab is. Fill is one type at a time: solid, gradient with draggable stops,
image, pattern, or none. Every colour has opacity. Every text element has font, size, weight,
line, tracking and the content itself.

**A handoff written for the person receiving it.**
Organised by element, not by category: what was said about it, what changed, and what's wrong
with it — together. Twenty edits on a button become one `button.cta { … }` block. Values that
match your design system are labelled with their token name. Undo a single row without losing
the rest. Copy as Markdown, download `.md`, or capture the tab and save the screenshot beside it.

**Notes pinned to the element they're about.**
Numbered pins on the page, in the panel and inside the device preview. Hover to read, click to
open the thread, reply and resolve without leaving. Pins survive deploys — each note remembers
what its element looked like and finds it again when the markup moves.

**Preview at real device sizes.**
Load the page inside the panel at phone, tablet and desktop widths, rotate it, and edit the
framed element directly — even on sites with feeds and experiments where the framed copy isn't
the same tree as the page behind it.

**Accessibility, checked as you go.**
Contrast and target-size findings for every element in the report, because that's exactly what
a developer needs handed to them. Component states — hover, active, focus, disabled — are
detected from the site's own CSS and previewable.

**Your design system, plugged in.**
Paste a tokens file or point at a URL: plain JSON, DTCG / Style Dictionary, Tokens Studio,
Tailwind config, or any unlabelled export. Swatches and text styles become yours, values bind
to tokens, the page gets a token audit, and one edit can apply to every variant of a component.
A URL system re-fetches itself so it stays current with your build.

**Sites that fight back, handled.**
If the page declares a property `!important`, the edit outranks it — and the copied CSS carries
the same `!important`, so what you paste reproduces what you saw.

**Sign in, or don't.**
Skip and nothing ever leaves your machine. Sign in with Google and your notes, unfinished edits
and kept handoffs follow you to another computer. Either way the local copy is the source of
truth; nothing in the panel waits on the network.

## Privacy strip

Pixel Poke never modifies your site. Edits are a preview in your own tab; reload and they're
gone. It contacts Google Fonts for the panel's typeface and font previews, and — only if you
sign in — mirrors your notes and handoffs to your own account. That's the whole list.
→ Read the privacy policy

## FAQ

**Does it change my website?** No. Everything is a live preview in your tab. Nothing is written
to the site or its files. You copy the result out.

**Does it work on sites I don't own?** Yes — that's the point. Any page Chrome can load.

**Do I need to sign in?** No. Skip is a real answer and is remembered. Signing in only adds
sync between machines.

**What does the developer receive?** A Markdown document, organised by element: one CSS rule
per selector with token names, the notes left on it, and its accessibility findings. Optionally
a screenshot of the tab.

**Does it work without a design system?** Yes. Without one it reads the page's own fonts,
palette, type scale and spacing. Connecting tokens unlocks token binding, the page audit, and
apply-to-all-variants.

**Is it free?** Yes.

**Keyboard shortcut?** `Alt Shift D` toggles it on the current tab. `Esc` steps back one layer.

## Final CTA

**Stop describing the fix. Hand it over.**
[Add to Chrome — it's free]

## Footer

Pixel Poke · GitHub · Privacy · Contact · © 2026

## Page-level notes

- The hero video is the existing 15s promo, muted, autoplay, loop, `playsinline`; poster =
  `snapshots/frame-01-at-2.1s.png`. Respect `prefers-reduced-motion` (poster + play button).
- `<title>`: "Pixel Poke — poke any UI, hand off real CSS" ·
  meta description: "A Chrome extension that lets you click any element on any website, edit it
  live like Figma, and copy out clean CSS with written handoff notes. Nothing touches your source."
- Visual language = the promo's frame system: white canvas, deep ink, violet accent,
  blue selection, green success, mono for code.
- Three analytics events only: `cta_chrome_click`, `cta_waitlist_submit`, `video_play`.
