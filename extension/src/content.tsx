/**
 * Puts the inspector on somebody else's page.
 *
 * In an app, `<HandoffInspector />` is one node in a tree the host controls. Here there is no tree,
 * no build step and no cooperation from the page — so this file supplies the three things the app
 * normally provides: a mount point the site's CSS cannot reach into, the design system to edit
 * against, and the on/off decision (the toolbar, not `?designmode=true`).
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import HandoffInspector from '../../src/HandoffInspector.js';
import { DesignTokensProvider } from '../../src/DesignTokensProvider.js';
import { designToolsCss } from '../../src/generated/designToolsCss.js';
import type { DesignTokens } from '../../src/types.js';
import type { PageMessage } from './messages.js';
import { loadGoogleFamilies } from './webfont.js';
import { startNoteMirror } from './notes.js';
import { startEditMirror } from './edits.js';
import type { HandoffDocument } from './handoff.js';
import { coachCss, showCoachMarks } from './coach.js';

const HOST_TAG = 'meraki-design-inspector';

type Controller = {
  setActive: (active: boolean) => void;
  setTokens: (tokens: DesignTokens | null) => void;
};

/** What the message listener drives, and what a re-injected copy of this file finds already there. */
type InspectorApi = Controller & {
  /** Resolves once mirrored review notes have been restored into the page. */
  notesReady: Promise<void>;
  /** The shadow root, so one-off extension chrome (the first-run coaching) can render beside the panel. */
  shadow: ShadowRoot;
  /**
   * Puts the panel back if the page has thrown it away.
   *
   * Single-page apps that re-render the whole document — or replace `documentElement` outright on a
   * route change — take the host element with them. Re-appending the same element keeps the React
   * tree, and with it the selection, the comments and the unsaved edits.
   */
  ensureMounted: () => void;
};

/**
 * The handle between the message listener and React.
 *
 * Messages can arrive before the tree has mounted (the service worker injects and posts in the same
 * breath), so calls are queued until the component hands over its setters rather than being lost.
 */
type ControllerHandle = {
  attach: (api: Controller) => void;
  run: (task: (api: Controller) => void) => void;
};

declare global {
  interface Window {
    __merakiDesignInspector?: InspectorApi;
  }
}

/**
 * The single React tree, driven from outside by the service worker.
 *
 * `tokens` arrives asynchronously and can change while the panel is open (the designer switches
 * the design system for this site in the popup), so it is state rather than a mount-time argument —
 * `DesignTokensProvider` re-resolves and every swatch and text style updates in place.
 */
function ExtensionInspector({ controller }: { controller: ControllerHandle }) {
  const [active, setActive] = useState(false);
  const [tokens, setTokens] = useState<DesignTokens | null>(null);

  useEffect(() => {
    controller.attach({ setActive, setTokens });
  }, [controller]);

  if (!active) return null;

  // `tokens ?? undefined` matters: the provider treats an absent prop as "detect from the page",
  // which is the correct behaviour when no design system is connected for this site.
  return (
    <DesignTokensProvider tokens={tokens ?? undefined}>
      <HandoffInspector enabled />
    </DesignTokensProvider>
  );
}

/**
 * Builds an isolated place to render.
 *
 * The panel is a design tool, so it has to look identical everywhere — and a site's own
 * `button { font-family: ... }` or `* { box-sizing: content-box }` would otherwise redecorate it.
 * A shadow root is the only mount that is genuinely out of reach. The stylesheet is adopted into
 * the shadow tree *and* left in `document.head` by the inspector itself, because a few of its
 * classes (the spotlight, the state and freeze overlays) are applied to the page's own elements and
 * have to be styled in the page's tree.
 *
 * `data-inspector-ui` on the host is what keeps the tool from inspecting itself: pointer and key
 * events crossing a shadow boundary are retargeted to the host, and every guard in the inspector
 * tests `closest('[data-inspector-ui]')`.
 */
function mount(): { root: Root; controller: ControllerHandle; host: HTMLElement; shadow: ShadowRoot } {
  document.querySelectorAll(HOST_TAG).forEach((stale) => stale.remove());

  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-inspector-ui', '');
  // `all: initial` refuses every inherited declaration from the page; the fixed-position children
  // inside do their own layout, so the host needs no box of its own.
  host.setAttribute('style', 'all: initial; position: static; display: block;');
  const shadow = host.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(designToolsCss);
  // A second sheet for chrome that belongs to the extension rather than the inspector, so the
  // component's stylesheet stays exactly what the npm package ships.
  const extras = new CSSStyleSheet();
  extras.replaceSync(coachCss);
  shadow.adoptedStyleSheets = [sheet, extras];

  const container = document.createElement('div');
  shadow.appendChild(container);
  // documentElement, not body: a `transform` or `filter` on body would make the panel's
  // `position: fixed` resolve against that element instead of the viewport.
  document.documentElement.appendChild(host);

  let pending: Controller | null = null;
  const queue: Array<(api: Controller) => void> = [];
  const controller: ControllerHandle = {
    attach(api: Controller) {
      pending = api;
      queue.splice(0).forEach((task) => task(api));
    },
    run(task: (api: Controller) => void) {
      if (pending) task(pending);
      else queue.push(task);
    },
  };

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ExtensionInspector controller={controller} />
    </StrictMode>,
  );

  return { root, controller, host, shadow };
}

