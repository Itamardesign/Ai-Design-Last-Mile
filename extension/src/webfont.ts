/**
 * Loads webfonts in a way an arbitrary site cannot block.
 *
 * A `<link>` to fonts.googleapis.com injected by a content script is still governed by the page's
 * `Content-Security-Policy`, so on a strict site it simply never loads. Fetching the bytes with the
 * extension's own privileges and handing them to `new FontFace(family, buffer)` involves no
 * document-initiated request, so there is no policy to fall foul of.
 */

const registered = new Set<string>();

/** The `latin` face of a family — the one whose preview text a designer is actually reading. */
function isLatin(block: string): boolean {
  const range = /unicode-range:\s*([^;}]+)/i.exec(block);
  if (!range) return true;
  return /U\+0{0,3}0-0{0,2}FF/i.test(range[1]);
}

function firstUrl(block: string): string | null {
  const match = /src:[^;}]*url\((['"]?)([^'")]+)\1\)/i.exec(block);
  return match ? match[2] : null;
}

/**
 * Registers the given Google families with the document.
 *
 * `specs` are css2 family specifiers, e.g. `Inter:wght@400;600`. Failures are swallowed per face:
 * a font that will not load is a preview that falls back, never a tool that breaks.
 */
export async function loadGoogleFamilies(specs: string[]): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;

  const wanted = specs.filter((spec) => !registered.has(spec));
  if (!wanted.length) return;
  wanted.forEach((spec) => registered.add(spec));

  const query = wanted.map((spec) => `family=${spec.replace(/ /g, '+')}`).join('&');

  try {
    const response = await fetch(`https://fonts.googleapis.com/css2?${query}&display=swap`);
    if (!response.ok) return;
    const sheet = await response.text();
    const blocks = sheet.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const seen = new Set<string>();

    for (const block of blocks) {
      if (!isLatin(block)) continue;
      const family = /font-family:\s*(['"]?)([^'";]+)\1/i.exec(block)?.[2]?.trim();
      const weight = /font-weight:\s*([^;}]+)/i.exec(block)?.[1]?.trim() ?? '400';
      const url = firstUrl(block);
      if (!family || !url) continue;
      const key = `${family}:${weight}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const bytes = await fetch(url).then((fontResponse) => (fontResponse.ok ? fontResponse.arrayBuffer() : null));
        if (!bytes) continue;
        const face = new FontFace(family, bytes, { weight, display: 'swap' });
        await face.load();
        document.fonts.add(face);
      } catch {
        // One family failing must not take the rest down with it.
      }
    }
  } catch {
    // Offline, or a network that blocks Google Fonts. Everything still works; faces fall back.
  }
}
