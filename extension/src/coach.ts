/**
 * The first thirty seconds.
 *
 * The inspector arrives as a small tab on the edge of somebody else's website, which is a strange
 * thing to have happen to a page — and nothing on screen says what it wants. Shown once, ever, and
 * dismissed by doing anything at all, because coaching that outstays its welcome is worse than none.
 *
 * It lives in the extension rather than the component: an app that renders `<HandoffInspector />`
 * has already told its own team what the tool is, and would not thank us for a tour.
 */

const SEEN_KEY = 'coachMarksSeen';

export const coachCss = `
.mk-coach {
  position: fixed; bottom: 22px; left: 22px; z-index: 2147483000; width: 268px; padding: 14px 15px;
  border: 1px solid rgba(157, 170, 207, .3); border-radius: 14px;
  color: #172033; background: rgba(255, 255, 255, .98);
  font-family: Inter, ui-sans-serif, -apple-system, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.5;
  box-shadow: 0 20px 50px rgba(31, 33, 68, .3);
  animation: mk-coach-in .4s cubic-bezier(.2, .9, .3, 1.3) both;
}
.mk-coach h2 { margin: 0 0 2px; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
.mk-coach p { margin: 0 0 10px; color: #71809C; font-size: 11.5px; }
.mk-coach ol { display: grid; margin: 0 0 12px; padding: 0; gap: 7px; list-style: none; counter-reset: mk; }
.mk-coach li { display: flex; align-items: flex-start; gap: 8px; counter-increment: mk; }
.mk-coach li::before {
  display: grid; width: 17px; height: 17px; flex: none; place-items: center; margin-top: 1px;
  border-radius: 999px; background: #F1E9FF; color: #7C3CFF; content: counter(mk);
  font-size: 9.5px; font-weight: 700;
}
.mk-coach kbd {
  padding: 1px 5px; border: 1px solid rgba(157, 170, 207, .5); border-bottom-width: 2px;
  border-radius: 4px; background: #fff; font-family: inherit; font-size: 10px;
}
.mk-coach button {
  width: 100%; min-height: 30px; border: 0; border-radius: 9px; color: #fff; background: #7C3CFF;
  font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.mk-coach button:hover { background: #6A2EE0; }
.mk-coach.is-leaving { animation: mk-coach-out .22s ease-in forwards; }

@keyframes mk-coach-in {
  from { opacity: 0; transform: translateY(14px) scale(.96); }
  to { opacity: 1; transform: none; }
}
@keyframes mk-coach-out {
  to { opacity: 0; transform: translateY(8px) scale(.98); }
}
`;

/**
 * Shows the tour once per install, inside the panel's own shadow root.
 *
 * Rendering it there rather than in the page keeps it out of reach of the site's CSS — the same
 * reason the panel lives there — and means it disappears with everything else when the inspector is
 * switched off.
 */
export async function showCoachMarks(shadow: ShadowRoot): Promise<void> {
  if (shadow.querySelector('.mk-coach')) return;
  const seen = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
  if (seen) return;
  await chrome.storage.local.set({ [SEEN_KEY]: true });

  const card = document.createElement('div');
  card.className = 'mk-coach';
  card.innerHTML = `
    <h2>The inspector is on</h2>
    <p>It runs on this tab only, and touches nothing on the site.</p>
    <ol>
      <li>Click <strong>Inspect</strong> on the left edge to open the panel.</li>
      <li>Click any element on the page to select and edit it.</li>
      <li>Leave notes, then copy the CSS or the handoff out.</li>
      <li><kbd>Esc</kbd> steps back · <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>D</kbd> toggles the tool.</li>
    </ol>
    <button type="button">Got it</button>
  `;

  const dismiss = () => {
    card.classList.add('is-leaving');
    window.setTimeout(() => card.remove(), 220);
  };

  card.querySelector('button')?.addEventListener('click', dismiss);
  shadow.appendChild(card);
  // Long enough to read without becoming furniture.
  window.setTimeout(dismiss, 14000);
}