/**
 * Copying works on plain `http://` too.
 *
 * Every copy affordance in the panel goes through `navigator.clipboard`, which does not exist
 * outside a secure context — and a fair number of internal staging sites are still http. The old
 * `execCommand` path is deprecated but works there, and copying is not a feature worth losing.
 */
function ensureClipboard(): void {
  // Typed as always present, absent in practice outside a secure context.
  if ((navigator as { clipboard?: Clipboard }).clipboard?.writeText) return;

  const writeText = (text: string): Promise<void> => {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('style', 'position: fixed; top: -1000px; left: -1000px; opacity: 0;');
    document.body.appendChild(scratch);
    scratch.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } finally {
      scratch.remove();
    }
    return ok ? Promise.resolve() : Promise.reject(new Error('Copying is blocked on this page.'));
  };

  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

type CloudHost = typeof window & {
  __merakiInspectorCloud?: { save: (doc: HandoffDocument) => Promise<{ ok: boolean; error?: string }> };
};

function boot(): InspectorApi {
  ensureClipboard();
  // The panel is set in Inter; nearly no site has it installed, and the tool should not change
  // shape depending on whose page it is standing on.
  void loadGoogleFamilies(['Inter:wght@400;500;600;700']);

  const { controller, host, shadow } = mount();

  /*
   * Publishes the one capability the component cannot have on its own.
   *
   * The inspector runs inside this content script's isolated world, so a function left on `window`
   * here is reachable from the panel and invisible to the page. The handoff tab feature-detects it:
   * the screenshot button exists in the extension, and is simply absent when the same component is
   * rendered by an app.
   */
  (window as typeof window & { __merakiInspectorCapture?: () => Promise<string | null> }).__merakiInspectorCapture = async () => {
    try {
      const answer = await chrome.runtime.sendMessage({ type: 'capture' });
      return (answer as { dataUrl?: string | null } | undefined)?.dataUrl ?? null;
    } catch {
      return null;
    }
  };

  /*
   * The second capability, published the same way and for the same reason: keeping a handoff needs an
   * account, which is the extension's business. Absent — rather than present and failing — when the
   * designer chose to stay local, so the panel never offers to save somewhere that does not exist.
   *
   * Asked on every boot rather than cached, because the answer changes when somebody signs in or out
   * in the settings page, and a stale "yes" here would be a button that reports an error for the rest
   * of the session.
   */
  const publishCloud = (signedIn: boolean) => {
    if (!signedIn) {
      delete (window as CloudHost).__merakiInspectorCloud;
      return;
    }
    (window as CloudHost).__merakiInspectorCloud = {
      save: async (document: HandoffDocument) => {
        try {
          const answer = await chrome.runtime.sendMessage({ type: 'handoff:save', document });
          return (answer as { ok: boolean; error?: string } | undefined) ?? { ok: false, error: 'No answer from the extension.' };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
    };
  };

  void (async () => {
    try {
      const account = await chrome.runtime.sendMessage({ type: 'account' });
      publishCloud((account as { mode?: string } | undefined)?.mode === 'cloud');
    } catch {
      // The worker is between lives. The button stays absent for this mount, which is the honest
      // answer: nothing could be saved right now anyway.
    }
  })();

  // Signing in on the settings page has to reach a panel that is already open, or the button would be
  // missing on every tab until each one was reloaded. The panel re-renders constantly as you select
  // things, so it picks the capability up on its own once it is there.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.account) return;
    publishCloud((changes.account.newValue as { mode?: string } | undefined)?.mode === 'cloud');
  });

  // Notes and unfinished edits are mirrored into extension storage, so a site clearing its own storage
  // cannot take a review or an edit pass with it. The note count rides on the toolbar icon.
  const mirror = startNoteMirror((open) => {
    void (async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'notes', open });
      } catch {
        // No receiver — the tool was switched off, or the worker is between lives. The count is
        // recomputed on the next activation anyway.
      }
    })();
  });

  const editMirror = startEditMirror();

  return {
    // Both mirrors have to land before the panel mounts: it reads the notes and the restorable session
    // as it opens, and a restore written a tick later would be found by nobody until the next reload.
    notesReady: Promise.all([mirror.ready, editMirror.ready]).then((): void => undefined),
    shadow,
    setActive: (active) => controller.run((inner) => inner.setActive(active)),
    setTokens: (tokens) => controller.run((inner) => inner.setTokens(tokens)),
    ensureMounted: () => {
      if (!host.isConnected) document.documentElement.appendChild(host);
    },
  };
}

// The service worker re-runs this file whenever it cannot reach an existing copy, so booting and
// wiring are both guarded: a second React root would mean two panels fighting over the same clicks,
// and a second listener would answer every message twice.
const booted = Boolean(window.__merakiDesignInspector);
const inspector = (window.__merakiDesignInspector ??= boot());

if (!booted) {
  chrome.runtime.onMessage.addListener((message: PageMessage) => {
    if (message.type === 'inspector:set') {
      if (!message.active) {
        inspector.setActive(false);
        return;
      }
      inspector.ensureMounted();
      inspector.setTokens(message.tokens);
      // Mount only once restored notes are in place — the panel reads them as it mounts.
      void inspector.notesReady.finally((): void => {
        inspector.setActive(true);
        void showCoachMarks(inspector.shadow);
      });
      return;
    }
    if (message.type === 'inspector:tokens') inspector.setTokens(message.tokens);
  });
}
